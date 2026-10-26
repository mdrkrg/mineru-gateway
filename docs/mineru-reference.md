# MinerU 4.0 API 参考（网关视角）

本文从网关视角说明 **MinerU 4.0 V1 API** 的解析参数、任务状态和结果。
网关验证表单中的解析字段并将其转为上游 query 参数；不支持的参数返回
400。

## 请求参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `tier` | `str` | 上游默认 `standard` | 解析档位：`flash`（原生文本/预览）、`basic`（ONNX/Torch 小模型）、`standard`（小模型 + VLM）、`advanced`（更高计算量） |
| `ocr_mode` | `str` | `auto` | `auto` 自动判断、`txt` 原生文本、`ocr` 强制 OCR |
| `page_range` | `str` | 全部 | 页码从 1 开始，支持 `1-5,8`、`all`、`r1`（末页）、`r3-r1` |
| `output_formats` | `str` 列表 | `markdown` | `markdown`、`middle_json`、`structured_content`、`zip`；可重复或逗号分隔 |
| `response_format` | `json \| zip` | `json` | 仅 `/v1/file_parse`；选择同步响应格式 |
| `wait_timeout` | `int` | `300` | 仅 `/v1/file_parse`；范围 1–3600 秒 |

## 请求与限制

- 提交：`POST /v1/tasks`（异步）或 `POST /v1/file_parse`（同步）。
- 文件 part 必须命名为 `files`。
- 当前异步任务会自动在 `output_formats` 中追加 `zip`，以保证单项和批量下载可用；按需生成策略见 GitLab Issue #10。
- 限制：**200 MiB/文件**、总计 `GATEWAY_MAX_UPLOAD_SIZE`（默认 500 MiB）、100 文件/任务。
- 认证：网关用 `X-API-Key`；上游若启用 `--api-key`，通过 `GATEWAY_UPSTREAM_API_KEY` 注入 `Authorization: Bearer`。

## 任务状态

认证任务使用以下状态映射；匿名任务直接返回上游状态：

| 4.0 | 网关 |
|-----|------|
| `queued` | `pending` |
| `running` | `processing` |
| `completed` | `completed` |
| `partial` | `partial` |
| `failed` | `failed` |
| `canceled` | `cancelled` |

- `partial` 是**终态**：部分文件成功，结果可下载；`has_result=true`。
- `partial` / `failed` 的文件级错误从上游 `files[].error.message` 提取到
  `error` / `upstream_error`。
- 取消：`DELETE /v1/tasks/{id}` 与批量取消允许 `pending` 和
  `processing`（对应上游 `queued` / `running`）。

## 响应

### 异步提交（202）

```json
{
  "task_id": "…",
  "status": "pending",
  "tier": "standard",
  "file_names": ["document.pdf"],
  "created_at": "…",
  "status_url": "http://gateway/v1/tasks/…",
  "result_url": "http://gateway/v1/tasks/…/result",
  "started_at": null,
  "completed_at": null,
  "error": null,
  "message": "Task submitted successfully"
}
```

- `tier` 是 upstream 返回的实际档位；同步历史记录在未显式指定且响应为二进制时可能为 `null`。
- 匿名透传模式原样返回上游 4.0 响应（`files[]`、`links` 等），保留 opaque
  upstream task ID。客户端可用该 ID 继续调用网关的
  `GET /v1/tasks/{id}`、`GET /v1/tasks/{id}/result` 和
  `DELETE /v1/tasks/{id}`，网关会直接透传到上游；列表、统计和批量端点仍需 API Key。
- `/v1/file_parse` 的等待预算耗尽并返回 202 时，认证请求会转为可查询的
  Gateway 任务：保存 upstream 映射、重写 `task_id`/任务链接并保留上传缓存供
  故障重提。同步返回的 `partial`、`failed`、`canceled` 也按实际终态记入历史。

### 结果

- `GET /v1/tasks/{id}/result`：
  - 可显式使用 `?response_format=json|zip`；匿名模式直接转发该参数。
  - 提交时的 `output_formats` 包含 `zip` → 携带 `?response_format=zip`，返回 `application/zip`。
  - 否则返回 4.0 的内联 JSON：`files[].content.markdown` / `middle_json` / `structured_content`。
  - 认证任务未完成 → 409；匿名模式保留上游响应（未完成时为 202）。
  - 上游失败或取消 → 409。
- `POST /v1/tasks/result-zip`：对每个任务按 ZIP 取结果并重新打包，清单写入 `_manifest.json`。
- JSON 结果使用 `files[].content` 返回所请求的文本格式；图片只在 ZIP 中提供。

### 健康检查

`GET /v1/health` 聚合网关与上游：

```json
{
  "gateway": "healthy",
  "status": "healthy",
  "upstream": {
    "status": "healthy",
    "version": "4.0.12",
    "features": {
      "webhook": false,
      "output_formats": ["markdown", "middle_json", "structured_content", "zip"],
      "sources": ["file_id", "url", "inline"]
    }
  }
}
```

MinerU 4.0 health 不提供队列容量或空闲 slot，因此网关不做提交前健康门控。
解析端点保留上游 503；网关健康检查则聚合为 `degraded` 并返回 503。
