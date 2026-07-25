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

import json
import os
import shutil
import uuid

Files = list[tuple[str, tuple[str, bytes, str]]]


class CacheWriter:
    """Streaming writer that builds a cache directory incrementally.

    spec: streaming-upload.md sec 2.1

    Files are written chunk-by-chunk via *write_file_chunk*.  The first chunk
    of a new (field, filename) pair creates a new blob; subsequent chunks for
    the same pair append to the same blob.  *finish* finalises the directory
    (writes form.json + files.json).  *cancel* removes the directory.
    """

    def __init__(self, base_dir: str) -> None:
        self._dir = os.path.join(base_dir, uuid.uuid4().hex)
        os.makedirs(self._dir, exist_ok=True)
        self._entries: list[dict] = []
        self._index: dict[tuple[str, str], int] = {}
        self._closed = False

    def _blob_path(self, idx: int) -> str:
        return os.path.join(self._dir, f"blob-{idx}")

    def write_file_chunk(
        self, field: str, filename: str, content_type: str, data: bytes
    ) -> None:
        if self._closed:
            raise RuntimeError("CacheWriter is closed")
        key = (field, filename)
        if key not in self._index:
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
            with open(self._blob_path(idx), "wb") as fh:
                fh.write(data)
        else:
            idx = self._index[key]
            with open(self._blob_path(idx), "ab") as fh:
                fh.write(data)

    def finish(self, form_fields: dict) -> str:
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
        with open(os.path.join(self._dir, "form.json"), "w") as fh:
            json.dump(form_fields, fh)
        with open(os.path.join(self._dir, "files.json"), "w") as fh:
            json.dump(manifest, fh)
        self._closed = True
        return self._dir

    def cancel(self) -> None:
        if self._closed:
            return
        self._closed = True
        if os.path.isdir(self._dir):
            shutil.rmtree(self._dir, ignore_errors=True)


class FileCache:
    def __init__(self, base_dir: str) -> None:
        self.base_dir = base_dir

    def create_streaming_cache(self) -> CacheWriter:
        return CacheWriter(self.base_dir)

    async def restore(self, cache_dir: str) -> tuple[dict, Files]:
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
        shutil.rmtree(cache_dir, ignore_errors=True)

    def exists(self, cache_dir: str | None) -> bool:
        return bool(cache_dir) and os.path.isdir(cache_dir)
