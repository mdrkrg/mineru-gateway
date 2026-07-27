# mineru-gateway 架构设计

> 本文是 **高层架构与设计取舍**说明，不含具体实现细节。
>
> - MVP 落地方案（数据模型、接口、代码骨架、配置）见 `specs/mvp-implementation.md`
> - 被剥离的未来能力（触发条件与要点）见 `plans/future-enhancements.md`

---

## 1. 背景与定位

mineru-gateway 是位于客户端与 mineru-api / mineru-router 之间的**网关层**。上游 mineru 提供文档解析能力但缺少多租户、任务留存、访问控制与容灾。Gateway 在**不改变上游 API 语义**的前提下补齐这些能力。

**核心目标**：

- **兼容**：透明代理旧 API（`/file_parse`、`/tasks`、`/health`），请求/响应格式不变。
- **可控**：以 API Key 为鉴权主体，做访问控制与任务隔离。
- **可靠**：任务元数据持久化，上游崩溃后可恢复重提。
- **可保护**：健康感知门控、限流、文件大小限制，避免打垮上游。

---

## 2. 架构总览

```
  客户端 ──X-API-Key──►  mineru-gateway  ──►  mineru-router / mineru-api
                          │
                          ├─ 鉴权与访问控制
                          ├─ 任务元数据持久化 (DB)
                          ├─ 文件暂存 (容灾重提用)
                          ├─ 保护层 (限流 / 门控 / 大小限制)
                          └─ 后台循环 (状态同步 / 崩溃重提 / 清理)
```

**分层职责**：

| 层 | 职责 |
|----|------|
| 接入 | 鉴权（API Key）、限流、请求校验 |
| 代理 | 流式透传上游、响应头兼容 |
| 持久化 | 任务元数据、API Key、文件暂存 |
| 后台 | 上游状态同步、故障重提、过期清理 |
| 保护 | 健康门控、并发上限、文件大小限制 |

---

## 3. 关键设计取舍

### 3.1 鉴权：API Key 为主体，默认禁止匿名

- 以 **API Key** 作为鉴权与任务归属主体，MVP **不引入用户体系**，Key 由 `X-Admin-Token` 签发。
- 默认**禁止匿名**（可配置开启）；开启后无 Key 走纯透传、不记录任务，保证对旧 API 的完全兼容。
- 预留向用户体系 / OAuth 演进的扩展点（Key 关联 owner）。

### 3.2 存储：DB 优先，Redis/MQ 按需

- 任务元数据、API Key 存关系型数据库（默认 SQLite，可切 PostgreSQL）。
- **DB 即队列**：崩溃重提靠**后台循环扫描 pending 任务**，不引入消息队列——上游 mineru-router 已有队列，叠加 MQ 会造成多级队列、状态难同步。
- **Redis 非必需**：MVP 单实例用内存限流；Redis 仅在多实例水平扩展时引入。

### 3.3 容灾：轻量恢复而非精细状态机

- 认证请求的原始文件暂存到磁盘，上游恢复后重提。
- MVP 采用固定次数的简单重提，不做可配置重试状态机 / 断点续传（断点续传需上游支持 checkpoint）。

### 3.4 保护：面向上游健康的门控（仅同步端点）与多层背压

- **同步门控**（`POST /file_parse`）：提交前读上游 `/health`，无空闲 slot 直接 503 + `Retry-After`（拒绝而非排队）。同步端点霸占 HTTP 连接并立即消耗信号量位，饱和时快速失败避免客户端无谓等待。
- **异步排队**（`POST /tasks`）：不做提交前健康门控。MinerU 任务队列为无界 `asyncio.Queue`——提交始终返回 202，信号量（`_request_semaphore`）仅限制并发处理数而非接受数。Gateway 通过按 Key 限流 + 全局并发上限（`max_concurrent_tasks`）提供背压，与 MinerU "总是接受" 的设计一致。
- 按 Key 限流、全局并发上限、单文件大小限制。

### 3.5 部署：单实例单 worker 起步

- MVP 为单实例单 worker（内存限流与后台循环依赖进程内状态）。
- 水平扩展路径明确：PostgreSQL + Redis + 后台任务去重（`FOR UPDATE SKIP LOCKED` 或分布式锁）+ 负载均衡。

---

## 4. 能力范围

### MVP（见 `specs/mvp-implementation.md`）

- API Key 管理（Admin Token 签发/吊销）
- 透明代理：`POST /file_parse`（同步）、`POST /tasks`（异步）、`GET /tasks/{id}`、`GET /tasks/{id}/result`、`GET /health`
- 任务管理：列表、详情、取消
- 容灾：持久化、状态同步、简单重提、清理
- 保护：健康门控、内存限流、并发上限、文件大小限制
- 可观测：结构化日志、聚合健康检查

### 未来扩展（见 `plans/future-enhancements.md`）

多实例水平扩展、Redis 限流、MQ 调度、用户体系/OAuth、幂等提交、磁盘配额、统计端点、可配置重试、对象存储直传、结果预取、Web 管理面板。

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
