"""Upstream (mineru-router / mineru-api) HTTP client.

The underlying httpx.AsyncClient is created by the app lifespan; tests inject a
client backed by an ASGITransport over the mock upstream app.
"""

from __future__ import annotations

from dataclasses import dataclass

import httpx


@dataclass
class UpstreamHealth:
    status: str
    max_concurrent: int
    queued: int
    processing: int
    version: str = ""
    protocol_version: int | None = None
    completed: int = 0
    failed: int = 0
    processing_window_size: int | None = None

    @property
    def free_slots(self) -> int:
        return self.max_concurrent - self.queued - self.processing


class UpstreamClient:
    def __init__(self, client: httpx.AsyncClient) -> None:
        self._client = client

    async def get_health(self) -> UpstreamHealth:
        resp = await self._client.get("/health")
        data = resp.json() if resp.status_code != 500 else {}
        return UpstreamHealth(
            status=data.get("status", "unknown"),
            max_concurrent=data.get(
                "max_concurrent_requests", data.get("max_concurrent", 0)
            ),
            queued=data.get("queued_tasks", data.get("queued", 0)),
            processing=data.get("processing_tasks", data.get("processing", 0)),
            version=data.get("version", ""),
            protocol_version=data.get("protocol_version"),
            completed=data.get("completed_tasks", 0),
            failed=data.get("failed_tasks", 0),
            processing_window_size=data.get("processing_window_size"),
        )

    async def submit_task(
        self, data: dict, files: list[tuple[str, tuple[str, bytes, str]]]
    ) -> httpx.Response:
        return await self._client.post("/tasks", data=data, files=files)

    async def parse_file(
        self, data: dict, files: list[tuple[str, tuple[str, bytes, str]]]
    ) -> httpx.Response:
        return await self._client.post("/file_parse", data=data, files=files)

    async def get_task_status(self, upstream_task_id: str) -> httpx.Response:
        return await self._client.get(f"/tasks/{upstream_task_id}")

    async def get_task_result(self, upstream_task_id: str) -> httpx.Response:
        return await self._client.get(f"/tasks/{upstream_task_id}/result")

    async def cancel_task(self, upstream_task_id: str) -> httpx.Response:
        return await self._client.delete(f"/tasks/{upstream_task_id}")
