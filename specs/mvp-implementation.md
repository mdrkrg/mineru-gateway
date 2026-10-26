# mineru-gateway MVP 实现规约

> **历史文档**：MVP 已完成；本规约保留其数据模型、接口、模块和配置设计。
> 当前 MinerU 4.0 `/v1` 契约以 `docs/mineru-reference.md` 为准，后续实现的
> 幂等提交、统计、用户体系/OAuth 和流式上传见对应 `specs/` 文档。
> 分阶段实施记录见 `plans/mvp-implementation-plan.md`。

## 0. MVP 目标与非目标

**目标**：在 mineru-api / mineru-router 前提供一个**单实例、单 worker** 的网关，做到：

1. 代理 MinerU 4.0 V1 API（`POST /v1/file_parse` 同步、`POST /v1/tasks` 异步），匿名模式保持上游 wire contract。
2. 以 **API Key** 为鉴权主体（默认禁止匿名），记录任务元数据并做所有权隔离。
3. 任务元数据持久化 + 上游状态同步 + 上游崩溃后简单重提（基础容灾）。
4. 按 Key 内存限流、全局在制任务上限、文件数量及大小限制等基础保护。

**非目标（MVP 明确不做）**：

- 用户体系（email/password/注册登录）——用 API Key + Admin Token 代替。
- Redis、消息队列、多实例水平扩展。
- 幂等键、磁盘配额、`/v1/tasks/stats`、可配置重试状态机。
- Web UI、断点续传、结果预取到对象存储。

---

## 1. 架构（MVP 形态）

```
  X-API-Key ─────►┌───────────────────────────────────────────────┐
  (required*)     │              mineru-gateway (单实例)          │
  X-Admin-Token ─►│  ┌──────────┐ ┌──────────┐ ┌──────────────┐   │
  (仅 key 管理)   │  │ Auth     │ │ 内存限流  │ │ Task Service │   │
                  │  │ Depends()│ │ (per key)│ │  + 权限校验   │   │
                  │  └────┬─────┘ └────┬─────┘ └──────┬───────┘   │
                  │       ▼            ▼              ▼           │
                  │  ┌──────────────────────────────────────┐    │
                  │  │            Route 分发层               │    │
                  │  └─────┬──────────────────────┬─────────┘    │
                  │        ▼                      ▼               │
                  │  ┌──────────────┐     ┌──────────────┐       │
                  │  │ 文件暂存     │     │ SQLite/PG    │       │
                  │  │ (本地磁盘)   │     │ (元数据)      │       │
                  │  └──────────────┘     └──────────────┘       │
                  │        后台循环: 状态同步 + 崩溃重提          │
                  └───────────────────────┬───────────────────────┘
                                          ▼
                                 ┌──────────────┐
                       upstream ─│ mineru-router│  或直连 mineru-api
                                 │   :8002      │
                                 └──────────────┘
```

> \* `X-API-Key` 默认必需；设置 `GATEWAY_ALLOW_ANONYMOUS=true` 后可省略（无 Key → 纯透传，不记录任务）。

**部署约束**：MVP 为**单实例 + 单 worker**（`uvicorn --workers 1`）。原因：内存限流计数与后台循环状态在进程内，多 worker/多实例会失真或重复处理。水平扩展方案见 `plans/future-enhancements.md`。

---

## 2. 技术栈

| 组件 | 选型 | 原因 |
|------|------|------|
| Web 框架 | FastAPI | async 原生，OpenAPI 自动生成，与 mineru 一致 |
| 数据库 ORM | SQLAlchemy 2.0 (async) | 支持 SQLite/PG 切换 |
| 数据库默认 | SQLite (aiosqlite) | 零配置，单文件，适合单机 MVP |
| 数据库可选 | PostgreSQL (asyncpg) | 写并发高时切换 |
| 迁移工具 | Alembic | SQLAlchemy 生态标准 |
| HTTP 客户端 | httpx (async) | 流式转发、连接池 |
| 限流 | 进程内内存令牌桶 | 单实例足够，无外部依赖 |
| 容器化 | Docker + docker-compose | 与 mineru 部署统一 |

> 无 `passlib`（无密码）、无 Redis、无 MQ。API Key 以 SHA256 哈希存储。

---

## 3. 功能列表

### 3.1 API Key 管理

以 API Key 为鉴权主体，无用户表。**创建/吊销 Key 需要 `X-Admin-Token`**（配置项 `GATEWAY_ADMIN_TOKEN`）；业务请求用签发出的普通 Key。

| 功能 | 端点 | 认证要求 | 说明 |
|------|------|:------:|------|
| 创建 API Key | `POST /auth/keys` | Admin Token | 填 label 等元信息 → 返回完整 Key（仅此一次可见） |
| 列出 API Key | `GET /auth/keys` | Admin Token | 列出所有 Key 的元信息（不含明文） |
| 吊销 API Key | `DELETE /auth/keys/{key_id}` | Admin Token | 立即失效 |

### 3.2 Gateway 任务历史

| 功能 | 端点 | 认证要求 | 说明 |
|------|------|:------:|------|
| 任务列表 | `GET /v1/tasks` | API Key | 分页、按状态/日期/文件名筛选，按日期排序 |

状态、结果和取消沿用 MinerU-facing 路径，认证与匿名行为见下节。统计和批量
操作是 MVP 后扩展，见对应专项规约。

### 3.3 MinerU V1 代理

> **认证策略**：默认**禁止匿名访问**（`GATEWAY_ALLOW_ANONYMOUS=false`）。
> 设为 `true` 时下列「必需」降级为「可选」，无 Key → 纯透传、不记录任务，保持 MinerU V1 wire contract。

| 功能 | 端点 | 认证要求 | 说明 |
|------|------|:------:|------|
| 同步解析 | `POST /v1/file_parse` | 必需¹ | 记录任务并透传 |
| 异步提交 | `POST /v1/tasks` | 必需¹ | 返回 Gateway 的 task_id |
| 任务状态 | `GET /v1/tasks/{task_id}` | 必需¹ | 认证时校验所有权；匿名时透传 opaque upstream ID |
| 任务结果 | `GET /v1/tasks/{task_id}/result` | 必需¹ | 认证时校验所有权；匿名时透传 opaque upstream ID |
| 取消任务 | `DELETE /v1/tasks/{task_id}` | 必需¹ | 认证时校验所有权；匿名时透传 opaque upstream ID |
| 健康检查 | `GET /v1/health` | 无 | 聚合上游健康 + Gateway 自身状态 |

> ¹ 当 `GATEWAY_ALLOW_ANONYMOUS=true` 时降级为「可选」。

### 3.4 容灾与可靠性（基础版）

| 功能 | 说明 |
|------|------|
| 任务元数据持久化 | SQLite/PG 存储，重启不丢失 |
| 上游状态同步 | 后台循环定期拉取非终态任务状态，更新 DB |
| 崩溃后简单重提 | 上游恢复后，对暂存文件仍在的 `retry_pending` 任务重提，最多 `GATEWAY_MAX_RETRIES` 次 |
| 文件缓存自动清理 | 任务终态后删除暂存文件；DB 记录保留至配置 TTL |

### 3.5 并发控制与保护

| 功能 | 说明 |
|------|------|
| 上游可用性 | MinerU 4.0 health 不提供队列深度/free slots，因此提交前不做 health 门控；上游的拒绝状态直接透传，网络故障由网关规范化为 502/503/504。 |
| 按 Key 内存限流 | 进程内令牌桶，可配置每 Key 每秒请求数（单实例单 worker 有效） |
| 全局并发限制 | DB 中 `pending + processing + retry_pending` 上限，超出 503（`retry_pending` 为待重提的在制任务，同样占用额度）|
| 文件限制 | 每任务最多 100 个文件；单文件默认 200 MiB；文件总量默认 500 MiB。异步上传接收阶段流式写盘。 |

### 3.6 可观测性

| 功能 | 说明 |
|------|------|
| 结构化日志 | JSON 日志，含 `task_id`、`api_key_id`、`duration_ms` 等字段。请求级访问日志由 ASGI 中间件（`middleware.py`）逐请求产生，含 `request_id`/`method`/`path`/`status_code`/`duration_ms`，认证请求附带 `api_key_id`；响应回填 `X-Request-Id` 头 |
| 健康检查 | Gateway `/v1/health` + 聚合上游状态 |

### 3.7 与上游 MinerU 4.0 的差异

Gateway 定位为认证/持久化/容灾层，以下行为与真实 router 不尽一致。Gateway 扩展项与 MVP 简化项标注原由；已对齐项标注 ✓。

| 差异 | 真实 router | Gateway | 状态 |
|------|-----------|---------|:----:|
| `/v1/health` 当 upstream 不健康时 | 返回 `503` | 返回 `503` + aggregated payload | ✓ 已对齐 |
| `/v1/health` 响应字段 | `status: ok/degraded`、`version`、`features` | 聚合为 `gateway/status/upstream`，保留 upstream 的 `version/features` | Gateway 聚合 |
| `DELETE /v1/tasks/{id}` | 支持取消 `queued` / `running` | 认证任务映射为 `pending` / `processing` 后转发；匿名 opaque ID 直接透传 | ✓ 已对齐 |
| 任务状态流转 | `queued` / `running` / `completed` / `partial` / `failed` / `canceled` | 映射为 `pending` / `processing` / `completed` / `partial` / `failed` / `cancelled`，另有恢复态 `retry_pending` | Gateway 映射/扩展 |
| `GET /v1/tasks/{id}/result` 非终态 | 返回 `202` + 状态体 | 返回 `409` | MVP 简化（从 DB 镜像判断，不额外查询上游） |
| `POST /v1/tasks` 响应体 | 含 `started_at` / `completed_at` / `error`（null 时仍出现） | 已补齐 `started_at` / `completed_at` / `error`（均 null） | ✓ 已对齐 |
| `POST /v1/tasks` 提交前上游健康检查 | 不做 | 不做；依赖按 Key 限流 + 全局并发上限提供背压 | ✓ 已对齐 |

---

## 4. 数据模型

```python
# --- 鉴权主体：API Key（无 User 表）---

class ApiKey(Base):
    __tablename__ = "api_keys"

    id:          UUID (PK)
    key_hash:    str (unique, index)    # SHA256(raw_key)
    key_prefix:  str                    # 前 8 字符，用于展示/识别
    label:       str                    # 用途标签 (e.g. "production")
    created_at:  datetime
    last_used_at: datetime (nullable)
    expires_at:  datetime (nullable)
    is_active:   bool (default=True)
    # 预留扩展：未来接入用户体系/OAuth 时新增 owner_id (nullable, FK)


# --- 任务管理 ---

class TaskRecord(Base):
    __tablename__ = "tasks"

    id:              UUID (PK)          # Gateway 的 task_id（返回给客户端）
    api_key_id:      FK → api_keys.id (NOT NULL, index)   # 每条任务都归属某个 Key
    status:          str (index)        # pending | processing | completed | partial | failed | cancelled | retry_pending
    #                                   # queued/running/canceled 映射为 pending/processing/cancelled

    # 文件信息
    file_names:      JSON (list[str])
    file_count:      int
    file_total_bytes: int

    # MinerU 4.0 解析参数
    tier:            str | None      # 查询/过滤使用；以上游提交响应为准
    parse_params:    JSON (default={})
    # 保存实际发送给 upstream 的 V1 参数：
    #   tier, ocr_mode, page_range, output_formats
    # 同步请求还可包含 response_format / wait_timeout

    # 上游映射
    upstream_url:        str
    upstream_task_id:    str (nullable, index)
    retry_count:         int (default=0)         # 已重提次数（对比 GATEWAY_MAX_RETRIES）
    consecutive_poll_failures: int (default=0)   # 后台同步连续失败计数

    # 文件缓存
    cache_dir:       str (nullable)     # 暂存 multipart 的目录路径

    # 时间戳
    created_at:      datetime (index)
    started_at:      datetime (nullable)
    completed_at:    datetime (nullable)
    error_message:   str (nullable)
    upstream_error:  str (nullable)
```

### SQLite 兼容说明

- `UUID` → `BLOB (16 bytes)`（SQLAlchemy `Uuid` 默认）；`JSON` → `TEXT` + `json.dumps/loads`；`datetime` → `TEXT`（ISO 8601）。
- 所有查询通过 SQLAlchemy ORM 抽象，自动适配两种后端。
- ID 统一使用 **UUIDv7**（`uuid.uuid7()`），按时间有序，适合作为聚集索引。

### 约束与索引

- `(api_key_id, status, created_at)` 复合索引，支撑 `GET /v1/tasks` 的筛选与排序。
- 匿名请求（`GATEWAY_ALLOW_ANONYMOUS=true` 时）为纯透传，**不写入 `tasks` 表**，故 `api_key_id` 为 `NOT NULL`（每条任务都归属某个 Key），索引无空值。

---

## 5. API 规范

### 5.1 MinerU-facing 端点

以下端点在**匿名纯透传**时保持与 mineru-api 请求/响应**语义一致**：状态码与响应体原样透传，仅剥离 hop-by-hop 头（`content-length`/`content-encoding`/`transfer-encoding`/`connection`，由网关按传输层重新协商）；在**认证模式**下响应为上游的**兼容超集**（替换 `task_id` 为 Gateway ID 并追加 `status_url` 等字段，见 §6.2）。认证要求见 §3.3。

| 方法 | 路径 | 变化 |
|------|------|------|
| `POST` | `/v1/file_parse` | 认证：记录到 DB 并透传；匿名：纯透传不记录 |
| `POST` | `/v1/tasks` | 同上，认证时返回 Gateway 的 task_id |
| `GET` | `/v1/tasks/{task_id}` | 认证：校验所有权并返回 DB 镜像；匿名：opaque upstream ID 直接透传 |
| `GET` | `/v1/tasks/{task_id}/result` | 认证：校验所有权后转发上游结果；匿名：opaque upstream ID 直接透传 |
| `GET` | `/v1/health` | 聚合 Gateway 自身 + 上游状态 |

### 5.2 任务响应头

> `TaskRecord.tier` 用于查询和展示，`parse_params` 保存实际发送给 MinerU 4.0 upstream 的完整 V1 参数快照，供结果下载和灾难恢复使用。

```http
HTTP/1.1 202 Accepted
X-MinerU-Task-Id: {gateway_task_id}
X-MinerU-Task-Status: pending
X-MinerU-Task-Status-Url: {gateway_url}/v1/tasks/{id}
X-MinerU-Task-Result-Url: {gateway_url}/v1/tasks/{id}/result
```

> `POST /v1/file_parse` 通常直接返回上游解析结果；MinerU 4.0 的等待预算耗尽时
> 会返回 202。认证请求在此情况下创建 Gateway 任务、重写任务链接并进入与
> `POST /v1/tasks` 相同的状态同步及故障重提流程。

### 5.3 新增端点

```yaml
# ===== API Key 管理（需 X-Admin-Token）=====

POST /auth/keys:
  summary: 签发一个新的 API Key
  security: X-Admin-Token
  request:
    body (JSON):
      label: str (optional)     # 用途标签
      expires_at: str (optional, ISO datetime)
  response (201):
    key_id: str
    api_key: str                # 完整 Key，仅显示这一次
    api_key_prefix: str         # 前 8 字符
    message: "Save this API key. It will not be shown again."

GET /auth/keys:
  summary: 列出所有 API Key 元信息
  security: X-Admin-Token
  response (200):
    keys:
      - id: str
        api_key_prefix: str
        label: str
        created_at: str
        last_used_at: str | null
        expires_at: str | null
        is_active: bool

DELETE /auth/keys/{key_id}:
  summary: 吊销指定 API Key
  security: X-Admin-Token
  response (204) — 仅限有效 UUID；格式错误返回 422


# ===== 任务管理（需 X-API-Key）=====

GET /v1/tasks:
  summary: 列出当前 Key 的任务
  security: X-API-Key
  parameters:
    - status: str (optional)      # pending|processing|completed|partial|failed|cancelled|retry_pending
    - tier: str (optional)
    - file_name: str (optional)   # 模糊搜索
    - date_from: str (optional)   # ISO date
    - date_to: str (optional)
    - page: int (default=1)
    - page_size: int (default=50, max=200)
  response (200):
    items:
      - task_id: str
        status: str
        tier: str | null
        file_names: [str]
        created_at: str
        started_at: str | null
        completed_at: str | null
        error: str | null
        retry_count: int
    total: int
    page: int
    page_size: int

DELETE /v1/tasks/{task_id}:
  summary: 取消任务
  security: X-API-Key
  description: |
    允许 status=pending 或 processing 的任务。若上游可连通则尝试转发取消请求。
  response (200):
    task_id: str
    status: "cancelled"
    message: str
```

### 5.4 上游超时

`GATEWAY_UPSTREAM_TIMEOUT_READ`（默认 600s）作用于 `/v1/file_parse` 与结果下载——同步解析完成前不发送字节。异步 `POST /v1/tasks` 使用固定 30s 读超时（上游队列无界，正常立即返回 202）。

| 端点 | 上游超时的响应 |
|------|---------------|
| `POST /v1/tasks`、`POST /v1/file_parse`、`GET /v1/tasks/{id}/result` | `504 {"detail": "Upstream timeout"}` + `Retry-After: 5` |
| `GET /v1/health` | 不变：聚合后返回 `503` + `status: "degraded"` |
| `POST /v1/tasks/result-zip` | 不变：该条记入 `_manifest.json` 的 `skipped`（`reason: "upstream_error"`），不整体失败 |
| `DELETE /v1/tasks/{id}`、`POST /v1/tasks/cancel` | 不变：转发上游失败被忽略，仍按本地状态返回 |

连接失败（`httpx.TransportError`，如 `ConnectError`）→ `502 {"detail": "Upstream request failed"}` + `Retry-After: 5`；连接池耗尽（`httpx.PoolTimeout`）→ `503 {"detail": "Upstream connection pool exhausted"}` + `Retry-After: 30`。MinerU 4.0 不暴露 free-slot 指标，因此提交前不做 health 预检。

健康聚合、状态轮询与取消转发使用固定 10s 读超时（不超过上述配置），避免拖住 `status_sync`/`/v1/health`。`504` 不表示上游未受理：重试 `POST /v1/tasks` 应带 `X-Idempotency-Key`（见 `specs/idempotent-submission.md`），否则可能重复建任务。

客户端重试时机与提交超时要求见 `specs/idempotent-submission.md` §4.5；不要在第一次请求仍在飞行时用同一 key 重试。

---

## 6. 核心模块设计

### 6.1 模块结构

```
mineru_gateway/
├── __init__.py
├── main.py                          # FastAPI app + 生命周期（启动后台循环）
├── config.py                        # 配置：环境变量 + 配置文件
├── db.py                            # SQLAlchemy async engine + session factory
├── models.py                        # ORM：ApiKey, TaskRecord
├── schemas.py                       # Pydantic 请求/响应模型
│
├── auth/
│   ├── dependencies.py              # require_api_key（依 ALLOW_ANONYMOUS）、require_admin_token
│   ├── service.py                   # create_key / list_keys / revoke_key / verify_key
│   └── routes.py                    # /auth/keys 端点
│
├── tasks/
│   ├── service.py                   # 任务 CRUD + 权限检查
│   ├── cache.py                     # 文件暂存管理（store/restore/release）
│   ├── routes.py                    # GET /v1/tasks, GET /v1/tasks/{id}, DELETE /v1/tasks/{id}
│   └── schemas.py
│
├── proxy/
│   ├── handler.py                   # 核心：异步 multipart 流式接收、缓存及代理
│   └── routes.py                    # POST /v1/file_parse, POST /v1/tasks 路由入口
│
├── upstream/
│   ├── client.py                    # 上游 health / submit / status / result 调用
│   ├── params.py                    # MinerU V1 query 参数验证
│   └── schemas.py                   # 上游 wire payload 验证与状态映射
│
├── background/
│   ├── status_sync.py               # 定期拉取上游状态 → 更新 DB
│   ├── retry.py                     # 上游恢复后重提 pending 任务（简单循环）
│   └── cleanup.py                   # 过期任务清理 + 缓存文件删除 + 限流器 prune
│
├── limiter/
│   └── memory.py                    # 进程内令牌桶（单实例）
│
└── health/
    └── routes.py                    # GET /v1/health（聚合）
```

### 6.2 透传核心 (`proxy/handler.py`)

```python
async def handle_task_submission(
    request: Request,
    form: dict,
    files: list[UploadFile],
    api_key: ApiKey | None,
) -> JSONResponse:
    """处理 POST /v1/tasks 请求。行为要点：
    - 认证门控：默认拒绝匿名；ALLOW_ANONYMOUS=true 时匿名请求纯透传不记录
    - 速率限制：按 Key 内存令牌桶拦截
    - 文件暂存：认证请求的 multipart 落盘后转发上游（用于崩溃重提）
    - 参数存储：实际 V1 参数写入 parse_params，解析后的 tier 单独存列供查询
    - 任务记录：DB 持久化上游 task_id 映射 + 文件元信息 + 解析参数
    - 响应：返回 Gateway task_id、实际 tier、状态与结果链接
    """
```

> **响应格式说明**：认证模式下，`task_id` 被替换为 **Gateway 的 ID**，并返回 Gateway 状态与结果链接。匿名模式下为原样透传：状态码与响应体不变，仅剥离 hop-by-hop 头（见 §5.1）。

### 6.3 后台状态同步 (`background/status_sync.py`)

```python
FAILURE_THRESHOLD = 3   # 单任务连续轮询失败次数达此值 → 标记为可重试

async def status_sync_loop(interval: float = 5.0):
    """定期从上游拉取非终态任务的状态"""
    while True:
        await asyncio.sleep(interval)

        tasks = await task_service.get_non_terminal()
        if not tasks:
            continue

        # groupby 要求输入按 key 有序，先排序再分组
        # * MVP 仅单 upstream，实现在 sync_once 中做一次全局健康探针
        #    （而非按 upstream_url 分组逐一探测）；多 upstream 时按此伪代码展开
        tasks.sort(key=lambda t: t.upstream_url)
        for upstream_url, task_group in groupby(tasks, key=lambda t: t.upstream_url):
            try:
                await upstream_client.get_health(upstream_url)
            except Exception:
                # 上游不可达，逐个检查是否需要标记为可重试
                for task in task_group:
                    await check_and_mark_retryable(task)
                continue

            for task in task_group:
                try:
                    upstream_status = await upstream_client.get_task_status(
                        upstream_url, task.upstream_task_id
                    )
                    await task_service.update_from_upstream(task, upstream_status)
                except Exception:
                    # 单任务查询失败：持久化递增计数；达阈值标记可重试
                    new_failures = task.consecutive_poll_failures + 1
                    await task_service.update(
                        task.id, dict(consecutive_poll_failures=new_failures)
                    )
                    if new_failures >= FAILURE_THRESHOLD:
                        await check_and_mark_retryable(task)
```

### 6.4 简单重提 (`background/retry.py`)

重提循环使用配置项 `GATEWAY_MAX_RETRIES`，不引入 `failed_exhausted` 独立终态（耗尽即标记 `failed`）。

```python
async def retry_loop(interval: float = 10.0):
    """上游恢复后重提 retry_pending 且暂存文件仍在的任务。"""
    while True:
        await asyncio.sleep(interval)

        tasks = await task_service.get_retryable()
        if not tasks:
            continue
        try:
            health = await upstream_client.get_health()
        except Exception:
            continue  # 还没恢复，等下一轮
        if health.status != "healthy":
            continue

        # 当前只有一个上游，一轮只需探测一次。
        for task in tasks:
            try:
                form_data, files = await file_cache.restore(task.cache_dir)
                params = parse_v1_params(form_data, sync=False, include_zip=True)
                upstream_resp = await upstream_client.submit_task(params, files)
                if upstream_resp.status_code != 202:
                    transient = (
                        upstream_resp.status_code == 429
                        or upstream_resp.status_code >= 500
                    )
                    if transient:
                        # 容量不足、无健康 worker 或上游故障：保留缓存，消耗重试。
                        raise RuntimeError(
                            f"transient upstream response: {upstream_resp.status_code}"
                        )
                    # 明确的请求错误不可通过重试恢复。
                    await task_service.mark_failed(
                        task.id,
                        f"unexpected upstream response: {upstream_resp.status_code}",
                    )
                    await file_cache.release(task.cache_dir)
                    continue
                try:
                    payload = validate_submission_payload(upstream_resp.json())
                except ValueError as e:
                    # malformed 202 直接失败，不消耗重试。
                    body_text = upstream_resp.text[:500]
                    await task_service.mark_failed(
                        task.id, f"invalid upstream response: {e} - {body_text}"
                    )
                    await file_cache.release(task.cache_dir)
                    continue
                await task_service.update(task.id, dict(
                    upstream_task_id=payload.task_id,
                    status=gateway_task_status(payload.status),
                    tier=payload.tier,
                    retry_count=task.retry_count + 1,
                    consecutive_poll_failures=0,
                    started_at=None, completed_at=None, error_message=None,
                ))
                logger.info(f"Retried task {task.id} → {payload.task_id} "
                            f"(attempt {task.retry_count + 1})")
            except Exception as e:
                # 瞬时故障（网络/连接等）：消耗一次重试
                new_count = task.retry_count + 1
                if new_count >= settings.max_retries:
                    await task_service.mark_failed(task.id, str(e))
                    await file_cache.release(task.cache_dir)
                else:
                    await task_service.update(task.id, dict(retry_count=new_count))
                    logger.warning(f"Retry submit for {task.id} failed "
                                   f"(attempt {new_count}): {e}")
```

### 6.5 内存限流 (`limiter/memory.py`)

```python
class MemoryTokenBucket:
    """进程内令牌桶。仅在单实例单 worker 下有效。"""
    def __init__(self, rate: int = 10, burst: int = 30, idle_ttl: float = 3600):
        self.rate = rate        # 令牌/秒
        self.burst = burst      # 桶容量
        self.idle_ttl = idle_ttl  # 空闲 key 回收阈值（秒）
        self._state: dict[str, tuple[float, float]] = {}  # key -> (tokens, last_ts)
        self._lock = asyncio.Lock()

    async def acquire(self, key: str) -> bool:
        async with self._lock:
            now = time.monotonic()
            tokens, last = self._state.get(key, (self.burst, now))
            tokens = min(self.burst, tokens + (now - last) * self.rate)
            if tokens >= 1:
                self._state[key] = (tokens - 1, now)
                return True
            self._state[key] = (tokens, now)
            return False

    def prune(self) -> None:
        """由后台清理循环定期调用，回收长期空闲的 key，避免 _state 无界增长。"""
        now = time.monotonic()
        stale = [k for k, (_, last) in self._state.items()
                 if now - last > self.idle_ttl]
        for k in stale:
            del self._state[k]
```

> ⚠️ 进程重启后计数清零；多 worker/多实例下不共享。MVP 因此强制单实例单 worker。跨实例限流方案（Redis 令牌桶）见 `plans/future-enhancements.md`。

---

## 7. 部署方案

### 7.1 最简部署（单机、SQLite、无 Redis）

```bash
pip install mineru-gateway

mineru-gateway \
  --upstream-url http://127.0.0.1:8002 \
  --port 8000 \
  --workers 1 \
  --database-url sqlite+aiosqlite:///./gateway.db \
  --admin-token "$(openssl rand -hex 16)" \
  --allow-anonymous false
```

### 7.2 docker-compose

> 上游 mineru-router / mineru-api 视为**外部服务**，不纳入本 compose，通过 `GATEWAY_UPSTREAM_URL` 环境变量传入其地址。

```yaml
services:
  mineru-gateway:
    build:
      context: ./mineru-gateway
    restart: always
    ports:
      - "8000:8000"
    environment:
      GATEWAY_UPSTREAM_URL: ${GATEWAY_UPSTREAM_URL:?set upstream router/api URL}
      GATEWAY_DATABASE_URL: sqlite+aiosqlite:///data/gateway.db
      GATEWAY_ADMIN_TOKEN: ${GATEWAY_ADMIN_TOKEN:?set in .env}
      GATEWAY_ALLOW_ANONYMOUS: "false"
      GATEWAY_WORKERS: "1"
      GATEWAY_FILE_CACHE_DIR: /tmp/gateway-cache
      GATEWAY_MAX_UPLOAD_SIZE: 524288000               # 500 MiB
      GATEWAY_RATE_LIMIT_PER_KEY: 10                   # 每 Key 每秒 10 请求
      GATEWAY_TASK_RETENTION_DAYS: 90
    volumes:
      - gateway_data:/data
      - gateway_cache:/tmp/gateway-cache

volumes:
  gateway_data:
  gateway_cache:
```

### 7.3 配置项

| 环境变量 | 默认 | 说明 |
|---------|------|------|
| `GATEWAY_UPSTREAM_URL` | - | 上游 router/api 地址 |
| `GATEWAY_UPSTREAM_TIMEOUT_READ` | `600` | 同步解析/结果下载的上游读超时（秒）；异步 `/v1/tasks` 固定 30s |
| `GATEWAY_DATABASE_URL` | `sqlite+aiosqlite:///./gateway.db` | 支持切 PG |
| `GATEWAY_ADMIN_TOKEN` | - | 签发/管理 Key 所需，**必须设置** |
| `GATEWAY_ALLOW_ANONYMOUS` | `false` | 是否允许无 Key 纯透传 |
| `GATEWAY_WORKERS` | `1` | **MVP 必须为 1** |
| `GATEWAY_FILE_CACHE_DIR` | `/tmp/gateway-cache` | 暂存目录 |
| `GATEWAY_MAX_UPLOAD_SIZE` | `524288000` | 单请求内文件总字节上限 |
| `GATEWAY_MAX_FILE_SIZE` | `209715200` | 单文件上限（MinerU 4.0 默认 200 MiB） |
| `GATEWAY_RATE_LIMIT_PER_KEY` | `10` | 每 Key 每秒请求数 |
| `GATEWAY_TASK_RETENTION_DAYS` | `90` | 任务记录保留天数 |
| `GATEWAY_CREATE_TABLES` | `false` | 启动时是否 `create_all` 自动建表；**生产保持 `false`**，Schema 由 Alembic 迁移管理（见下）。仅测试/本地便捷场景置 `true` |

### 7.4 Schema 管理（Alembic 为唯一来源）

生产环境的数据库 Schema **只由 Alembic 迁移管理**：Docker entrypoint 在启动前执行 `alembic upgrade head`，应用自身默认不建表（`GATEWAY_CREATE_TABLES=false`）。这样避免「应用 `create_all` 自动建表」与「Alembic 迁移」两条独立路径产生漂移，也保证迁移缺陷不会被自动建表掩盖。`create_tables=true`（或在 `create_app(create_tables=True)` 显式传入）仅用于测试与本地一次性起库的便捷场景。

---

## 8. 已知限制（MVP）

| 限制 | 影响 | 说明/去向 |
|------|------|----------|
| 单实例单 worker，不可水平扩展 | 单点、吞吐受限 | 水平扩展见 `plans/future-enhancements.md`（Redis + 后台锁） |
| 内存限流重启清零、不跨进程 | 限流非强一致 | 同上，Redis 令牌桶 |
| 用户体系默认关闭 | 默认仅 API Key + Admin Token | 可通过 `GATEWAY_USER_AUTH_ENABLED` 启用 JWT/OAuth 与自助 Key 管理 |
| 处理中任务崩溃需重头开始 | 大任务代价大 | 需上游支持 checkpoint |
| 结果依赖上游 TTL | 过期无法下载 | 可选异步预取到对象存储 |
| 无磁盘配额 | 缓存可能耗尽本地磁盘 | 见 `plans/future-enhancements.md` |
| 匿名用户不享受持久化 | 未登录 = 纯透传 | 默认禁止匿名；开启后为纯透传保证兼容 |

## 8.1 实现澄清与当前差距

以下为规约意图与**当前实现**之间需要澄清的点，随实现推进逐项收敛。

### 差距（实现落后于规约）

（当前无未闭合差距。）

### 行为澄清（实现正确，但规约未明确）

| # | 项 | 澄清 |
|---|----|------|
| C1 | 全局并发上限作用域 | 仅约束**认证的 `POST /v1/tasks`**；`POST /v1/file_parse` 与匿名透传**不计入、不受限**（§3.5 的 `pending+processing+retry_pending` 计数只统计已入库任务）|
| C2 | 取消范围 | `DELETE /v1/tasks/{id}` 可取消 `pending` / `processing`；`retry_pending` 与终态返回 409。|
| C3 | 上传内存模型 | `/v1/tasks` 接收阶段流式写盘，但从缓存恢复并转发上游时仍全量读入内存；`/v1/file_parse` 仍使用 `request.form()` 缓冲。|
| C4 | `retry_pending` 占用并发额度 | 待重提任务在被重提/判失败前持续计入全局并发；由 `retry_interval` 约束时长 |
| C5 | 匿名为实例级全开关 | `GATEWAY_ALLOW_ANONYMOUS` 全局生效，无按端点/路径的匿名控制 |
| C6 | 单实例为**强制**约束 | 内存限流与三个后台循环依赖进程内状态；启动时检测到 `GATEWAY_WORKERS>1` 会拒绝运行。compose/Dockerfile 也固定为单 worker。|
| C7 | status_sync 全局探针 | §6.3 伪代码按 `upstream_url` 分组逐探健康；MVP 实现做单次全局探针（`sync_once`），对单 upstream 无害。多 upstream 时需还原 |
| C8 | 任务 ID 路由 | 任务路径接受字符串，以支持匿名模式的 opaque upstream ID；认证模式再将 Gateway ID 解析为 UUID，格式错误或未知 ID 均返回 404。`{key_id}` 仍由 FastAPI 按 UUID 校验。|

### 已知竞态 / 数据质量

| # | 项 | 说明 |
|---|----|------|
| R1 | 同步与取消竞态 | `sync_once` 取快照后逐任务处理；若期间任务经 API 取消，上游 `completed` 可能覆盖本地 `cancelled` 状态。窗口窄，`cache_dir` 已清空故无重复释放；暂不处理 |

### 8.2 Day 0 MinerU 4.0 schema

初始 migration 直接创建 MinerU 4.0 任务结构：`tier` 用于查询，
`parse_params` 保存原生 V1 参数。
