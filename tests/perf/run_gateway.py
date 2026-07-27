"""Gateway subprocess runner for perf tests.

Usage:
    # With mock upstream (local):
    python tests/perf/run_gateway.py --port 9000 --upstream-port 9001 \
        --max-upload-size 200000000 --cache-dir /tmp/perf-cache

    # With real backend:
    python tests/perf/run_gateway.py --port 9000 \
        --upstream-url https://your-upstream.example.com \
        --max-upload-size 200000000 --cache-dir /tmp/perf-cache
"""

from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "src"))

import httpx
import uvicorn

from mineru_gateway import models  # noqa: F401
from mineru_gateway.config import Settings
from mineru_gateway.main import create_app


def main() -> None:
    p = argparse.ArgumentParser(description="Gateway perf runner")
    p.add_argument("--port", type=int, required=True)
    upstream_group = p.add_mutually_exclusive_group(required=True)
    upstream_group.add_argument(
        "--upstream-port", type=int, help="Local upstream port (mock)"
    )
    upstream_group.add_argument(
        "--upstream-url", type=str, help="Full upstream URL (real backend)"
    )
    p.add_argument("--max-upload-size", type=int, required=True)
    p.add_argument("--cache-dir", type=str, required=True)
    args = p.parse_args()

    os.makedirs(args.cache_dir, exist_ok=True)
    db_path = os.path.join(args.cache_dir, "perf.db")
    upstream_url = args.upstream_url or f"http://127.0.0.1:{args.upstream_port}"
    settings = Settings(
        upstream_url=upstream_url,
        database_url=f"sqlite+aiosqlite:///{db_path}",
        admin_token="perf-token",
        gateway_url=f"http://127.0.0.1:{args.port}",
        max_upload_size=args.max_upload_size,
        file_cache_dir=args.cache_dir,
        enable_background=False,
        create_tables=True,
        json_logs=False,
    )
    upstream_client = httpx.AsyncClient(base_url=settings.upstream_url)
    app = create_app(settings=settings, upstream_client=upstream_client)
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
