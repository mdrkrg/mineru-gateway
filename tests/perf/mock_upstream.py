"""Minimal mock upstream server for perf tests.

Mirrors the MinerU 4.0 V1 routes used by the gateway.

Usage:
    python tests/perf/mock_upstream.py --port 9001
"""

from __future__ import annotations

import argparse
import sys
import uuid
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

_ROOT = Path(__file__).resolve().parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from tests.mock_v1_contract import (  # noqa: E402
    canceled_payload,
    health_payload,
    inline_result_payload,
    job_payload,
)

app = FastAPI()


@app.get("/v1/health")
async def health():
    return health_payload(healthy=True)


@app.post("/v1/tasks")
async def submit_task(request: Request):
    form = await request.form(max_files=100, max_fields=0)
    file_names = [value.filename for value in form.getlist("files") if value.filename]
    output_formats = request.query_params.getlist("output_formats") or ["markdown"]
    return JSONResponse(
        status_code=202,
        content=job_payload(
            f"up-{uuid.uuid4().hex[:12]}",
            status="queued",
            file_names=file_names,
            tier=request.query_params.get("tier", "standard"),
            output_formats=output_formats,
        ),
    )


@app.post("/v1/file_parse")
async def parse_file(request: Request):
    form = await request.form(max_files=100, max_fields=0)
    files = form.getlist("files")
    file_name = files[0].filename if files and files[0].filename else "doc.pdf"
    return JSONResponse(
        status_code=200,
        content=inline_result_payload(
            f"up-{uuid.uuid4().hex[:12]}", file_name=file_name
        ),
    )


@app.get("/v1/tasks/{task_id}")
async def task_status(task_id: str):
    return job_payload(task_id, status="running", file_names=[])


@app.get("/v1/tasks/{task_id}/result")
async def task_result(task_id: str, response_format: str = "json"):
    return JSONResponse(
        status_code=200,
        content=job_payload(task_id, status="completed", file_names=[]),
    )


@app.delete("/v1/tasks/{task_id}")
async def cancel_task(task_id: str):
    return canceled_payload(task_id)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=9001)
    args = parser.parse_args()
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")
