"""Shared fixtures for mineru-gateway e2e tests.

Spawns a standalone mock MinerU upstream and the gateway itself as real
uvicorn subprocesses.
Tests talk to the gateway over real HTTP (`httpx.AsyncClient`) so we exercise
real TCP serialisation, multipart encoding, and connection handling.

The mock upstream runs as a session-scoped fixture (shared by all tests).
Each test gets its own gateway instance (function-scoped) because some tests
need different `max_concurrent_tasks` / `rate_limit_per_key`
/ `max_upload_size` values.
"""

from __future__ import annotations

import os
import signal
import socket
import subprocess
import time
from pathlib import Path
from typing import Any

import httpx
import pytest

# ---------------------------------------------------------------------------
# Port utilities
# ---------------------------------------------------------------------------


def _free_port() -> int:
    """Return an available TCP port on localhost."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _wait_ready(url: str, timeout: float = 15.0) -> None:
    """Poll `url` until it responds 2xx, or raise after `timeout` seconds."""
    deadline = time.monotonic() + timeout
    last_err: str | None = None
    while time.monotonic() < deadline:
        try:
            r = httpx.get(f"{url}/health", timeout=2)
            if r.status_code < 500:
                return
            last_err = f"status {r.status_code}"
        except httpx.RequestError as exc:
            last_err = str(exc)
        time.sleep(0.15)
    raise RuntimeError(
        f"service at {url} not ready within {timeout}s (last: {last_err})"
    )


# ---------------------------------------------------------------------------
# Mock upstream (session scope -- one process for all e2e tests)
# ---------------------------------------------------------------------------

_MOCK_SERVER_PATH = Path(__file__).resolve().parent / "mock_server.py"


@pytest.fixture(scope="session")
def mock_upstream_url():
    """Start the standalone mock MinerU upstream subprocess.

    Returns the base URL (`http://127.0.0.1:{port}`).  The process is
    shared by all tests in the session and terminated when the session
    ends.
    """
    port = _free_port()
    proc = subprocess.Popen(
        [
            "uv",
            "run",
            "python",
            str(_MOCK_SERVER_PATH),
            "--port",
            str(port),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    url = f"http://127.0.0.1:{port}"
    try:
        _wait_ready(url)
        yield url
    finally:
        proc.send_signal(signal.SIGTERM)
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()


# ---------------------------------------------------------------------------
# Mock control helper
# ---------------------------------------------------------------------------


class MockControl:
    """Manage the mock upstream's behaviour via its `/_mock/*` endpoints.

    Each method issues an HTTP call to the mock server's control API.
    Call `reset()` at the start of every test to get predictable
    defaults.
    """

    def __init__(self, base_url: str):
        self._url = base_url

    def reset(self) -> None:
        with httpx.Client() as c:
            c.post(f"{self._url}/_mock/reset", timeout=5)

    def configure(self, **kwargs: Any) -> None:
        with httpx.Client() as c:
            c.post(f"{self._url}/_mock/configure", json=kwargs, timeout=5)

    def set_health_raises(self) -> None:
        self.configure(health_raises=True)

    def set_submit_raises(self) -> None:
        self.configure(submit_raises=True)

    def set_status_raises(self) -> None:
        self.configure(status_raises=True)

    def set_cancel_raises(self) -> None:
        self.configure(cancel_raises=True)

    def set_task_status(self, status: str) -> None:
        self.configure(task_status=status)

    def set_submit_status(self, code: int) -> None:
        self.configure(submit_status=code)

    def set_unhealthy(self) -> None:
        self.configure(health_status="degraded")


@pytest.fixture
def mock_control(mock_upstream_url):
    """Return a `MockControl` bound to the shared mock upstream.

    Resets the mock state before and after the test so every test
    starts from a clean slate.
    """
    ctrl = MockControl(mock_upstream_url)
    ctrl.reset()
    yield ctrl
    ctrl.reset()


# ---------------------------------------------------------------------------
# Gateway subprocess utilities
# ---------------------------------------------------------------------------


def _gateway_env(
    upstream_url: str,
    gateway_url: str,
    db_path: str,
    cache_dir: str,
    **overrides: str,
) -> dict[str, str]:
    """Build the environment dict for a gateway subprocess."""
    env: dict[str, str] = {
        "GATEWAY_UPSTREAM_URL": upstream_url,
        "GATEWAY_DATABASE_URL": f"sqlite+aiosqlite:///{db_path}",
        "GATEWAY_ADMIN_TOKEN": "e2e-admin-token",
        "GATEWAY_ALLOW_ANONYMOUS": "false",
        "GATEWAY_GATEWAY_URL": gateway_url,
        "GATEWAY_FILE_CACHE_DIR": cache_dir,
        "GATEWAY_ENABLE_BACKGROUND": "false",
        "GATEWAY_JSON_LOGS": "false",
        "GATEWAY_CREATE_TABLES": "true",
        "GATEWAY_MAX_UPLOAD_SIZE": "1048576",
        "GATEWAY_RATE_LIMIT_PER_KEY": "10",
        "GATEWAY_MAX_CONCURRENT_TASKS": "0",
    }
    env.update(overrides)
    return env


def _start_gateway(
    upstream_url: str,
    db_path: str,
    cache_dir: str,
    *,
    port: int | None = None,
    **overrides: str,
) -> tuple[str, subprocess.Popen]:
    """Start a gateway subprocess, return `(url, proc)`.

    Caller is responsible for terminating the process after use.
    """
    port = port or _free_port()
    gateway_url = f"http://127.0.0.1:{port}"
    env = _gateway_env(upstream_url, gateway_url, db_path, cache_dir, **overrides)

    # Preserve non-GATEWAY_ parent vars but let explicit overrides win.
    parent_env = {k: v for k, v in os.environ.items() if not k.startswith("GATEWAY_")}

    # Capture stderr to a temporary pipe so we can include diagnostics
    # in the error message when startup fails.
    stderr_pipe = subprocess.PIPE
    proc = subprocess.Popen(
        [
            "uv",
            "run",
            "uvicorn",
            "mineru_gateway.main:create_app",
            "--factory",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
        ],
        env={**parent_env, **env},
        stdout=subprocess.DEVNULL,
        stderr=stderr_pipe,
    )
    try:
        _wait_ready(f"{gateway_url}/health")
    except Exception as exc:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
        stderr_tail = ""
        if proc.stderr is not None:
            try:
                stderr_tail = proc.stderr.read(2048).decode(errors="replace")
            except Exception:
                pass
        raise RuntimeError(
            f"gateway at {gateway_url} failed to start: {exc}"
            f"{' - stderr: ' + stderr_tail if stderr_tail else ''}"
        ) from exc
    return gateway_url, proc


# ---------------------------------------------------------------------------
# E2E client fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def e2e_gateway_url(mock_upstream_url, tmp_path):
    """Default gateway instance for e2e tests.

    Uses standard settings.  Each test gets a fresh gateway process
    with its own SQLite DB and cache directory.
    """
    db_path = str(tmp_path / "gateway.db")
    cache_dir = str(tmp_path / "cache")
    os.makedirs(cache_dir, exist_ok=True)
    port = _free_port()
    url, proc = _start_gateway(mock_upstream_url, db_path, cache_dir, port=port)
    yield url
    proc.send_signal(signal.SIGTERM)
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()


@pytest.fixture
async def e2e_client(e2e_gateway_url):
    """`httpx.AsyncClient` pointed at the gateway (real HTTP)."""
    async with httpx.AsyncClient(base_url=e2e_gateway_url) as client:
        yield client


@pytest.fixture
def e2e_admin_headers() -> dict[str, str]:
    return {"X-Admin-Token": "e2e-admin-token"}


@pytest.fixture
async def e2e_api_key(e2e_client, e2e_admin_headers):
    """Create an API key via the admin token and return it."""
    resp = await e2e_client.post(
        "/auth/keys", json={"label": "e2e"}, headers=e2e_admin_headers
    )
    assert resp.status_code == 201, f"failed to create API key: {resp.text}"
    return resp.json()["api_key"]


@pytest.fixture
def e2e_key_headers(e2e_api_key) -> dict[str, str]:
    return {"X-API-Key": e2e_api_key}


# ---------------------------------------------------------------------------
# Test data
# ---------------------------------------------------------------------------

# A minimal but structurally valid PDF that real mineru-router (>=3.4)
# accepts via content sniffing.  Taken from tests/perf/locustfile.py.
_MINIMAL_PDF = (
    b"%PDF-1.4\n"
    b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
    b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]"
    b"/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n"
    b"4 0 obj<</Length 44>>stream\n"
    b"BT /F1 12 Tf 100 700 Td (Hello) Tj ET\n"
    b"endstream\nendobj\n"
    b"5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n"
    b"xref\n0 6\n"
    b"0000000000 65535 f \n"
    b"0000000009 00000 n \n"
    b"0000000058 00000 n \n"
    b"0000000115 00000 n \n"
    b"0000000266 00000 n \n"
    b"0000000360 00000 n \n"
    b"trailer<</Size 6/Root 1 0 R>>\n"
    b"startxref\n418\n"
    b"%%EOF\n"
)


@pytest.fixture(scope="session")
def sample_pdf_path(tmp_path_factory):
    """Return the path to a valid minimal PDF for real-upstream tests.

    Uses the committed `tests/test_data/minimal.pdf` rather than
    generating one from byte-string, so the file is versioned and
    identical across test runs.
    """
    import shutil

    src = Path(__file__).resolve().parents[1] / "test_data" / "minimal.pdf"
    p = tmp_path_factory.mktemp("test_data") / "minimal.pdf"
    shutil.copy2(str(src), str(p))
    return str(p)


def sample_files(pdf_bytes: bytes | None = None) -> list[tuple]:
    """Return a `files` list suitable for `httpx.post(files=...)`."""
    content = pdf_bytes if pdf_bytes is not None else _MINIMAL_PDF
    return [("files", ("doc.pdf", content, "application/pdf"))]
