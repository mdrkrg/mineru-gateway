# 约定

## 适用范围

本目录（`frontend/specs/core/`）定义前端基础设施层的行为契约，仅包含三件套：

| 文件 | 主题 |
|------|------|
| `conventions.md` | 本文件：库边界、类型词汇表、命名转换契约、后端不变量前提 |
| `error-model.md` | `ApiError` 判别联合、`HttpError`、类型守卫、`InferHttpErrors` |
| `http-client.md` | 统一原始响应契约、可组合解析器、AbortSignal、ky 实例 hook 点 |
| `validation.md` | `validate` / `validateSuccess` / `validateFailure` 桥接与组合契约 |

**不在本目录范围内**（后续 spec 处理）：

- 认证流程（JWT 登录/刷新/登出、OAuth 授权/回调、token 存储策略、401→refresh→retry 的具体实现）
- 各 API 端点契约（`/auth/*`、`/users/*`、`/me/api-keys`、`/auth/keys`、`/tasks/*`、`/file_parse`、`/health`）
- 全部 arktype schema 定义
- UI 页面与 store 行为

本目录的契约**必须**为上述后续工作提供可组合的基础；具体而言，后续 spec 将基于此处定义的 `ApiError<E>`、原始响应类型、解析器组合、`validateFailure`/`validateSuccess` 构建端点级契约。

## 库边界

前端 HTTP/校验/错误基础设施仅允许使用以下库。spec 中所有类型签名以这些库导出的接口为词汇。

| 库 | 用途 | spec 中引用的导出 |
|----|------|-------------------|
| `ky` | HTTP 客户端 | `ky`（默认导出，调用形式 `ky(url, options)`）、`HTTPError`、`NetworkError`、`TimeoutError`、`isHTTPError`、`isNetworkError`、`isTimeoutError`、`Options`（`Parameters<typeof ky>[1]`）、`KyResponse` |
| `neverthrow` | Result 类型 | `Result<T, E>`、`ResultAsync<T, E>`、`ok`、`err`、`ResultAsync` 构造器 |
| `arktype` | 运行时 schema + 类型推导 | `type`（构造器，`type({...})` 返回 `Type`）、`Type`（schema 实例类型）、`Type['infer']`（推导出的输出 TS 类型）、`Type['inferIn']`（推导出的输入 TS 类型）、`ArkErrors`（校验错误类 named export，等价于 `type.errors` 属性；在 TS 类型位置使用 `ArkErrors`，在运行时 `instanceof ArkErrors` 检查）、`.pipe()`（morph 链接）、`.as<>()`（编译期类型转换）、`.in` / `.out`（输入/输出 Type 提取） |
| `change-case` | 对象键命名转换 | `camelCase`、`snakeCase`（均来自 `change-case/keys`，深度递归转换对象所有键） |

## 类型词汇表

### `Result<T, E>` / `ResultAsync<T, E>`（neverthrow）

- `Result<T, E>`：同步结果。`ok(value: T)` 或 `err(error: E)`。
- `ResultAsync<T, E>`：异步结果，等价于 `Promise<Result<T, E>>` 但支持 `map` / `mapErr` / `andThen` / `orElse` / `orTee` / `andTee` 等组合子。
- `orTee`：**仅在错误分支**执行（回调接收 `E` 类型值），返回 `void`，不改变原 Result 值。
- `andTee`：**仅在成功分支**执行（回调接收 `T` 类型值），返回 `void`，不改变原 Result 值。
- 本 spec 中所有 HTTP 请求与校验组合的返回值都是 `ResultAsync<T, E>` 或 `Result<T, E>`，**不**使用 `Promise` + `throw`。

### arktype `Type` 与 `ArkErrors`

- `type({...})` 或 `type('...')` 构造一个 schema，其类型为 `Type`。
- `Type['infer']`：从 schema 实例推导**输出** TS 类型（经 morph 变换后的类型）。若 schema 无 morph，`Type['infer']` 等于输入类型。
- `Type['inferIn']`：从 schema 实例推导**输入** TS 类型（morph 变换前的类型）。若 schema 无 morph，`Type['inferIn']` 等于输出类型。
- `schema(data)`：运行时校验。返回值要么是校验通过的数据（类型为 `Type['infer']`），要么是 `ArkErrors` 实例（校验失败）。若 schema 含 morph，校验通过时返回的数据是 morph 变换后的值。
- `ArkErrors`：arktype 的 named export，等价于 `type.errors` 属性（`type.errors === ArkErrors`）。既是类也是值类型；在 TS 类型位置使用 `ArkErrors`（不可用 `type.errors`，因 `type` 是 TS 关键字）；在运行时用 `instanceof ArkErrors` 检查。其实例有 `.summary`（人类可读错误摘要字符串）属性。
- `.pipe(morphFn)`：将 schema 输出通过 morph 函数变换，产生新的 morphing Type。morphing Type 的 `inferIn` ≠ `infer`。

### ky `Options`

- `Parameters<typeof ky>[1]`：ky 调用的第二参数类型。包含 `method`、`headers`、`json`、`searchParams`、`prefix`、`baseUrl`、`signal`、`hooks`、`retry`、`timeout`、`throwHttpErrors` 等。
- 本 spec 中所有请求契约的 options 形参类型均为 `Options` 或其子集。

## 命名转换契约

### 后端命名事实

本仓库后端（`src/mineru_gateway/`）所有响应字段使用 **snake_case**。全仓 grep 不到 `alias_generator` / `to_camel` / `populate_by_name` 等 Pydantic 别名配置。证据：

- `src/mineru_gateway/schemas.py`：`key_id`、`api_key_prefix`、`created_at`、`last_used_at`、`expires_at`、`is_active`、`task_id`、`status_url`、`result_url`、`file_names` — 全是 snake_case。
- `src/mineru_gateway/tasks/schemas.py`：`task_id`、`file_names`、`created_at`、`started_at`、`completed_at`、`retry_count`、`queued_ahead`、`page_size`、`file_count`、`today_completed`、`today_failed`、`total_bytes`、`avg_duration_ms`、`non_downloadable`、`cancelled_count`、`cancelled_ids`、`current_status` — 全是 snake_case。
- `src/mineru_gateway/proxy/handler.py` 的 `handle_task_submission` 构造的 `JSONResponse` content 键名也是 snake_case。

### 双向映射策略

前端领域类型使用 **camelCase**（TS 惯例）。通过 arktype 的 morph 机制实现 wire format（snake_case）↔ domain type（camelCase）的双向映射：

**响应 schema**（入站：snake_case → camelCase）：

```ts
import { camelCase } from 'change-case/keys'

// inferIn = { task_id: string, file_names: string[] }   (wire format)
// infer    = unknown (camelCase returns unknown; use as<>() for precise type)
const TaskSchema = type({
  task_id: 'string',
  file_names: 'string[]',
}).pipe(camelCase).as<{
  taskId: string
  fileNames: string[]
}>()
```

`camelCase` 来自 `change-case/keys`，返回值类型为 `unknown`（运行时正确转换，但编译期无法推导具体键名）。因此通过 `.as<>()` 声明输出类型。`.as<>()` 是纯编译期标记，不产生运行时开销。

**请求 schema**（出站：camelCase → snake_case）：

```ts
import { snakeCase } from 'change-case/keys'

// inferIn = { taskIds: string[] }                        (domain type)
// infer    = unknown (use as<>() for precise type)
const ResultZipRequestSchema = type({
  taskIds: 'string[]',
}).pipe(snakeCase).as<{
  task_ids: string[]
}>()
```

### 命名转换不变量（可测试断言）

1. 所有响应 schema（成功 + 错误）**必须**以 `.pipe(camelCase)` 结尾，实现运行时 snake_case → camelCase 键名转换。
2. 所有请求 body schema **必须**以 `.pipe(snakeCase)` 结尾，实现运行时 camelCase → snake_case 键名转换。
3. `camelCase` / `snakeCase`（来自 `change-case/keys`）返回值类型为 `unknown`，因此 `Type['infer']` 在无 `.as<>()` 时是 `unknown`。每个 schema **必须**通过 `.as<{...}>()` 声明精确的输出类型。
4. `validate(schema, data)` 调用 `schema(data)`，自动应用 morph。调用方传入 snake_case 数据，得到 camelCase 结果（响应）；或传入 camelCase 数据，得到 snake_case 结果（请求）。
5. `parseJson` **不**做键名转换——它返回 `unknown`（原始 snake_case JSON.parsed 值）。转换由 schema morph 在 `validateSuccess` / `validateFailure` 内部完成。
6. `parseBlob` / `parseArrayBuffer` / `passthrough` **不**做键名转换（二进制响应无 JSON 键）。
7. `InferHttpErrors<F, FB>` 中的 `F[K]['infer']` 取的是 morph 后的输出类型——若 schema 用了 `.as<>()`，为 `.as` 声明的类型；否则为 `unknown`。因此 `HttpError<Status, Data>` 的 `Data` 精度取决于 schema 是否用 `.as<>()`。
8. `UnhandledStatusError.data` 是**原始未转换**的 `unknown`（因为无 schema 匹配，不经过 morph），可能是 snake_case。消费者须知晓此差异。

## 后端不变量前提

以下事实来自本仓库后端代码（`src/mineru_gateway/`），spec 契约**不得偏离**。若后端行为与下列前提矛盾，本 spec 失效，需先修订 spec。

### 前提 1：三种独立认证 header 并存

后端依赖（`auth/dependencies.py`）识别三种 header，互不替代：

| Header | 用途 | 出现位置 |
|--------|------|----------|
| `X-API-Key` | 调用 `/tasks`、`/file_parse`、任务 CRUD；`allow_anonymous=true` 时可缺省 | `X_API_KEY` 常量 + `require_api_key` 依赖；`proxy/routes.py` 的 `submit_task` / `parse_file` 路由；`tasks/routes.py` 各路由 |
| `X-Admin-Token` | 调用 `/auth/keys` 全量管理、`/auth/users` 管理员建用户 | `X_ADMIN_TOKEN` 常量 + `require_admin_token` 依赖 |
| `Authorization: Bearer <jwt>` | 调用 `/users/me`、`/me/api-keys`；仅 `user_auth_enabled=true` 时存在 | `current_active_user` 依赖 |

**写入 spec 的约束**：HTTP 客户端层**必须**允许在请求时注入上述任一 header，但**不**在本 spec 定义注入策略（由后续 auth-flow spec 定义）。本 spec 只声明"该注入点存在"。

### 前提 2：二进制响应端点存在

以下端点返回非 JSON 响应，HTTP 客户端层**必须**支持二进制/原始响应路径，否则与仓库不符：

| 端点 | 响应 | 证据 |
|------|------|------|
| `GET /tasks/{task_id}/result` | 透传上游任意 `Content-Type`/`Content-Disposition`，body 为二进制 | `tasks/routes.py` 的 `get_task_result` 路由 |
| `POST /tasks/result-zip` | 成功返回 `application/zip` + `Content-Disposition: attachment; filename="results.zip"`；409 返回 JSON `{detail, non_downloadable}` | `tasks/routes.py` 的 `result_zip` 路由 |
| `POST /file_parse` | 透传上游任意响应（成功/失败均透传） | `proxy/handler.py` 的 `handle_file_parse` |

### 前提 3：refresh 端点不轮换

`POST /auth/jwt/refresh` 返回 `{access_token, token_type}`，**不**含新 `refresh_token`（见 `auth/jwt_routes.py` 的 `refresh` 路由 + `auth/backend.py` 的 `verify_refresh_token`）。

**写入 spec 的约束**：任何 401→refresh→retry 机制必须据此设计——刷新后只更新 `access_token`，`refresh_token` 保持不变；不得假设刷新响应会返回新 `refresh_token`。

### 前提 4：错误响应 shape 不统一

后端不同端点、不同状态码的错误 body 形状不同，**不得**假设统一"错误 schema"：

| 来源 | shape | 证据 |
|------|-------|------|
| FastAPI 默认 422 校验错误 | `{ detail: [{ type, loc, msg, input?, url? }] }` | FastAPI 行为 |
| 业务错误（多数端点） | `{ detail: string }` | 各 route 的 `HTTPException(detail="...")` |
| `/tasks/result-zip` 409 | `{ detail: string, non_downloadable: [{ task_id, status, reason }] }` | `tasks/routes.py` 的 `result_zip` 路由 409 分支 |

**写入 spec 的约束**：`validateFailure` 必须逐状态码声明不同 schema，不得引入全局共享错误 schema。

### 前提 5：提交端点附带响应头（仅认证路径）

`POST /tasks` 成功响应（202）在**认证路径**下附带以下响应头，HTTP 客户端层**必须**让其可达：

- `X-MinerU-Task-Id`
- `X-MinerU-Task-Status`
- `X-MinerU-Task-Status-Url`
- `X-MinerU-Task-Result-Url`
- （幂等重放时多一个）`X-Idempotency-Key-Replayed: true`

证据：`proxy/handler.py` 的 `handle_task_submission`（认证路径显式构造带这些头的 `JSONResponse`，含 `_build_replay_response` 幂等重放分支）。

**匿名路径**（`allow_anonymous=true` 时）**不**附带这些头：`handle_task_submission` 的匿名分支调用 `_relay_response(upstream_resp)` 直接透传上游响应，不添加 gateway 专属头。

## 命名约定

- 错误判别联合使用字符串字面量字段 `_type` 区分变体（如 `_type: 'HttpError'`）。
- 文件/函数/变量命名风格不属本 spec 约束范围（实现自由）。
