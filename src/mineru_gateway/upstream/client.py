"""Upstream (mineru-router / mineru-api) HTTP client for the 4.0 V1 API.

The underlying httpx.AsyncClient is created by the app lifespan; tests inject a
client backed by an ASGITransport over the mock upstream app.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import httpx

from ..config import Settings

# Fixed bounds; only the read timeout is configurable (sync parses send no
# bytes until they finish).
_CONNECT_TIMEOUT = 10.0
_WRITE_TIMEOUT = 120.0
_POOL_TIMEOUT = 30.0
# Probes and async submissions must fail fast; `/v1/tasks` normally returns 202.
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

_API = "/v1"


def build_http_client(settings: Settings) -> httpx.AsyncClient:
    """Create the upstream client with the configured read timeout.

    MinerU 4.0 services can require ``Authorization: Bearer`` (``--api-key``);
    the same header is sent to every upstream call when configured.
    """
    timeout = httpx.Timeout(
        connect=_CONNECT_TIMEOUT,
        read=settings.upstream_timeout_read,
        write=_WRITE_TIMEOUT,
        pool=_POOL_TIMEOUT,
    )
    headers = {}
    if settings.upstream_api_key:
        headers["Authorization"] = f"Bearer {settings.upstream_api_key}"
    return httpx.AsyncClient(
        base_url=settings.upstream_url, timeout=timeout, headers=headers
    )


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
    """Normalised V1 health.

    4.0 reports ``status="ok"`` plus the deployment's capabilities; there is no
    queue/concurrency accounting anymore.  ``status`` is normalised to the
    gateway's ``healthy`` / ``degraded`` vocabulary.
    """

    status: str
    version: str = ""
    features: dict = field(default_factory=dict)


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
        resp = await self._client.get(f"{_API}/health", timeout=self._probe_timeout)
        try:
            data = resp.json()
        except ValueError:
            data = {}
        raw_status = str(data.get("status") or "")
        healthy = resp.status_code == 200 and raw_status == "ok"
        features = data.get("features")
        return UpstreamHealth(
            status="healthy" if healthy else "degraded",
            version=str(data.get("version") or ""),
            features=features if isinstance(features, dict) else {},
        )

    async def submit_task(
        self, params: dict, files: list[tuple[str, tuple[str, bytes, str]]]
    ) -> httpx.Response:
        return await self._client.post(
            f"{_API}/tasks", params=params, files=files, timeout=_SUBMIT_TIMEOUT
        )

    async def parse_file(
        self, params: dict, files: list[tuple[str, tuple[str, bytes, str]]]
    ) -> httpx.Response:
        return await self._client.post(f"{_API}/file_parse", params=params, files=files)

    async def get_task_status(self, upstream_task_id: str) -> httpx.Response:
        return await self._client.get(
            f"{_API}/tasks/{upstream_task_id}", timeout=self._probe_timeout
        )

    async def get_task_result(
        self, upstream_task_id: str, *, response_format: str | None = None
    ) -> httpx.Response:
        params = {"response_format": response_format} if response_format else None
        return await self._client.get(
            f"{_API}/tasks/{upstream_task_id}/result", params=params
        )

    async def cancel_task(self, upstream_task_id: str) -> httpx.Response:
        return await self._client.delete(
            f"{_API}/tasks/{upstream_task_id}", timeout=self._probe_timeout
        )
