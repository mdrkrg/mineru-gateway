"""Mock MinerU upstream (mineru-api / mineru-router) as an in-process ASGI app.

Wired into the gateway via httpx.ASGITransport in tests — no real network.
Behavior is controllable through the module-level ``state`` so individual tests
can simulate 503 / unhealthy / malformed-response conditions.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, PlainTextResponse


@dataclass
class MockState:
    status: str = "healthy"
    max_concurrent: int = 4
    queued: int = 0
    processing: int = 0
    health_raises: bool = False  # simulate upstream /health being unreachable
    submit_status: int = 202  # status code returned by POST /tasks
    submit_malformed: bool = False  # return 202 without a task_id
    parse_status: int = 200  # status code returned by POST /file_parse
    submitted: list[dict] = field(default_factory=list)

    def reset(self) -> None:
        self.status = "healthy"
        self.max_concurrent = 4
        self.queued = 0
        self.processing = 0
        self.health_raises = False
        self.submit_status = 202
        self.submit_malformed = False
        self.parse_status = 200
        self.submitted.clear()


state = MockState()


def create_mock_upstream() -> FastAPI:
    app = FastAPI(title="mock-mineru")

    @app.get("/health")
    async def health():
        if state.health_raises:
            return JSONResponse(status_code=500, content={"detail": "boom"})
        return {
            "status": state.status,
            "max_concurrent": state.max_concurrent,
            "queued": state.queued,
            "processing": state.processing,
        }

    @app.post("/tasks")
    async def submit_task(request: Request):
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
        return {"task_id": task_id, "status": "processing"}

    @app.get("/tasks/{task_id}/result")
    async def task_result(task_id: str):
        return PlainTextResponse("# result content")

    @app.delete("/tasks/{task_id}")
    async def cancel_task(task_id: str):
        return {"task_id": task_id, "status": "cancelled"}

    return app
