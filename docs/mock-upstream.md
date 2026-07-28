# Mock upstream API reference

The e2e mock upstream (`tests/e2e/mock_server.py`) emulates mineru-api /
mineru-router behind a real HTTP interface. It exposes **control endpoints**
so that frontend and backend e2e tests can simulate upstream states without
a real deployment.

## Starting the mock

```bash
uv run python tests/e2e/run_mock.py            # backend only
uv run python tests/e2e/run_mock.py --frontend # + frontend dev server
```

## Control endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/_mock/reset` | POST | Reset all state to defaults |
| `/_mock/configure` | POST | Set state fields (JSON body, key-value) |
| `/_mock/state` | GET | Inspect current mutable state |

## MockState fields

All fields are settable via `POST /_mock/configure {"<field>": <value>}`.
`null` means the field is optional and defaults to absent.

### Upstream health

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `health_status` | `str` | `"healthy"` | `"healthy"` \| `"degraded"` — non-healthy → 503 |
| `health_raises` | `bool` | `false` | Raise `RuntimeError` in `/health` handler. FastAPI returns 500; gateway defaults to `status="unknown"` and returns 503. Does NOT simulate true unreachability (connection error). |
| `max_concurrent` | `int` | `4` | Reported `max_concurrent_requests` in `/health` |
| `queued` | `int` | `0` | Reported `queued_tasks` in `/health` |
| `processing` | `int` | `0` | Reported `processing_tasks` in `/health` |
| `version` | `str` | `"3.4.0"` | Reported `version` in `/health` |
| `protocol_version` | `int` | `2` | Reported `protocol_version` in `/health` |
| `completed_tasks` | `int` | `0` | Reported `completed_tasks` in `/health` |
| `failed_tasks` | `int` | `0` | Reported `failed_tasks` in `/health` |
| `processing_window_size` | `int` | `64` | Reported `processing_window_size` in `/health` |

### Task submission (`POST /tasks`)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `submit_status` | `int` | `202` | Status code of the submit response |
| `submit_raises` | `bool` | `false` | Simulate `POST /tasks` unreachable |
| `submit_malformed` | `bool` | `false` | Return 202 but omit `task_id` from body |
| `submit_raw_body` | `str \| null` | `null` | Return 202 with a raw text body (non-JSON) |
| `queued_ahead` | `int \| null` | `null` | `queued_ahead` field in the 202 response |
| `content_validation` | `bool` | `true` | Reject non-PDF files with 400 `"Unsupported file type: …"` |

### Task status (`GET /tasks/{id}`)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `task_status` | `str` | `"processing"` | Status the upstream returns: `"queued"` \| `"running"` \| `"processing"` \| `"done"` \| `"success"` \| `"completed"` \| `"error"` \| `"failed"` \| `"canceled"` |
| `status_raises` | `bool` | `false` | Simulate `GET /tasks/{id}` unreachable |

### Task cancel (`DELETE /tasks/{id}`)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `cancel_raises` | `bool` | `false` | Simulate `DELETE /tasks/{id}` unreachable |

### Task result (`GET /tasks/{id}/result`)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `result_status_code` | `int` | `200` | HTTP status code of the result response |
| `result_content_type` | `str \| null` | `null` | `Content-Type` header (e.g. `"application/zip"`) |
| `result_content_disposition` | `str \| null` | `null` | `Content-Disposition` header (e.g. `"attachment; filename=out.zip"`) |

### File parse (`POST /file_parse`)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `parse_status` | `int` | `200` | Status code of the parse response |
