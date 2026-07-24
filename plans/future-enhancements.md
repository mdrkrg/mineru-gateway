# mineru-gateway Post-MVP 路线图

> MVP 已完成，见 `specs/mvp-implementation.md`。
> 本文覆盖 MVP 后的**非功能性需求**（生产加固、可观测性、安全）与**功能性需求**（按投入产出比排序），并为每项给出要点方案、依赖与预估规模。

## 目录

- [A. 非功能性需求 — 生产加固](#a-非功能性需求--生产加固)
- [B. 功能性需求 — 按优先级](#b-功能性需求--按优先级)
- [C. 技术债务与质量改进](#c-技术债务与质量改进)
- [D. 建议执行顺序](#d-建议执行顺序)

## A. 非功能性需求 — 生产加固

优先级标记：🔴 Critical  🟡 High  🟠 Medium  ⚪ Low

### ~~A1. 多 worker 运行时守卫 🔴~~

状态：已解决。更好的未来缓解方案见[多 Worker 水平扩展方案](./multi-worker-scaling.md)。

**背景**：C6 已记录 `--workers>1` 会静默双计限流 + 重复重提 + 后台循环竞跑。compose 固定
`workers 1`，但无运行时检测，Uvicorn CLI 传入 `--workers 2` 仍会启动。

**方案**：

- `main.py` 启动前检查：`uvicorn.run(..., workers=N)` 或通过 `GATEWAY_WORKERS` 环境变量；
  `w>1` 时打印错误并 `sys.exit(1)`
- Dockerfile 不暴露 workers 参数；compose `command` 不传 `--workers`

**规模**：~10 行 Python + compose 二重校验

### A2. 优雅停机 + 请求排空 🟡

**背景**：当前 lifespan 取消后台 task 后不做 in-flight 排空；SIGTERM 期间新请求也会接收并被
杀掉，存在丢请求窗口。

**方案**：

- 增加 `app.state.in_flight: int`（原子加减），中间件在请求开始 +1、结束 -1
- lifepan `finally` 中：
  1. 置 `app.state.shutting_down = True`（中间件新请求返回 503）
  2. 取消后台 task
  3. 轮询 `in_flight == 0`（最多等 `shutdown_timeout` 秒）
  4. 关闭 httpx client + DB 连接池

**新增配置**：`GATEWAY_SHUTDOWN_TIMEOUT`（默认 30s）

**规模**：~40 行 Python

### A3. Gateway 自检端点 🟡

**背景**：`GET /health` 是上游健康的透传，gateway 自己不可用时无自检机制。Docker healthcheck
需要区分「gateway 挂了」和「上游不健康」。

**方案**：

- `GET /gateway/health`（无需鉴权）返回 `{"status": "ok", "db": "connected|error", "background_loops": "running|stopped", "in_flight": <int>}`
- DB 连通性检查：`SELECT 1`
- Dockerfile `HEALTHCHECK --interval=15s CMD curl -f http://localhost:8000/gateway/health`

**规模**：~30 行路由 + Dockerfile 一行

### A4. Prometheus 指标端点 🟠

**背景**：当前仅结构化 JSON 日志，无止实时指标。运维需要请求数、延迟分位数、各状态任务计数、
限流拒绝数、上游错误率。

**方案**：

- 引入 `prometheus_client`（纯 Python，无外部 daemon）
- `GET /metrics` 暴露（仅 X-Admin-Token 鉴权）：
  - `gateway_requests_total{method,path,status_code}` — 请求计数
  - `gateway_request_duration_seconds{method,path}` — 直方图（p50/p90/p99）
  - `gateway_tasks_by_status{status}` — gauge，各状态任务数
  - `gateway_rate_limit_rejects_total` — 限流拒绝计数
  - `gateway_upstream_errors_total` — 上游错误计数
  - `gateway_in_flight` — gauge，当前活跃请求
- 用 `app.add_route("/metrics", ...)` 挂在 ASGI 上，不依赖 FastAPI 中间件

**新增配置**：`GATEWAY_METRICS_ENABLED`（默认 true）

**规模**：~80 行 Python + `prometheus_client` 依赖

### A5. 配置化上游超时 🟠

**背景**：`httpx.AsyncClient(timeout=30.0)` 硬编码；大文件上传或上游高负载下可能超时。

**方案**：

- `GATEWAY_UPSTREAM_TIMEOUT_CONNECT`（默认 10s）
- `GATEWAY_UPSTREAM_TIMEOUT_READ`（默认 60s，对应大文件处理）
- `GATEWAY_UPSTREAM_TIMEOUT_WRITE`（默认 60s，对应大文件上传）
- 启动时构造 `httpx.Timeout(connect, read, write)`

**规模**：~10 行 config + ~5 行 main

### A6. Request ID 向上游传播 ⚪

**背景**：`X-Request-Id` 在 gateway 侧生成、记录在访问日志，但未传给上游。端到端追踪链路断裂。

**方案**：`RequestLoggingMiddleware` 或上游 client 在每次请求时注入 `X-Request-Id` header。

**规模**：~5 行 middleware 或 client

### A7. API Key 用量追踪 🟠

**背景**：`ApiKey` 无 `last_used_at` / `request_count` / `error_count` 字段，无法了解使用情况。

**方案**：

- `ApiKey` 增加 `usage_request_count`、`usage_error_count`（Integer, default=0）；
  `last_used_at` 已有字段，本次补齐更新逻辑
- `RequestLoggingMiddleware` 或鉴权依赖在请求结束后 `asyncio.create_task` 异步更新计数器
- `GET /admin/api-keys` 返回中增加 `usage` 子对象
- 可选：限流拒绝也计入 `usage_throttled_count`

**新迁移**：1 个 Alembic migration（加列）

**规模**：~40 行 model + middleware + 路由

### A8. 启动时配置校验 ⚪

**背景**：`admin_token="change-me"` 可启动；`file_cache_dir` 不可写不报错。

**方案**：lifespan start 阶段校验：

- `admin_token != "change-me"`，否则 warn（不拒绝启动，仅 warn）
- `file_cache_dir` 可写（`os.access(path, os.W_OK)` 或尝试写临时文件）
- `upstream_url` 可连通（`GET /health`），失败时 warn

**规模**：~20 行

## B. 功能性需求 — 按优先级

### ~~B1. 幂等提交（X-Idempotency-Key） 🟡 P1~~

状态：已完成。

**触发条件**：客户端网络不稳定，重复提交不应产生重复任务。

**方案**：

- `TaskRecord` 增加 `idempotency_key: str | None = None`（nullable）
- 唯一约束：`UniqueConstraint("api_key_id", "idempotency_key")`（作用域为每 Key，非全局）
- 提交 handler（`proxy/handler.py`）在事务开始前先 `SELECT ... WHERE api_key_id=X AND idempotency_key=Y`
  - 命中：返回已存在任务（与上游返回一致）
  - 未命中：正常流程，落 `idempotency_key`
- 匿名请求不参与去重
- 可选：引入 `cached` 状态表示命中幂等返回

**影响**：`models.py` + migration + `proxy/handler.py`

**依赖**：无

**规模**：~40 行 + 1 migration

### B2. 暂存磁盘配额 🟡 P1

**触发条件**：大并发大文件可能写满磁盘。

**方案**：

- `FileCache` 维护目录总量计数器（`_total_bytes: int`），启动时扫描存量
- 新增 `DiskQuotaExceeded` 异常；提交门控阶段检查 `total_bytes + request_bytes > MAX_CACHE_SIZE`
- 超限 → 503 + `Retry-After: 30`
- 文件写入成功后 `_total_bytes += size`；文件删除后 `_total_bytes -= size`
- 后台清理循环同步更新计数器

**新增配置**：`GATEWAY_FILE_CACHE_MAX_SIZE`（默认 50GB）

**影响**：`tasks/cache.py` + `proxy/handler.py`

**依赖**：无

**规模**：~60 行

### ~~B3. 用户管理 🟠 P1~~

状态：已完成。

**触发条件**：需要多用户自服务访问，不再由管理员单一签发 API Key。

**方案**：

**数据模型**：

```python
class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = String(36), PK
    email: Mapped[str] = String(255), unique, index
    display_name: Mapped[str | None]
    password_hash: Mapped[str | None]  # NULL 表示仅 OAuth 登录
    is_active: Mapped[bool] = default=True
    is_admin: Mapped[bool] = default=False
    created_at: Mapped[datetime]
    updated_at: Mapped[datetime]
```

**ApiKey 扩展**：

```python
class ApiKey(Base):
    ...
    owner_id: Mapped[str | None] = ForeignKey("users.id")  # MVP 已预留
```

`label` 字段（已存在）语义更改为即用户对自己 Key 的命名，无需新增字段。

**端点**：

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| POST | `/auth/register` | 无（或 Admin Token 保护注册开关） | 邮箱 + 密码注册，返回 User |
| POST | `/auth/login` | 无 | 邮箱 + 密码 → 返回 session token (JWT) |
| POST | `/auth/oauth/{provider}` | 无 | 发起 OAuth 2.0 流程（见 B4） |
| GET | `/auth/oauth/{provider}/callback` | 无 | OAuth 回调，签发 JWT |
| POST | `/auth/refresh` | JWT | 刷新 access token |
| GET | `/me/api-keys` | JWT | 列出自己所有 Key |
| POST | `/me/api-keys` | JWT | 签发新 Key（仅限自己） |
| DELETE | `/me/api-keys/{id}` | JWT | 吊销自己某个 Key |

**鉴权变更**：原有 `X-API-Key` 鉴权**不变**；新增 `Authorization: Bearer <JWT>` 鉴权。
JWT payload 包含 `sub=user_id`、`scopes`（如 `tasks:read tasks:write`）。ApiKey 鉴权同样上卷
到 owner 的 scope。

**Sessions / Token**：

- 引入 `python-jose[cryptography]` 或 `PyJWT`
- access token 短期（15 min），refresh token 长期（7 days）
- Session 无状态（JWT），不引入 Session 表
- 可选存 Redis 黑名单做 token 吊销

**注意**：ApiKey 仅存 SHA256 hash，原文不可找回。"登录返回已有 Key" 不可行 → 登录应签发
**新 Key**，或改用短期 JWT 做 API 调用的鉴权主体。

**依赖**：`python-jose`、`passlib[bcrypt]`

**规模**：~300 行（models, auth, routes）+ 2 migrations

### ~~B4. OAuth 2.0 登录 🟠 P1（依赖 B3）~~

状态：已完成。仅实现 Generic OIDC。

**触发条件**：接入现有 SSO / GitHub / Google / OIDC 登录，避免自建密码体系。

**方案**：

- 抽象 `OAuthProvider`：`get_authorization_url(state) → str`、`exchange_code(code) → OAuthUser`
- 内置 provider：Google、GitHub、Generic OIDC（OIDC Discovery）
- `OAuthUser` 包含 `provider`、`sub`（provider 侧用户 ID）、`email`、`display_name`
- 登录流程：
  1. 客户端调 `GET /auth/oauth/{provider}` → 302 跳 provider 授权页
  2. Provider 回调 `GET /auth/oauth/{provider}/callback?code=...&state=...`
  3. Gateway exchange code → 拿 access_token → 拿 userinfo
  4. Gateway 内 upsert User（`OAuthAccount` 关联，见下），签发 JWT，302 回前端
- 一个 User 可关联多个 OAuthAccount（GitHub + Google 绑定同一邮箱 → 同一 User）

**数据模型**：

```python
class OAuthAccount(Base):
    __tablename__ = "oauth_accounts"
    id: Mapped[str]
    user_id: Mapped[str] = ForeignKey("users.id")
    provider: Mapped[str]      # "github", "google", "oidc"
    provider_user_id: Mapped[str]  # provider 侧唯一 ID
    provider_email: Mapped[str]
    access_token: Mapped[str | None]
    refresh_token: Mapped[str | None]
    token_expires_at: Mapped[datetime | None]
    __table_args__ = (UniqueConstraint("provider", "provider_user_id"),)
```

**新增配置**：

```env
GATEWAY_OAUTH_GOOGLE_CLIENT_ID=...
GATEWAY_OAUTH_GOOGLE_CLIENT_SECRET=...
GATEWAY_OAUTH_GITHUB_CLIENT_ID=...
GATEWAY_OAUTH_GITHUB_CLIENT_SECRET=...
GATEWAY_OAUTH_REDIRECT_BASE_URL=http://localhost:8000
```

**依赖**：B3 用户管理

**规模**：~200 行 + 1 migration

### ~~B5. 任务统计端点（GET /tasks/stats） 🟠 P2~~

状态：已完成。

**触发条件**：前端频繁 `GET /tasks` 自算 count 成为负担，或需要仪表盘概览。

**方案**：

```yaml
GET /tasks/stats:
  security: X-API-Key  (scoped to key owner)
  response (200):
    pending: int
    processing: int
    retry_pending: int
    completed: int
    failed: int
    cancelled: int
    today_completed: int
    today_failed: int
    total_bytes: int       # 已处理总文件大小
    avg_duration_ms: float | None
```

本质是 `count(*) group by status` 加聚合查询。高频访问时可加内存缓存（30s TTL）。

**依赖**：无

**规模**：~40 行

### ~~B6. 批量任务 🟠 P2~~

状态：调整为前端驱动。原方案（`batches` 表 + 状态机 + 6 端点）经评估后放弃，理由：

1. **幂等缺失** — 批量场景最需要「这批提交过没？」，但原方案列为非目标。前端方案直接复用已实现的 `X-Idempotency-Key`。
2. **复杂度收益比** — 200 行代码 + 1 迁移 + 状态机 + 背景循环钩子 + 逻辑裂缝（100% 失败批次终态矛盾、`pending→processing` 无触发），换来的是前端通过现有 API 已经能做的事：`POST /tasks`（带幂等）、`GET /tasks`（状态轮询和聚合）、`DELETE /tasks/{id}`（取消）。
3. **前端更灵活** — 本地分组不限层级、精确重试失败文件、自定义并发数、暂停/恢复，均无需服务端参与。

剩余两个后端不可替代的能力拆为轻量端点（均无新数据模型、无迁移）：

#### B6a. 多任务结果 zip 下载 🟢 P2

`POST /tasks/result-zip` 接受 `{"task_ids": [...]}`，流式返回 zip（每个 task 的结果从上游拉取、边读边写入 zip entry）。规格见 `specs/batch-lightweight-endpoints.md`。

#### B6b. 批量取消 🟢 P2

`POST /tasks/cancel` 接受 `{"task_ids": [...]}`，每个 task 走现有取消逻辑（仅 `pending` 可取消，`processing` 不动），返回成功/失败明细。规格见 `specs/batch-lightweight-endpoints.md`。

### B7. 结果预取到本地磁盘 🟠 P2

**触发条件**：上游结果 TTL（如 24h）过期后客户端无法下载，或上游存储有限。

**方案**：

- 当状态同步发现 `status` 变为 `completed` 时，`status_sync` 或独立后台任务异步下载上游结果
  并保存到 `file_cache_dir / results / {task_id} /`
- `GET /tasks/{id}/result` 收到请求时：
  1. 检查本地缓存是否存在且完整
  2. 若存在 → 流式返回本地文件
  3. 若不存在 → 回退上游流式转发；后台异步拉取缓存（不阻塞当前请求）
- 本地结果文件与任务生命周期挂钩：任务清理时同步删除

**新增字段**：`TaskRecord.result_cached: bool = default(False)`

**新增配置**：`GATEWAY_RESULT_CACHE_ENABLED`（默认 false）

**规模**：~80 行

### B8. 可配置重试状态机 🟠 P3

**触发条件**：需要按任务/按 Key 定制重试策略，或需要更细粒度的状态用于运营。

**方案**：

- 状态枚举扩展：`retry_queued`（已入重试队列）、`failed_exhausted`（重试耗尽，区别于单次失败）
- `TaskRecord` 增加 `max_retries`（nullable，可 Key 全局 + 单次覆盖）
- 引入退避策略：`delay = base_delay * 2^retry_count + random_jitter`
- 按 Key 默认重试配置存于 `ApiKey.retry_config: JSON | None`

**新增配置**：`GATEWAY_RETRY_BACKOFF_BASE`（默认 10s）、`GATEWAY_RETRY_BACKOFF_MAX`（默认 3600s）

**规模**：~100 行 + 1 migration

### B9. 多实例水平扩展 🔴 P3

**触发条件**：单实例吞吐瓶颈或需要高可用多副本。

**核心问题**：后台循环（状态同步、重提）在每个实例都跑，多实例会**重复处理同一任务**（重复重提、重复更新、重复计数限流）。

**关键依赖**：PostgreSQL、Redis、对象存储（无状态化）

**要点**：

1. **负载均衡**：前置 Nginx / traefik 分发请求。

2. **后台任务去重** — 两种选项：
   - **PostgreSQL**（推荐）：`SELECT ... FOR UPDATE SKIP LOCKED` 领取任务，天然避免重复。简洁、不引入新组件。
   - **Redis 分布式锁**：`SET key val NX PX` 圈定「谁跑后台循环」，或用 Redis 做 leader election。

3. **数据库**：必须切 PostgreSQL（asyncpg）；SQLite 不适合多写者。

4. **限流切换**：内存令牌桶 (`MemoryTokenBucket`) 替换为 Redis Lua 脚本原子令牌桶（见下方）。
   运行时依据 `GATEWAY_REDIS_URL` 是否配置，自动在内存 / Redis 间切换。

5. **无状态化**：文件暂存从本地磁盘迁对象存储（见 B10）。

**Redis 令牌桶实现**（替换 MVP 的进程内 `MemoryTokenBucket`）：

> ⚠️ 必须用 Redis 服务端时间（`TIME` 命令）作统一时钟，避免各实例
> `time.monotonic()` 不可比导致限流失效。

```python
class RedisTokenBucket:
    def __init__(self, redis_client, rate: int = 10, burst: int = 30):
        self.redis = redis_client
        self.rate = rate
        self.burst = burst

    async def acquire(self, key_id: str) -> bool:
        key = f"ratelimit:{key_id}"
        script = """
        local t = redis.call('TIME')
        local now = tonumber(t[1]) + tonumber(t[2]) / 1000000
        local tokens = redis.call('HGET', KEYS[1], 'tokens')
        local last = redis.call('HGET', KEYS[1], 'last')
        local rate = tonumber(ARGV[1])
        local burst = tonumber(ARGV[2])
        tokens = tonumber(tokens) or burst
        last = tonumber(last) or now
        local elapsed = math.max(0, now - last)
        tokens = math.min(burst, tokens + elapsed * rate)
        last = now
        if tokens >= 1 then
            tokens = tokens - 1
            redis.call('HSET', KEYS[1], 'tokens', tokens, 'last', last)
            redis.call('EXPIRE', KEYS[1], 3600)
            return 1
        else
            redis.call('HSET', KEYS[1], 'tokens', tokens, 'last', last)
            redis.call('EXPIRE', KEYS[1], 3600)
            return 0
        end
        """
        return (await self.redis.eval(script, 1, key, self.rate, self.burst)) == 1
```

**影响**：`background/*` 增加领取/加锁逻辑；`limiter/` 增加 Redis 实现；部署新增 Redis + LB；
`--workers` 限制解除（但需注意 FastAPI 的多个 worker 共享同一进程组的限制）。

**规模**：架构级重构（~400 行 + Redis 部署），不建议在明确的瓶颈出现前做

---

### B10. 大文件对象存储直传 🔴 P3

**触发条件**：大文件高并发场景下，本地磁盘暂存成为瓶颈（多实例不共享、配额难管、双重缓冲）。

**方案**：

- 引入对象存储（S3 / MinIO）。
- 两种路径可选：
  - **预签名 URL 直传**：客户端经预签名 URL 直传对象存储，Gateway 只传递引用。适合大文件、减少 gateway 带宽。
  - **Gateway 流式转存**：Gateway 接收后流式写入对象存储。实现更简单，但 gateway 仍是流量瓶颈。
- 暂存与重提所需文件从对象存储读取，使 Gateway **无状态化**，配合 B9 实现水平扩展。
- 提交流程可能变为两段式（先申请上传 URL → 客户端直传 → 提交引用）。

**影响**：`tasks/cache.py` 后端从本地磁盘切换为对象存储（抽象 FileCache 接口）；提交流程可能改为两段式。

**规模**：~200 行 + S3/MinIO 部署

---

### B11. MQ 驱动调度 🔵 P4

**触发条件**：提交 QPS 超过「DB 轮询 + 同步转发」的处理能力；需要「排队而非直接 503 拒绝」；
需要跨实例削峰、任务优先级、失败重试与死信队列等。

**权衡**：MVP 阶段明确不引入 MQ —— mineru-router 自身已有队列，Gateway 再叠一层等于**两级队列**，
状态需在 DB / MQ / 上游三处同步，反而增加容灾复杂度。「DB 即队列 + 后台轮询」在中低并发下足够。

**方案（真正需要时）**：

- 轻量：**Redis + ARQ**（async 原生）。较重：**Celery** / **RabbitMQ**。
- 提交端只做「校验 + 落队列 + 返回 task_id」，与上游 GPU 提交解耦。
- 现有 `background/retry.py`、`status_sync.py` 的手写逻辑可由 MQ 的重试/延迟队列替代。

**影响**：架构从「同步转发」转为「生产-消费」；提交路径与消费 worker 分离部署。

---

### B12. Web 管理面板 🔵 P4

**触发条件**：非技术用户需要可视化管理任务与 Key。

**方案**：基于现有 API 构建轻量前端（任务列表/详情、Key 管理、统计概览）。依赖 B3（用户体系）提供登录、B5（统计端点）提供仪表盘数据。

---

## C. 技术债务与质量改进

| 项 | 说明 | 规模 |
|----|------|------|
| **MyPy strict mode** | 当前仅 ruff 检查，未启用 mypy --strict。模型/路由/中间件有大量 `Any` 类型缺口 | 1~2天 |
| **错误响应格式统一** | auth/proxy/tasks 各模块的错误 JSON 格式不完全一致（部分返回 `{"detail": ...}`，部分返回 `{"error": ...}`）。应统一为 `{"error": {"code": "...", "message": "..."}}` | ~30 行重构 |
| **并发/大文件集成测试** | 当前 91 个单元测试，缺乏真正的大文件（>100MB）传输、高并发提交、DB 竞争场景的集成测试 | 持续补充 |
| **端到端回归测试** | 当前仅手动 e2e 测试接真实 upstream，建议 Docker Compose 起 mineru-api 做 CI 回归 | `scripts/e2e.sh` + CI job |
| **日志采样** | 高频端点（如 `/health`）会产生大量访问日志；可加 sampling 配置 | 10 行 |
| **CORS 配置** | 当前无 CORS 中间件；若被浏览器前端消费需加 | 5 行 + 配置 |

## D. 建议执行顺序

1. 阶段 1: 立刻补漏
    - A1 多 worker 守卫（防生产事故）
    - A8 启动配置校验（防配置漂移）
    - C  日志采样（防日志风暴）
2. 阶段 2: 部署前加固
    - A2 优雅停机（部署重启不丢请求）
    - A3 Gateway 自检端点（Docker healthcheck）
    - A5 上游超时可配（大文件处理）
    - C  错误格式统一（API 一致性）
3. 阶段 3: 快速价值
    - B1 幂等提交（高 RoI，无外部依赖）
    - B2 磁盘配额（生产安全）
    - B5 任务统计端点（仪表盘高频需求）
4. 阶段 4: 可观测性
    - A4 Prometheus 指标（运维增效）
    - A7 API Key 用量追踪（运营需求）
    - A6 Request ID 传播（端到端追踪）
5. 阶段 5: 核心功能
    - B3 用户管理（多租户基础）
    - B4 OAuth 2.0 登录（依赖 B3，SSO 接入）
    - B6 批量任务（高价值，中等规模）
6. 阶段 6: 按需展开
    - B7 结果预取
    - B8 可配置重试
    - C  MyPy strict
    - C  e2e CI
7. 阶段 7: 架构升级（有明确需求时才启动）
    - B9 多实例
    - B10 对象存储
    - B11 MQ
    - B12 Web UI
