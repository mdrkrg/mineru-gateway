# mineru-gateway 架构设计

> 本文是 **高层架构与设计取舍**说明，不含具体实现细节。
>
> - MVP 落地方案（数据模型、接口、代码骨架、配置）见 `specs/mvp-implementation.md`
> - MVP 的历史路线图见 `plans/future-enhancements.md`

---

## 1. 背景与定位

mineru-gateway 是位于客户端与 mineru-api / mineru-router 之间的**网关层**。上游 mineru 提供文档解析能力但缺少多租户、任务留存、访问控制与容灾。Gateway 在**不改变上游 API 语义**的前提下补齐这些能力。

**核心目标**：

- **兼容**：代理 MinerU 4.0 V1 API（`/v1/file_parse`、`/v1/tasks`、`/v1/health`），匿名请求保持上游 wire contract。
- **可控**：以 API Key 为鉴权主体，做访问控制与任务隔离。
- **可靠**：任务元数据持久化，上游崩溃后可恢复重提。
- **可保护**：限流、全局任务上限、文件大小限制及上游错误透传，避免打垮上游。

---

## 2. 架构总览

```
  客户端 ──X-API-Key──►  mineru-gateway  ──►  mineru-router / mineru-api
                          │
                          ├─ 鉴权与访问控制
                          ├─ 任务元数据持久化 (DB)
                          ├─ 文件暂存 (容灾重提用)
                          ├─ 保护层 (限流 / 并发上限 / 大小限制)
                          └─ 后台循环 (状态同步 / 崩溃重提 / 清理)
```

**分层职责**：

| 层 | 职责 |
|----|------|
| 接入 | 鉴权（API Key）、限流、请求校验 |
| 代理 | V1 参数转换、上游响应转发、响应头兼容 |
| 持久化 | 任务元数据、API Key、文件暂存 |
| 后台 | 上游状态同步、故障重提、过期清理 |
| 保护 | 限流、并发上限、文件大小限制 |

---

## 3. 关键设计取舍

### 3.1 鉴权：API Key 为主体，默认禁止匿名

- 以 **API Key** 作为业务鉴权与任务归属主体；Key 可由
  `X-Admin-Token` 签发，也可由启用后的用户体系自助管理。
- 默认**禁止匿名**（可配置开启）；开启后无 Key 走纯透传、不记录任务，保持 MinerU V1 wire contract。

### 3.2 存储：DB 优先，Redis/MQ 按需

- 任务元数据、API Key 存关系型数据库（默认 SQLite，可切 PostgreSQL）。
- **DB 即队列**：Gateway 后台循环扫描 `retry_pending` 任务；执行队列由上游 mineru-router 负责，避免多级队列及跨队列状态同步。
- **Redis 非必需**：MVP 单实例用内存限流；Redis 仅在多实例水平扩展时引入。

### 3.3 容灾：轻量恢复而非精细状态机

- 认证请求的原始文件暂存到磁盘，上游恢复后重提。
- 采用固定策略的简单重提，最大次数可配置；不做完整重试状态机或断点续传
  （后者需要上游支持 checkpoint）。

### 3.4 保护：入口限制与多层背压

- **不做健康预检**：MinerU 4.0 `/v1/health` 不提供队列深度或空闲 slot，`POST /v1/file_parse` 与 `POST /v1/tasks` 都直接提交；上游拒绝或不可用时按实际状态码/网关错误返回。
- **异步背压**：Gateway 通过按 Key 限流与 `max_concurrent_tasks` 全局在制任务上限约束认证的异步提交。
- **上传限制**：每个任务最多 100 个文件，单文件默认 200 MiB，请求内文件总量默认 500 MiB；异步上传接收阶段流式写盘。

### 3.5 部署：单实例单 worker 起步

- MVP 为单实例单 worker（内存限流与后台循环依赖进程内状态）。
- 水平扩展路径明确：PostgreSQL + Redis + 后台任务去重（`FOR UPDATE SKIP LOCKED` 或分布式锁）+ 负载均衡。

---

## 4. 能力范围

### MVP（见 `specs/mvp-implementation.md`）

- API Key 管理（Admin Token 签发/吊销）
- 透明代理：`POST /v1/file_parse`（同步）、`POST /v1/tasks`（异步）、`GET /v1/tasks/{id}`、`GET /v1/tasks/{id}/result`、`GET /v1/health`
- 任务管理：列表、详情、取消
- 容灾：持久化、状态同步、简单重提、清理
- 保护：内存限流、并发上限、文件数量及大小限制
- 可观测：结构化日志、聚合健康检查

### MVP 之后

用户体系/OAuth、幂等提交、统计端点和 Web 管理面板已有独立规约并已实现。
历史路线图见 `plans/future-enhancements.md`；当前功能入口以 `README.md`
为准。

---

## 5. 技术选型（概览）

| 关注点 | 选型方向 | 理由 |
|--------|---------|------|
| Web 框架 | FastAPI | async 原生、OpenAPI、与 mineru 一致 |
| 数据访问 | SQLAlchemy 2.0 (async) + Alembic | SQLite/PG 可切换 |
| 上游调用 | httpx (async, 流式) | 大文件流式转发、连接池 |
| 限流 | 内存令牌桶（MVP）→ Redis（多实例） | 按需升级 |
| 部署 | Docker + docker-compose | 与 mineru 统一 |

具体版本、配置项与代码结构见 MVP 实现方案。
