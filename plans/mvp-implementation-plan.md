# mineru-gateway MVP 实现计划

> 本计划已完成，保留用于说明 MVP 的实施顺序。数据模型、接口和配置见
> `specs/mvp-implementation.md`；当前 MinerU 契约见
> `docs/mineru-reference.md`。

---

## Phase 1：骨架 + 透传 + 鉴权

- FastAPI 骨架 + SQLAlchemy 模型（ApiKey, TaskRecord）+ Alembic 迁移。
- Admin Token 签发/列出/吊销 API Key。
- 认证依赖（默认禁止匿名，`GATEWAY_ALLOW_ANONYMOUS` 开关）。
- `POST /v1/tasks`（异步）+ `POST /v1/file_parse`（同步）代理。
- `GET /v1/health` 聚合。
- 基础测试。

> **实现说明**：Phase 1 已顺带落地部分后续阶段的最小能力，以便骨架端到端可测：认证请求写入 `TaskRecord`（Phase 2 的持久化基础）、内存令牌桶限流 + 文件大小限制（Phase 4 的保护）。MinerU 4.0 health 不提供 queue/free-slot 数据，因此未保留基于队列容量的提交门控。

## Phase 2：任务持久化 + 隔离

- 认证请求任务写入 DB。
- `GET /v1/tasks/{id}` 权限校验 + 状态代理。
- `GET /v1/tasks` 列表（分页、筛选）。
- `DELETE /v1/tasks/{id}` 取消。

## Phase 3：容灾基础

- 文件暂存（store/restore/release）。
- 后台状态同步循环。
- 上游故障检测 + 简单重提（`GATEWAY_MAX_RETRIES`）。
- 过期任务 + 缓存清理。

> **实现说明**：三个后台循环（`status_sync`/`retry`/`cleanup`）均拆分出可单测的 `*_once` 单趟函数，循环体仅为 `while True: sleep; *_once`。崩溃可重试任务用中间态 `retry_pending`（`status_sync` 在上游不可达或连续轮询失败达阈值时打标），`retry` 循环在上游恢复健康后从暂存目录重提，耗尽 `GATEWAY_MAX_RETRIES` 即 `failed`。后台循环由 `GATEWAY_ENABLE_BACKGROUND` 开关控制（测试中关闭，直接驱动 `*_once`）。

## Phase 4：保护 + 加固

- 全局并发上限。
- 内存令牌桶限流。
- 文件大小限制。
- 结构化日志、Docker 构建 + compose、OpenAPI/README、端到端集成测试。

> **实现说明**：按 Key 限流、文件大小限制在 Phase 1 已落地；本阶段新增全局并发上限（DB 中 `pending+processing+retry_pending` 计数，`GATEWAY_MAX_CONCURRENT_TASKS=0` 关闭）与结构化 JSON 日志（`JsonFormatter`，含 `task_id`/`api_key_id`/`duration_ms` 等上下文字段），并补齐 Dockerfile（entrypoint 先 `alembic upgrade head` 再单 worker 启动）、docker-compose、README 与端到端集成测试。
