"""File staging for crash recovery (§6.2 步骤4, §6.4 restore).

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


class FileCache:
    def __init__(self, base_dir: str) -> None:
        self.base_dir = base_dir

    async def store(self, data: dict, files: Files) -> str:
        cache_dir = os.path.join(self.base_dir, uuid.uuid4().hex)
        os.makedirs(cache_dir, exist_ok=True)

        manifest = []
        for idx, (field, (filename, content, content_type)) in enumerate(files):
            blob_name = f"blob-{idx}"
            with open(os.path.join(cache_dir, blob_name), "wb") as fh:
                fh.write(content)
            manifest.append(
                {
                    "field": field,
                    "filename": filename,
                    "content_type": content_type,
                    "blob": blob_name,
                }
            )

        with open(os.path.join(cache_dir, "form.json"), "w") as fh:
            json.dump(data, fh)
        with open(os.path.join(cache_dir, "files.json"), "w") as fh:
            json.dump(manifest, fh)

        return cache_dir

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
