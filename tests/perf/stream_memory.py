"""Streaming upload memory verification.

spec: streaming-upload.md sec 0 Goal 1, sec 6.2 S5

Spawns the gateway and mock upstream as subprocesses, uploads a large
multipart file over a real HTTP connection, and verifies that the
gateway process RSS stays bounded (peak increase < 20 MB) regardless
of uploaded file size.

Usage:
    python tests/perf/stream_memory.py [--file-size-mb 100]
"""

from __future__ import annotations

import argparse
import os
import signal
import subprocess
import sys
import tempfile
import threading
import time
import uuid

import httpx
import psutil


def _free_port() -> int:
    import socket

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _wait_ready(url: str, timeout: float = 10.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            httpx.get(url + "/health", timeout=1)
            return
        except httpx.RequestError:
            time.sleep(0.1)
    raise RuntimeError(f"service at {url} did not become ready within {timeout}s")


def _rss_sampler(proc: psutil.Process, interval: float, samples_out: list[int]) -> None:
    while True:
        try:
            samples_out.append(proc.memory_info().rss)
        except psutil.NoSuchProcess:
            return
        time.sleep(interval)


def main() -> None:
    parser = argparse.ArgumentParser(description="Streaming upload memory verification")
    parser.add_argument("--file-size-mb", type=int, default=100)
    args = parser.parse_args()

    file_size_mb = args.file_size_mb
    file_bytes = file_size_mb * 1024 * 1024
    cache_dir = os.path.join(tempfile.gettempdir(), f"perf-cache-{uuid.uuid4().hex}")

    # Find helper scripts relative to this file
    perf_dir = os.path.dirname(os.path.abspath(__file__))
    run_gateway = os.path.join(perf_dir, "run_gateway.py")
    mock_upstream = os.path.join(perf_dir, "mock_upstream.py")

    upstream_port = _free_port()
    gateway_port = _free_port()

    # Start mock upstream
    upstream_proc = subprocess.Popen(
        [sys.executable, mock_upstream, "--port", str(upstream_port)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    upstream_url = f"http://127.0.0.1:{upstream_port}"
    _wait_ready(upstream_url + "/health")

    # Start gateway
    gateway_proc = subprocess.Popen(
        [
            sys.executable,
            run_gateway,
            "--port",
            str(gateway_port),
            "--upstream-port",
            str(upstream_port),
            "--max-upload-size",
            str(file_bytes * 2),
            "--cache-dir",
            cache_dir,
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    gateway_url = f"http://127.0.0.1:{gateway_port}"
    _wait_ready(gateway_url + "/health")

    try:
        # Create API key
        resp = httpx.post(
            f"{gateway_url}/auth/keys",
            json={"label": "perf-test"},
            headers={"X-Admin-Token": "perf-token"},
        )
        resp.raise_for_status()
        api_key = resp.json()["api_key"]

        # Generate large file
        payload = os.urandom(file_bytes)
        files = [
            ("files", ("perf-data.bin", payload, "application/octet-stream")),
        ]
        data = {"backend": "pipeline"}

        # Start RSS sampler thread
        proc = psutil.Process(gateway_proc.pid)
        samples: list[int] = []
        sampler = threading.Thread(
            target=_rss_sampler, args=(proc, 0.05, samples), daemon=True
        )
        # Warm up: collect a baseline
        time.sleep(0.3)
        sampler.start()

        # Upload
        upload_start = time.monotonic()
        resp = httpx.post(
            f"{gateway_url}/tasks",
            headers={"X-API-Key": api_key},
            files=files,
            data=data,
            timeout=600,
        )
        elapsed = time.monotonic() - upload_start

        if resp.status_code != 202:
            print(f"FAIL: expected 202, got {resp.status_code}: {resp.text[:200]}")
            sys.exit(1)

        # Give sampler a moment to collect final sample
        time.sleep(0.2)

        # Analyse
        if len(samples) < 2:
            print("FAIL: insufficient RSS samples")
            sys.exit(1)

        baseline = samples[0]
        peak = max(samples)
        delta_mb = (peak - baseline) / (1024 * 1024)
        max_allowed_mb = 20

        print(f"File size        : {file_size_mb} MB")
        print(f"Upload duration  : {elapsed:.2f}s")
        print(f"RSS baseline     : {baseline / (1024 * 1024):.1f} MB")
        print(f"RSS peak         : {peak / (1024 * 1024):.1f} MB")
        print(f"RSS delta        : {delta_mb:.1f} MB")
        print(f"Threshold        : {max_allowed_mb} MB")
        print(f"Samples          : {len(samples)}")

        if delta_mb > max_allowed_mb:
            print(
                f"FAIL: RSS delta {delta_mb:.1f} MB "
                f"exceeds {max_allowed_mb} MB threshold"
            )
            sys.exit(1)

        print("PASS: RSS delta within threshold")
    finally:
        gateway_proc.send_signal(signal.SIGTERM)
        upstream_proc.send_signal(signal.SIGTERM)
        gateway_proc.wait(timeout=5)
        upstream_proc.wait(timeout=5)


if __name__ == "__main__":
    main()
