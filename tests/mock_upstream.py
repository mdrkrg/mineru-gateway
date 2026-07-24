"""Mock MinerU upstream (mineru-api / mineru-router) as an in-process ASGI app.

Wired into the gateway via httpx.ASGITransport in tests — no real network.
Behavior is controllable through the module-level ``state`` so individual tests
can simulate 503 / unhealthy / malformed-response conditions.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, PlainTextResponse, Response


@dataclass
class MockState:
    status: str = "healthy"
    max_concurrent: int = 4
    queued: int = 0
    processing: int = 0
    version: str = "3.4.0"
    protocol_version: int = 2
    completed_tasks: int = 0
    failed_tasks: int = 0
    processing_window_size: int = 64
    health_raises: bool = False  # simulate upstream /health being unreachable
    submit_status: int = 202  # status code returned by POST /tasks
    submit_malformed: bool = False  # return 202 without a task_id
    parse_status: int = 200  # status code returned by POST /file_parse
    cancel_raises: bool = False  # simulate DELETE /tasks/{id} being unreachable
    submit_raises: bool = False  # simulate POST /tasks connection failure
    status_raises: bool = False  # simulate GET /tasks/{id} failure
    task_status: str = "processing"  # status reported by GET /tasks/{id}
    queued_ahead: int | None = None  # queued_ahead in submit 202 response
    submitted: list[dict] = field(default_factory=list)

    # Per-task result overrides for GET /tasks/{id}/result
    # Key: upstream_task_id -> {"status_code": int, "content": bytes, "headers": dict}
    result_status_code: int = 200
    result_content_type: str | None = None
    result_content_disposition: str | None = None
    task_result_overrides: dict = field(default_factory=dict)

    def reset(self) -> None:
        self.status = "healthy"
        self.max_concurrent = 4
        self.queued = 0
        self.processing = 0
        self.version = "3.4.0"
        self.protocol_version = 2
        self.completed_tasks = 0
        self.failed_tasks = 0
        self.processing_window_size = 64
        self.health_raises = False
        self.submit_status = 202
        self.submit_malformed = False
        self.parse_status = 200
        self.cancel_raises = False
        self.submit_raises = False
        self.status_raises = False
        self.task_status = "processing"
        self.queued_ahead = None
        self.submitted.clear()
        self.result_status_code = 200
        self.result_content_type = None
        self.result_content_disposition = None
        self.task_result_overrides.clear()


state = MockState()


def create_mock_upstream() -> FastAPI:
    app = FastAPI(title="mock-mineru")

    @app.get("/health")
    async def health():
        if state.health_raises:
            raise RuntimeError("upstream unreachable")
        payload = {
            "status": state.status,
            "version": state.version,
            "protocol_version": state.protocol_version,
            "max_concurrent_requests": state.max_concurrent,
            "queued_tasks": state.queued,
            "processing_tasks": state.processing,
            "completed_tasks": state.completed_tasks,
            "failed_tasks": state.failed_tasks,
            "processing_window_size": state.processing_window_size,
        }
        if state.status != "healthy":
            return JSONResponse(status_code=503, content=payload)
        return payload

    @app.post("/tasks")
    async def submit_task(request: Request):
        if state.submit_raises:
            raise RuntimeError("upstream unreachable")
        form = await request.form()
        file_names = [
            v.filename
            for _, v in form.multi_items()
            if hasattr(v, "filename") and v.filename
        ]
        state.submitted.append({"file_names": file_names})
        if state.submit_status != 202:
            return JSONResponse(
                status_code=state.submit_status, content={"detail": "upstream error"}
            )
        if state.submit_malformed:
            return JSONResponse(status_code=202, content={"status": "pending"})
        return JSONResponse(
            status_code=202,
            content={
                "task_id": f"up-{uuid.uuid4().hex[:12]}",
                "status": "pending",
                "file_names": file_names,
                "queued_ahead": state.queued_ahead,
            },
        )

    @app.post("/file_parse")
    async def parse_file(request: Request):
        await request.form()
        if state.parse_status != 200:
            return JSONResponse(
                status_code=state.parse_status, content={"detail": "upstream error"}
            )
        return JSONResponse(
            status_code=200,
            content={"markdown": "# parsed", "status": "completed"},
        )

    @app.get("/tasks/{task_id}")
    async def task_status(task_id: str):
        if state.status_raises:
            raise RuntimeError("status query failed")
        return {"task_id": task_id, "status": state.task_status}

    @app.get("/tasks/{task_id}/result")
    async def task_result(task_id: str):
        override = state.task_result_overrides.get(task_id)
        if override:
            headers = dict(override.get("headers", {}))
            return Response(
                content=override.get("content", b"# result content"),
                status_code=override.get("status_code", 200),
                headers=headers,
                media_type=headers.get("content-type"),
            )

        headers = {}
        if state.result_content_type:
            headers["content-type"] = state.result_content_type
        if state.result_content_disposition:
            headers["content-disposition"] = state.result_content_disposition

        if headers:
            return Response(
                content=b"# result content",
                status_code=state.result_status_code,
                headers=headers,
                media_type=state.result_content_type,
            )
        return PlainTextResponse(
            "# result content", status_code=state.result_status_code
        )

    @app.delete("/tasks/{task_id}")
    async def cancel_task(task_id: str):
        if state.cancel_raises:
            raise RuntimeError("upstream unreachable")
        return {"task_id": task_id, "status": "cancelled"}

    return app
