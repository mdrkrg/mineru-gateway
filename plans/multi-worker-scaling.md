# 多 Worker 水平扩展方案

> 当前 `GATEWAY_WORKERS=1` 启动守卫禁止 `>1`，因为以下三个组件是单进程作用域、
> 多 worker 并发会导致静默错误（重复限流、重复重提、后台竞跑）。
> 本文描述移除该限制需要解决的三个核心问题及方案概要，不涉及具体实现细节。

## 前提条件

- **数据库**：SQLite → PostgreSQL。多写者场景下 SQLite 的 WAL 锁争用无法支撑。
- **部署**：引入 Redis（至少用于限流）。

## 问题 1：限流 — 进程内令牌桶 → Redis 原子令牌桶

**现状**：`MemoryTokenBucket` 是进程内 Python 对象，每个 worker 各自有一份。worker A
扣了自己的桶而 worker B 不可知，同一 API Key 实际可并发数 = `单 worker 限制 × worker 数`，
限流形同虚设。

**方案**：用 Redis 替代内存存储。

- 每个 API Key 对应一个 Redis hash `ratelimit:{key_id}`，存储 `tokens` 和 `last`（上次补充时间）。
- 速率检查用 Redis Lua 脚本原子执行（读-算-写），避免读改写的竞态窗口。
- 时钟统一使用 Redis 服务端 `TIME` 命令，避免多实例 `time.monotonic()` 不可比导致限流失效。
- 启动时依据 `GATEWAY_REDIS_URL` 是否配置，自动在 `MemoryTokenBucket` / `RedisTokenBucket` 间切换，单机部署无需强制引入 Redis。

**影响面**：`limiter/` 模块新增 `RedisTokenBucket` 实现；`main.py` lifespan 按配置选择后端。

## 问题 2：后台循环竞跑 — 多 Worker 重复领取任务

**现状**：`status_sync_loop`、`retry_loop`、`cleanup_loop` 在 `lifespan` 中由 `asyncio.create_task` 启动。每个 worker 进程都跑一份，多个 worker 会重复轮询同一批任务、重复重试提交。

**方案**：领取任务时加行级锁。

- 查询待处理/可重试任务时使用 `SELECT ... FOR UPDATE SKIP LOCKED LIMIT N`。
- Worker A 锁住的行，Worker B 的查询自动跳过，天然避免重复处理。
- 不引入额外的分布式锁或 leader election，利用 PostgreSQL 已有的行锁语义。

**影响面**：`background/` 三个 loop 的查询语句，将普通 `SELECT` 改为 `FOR UPDATE SKIP LOCKED`。

## 问题 3：文件暂存 — 本地磁盘 → 对象存储（跨机器场景）

**现状**：用户上传的文件暂存到本地 `FileCache`（`file_cache_dir`），重试提交时从磁盘读回。
同机多 worker 共享同一目录没有问题（文件系统天然支持并发读写），但**跨机器水平扩展**
时，worker A 暂存的文件 worker B 无法访问。

**方案**：仅跨机器扩展时需要。

- 抽象 `FileCache` 后端接口，支持本地磁盘和对象存储（S3/MinIO）两种实现。
- 对象存储路径下：提交改为两段式（客户端先获取预签名上传 URL → 直传 → 提交引用），
  或 Gateway 接收后流式转存。前者减轻 Gateway 带宽压力，适合大文件场景。
- 故障恢复的重试提交从对象存储读取原始文件。

**影响面**：`tasks/cache.py` 后端可插拔化；提交路由可能改为两段式。

## 总结

| 场景 | 需要解决 |
|------|---------|
| 单机 `--workers N` | 问题 1（Redis 限流）+ 问题 2（SKIP LOCKED） |
| 多机水平扩展 | 全部三个问题 + PostgreSQL + 前置负载均衡 |
