"""Mock MinerU 4.0 upstream (mineru-api / mineru-router) as an in-process app.

Wired into the gateway via httpx.ASGITransport in tests — no real network.
Behavior is controllable through the module-level ``state`` so individual tests
can simulate 503 / unhealthy / malformed-response conditions.

The contract mirrors MinerU 4.0's V1 API:

* parse options travel as query parameters; the multipart body may only
  contain parts named ``files`` (4.0 starts Starlette's form parser with
  ``max_fields=0`` and rejects anything else);
* jobs use ``queued`` / ``running`` / ``completed`` / ``partial`` / ``failed``
  / ``canceled`` and carry per-file statuses;
* ``/v1/health`` reports ``status="ok"`` plus feature flags, not queue depth.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, PlainTextResponse, Response

from tests.mock_v1_contract import (
    canceled_payload,
    default_features,
    error_payload,
    health_payload,
    inline_result_payload,
    job_payload,
)


@dataclass
class MockState:
    status: str = "healthy"
    version: str = "4.0.12"
    features: dict = field(default_factory=default_features)
    health_raises: bool = False  # simulate upstream /health being unreachable
    submit_status: int = 202  # status code returned by POST /v1/tasks
    submit_malformed: bool = False  # return 202 without a task_id
    submit_raw_body: str | None = None  # return 202 with raw text body (non-JSON)
    parse_status: int = 200  # status code returned by POST /v1/file_parse
    cancel_raises: bool = False  # simulate DELETE /v1/tasks/{id} being unreachable
    submit_raises: bool = False  # simulate POST /v1/tasks connection failure
    status_raises: bool = False  # simulate GET /v1/tasks/{id} failure
    task_status: str = "running"  # status reported by GET /v1/tasks/{id}
    task_error: dict | None = None
    submitted: list[dict] = field(default_factory=list)
    result_requests: list[dict] = field(default_factory=list)

    # Per-task result overrides for GET /v1/tasks/{id}/result
    # Key: upstream_task_id -> {"status_code": int, "content": bytes, "headers": dict}
    result_status_code: int = 200
    result_content_type: str | None = None
    result_content_disposition: str | None = None
    task_result_overrides: dict = field(default_factory=dict)

    def reset(self) -> None:
        self.status = "healthy"
        self.version = "4.0.12"
        self.features = default_features()
        self.health_raises = False
        self.submit_status = 202
        self.submit_malformed = False
        self.submit_raw_body = None
        self.parse_status = 200
        self.cancel_raises = False
        self.submit_raises = False
        self.status_raises = False
        self.task_status = "running"
        self.task_error = None
        self.submitted.clear()
        self.result_requests.clear()
        self.result_status_code = 200
        self.result_content_type = None
        self.result_content_disposition = None
        self.task_result_overrides.clear()


state = MockState()


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


def create_mock_upstream() -> FastAPI:
    app = FastAPI(title="mock-mineru-v1")

    @app.get("/v1/health")
    async def health():
        if state.health_raises:
            raise RuntimeError("upstream unreachable")
        payload = health_payload(
            healthy=state.status == "healthy",
            version=state.version,
            features=state.features,
        )
        if state.status != "healthy":
            return JSONResponse(status_code=503, content=payload)
        return payload

    @app.post("/v1/tasks")
    async def submit_task(request: Request):
        if state.submit_raises:
            raise RuntimeError("upstream unreachable")
        if state.submit_raw_body is not None:
            return PlainTextResponse(status_code=202, content=state.submit_raw_body)
        form = await request.form(max_files=100, max_fields=0)
        if any(key != "files" for key in form):
            return _error(
                "Too many fields. Maximum number of fields is 0.",
                code="invalid_request",
            )
        files = form.getlist("files")
        if not files:
            return _error("Supply one or more files fields", code="invalid_request")
        file_names = [getattr(value, "filename", None) or "unnamed" for value in files]
        params = _query_params(request)
        state.submitted.append({"file_names": file_names, "params": params})
        if state.submit_status != 202:
            return JSONResponse(
                status_code=state.submit_status,
                content={"detail": "upstream error"},
            )
        task_id = f"up-{uuid.uuid4().hex[:12]}"
        if state.submit_malformed:
            return JSONResponse(
                status_code=202,
                content={"status": "queued", "files": []},
            )
        payload = job_payload(
            task_id,
            status="queued",
            file_names=file_names,
            tier=params.get("tier", "standard"),
            output_formats=params.get("output_formats", ["markdown"]),
        )
        # The gateway reads both the alias and the job id.
        payload["task_id"] = task_id
        return JSONResponse(status_code=202, content=payload)

    @app.post("/v1/file_parse")
    async def parse_file(request: Request):
        form = await request.form(max_files=100, max_fields=0)
        if any(key != "files" for key in form):
            return _error(
                "Too many fields. Maximum number of fields is 0.",
                code="invalid_request",
            )
        state.submitted.append(
            {
                "file_names": [
                    getattr(value, "filename", None) or "unnamed"
                    for value in form.getlist("files")
                ],
                "params": _query_params(request),
            }
        )
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
        state.result_requests.append(
            {"task_id": task_id, "response_format": response_format}
        )
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

    @app.delete("/v1/tasks/{task_id}")
    async def cancel_task(task_id: str):
        if state.cancel_raises:
            raise RuntimeError("upstream unreachable")
        return canceled_payload(task_id)

    return app
