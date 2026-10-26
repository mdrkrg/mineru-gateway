# 流式上传 实现规约

> 基于 `specs/mvp-implementation.md`（提交流程、FileCache）、`specs/idempotent-submission.md`（幂等提交行为）。
> 本规约定义 `POST /v1/tasks` 端点的流式 multipart 上传行为，避免接收大文件时在内存中完整缓冲。

## 0. 目标与非目标

### 目标

1. `POST /v1/tasks` 端点在上传阶段（接收客户端 multipart body）的内存上限由解析 chunk 和 metadata 限额决定，与单个文件大小解耦。
2. 上传大小检查从「完整读取后判断」改为「文件字节实时累计」：单文件超过 `max_file_size` 或文件总量超过 `max_upload_size` 时，立即中止流并返回 413。
3. 明确流式处理与幂等提交、限流和全局并发检查的执行顺序及清理责任。
4. FileCache 生成可由 crash recovery（retry 循环）恢复并重提的磁盘缓存。

### 非目标

- 匿名请求的端到端内存优化：匿名提交（`api_key is None`）从客户端接收 body 时使用流式解析（内存占用同样 bounded），但转发到上游时仍使用全量读取（与当前行为一致）。匿名路径不是大文件流量的主要入口。
- 上游转发的内存优化：认证提交在流式缓存到磁盘后，使用现有 buffered 方式从磁盘读取并转发到上游。本规约解决的是「网关接收上传」阶段的内存问题；「网关转发」阶段的内存优化留待后续（见 §1 决策理由）。
- `POST /v1/file_parse` 使用 `request.form()` 全量缓冲，属于独立的同步解析流程。
- `POST /v1/tasks/result-zip` 和 `GET /v1/tasks/{id}/result` 的流式改造：属 A10 流式下载规约范围。
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

本节定义 `POST /v1/tasks` 的 multipart 解析；认证、幂等、限流、并发检查和 TaskRecord 创建的执行顺序见 §1.3–1.4。

### 1.1 函数变更：新增 `_extract_multipart_streaming`

`_extract_multipart` 服务于 `handle_file_parse`；`handle_task_submission` 使用新增的流式解析函数：

```
_extract_multipart_streaming(request, max_upload_size, max_file_size, cache)
    → (data: dict, cache_dir: str, file_names: list[str], total_bytes: int)
```

该函数的流式行为如下：

| 行为项 | 变更前 | 变更后 |
|--------|--------|--------|
| 解析方式 | `request.form()` 全量加载到内存 | 流式 multipart parser，每次处理一个 chunk |
| 文件内容存储 | `UploadFile.read()` 为 `bytes` 对象，全部驻留内存 | 以 chunk 为单位写入 FileCache 磁盘目录，不在内存中累积 |
| 表单字段存储 | 作为 `dict` value 驻留内存 | 作为 `dict` value 驻留内存 |
| 大小检查时机 | 每个文件完整读取后检查单文件及累计文件字节 | 每个文件 chunk 到达时检查 `max_file_size` 与累计 `max_upload_size` |
| 超限后行为 | 已完整读取，抛出 413（body 已全在内存） | 立即停止解析、关闭流、返回 413；未完成的缓存目录被清理 |
| 返回值 | `(data: dict, files: Files, file_names: list[str], total_bytes: int)` | `(data: dict, cache_dir: str, file_names: list[str], total_bytes: int)` |
| 返回的 `files` | 文件内容为 `bytes` | 不再返回文件字节列表；文件已在 `cache_dir` 下 |

**返回值契约**：

- `data` 保存普通 form 字段；可重复的 `output_formats` 按出现顺序累积。
- `file_names` 按 multipart 文件 part 的出现顺序保存 `filename`。
- `total_bytes` 为所有文件内容的累计字节数。

> **注意**：`total_bytes` 与 `max_upload_size` 都只统计文件内容，不统计 multipart
> framing 或普通表单字段。普通字段另设 **1 MiB** 累计上限；每任务另限
> **100 个文件**。为避免零字节字段和超长 part header 绕过字节限制，解析器
> 还限制 **100 个普通字段**、每 part **32 个 header**、单 header **16 KiB**，
> 且 multipart part 总数不超过文件与普通字段上限之和；零字节文件返回 400。

- `parse_v1_params` 从 `data` 构造并验证 MinerU V1 query 参数。

### 1.2 后续流程适应性变更

由于 `_extract_multipart_streaming` 返回 `cache_dir`（替代原 `files`），提交流程中的后续步骤相应调整：

**认证路径（`api_key is not None`）**：

- `cache_dir` 由 `_extract_multipart_streaming` 直接返回，不再通过单独的 `cache.store()` 调用获取。

**匿名路径（`api_key is None`）**：

- 文件同样通过流式解析写入临时 `cache_dir`，但转发到上游后该目录被立即清理（`cache.release(cache_dir)`），不创建 TaskRecord，不保留缓存。

### 1.3 流程约束

- 认证、幂等预检查和速率限制在读取 multipart body 前执行。
- 全局并发检查在解析后、转发上游前执行。
- `TaskRecord` 创建使用解析出的文件元数据、缓存目录和 V1 参数。
- `handle_file_parse` 继续使用 `_extract_multipart` 全量缓冲。

### 1.4 处理步骤概览（变更后）

```
接收 POST /v1/tasks 请求

1. 解析 X-API-Key 请求头
   如果 Key 无效且不允许匿名 → 返回 401

2. 如果 是认证请求 且 提供了有效 X-Idempotency-Key:
     在数据库中查询 (api_key, idempotency_key)
     如果 命中:
         从已有记录重构响应（status 始终为 "pending"）
         附加 X-Idempotency-Key-Replayed: true
         返回 202                           ← 终止，不读取 body

3. 如果 是认证请求:
     按 key 扣减令牌桶
      如果 无可用令牌 → 返回 429 Retry-After: 60

4. 流式解析 multipart body:                          ← 变更
     - 遍历客户端字节流，每个 part 按 chunk 读取
     - 表单字段 → 累积到 data dict（内存）
     - 文件字段 → 每 chunk 直接写入磁盘缓存目录（不驻留内存）
     - file_names 按出现顺序记录
     - 每个文件 chunk 到达时，检查当前文件是否超过 max_file_size、
       total_bytes + len(chunk) 是否超过 max_upload_size
       如果 超过:
          停止读取流
          删除已写入的缓存目录
          返回 413
       如果 未超过:
          total_bytes += len(chunk)
          写入 chunk 到磁盘

5. 如果 是匿名请求:
      从磁盘缓存目录全量读取文件
      转发 multipart 到上游
      删除磁盘缓存目录（不留存）
      返回上游响应                              ← 终止

6. 统计当前 in-flight 任务数
   如果 达到全局并发上限 → 返回 503 Retry-After: 10

7. 从磁盘缓存目录读取文件
   转发 multipart 到上游
   如果 上游返回非 202:
        删除磁盘缓存目录
        返回上游响应（状态码、头部、body）原样透传   ← 终止

8. 在数据库中写入任务记录（含 cache_dir、idempotency_key）
   如果 写入成功:
       返回 202 + Gateway 响应体
   如果 唯一约束冲突（并发 idempotency_key）:
       回滚当前事务
       删除磁盘缓存目录
       重新查询命中记录 → 按步骤 2 的命中逻辑返回 202 + X-Idempotency-Key-Replayed
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
- 每个文件 part 对应一个独立 blob。同一 part 内的后续 chunk 追加到同一 blob；新的 part 总是分配新 blob，即使其 `(field, filename)` 与之前的 part 相同（同名文件是不同文件，不得合并）。

| 操作 | 行为 |
|------|------|
| `write_file_chunk(field, filename, content_type, data: bytes, new_part: bool = False)` | 将一个文件内容 chunk 写入对应 part 的 blob。`new_part=True`（multipart 每个文件 part 的首个 chunk）时总是创建新 blob；否则追加到该 `(field, filename)` 当前 part 的 blob。 |
| `finish(form_fields: dict) → str` | 写入 `form.json`（form 字段）和 `files.json`（blob 清单，按 stream 中出现顺序排列），完成缓存目录的创建。返回 `cache_dir` 路径。调用后该目录可被 `restore()` 完整恢复。 |
| `cancel()` | 移除整个缓存目录及其所有文件，无论写入进行到哪个阶段。用于上传中断、超限或异常时确保不残留部分文件。 |

**调用约束**：任一 `CacheWriter` 实例上，`finish()` 和 `cancel()` 最多调用一次，且二者互斥。调用其中任一个后，该实例不再允许追加写入。

**兼容接口**：

- `store(data, files) → str` — 将已缓冲文件写入缓存；`/v1/file_parse` 返回 202 时用于把同步上传转为可恢复任务。
- `restore(cache_dir) → (data, files)` — 从磁盘 blobs 读取文件字节到内存，返回 `(data, Files)`；retry 循环依赖此方法。
- `release(cache_dir)` — 删除缓存目录。
- `exists(cache_dir) → bool` — 检查缓存目录是否存在。

### 2.2 缓存目录布局

`CacheWriter` 产生以下目录结构：

```
<base_dir>/<uuid>/
    form.json          # 非文件 form 字段的 JSON
    files.json         # [{field, filename, content_type, blob}]
    blob-0, blob-1 ... # 原始文件字节
```

`blob-N` 在流式写入时逐 chunk 追加；`restore()` 从文件开头读取到 EOF。

### 2.3 缓存目录清理

以下场景必须清理未完成的/不再需要的缓存目录：

| 场景 | 清理方式 |
|------|----------|
| 上传超限（413） | `CacheWriter.cancel()` — 移除整个目录及其部分写入的 blobs |
| 上传过程中客户端断开连接 | `CacheWriter.cancel()` — 同上 |
| 上游拒绝（非 202） | `cache.release(cache_dir)` |
| 幂等冲突（`IntegrityError`） | `cache.release(cache_dir)` |
| 匿名提交完成（转发后） | `cache.release(cache_dir)` — 匿名路径不留缓存 |
| 任务到达终态（completed/partial/failed/cancelled） | 后台状态同步调用 `cache.release(cache_dir)` |
| 任务过期清理 | 后台清理循环调用 `cache.release(cache_dir)` |

## 3. 大小检查语义变更

### 3.1 变更前

`_extract_multipart` 在完整读取每个 `UploadFile` 后检查 `len(content) > max_file_size` 与 `total_bytes > max_upload_size`。触发时抛出 `HTTPException(413)`。

含义：客户端已经完成整个文件上传（所有字节已传输），才被告知拒绝。

### 3.2 变更后

流式解析过程中，每接收到一个文件 chunk，分别计算**当前文件字节数**与
**所有文件累计字节数**。若前者超过 `max_file_size` 或后者超过
`max_upload_size`：

1. 立即停止从 `request.stream()` 读取后续数据。
2. 调用 `CacheWriter.cancel()` 移除当前缓存目录。
3. 返回 `413 Payload Too Large`，错误消息中包含对应限制的字节数。

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

幂等检查发生在流式解析之前。命中时跳过后续步骤，不解析 multipart body。详见 §1.4 步骤 2。

### 5.2 幂等未命中、但并发冲突时（IntegrityError）

唯一约束冲突后的恢复路径调用 `cache.release(cache_dir)` 清理缓存目录。详见 §1.4 步骤 8。

## 6. 测试场景

核心自动化测试位于 `tests/core/test_streaming_upload.py`；真实 HTTP 内存检查位于 `tests/perf/stream_memory.py`。除匿名场景外，请求均使用有效 API Key，并 mock 上游返回 `202`。

### 6.1 基本功能

**T1 — 小文件正常提交（回归）**
向 `POST /v1/tasks` 提交一个包含小文件（如 10KB）和若干 form 字段的 multipart 请求。验证：

- 返回 `202`，响应体包含 `task_id`。
- 数据库中 TaskRecord 的 `file_names`、`file_count`、`file_total_bytes` 与上传内容一致。
- `file_total_bytes` 等于上传文件的实际字节数。
- 缓存目录 `cache_dir` 存在、`form.json` 内容正确、`files.json` manifest 与上传一致、blob 文件内容与原始文件一致。

**T2 — 多文件提交（回归）**
提交包含 3 个不同大小文件的 multipart 请求。验证：

- 返回 `202`，`file_names` 列表包含 3 个文件名，`file_count=3`，`file_total_bytes` 为 3 个文件大小之和。
- 缓存目录下有 3 个 blob 文件（`blob-0`、`blob-1`、`blob-2`），各自内容正确。

**T3 — Form 字段透传（回归）**
提交包含原生 V1 form 字段（`tier`、`ocr_mode`、`output_formats`）和文件的请求。验证：

- TaskRecord 的 `parse_params` 中正确记录了这些字段。
- 上游收到相同语义的 V1 query 参数；上游 multipart body 只包含名为 `files` 的文件 part。

**T4 — 匿名提交（回归）**
配置 `GATEWAY_ALLOW_ANONYMOUS=true`，不提供 `X-API-Key`。提交一个包含文件的 multipart 请求。验证：

- 返回上游的原始响应（202 及其 body）。
- 数据库中无 TaskRecord。
- 缓存目录在转发后被清理（不存在于文件系统中）。

### 6.2 流式特性

**T5 — 流式解析与大文件内存占用**

- 核心测试验证 `/v1/tasks` 使用 `request.stream()`，不调用 `request.form()`。
- 性能脚本通过真实 HTTP 上传大文件并采样 Gateway RSS，验证上传阶段内存增长有界。

**T6 — 超限立即拒绝**
设置 `max_upload_size=100 MiB`，提交一个 150 MiB 的文件。验证：

- 返回 `413 Payload Too Large`。
- 无缓存目录残留（文件系统中无对应 cache_dir）。
- 数据库中无 TaskRecord。

**T7 — 超限恰好等于上限**
`max_upload_size=100 MiB`，提交恰好 100 MiB 的文件。验证：

- 返回 `202`，正常创建任务。
- `file_total_bytes` = 100 MiB。

**T8 — 多文件超限（累计）**
`max_upload_size=50 MiB`，提交 3 个文件各 20 MiB。前两个文件正常接收，在第三个文件接收过程中总字节超过 50 MiB。验证：

- 返回 `413`（在第三个文件未完全接收时返回）。
- 无缓存目录残留。

**T8b — 单文件超限**
设置 `max_file_size` 小于 `max_upload_size`，提交超过单文件限制但未超过总量限制的文件。验证返回 413 且无任务/缓存残留。

**T8c — multipart header 跨 chunk**
将同一合法 multipart body 按单字节切分，并使用带引号且后接其他参数的
boundary。验证被拆分的 header field/value 会累计到 `on_header_end` 后再解析，
文件名、类型、字段值和内容均保持完整。

**T8d — multipart 元数据限制与空文件**
分别提交超长 part header、超过 100 个普通字段以及零字节文件。验证前两者
返回 413，零字节文件按 MinerU 4.0 行为返回 400，且三种情况均无缓存目录或
TaskRecord 残留。

### 6.3 错误恢复

**T9 — 解析或缓存结束失败**
在流式解析或 `CacheWriter.finish()` 过程中注入异常。验证：

- 已写入的部分缓存文件被清理。
- 清理失败不会掩盖原始异常。
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

**T12 — 幂等命中时跳过 body 解析**
使用已存在的 `X-Idempotency-Key` 提交超过 `max_upload_size` 的 multipart 请求。验证：

- 返回 `202` + `X-Idempotency-Key-Replayed: true`。
- 返回 `202`、原任务 ID 和 replay 响应头。
- 不创建新的缓存目录。

### 6.5 retry 循环兼容性

**T14 — retry 循环恢复流式缓存的文件**
使用 `CacheWriter` 写入多个文件和表单字段后，验证：

- `cache.restore(cache_dir)` 成功恢复 `(data, files)`。
- `data` dict 与原始 form 字段一致。
- `files` 列表中每个文件的 bytes 内容与原始上传一致。

`/v1/file_parse` 的代理与持久化行为由 `tests/core/test_proxy.py` 覆盖。

## 7. 影响范围

| 文件 | 变更类型 | 变更说明 |
|------|----------|----------|
| `src/mineru_gateway/proxy/handler.py` | 修改 | 新增 `_extract_multipart_streaming` 函数（流式解析）；`_extract_multipart` 服务于 `handle_file_parse`；`handle_task_submission` 使用 `cache_dir` 并适配匿名路径 |
| `src/mineru_gateway/tasks/cache.py` | 修改 | 新增 `create_streaming_cache()` 方法和 `CacheWriter` 类；`store`/`restore`/`release`/`exists` 保留 |
| `src/mineru_gateway/upstream/client.py` | 复用 | `submit_task(params, files)` 继续接收从 `cache_dir` 恢复出的文件 |
| `tests/core/test_streaming_upload.py` | 新增 | 覆盖流式解析、限额、清理、幂等和缓存恢复 |
| `tests/perf/stream_memory.py` | 新增 | 通过真实 HTTP 检查大文件上传时的 RSS 增量 |
| `pyproject.toml` | 修改 | 引入 `aiofiles` 和 `python-multipart` |
