# mineru-gateway MVP 实现计划

> 本文件是 MVP 的**分阶段实现计划**，规约（数据模型、接口、模块设计、配置）见 `specs/mvp-implementation.md`。
> 未来扩展能力见 `plans/future-enhancements.md`。

---

## Phase 1：骨架 + 透传 + 鉴权

- FastAPI 骨架 + SQLAlchemy 模型（ApiKey, TaskRecord）+ Alembic 迁移。
- Admin Token 签发/列出/吊销 API Key。
- 认证依赖（默认禁止匿名，`GATEWAY_ALLOW_ANONYMOUS` 开关）。
- `POST /tasks`（异步）+ `POST /file_parse`（同步）流式透传。
- `GET /health` 聚合。
- 基础测试。

> **实现说明**：Phase 1 已顺带落地部分后续阶段的最小能力，以便骨架端到端可测：认证请求写入 `TaskRecord`（Phase 2 的持久化基础）、健康感知提交门控 + 内存令牌桶限流 + 文件大小限制（Phase 4 的保护）。这些能力的完整形态（`GET /tasks` 列表、取消、后台循环、全局并发上限等）仍按对应阶段推进。测试因此已覆盖这些提前落地的路径。

## Phase 2：任务持久化 + 隔离

- 认证请求任务写入 DB。
- `GET /tasks/{id}` 权限校验 + 状态代理。
- `GET /tasks` 列表（分页、筛选）。
- `DELETE /tasks/{id}` 取消。

## Phase 3：容灾基础

- 文件暂存（store/restore/release）。
- 后台状态同步循环。
- 上游故障检测 + 简单重提（固定 `MAX_RETRIES`）。
- 过期任务 + 缓存清理。

> **实现说明**：三个后台循环（`status_sync`/`retry`/`cleanup`）均拆分出可单测的 `*_once` 单趟函数，循环体仅为 `while True: sleep; *_once`。崩溃可重试任务用中间态 `retry_pending`（`status_sync` 在上游不可达或连续轮询失败达阈值时打标），`retry` 循环在上游恢复健康后从暂存目录重提，耗尽 `MAX_RETRIES` 即 `failed`。后台循环由 `GATEWAY_ENABLE_BACKGROUND` 开关控制（测试中关闭，直接驱动 `*_once`）。

## Phase 4：保护 + 加固

- 健康感知提交门控 + 全局并发上限。
- 内存令牌桶限流。
- 文件大小限制。
- 结构化日志、Docker 构建 + compose、OpenAPI/README、端到端集成测试。
