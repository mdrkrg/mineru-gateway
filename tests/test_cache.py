"""Tests for Phase 3 file cache (store / restore / release).

Spec: mvp-implementation.md §3.4 (任务元数据持久化 / 文件缓存自动清理),
§6.2 步骤4 (缓存原始文件到暂存区用于崩溃重提).
Plan: Phase 3 — "文件暂存 (store/restore/release)".
"""

from __future__ import annotations

import os


from mineru_gateway.tasks.cache import FileCache


def _files():
    return [
        ("files", ("a.pdf", b"%PDF-1.4 alpha", "application/pdf")),
        ("files", ("b.pdf", b"%PDF-1.4 beta", "application/pdf")),
    ]


async def test_store_returns_existing_dir(tmp_path):
    """§6.2: store 将文件与表单持久化到暂存目录, 返回该目录路径."""
    cache = FileCache(str(tmp_path))
    cache_dir = await cache.store({"backend": "pipeline"}, _files())
    assert os.path.isdir(cache_dir)
    assert cache_dir.startswith(str(tmp_path))


async def test_restore_roundtrips_form_and_files(tmp_path):
    """§6.4: restore 还原表单与文件, 结构与 submit_task 入参一致."""
    cache = FileCache(str(tmp_path))
    data = {"backend": "pipeline", "formula_enable": "true"}
    cache_dir = await cache.store(data, _files())

    restored_data, restored_files = await cache.restore(cache_dir)
    assert restored_data == data
    names = sorted(f[1][0] for f in restored_files)
    assert names == ["a.pdf", "b.pdf"]
    contents = {f[1][0]: f[1][1] for f in restored_files}
    assert contents["a.pdf"] == b"%PDF-1.4 alpha"
    assert contents["b.pdf"] == b"%PDF-1.4 beta"


async def test_release_removes_dir(tmp_path):
    """§3.4: release 删除暂存目录 (终态后清理)."""
    cache = FileCache(str(tmp_path))
    cache_dir = await cache.store({}, _files())
    await cache.release(cache_dir)
    assert not os.path.exists(cache_dir)


async def test_release_is_idempotent(tmp_path):
    """release 对不存在的目录不报错 (可安全重复调用)."""
    cache = FileCache(str(tmp_path))
    cache_dir = await cache.store({}, _files())
    await cache.release(cache_dir)
    await cache.release(cache_dir)  # no raise
