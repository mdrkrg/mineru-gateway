# Task Ownership

> 任务与 API Key 都恰好属于一个 user。JWT 与 Key 只是两种凭证，解析出的
> `owner_id` 是唯一的访问边界。

## 1. 数据模型

```text
ApiKey
  owner_id     UUID NOT NULL → users.id

TaskRecord
  owner_id     UUID NOT NULL → users.id     -- 唯一作用域
  api_key_id   UUID NULL     → api_keys.id  -- 创建凭据，仅审计
  idempotency_key ...
  UNIQUE (owner_id, idempotency_key)
  INDEX  (owner_id, status, created_at)
```

## 2. 作用域

```python
task.owner_id == principal.owner_id
```

| 凭证 | owner |
| --- | --- |
| `X-API-Key` | `key.owner_id` |
| `Authorization: Bearer <JWT>` | `user.id` |
| 无凭证 + `GATEWAY_ALLOW_ANONYMOUS=true` | 无；纯透传，不落库 |
| 无凭证 | `401` |

同一 owner 的 JWT 与任意 Key 共享一份任务历史：列表、统计、详情、取消、
下载都按这一条件判定。

## 3. 凭据签发

- Key：`owner_id = key.owner_id`，`api_key_id = key.id`。
- JWT：`owner_id = user.id`，`api_key_id = NULL`。
- `POST /auth/keys` 用 `email` 指定已存在的用户，admin 是代该用户签发，
  未知邮箱 → `404`。需要隔离的集成注册独立用户，隔离边界就是它本身。
- 写入门槛：JWT 与自助 Key 都受 `GATEWAY_ALLOW_UNVERIFIED_ACCOUNTS` 约束。

## 4. 幂等与限流

| 请求 | 幂等域 | 限流桶 |
| --- | --- | --- |
| `X-API-Key` | `(owner_id, idempotency_key)` | `key:<id>` |
| `Authorization: Bearer <JWT>` | `(owner_id, idempotency_key)` | `user:<id>` |
| 匿名 | 不去重 | 不限流 |

幂等域与凭据种类无关；并发写入的兜底与回查见
`specs/idempotent-submission.md`。

## 5. 迁移（breaking）

升级会删除无法归属的数据，因此不可回滚：先停服、执行迁移、再启动新版本，
回填必须在代码开始写 `owner_id` 之前完成。

1. 新增可空的 `tasks.owner_id`。
2. 从创建凭据回填 owner：

```sql
UPDATE tasks SET owner_id = (
  SELECT api_keys.owner_id FROM api_keys WHERE api_keys.id = tasks.api_key_id
) WHERE owner_id IS NULL;
```

3. 删除无主数据（先任务后 Key）：

```sql
DELETE FROM tasks    WHERE owner_id IS NULL;
DELETE FROM api_keys WHERE owner_id IS NULL;
```

4. 合并幂等域：同一 `(owner_id, idempotency_key)` 只保留最早的任务，其余把
   `idempotency_key` 置 NULL（任务保留）。
5. 收紧约束：`owner_id` 改 `NOT NULL`、`api_key_id` 改 nullable；删除
   `ix_tasks_api_key_id`、`ix_tasks_key_status_created`、
   `uq_tasks_key_idempotency`，新增 `ix_tasks_owner_status_created`、
   `uq_tasks_owner_idempotency` 与 `fk_tasks_owner_id`。
6. `api_keys.owner_id` 改 `NOT NULL`。

`downgrade` 在 `tasks` 或 `api_keys` 非空时直接 `RuntimeError`——被删除的行
无法重建；空库仍可往返，供测试与全新环境使用。

## 6. 不变量

1. 同一 owner 的任意凭证共享任务历史与幂等域。
2. 任务只对 `owner_id` 相同的请求可见，跨 owner 一律 `404`。
3. Key 吊销、过期、轮换不影响历史任务的访问。

行为回归见 `tests/core/test_task_ownership.py` 与
`tests/core/test_migrations.py`。
