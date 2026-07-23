# User Management & OAuth 实现规约

> 基于 `specs/mvp-implementation.md`（MVP API Key 鉴权）、`plans/future-enhancements.md`（B3 用户管理、B4 OAuth 2.0 登录）、`src/mineru_gateway/models.py`（现有数据模型），使用 `fastapi-users` 库实现用户管理与 OAuth 登录。

## 0. 目标与非目标

**目标**：在现有 API Key + Admin Token 鉴权体系旁，增加**用户管理**（email/password 注册登录）和 **OAuth 2.0 OIDC 登录**，实现：

1. 用户通过 email + password 注册（可选开关）和登录，获得 JWT 访问令牌。
2. 用户通过 OIDC 提供商（如 Keycloak、Auth0 等）登录，自动创建/关联用户。
3. 用户管理自己的 API Key（创建、列出、吊销），替代管理员手工签发。
4. 现有的 `X-API-Key` 业务鉴权**不变**，`X-Admin-Token` 管理鉴权**不变**。
5. 访问令牌（access token）短期有效，刷新令牌（refresh token）长期有效，实现无状态令牌刷新。

**非目标**：

- 重置密码（`forgot_password`）/ 验证邮箱（`verify`）—— 依赖 SMTP，不纳入本阶段。
- 令牌吊销黑名单（token blacklist）—— 无状态 JWT 不提供吊销；未来可对接 Redis 黑名单（`plans/future-enhancements.md` B9）。
- Web UI 管理面板 —— 仅提供 API。
- 用户角色与权限细粒度控制 —— `is_superuser` 字段保留但未使用，角色系统见未来规划。
- 删除用户 —— 本规约不提供 `DELETE /users/{id}` 端点。

## 1. 架构

### 1.1 双重鉴权模式

```
X-API-Key ────────────►  require_api_key()
                 ┌────►  (现有: 业务请求, /tasks, /proxy)
                 │
X-Admin-Token ───┤──►  require_admin_token()
                 │    (现有: 管理 Key, /auth/keys)
                 │
                 └────►  current_active_user()
Authorization: Bearer <JWT> ──►  (新增: 用户管理, OAuth, /me/api-keys, /users/me)
```

三种鉴权方式**共存**，各自守卫不同端点：

| 鉴权方式 | 守卫端点 | 范围 |
|---------|---------|------|
| `X-API-Key` | `POST /tasks`, `POST /file_parse`, `GET /tasks/*` 等 | 业务请求（现有） |
| `X-Admin-Token` | `POST /auth/keys`, `GET /auth/keys`, `DELETE /auth/keys/{id}`, `POST /auth/users` | 管理员管理 Key 与用户（现有 + 新增） |
| `Authorization: Bearer <JWT>` | `GET /users/me`, `PATCH /users/me`, `POST /auth/jwt/logout`, `GET /me/api-keys`, `POST /me/api-keys`, `DELETE /me/api-keys/{id}` | 用户自助（新增） |

无鉴权的公共端点：`POST /auth/jwt/login`、`POST /auth/jwt/refresh`、`POST /auth/register`（受开关控制）、`GET /auth/oauth/{provider}/authorize`、`GET /auth/oauth/{provider}/callback`。

### 1.2 OAuth 流程

```
  客户端 / 浏览器              Gateway                    OIDC Provider
      │                          │                            │
      │  GET /auth/oauth/{p}/authorize                        │
      │────────────────────────► │                            │
      │  302 + Set-Cookie (csrf) │                            │
      │◄─────────────────────────│                            │
      │                          │                            │
      │  302 redirect to OIDC    │                            │
      │──────────────────────────────────────────────────────►│
      │                          │                            │
      │  用户登录 + 授权         │                            │
      │                          │                            │
      │  GET /auth/oauth/{p}/callback?code=...&state=...      │
      │◄──────────────────────────────────────────────────────│
      │                          │                            │
      │                          │  exchange code for token   │
      │                          │───────────────────────────►│
      │                          │  access_token + id_token   │
      │                          │◄───────────────────────────│
      │                          │  userinfo_endpoint         │
      │                          │  (get_profile)             │
      │                          │───────────────────────────►│
      │                          │  name, email, sub, ...     │
      │                          │◄───────────────────────────│
      │                          │                            │
      │                          │  upsert User + OAuthAccount│
      │                          │  issue token pair          │
      │  {access_token,          │                            │
      │   refresh_token}         │                            │
      │◄─────────────────────────│                            │
```

## 2. 数据模型

### 2.1 现有模型（无变更）

`src/mineru_gateway/models.py` 中已存在以下模型，**本规约不新增任何表或列**：

**`User`**（继承 `SQLAlchemyBaseUserTable`）：

| 字段 | 类型 | 来源 | 说明 |
|------|------|------|------|
| `id` | UUID (PK) | `SQLAlchemyBaseUserTable` | UUIDv7 |
| `email` | String(320), unique, index | `SQLAlchemyBaseUserTable` | 登录邮箱 |
| `hashed_password` | String(1024) | `SQLAlchemyBaseUserTable` | bcrypt 哈希 |
| `is_active` | Boolean | `SQLAlchemyBaseUserTable` | 是否激活 |
| `is_superuser` | Boolean | `SQLAlchemyBaseUserTable` | 是否超级管理员（本规约不使用） |
| `is_verified` | Boolean | `SQLAlchemyBaseUserTable` | 是否已验证邮箱（本规约不强制，留作标识） |
| `display_name` | String(255), nullable | 自定义 | 显示名称，OAuth 登录时从 userinfo 填充 |
| `created_at` | DateTime(timezone=True) | 自定义 | 创建时间 |
| `updated_at` | DateTime(timezone=True) | 自定义 | 更新时间 |

关系：`User 1:N OAuthAccount`（`oauth_accounts`），`User 1:N ApiKey`（`api_keys`，通过 `owner_id`）。

**`OAuthAccount`**（继承 `SQLAlchemyBaseOAuthAccountTable`）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID (PK) | UUIDv7 |
| `user_id` | UUID, FK → users.id, ondelete=cascade | 所属用户 |
| `oauth_name` | String(100) | OAuth 提供商名称（如 `"keycloak"`、`"auth0"`） |
| `access_token` | String(1024) | OAuth 提供商返回的 access_token（用于调用 userinfo） |
| `expires_at` | Integer, nullable | OAuth 令牌过期时间（Unix 时间戳） |
| `refresh_token` | String(1024), nullable | OAuth 提供商返回的 refresh_token |
| `account_id` | String(320) | OIDC `sub` 声明，提供商侧用户唯一 ID |
| `account_email` | String(320) | OIDC `email` 声明 |

唯一约束：`(oauth_name, account_id)` —— 同一提供商内同一用户只关联一次。

> **已知限制**：`access_token` 和 `refresh_token` 列定义为 `String(1024)`。部分 OIDC 提供商的 JWT 令牌可能超出此长度，导致写入数据库失败。如果目标提供商令牌超长，需要一个 Alembic 迁移扩展列长度（如 `String(2048)` 或 `Text`）。

**`ApiKey`**：

| 字段 | 类型 | 说明 |
|------|------|------|
| ... | ... | 现有字段（`key_hash`、`key_prefix`、`label`、`created_at`、`last_used_at`、`expires_at`、`is_active`） |
| `owner_id` | UUID, nullable, FK → users.id | 关联的用户。`None` 表示管理员通过 `X-Admin-Token` 创建的 Key |

### 2.2 关系图

```
User ──1:N──► OAuthAccount（通过 user_id）
User ──1:N──► ApiKey（通过 owner_id，nullable）
```

### 2.3 迁移状态

以下迁移已存在，无需新增：

| 迁移文件 | 说明 |
|---------|------|
| `f6fdc978828b_initial_schema.py`（revision `f6fdc978828b`） | 初始 ApiKey、TaskRecord 表 |
| `e795202aca0b_add_users_and_oauth.py`（revision `e795202aca0b`） | 创建 users 和 oauth_accounts 表 |
| `e6ce36543398_add_owner_id_to_api_keys.py`（revision `e6ce36543398`） | 在 api_keys 表增加 owner_id 列 |

## 3. 配置项

环境变量前缀 `GATEWAY_`，通过 `pydantic-settings` 加载。

### 3.1 新增配置

| 环境变量 | 默认值 | 必需 | 说明 |
|---------|--------|------|------|
| `GATEWAY_USER_AUTH_ENABLED` | `false` | 否 | 用户认证功能总开关。`false` 时所有用户/JWT 相关路由不注册 |
| `GATEWAY_JWT_SECRET` | `"change-me"` | 是* | JWT 签名密钥。`user_auth_enabled=true` 时必须设置为强密码 |
| `GATEWAY_JWT_ACCESS_LIFETIME_SECONDS` | `900` | 否 | 访问令牌生命周期（秒，默认 15 分钟） |
| `GATEWAY_JWT_REFRESH_LIFETIME_SECONDS` | `604800` | 否 | 刷新令牌生命周期（秒，默认 7 天） |
| `GATEWAY_OPEN_REGISTRATION` | `false` | 否 | 是否开放 email/password 注册。`false` 时 `POST /auth/register` 返回 403 |
| `GATEWAY_OIDC_PROVIDERS` | `[]` | 否 | JSON 数组，每个元素描述一个 OIDC 提供商（见下方格式） |
| `GATEWAY_OAUTH_REDIRECT_BASE_URL` | `GATEWAY_URL` 的值 | 否 | OAuth 回调的基础 URL。用于构造 `{base_url}/auth/oauth/{provider}/callback` |
| `GATEWAY_OAUTH_FRONTEND_REDIRECT_URL` | `""` | 否 | 如果设置，OAuth 回调完成后 302 重定向到此 URL，令牌以 URI fragment 传递；未设置时返回 JSON |

> \* `user_auth_enabled=true` 时 `jwt_secret` 为必需；启动时校验长度 >= 32 字符，不足则拒绝启动。

### 3.2 OIDC 提供商配置格式

`GATEWAY_OIDC_PROVIDERS` 是一个 JSON 数组，每个元素：

```json
{
  "name": "keycloak",
  "openid_configuration_endpoint": "https://keycloak.example.com/realms/myrealm/.well-known/openid-configuration",
  "client_id": "my-client-id",
  "client_secret": "my-client-secret"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 提供商标识，用于 URL 路径（`/auth/oauth/{name}/authorize`）。必须 URL-safe（字母、数字、连字符）且唯一 |
| `openid_configuration_endpoint` | string | OIDC Discovery URL（指向 `.well-known/openid-configuration`） |
| `client_id` | string | OAuth 2.0 客户端 ID |
| `client_secret` | string | OAuth 2.0 客户端密钥 |

### 3.3 现有配置新增含义

| 现有配置 | 新增含义 |
|---------|---------|
| `GATEWAY_URL` | 如果未设置 `GATEWAY_OAUTH_REDIRECT_BASE_URL`，则以此作为 OAuth 回调基础 URL |

## 4. API 规范

### 4.1 认证端点（JWT）

#### 登录

```
POST /auth/jwt/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "supersecret"
}
```

**认证**：无

**成功响应**（200）：

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer"
}
```

**失败**：401 — email 或 password 错误。

**行为**：验证 email + password → 签发访问令牌（短期）和刷新令牌（长期）→ 返回令牌对。

#### 刷新令牌

```
POST /auth/jwt/refresh
Content-Type: application/json

{
  "refresh_token": "eyJhbGciOiJIUzI1NiIs..."
}
```

**认证**：无（请求体携带刷新令牌）

**成功响应**（200）：

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer"
}
```

**失败**：401 — 刷新令牌无效、过期或签名错误。

**行为**：验证刷新令牌（audience、签名、过期时间）→ 获取用户 → 签发新的访问令牌。刷新令牌本身不更替（非滑动窗口）。

#### 登出

```
POST /auth/jwt/logout
Authorization: Bearer <access_token>
```

**认证**：JWT（access token）

**响应**（200）：`{"message": "Logged out"}`

**行为**：无状态登出，仅返回 200。客户端应丢弃本地令牌。不维护服务器端黑名单。

### 4.2 注册端点

#### 注册

```
POST /auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "supersecret",
  "display_name": "User Example"
}
```

**认证**：无

**成功响应**（201）：

```json
{
  "id": "uuid",
  "email": "user@example.com",
  "display_name": "User Example",
  "is_active": true,
  "is_superuser": false,
  "is_verified": false,
  "created_at": "2026-07-22T12:00:00Z",
  "updated_at": "2026-07-22T12:00:00Z"
}
```

**失败**：

- 400 — email 已存在、密码不符合规则（长度<8 或包含 email）。
- 403 — `GATEWAY_OPEN_REGISTRATION=false`（注册被管理员关闭）。

**行为**：

- 如果 `GATEWAY_OPEN_REGISTRATION=false`，返回 403，不创建用户。
- 如果 `GATEWAY_OPEN_REGISTRATION=true`，验证 email 唯一性、密码强度 → 创建用户 → 返回用户信息。**不**自动签发令牌（注册后需登录）。

#### 管理员创建用户

```
POST /auth/users
X-Admin-Token: <admin_token>
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "setup-password",
  "display_name": "User Example"
}
```

**认证**：`X-Admin-Token`

**成功响应**（201）：同注册响应。

**失败**：400 — email 已存在、密码不符合规则。401 — Admin Token 无效。

**行为**：此端点**不受 `GATEWAY_OPEN_REGISTRATION` 影响**，管理员总是可以创建用户。当注册关闭时，此端点是创建用户的唯一途径。

### 4.3 用户信息端点

#### 获取当前用户

```
GET /users/me
Authorization: Bearer <access_token>
```

**认证**：JWT（access token）

**响应**（200）：同注册响应体（`UserRead`）。

**失败**：401 — 无 JWT 或无效 JWT。

#### 更新当前用户

```
PATCH /users/me
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "display_name": "New Name",
  "password": "new-password"
}
```

**认证**：JWT（access token）

**响应**（200）：更新后的用户信息（`UserRead`）。

**失败**：

- 401 — 无 JWT 或无效 JWT。
- 400 — 密码不符合规则（长度<8 或包含 email）。

**行为**：`email` 不可通过此端点修改。`password` 可选，传入时更新密码哈希。`display_name` 可选。

### 4.4 API Key 自助服务端点

#### 列出我的 API Key

```
GET /me/api-keys
Authorization: Bearer <access_token>
```

**认证**：JWT（access token）

**响应**（200）：

```json
{
  "keys": [
    {
      "id": "uuid",
      "api_key_prefix": "mru_abc1",
      "label": "my-key",
      "created_at": "2026-07-22T12:00:00Z",
      "last_used_at": null,
      "expires_at": null,
      "is_active": true
    }
  ]
}
```

**失败**：401 — 无 JWT 或无效 JWT。

**行为**：仅返回 `owner_id == 当前用户.id` 的 Key。不返回其他用户的 Key 或 `owner_id=NULL` 的 Key。

#### 创建 API Key

```
POST /me/api-keys
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "label": "my-key",
  "expires_at": "2026-08-01T00:00:00Z"
}
```

**认证**：JWT（access token）

**请求体**：`label`（可选，默认空字符串），`expires_at`（可选，ISO datetime，不传则永不过期）。

**响应**（201）：

```json
{
  "key_id": "uuid",
  "api_key": "mru_abc123def456...",
  "api_key_prefix": "mru_abc1",
  "message": "Save this API key. It will not be shown again."
}
```

**失败**：

- 401 — 无 JWT 或无效 JWT。
- 422 — `expires_at` 格式无效。

**行为**：创建 Key，`owner_id` 设为当前用户 ID。`label` 语义为用户对 Key 的命名。返回的 API Key 明文仅此一次可见。

#### 吊销 API Key

```
DELETE /me/api-keys/{key_id}
Authorization: Bearer <access_token>
```

**认证**：JWT（access token）

**成功响应**（204）：无内容。

**失败**：

- 401 — 无 JWT 或无效 JWT。
- 404 — Key 不存在或不属于当前用户（统一返回 404，不区分两种情况，防止枚举）。
- 422 — `key_id` 不是有效的 UUID。

**行为**：先校验 `owner_id == 当前用户.id`，是则设置 `is_active=false` 返回 204；否则返回 404（不区分 Key 不存在和无权限）。格式错误的 UUID 返回 422（由 FastAPI 自动处理）。

### 4.5 OAuth 端点

#### 发起 OAuth 授权

```
GET /auth/oauth/{provider}/authorize
```

**认证**：无

**请求参数**：无。回调 URL 固定为 `{GATEWAY_OAUTH_REDIRECT_BASE_URL}/auth/oauth/{provider}/callback`。

**响应**：302 重定向到 OIDC 提供商的授权页面。同时设置 CSRF 保护 cookie（包含加密的 state 参数）。

**行为**：

- 根据 `{provider}` 在配置的 `GATEWAY_OIDC_PROVIDERS` 中查找对应的 OIDC 客户端。
- 如果 `{provider}` 不存在，返回 404。
- 生成 state 参数（防 CSRF），存入签名 cookie。
- 重定向到 OIDC 提供商授权页面。

#### OAuth 回调

```
GET /auth/oauth/{provider}/callback?code=...&state=...
```

**认证**：无（code 交换）

**成功响应**（JSON 格式，当 `GATEWAY_OAUTH_FRONTEND_REDIRECT_URL` 未设置时）：

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer"
}
```

**成功响应**（重定向格式，当 `GATEWAY_OAUTH_FRONTEND_REDIRECT_URL` 设置时）：

```
HTTP/1.1 302 Found
Location: {frontend_redirect_url}#access_token=eyJ...&refresh_token=eyJ...&token_type=bearer
```

**失败**：

- 400 — state 不匹配（CSRF 攻击或过期 cookie）。
- 400 — code 交换失败（OIDC 提供商拒绝）。
- 400 — email 已存在且 OIDC 提供商未返回 `email_verified` 声明（无法确认邮箱所有权，返回 400 防止账户接管）。
- 409 — email 已存在且 OIDC 提供商返回 `email_verified=false`（明确声明的未验证邮箱，拒绝关联）。

**行为**（按顺序）：

1. 验证 CSRF state cookie 与请求参数中的 `state` 匹配。
2. 使用 OIDC 客户端交换 code 获取 access_token（`get_access_token`）。
3. 调用 OIDC 提供商的 `userinfo_endpoint` 获取用户信息（`get_profile`），提取：
   - `sub` → `OAuthAccount.account_id`
   - `email` → `OAuthAccount.account_email` 和 `User.email`
   - `display_name` → 按优先级取第一个非空值：`name` > `preferred_username` > `given_name` > email 本地部分（`@` 之前的部分）
   - `email_verified` → 提取布尔值，供步骤 4 决定 `User.is_verified` 是否设置
4. 按 `(oauth_name, account_id)` 查找已有 `OAuthAccount`：
   - 存在 → 更新 `access_token`/`refresh_token`/`expires_at`，使用已有 User。`is_verified` **不升级**（仅在新创建 User 时设置）。
   - 不存在 → 按 `email` 查找 User：
     - 存在 → 根据 `email_verified` 决定：
       - `email_verified=true` → 关联到已有 User（提供商已验证邮箱所有权）。`is_verified` **不升级**。
       - `email_verified=false` → 返回 409，拒绝关联（提供商明确声明未验证邮箱）。
       - `email_verified` 缺失 → 返回 400，拒绝关联（保守安全，无法确认邮箱所有权）。
     - 不存在 → 创建新 User（`display_name` 从 userinfo 填充，`is_verified` 从 `email_verified` 设置）。
5. 创建 `OAuthAccount` 记录（关联到 User）。
6. 签发令牌对（access + refresh）。
7. 返回 JSON 或重定向到前端。

### 4.6 现有端点不变

以下端点**不受本规约影响**，保持原有行为：

| 端点 | 鉴权 | 变化 |
|------|------|------|
| `POST /auth/keys` | `X-Admin-Token` | 不变。`owner_id` 为 `NULL`（管理员创建） |
| `GET /auth/keys` | `X-Admin-Token` | 不变。列出所有 Key（包括有 owner 的） |
| `DELETE /auth/keys/{key_id}` | `X-Admin-Token` | 不变。管理员可吊销任何 Key |
| `POST /tasks` | `X-API-Key` | 不变 |
| `POST /file_parse` | `X-API-Key` | 不变 |
| `GET /tasks`, `GET /tasks/{id}`, `DELETE /tasks/{id}`, `GET /tasks/{id}/result` | `X-API-Key` | 不变 |
| `GET /health` | 无 | 不变 |

## 5. 核心模块设计

> 本节为**实现参考**，描述包结构和可测试接口。实现者可以自由选择内部实现细节，但必须暴露本节列出的接口。测试基于本节定义的接口编写 stub，不依赖内部实现。

### 5.1 包结构

```
src/mineru_gateway/auth/
├── __init__.py
├── backend.py              # JWT 认证后端：鉴权策略、令牌签发与验证
├── dependencies.py         # [修改] 增加 get_user_db, get_user_manager, current_active_user
├── manager.py              # UserManager（用户注册/登录回调）、FastAPIUsers 实例
├── schemas.py              # UserRead, UserCreate, UserUpdate, 令牌响应 schemas
├── jwt_routes.py           # /auth/jwt/login, /auth/jwt/refresh, /auth/jwt/logout, /auth/register, /auth/users
├── user_routes.py          # /users/me (get_users_router)
├── api_keys_me.py          # /me/api-keys
├── service.py              # [修改] 增加 owner 作用域的 API Key 方法
├── routes.py               # /auth/keys, /auth/users (admin create user)
└── oauth/
    ├── __init__.py
    ├── base.py              # OIDC 客户端工厂
    └── routes.py            # /auth/oauth/{provider}/authorize, /auth/oauth/{provider}/callback
```

### 5.2 可测试接口

以下接口是测试所需调用的公开契约。测试可以 stub 这些接口，不依赖内部实现。

#### `auth/backend.py` — 令牌操作

| 接口 | 输入 | 输出 | 行为 |
|------|------|------|------|
| `issue_token_pair(user)` | `User` 对象 | `{access_token: str, refresh_token: str, token_type: "bearer"}` | 签发访问令牌（aud=fastapi-users:auth，短期）和刷新令牌（aud=fastapi-users:refresh，长期），使用 `GATEWAY_JWT_SECRET` 签名 |
| `verify_refresh_token(session, token)` | `session: AsyncSession, token: str`（JWT） | `User` 对象 | 验证刷新令牌签名、audience、过期时间，通过 session 查询用户并校验 `is_active`；验证失败时返回 `None`，路由层抛异常 |

#### `auth/manager.py` — UserManager

| 接口 | 输入 | 输出 | 行为 |
|------|------|------|------|
| `UserManager.validate_password(password, user)` | `password: str, user: UserCreate | User` | `None` 或抛出 `InvalidPasswordException` | 密码长度≥8 且不能包含 email |
| `UserManager.on_after_register(user, request)` | `user: User, request: Request | None` | `None` | 打印结构化日志 `User {id} registered` |
| `UserManager.on_after_login(user, request, response)` | `user: User, request: Request | None, response: Response | None` | `None` | 打印结构化日志 `User {id} logged in` |

#### `auth/oauth/base.py` — OIDC 客户端查找

| 接口 | 输入 | 输出 | 行为 |
|------|------|------|------|
| `get_oauth_client(name)` | `name: str`（提供商标识） | `OAuthClient | None` | 从 `GATEWAY_OIDC_PROVIDERS` 配置中按名称查找并返回 OIDC 客户端；不存在时返回 `None` |

`OAuthClient` 必须提供以下方法（httpx-oauth 的 `OpenID` 类满足此契约）：

| 方法 | 输入 | 输出 | 行为 |
|------|------|------|------|
| `get_authorization_url(redirect_uri, state)` | `redirect_uri: str, state: str` | `str` | 返回 OIDC 提供商授权页面的 URL |
| `get_access_token(code, redirect_uri)` | `code: str, redirect_uri: str` | `OAuth2Token` | 交换 code 获取 access_token |
| `get_profile(token)` | `token: str` | `dict` | 调用 `userinfo_endpoint` 返回用户信息（含 `sub`、`email`、`name`、`email_verified` 等） |

#### `auth/service.py` — owner 作用域 API Key

| 接口 | 输入 | 输出 | 行为 |
|------|------|------|------|
| `create_key_for_user(session, user_id, label, expires_at)` | `session: AsyncSession, user_id: UUID, label: str | None, expires_at: datetime | None` | `(ApiKey, raw_key: str)` | 创建 Key，`owner_id` 设为 `user_id`，返回记录和明文 |
| `list_keys_for_user(session, user_id)` | `session: AsyncSession, user_id: UUID` | `list[ApiKey]` | 按 `owner_id` 过滤返回 |
| `revoke_key_for_user(session, key_id, user_id)` | `session: AsyncSession, key_id: UUID, user_id: UUID` | `bool` | 校验 `owner_id == user_id`，设置 `is_active=False`；不匹配返回 `False` |

### 5.3 修改文件

| 文件 | 修改内容 |
|------|---------|
| `auth/dependencies.py` | 增加 `get_user_db`、`get_user_manager`、`current_active_user` 三个 FastAPI 依赖 |
| `auth/service.py` | 增加 `create_key_for_user`、`list_keys_for_user`、`revoke_key_for_user` 三个口径 |
| `config.py` | 增加 §3.1 所述所有配置项 |
| `main.py` | `GATEWAY_USER_AUTH_ENABLED=true` 时注册 `jwt_routes`、`user_routes`、`api_keys_me`、`oauth.routes` 四个路由模块 |

## 6. 集成要点

### 6.1 与现有 API Key 鉴权的关系

| 创建途径 | `owner_id` | 谁可查看/吊销 |
|---------|-----------|-------------|
| `POST /auth/keys`（Admin Token） | `NULL` | 仅管理员（`X-Admin-Token`） |
| `POST /me/api-keys`（JWT） | 用户 ID | 用户自己（JWT）和管理员（Admin Token） |

`GET /me/api-keys` 只返回 `owner_id == 当前用户.id` 的 Key，不影响 `/auth/keys` 的管理员全局视图。

### 6.2 与现有任务鉴权的关系

`POST /tasks`、`GET /tasks` 等端点**仍然使用 `X-API-Key` 鉴权**，不受 JWT 影响。用户通过 `/me/api-keys` 创建的 Key 与管理员创建的 Key 在业务层面**无差别**（均为有效的 API Key）。

### 6.3 用户认证总开关

`GATEWAY_USER_AUTH_ENABLED=false`（默认值）时：

- 不注册任何 JWT/OAuth/用户相关路由。
- 仅注册 `/auth/keys`（Admin Token）和业务路由。
- `api_keys.owner_id` 字段存在但不使用（所有 Key 的 `owner_id` 为 `NULL`）。

`GATEWAY_USER_AUTH_ENABLED=true` 时：注册所有新增路由，用户可登录、注册（受开关控制）、OAuth 登录、管理 Key。

## 7. 安全考量

### 7.1 JWT 密钥

- `GATEWAY_JWT_SECRET` 长度至少 32 字符（建议 `openssl rand -hex 32`），否则拒绝启动。
- 访问令牌和刷新令牌使用同一密钥签名，但 audience 不同以防止混淆。

### 7.2 OAuth CSRF 保护与邮箱关联

- 授权请求生成随机 state 参数，存入签名 cookie（`httponly=true`，`secure=取决于环境`，`samesite=lax`）。
- 回调时验证 state 参数与 cookie 一致，防止 CSRF 攻击。
- 邮箱关联策略由 OIDC 标准声明 `email_verified` 驱动：提供商声明已验证时自动关联，否则拒绝。无需配置项，行为由提供商可信度决定。

### 7.3 令牌安全

- 访问令牌短期有效（默认 15 分钟），减少泄露影响。
- 刷新令牌长期有效（默认 7 天），但不可吊销（无状态）。如需吊销，后续可引入 Redis 黑名单（`future-enhancements.md` B9）。
- 令牌在响应中仅通过 HTTPS 传输（生产环境）。
- OAuth 回调如果是重定向到前端，令牌以 URI fragment 传递（不经过服务器日志）。

### 7.4 密码规则

- 最小长度 8 字符。
- 不能包含 email 地址。

### 7.5 端点保护

| 端点 | 保护 | 说明 |
|------|------|------|
| `POST /auth/register` | `GATEWAY_OPEN_REGISTRATION` 开关 | 关闭时返回 403，不暴露创建用户接口 |
| `POST /auth/users` | `X-Admin-Token` | 管理员创建用户，不受注册开关影响 |
| `POST /auth/jwt/login` | 无 | 公开，无限流（暴力破解/撞库防护不属于本规约范围） |
| `POST /auth/jwt/refresh` | 无 | 公开，但需要有效的刷新令牌 |
| `GET /auth/oauth/{provider}/authorize` | 无 | 公开，但需要有效的 OIDC 提供商配置 |
| `/users/me` | JWT | 仅已登录用户 |
| `/me/api-keys` | JWT | 仅已登录用户，作用域为自己 |
| 现有 `/auth/keys` | `X-Admin-Token` | 不变 |

## 8. 使用示例

### 8.1 用户注册 + 登录 + 管理 Key

```bash
# 注册（假设 OPEN_REGISTRATION=true）
curl -X POST http://localhost:8000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"secret123","display_name":"Alice"}'

# 登录
curl -X POST http://localhost:8000/auth/jwt/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"secret123"}'
# → { "access_token": "...", "refresh_token": "...", "token_type": "bearer" }

# 创建自己的 API Key
curl -X POST http://localhost:8000/me/api-keys \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"label":"my-dev-key"}'
# → { "key_id": "...", "api_key": "mru_...", "api_key_prefix": "mru_", "message": "..." }

# 使用 Key 提交任务
curl -X POST http://localhost:8000/tasks \
  -H "X-API-Key: mru_..." \
  -F "files=@doc.pdf"

# 列出自己的 Key
curl -X GET http://localhost:8000/me/api-keys \
  -H "Authorization: Bearer <access_token>"
# → { "keys": [...] }

# 刷新令牌
curl -X POST http://localhost:8000/auth/jwt/refresh \
  -H "Content-Type: application/json" \
  -d '{"refresh_token": "..."}'
# → { "access_token": "...", "token_type": "bearer" }
```

### 8.2 OAuth 登录（浏览器 SPA）

```bash
# 1. 浏览器访问（假设配置了 keycloak 提供商）
# GET http://localhost:8000/auth/oauth/keycloak/authorize
# → 302 → Keycloak 登录页面

# 2. 登录成功后回调
# GET http://localhost:8000/auth/oauth/keycloak/callback?code=...&state=...
# → 302 → {frontend_url}#access_token=...&refresh_token=...&token_type=bearer

# 3. 前端从 fragment 提取令牌，后续请求使用
# GET http://localhost:8000/users/me
# Authorization: Bearer <access_token>
```

### 8.3 管理员场景

```bash
# 管理员创建用户（注册关闭时）
curl -X POST http://localhost:8000/auth/users \
  -H "X-Admin-Token: <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{"email":"bob@example.com","password":"secret456","display_name":"Bob"}'

# 管理员创建 Key（无 owner）
curl -X POST http://localhost:8000/auth/keys \
  -H "X-Admin-Token: <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{"label":"service-account"}'
```

## 9. 测试要点

测试应覆盖以下场景（具体测试用例由测试实现者基于本规约编写）：

### 9.1 注册

- 注册成功 → 201 + `UserRead`。
- 重复 email 注册 → 400。
- 密码过短（<8 字符）→ 400。
- 密码包含 email → 400。
- `OPEN_REGISTRATION=false` 时注册 → 403。
- 管理员创建用户（`POST /auth/users`）不受 `OPEN_REGISTRATION` 影响 → 成功。
- 管理员创建用户时 `X-Admin-Token` 无效 → 401。

### 9.2 登录

- 正确 email + password → 200 + `{access_token, refresh_token, token_type}`。
- 错误 password → 401。
- 不存在的 email → 401。
- 返回的 `access_token` 是有效的 JWT，可调用 `/users/me`。
- 返回的 `refresh_token` 是有效的 JWT，可调用 `/auth/jwt/refresh`。

### 9.3 刷新令牌

- 有效 refresh_token → 200 + `{access_token, token_type}`。
- 新 access_token 可调用 `/users/me`。
- 过期 refresh_token → 401。
- 无效签名 refresh_token → 401。
- 使用 access_token 作为 refresh_token 调用 → 401（audience 不匹配）。

### 9.4 登出

- 有效 JWT → 200。
- 无 JWT 或无效 JWT → 401。
- 登出后 access_token 仍然有效（无状态）—— 此行为需文档说明。

### 9.5 用户信息

- `GET /users/me` 返回当前用户信息。
- `PATCH /users/me` 更新 `display_name` 成功。
- `PATCH /users/me` 更新 `password` 成功（后续可用新密码登录）。
- `PATCH /users/me` 不可更新 `email`。
- 无 JWT 或无效 JWT 访问 `/users/me` → 401。

### 9.6 API Key 自助服务

- `POST /me/api-keys` 创建 Key → 201 + `ApiKeyCreated`，`owner_id` 为当前用户 ID。
- `GET /me/api-keys` 列出自己的 Key，不包含其他用户的 Key。
- `DELETE /me/api-keys/{key_id}` 吊销自己的 Key → 204。
- `DELETE /me/api-keys/{key_id}` 吊销不属于自己的 Key → 404（不区分不存在和无权限）。
- 创建的 Key 可通过 `/tasks` 等业务端点使用（与现有 Key 行为一致）。
- 无 JWT 或无效 JWT 访问 `/me/api-keys` → 401。

### 9.7 OAuth

- 授权端点：`GET /auth/oauth/{provider}/authorize` → 302 + CSRF cookie。
- 授权端点：不存在的 provider → 404。
- 回调端点：state 不匹配 → 400。
- 回调端点：code 交换失败 → 400。
- 回调端点：首次登录 → 创建新 User + OAuthAccount → 返回令牌对。
- 回调端点：已有 OAuthAccount → 更新令牌 → 返回令牌对。
- 回调端点：email 已存在且 `email_verified=true` → 关联到已有 User（提供商确认邮箱所有权）。
- 回调端点：email 已存在且 `email_verified=false` → 409（提供商明确声明未验证邮箱）。
- 回调端点：email 已存在且 `email_verified` 缺失 → 400（保守安全，无法确认邮箱所有权）。
- OAuth 创建的用户，`display_name` 从 userinfo 的 `name` 声明填充（userinfo 模拟应返回 `name`、`preferred_username`、`given_name` 等字段以验证回退链）。
- OAuth 回调端点：userinfo 不返回 `name` 时，按优先级回退到 `preferred_username` → `given_name` → email 本地部分。
- OAuth 回调端点：`email_verified=true` 时新创建 User 的 `is_verified=true`；关联已有 User 时 `is_verified` 不升级。
- OAuth 回调返回的 `access_token` 可调用 `/users/me`。

### 9.8 总开关

- `GATEWAY_USER_AUTH_ENABLED=false` 时，所有 JWT/OAuth 路由不可访问（404）。
- `GATEWAY_USER_AUTH_ENABLED=false` 时，`/auth/keys` 等现有路由正常。
- `GATEWAY_USER_AUTH_ENABLED=true` 时，所有路由正常。

### 9.9 现有端点回归

- `POST /auth/keys`、`GET /auth/keys`、`DELETE /auth/keys/{id}` 行为不变。
- `POST /tasks`、`POST /file_parse` 等业务端点行为不变。
- 通过 `/me/api-keys` 创建的 Key 可用于业务端点。
