"""Locust load test for MinerU Gateway - all endpoints with mock upstream.

Usage:
    # Start mock upstream and gateway first, then:
    locust -f tests/perf/locustfile.py \
        --host http://127.0.0.1:9000 \
        --headless -u 50 -r 10 -t 60s \
        --csv=perf-results --html=perf-results.html

    # Or with web UI:
    locust -f tests/perf/locustfile.py --host http://127.0.0.1:9000

Expected setup (in separate terminals):
    python tests/perf/mock_upstream.py --port 9001
    python tests/perf/run_gateway.py --port 9000 --upstream-port 9001 \\
        --max-upload-size 524288000 --cache-dir /tmp/perf-cache
"""

from __future__ import annotations

import random
import uuid

from locust import HttpUser, between, task

# Minimal valid PDF that upstream (mineru-router >=3.4) accepts by content sniffing.
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


def _api_key(user) -> str:
    if not hasattr(user, "_cached_key"):
        resp = user.client.post(
            "/auth/keys",
            json={"label": f"load-{uuid.uuid4().hex[:6]}"},
            headers={"X-Admin-Token": "perf-token"},
        )
        if resp.status_code == 201:
            user._cached_key = resp.json()["api_key"]
        else:
            user._cached_key = "invalid"
    return user._cached_key


def _small_file():
    return [("files", ("tiny.pdf", _MINIMAL_PDF, "application/pdf"))]


class GatewayUser(HttpUser):
    """Simulates mixed workload against MinerU Gateway."""

    wait_time = between(0.1, 1.0)

    def on_start(self):
        self.key = _api_key(self)
        self._submitted_task_ids: list[str] = []

    # ------------------------------------------------------------------
    # Streaming upload: large file (weight 5)
    # ------------------------------------------------------------------

    @task(5)
    def streaming_upload(self):
        """POST /tasks - streaming upload of ~10 MB PDF."""
        payload = _MINIMAL_PDF + b"0" * (10 * 1024 * 1024 - len(_MINIMAL_PDF))
        files = [
            ("files", ("large.pdf", payload, "application/pdf")),
        ]
        resp = self.client.post(
            "/tasks",
            headers={"X-API-Key": self.key},
            files=files,
            data={"backend": "pipeline"},
            timeout=120,
        )
        if resp.status_code == 202:
            tid = resp.json().get("task_id")
            if tid and len(self._submitted_task_ids) < 20:
                self._submitted_task_ids.append(tid)

    # ------------------------------------------------------------------
    # Small file upload: regression baseline (weight 20)
    # ------------------------------------------------------------------

    @task(20)
    def small_upload(self):
        """POST /tasks - tiny file (< 1 KB)."""
        resp = self.client.post(
            "/tasks",
            headers={"X-API-Key": self.key},
            files=_small_file(),
            data={"backend": "pipeline"},
            timeout=30,
        )
        if resp.status_code == 202:
            tid = resp.json().get("task_id")
            if tid and len(self._submitted_task_ids) < 20:
                self._submitted_task_ids.append(tid)

    # ------------------------------------------------------------------
    # File parse: synchronous endpoint (weight 10)
    # ------------------------------------------------------------------

    @task(10)
    def file_parse(self):
        """POST /file_parse - synchronous file parsing."""
        self.client.post(
            "/file_parse",
            headers={"X-API-Key": self.key},
            files=_small_file(),
            data={"backend": "pipeline"},
            timeout=30,
        )

    # ------------------------------------------------------------------
    # Task status polling (weight 15)
    # ------------------------------------------------------------------

    @task(15)
    def task_status(self):
        """GET /tasks/{id} - poll status of a previously submitted task."""
        tid = (
            random.choice(self._submitted_task_ids)
            if self._submitted_task_ids
            else None
        )
        if not tid:
            self.client.get("/health")
            return
        self.client.get(
            f"/tasks/{tid}",
            headers={"X-API-Key": self.key},
            name="/tasks/{id}",
            timeout=10,
        )

    # ------------------------------------------------------------------
    # Batch result-zip download (weight 5)
    # ------------------------------------------------------------------

    @task(5)
    def result_zip(self):
        """POST /tasks/result-zip - batch download of task results."""
        tids = list(self._submitted_task_ids[:3])
        if not tids:
            self.client.get("/health")
            return
        self.client.post(
            "/tasks/result-zip",
            json={"task_ids": tids},
            headers={"X-API-Key": self.key},
            name="/tasks/result-zip",
            timeout=30,
        )

    # ------------------------------------------------------------------
    # Health check (weight 5)
    # ------------------------------------------------------------------

    @task(5)
    def health_check(self):
        """GET /health - upstream health gating check."""
        self.client.get("/health", timeout=5)

    # ------------------------------------------------------------------
    # Idempotent replay (weight 3)
    # ------------------------------------------------------------------

    @task(3)
    def idempotent_replay(self):
        """POST /tasks with X-Idempotency-Key - replays from existing key."""
        idem_key = uuid.uuid4().hex
        headers = {
            "X-API-Key": self.key,
            "X-Idempotency-Key": idem_key,
        }
        # First submission
        self.client.post(
            "/tasks",
            headers=headers,
            files=_small_file(),
            timeout=30,
        )
        # Replay - should hit idempotency cache
        self.client.post(
            "/tasks",
            headers=headers,
            files=_small_file(),
            timeout=30,
        )

    # ------------------------------------------------------------------
    # Task list (weight 2)
    # ------------------------------------------------------------------

    @task(2)
    def task_list(self):
        """GET /tasks - list tasks."""
        self.client.get(
            "/tasks",
            headers={"X-API-Key": self.key},
            params={"status": "pending"},
            timeout=10,
        )
