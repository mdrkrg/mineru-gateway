"""Standalone mock MinerU upstream server for e2e tests.

Runs as a real uvicorn HTTP process.  Behaviour is controllable via
`POST /_mock/configure` and `POST /_mock/reset` so that e2e tests
can simulate upstream errors, unhealthy states, and status transitions
over a real TCP connection.

Usage (manual, for debugging):

```sh
uv run python tests/e2e/mock_server.py --port 9001
```
"""

from __future__ import annotations

import argparse
import uuid
from dataclasses import dataclass, field

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, PlainTextResponse, Response

# ---------------------------------------------------------------------------
# Controllable state (module-level -- the server is a single uvicorn worker)
# ---------------------------------------------------------------------------


@dataclass
class MockState:
    """Mutable state that control endpoints can modify at runtime."""

    health_status: str = "healthy"
    max_concurrent: int = 4
    queued: int = 0
    processing: int = 0
    version: str = "3.4.0"
    protocol_version: int = 2
    completed_tasks: int = 0
    failed_tasks: int = 0
    processing_window_size: int = 64
    health_raises: bool = False
    submit_status: int = 202
    submit_raises: bool = False
    submit_malformed: bool = False
    submit_raw_body: str | None = None
    parse_status: int = 200
    cancel_raises: bool = False
    status_raises: bool = False
    task_status: str = "processing"
    queued_ahead: int | None = None
    result_status_code: int = 200
    result_content_type: str | None = None
    result_content_disposition: str | None = None
    content_validation: bool = True

    submitted: list[dict] = field(default_factory=list)

    def reset(self) -> None:
        self.health_status = "healthy"
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
        self.submit_raises = False
        self.submit_malformed = False
        self.submit_raw_body = None
        self.parse_status = 200
        self.cancel_raises = False
        self.status_raises = False
        self.task_status = "processing"
        self.queued_ahead = None
        self.result_status_code = 200
        self.result_content_type = None
        self.result_content_disposition = None
        self.content_validation = True
        self.submitted.clear()


state = MockState()


# ---------------------------------------------------------------------------
# FastAPI application -- upstream endpoints
# ---------------------------------------------------------------------------

app = FastAPI(title="mock-mineru-e2e")

# ---------------------------------------------------------------------------
# File content validation (matches real mineru-router >= 3.4 behaviour)
# ---------------------------------------------------------------------------

_PDF_MAGIC = b"%PDF-"


def _unsupported_file(filename: str, content: bytes) -> str | None:
    """Return the extension if *content* does not match its MIME magic bytes.

    Mirrors real mineru-router rejection: when content_validation is True
    and a file claims to be PDF but does not start with ``%PDF-``, the
    upstream returns ``400 {"detail": "Unsupported file type: …"}``.
    """
    if not state.content_validation:
        return None
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else filename.lower()
    if ext == "pdf":
        if not content.startswith(_PDF_MAGIC):
            return ext
    return None


@app.get("/health")
async def health():
    """Return health payload. Returns 503 when status != 'healthy'."""
    if state.health_raises:
        raise RuntimeError("upstream unreachable")
    payload = {
        "status": state.health_status,
        "version": state.version,
        "protocol_version": state.protocol_version,
        "max_concurrent_requests": state.max_concurrent,
        "queued_tasks": state.queued,
        "processing_tasks": state.processing,
        "completed_tasks": state.completed_tasks,
        "failed_tasks": state.failed_tasks,
        "processing_window_size": state.processing_window_size,
    }
    if state.health_status != "healthy":
        return JSONResponse(status_code=503, content=payload)
    return payload


@app.post("/tasks")
async def submit_task(request: Request):
    """Accept a multipart task submission, return 202 with a task_id."""
    if state.submit_raises:
        raise RuntimeError("upstream unreachable")
    if state.submit_raw_body is not None:
        return PlainTextResponse(status_code=202, content=state.submit_raw_body)
    form = await request.form()
    form_data: dict = {}
    file_names: list[str] = []
    for name, value in form.multi_items():
        if hasattr(value, "filename") and value.filename:
            file_names.append(value.filename)
            content = (
                value.file.read() if hasattr(value, "file") else await value.read()
            )  # type: ignore[union-attr]
            bad_ext = _unsupported_file(value.filename, content)  # type: ignore[arg-type]
            if bad_ext:
                return JSONResponse(
                    status_code=400,
                    content={"detail": f"Unsupported file type: {bad_ext}"},
                )
        else:
            form_data[name] = str(value)
    state.submitted.append({"file_names": file_names, "form": form_data})
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
    """Synchronous file parse, returns markdown."""
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
    """Return the current task status (controlled by state.task_status)."""
    if state.status_raises:
        raise RuntimeError("status query failed")
    return {"task_id": task_id, "status": state.task_status}


@app.get("/tasks/{task_id}/result")
async def task_result(task_id: str):
    """Return task result content."""
    headers: dict[str, str] = {}
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
    return PlainTextResponse("# result content", status_code=state.result_status_code)


@app.delete("/tasks/{task_id}")
async def cancel_task(task_id: str):
    """Cancel a task. Raises when cancel_raises is True."""
    if state.cancel_raises:
        raise RuntimeError("upstream unreachable")
    return {"task_id": task_id, "status": "cancelled"}


# ---------------------------------------------------------------------------
# Control endpoints (only used by e2e test harness, not by the gateway)
# ---------------------------------------------------------------------------


@app.post("/_mock/reset")
async def mock_reset():
    state.reset()
    return {"ok": True}


@app.post("/_mock/configure")
async def mock_configure(body: dict):
    for key, value in body.items():
        if hasattr(state, key):
            setattr(state, key, value)
    return {"ok": True, "configured": list(body.keys())}


@app.get("/_mock/state")
async def mock_get_state():
    """Return current mock state for debugging."""
    return {
        f: getattr(state, f) for f in state.__dataclass_fields__ if f != "submitted"
    }


# ---------------------------------------------------------------------------
# Entry-point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=9001)
    parser.add_argument("--host", type=str, default="127.0.0.1")
    args = parser.parse_args()
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
