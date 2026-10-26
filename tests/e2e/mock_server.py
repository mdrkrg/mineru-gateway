"""Standalone mock MinerU 4.0 upstream server for e2e tests.

Runs as a uvicorn HTTP process. Behaviour is controllable via
`POST /_mock/configure` and `POST /_mock/reset` so that e2e tests
can simulate upstream errors, unhealthy states, and status transitions
over a real TCP connection.

The upstream contract mirrors MinerU 4.0's V1 API: parse options are query
parameters, multipart bodies only carry `files` parts, and jobs use the
queued/running/completed/partial/failed/canceled vocabulary.

Usage (manual, for debugging):

```sh
uv run python tests/e2e/mock_server.py --port 9001
```
"""

from __future__ import annotations

import argparse
import sys
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, PlainTextResponse, Response

_ROOT = Path(__file__).resolve().parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from tests.mock_v1_contract import (  # noqa: E402
    canceled_payload,
    default_features,
    error_payload,
    health_payload,
    inline_result_payload,
    job_payload,
)

# ---------------------------------------------------------------------------
# Controllable state (module-level - the server is a single uvicorn worker)
# ---------------------------------------------------------------------------


@dataclass
class MockState:
    """Mutable state that control endpoints can modify at runtime."""

    health_status: str = "healthy"
    version: str = "4.0.12"
    features: dict = field(default_factory=default_features)
    health_raises: bool = False
    submit_status: int = 202
    submit_raises: bool = False
    submit_malformed: bool = False
    submit_raw_body: str | None = None
    parse_status: int = 200
    cancel_raises: bool = False
    status_raises: bool = False
    task_status: str = "running"
    task_error: dict | None = None
    result_status_code: int = 200
    result_content_type: str | None = None
    result_content_disposition: str | None = None
    content_validation: bool = True

    submitted: list[dict] = field(default_factory=list)

    def reset(self) -> None:
        self.health_status = "healthy"
        self.version = "4.0.12"
        self.features = default_features()
        self.health_raises = False
        self.submit_status = 202
        self.submit_raises = False
        self.submit_malformed = False
        self.submit_raw_body = None
        self.parse_status = 200
        self.cancel_raises = False
        self.status_raises = False
        self.task_status = "running"
        self.task_error = None
        self.result_status_code = 200
        self.result_content_type = None
        self.result_content_disposition = None
        self.content_validation = True
        self.submitted.clear()


state = MockState()


# ---------------------------------------------------------------------------
# FastAPI application - upstream endpoints
# ---------------------------------------------------------------------------

app = FastAPI(title="mock-mineru-e2e")

# ---------------------------------------------------------------------------
# File content validation matching the MinerU 4.0 router.
# ---------------------------------------------------------------------------

_PDF_MAGIC = b"%PDF-"


def _unsupported_file(filename: str, content: bytes) -> str | None:
    """Return the extension if *content* does not match its MIME magic bytes.

    Mirrors real mineru-router rejection: when content_validation is True
    and a file claims to be PDF but does not start with `%PDF-`, the
    upstream returns `400 {"detail": "Unsupported file type: ..."}`.
    """
    if not state.content_validation:
        return None
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else filename.lower()
    if ext == "pdf":
        if not content.startswith(_PDF_MAGIC):
            return ext
    return None


def _error(message: str, *, code: str = "invalid_request", status: int = 400):
    return JSONResponse(
        status_code=status,
        content=error_payload(message, code=code),
    )


def _query_params(request: Request) -> dict:
    """Keep repeated query params (output_formats) as lists."""
    params: dict = {}
    for key in request.query_params:
        values = request.query_params.getlist(key)
        params[key] = values[0] if len(values) == 1 else values
    return params


@app.get("/v1/health")
async def health():
    """Return health payload. Returns 503 when status != 'healthy'."""
    if state.health_raises:
        raise RuntimeError("upstream unreachable")
    payload = health_payload(
        healthy=state.health_status == "healthy",
        version=state.version,
        features=state.features,
    )
    if state.health_status != "healthy":
        return JSONResponse(status_code=503, content=payload)
    return payload


@app.post("/v1/tasks")
async def submit_task(request: Request):
    """Accept a multipart task submission, return 202 with a task_id."""
    if state.submit_raises:
        raise RuntimeError("upstream unreachable")
    if state.submit_raw_body is not None:
        return PlainTextResponse(status_code=202, content=state.submit_raw_body)
    form = await request.form(max_files=100, max_fields=0)
    if any(name != "files" for name in form):
        return _error("Too many fields. Maximum number of fields is 0.")
    file_names: list[str] = []
    for value in form.getlist("files"):
        if not getattr(value, "filename", None):
            return _error("Every files field must contain a named file")
        content = value.file.read() if hasattr(value, "file") else await value.read()  # type: ignore[union-attr]
        bad_ext = _unsupported_file(value.filename, content)  # type: ignore[arg-type]
        if bad_ext:
            return _error(f"Unsupported file type: {bad_ext}")
        file_names.append(value.filename)
    params = _query_params(request)
    state.submitted.append({"file_names": file_names, "params": params})
    if state.submit_status != 202:
        return JSONResponse(
            status_code=state.submit_status, content={"detail": "upstream error"}
        )
    if state.submit_malformed:
        return JSONResponse(status_code=202, content={"status": "queued", "files": []})
    task_id = f"up-{uuid.uuid4().hex[:12]}"
    return JSONResponse(
        status_code=202,
        content=job_payload(
            task_id,
            status="queued",
            file_names=file_names,
            tier=params.get("tier", "standard"),
            output_formats=params.get("output_formats", ["markdown"]),
        ),
    )


@app.post("/v1/file_parse")
async def parse_file(request: Request):
    """Synchronous file parse, returns the V1 inline result."""
    form = await request.form(max_files=100, max_fields=0)
    if any(name != "files" for name in form):
        return _error("Too many fields. Maximum number of fields is 0.")
    if state.parse_status != 200:
        return JSONResponse(
            status_code=state.parse_status, content={"detail": "upstream error"}
        )
    return JSONResponse(
        status_code=200,
        content=inline_result_payload(f"up-{uuid.uuid4().hex[:12]}"),
    )


@app.get("/v1/tasks/{task_id}")
async def task_status(task_id: str):
    """Return the current task status (controlled by state.task_status)."""
    if state.status_raises:
        raise RuntimeError("status query failed")
    return job_payload(
        task_id,
        status=state.task_status,
        file_names=["doc.pdf"],
        error=state.task_error,
    )


@app.get("/v1/tasks/{task_id}/result")
async def task_result(task_id: str, response_format: str = "json"):
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


@app.delete("/v1/tasks/{task_id}")
async def cancel_task(task_id: str):
    """Cancel a task. Raises when cancel_raises is True."""
    if state.cancel_raises:
        raise RuntimeError("upstream unreachable")
    return canceled_payload(task_id)


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
