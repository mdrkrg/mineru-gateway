# 幂等提交 (X-Idempotency-Key) 实现规约

> 基于 `specs/mvp-implementation.md`（数据模型、提交流程）、`plans/future-enhancements.md` B1（幂等提交方案）。
> 本规约定义 `POST /tasks` 端点的幂等提交行为，使客户端在网络不稳定时安全重试而不产生重复任务。

## 0. 目标与非目标

### 目标

1. 客户端通过 `X-Idempotency-Key` 请求头实现 `POST /tasks` 的幂等提交：同一 API Key 下相同 idempotency key 的重复请求，返回首次请求的结果，不会创建重复任务。
2. 幂等命中时跳过限流、multipart body 读取、全局并发检查——重试成本为一次极轻量数据库查询。
3. 并发场景下（同一 idempotency key 的多个请求几乎同时到达），通过数据库唯一约束保证最终仅有一条任务记录落库。

### 非目标

- `POST /file_parse` 不实现幂等提交（该端点为同步解析，结果即时返回，无可复用的异步任务记录）。
- 匿名请求（`api_key is None`）不参与去重——`X-Idempotency-Key` 被忽略，保持纯透传行为不变。
- 不校验请求 payload 一致性（见 §1）。

## 1. 核心设计决策

基于 `plans/future-enhancements.md` B1 方案及项目现状：

| 决策 | 选择 | 理由 |
|------|------|------|
| 检查时机 | 认证后、限流前 | 命中时跳过限流，合法重试不消耗配额；跳过 multipart 读取免去大文件内存开销 |
| 冲突域 | 每 API Key | 唯一约束为 `(api_key_id, idempotency_key)`；不同 Key 可用相同 key 同时提交 |
| 命中响应 | 从 `TaskRecord` 字段重构 JSON | 无需缓存原始响应体，字段均已在 DB |
| 命中 `status` | 始终为 `"pending"` | 与首次提交的响应体一致，不查询上游当前状态 |
| 匿名请求 | 不参与去重 | 匿名走纯透传路径（不落库），`X-Idempotency-Key` 被忽略；`TaskRecord.api_key_id` 始终 NOT NULL |
| Payload 一致性 | 不校验 | 简化实现，符合 Stripe 惯例 |

## 2. 数据模型变更

### 2.1 `TaskRecord` 新增字段

在 `src/mineru_gateway/models.py` 的 `TaskRecord` 中新增：

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `idempotency_key` | `str \| None` | `String(255)`, nullable | 客户端提供的幂等键；NULL 表示未启用幂等（含迁移前已有记录、不带 X-Idempotency-Key 的 POST /tasks、及 POST /file_parse 记录） |

### 2.2 新增唯一约束

在 `TaskRecord.__table_args__` 中新增：

```
UniqueConstraint("api_key_id", "idempotency_key")
```

约束名：`uq_tasks_key_idempotency`。

SQL 标准下 NULL 不参与唯一性比较，因此已有的 `idempotency_key=NULL` 记录不触发冲突，多条不带幂等键的提交也可共存。

## 3. API 变更

### 3.1 请求头

`POST /tasks` 新增**可选**请求头：

```http
X-Idempotency-Key: <string>
```

- 长度上限 255 字符。超出返回 `422 Unprocessable Entity`。
- 空字符串或全空白字符：视为未提供，不启用幂等。

### 3.2 响应头

幂等命中时新增响应头：

```http
X-Idempotency-Key-Replayed: true
```

此头仅当请求被识别为重复提交时出现。客户端可据此判断首次提交是否成功——若无此头，说明这是首次提交（或未启用幂等）；若有，说明响应来自已有记录。

### 3.3 响应体（幂等命中时）

幂等命中时返回的 JSON body 与首次提交时完全一致。字段从已有 `TaskRecord` 重构：`task_id`、`status`、`backend`、`file_names`、`created_at`、`status_url`、`result_url`、`started_at`（null）、`completed_at`（null）、`error`（null）、`message`。

同时携带与首次提交相同的响应头：`X-MinerU-Task-Id`、`X-MinerU-Task-Status`、`X-MinerU-Task-Status-Url`、`X-MinerU-Task-Result-Url`。

## 4. 处理流程详解

本节描述 `POST /tasks` 端点在 `X-Idempotency-Key` 介入后的完整处理流程。每个步骤说明触发条件、执行内容及与现有行为的差异。

**前置约定** — 以下术语沿用现有实现的行为定义，下文不另行解释：

| 术语 | 定义 |
|------|------|
| `require_api_key` | 解析 `X-API-Key` 请求头，返回 `ApiKey` 对象。若未提供 Key 且 `GATEWAY_ALLOW_ANONYMOUS=true`（环境变量，默认 `false`）则返回 `None` |
| `MemoryTokenBucket` | 进程内按 Key 的令牌桶限流器。默认速率 10 令牌/秒，桶容量 burst=30。通过 `limiter.acquire(key_id)` 消费令牌 |
| `_extract_multipart` | 全量读取 multipart form 到内存，逐文件校验大小 ≤ `max_upload_size`（默认 500MB）。返回 data dict + files 列表 |
| `count_in_flight` | 统计 DB 中 `status IN ('pending', 'processing', 'retry_pending')` 的任务数。超出 `max_concurrent_tasks`（默认 0 = 不限）时返回 503 |
| `cache.store` | 将 multipart 暂存到本地磁盘目录 `file_cache_dir`，返回 `cache_dir` 路径。用于崩溃后重提 |
| `task_retention_days` | 配置项（默认 90 天）。后台清理循环按此 TTL 删除过期 `TaskRecord` |
| `retry_pending` | `TaskRecord` 状态之一。待重提的任务，计入全局并发额度 |

### 4.1 步骤概览

```
认证门控 (require_api_key)
    │
    ▼
幂等检查（仅认证请求、非空 key）
    ├── 命中 ──→ 返回 202 + 重构响应 + X-Idempotency-Key-Replayed ──→ 终止
    │
    └── 未命中 ──→ 继续
                    │
                    ▼
             速率限制 (MemoryTokenBucket)
                    │
                    ▼
             提取 multipart body (_extract_multipart)
                    │
                    ├── 匿名 → 纯透传（上游提交，不记录 DB）
                    │
                    └── 认证
                          │
                          ▼
                   全局并发检查 (count_in_flight)
                          │
                          ▼
                   暂存文件到本地磁盘 (cache.store)
                          │
                          ▼
                   转发到上游 (upstream.submit_task)
                          ├── 上游拒绝 → 释放缓存 + 返回上游错误
                          │
                          └── 上游接受 (202)
                                │
                                ▼
                         创建 TaskRecord (task_service.create)
                          含 idempotency_key
                                │
                                ├── 成功 → 返回 202 + Gateway 响应
                                │
                                └── IntegrityError（唯一约束冲突）
                                    → 并发场景处理（见 §4.4）
```

### 4.2 步骤 1：认证门控（现有行为，不变）

`require_api_key` 依赖项解析 `X-API-Key` 请求头。返回 `ApiKey` 对象（认证成功）或 `None`（`GATEWAY_ALLOW_ANONYMOUS=true` 且未提供 Key）。

### 4.3 步骤 2：幂等检查（新增）

**触发条件**：`api_key is not None` 且 `X-Idempotency-Key` 请求头存在且有效。

**执行内容**：

1. 从请求头提取 `X-Idempotency-Key` 的值。
2. 校验长度 ≤ 255 字符，超出返回 422。
3. 去除首尾空白；若结果为空字符串，视为未提供，跳过幂等。
4. 在数据库中按 `api_key_id` 和 `idempotency_key` 查询是否存在匹配的 TaskRecord。
5. 若命中（查询返回一条 `TaskRecord`）：停止后续处理，从该记录字段重构响应体与响应头，返回 `202 Accepted`，附加 `X-Idempotency-Key-Replayed: true`。
6. 若未命中（查询无结果）：释放 idempotency key 值传递到后续流程，继续步骤 3。

**关键行为**：

- 命中时**不消耗限流令牌**，不调用 `limiter.acquire`。
- 命中时**不读取 multipart body**，不解码请求体，避免大文件内存开销。
- 命中时不等同于 "任务已完成"。返回的 `status` 始终为 `"pending"`（首次提交时的值），客户端仍需通过 `GET /tasks/{task_id}` 轮询最终状态。
- 匿名请求跳过此步骤，`X-Idempotency-Key` 被忽略。

### 4.4 步骤 3-7：现有提交流程（行为不变，仅新增 idempotency_key 传递）

速率限制、multipart 提取、并发检查、文件暂存、上游提交均保持现有行为不变。唯一差异：创建 `TaskRecord` 时写入 `idempotency_key`（见步骤 8）。

### 4.5 步骤 8：创建 TaskRecord（现有行为 + 新增字段 + 新增并发处理）

调用 `task_service.create` 时传入 `idempotency_key` 字段。

**并发冲突处理**：

若两个请求携带相同 `X-Idempotency-Key` 几乎同时到达，在步骤 2 时两者均未查到已有记录，均执行了完整提交流程。当两者都到达步骤 8 尝试写入数据库时：

1. 第一个完成 `INSERT` 的请求成功创建 `TaskRecord`，返回 `202`。
2. 第二个请求在 `INSERT` 时触发唯一约束冲突（`IntegrityError`）。

第二个请求的恢复流程：

1. 捕获 `IntegrityError`，回滚当前事务。
2. 释放已分配的文件暂存目录（`cache_dir`），防止磁盘泄漏。
3. 在新事务中重新查询 `SELECT * FROM tasks WHERE api_key_id = <X> AND idempotency_key = <Y>`。
4. 此时已有记录（由第一个请求创建），按幂等命中返回：`202` + 重构响应 + `X-Idempotency-Key-Replayed: true`。

**孤儿上游任务**：第二个请求在冲突前可能已成功提交到上游，获得了 `upstream_task_id`。该上游任务不会被网关追踪（无对应 `TaskRecord` 引用），但无实际危害——上游有其自身的 TTL 清理机制。

### 4.6 幂等键生命周期

- 幂等键在 `TaskRecord` 创建时绑定，不可修改。
- 当后台清理循环按 `task_retention_days` 配置删除过期 `TaskRecord` 时，该记录的 idempotency key 随之释放。之后客户端可使用同一 key 提交新任务。
- 任务被取消或失败后，idempotency key 仍绑定在该记录上。客户端如需重新提交，须使用不同的 idempotency key。

## 5. 数据库迁移

### 5.1 迁移要求

在 `alembic/versions/` 中新增迁移文件，`down_revision` 指向当前 HEAD（`e6ce36543398`）。

**upgrade 操作**：

1. 在 `tasks` 表添加 `idempotency_key` 列（`VARCHAR(255)`, `NULL`）。
2. 在 `tasks` 表创建唯一约束 `uq_tasks_key_idempotency`，覆盖 `(api_key_id, idempotency_key)`。

**downgrade 操作**：

1. 删除唯一约束 `uq_tasks_key_idempotency`。
2. 删除 `idempotency_key` 列。

### 5.2 SQLite 兼容性

SQLite 通过 Alembic 的 `batch_alter_table` 模式支持添加 nullable 列与唯一约束。操作顺序为先加列（现有行自动为 NULL，无需默认值），再加约束，与 ALTER TABLE 语义兼容。

## 6. 测试场景

以下测试场景覆盖幂等提交的全部预期行为。所有测试仅针对 `POST /tasks` 端点，使用有效的 API Key，并 mock 上游返回 `202`。

### 6.1 基本功能

**T1 — 首次提交，提供 X-Idempotency-Key**
客户端首次使用某个 idempotency key 提交任务。系统正常完成全部提交流程：速率检查、上游提交、数据库写入。返回 `202`，响应体包含 `task_id`，响应头**不含** `X-Idempotency-Key-Replayed`。数据库中该任务的 `idempotency_key` 列有值。

**T2 — 重复提交，相同 X-Idempotency-Key**
客户端使用与 T1 相同的 idempotency key 再次提交。系统在步骤 2 查询到已有 `TaskRecord`，不执行后续流程。返回 `202`，响应头**含** `X-Idempotency-Key-Replayed: true`，响应体中的 `task_id` 与 T1 相同。数据库仅有一条任务记录。

**T3 — 重复提交，首次任务已完成**
T1 的任务经后台状态同步后变为 `completed`。客户端再次使用相同 idempotency key 提交。系统仍返回首次提交的响应（`status: "pending"`，`task_id` 不变），而不是 `completed`。响应头含 `X-Idempotency-Key-Replayed`。

**T3b — 重复提交，首次任务已失败**
T1 的任务变为 `failed`。客户端再次使用相同 key 提交。行为与 T3 一致：仍返回首次提交的原始响应，不因任务失败而创建新任务。

**T4 — 提交时不提供 X-Idempotency-Key**
客户端正常提交，不提供 `X-Idempotency-Key` 头。现有行为不变：正常提交流程，数据库中 `idempotency_key` 为 NULL，响应不含 `X-Idempotency-Key-Replayed`。

**T5 — X-Idempotency-Key 为空字符串或全空白**
客户端提供 `""`、`"   "` 等作为 idempotency key。视为未提供，不启用去重。行为与 T4 一致：`idempotency_key` 为 NULL。

### 6.2 隔离性

**T6 — 不同 API Key 使用相同 idempotency key**
两个不同的 API Key（key-A 和 key-B）使用相同的 idempotency key（如 `"key-1"`）提交。两者各自正常创建任务，不冲突。验证数据库中有两条记录，`api_key_id` 不同，`idempotency_key` 相同。

**T7 — 同一 API Key 使用不同 idempotency key**
同一 Key 先后用 `"key-1"` 和 `"key-2"` 提交。两者各自正常创建任务，不同的 `task_id`。验证两任务互不影响。

### 6.3 匿名请求

**T8 — 匿名请求携带 X-Idempotency-Key**
配置 `GATEWAY_ALLOW_ANONYMOUS=true`。不提供 `X-API-Key`，但提供 `X-Idempotency-Key`。系统走纯透传路径：直接转发到上游，不查询 `tasks` 表，不写入数据库。两次相同 key 的匿名提交各自转发，产生两次上游请求。数据库无新记录。

### 6.4 并发竞争

**T9 — 两个并发请求，相同 idempotency key**
两个请求携带相同的 API Key 和 idempotency key，几乎同时到达。两者在步骤 2 均未查到已有记录（第一个尚未写入），均执行了完整提交流程。第一个成功创建 `TaskRecord`；第二个在步骤 8 触发唯一约束冲突（`IntegrityError`），经过冲突恢复返回 `202` + `X-Idempotency-Key-Replayed: true`。数据库中仅一条记录，`task_id` 与两个响应一致。

**T10 — 并发竞争失败方释放文件暂存**
T9 中竞争失败的请求在步骤 7 已暂存了 multipart 文件（`cache_dir` 非空）。冲突恢复流程需释放此目录，不留孤儿缓存文件。通过检查文件系统或 mock `cache.release` 调用次数验证。

### 6.5 校验

**T11 — idempotency key 长度超过 255 字符**
客户端提供 256 字符的 `X-Idempotency-Key`。返回 `422 Unprocessable Entity`，不执行任何后续流程。

**T12 — 幂等命中不消耗限流令牌**
T1 首次提交后限流令牌已耗尽（使用 `rate=1` 且令牌桶 `burst=1` 的限流器实例；`MemoryTokenBucket` 默认 `burst=30`，需在测试中显式构造为 1 以使得单次请求即耗尽令牌）。T2 携带相同 idempotency key 提交——应在步骤 2 命中并返回 202，不因限流返回 429。验证重试请求不经过 `limiter.acquire`。

### 6.6 生命周期

**T13 — 任务被清理后，idempotency key 可重用**
T1 创建任务后，手动将该任务的 `created_at` 修改为超过 `task_retention_days` 的时间点，触发后台清理删除该记录。客户端再次使用相同的 idempotency key 提交。此时步骤 2 查询无结果，按首次提交流程正常创建新任务，不触发去重。

## 7. 影响范围

| 文件 | 变更类型 | 变更说明 |
|------|----------|----------|
| `src/mineru_gateway/models.py` | 修改 | `TaskRecord` 新增 `idempotency_key` 字段与 `UniqueConstraint` |
| `src/mineru_gateway/proxy/handler.py` | 修改 | `handle_task_submission` 新增幂等检查逻辑（认证后、限流前）；新增 `IntegrityError` 并发冲突处理 |
| `src/mineru_gateway/proxy/routes.py` | 修改 | 从请求头提取 `X-Idempotency-Key`，传入 handler |
| `alembic/versions/` | 新增 | 一个新 migration 文件，添加列与唯一约束 |
| `tests/core/test_proxy.py` | 修改 | 新增 T1-T13 测试场景 |
| `specs/idempotent-submission.md` | 新增 | 本文件 |
