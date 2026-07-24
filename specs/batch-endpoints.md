# 批量操作轻量端点

> 本规约定义两个轻量后端端点——前者聚合 zip 下载，后者批量取消——均不引入新数据模型、不新增数据库迁移。

> **上下文引用**（项目内已有行为）：
> - `get_owned(session, task_id, api_key_id)` — 按 `id` + 所属 Key 检索 task；不存在或不属于当前 Key → 返回 `None`
> - `mark_cancelled(session, task)` — 将 task 状态置为 `cancelled`、记录完成时间、返回被释放的 `cache_dir`
> - `cache.release(cache_dir)` — 删除 task 暂存文件目录
> - `upstream.cancel_task(upstream_task_id)` — 向 MinerU 上游发送取消（best-effort，异常吞没）
> - `require_api_key` — FastAPI 依赖项，从 `X-API-Key` 头提取并验证 API Key

## 1. `POST /tasks/result-zip` — 多任务结果 zip 下载

流式返回一个 zip 包，内含所请求的多个 task 的最新结果。

### 1.1 请求

```http
POST /tasks/result-zip
X-API-Key: mru_AbCd1234...
Content-Type: application/json

{
  "task_ids": [
    "018f4e2c-...",
    "018f4e2d-...",
    "018f4e2e-..."
  ]
}
```

- `task_ids` — 至少 1 个，至多 200 个 UUID。为空或超过上限均返回 `422`。

### 1.2 处理

1. **认证**：`require_api_key` 依赖项验证 `X-API-Key`。无效或缺失 → `401`。
2. **输入校验**：`task_ids` 长度 = 0 或 > 200 → `422`。
3. **所有权批量校验**：遍历 `task_ids`，每个 task 执行 `get_owned`（同时校验 `id` 存在 + `api_key_id` 匹配）。
   - 若任意 task 不属于当前 Key → **`404`**（整请求拒绝，不区分单个与全部）。
   - 原因：若允许跳过无权限 task，则此端点将成为他人的 task 所有权探测泄露源。
4. **可下载性校验**：从步骤 3 通过的 task 中全部校验：
   - 须同时满足 `status == 'completed'` 且 `upstream_task_id IS NOT NULL`
   - 若任一 task 不符合 → **`409`**，响应体列出所有不合格 task 的 `task_id`、`status` 及 `reason`。
5. **流式构建 zip**：维护内存中的 manifest 对象（`included`、`skipped` 列表），对校验通过的 task 逐条执行：
   a. 请求上游 `GET /tasks/{upstream_task_id}/result`
   b. 若上游返回 `200`：将响应体作为 zip entry 写入流，同时在 manifest `.included` 中记录 `{"task_id", "entry"}`
   c. 若上游返回非 200 或抛出异常：**跳过此 task**，同时在 manifest `.skipped` 中记录 `{"task_id", "entry", "reason", "detail"}`（`reason: "upstream_error"`，`detail` 为实际 HTTP 状态码或异常信息）
   d. 全部 task 完成后，追加写入 `_manifest.json` 作为 zip 的最后一个 entry（见下方结构），然后关闭 zip 流
6. **zip entry 命名**（按优先级回退）：
    a. 优先从上游 `Content-Disposition` 头提取文件名
    b. 若无，且 `task.file_names` 非空：用 `task.file_names[0]`（如 `paper-001.pdf`）构建目录名，`<文件名（去扩展名）>/result.<上游 Content-Type 扩展名>`
    c. 若无 `Content-Disposition` 且 `file_names` 为空：回退为 `<task_id>/result.<上游 Content-Type 扩展名>`
    d. 若无法确定扩展名：使用 `result.bin`
    e. 若按上述规则产生的 entry 名与已写入 zip 的 entry 重名，追加 `-<task_id 后8位>` 以去重，避免 zip 内数据被静默覆盖
7. **响应**：
   - `Content-Type: application/zip`
   - `Content-Disposition: attachment; filename="results.zip"`
   - HTTP 状态码 `200`（即使部分上游获取失败——已跳过，详情见 zip 内 `_manifest.json`）

**`_manifest.json` 结构**：

```json
{
  "included": [
    {"task_id": "018f4e2c-...", "entry": "paper1/result.zip"}
  ],
  "skipped": [
    {
      "task_id": "018f4e2e-...",
      "entry": "paper3/result.bin",
      "reason": "upstream_error",
      "detail": "HTTP 500"
    }
  ]
}
```

- `included` — 成功写入 zip 的 task，含 `task_id` 及实际 `entry` 路径名
- `skipped` — 上游请求失败的 task，`reason` 固定为 `"upstream_error"`，`detail` 包含实际 HTTP 状态码或异常信息

> 单任务 `GET /tasks/{id}/result` 允许下载 `completed`/`failed`/`cancelled` 的结果——它是透明代理，
> 不屏蔽上游返回的任何内容（`failed` 可能含部分输出、`cancelled` 可能在取消前已生成结果）。
> 本批量端点语义为「收集成功产出」，故仅接受 `completed`，避免将失败/取消的中间产物混入 zip。

### 1.3 响应

#### 成功 (`200 OK`)

HTTP body 为流式 zip 流。客户端应将其视为标准 zip 下载。zip 最后一个 entry 为 `_manifest.json`，记录实际包含和跳过的 task 详情。

#### 错误

| 状态码 | 条件 | 响应体 |
|:---:|------|--------|
| `401` | 未提供有效 API Key | `{"detail": "API key required"}` |
| `404` | 任一 task_id 不存在或不属于当前 Key | `{"detail": "Task not found for one or more task_ids"}` |
| `409` | 提交的 tasks 中存在非 completed 或缺少 upstream_task_id 的 task | `{"detail": "One or more tasks are not available for download", "non_downloadable": [{"task_id": "..", "status": "..", "reason": "not_completed"\|"missing_upstream_task_id"}]}` |
| `422` | `task_ids` 为空数组，或长度 > 200 | FastAPI 自动校验的 ValidationError |

#### 流式传输中的异常

若 zip 流构建中途某上游请求失败（超时、连接断开），该 entry 被跳过，zip 流继续。对应的 `task_id`、拟写入的 `entry` 名、`reason` 及 `detail` 记录在 manifest `.skipped` 中，最终写入 `_manifest.json`。不使整响应失败。

### 1.4 测试

**Z1 — 3 个 completed task，全部上游正常返回**
提交 3 个 `task_id`，均为 `completed` 且有 `upstream_task_id`。mock 上游对每个 task 返回 `200` + zip content。

验证：HTTP `200`、`Content-Type: application/zip`。解压后 zip 含 3 个目录，各对应 task 的文件名。

**Z2 — 部分 task 非 completed**
提交 3 个 `task_id`，状态分别为 `completed`、`processing`、`pending`。

验证：HTTP `409`。响应体 `non_downloadable` 含 2 条（`processing`→`not_completed`、`pending`→`not_completed`），各附 `task_id` 及 `status`。

**Z3 — 全部 task 无可下载结果**
提交 3 个 `task_id`，均为 `pending`。

验证：HTTP `409`。响应体 `non_downloadable` 含 3 条 `not_completed`。

**Z4 — task_id 不属于当前 Key**
Key-A 创建 task-1。Key-B 提交 `{"task_ids": [task-1.id]}`。

验证：HTTP `404`。响应体含 `"Task not found for one or more task_ids"`。

**Z5 — task_ids 长度超限**
提交 201 个 task_id。

验证：HTTP `422`。body 含 FastAPI 标准的 ValidationError 消息。

**Z6 — 上游部分返回异常**
提交 2 个 `completed` task。第 1 个上游返回 `200`，第 2 个上游返回 `500`。

验证：HTTP `200`。zip 含 2 个 entry：第 1 个 result entry + `_manifest.json`。解压 `_manifest.json`，`included` 含 1 条（第 1 个 task），`skipped` 含 1 条（`reason: "upstream_error", detail: "HTTP 500"`）。

**Z7 — zip entry 命名（有文件名时）**
提交 1 个 `completed` task，`file_names = ["thesis.pdf"]`。上游返回 `Content-Type: application/zip` 且无 `Content-Disposition`。

验证：zip entry 名为 `thesis/result.zip`（去扩展名后的目录 + 扩展名）。

**Z8 — zip entry 命名（无文件名时回退到 task_id）**
提交 1 个 `completed` task，`file_names = []`。上游返回 `Content-Type: application/zip` 且无 `Content-Disposition`。

验证：zip entry 名为 `<task_id>/result.zip`（目录名使用 task 本身的 UUID）。

**Z9 — 上游全部异常，manifest 记录所有失败**
提交 2 个 `completed` task，上游均返回 `500`。

验证：HTTP `200`。zip 仅含 `_manifest.json`（无 result entry）。`included` 为空数组，`skipped` 含 2 条 `upstream_error`。

**Z10 — `_manifest.json` 为 zip 最后一个 entry**
提交 3 个 `completed` task，上游均返回 `200`。

验证：遍历 zip entry 顺序，`_manifest.json` 为最后一个。`included` 含 3 条，`skipped` 为空。

**Z11 — 重名 entry 去重**
提交 2 个 `completed` task，上游对两者均返回 `Content-Disposition: attachment; filename="output.zip"`。

验证：HTTP `200`。zip 含 2 个 result entry（非 1 个），各自内容完整独立。manifest `included` 含 2 条，`entry` 不同。

---

## 2. `POST /tasks/cancel` — 批量取消

取消一组 task 中所有处于 `pending` 状态的 task。

### 2.1 请求

```http
POST /tasks/cancel
X-API-Key: mru_AbCd1234...
Content-Type: application/json

{
  "task_ids": [
    "018f4e2c-...",
    "018f4e2d-...",
    "018f4e2e-..."
  ]
}
```

- `task_ids` — 至少 1 个，至多 200 个 UUID。

### 2.2 处理

1. **认证**：`require_api_key` 依赖项验证 `X-API-Key`。无效或缺失 → `401`。
2. **输入校验**：`task_ids` 为空 → `422`；长度 > 200 → `422`。
3. **逐 task 处理**（各 task 之间独立，一个失败不影响其他）：
   a. 按 `task_id` + `api_key_id` 查询 task（`get_owned`）
   b. 若 task 不存在或不属于当前 Key → 记录错误（`"not_found"`），不创建 `TaskRecord` 操作，继续下一个
   c. 若 task 存在但 `status != 'pending'` → 记录错误（`"not_cancellable"` + 当前 status），继续下一个
   d. 若 task 存在且 `status == 'pending'` → 执行现有取消逻辑：
      - 若 `upstream_task_id` 非空 → 尝试 `upstream.cancel_task(...)`（best-effort，异常吞没）
      - 调用 `mark_cancelled(session, task)` → 将 task 变为 `cancelled`
      - 释放 `cache_dir`（`cache.release(...)`）
      - 取消成功的 task `id` 计入 `cancelled` 列表
   e. 继续下一个
4. **返回摘要**。

### 2.3 响应

#### 成功 (`200 OK`)

```json
{
  "cancelled_count": 2,
  "cancelled_ids": [
    "018f4e2c-...",
    "018f4e2e-..."
  ],
  "errors": [
    {
      "task_id": "018f4e2d-...",
      "reason": "not_cancellable",
      "current_status": "processing"
    },
    {
      "task_id": "018f4e99-...",
      "reason": "not_found"
    }
  ]
}
```

- `cancelled_count` — 实际成功取消的 task 数
- `cancelled_ids` — 成功取消的 task ID 列表
- `errors` — 未能取消的 task 及原因：
  - `not_found` — task 不存在或不属于当前 Key
  - `not_cancellable` — task 状态不是 `pending`（含 `current_status` 字段告知当前状态）

#### 错误

| 状态码 | 条件 | 响应体 |
|:---:|------|--------|
| `401` | 未提供有效 API Key | `{"detail": "API key required"}` |
| `422` | `task_ids` 为空或 > 200 | FastAPI 自动校验的 ValidationError |

### 2.4 与 `DELETE /tasks/{id}` 的一致性

- 仅取消 `pending` 状态的 task。`processing` 或 `retry_pending` 不可取消——原因与 `DELETE /tasks/{id}` 相同。
- 上游取消请求为 best-effort（上游不可达时吞没异常，不影响本地状态变更）。
- 取消后释放文件暂存目录、task 状态变为 `cancelled`。

### 2.5 测试

**C1 — 2 个 pending task 全部成功取消**
提交 2 个 task_id，状态均为 `pending`。验证 `cancelled_count = 2`、`errors = []`、2 个 task 的 `status = 'cancelled'`、cache_dir 已释放。

**C2 — 混合状态**
提交 3 个 task_id：1 个 `pending`、1 个 `processing`、1 个 `completed`。验证 `cancelled_count = 1`（仅 pending 被取消）、`errors` 含 2 条（`not_cancellable` 各附 `current_status`）。

**C3 — 不存在 / 无权限**
提交 2 个 task_id，其中 1 个不存在、1 个属于另一 Key。验证 `cancelled_count = 0`、`errors` 含 2 条 `not_found`。HTTP 状态码仍为 `200`。

**C4 — 全部 pending，上游不可达**
提交 2 个 pending task。mock 上游 `cancel_task` 抛异常。验证：task 本地仍被标记为 `cancelled`（best-effort 上游取消失败不影响本地状态变更）。`cancelled_count = 2`。

**C5 — 空 task_ids**
提交 `{"task_ids": []}`。验证 HTTP 状态码 `422`。

---

## 3. 行为约束

| 约束 | 说明 |
|------|------|
| 端点路径 | `POST /tasks/result-zip` 和 `POST /tasks/cancel` |
| 认证 | 请求须携带有效 `X-API-Key`；服务端对每个 `task_id` 校验所属权 |
| 权限隔离 | `result-zip`：任一 `task_id` 不属于当前 Key → 整请求返回 `404`（防所有权探测泄露）。`cancel`：无权限的 task 在 `errors` 中记录 `not_found`，其他 task 照常处理 |
| 数据模型 | 不引入新的数据库表、列或迁移 |
| 第三方依赖 | 不引入新的第三方 Python 包 |
| 限流 | 两个端点不额外施加限流（不记录操作到限流 token bucket） |

## 4. 前端调用示例

```
# 1. 提交 N 个文件（已有 API）
for file in files:
    POST /tasks  (X-Idempotency-Key: batch-xxx-file-N)
    → 获得 task_id，存入本地列表

# 2. 进度追踪（已有 API）
轮询 GET /tasks/{task_id} 各 task status，前端本地聚合

# 3. 下载选中结果（新端点）
POST /tasks/result-zip  {"task_ids": [勾选的已完成 task IDs]}

# 4. 取消剩余 pending 任务（新端点）
POST /tasks/cancel  {"task_ids": [尚为 pending 的 task IDs]}
```
