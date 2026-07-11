# mineru-gateway 未来扩展方案

> 本文件收录**有意从 MVP 中剥离**的能力，以及触发条件、实现要点与对现有数据模型/接口的影响。
> MVP 落地方案见 `specs/mvp-implementation.md`，完整设计背景见 `specs/architecture-design.md`。
>
> 总原则：每项能力都应「按需引入」，在真实瓶颈或需求出现前不实现，避免过度设计。

---

## 目录

1. 多实例水平扩展（Redis + 后台任务去重）
2. 跨实例限流（Redis 令牌桶）
3. 消息队列驱动的任务调度
4. 用户体系与 OAuth
5. 幂等提交（X-Idempotency-Key）
6. 暂存磁盘配额（MAX_CACHE_SIZE）
7. 任务统计端点（GET /tasks/stats）
8. 可配置重试状态机
9. 大文件对象存储直传
10. 结果预取与长期留存
11. Web 管理面板

---

## 1. 多实例水平扩展（Redis + 后台任务去重）

**触发条件**：单实例吞吐/可用性不足，需要多个 Gateway 副本 + 负载均衡。

**核心问题**：MVP 的后台循环（状态同步、重提）在每个实例都会跑，多实例会**重复处理同一任务**（重复重提、重复更新）。

**方案**：

- 前置 Nginx / LB 分发请求；Gateway 本身无状态化（暂存迁至共享存储，见 §9）。
- 后台循环加分布式互斥：
  - **PostgreSQL**：`SELECT ... FOR UPDATE SKIP LOCKED` 领取任务，天然避免重复。
  - **Redis**：分布式锁（`SET key val NX PX`）圈定「谁跑后台循环」，或用 Redis 作 leader 选举。
- 数据库切换为 PostgreSQL（asyncpg），SQLite 不适合多写者。

**影响**：`background/*` 增加领取/加锁逻辑；部署新增 Redis + LB；`--workers` 限制解除。

---

## 2. 跨实例限流（Redis 令牌桶）

**触发条件**：进入多实例，或需要重启后限流状态保持、多 worker 共享。

**方案**：用 Redis Lua 脚本实现原子令牌桶，替换 MVP 的进程内 `MemoryTokenBucket`。**必须用 Redis 服务端时间**（`TIME` 命令）作统一时钟，避免各实例 `time.monotonic()` 不可比导致限流失效。

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

**影响**：`limiter/` 增加 Redis 实现，运行时依 `GATEWAY_REDIS_URL` 是否配置在内存/Redis 间切换。

---

## 3. 消息队列驱动的任务调度

**触发条件**：提交 QPS 超过「DB 轮询 + 同步转发」的处理能力；需要「排队而非直接 503 拒绝」；需要跨实例削峰、任务优先级、失败重试与死信队列等。

**权衡**：MVP 阶段**明确不引入 MQ**——mineru-router 自身已有队列，Gateway 再叠一层等于两级队列，状态需在 DB/MQ/上游三处同步，反而增加容灾复杂度。「DB 即队列 + 后台轮询」在中低并发下足够。

**方案（真正需要时）**：

- 轻量：**Redis + ARQ**（async 原生）。较重：**Celery** / **RabbitMQ**。
- 提交端只做「校验 + 落队列 + 返回 task_id」，与上游 GPU 提交解耦。
- 现有 `background/retry.py`、`status_sync.py` 的手写逻辑可由 MQ 的重试/延迟队列替代。

**影响**：架构从「同步转发」转为「生产-消费」；提交路径与消费 worker 分离部署。

---

## 4. 用户体系与 OAuth

**触发条件**：需要自助注册、多租户、按用户（而非按 Key）聚合与计费、第三方登录。

**MVP 现状**：仅 `ApiKey` + `X-Admin-Token` 签发，无 `User` 表、无 email/password。

**方案**：

- 新增 `User` 表（或 OAuth subject 映射表）。
- `ApiKey` 增加 `owner_id (nullable, FK → users.id)`——MVP 已预留该扩展点，历史 Key `owner_id` 为 NULL 兼容。
- 引入 `passlib[bcrypt]`（若做密码登录）或对接 OAuth2 / OIDC provider。
- 端点：`POST /auth/register`、`POST /auth/login`、`GET/DELETE /auth/api-keys`（用户自助管理自己的 Key，取代 Admin Token 签发）。
- 任务所有权可由 `api_key_id` 上卷到 `user_id`（一个用户多个 Key）。

**注意**：API Key 仅存 SHA256 哈希、原文不可找回，因此「登录返回已有 Key」不可行；登录应**签发新 Key** 或改用短期会话令牌。

---

## 5. 幂等提交（X-Idempotency-Key）

**触发条件**：客户端网络不稳定，需要保证「重复提交不产生重复任务」。

**MVP 现状**：重复提交会产生多个任务，可接受。

**方案**：

- `TaskRecord` 增加 `idempotency_key (nullable)`。
- 唯一约束作用域为**每 Key/每用户**：`UniqueConstraint(api_key_id, idempotency_key)`（非全局唯一，避免不同主体冲突）；匿名请求不参与去重。
- handler 提交前先按 `(api_key_id, idempotency_key)` 查已有任务，命中则直接返回。
- 可引入 `cached` 状态表示命中幂等返回。

**影响**：§6.2 handler 增加幂等检查步骤；数据模型加字段与约束。

---

## 6. 暂存磁盘配额（MAX_CACHE_SIZE）

**触发条件**：暂存目录可能被大量并发大文件写满磁盘。

**MVP 现状**：靠「任务终态即删暂存文件」+ 定期清理控制，无硬配额。

**方案**：

- 维护缓存目录总量计数器（启动时扫描 + 运行时增量）。
- 提交前校验，超过 `MAX_CACHE_SIZE`（默认 50GB）→ 503 拒绝新提交 + `Retry-After`。
- 配置项 `GATEWAY_FILE_CACHE_MAX_SIZE`。

**影响**：`tasks/cache.py` 增加配额记账；提交门控增加一项检查。

---

## 7. 任务统计端点（GET /tasks/stats）

**触发条件**：需要仪表盘/概览，或前端频繁自算 count 成为负担。

**方案**：

```yaml
GET /tasks/stats:
  security: X-API-Key
  response (200):
    pending: int
    processing: int
    completed: int
    failed: int
    today_completed: int
    today_failed: int
```

本质是 `count(*) group by status` 的便利封装。高频访问时可加缓存（Redis）。

**影响**：`tasks/routes.py` 增加端点；§3.6 可观测性补充。

---

## 8. 可配置重试状态机

**触发条件**：需要按任务/按 Key 定制重试策略，或需要区分「重试中」「重试耗尽」等精细状态用于运营。

**MVP 现状**：固定常量 `MAX_RETRIES=3` 的简单循环，耗尽即 `failed`。

**方案**：

- 状态枚举扩展：新增 `retry_queued`、`failed_exhausted`。
- `TaskRecord` 增加 `max_retries (可配置)`；支持按 Key/全局默认。
- 引入退避策略（指数退避 + 抖动）。

**影响**：状态机与 §6.4 重提逻辑扩展；`GET /tasks` 状态筛选值增加。

---

## 9. 大文件对象存储直传

**触发条件**：大文件高并发场景下，本地磁盘暂存成为瓶颈（多实例不共享、配额难管、双重缓冲）。

**方案**：

- 引入对象存储（S3 / MinIO）。
- 客户端经**预签名 URL 直传**对象存储，Gateway 只传递引用；或 Gateway 流式转存对象存储。
- 暂存与重提所需文件从对象存储读取，使 Gateway **无状态化**，配合 §1 实现水平扩展。

**影响**：`tasks/cache.py` 后端从本地磁盘切换为对象存储；提交流程可能改为两段式（先申请上传 URL）。

---

## 10. 结果预取与长期留存

**触发条件**：上游结果 TTL（如 24h）过期后客户端仍需下载。

**方案**：任务完成后后台异步将结果预取到对象存储，`GET /tasks/{id}/result` 优先从对象存储返回，回退上游。

**影响**：新增预取后台任务 + 结果存储位置字段。

---

## 11. Web 管理面板

**触发条件**：非技术用户需要可视化管理任务与 Key。

**方案**：基于现有 API 构建轻量前端（任务列表/详情、Key 管理、统计概览）。依赖 §4（用户体系）提供登录。

---

## 引入优先级建议

| 优先级 | 能力 | 依赖 |
|:---:|------|------|
| P1 | 幂等提交（§5） | 无（数据模型小改） |
| P1 | 磁盘配额（§6） | 无 |
| P2 | 多实例 + Redis 限流（§1、§2） | PostgreSQL |
| P2 | 大文件对象存储直传（§9） | 对象存储 |
| P3 | 用户体系 / OAuth（§4） | - |
| P3 | 统计端点（§7）、可配置重试（§8） | - |
| P4 | MQ 调度（§3）、结果预取（§10）、Web UI（§11） | 视规模 |
