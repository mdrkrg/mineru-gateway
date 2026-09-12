"""File staging for crash recovery (§6.2 step4, §6.4 restore).

Authenticated submissions persist their original multipart (form fields + file
bytes) to a per-task directory under ``base_dir``. On upstream crash the retry
loop restores that directory and re-submits. On terminal state the directory is
released.

Layout per task::

    <base_dir>/<uuid>/
        form.json          # non-file form fields
        files.json         # ordered [{field, filename, content_type, path}]
        blob-0, blob-1 ... # raw file bytes
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import uuid

import aiofiles

Files = list[tuple[str, tuple[str, bytes, str]]]


async def _remove_tree(path: str) -> None:
    """Delete a cache tree without blocking the single-worker event loop.

    ``shutil.rmtree`` is synchronous and can take a long time on a large
    upload, so it runs in a worker thread.
    """
    await asyncio.to_thread(shutil.rmtree, path, ignore_errors=True)


class CacheWriter:
    """Streaming writer that builds a cache directory incrementally.

    spec: streaming-upload.md sec 2.1

    Files are written chunk-by-chunk via *write_file_chunk*.  Each multipart
    file part gets its own blob: the first chunk of a part passes
    ``new_part=True`` to allocate a new blob, and subsequent chunks of the same
    part append to it.  This keeps two parts with the same (field, filename)
    distinct instead of concatenating them into one blob.  *finish* finalises
    the directory (writes form.json + files.json).  *cancel* removes the
    directory.

    All I/O methods are async and use *aiofiles* to avoid blocking the
    event loop during upload streaming.
    """

    def __init__(self, base_dir: str) -> None:
        self._dir = os.path.join(base_dir, uuid.uuid4().hex)
        os.makedirs(self._dir, exist_ok=True)
        self._entries: list[dict] = []
        # (field, filename) -> blob index of the part currently being written.
        # Re-pointed on each new part so repeated names stay distinct.
        self._index: dict[tuple[str, str], int] = {}
        self._closed = False

    def _blob_path(self, idx: int) -> str:
        return os.path.join(self._dir, f"blob-{idx}")

    async def write_file_chunk(
        self,
        field: str,
        filename: str,
        content_type: str,
        data: bytes,
        new_part: bool = False,
    ) -> None:
        if self._closed:
            raise RuntimeError("CacheWriter is closed")
        key = (field, filename)
        # A multipart part boundary always starts a new blob, even when the
        # (field, filename) repeats: two parts named "doc.pdf" are two files.
        # Merging them would forward a single concatenated file upstream while
        # file_count still reports two.
        if new_part or key not in self._index:
            idx = len(self._entries)
            self._index[key] = idx
            self._entries.append(
                {
                    "field": field,
                    "filename": filename,
                    "content_type": content_type,
                    "blob": f"blob-{idx}",
                }
            )
            async with aiofiles.open(self._blob_path(idx), "wb") as fh:
                await fh.write(data)
        else:
            idx = self._index[key]
            async with aiofiles.open(self._blob_path(idx), "ab") as fh:
                await fh.write(data)

    async def finish(self, form_fields: dict) -> str:
        if self._closed:
            raise RuntimeError("CacheWriter already finished or cancelled")
        manifest: list[dict] = []
        for entry in self._entries:
            manifest.append(
                {
                    "field": entry["field"],
                    "filename": entry["filename"],
                    "content_type": entry["content_type"],
                    "blob": entry["blob"],
                }
            )
        async with aiofiles.open(os.path.join(self._dir, "form.json"), "w") as fh:
            await fh.write(json.dumps(form_fields))
        async with aiofiles.open(os.path.join(self._dir, "files.json"), "w") as fh:
            await fh.write(json.dumps(manifest))
        self._closed = True
        return self._dir

    async def cancel(self) -> None:
        if self._closed:
            return
        self._closed = True
        if os.path.isdir(self._dir):
            await _remove_tree(self._dir)


class FileCache:
    """Restore and release staged uploads. Disk work runs in a thread."""

    def __init__(self, base_dir: str) -> None:
        self.base_dir = base_dir

    def create_streaming_cache(self) -> CacheWriter:
        return CacheWriter(self.base_dir)

    async def restore(self, cache_dir: str) -> tuple[dict, Files]:
        # Read the whole directory in one thread hop: aiofiles would submit a
        # separate executor job per blob, which is pure overhead for the
        # multi-file batches this path handles.
        return await asyncio.to_thread(self._read_dir, cache_dir)

    @staticmethod
    def _read_dir(cache_dir: str) -> tuple[dict, Files]:
        with open(os.path.join(cache_dir, "form.json")) as fh:
            data = json.load(fh)
        with open(os.path.join(cache_dir, "files.json")) as fh:
            manifest = json.load(fh)

        files: Files = []
        for entry in manifest:
            with open(os.path.join(cache_dir, entry["blob"]), "rb") as fh:
                content = fh.read()
            files.append(
                (
                    entry["field"],
                    (entry["filename"], content, entry["content_type"]),
                )
            )
        return data, files

    async def release(self, cache_dir: str | None) -> None:
        if not cache_dir:
            return
        await _remove_tree(cache_dir)

    def exists(self, cache_dir: str | None) -> bool:
        return bool(cache_dir) and os.path.isdir(cache_dir)
