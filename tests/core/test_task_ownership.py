"""Owner-based task access (spec: specs/task-ownership.md).

Covers the seam between API keys and JWTs:
- JWT creates tasks without an API key.
- A key and the owner's JWT share one task history and one idempotency domain.
- Another user's key (issued by the admin) stays isolated.
- Key revocation does not remove JWT access.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from mineru_gateway.auth.principals import TaskPrincipal, ensure_can_create_tasks
from mineru_gateway.models import TaskRecord, User
from mineru_gateway.tasks import service as task_service


PASSWORD = "Str0ng!Pass"


async def _register_and_login(client, email: str) -> dict[str, str]:
    resp = await client.post(
        "/auth/register",
        json={"email": email, "password": PASSWORD},
    )
    assert resp.status_code == 201, resp.text
    resp = await client.post(
        "/auth/jwt/login",
        json={"email": email, "password": PASSWORD},
    )
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def _create_owned_key(
    client, user_headers: dict[str, str], label: str
) -> tuple[str, str]:
    resp = await client.post(
        "/me/api-keys", json={"label": label}, headers=user_headers
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    return body["api_key"], body["key_id"]


async def _submit(client, headers: dict[str, str], sample_files):
    return await client.post("/v1/tasks", headers=headers, files=sample_files)


async def test_jwt_task_is_visible_to_owner_keys_not_other_users(
    client, app, user_headers, api_key, sample_files
):
    """A JWT-created task belongs to the user, not to another user's key."""
    resp = await _submit(client, user_headers, sample_files)
    assert resp.status_code == 202, resp.text
    task_id = resp.json()["task_id"]

    async with app.state.db.session_factory() as session:
        task = await session.get(TaskRecord, uuid.UUID(task_id))
        assert task is not None
        assert task.owner_id is not None
        assert task.api_key_id is None

    # The owner's JWT sees it.
    listed = await client.get("/v1/tasks", headers=user_headers)
    assert listed.status_code == 200
    assert [item["task_id"] for item in listed.json()["items"]] == [task_id]
    detail = await client.get(f"/v1/tasks/{task_id}", headers=user_headers)
    assert detail.status_code == 200

    # Any self-service key of the same owner sees it too.
    own_key, _ = await _create_owned_key(client, user_headers, "second-device")
    key_detail = await client.get(
        f"/v1/tasks/{task_id}", headers={"X-API-Key": own_key}
    )
    assert key_detail.status_code == 200

    # Another user's key (the admin issued it for them) stays isolated.
    other_detail = await client.get(
        f"/v1/tasks/{task_id}", headers={"X-API-Key": api_key}
    )
    assert other_detail.status_code == 404
    other_list = await client.get("/v1/tasks", headers={"X-API-Key": api_key})
    assert other_list.status_code == 200
    assert other_list.json()["items"] == []

    # ... and that user's tasks stay invisible to our user.
    other_task = await _submit(client, {"X-API-Key": api_key}, sample_files)
    assert other_task.status_code == 202
    other_task_id = other_task.json()["task_id"]
    jwt_list = await client.get("/v1/tasks", headers=user_headers)
    assert other_task_id not in [item["task_id"] for item in jwt_list.json()["items"]]

    async with app.state.db.session_factory() as session:
        other_row = await session.get(TaskRecord, uuid.UUID(other_task_id))
        assert other_row is not None
        assert other_row.owner_id is not None
        assert other_row.api_key_id is not None
        owner = await session.get(User, other_row.owner_id)
        assert owner is not None
        assert owner.email.startswith("key-owner-")


async def test_key_task_is_visible_to_jwt_and_survives_revocation(
    client, app, user_headers, sample_files
):
    key, key_id = await _create_owned_key(client, user_headers, "laptop")

    resp = await _submit(client, {"X-API-Key": key}, sample_files)
    assert resp.status_code == 202, resp.text
    task_id = resp.json()["task_id"]

    async with app.state.db.session_factory() as session:
        task = await session.get(TaskRecord, uuid.UUID(task_id))
        assert task is not None
        assert task.owner_id is not None
        assert task.api_key_id == uuid.UUID(key_id)

    listed = await client.get("/v1/tasks", headers=user_headers)
    assert listed.status_code == 200
    assert task_id in [item["task_id"] for item in listed.json()["items"]]
    assert (
        await client.get(f"/v1/tasks/{task_id}", headers=user_headers)
    ).status_code == 200

    # Revoking the creating key only removes the credential, not ownership.
    revoked = await client.delete(f"/me/api-keys/{key_id}", headers=user_headers)
    assert revoked.status_code == 204
    assert (
        await client.get(f"/v1/tasks/{task_id}", headers=user_headers)
    ).status_code == 200


async def test_other_user_cannot_read_task(client, user_headers, sample_files):
    resp = await _submit(client, user_headers, sample_files)
    assert resp.status_code == 202
    task_id = resp.json()["task_id"]

    other_headers = await _register_and_login(client, "other-owner@example.com")
    other_detail = await client.get(f"/v1/tasks/{task_id}", headers=other_headers)
    assert other_detail.status_code == 404
    other_list = await client.get("/v1/tasks", headers=other_headers)
    assert other_list.status_code == 200
    assert other_list.json()["items"] == []

    other_key, _ = await _create_owned_key(client, other_headers, "other-key")
    key_detail = await client.get(
        f"/v1/tasks/{task_id}", headers={"X-API-Key": other_key}
    )
    assert key_detail.status_code == 404


async def test_idempotency_domain_is_per_owner(client, app, user_headers, sample_files):
    """One domain per owner: JWT and every key of that owner replay each other."""
    headers = {**user_headers, "X-Idempotency-Key": "owner-idem-1"}
    first = await _submit(client, headers, sample_files)
    second = await _submit(client, headers, sample_files)
    assert first.status_code == second.status_code == 202
    assert first.json()["task_id"] == second.json()["task_id"]
    assert second.headers.get("X-Idempotency-Key-Replayed") == "true"

    # Two keys of the same owner share the domain.
    key1, _ = await _create_owned_key(client, user_headers, "key-1")
    key2, _ = await _create_owned_key(client, user_headers, "key-2")
    key_headers1 = {"X-API-Key": key1, "X-Idempotency-Key": "shared-idem"}
    key_headers2 = {"X-API-Key": key2, "X-Idempotency-Key": "shared-idem"}
    r1 = await _submit(client, key_headers1, sample_files)
    r2 = await _submit(client, key_headers2, sample_files)
    assert r1.status_code == r2.status_code == 202
    assert r1.json()["task_id"] == r2.json()["task_id"]
    assert r2.headers.get("X-Idempotency-Key-Replayed") == "true"

    # ... and so does the owner's JWT.
    r3 = await _submit(
        client,
        {**user_headers, "X-Idempotency-Key": "shared-idem"},
        sample_files,
    )
    assert r3.json()["task_id"] == r1.json()["task_id"]

    async with app.state.db.session_factory() as session:
        count = await session.scalar(
            select(func.count())
            .select_from(TaskRecord)
            .where(TaskRecord.idempotency_key == "owner-idem-1")
        )
        assert count == 1


async def test_unverified_jwt_submission_is_rejected(
    client, app, user_headers, sample_files
):
    """The verification gate is wired into both task-creation routes."""
    app.state.settings.allow_unverified_accounts = False

    submit = await client.post("/v1/tasks", headers=user_headers, files=sample_files)
    assert submit.status_code == 403

    parse = await client.post(
        "/v1/file_parse", headers=user_headers, files=sample_files
    )
    assert parse.status_code == 403


async def test_jwt_reads_result_and_download(client, app, user_headers, sample_files):
    """Result downloads follow the same owner scope as task detail."""
    submitted = await _submit(client, user_headers, sample_files)
    assert submitted.status_code == 202, submitted.text
    task_id = submitted.json()["task_id"]

    async with app.state.db.session_factory() as session:
        task = await session.get(TaskRecord, uuid.UUID(task_id))
        task.status = "completed"
        await session.commit()

    result = await client.get(f"/v1/tasks/{task_id}/result", headers=user_headers)
    assert result.status_code == 200

    download = await client.get(f"/v1/tasks/{task_id}/download", headers=user_headers)
    assert download.status_code == 200


async def test_file_parse_by_jwt_belongs_to_the_user(
    client, app, user_headers, sample_files
):
    """The synchronous parse route attributes tasks to the JWT user too."""
    parsed = await client.post(
        "/v1/file_parse", headers=user_headers, files=sample_files
    )
    assert parsed.status_code in {200, 202}, parsed.text

    async with app.state.db.session_factory() as session:
        task = await session.get(
            TaskRecord, uuid.UUID(parsed.headers["X-MinerU-Task-Id"])
        )
        assert task is not None
        assert task.owner_id is not None
        assert task.api_key_id is None


async def test_jwt_lost_race_replays_winner(
    client, user_headers, sample_files, miss_first_lookup
):
    """specs/task-ownership.md §8: the JWT idempotency domain recovers too."""
    headers = {**user_headers, "X-Idempotency-Key": "jwt-race"}
    winner = await _submit(client, headers, sample_files)
    assert winner.status_code == 202, winner.text

    miss_once = miss_first_lookup(task_service, "get_by_idempotency")

    loser = await _submit(client, headers, sample_files)
    assert loser.status_code == 202, loser.text
    assert loser.headers.get("X-Idempotency-Key-Replayed") == "true"
    assert loser.json()["task_id"] == winner.json()["task_id"]
    assert miss_once["calls"] == 2


def test_unverified_jwt_cannot_create_tasks(settings):
    user = User(
        id=uuid.uuid4(),
        email="unverified@example.com",
        hashed_password="x",
        is_active=True,
        is_verified=False,
        is_superuser=False,
    )
    principal = TaskPrincipal.from_user(user)
    with pytest.raises(HTTPException) as exc:
        ensure_can_create_tasks(
            principal,
            settings.model_copy(update={"allow_unverified_accounts": False}),
        )
    assert exc.value.status_code == 403
