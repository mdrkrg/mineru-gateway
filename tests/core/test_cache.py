"""Tests for Phase 3 file cache (store / restore / release).

Spec: mvp-implementation.md §3.4, §6.2 step4.
Plan: Phase 3 — "file staging (store/restore/release)".
"""

from __future__ import annotations

import os

from mineru_gateway.tasks.cache import FileCache


def _files():
    return [
        ("files", ("a.pdf", b"%PDF-1.4 alpha", "application/pdf")),
        ("files", ("b.pdf", b"%PDF-1.4 beta", "application/pdf")),
    ]


async def _store_via_writer(cache: FileCache, data: dict, files: list) -> str:
    writer = cache.create_streaming_cache()
    for field, (filename, content, content_type) in files:
        await writer.write_file_chunk(field, filename, content_type, content)
    return await writer.finish(data)


async def test_store_returns_existing_dir(tmp_path):
    cache = FileCache(str(tmp_path))
    cache_dir = await _store_via_writer(cache, {"backend": "pipeline"}, _files())
    assert os.path.isdir(cache_dir)
    assert cache_dir.startswith(str(tmp_path))


async def test_restore_roundtrips_form_and_files(tmp_path):
    cache = FileCache(str(tmp_path))
    data = {"backend": "pipeline", "formula_enable": "true"}
    cache_dir = await _store_via_writer(cache, data, _files())

    restored_data, restored_files = await cache.restore(cache_dir)
    assert restored_data == data
    names = sorted(f[1][0] for f in restored_files)
    assert names == ["a.pdf", "b.pdf"]
    contents = {f[1][0]: f[1][1] for f in restored_files}
    assert contents["a.pdf"] == b"%PDF-1.4 alpha"
    assert contents["b.pdf"] == b"%PDF-1.4 beta"


async def test_release_removes_dir(tmp_path):
    cache = FileCache(str(tmp_path))
    cache_dir = await _store_via_writer(cache, {}, _files())
    await cache.release(cache_dir)
    assert not os.path.exists(cache_dir)


async def test_release_is_idempotent(tmp_path):
    cache = FileCache(str(tmp_path))
    cache_dir = await _store_via_writer(cache, {}, _files())
    await cache.release(cache_dir)
    await cache.release(cache_dir)  # no raise
