"""Upstream (mineru-router / mineru-api) HTTP client.

The underlying httpx.AsyncClient is created by the app lifespan; tests inject a
client backed by an ASGITransport over the mock upstream app.
"""

from __future__ import annotations

from dataclasses import dataclass

import httpx

from ..config import Settings

# Fixed bounds; only the read timeout is configurable (sync parses send no
# bytes until they finish).
_CONNECT_TIMEOUT = 10.0
_WRITE_TIMEOUT = 120.0
_POOL_TIMEOUT = 30.0
# Probes and async submissions must fail fast; `/tasks` normally returns 202.
_PROBE_READ_TIMEOUT = 10.0
_SUBMIT_READ_TIMEOUT = 30.0

_SUBMIT_TIMEOUT = httpx.Timeout(
    connect=_CONNECT_TIMEOUT,
    read=_SUBMIT_READ_TIMEOUT,
    write=_WRITE_TIMEOUT,
    pool=_POOL_TIMEOUT,
)

# httpx treats timeout=None as "no timeout"; keep a finite default.
_DEFAULT_PROBE_TIMEOUT = httpx.Timeout(
    connect=_CONNECT_TIMEOUT,
    read=_PROBE_READ_TIMEOUT,
    write=_WRITE_TIMEOUT,
    pool=_POOL_TIMEOUT,
)


def build_http_client(settings: Settings) -> httpx.AsyncClient:
    """Create the upstream client with the configured read timeout."""
    timeout = httpx.Timeout(
        connect=_CONNECT_TIMEOUT,
        read=settings.upstream_timeout_read,
        write=_WRITE_TIMEOUT,
        pool=_POOL_TIMEOUT,
    )
    return httpx.AsyncClient(base_url=settings.upstream_url, timeout=timeout)


def build_probe_timeout(settings: Settings) -> httpx.Timeout:
    """Short timeout for probes that must fail fast when upstream hangs."""
    return httpx.Timeout(
        connect=_CONNECT_TIMEOUT,
        read=min(_PROBE_READ_TIMEOUT, settings.upstream_timeout_read),
        write=_WRITE_TIMEOUT,
        pool=_POOL_TIMEOUT,
    )


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
    def __init__(
        self,
        client: httpx.AsyncClient,
        *,
        probe_timeout: httpx.Timeout = _DEFAULT_PROBE_TIMEOUT,
    ) -> None:
        self._client = client
        self._probe_timeout = probe_timeout

    async def get_health(self) -> UpstreamHealth:
        resp = await self._client.get("/health", timeout=self._probe_timeout)
        try:
            data = resp.json()
        except ValueError:
            data = {}
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
        return await self._client.post(
            "/tasks", data=data, files=files, timeout=_SUBMIT_TIMEOUT
        )

    async def parse_file(
        self, data: dict, files: list[tuple[str, tuple[str, bytes, str]]]
    ) -> httpx.Response:
        return await self._client.post("/file_parse", data=data, files=files)

    async def get_task_status(self, upstream_task_id: str) -> httpx.Response:
        return await self._client.get(
            f"/tasks/{upstream_task_id}", timeout=self._probe_timeout
        )

    async def get_task_result(self, upstream_task_id: str) -> httpx.Response:
        return await self._client.get(f"/tasks/{upstream_task_id}/result")

    async def cancel_task(self, upstream_task_id: str) -> httpx.Response:
        return await self._client.delete(
            f"/tasks/{upstream_task_id}", timeout=self._probe_timeout
        )
