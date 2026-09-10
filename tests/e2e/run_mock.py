#!/usr/bin/env python3
"""Start mock upstream + gateway + optional frontend for e2e development.

Usage::

    # Backend only (mock upstream + gateway)
    uv run python tests/e2e/run_mock.py

    # Backend + frontend
    uv run python tests/e2e/run_mock.py --frontend

    # From the frontend/ directory (after merge):
    #   pnpm e2e:mock  (calls ``cd .. && uv run python tests/e2e/run_mock.py --frontend``)

The mock upstream exposes control endpoints the frontend can use to
simulate various upstream states during e2e testing::

    POST http://127.0.0.1:9001/_mock/reset
    POST http://127.0.0.1:9001/_mock/configure    JSON body, e.g. {"task_status":"completed"}
    GET  http://127.0.0.1:9001/_mock/state
"""

from __future__ import annotations

import argparse
import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
from collections.abc import Sequence
from pathlib import Path

# ---------------------------------------------------------------------------
# Port helpers
# ---------------------------------------------------------------------------

_PORTS = {}


def _free_port(name: str = "") -> int:
    """Return an available TCP port, caching it if *name* is given."""
    if name and name in _PORTS:
        return _PORTS[name]
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    if name:
        _PORTS[name] = port
    return port


def _wait_ready(url: str, timeout: float = 20) -> None:
    """Poll *url* until it responds 2xx or raises after *timeout* seconds."""
    import urllib.request

    deadline = time.monotonic() + timeout
    last_err: str | None = None
    while time.monotonic() < deadline:
        try:
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=2) as resp:
                if resp.status < 500:
                    return
            last_err = f"status {resp.status}"
        except Exception as exc:
            last_err = str(exc)
        time.sleep(0.2)
    raise RuntimeError(f"{url} not ready in {timeout}s (last: {last_err})")


# ---------------------------------------------------------------------------
# Process management
# ---------------------------------------------------------------------------

_child_procs: list[subprocess.Popen] = []
_temp_dirs: list[Path] = []


def _start(args: Sequence[str], **popen_kw) -> subprocess.Popen:
    """Start a subprocess, store it for cleanup, return the Popen object."""
    proc = subprocess.Popen(args, **popen_kw)
    _child_procs.append(proc)
    return proc


def _shutdown(sig, _frame) -> None:
    """Forward signal to all children and wait for them."""
    for p in _child_procs:
        if p.poll() is None:
            p.send_signal(sig)
    for p in _child_procs:
        try:
            p.wait(timeout=5)
        except subprocess.TimeoutExpired:
            p.kill()
            p.wait()
    for d in _temp_dirs:
        shutil.rmtree(d, ignore_errors=True)
    raise SystemExit(0)


signal.signal(signal.SIGINT, _shutdown)
signal.signal(signal.SIGTERM, _shutdown)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(description="Mock e2e environment runner")
    parser.add_argument(
        "-F", "--frontend", action="store_true", help="also start frontend dev server"
    )
    parser.add_argument(
        "--port-mock", type=int, default=None, help="mock upstream port (auto)"
    )
    parser.add_argument(
        "--port-gateway", type=int, default=None, help="gateway port (auto)"
    )
    parser.add_argument(
        "--port-smtp", type=int, default=None, help="smtp capture smtp port (auto)"
    )
    parser.add_argument(
        "--port-smtp-control",
        type=int,
        default=None,
        help="smtp capture control port (auto)",
    )
    parser.add_argument(
        "--port-frontend", type=int, default=5173, help="frontend dev server port"
    )
    args = parser.parse_args()

    mock_port = args.port_mock or _free_port("mock")
    gateway_port = args.port_gateway or _free_port("gateway")
    smtp_port = args.port_smtp or _free_port("smtp")
    smtp_control_port = args.port_smtp_control or _free_port("smtp-control")
    mock_url = f"http://127.0.0.1:{mock_port}"
    gateway_url = f"http://127.0.0.1:{gateway_port}"
    smtp_capture_url = f"http://127.0.0.1:{smtp_control_port}"

    root = Path(__file__).resolve().parents[2]
    mock_server = root / "tests" / "e2e" / "mock_server.py"
    smtp_capture_server = root / "tests" / "e2e" / "smtp_capture_server.py"

    # 1. Mock upstream
    print(f"mock upstream   → {mock_url}")
    _start(
        ["uv", "run", "python", str(mock_server), "--port", str(mock_port)],
        stdout=None,
        stderr=None,
    )
    _wait_ready(f"{mock_url}/health")

    # 2. SMTP capture
    print(f"smtp capture    → smtp 127.0.0.1:{smtp_port}, control {smtp_capture_url}")
    _start(
        [
            "uv",
            "run",
            "python",
            str(smtp_capture_server),
            "--smtp-port",
            str(smtp_port),
            "--control-port",
            str(smtp_control_port),
        ],
        stdout=None,
        stderr=None,
    )
    _wait_ready(f"{smtp_capture_url}/health")

    # 3. Gateway (private cwd so a developer's local .env is never loaded)
    print(f"gateway         → {gateway_url}  (→ mock)")
    gateway_cwd = Path(tempfile.mkdtemp(prefix="gateway-mock-"))
    _temp_dirs.append(gateway_cwd)
    _start(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "mineru_gateway.main:create_app",
            "--factory",
            "--host",
            "127.0.0.1",
            "--port",
            str(gateway_port),
        ],
        cwd=str(gateway_cwd),
        env={
            **os.environ,
            "GATEWAY_UPSTREAM_URL": mock_url,
            "GATEWAY_ADMIN_TOKEN": "e2e-admin-token",
            "GATEWAY_CORS_ALLOW_ORIGINS": '["http://localhost:5173"]',
            "GATEWAY_CORS_ALLOW_CREDENTIALS": "true",
            "GATEWAY_CREATE_TABLES": "true",
            "GATEWAY_ENABLE_BACKGROUND": "false",
            "GATEWAY_JSON_LOGS": "false",
            "GATEWAY_SMTP_HOST": "127.0.0.1",
            "GATEWAY_SMTP_PORT": str(smtp_port),
            "GATEWAY_SMTP_FROM": "e2e@example.com",
            "GATEWAY_SMTP_STARTTLS": "false",
            "GATEWAY_SMTP_SSL_TLS": "false",
            "GATEWAY_GATEWAY_URL": gateway_url,
        },
        stdout=None,
        stderr=None,
    )
    _wait_ready(f"{gateway_url}/health")

    # 3. Frontend (optional)
    if args.frontend:
        frontend_dir = root / "frontend"
        if frontend_dir.is_dir() and (frontend_dir / "package.json").exists():
            frontend_url = f"http://localhost:{args.port_frontend}"
            print(f"frontend       → {frontend_url}")
            _start(
                ["pnpm", "dev"],
                cwd=str(frontend_dir),
                env={**os.environ},
                stdout=None,
                stderr=None,
            )
        else:
            print("frontend       — skipped (no frontend/ directory)")

    # 4. Print summary
    print()
    print("────────────────────────────────────────────")
    print("  mock upstream   ", mock_url)
    print("  smtp capture    ", smtp_capture_url)
    print("  gateway         ", gateway_url)
    print("  mock control    ", f"{mock_url}/_mock/configure")
    print("  mock health     ", f"{mock_url}/health")
    print("  smtp health     ", f"{smtp_capture_url}/health")
    print("  smtp inbox      ", f"{smtp_capture_url}/emails")
    print("  gateway health  ", f"{gateway_url}/health")
    if args.frontend:
        print("  frontend        ", f"http://localhost:{args.port_frontend}")
    print("────────────────────────────────────────────")
    print("  API key create:")
    print(
        f"    curl -X POST {gateway_url}/auth/keys "
        f'-H "X-Admin-Token: e2e-admin-token" '
        f'-H "Content-Type: application/json" '
        f'\'{{"label":"e2e"}}\''
    )
    print()
    print("  mock control examples:")
    print(f"    curl -X POST {mock_url}/_mock/configure \\")
    print('      -H "Content-Type: application/json" \\')
    print("      -d " + "'" + r'{"task_status":"completed"}' + "'")
    print()
    print("  Ctrl+C to stop all services")
    print("────────────────────────────────────────────")
    print("  Full mock API reference: docs/mock-upstream.md")

    # 5. Wait for any child to exit
    while True:
        for p in _child_procs:
            if p.poll() is not None:
                _shutdown(signal.SIGTERM, None)
                return
        time.sleep(0.5)


if __name__ == "__main__":
    main()
