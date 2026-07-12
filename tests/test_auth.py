"""Tests for API Key management (POST/GET/DELETE /auth/keys).

Spec: mvp-implementation.md §3.1 (API Key 管理), §5.3 (新增端点), §4 (ApiKey 模型).
Plan: Phase 1 — "Admin Token 签发/列出/吊销 API Key".
"""

from __future__ import annotations


async def test_create_key_requires_admin_token(client):
    """§3.1: 创建 Key 需要 X-Admin-Token; 缺失时拒绝 (401)."""
    resp = await client.post("/auth/keys", json={"label": "x"})
    assert resp.status_code == 401


async def test_create_key_rejects_wrong_admin_token(client):
    """§3.1: 错误的 Admin Token 不得签发 Key (401)."""
    resp = await client.post(
        "/auth/keys", json={"label": "x"}, headers={"X-Admin-Token": "wrong"}
    )
    assert resp.status_code == 401


async def test_create_key_returns_plaintext_once(client, admin_headers):
    """§5.3 POST /auth/keys: 返回完整 Key + 前缀, 仅此一次可见 (201)."""
    resp = await client.post(
        "/auth/keys", json={"label": "prod"}, headers=admin_headers
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["api_key"].startswith("mru_")
    assert body["api_key_prefix"] == body["api_key"][:8]
    assert "not be shown again" in body["message"].lower()


async def test_list_keys_hides_plaintext(client, admin_headers):
    """§5.3 GET /auth/keys: 列出元信息, 不含明文 Key (key_hash 仅哈希存储, §2)."""
    await client.post("/auth/keys", json={"label": "a"}, headers=admin_headers)
    resp = await client.get("/auth/keys", headers=admin_headers)
    assert resp.status_code == 200
    keys = resp.json()["keys"]
    assert len(keys) == 1
    entry = keys[0]
    assert "api_key" not in entry
    assert entry["prefix"]
    assert entry["is_active"] is True


async def test_list_keys_requires_admin_token(client):
    """§3.1: 列出 Key 需要 Admin Token (401 without)."""
    resp = await client.get("/auth/keys")
    assert resp.status_code == 401


async def test_revoke_key_disables_it(client, admin_headers, sample_files):
    """§3.1 / §5.3 DELETE /auth/keys/{id}: 吊销后 Key 立即失效 (业务请求 401)."""
    created = (
        await client.post("/auth/keys", json={"label": "r"}, headers=admin_headers)
    ).json()
    key_id, raw = created["key_id"], created["api_key"]

    # Key works before revocation.
    ok = await client.post("/tasks", headers={"X-API-Key": raw}, files=sample_files)
    assert ok.status_code == 202

    del_resp = await client.delete(f"/auth/keys/{key_id}", headers=admin_headers)
    assert del_resp.status_code == 204

    # Key rejected after revocation.
    denied = await client.post("/tasks", headers={"X-API-Key": raw}, files=sample_files)
    assert denied.status_code == 401


async def test_revoke_unknown_key_is_idempotent(client, admin_headers):
    """§5.3 DELETE /auth/keys/{id}: 吊销不存在的 Key 幂等返回 204 (无副作用)."""
    resp = await client.delete("/auth/keys/does-not-exist", headers=admin_headers)
    assert resp.status_code == 204


async def test_expired_key_is_rejected(client, admin_headers, sample_files):
    """§4 / §5.3: 带过去 expires_at 的 Key 立即失效 (401)."""
    from datetime import datetime, timedelta, timezone

    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    raw = (
        await client.post(
            "/auth/keys",
            json={"label": "expired", "expires_at": past},
            headers=admin_headers,
        )
    ).json()["api_key"]

    resp = await client.post("/tasks", headers={"X-API-Key": raw}, files=sample_files)
    assert resp.status_code == 401


async def test_future_expiry_key_works(client, admin_headers, sample_files):
    """§4 / §5.3: 带未来 expires_at 的 Key 当前有效."""
    from datetime import datetime, timedelta, timezone

    future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    raw = (
        await client.post(
            "/auth/keys",
            json={"label": "future", "expires_at": future},
            headers=admin_headers,
        )
    ).json()["api_key"]

    resp = await client.post("/tasks", headers={"X-API-Key": raw}, files=sample_files)
    assert resp.status_code == 202


async def test_last_used_at_updated_on_use(client, admin_headers, sample_files, app):
    """§4: 使用 Key 后 last_used_at 被更新 (初始为 None)."""

    from mineru_gateway.models import ApiKey

    created = (
        await client.post("/auth/keys", json={"label": "lu"}, headers=admin_headers)
    ).json()
    key_id, raw = created["key_id"], created["api_key"]

    async with app.state.db.session_factory() as session:
        before = await session.get(ApiKey, key_id)
        assert before.last_used_at is None

    await client.post("/tasks", headers={"X-API-Key": raw}, files=sample_files)

    async with app.state.db.session_factory() as session:
        after = await session.get(ApiKey, key_id)
        assert after.last_used_at is not None
