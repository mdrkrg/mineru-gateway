# 流式上传 实现规约

> 基于 `specs/mvp-implementation.md`（提交流程、FileCache）、`specs/idempotent-submission.md`（幂等提交行为）。
> 本规约定义 `POST /tasks` 端点的流式 multipart 上传行为，消除当前实现中大文件提交的内存双缓冲问题。

## 0. 目标与非目标

### 目标

1. `POST /tasks` 端点在上传阶段（接收客户端 multipart body）的内存占用量与单个文件大小解耦：任意大小的文件均以固定窗口大小的 chunk 为单位流式处理，不会因文件大小增长而线性增长内存。
2. 上传大小检查从「完整读取后判断」改为「累计字节实时判断」：一旦累计接收的字节数超过 `max_upload_size`，立即中止流并返回 413，不再等待客户端完成上传。
3. 流式处理与现有幂等提交、限流、健康门控、全局并发检查的交互行为定义清晰，不引入状态不一致。
4. FileCache 的磁盘暂存行为与 crash recovery（retry 循环）保持兼容：retry 循环从磁盘恢复文件并重提的路径不受影响。
5. `POST /file_parse` 端点的 `_extract_multipart` 行为不受影响（继续使用现有的全量缓冲方式）。

### 非目标

- 匿名请求的端到端内存优化：匿名提交（`api_key is None`）从客户端接收 body 时使用流式解析（内存占用同样 bounded），但转发到上游时仍使用全量读取（与当前行为一致）。匿名路径不是大文件流量的主要入口。
- 上游转发的内存优化：认证提交在流式缓存到磁盘后，使用现有 buffered 方式从磁盘读取并转发到上游。本规约解决的是「网关接收上传」阶段的内存问题；「网关转发」阶段的内存优化留待后续（见 §1 决策理由）。
- `POST /tasks/result-zip` 和 `GET /tasks/{id}/result` 的流式改造：属 A10 流式下载规约范围。
- 磁盘配额检查（B2）：属独立特性，不在此规约中定义。

### 设计权衡说明

本规约采用**两阶段方案**（先流式写盘 → 再读盘转发），而非「客户端→网关→上游」全链路流式。理由：

| 考量 | 两阶段（本规约选型） | 全链路流式 |
|------|---------------------|-----------|
| 实现复杂度 | 仅改动 multipart 解析 + FileCache 写入 | 需额外实现流式 multipart 构造 + httpx streaming body |
| 上游故障处理 | 文件已在磁盘，可通过 retry 循环恢复 | 部分字节已发送至上游，上游中途失败导致状态不明确 |
| 幂等冲突恢复 | 与现有 IntegrityError 恢复路径一致 | 冲突时上游已收到部分数据，产生不可追踪的孤儿任务 |
| 内存收益 | 上传阶段 bounded；转发阶段与文件大小等比（但与当前一致） | 全链路 bounded |

转发阶段的内存问题在上传量大且 Gateway 是瓶颈时才显著；届时可与 B10（对象存储直传）一并解决——客户端直传对象存储，Gateway 只持有引用。

## 1. 核心行为变更

以下行为变更仅针对 `POST /tasks` 端点的 `handle_task_submission` 中与 multipart 解析相关的部分。幂等检查、限流、健康门控、全局并发检查、TaskRecord 创建、响应生成等步骤的行为**不变**。

### 1.1 函数变更：新增 `_extract_multipart_streaming`

现有的 `_extract_multipart` 函数**保留不变**（继续被 `handle_file_parse` 使用）。`handle_task_submission` 改用新增的流式解析函数：

```
_extract_multipart_streaming(request, max_upload_size, cache)
    → (data: dict, cache_dir: str, file_names: list[str], total_bytes: int)
```

该函数的流式行为如下：

| 行为项 | 变更前 | 变更后 |
|--------|--------|--------|
| 解析方式 | `request.form()` 全量加载到内存 | 流式 multipart parser，每次处理一个 chunk |
| 文件内容存储 | `UploadFile.read()` 为 `bytes` 对象，全部驻留内存 | 以 chunk 为单位写入 FileCache 磁盘目录，不在内存中累积 |
| 表单字段存储 | 作为 `dict` value 驻留内存 | 同左（form 字段数据量小，不变） |
| `max_upload_size` 检查时机 | 每个文件完整读取后检查 `len(content)` | 每个 chunk 到达时检查累计字节是否超限 |
| 超限后行为 | 已完整读取，抛出 413（body 已全在内存） | 立即停止解析、关闭流、返回 413；未完成的缓存目录被清理 |
| 返回值 | `(data: dict, files: Files, file_names: list[str], total_bytes: int)` | `(data: dict, cache_dir: str, file_names: list[str], total_bytes: int)` |
| 返回的 `files` | 文件内容为 `bytes` | 不再返回文件字节列表；文件已在 `cache_dir` 下 |

**不变的部分**：

- `data` dict 中 form 字段的 key/value 对与变更前完全一致。
- `file_names` 列表的顺序和内容与变更前完全一致（来自 multipart 各 part 的 `filename` 字段）。
- `total_bytes` 的最终值（所有文件累计字节）与变更前完全一致。

> **注意**：返回值中的 `total_bytes` 仅计文件字节，与 §3.2 中用于大小检查的
> “累计接收的字节数”（含表单字段字节 + 文件字节）是**不同的计数器**。
> 实现中使用两个独立变量：一个用于全量字节检查和 413 判定，另一个用于
> `total_bytes` 返回值（与 TaskRecord.file_total_bytes 对应）。
- 布尔字段转换（`_coerce`）、`_extract_parse_params` 对 data dict 的处理完全不变——它们只读取 `data`，不依赖 `files`。

### 1.2 后续流程适应性变更

由于 `_extract_multipart_streaming` 返回 `cache_dir`（替代原 `files`），提交流程中的后续步骤相应调整：

**认证路径（`api_key is not None`）**：

- `cache_dir` 由 `_extract_multipart_streaming` 直接返回，不再通过单独的 `cache.store()` 调用获取。

**匿名路径（`api_key is None`）**：

- 文件同样通过流式解析写入临时 `cache_dir`，但转发到上游后该目录被立即清理（`cache.release(cache_dir)`），不创建 TaskRecord，不保留缓存。

### 1.3 不变的行为

以下步骤在流式改造后**完全不变**：

- 步骤 1（认证门控）：`require_api_key` 解析 `X-API-Key`，行为不变。
- 步骤 2（幂等检查）：在流式解析**之前**执行。命中时返回 202 + 重构响应，跳过所有后续步骤包括 multipart body 读取——**与当前行为完全一致**。
- 步骤 3（速率限制）：`limiter.acquire` 在幂等检查之后、流式解析之前执行。行为不变。
- 步骤 4（上游健康门控）：`check_free_slot` 在流式解析之前执行。行为不变。
- 步骤 7（全局并发检查）：`count_in_flight` 在流式解析之后、上游转发之前执行。行为不变。
- 步骤 9（TaskRecord 创建）：`task_service.create` 的参数和返回值不变。数据库 schema 不变。
- 步骤 10（响应构造）：返回的 JSON body 结构和响应头不变。
- `handle_file_parse`：完全不变——继续使用现有的 `_extract_multipart`（全量缓冲方式）。

### 1.4 处理步骤概览（变更后）

```
接收 POST /tasks 请求

1. 解析 X-API-Key 请求头
   如果 Key 无效且不允许匿名 → 返回 401

2. 如果 是认证请求 且 提供了有效 X-Idempotency-Key:
     在数据库中查询 (api_key, idempotency_key)
     如果 命中:
         从已有记录重构响应（status 始终为 "pending"）
         附加 X-Idempotency-Key-Replayed: true
         返回 202                           ← 终止，不读取 body（不变）

3. 如果 是认证请求:
     按 key 扣减令牌桶
     如果 无可用令牌 → 返回 429 Retry-After: 60（不变）

4. 查询上游 /health
   如果 上游无空闲位 → 返回 503 Retry-After: 5（不变）

5. 流式解析 multipart body:                          ← 变更
     - 遍历客户端字节流，每个 part 按 chunk 读取
     - 表单字段 → 累积到 data dict（内存）
     - 文件字段 → 每 chunk 直接写入磁盘缓存目录（不驻留内存）
     - file_names 按出现顺序记录
     - 每个 chunk 到达时，检查 total_bytes + len(chunk) 是否超过 max_upload_size
       如果 超过:
          停止读取流
          删除已写入的缓存目录
          返回 413
       如果 未超过:
          total_bytes += len(chunk)
          写入 chunk 到磁盘

6. 如果 是匿名请求:
      从磁盘缓存目录全量读取文件
      转发 multipart 到上游
      删除磁盘缓存目录（不留存）
      返回上游响应                              ← 终止

7. 统计当前 in-flight 任务数
   如果 达到全局并发上限 → 返回 503 Retry-After: 10（不变）

8. 从磁盘缓存目录读取文件
   转发 multipart 到上游
   如果 上游返回非 202:
       删除磁盘缓存目录
       返回上游错误状态码和消息                  ← 终止

9. 在数据库中写入任务记录（含 cache_dir、idempotency_key）
   如果 写入成功:
       返回 202 + Gateway 响应体
   如果 唯一约束冲突（并发 idempotency_key）:
       回滚当前事务
       删除磁盘缓存目录
       重新查询命中记录 → 按步骤 2 的命中逻辑返回 202 + X-Idempotency-Key-Replayed（不变）
```

## 2. FileCache 契约变更

### 2.1 新增方法

FileCache 新增一个支持流式写入的方法：

```
create_streaming_cache() → CacheWriter
```

返回一个 `CacheWriter` 对象，行为契约如下：

- 内部创建一个新的缓存目录（`<base_dir>/<uuid>/`）。
- 文件按流中首次出现的顺序分配 blob 名称（`blob-0`、`blob-1`、…），与 multipart part 的出现顺序一致。
- 同一 `(field, filename, content_type)` 组合的后续 chunk 追加到同一个 blob 文件，不会创建新文件。

| 操作 | 行为 |
|------|------|
| `write_file_chunk(field, filename, content_type, data: bytes)` | 将一段文件内容 chunk 追加到对应该 field + filename 的 blob 文件中。首次调用时为该文件创建新的 blob 文件；后续调用追加写入同一 blob。 |
| `finish(form_fields: dict) → str` | 写入 `form.json`（form 字段）和 `files.json`（blob 清单，按 stream 中出现顺序排列），完成缓存目录的创建。返回 `cache_dir` 路径。调用后该目录可被 `restore()` 完整恢复。 |
| `cancel()` | 移除整个缓存目录及其所有文件，无论写入进行到哪个阶段。用于上传中断、超限或异常时确保不残留部分文件。 |

**调用约束**：任一 `CacheWriter` 实例上，`finish()` 和 `cancel()` 最多调用一次，且二者互斥。调用其中任一个后，该实例不再允许追加写入。

**移除的方法**：

- `store(data, files)` — 移除。流式解析直接写入 `cache_dir`，无调用方。

**不变的方法**：

- `restore(cache_dir) → (data, files)` — 完全不变。从磁盘 blobs 读取文件字节到内存，返回 `(data, Files)`。retry 循环依赖此方法。
- `release(cache_dir)` — 完全不变。删除缓存目录。
- `exists(cache_dir) → bool` — 完全不变。

### 2.2 缓存目录布局

不变。流式写入产生的目录结构与变更前一致：

```
<base_dir>/<uuid>/
    form.json          # 非文件 form 字段的 JSON
    files.json         # [{field, filename, content_type, blob}]
    blob-0, blob-1 ... # 原始文件字节
```

唯一的差异：`blob-N` 文件在流式写入时以追加方式逐 chunk 增长，而非一次性 `write(content)`。对 `restore()` 而言，读取行为——从 blob 文件开头读到 EOF——完全不变。

### 2.3 缓存目录清理

以下场景必须清理未完成的/不再需要的缓存目录：

| 场景 | 清理方式 |
|------|----------|
| 上传超限（413） | `CacheWriter.cancel()` — 移除整个目录及其部分写入的 blobs |
| 上传过程中客户端断开连接 | `CacheWriter.cancel()` — 同上 |
| 上游拒绝（非 202） | `cache.release(cache_dir)` — 与当前行为一致 |
| 幂等冲突（`IntegrityError`） | `cache.release(cache_dir)` — 与当前行为一致 |
| 匿名提交完成（转发后） | `cache.release(cache_dir)` — 匿名路径不留缓存 |
| 任务到达终态（completed/failed/cancelled） | `cache.release(cache_dir)` — 后台状态同步触发，与当前行为一致 |
| 任务过期清理 | `cache.release(cache_dir)` — 后台清理循环触发，与当前行为一致 |

## 3. 大小检查语义变更

### 3.1 变更前

`_extract_multipart` 在完整读取每个 `UploadFile` 后检查 `len(content) > max_upload_size or total_bytes > max_upload_size`。触发时抛出 `HTTPException(413)`。

含义：客户端已经完成整个文件上传（所有字节已传输），才被告知拒绝。

### 3.2 变更后

流式解析过程中，每接收到一个 chunk，计算**累计接收的字节数**（含表单字段字节 + 文件字节）
与 `max_upload_size` 的比较。若结果超过 `max_upload_size`：

1. 立即停止从 `request.stream()` 读取后续数据。
2. 调用 `CacheWriter.cancel()` 移除当前缓存目录。
3. 返回 `413 Payload Too Large`，错误消息中包含 `max_upload_size` 的字节数。

含义：客户端在上传过程中收到 413，无需完成整个上传即可得知被拒绝。

**注意**：HTTP 层面，服务器在检测到超限后不再消费流的剩余部分。实际连接行为取决于 ASGI 服务器（uvicorn）与客户端的 TCP 交互——已发送但未处理的字节可能被 RST 或 413 响应的 FIN 携带。这不影响语义正确性：网关不会将超限文件写入磁盘或转发至上游。

## 4. 错误场景

### 4.1 客户端中途断开

若在流式解析过程中客户端断开连接（TCP RST / 连接关闭），`request.stream()` 的 next chunk 触发异常（具体异常类型由 ASGI 框架/服务器抛出，如 `asyncio.CancelledError` 或 `IOError` 等）。处理方式：

1. `CacheWriter.cancel()` 被调用，清理已写入的部分缓存文件。
2. 异常向上传播——FastAPI/Starlette 将返回 4xx/5xx 或不返回响应（取决于断开时机）。
3. 不创建 TaskRecord。

### 4.2 磁盘写入失败

若在流式写入文件时磁盘写满或 I/O 出错：

1. `CacheWriter` 记录写入失败。
2. `CacheWriter.cancel()` 清理部分文件。
3. 向客户端返回 `500 Internal Server Error`。

### 4.3 上游转发时缓存目录不存在

若在上游转发阶段发现 `cache_dir` 目录不存在（例如系统管理员手动删除，或磁盘故障）：

1. 返回 `500 Internal Server Error`。
2. 不创建 TaskRecord（因为无法可靠重试——源文件已丢失）。

## 5. 与幂等提交的交互

### 5.1 幂等命中时（已有记录）

不受影响——幂等检查发生在上游健康门控之前、流式解析之前。命中时跳过所有后续步骤，不读取 multipart body。详见 §1.4 步骤 2。

### 5.2 幂等未命中、但并发冲突时（IntegrityError）

不受影响——唯一约束冲突后的恢复路径调用 `cache.release(cache_dir)` 清理缓存目录，该 API 不受流式改造影响。详见 §1.4 步骤 9。

## 6. 测试场景

以下测试场景覆盖流式上传的全部预期行为。所有测试针对 `POST /tasks` 端点，使用有效的 API Key，并 mock 上游返回 `202`。

### 6.1 基本功能

**T1 — 小文件正常提交（回归）**
向 `POST /tasks` 提交一个包含小文件（如 10KB）和若干 form 字段的 multipart 请求。验证：

- 返回 `202`，响应体包含 `task_id`。
- 数据库中 TaskRecord 的 `file_names`、`file_count`、`file_total_bytes` 与上传内容一致。
- `file_total_bytes` 等于上传文件的实际字节数。
- 缓存目录 `cache_dir` 存在、`form.json` 内容正确、`files.json` manifest 与上传一致、blob 文件内容与原始文件一致。

**T2 — 多文件提交（回归）**
提交包含 3 个不同大小文件的 multipart 请求。验证：

- 返回 `202`，`file_names` 列表包含 3 个文件名，`file_count=3`，`file_total_bytes` 为 3 个文件大小之和。
- 缓存目录下有 3 个 blob 文件（`blob-0`、`blob-1`、`blob-2`），各自内容正确。

**T3 — Form 字段透传（回归）**
提交包含 form 字段（`backend`、`parse_method`、布尔标志如 `return_md=true`）和文件的请求。验证：

- TaskRecord 的 `parse_params` 中正确记录了这些字段。
- 上游收到的 multipart body 中包含相同的 form 字段值。

**T4 — 匿名提交（回归）**
配置 `GATEWAY_ALLOW_ANONYMOUS=true`，不提供 `X-API-Key`。提交一个包含文件的 multipart 请求。验证：

- 返回上游的原始响应（202 及其 body）。
- 数据库中无 TaskRecord。
- 缓存目录在转发后被清理（不存在于文件系统中）。

### 6.2 流式特性

**T5 — 大文件内存占用（上传阶段）**
提交一个 300 MB 的单文件（或多文件合计 300 MB）。验证：

- 网关进程在**上传阶段（接收 body 并写入磁盘期间）**的内存增量为常数量级（不随文件大小增长）。
- 返回 `202`，`file_total_bytes` 正确为实际字节数。

**T6 — 超限立即拒绝**
设置 `max_upload_size=100MB`，提交一个 150 MB 的文件。验证：

- 返回 `413 Payload Too Large`。
- 响应在客户端完成整个上传前返回（可观测为：在客户端仍在发送数据时收到 413 响应）。
- 无缓存目录残留（文件系统中无对应 cache_dir）。
- 数据库中无 TaskRecord。

**T7 — 超限恰好等于上限**
`max_upload_size=100MB`，提交恰好 100MB 的文件。验证：

- 返回 `202`，正常创建任务。
- `file_total_bytes` = 100MB。

**T8 — 多文件超限（累计）**
`max_upload_size=50MB`，提交 3 个文件各 20MB。前两个文件正常接收，在第三个文件接收过程中总字节超过 50MB。验证：

- 返回 `413`（在第三个文件未完全接收时返回）。
- 无缓存目录残留。

### 6.3 错误恢复

**T9 — 客户端中途断开**
在流式解析过程中模拟客户端断开连接（在 mock 中使 `request.stream()` 抛出异常）。验证：

- 已写入的部分缓存文件被清理（`CacheWriter.cancel()` 被调用）。
- 不创建 TaskRecord。

**T10 — 上游拒绝**
mock 上游返回 `400 Bad Request`（非 202）。验证：

- 缓存目录被清理（`cache.release(cache_dir)` 被调用）。
- 客户端收到 400 状态码和上游的错误消息。

**T11 — 幂等冲突（IntegrityError）**
两个请求携带相同 API Key 和 `X-Idempotency-Key` 几乎同时到达。第一个成功创建 TaskRecord，第二个触发 `IntegrityError`。验证：

- 第二个请求的缓存目录在冲突恢复中被清理。
- 第二个请求返回 `202` + `X-Idempotency-Key-Replayed: true`。
- 数据库中仅有一条 TaskRecord。

### 6.4 幂等交互

**T12 — 幂等命中时不读取 body**
使用已在数据库中存在的 `X-Idempotency-Key` 提交一个巨大的 multipart 请求。Mock 验证：

- 返回 `202` + `X-Idempotency-Key-Replayed: true`。
- 响应几乎即时返回（不等待 body 传输完成）。
- 没有文件被写入缓存目录。

**T13 — 幂等命中时不因大小超限被拒**
数据库中已有某个 idempotency key 的记录。客户端使用同一 key 提交一个远超 `max_upload_size` 的文件。验证：

- 返回 `202`（幂等命中），不是 `413`。
- 响应在客户端仍在发送文件 body 时即可返回。

### 6.5 retry 循环兼容性

**T14 — retry 循环恢复流式缓存的文件**
通过流式上传创建一个任务，该任务的状态同步失败后进入 `retry_pending`。验证：

- retry 循环调用 `cache.restore(cache_dir)` 成功恢复 `(data, files)`。
- `data` dict 与原始 form 字段一致。
- `files` 列表中每个文件的 bytes 内容与原始上传一致。
- 重提至上游成功，任务从 `retry_pending` 回到 `pending`。

### 6.6 handle_file_parse 不变

**T15 — file_parse 行为不变**
向 `POST /file_parse` 提交文件。验证：

- 行为与变更前完全一致：正常返回上游响应。
- 认证请求的 TaskRecord 正确创建。

## 7. 影响范围

| 文件 | 变更类型 | 变更说明 |
|------|----------|----------|
| `src/mineru_gateway/proxy/handler.py` | 修改 | 新增 `_extract_multipart_streaming` 函数（流式解析）；保留原 `_extract_multipart` 供 `handle_file_parse` 使用；`handle_task_submission` 改用流式解析并适配新返回值（`cache_dir` 替代 `files`）；匿名路径适配 |
| `src/mineru_gateway/tasks/cache.py` | 修改 | 新增 `create_streaming_cache()` 方法和 `CacheWriter` 类；移除 `store()`；`restore`/`release`/`exists` 保留不变 |
| `src/mineru_gateway/upstream/client.py` | 不修改 | `submit_task` 签名不变——仍接受 `(data, files)`；`files` 由调用方从 `cache_dir` 读取后构造 |
| `src/mineru_gateway/models.py` | 不修改 | 无 schema 变更 |
| `alembic/versions/` | 不修改 | 无迁移 |
| `tests/core/test_proxy.py` | 修改 | 新增 T1-T15 测试场景；适配 mock 上游使其接受 streaming body |
| `pyproject.toml` | 修改 | `uv add aiofiles` 引入依赖 |
| `specs/streaming-upload.md` | 新增 | 本文件 |
