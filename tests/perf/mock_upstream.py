"""Minimal mock upstream server for perf tests.

Usage:
    python tests/perf/mock_upstream.py --port 9001
"""

from __future__ import annotations

import argparse
import uuid

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

app = FastAPI()


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "version": "3.4.0",
        "protocol_version": 2,
        "max_concurrent_requests": 100,
        "queued_tasks": 0,
        "processing_tasks": 0,
    }


@app.post("/tasks")
async def submit_task(request: Request):
    form = await request.form()
    file_names = [
        v.filename
        for _, v in form.multi_items()
        if hasattr(v, "filename") and v.filename
    ]
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
    return JSONResponse(
        status_code=200,
        content={"markdown": "# parsed", "status": "completed"},
    )


@app.get("/tasks/{task_id}")
async def task_status(task_id: str):
    return {"task_id": task_id, "status": "processing"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=9001)
    args = parser.parse_args()
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")
