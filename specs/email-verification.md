# 邮箱验证 实现规约

> 基于 `specs/user-management-and-oauth.md`（用户管理与 OAuth 实现规约：`is_verified` 语义、OIDC `trusted_email_domains` 信任例外）、`src/mineru_gateway/models.py`（`User.is_verified` 字段已存在）、fastapi-users 内置验证机制（`UserManager.request_verify` / `UserManager.verify` / verify 路由器）与 fastapi-mail 库（SMTP 邮件发送）。

## 0. 目标与非目标

**目标**：在现有用户体系（email/password 注册 + OIDC 登录）之上增加**邮箱验证**功能：

1. 配置 SMTP 后，网关能通过邮件服务发送验证邮件（使用 fastapi-mail，不自行实现 SMTP 协议）。
2. **email/password 注册**（含管理员创建）的用户默认 `is_verified=false`，须验证邮箱后才能使用受保护功能。
3. **OIDC 登录**创建的用户，若提供商未返回 `email_verified` 声明或返回 `false`（且邮箱域名未命中该 provider 的 `trusted_email_domains`），同样为 `is_verified=false`，须验证邮箱后才能使用受保护功能。
4. 受保护功能：**仅** `POST /me/api-keys`（用户自助创建 API Key）。未验证邮箱的用户调用返回 403（由 `GATEWAY_ALLOW_UNVERIFIED_ACCOUNTS` 控制，定义见 `specs/user-management-and-oauth.md` §3.1）。
5. 验证流程复用 fastapi-users 内置验证机制（验证 token + 验证接口），邮件发送层使用 fastapi-mail 库。
6. OIDC 信任例外沿用 `trusted_email_domains`（已定义并实现，本规约不新增 provider 级配置，见 §4.4）：邮箱域名命中信任列表的用户在创建时即 `is_verified=true`，不受本规约的验证/拦截约束。
7. 验证邮件按 SPA 当前 i18n locale 从**按 locale 分文件的模板**渲染（主题 + 纯文本正文 + HTML 正文）；新增语言只需放入三份模板文件，无需改代码。

**非目标**：

- 重置密码 —— 依赖 SMTP 但不在本阶段范围。
- 修改邮箱 —— `email` 不可通过 `PATCH /users/me` 修改，验证 token 与邮箱绑定，不受影响。
- 管理员手动标记用户已验证 —— 不提供管理端点，`is_verified` 只能由验证流程置为 `true`。
- 邮件正文的可视化编辑、营销类邮件与发送重试/队列 —— 仅发送验证邮件，发送为 best-effort，失败仅记录日志。
- `POST /me/api-keys` 之外的任何端点拦截（任务提交、管理员端点等均不在此规约范围内）。

## 1. 功能开关与行为总览

邮箱验证由两个独立开关组合控制：`GATEWAY_SMTP_HOST`（邮件基础设施，决定验证路由与发信）与 `GATEWAY_ALLOW_UNVERIFIED_ACCOUNTS`（信任策略，决定是否拦截未验证账户）：

| `GATEWAY_SMTP_HOST` | `GATEWAY_ALLOW_UNVERIFIED_ACCOUNTS` | 验证路由 | 发送验证邮件 | 拦截 `POST /me/api-keys`（403） |
|--------------------|-------------------------------------|----------|-------------|------------------------------|
| 未配置（`null`） | `true` | 不注册（404） | 否 | 否 |
| 未配置（`null`） | `false`（默认） | — | — | **拒绝启动**（§3.1） |
| 已配置 | `true` | 注册 | 是 | 否 |
| 已配置 | `false`（默认） | 注册 | 是 | 是 |

> 本表仅在 `GATEWAY_USER_AUTH_ENABLED=true` 时适用（`false` 时验证路由与 `POST /me/api-keys` 均不存在，§6.1）。

- `GATEWAY_SMTP_HOST` 未配置时，验证相关路由**不注册**（访问返回 404，与 `GATEWAY_USER_AUTH_ENABLED=false` 的既有模式一致）。
- `allow_unverified_accounts=false` 且 SMTP 未配置时验证路径不可用，未验证用户将永久无法使用受保护功能——该配置组合在启动时被拒绝（§3.1），杜绝此状态。
- `is_verified` 为**单向**状态：只能由 `false` → `true`，任何路径都不将其降级回 `false`（与 `specs/user-management-and-oauth.md` §7.2 信任决策固化一致）。其全部取值来源见 §2 表格。

## 2. 数据模型

`User.is_verified`（Boolean，`SQLAlchemyBaseUserTable` 提供，已在 `alembic/versions/e795202aca0b_add_users_and_oauth.py` 迁移中创建）承担全部验证状态，且已通过 `UserRead` 暴露给客户端。

`is_verified` 的取值来源：

| 创建/变更途径 | `is_verified` 初始值 | 说明 |
|--------------|----------------------|------|
| `POST /auth/register`（开放注册） | `false` | 请求体中的 `is_verified` 字段被忽略，恒为 `false` |
| `POST /auth/users`（管理员创建） | `false` | 同上，恒为 `false` |
| OIDC 回调创建新用户 | 按 §0 目标 3 规则 | `email_verified` 声明 + `trusted_email_domains` 例外 |
| `POST /auth/verify` / `GET /auth/verify` | `false` → `true` | 验证 token 有效时置 `true`，单向 |

## 3. 配置项

环境变量前缀 `GATEWAY_`，通过 `pydantic-settings` 加载。

### 3.1 新增配置

| 环境变量 | 默认值 | 必需 | 说明 |
|---------|--------|------|------|
| `GATEWAY_SMTP_HOST` | `null` | 否 | SMTP 服务器主机名。**未配置 = 邮箱验证功能关闭**：验证路由不注册（404）、不拦截（见 §1） |
| `GATEWAY_SMTP_PORT` | `587` | 否 | SMTP 服务器端口 |
| `GATEWAY_SMTP_USERNAME` | `null` | 否 | SMTP 认证用户名（多数服务商即发件邮箱）。**未配置时连接不执行 SMTP 认证**，适用于无需认证的本地/中继 SMTP 服务 |
| `GATEWAY_SMTP_PASSWORD` | `null` | 否 | SMTP 认证密码 |
| `GATEWAY_SMTP_FROM` | `null` | 否 | 发件人邮箱。未配置时回退为 `GATEWAY_SMTP_USERNAME`；两者皆无的配置被启动校验拒绝（见下方校验规则） |
| `GATEWAY_SMTP_FROM_NAME` | `"mineru-gateway"` | 否 | 发件人显示名称 |
| `GATEWAY_SMTP_STARTTLS` | `true` | 否 | 是否使用 STARTTLS 升级加密连接 |
| `GATEWAY_SMTP_SSL_TLS` | `false` | 否 | 是否使用 SSL/TLS 直连加密连接 |
| `GATEWAY_SMTP_TIMEOUT` | `10` | 否 | SMTP 连接与发送超时（秒） |
| `GATEWAY_VERIFY_EMAIL_TOKEN_LIFETIME_SECONDS` | `3600` | 否 | 验证 token 有效期（秒，默认 1 小时） |
| `GATEWAY_VERIFY_EMAIL_BASE_URL` | `""` | 否 | 验证邮件中链接的基础 URL。未配置时回退为 `GATEWAY_URL` 的值 |

**校验规则**（违反则 Gateway 拒绝启动）：

- `GATEWAY_SMTP_STARTTLS` 与 `GATEWAY_SMTP_SSL_TLS` 不能同时为 `true`（两者互斥，必须选择其一或都不启用）。
- `GATEWAY_SMTP_FROM` 若配置，必须是合法邮箱地址。
- `GATEWAY_SMTP_HOST` 已配置但发件地址不可确定（`GATEWAY_SMTP_FROM` 与 `GATEWAY_SMTP_USERNAME` 均未配置）→ 拒绝启动，提示配置 `GATEWAY_SMTP_FROM` 或 `GATEWAY_SMTP_USERNAME`（否则验证邮件将静默无法发送，未验证用户将永久无法使用受保护功能）。该校验与 `GATEWAY_USER_AUTH_ENABLED` 无关，只要 `GATEWAY_SMTP_HOST` 已配置即生效。
- `GATEWAY_USER_AUTH_ENABLED=true` 且 `GATEWAY_ALLOW_UNVERIFIED_ACCOUNTS=false`（默认，定义见 `specs/user-management-and-oauth.md` §3.1）且 `GATEWAY_SMTP_HOST` 未配置 → 拒绝启动，提示配置 SMTP 或设置 `GATEWAY_ALLOW_UNVERIFIED_ACCOUNTS=true`（否则未验证用户无验证路径，将永久无法使用受保护功能）。

> **升级影响**：`GATEWAY_ALLOW_UNVERIFIED_ACCOUNTS=false` 是默认值。既有部署若已开启用户认证（`user_auth_enabled=true`）但未配置 `GATEWAY_SMTP_HOST`，升级后启动校验将拒绝启动——须在升级时配置 SMTP 或显式设置 `GATEWAY_ALLOW_UNVERIFIED_ACCOUNTS=true`。已配置 `GATEWAY_SMTP_HOST` 但未配置任何发件地址（`GATEWAY_SMTP_FROM`、`GATEWAY_SMTP_USERNAME` 均无）的部署同样会被拒绝——须补配其一。

**新增依赖**：`pyproject.toml` 增加 [`fastapi-mail>=1.6.5`](https://pypi.org/project/fastapi-mail/)（异步 SMTP 发送）与 [`jinja2`](https://pypi.org/project/Jinja2/)（邮件模板渲染）。

### 3.2 现有配置新增含义

| 现有配置 | 新增含义 |
|---------|---------|
| `GATEWAY_URL` | 未配置 `GATEWAY_VERIFY_EMAIL_BASE_URL` 时，以此构造验证链接 |
| `GATEWAY_OAUTH_FRONTEND_REDIRECT_URL` | 已配置时，`GET /auth/verify` 验证成功后 302 重定向到该 URL（§4.3） |
| `GATEWAY_JWT_SECRET` | 验证 token 的签名密钥 |

## 4. API 规范

> `POST /auth/request-verify-token` 与 `POST /auth/verify` 由 fastapi-users 内置 verify 路由器提供，请求/响应格式、状态码与错误语义以 fastapi-users 文档为准：[Verify router](https://fastapi-users.github.io/fastapi-users/latest/usage/routes/#verify-router)。这些端点与 `GET /auth/verify` 仅在 `GATEWAY_SMTP_HOST` 已配置时注册（未配置 → 404，见 §1）。本节仅列各端点的差异化点。

### 4.1 申请验证邮件（`POST /auth/request-verify-token`）

- 未验证用户的**补发**验证邮件自助途径（注册成功时的自动发送见 §4.4）。
- 恒 202、防邮箱枚举、用户存在/激活/未验证才触发发送等行为由 fastapi-users 提供（见本节开头文档参考）。
- 发件地址可确定（`GATEWAY_SMTP_FROM` 或 `GATEWAY_SMTP_USERNAME` 任一存在）由 §3.1 启动校验保证——不可确定的配置无法启动，运行时不存在静默不发送的状态（发送函数保留防御性跳过，见 §5.2）。

### 4.2 提交验证 token（`POST /auth/verify`）

- 请求/响应格式、200/400 状态码、token 与用户邮箱绑定等行为由 fastapi-users 提供（见本节开头文档参考）。
- 验证 token 的有效期由 `GATEWAY_VERIFY_EMAIL_TOKEN_LIFETIME_SECONDS` 控制（默认 1 小时），配置方式见 §5.3。
- 可观察结果：token 校验通过后用户 `is_verified` 置 `true` 并持久化（其余行为见文档参考）。

### 4.3 邮件链接验证（`GET /auth/verify?token=`）

- 本规约新增端点，验证语义与 §4.2（fastapi-users verify 流程）一致，但**已验证用户幂等成功**（与 §4.2 的差异点）：邮件客户端/企业网关会预取链接并消费单次 token，真实用户的后续点击触发 fastapi-users 的 `UserAlreadyVerified`，此时目标状态（`is_verified=true`）已达成，按成功处理而非失败。
- `GATEWAY_OAUTH_FRONTEND_REDIRECT_URL` **未配置** → 验证成功（含已验证幂等）200 + 验证后的用户信息（`UserRead`）；失败（token 无效/过期/不匹配）→ 400。
- `GATEWAY_OAUTH_FRONTEND_REDIRECT_URL` **已配置** → 验证成功（含已验证幂等）302 重定向到 `{oauth_frontend_redirect_url}#verified=true`；失败 → 302 重定向到 `{oauth_frontend_redirect_url}#verified=false`。状态以 fragment 追加，与 OAuth 回调的 fragment 传递惯例一致（`specs/user-management-and-oauth.md` §4.5），不依赖目标 URL 是否已含查询串。

### 4.4 验证邮件内容与发送时机

- 邮件内容：主题、纯文本正文与 HTML 正文从**按 locale 分文件的 Jinja2 模板**渲染，位于 `email/templates/`，命名 `verify_email.{locale}.subject.txt` / `.txt` / `.html`；正文包含验证链接 `{verify_email_base_url or gateway_url}/auth/verify?token={token}` 与有效期文案。新增语言 = 放入三份模板文件，无需改代码。
- **locale 解析**：SPA 将当前 i18n locale 作为 `locale` 查询参数传给 `POST /auth/register` 与 `POST /auth/request-verify-token`；网关将该值与实际存在的模板 locale 比较（先精确匹配 tag、再匹配基础语言，如 `zh-TW` → `zh-CN`），缺失或无法识别时回退 `en`。locale 值只与已发现的模板名比较、不拼接进路径；无法匹配任何模板的值回退 `en`。
- **管理员创建不传 locale**：`POST /auth/users` 的请求方 locale 与收件人无关，该邮件固定走 `en` 回退。
- 发送时机：`POST /auth/register` 与 `POST /auth/users` 成功后（SMTP 已配置时）自动发送；`POST /auth/request-verify-token` 满足 §4.1 条件时发送；**OIDC 回调创建用户不自动发送**。自动发送的发件地址可确定性由 §4.1/§3.1 启动校验保证。
- 发送失败（网络错误、认证失败、超时等）仅记录日志，不影响主流程（注册仍 201、申请仍 202）；用户可经 `POST /auth/request-verify-token` 补发。
- **OIDC 用户验证途径**：`is_verified=false` 的 OIDC 用户可经 `POST /auth/request-verify-token` 自助申请验证邮件并完成验证（OIDC 创建不自动发送，见上方发送时机）。

### 4.5 受保护功能：自助创建 API Key（`POST /me/api-keys`）

- 验证拦截行为（403 条件与信任模式）定义见 `specs/user-management-and-oauth.md` §3.1/§4.4（已实现），本节不重复。
- 本规约相关点：拦截与 SMTP 是否配置无关（开关组合矩阵见 §1）；`GET/DELETE /me/api-keys`、`/users/me`、登录/刷新、管理员端点与任务提交均不受影响（已有 Key 继续可用，不追溯吊销）。

## 5. 核心模块设计

> 本节为**实现参考**，描述包结构与可测试接口。实现者可以自由选择内部实现细节，但必须暴露本节列出的接口。测试基于本节定义的接口编写 stub，不依赖内部实现。

### 5.1 包结构

```
src/mineru_gateway/
├── email/
│   ├── __init__.py
│   ├── service.py            # 邮件发送服务
│   └── templates/            # verify_email.{locale}.{subject.txt,txt,html}（按 locale 分文件）
└── auth/
    ├── manager.py            # [修改] UserManager 验证 token 配置 + on_after_request_verify / on_after_verify
    ├── jwt_routes.py         # [修改] register / admin_create_user 成功后自动发送验证邮件
    └── verify_routes.py      # [新增] GET /auth/verify（邮件链接验证，§4.3）
```

### 5.2 可测试接口

#### `email/service.py` — 邮件发送

| 接口 | 输入 | 输出 | 行为 |
|------|------|------|------|
| `send_verification_email(user_email, token, settings, *, locale=None)` | `user_email: str, token: str, settings: Settings, locale: str \| None` | `None` | 解析 locale → 渲染模板 → 构造验证链接 `{verify_email_base_url or gateway_url}/auth/verify?token={token}`，通过已配置的 SMTP 服务以 multipart/alternative（HTML 正文 + 纯文本回退）发送到 `user_email`。`smtp_host` 未配置或发件地址不可确定时直接返回（不发送）——防御性行为，正常配置下不可达（§3.1 启动校验）；发送失败记录日志不抛出 |
| `resolve_locale(locale=None)` | `locale: str \| None` | `str`（`available_locales()` 之一） | 先精确（大小写不敏感）匹配 tag，再匹配基础语言；`None`/空/无法识别回退 `en` |
| `render_verification_email(locale, *, verify_url, lifetime_seconds)` | `locale: str, verify_url: str, lifetime_seconds: int` | `tuple[str, str, str]`（主题、纯文本正文、HTML 正文） | 按 locale 渲染模板；无对应模板时抛 `jinja2.TemplateNotFound`，调用方按发送失败处理 |
| `available_locales()` | — | `tuple[str, ...]` | 实际带完整模板集的 locale（排序，保证确定性） |

测试通过**替换 `send_verification_email`** 捕获验证 token、收件人与 `locale`，不连接真实 SMTP 服务器（遵循 `AGENTS.md` "Tests must not hit the network"）。

#### `auth/manager.py` — UserManager

验证核心逻辑（token 签发与校验、`is_verified` 置位）由 fastapi-users 提供，本规约仅要求：

| 接口 | 输入 | 输出 | 行为 |
|------|------|------|------|
| `UserManager.on_after_request_verify(user, token, request)` | `user: User, token: str, request: Request \| None` | `None` | 调用 `send_verification_email(user.email, token, settings, locale=request.query_params.get("locale") if request else None)`；发送异常仅记录日志、不抛出（§4.4，保证注册/申请端点结果不受影响） |
| `UserManager.on_after_verify(user, request)` | `user: User, request: Request \| None` | `None` | 打印结构化日志 `User {id} verified` |

### 5.3 修改文件

| 文件 | 修改内容 |
|------|---------|
| `pyproject.toml` | 增加 `fastapi-mail>=1.6.5`、`jinja2` |
| `config.py` | 增加 §3.1 全部配置项及校验规则 |
| `auth/manager.py` | `UserManager.__init__` 中按 settings 覆盖 fastapi-users 类属性：`verification_token_secret`（= `jwt_secret`）、`verification_token_lifetime_seconds`（= `settings.verify_email_token_lifetime_seconds`，对应 `GATEWAY_VERIFY_EMAIL_TOKEN_LIFETIME_SECONDS`）；重写 `on_after_request_verify`、`on_after_verify` |
| `auth/jwt_routes.py` | 注册成功与管理员创建用户成功后，SMTP 已配置时触发 `request_verify` 自动发信（§4.4） |
| `auth/verify_routes.py`（新增） | `GET /auth/verify?token=` 端点（§4.3） |
| `main.py` | `GATEWAY_USER_AUTH_ENABLED=true` 且 `GATEWAY_SMTP_HOST` 已配置时注册 fastapi-users 内置 verify 路由器（`/auth/request-verify-token`、`/auth/verify`）与 `verify_routes` |
| `email/templates/verify_email.{locale}.{subject.txt,txt,html}`（新增） | 各 locale 的主题、纯文本正文、HTML 正文模板（§4.4） |
| `frontend/src/api/functions/auth.ts` | `register` / `requestVerifyToken` 请求附带 `locale` 查询参数（§4.4） |


## 6. 集成要点

### 6.1 与用户认证总开关的关系

`GATEWAY_USER_AUTH_ENABLED=false` 时：不注册任何验证相关路由（`POST /auth/request-verify-token`、`POST /auth/verify`、`GET /auth/verify` 均不可访问），`POST /me/api-keys` 也不存在，本规约整体不生效。

`GATEWAY_USER_AUTH_ENABLED=true` 时：验证路由注册、发信与拦截行为按 §1 开关矩阵执行（`GATEWAY_SMTP_HOST` 决定路由注册与发信，`GATEWAY_ALLOW_UNVERIFIED_ACCOUNTS` 决定拦截）。

### 6.2 与现有 API Key 鉴权的关系

- 拦截仅作用于 `POST /me/api-keys` 这一创建入口。
- 未验证用户已持有的 Key（例如 SMTP 功能启用前创建的）继续有效，可正常提交任务；启用验证功能不会追溯吊销既有 Key。
- 管理员创建的 Key（`owner_id=NULL`）完全不受影响。

## 7. 安全考量

- **防邮箱枚举**：由 fastapi-users 恒 202 行为保证（见 §4 开头文档参考），本规约不额外引入可区分的错误响应。
- **验证 token 安全**：验证 token 由 fastapi-users 验证流程签发，与用户及其邮箱绑定，无法冒用其他用户的 token；有效期默认 1 小时（`GATEWAY_VERIFY_EMAIL_TOKEN_LIFETIME_SECONDS`）。
- **SMTP 安全**：凭据仅通过环境变量注入（`GATEWAY_SMTP_PASSWORD`），不得写入日志、响应或数据库；默认启用 STARTTLS（`GATEWAY_SMTP_STARTTLS=true`），支持 SSL/TLS 直连模式，两种加密模式互斥校验，防止误配置明文发送。
- **不破坏主流程**：邮件发送失败不影响注册/创建/申请端点结果（§4.4）。
- **防止永久锁死**：无验证路径（SMTP 未配置）且拦截开启的配置组合被启动校验拒绝（§3.1），从根源杜绝死锁状态；SMTP 已配置但发件地址不可确定的组合同样被拒绝（§3.1），杜绝验证邮件静默无法送达导致的同样死锁。

## 8. 测试要点

测试应覆盖以下场景。邮件发送必须被 stub（替换 `send_verification_email`），不连接真实 SMTP；fastapi-users 库行为（202 矩阵、token 校验 400 等）不在本规约测试范围，以 §4 开头文档参考为准；fastapi-mail 与 Jinja2 的内部行为（`MessageSchema` 字段、multipart 组装、模板引擎语义）同样不测——只测我们自己的 locale 解析、模板渲染结果与 locale 透传。

### 8.1 配置校验

- `GATEWAY_SMTP_HOST` 默认未配置（`null`）。
- `GATEWAY_SMTP_STARTTLS=true` 且 `GATEWAY_SMTP_SSL_TLS=true` → 校验失败，拒绝启动。
- `GATEWAY_SMTP_FROM` 为非法邮箱 → 校验失败，拒绝启动。
- `GATEWAY_SMTP_HOST` 已配置但 `GATEWAY_SMTP_FROM`、`GATEWAY_SMTP_USERNAME` 均未配置 → 校验失败，拒绝启动。
- 各新增配置项默认值符合 §3.1 表格。

### 8.2 注册与创建（`is_verified` 语义不变 + 自动发送）

- 注册与管理员创建成功 → 201，`is_verified=false`（既有行为回归）。
- SMTP 已配置时注册/管理员创建 → 自动发送验证邮件（stub 捕获收件人 = 注册邮箱，token 可用于验证）；SMTP 未配置 → 不发送，仍 201。
- SMTP 已配置但发送失败（stub 抛错）→ 注册/管理员创建仍 201（§4.4，失败仅记日志）。
- 注册携带 `?locale=` → stub 捕获的 `locale` 与查询参数一致；无参数 → `None`（回退由发送层完成）；无法识别的 tag → 原样转发，注册仍 201。
- OIDC 回调创建用户 → **不**触发验证邮件发送（无论邮箱是否真实、是否未验证）。

### 8.3 `POST /auth/request-verify-token`

- 未验证用户 + SMTP 已配置 → 发送验证邮件（stub 捕获收件人 = 请求邮箱与 token；token 可用性经 §8.7 端到端流程验证）。
- 发送失败（stub 抛错）→ 申请结果不受影响（仍 202，§4.4）。
- 携带 `?locale=` 的补发请求 → stub 捕获的 `locale` 与查询参数一致。
- SMTP 未配置 → 404（路由不注册，见 §1 矩阵）。

### 8.4 `POST /auth/verify`

fastapi-users 提供的库接口，其 200/400 语义不单独测试；验证可用性（`is_verified=true`）与持久化经 §8.7 端到端流程覆盖。

### 8.5 `GET /auth/verify?token=`

- 有效 token、未配置 `GATEWAY_OAUTH_FRONTEND_REDIRECT_URL` → 200 + `UserRead`（`is_verified=true`）。
- 有效 token、已配置 `GATEWAY_OAUTH_FRONTEND_REDIRECT_URL` → 302，Location 为 `{oauth_frontend_redirect_url}#verified=true`。
- 已验证用户重复访问（token 仍有效，幂等成功）：未配置 `GATEWAY_OAUTH_FRONTEND_REDIRECT_URL` → 200 + `UserRead`（`is_verified=true`）；已配置 → 302，Location 为 `{oauth_frontend_redirect_url}#verified=true`。
- 无效/过期 token：未配置 `GATEWAY_OAUTH_FRONTEND_REDIRECT_URL` → 400；已配置 → 302，Location 为 `{oauth_frontend_redirect_url}#verified=false`。

### 8.6 拦截 `POST /me/api-keys`

- 未验证用户 + `allow_unverified_accounts=false`（默认）→ 403，不创建 Key。行为定义与实现见 `specs/user-management-and-oauth.md` §4.4（已实现，测试在 `tests/user/test_api_keys.py`）；本规约相关点：拦截与 SMTP 是否配置无关（开关组合矩阵见 §1）。门控测试夹具须配置 SMTP 以满足 §3.1 启动校验（如 `tests/user/test_api_keys.py` 的 gated fixtures 基于 `smtp_settings`）。
- 其余端点（`GET/DELETE /me/api-keys`、`/users/me`、登录、刷新）不受验证状态影响。

### 8.7 端到端流程

- 注册（SMTP 已配置）→ 自动捕获验证 token → `POST /auth/verify` → `GET /users/me` 仍为 `is_verified=true`（§8.4 持久化）→ `POST /me/api-keys` 成功。
- 注册 → 未验证 → `POST /me/api-keys` 403 → `POST /auth/request-verify-token` 补发 → 验证 → 成功。
- OIDC 回调（`email_verified=false`，域名未命中信任列表）→ 新用户 `is_verified=false` → `POST /me/api-keys` 403 → 通过 `request-verify-token` 验证 → 201。

### 8.8 总开关与路由注册

- `GATEWAY_USER_AUTH_ENABLED=false` → `/auth/request-verify-token`、`/auth/verify` 均 404。
- `GATEWAY_USER_AUTH_ENABLED=true` + SMTP 未配置 + `allow_unverified_accounts=true` → 三个验证端点均 404（路由不注册），`POST /me/api-keys` 不拦截。
- `GATEWAY_USER_AUTH_ENABLED=true` + SMTP 未配置 + `allow_unverified_accounts=false`（默认）→ 拒绝启动（配置校验）。

### 8.9 模板渲染与 locale 解析（`email/service.py`）

- `resolve_locale`：精确 tag（大小写不敏感）→ 该 locale；基础语言（`zh-TW`、`zh`）→ `zh-CN`；`None` / 空 / 未知 / 非法值（如 `../`）→ `en`。
- `render_verification_email`：`en` 与 `zh-CN` 各自渲染出对应主题、HTML `<a>` 链接与纯文本链接；有效期不足一小时时正文以分钟表述。
- `available_locales` 至少包含 `en`、`zh-CN`。
