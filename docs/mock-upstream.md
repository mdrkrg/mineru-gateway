# Mock upstream API reference

The e2e mock upstream (`tests/e2e/mock_server.py`) emulates **MinerU 4.0**
(mineru-api / mineru-router, `/v1` API) behind a real HTTP interface. It
exposes **control endpoints** so frontend and backend e2e tests can simulate
upstream states without a real deployment.

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

### Upstream health (`GET /v1/health`)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `health_status` | `str` | `"healthy"` | `"healthy"` → `{status:"ok"}`; anything else → 503 `{status:"degraded"}` |
| `health_raises` | `bool` | `false` | Raise `RuntimeError` in the health handler. FastAPI returns 500; the gateway normalises it to `status="degraded"` and returns 503. Does NOT simulate true unreachability (connection error). |
| `version` | `str` | `"4.0.12"` | Reported `version` |
| `features` | `dict` | `{webhook, output_formats, sources}` | Reported capability object |

### Task submission (`POST /v1/tasks`)

Parse options are **query parameters** (`tier`, `ocr_mode`, `page_range`,
`output_formats`). The multipart body may only contain parts named `files`;
extra form fields return 400, matching 4.0's `max_fields=0`.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `submit_status` | `int` | `202` | Status code of the submit response |
| `submit_raises` | `bool` | `false` | Simulate `POST /v1/tasks` unreachable |
| `submit_malformed` | `bool` | `false` | Return 202 but omit `task_id` from the body |
| `submit_raw_body` | `str \| null` | `null` | Return 202 with a raw text body (non-JSON) |
| `content_validation` | `bool` | `true` | Reject non-PDF files with 400 `"Unsupported file type: …"` |

### Task status (`GET /v1/tasks/{id}`)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `task_status` | `str` | `"running"` | `"queued"` \| `"running"` \| `"completed"` \| `"partial"` \| `"failed"` \| `"canceled"` |
| `task_error` | `dict \| null` | `null` | Per-file `error` object returned on `files[]` |
| `status_raises` | `bool` | `false` | Simulate `GET /v1/tasks/{id}` unreachable |

### Task cancel (`DELETE /v1/tasks/{id}`)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `cancel_raises` | `bool` | `false` | Simulate `DELETE /v1/tasks/{id}` unreachable |

### Task result (`GET /v1/tasks/{id}/result`)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `result_status_code` | `int` | `200` | HTTP status code of the result response |
| `result_content_type` | `str \| null` | `null` | `Content-Type` header (e.g. `"application/zip"`) |
| `result_content_disposition` | `str \| null` | `null` | `Content-Disposition` header (e.g. `"attachment; filename=out.zip"`) |

`?response_format=zip` is accepted and ignored by default; tests that care
about ZIP contents set the headers above.

### File parse (`POST /v1/file_parse`)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `parse_status` | `int` | `200` | Status code of the parse response |
