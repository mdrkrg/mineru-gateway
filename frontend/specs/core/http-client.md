# HTTP 客户端

## 目标

定义可组合的 HTTP 请求层契约，使：

1. JSON 与二进制响应走同一原始响应契约，由可组合解析器分流。
2. 错误归类遵循 `error-model.md`，产出 `ResultAsync<RawResponse, ApiError<HttpError<number, unknown>>>`。
3. AbortSignal 透传，支持 SolidJS resource cleanup。
4. 响应头可达，满足 `conventions.md` 前提 5 的 `X-MinerU-Task-*` / `Content-Disposition` 等头。
5. ky 实例暴露 `hooks.beforeRequest` / `hooks.afterResponse` 配置点，为后续 auth-flow spec 的 header 注入与 401→refresh→retry 预留可组合接口，但**不**在本 spec 定义其策略。

本文件自包含；类型守卫与错误变体定义见 `error-model.md`，校验组合见 `validation.md`。本 spec 不规定内部辅助函数名，只定义契约签名与可观测行为。

## 原始响应契约 `RawResponse`

所有请求的成功路径返回 `RawResponse`，**不**在请求层解析 body：

```ts
interface RawResponse {
  readonly status: number
  readonly headers: Headers
  readonly reader: BodyReader
}

interface BodyReader {
  json(): Promise<unknown>
  text(): Promise<string>
  blob(): Promise<Blob>
  arrayBuffer(): Promise<ArrayBuffer>
}
```

断言：

- `status`：HTTP 状态码（成功路径为 2xx）。
- `headers`：`Headers` 实例（Web Fetch 标准），包含上游返回的所有响应头。`get(name)` 大小写不敏感。
- `reader`：body 读取器，提供四种读取方法，**不在请求层调用**——由调用方或可组合解析器按需调用一次。
- 同一 `RawResponse` 的 `reader` 方法**应**只调用一次（ky Response body 是 stream，二次读取会抛）。

**为什么不在请求层解析**：`/tasks/{id}/result`、`/tasks/result-zip`、`/file_parse` 返回二进制或透传上游任意响应（`conventions.md` 前提 2）。若请求层硬编码 `.json()`，这些端点不可用。统一返回 `RawResponse` + 可组合解析器，让调用方按端点选择解析方式。

## 核心请求契约

```ts
function request(
  url: string,
  options?: Options,
): ResultAsync<RawResponse, ApiError<HttpError<number, unknown>>>
```

行为断言（可测试）：

1. 内部调用 `ky(url, options)`；`url` 为相对路径，base 由 ky 实例的 `prefix` 提供（见 [ky 实例配置契约](#ky-实例配置契约)"）。
2. 成功（2xx）：构造 `RawResponse` 返回 `ok(raw)`。`status`/`headers`/`reader` 取自 ky 的 `KyResponse`。
3. 抛出 `HTTPError`（ky 的 named export）：
   - `status = error.response.status`。
   - `data = error.data`（ky 已预解析响应 body：JSON 响应自动解析，非 JSON 响应为 `string`，空 body 或解析失败为 `undefined`）。
   - 返回 `err(createHttpError(status, data))`。
4. 抛出 `NetworkError`（ky 的 named export）：`error.cause` 为原始 `Error`。返回 `err({ _type: 'NetworkError', error: error.cause ?? new Error('Network error') })`。
5. 抛出 `TimeoutError`（ky 的 named export）：返回 `err({ _type: 'NetworkError', error: error })`。
6. 抛出 `DOMException`（name 为 `'AbortError'`，fetch abort 信号）：返回 `err({ _type: 'NetworkError', error: error })`。
7. 抛出其他任何值：返回 `err({ _type: 'UnexpectedError', error: thrown })`，`error` 字段为原始抛出值（`unknown`）。
8. **AbortSignal**：`options.signal`（若提供）必须透传给 ky。当 signal 已 aborted 或在请求过程中 abort，ky 的 fetch 调用抛 `DOMException`（name 为 `'AbortError'`），上述断言 6 将其归为 `NetworkError`。调用方若希望忽略 abort，可在结果处理时用 `isNetworkError` 后进一步检查 `error.name === 'AbortError'`。
9. **响应头可达性**：`RawResponse.headers` 必须能 `get` 到以下后端会发送的头（`conventions.md` 前提 5 + 前提 2）：
   - `Content-Type`、`Content-Disposition`
   - `X-MinerU-Task-Id`、`X-MinerU-Task-Status`、`X-MinerU-Task-Status-Url`、`X-MinerU-Task-Result-Url`、`X-Idempotency-Key-Replayed`
10. `throwHttpErrors: true`（ky 默认值）是本 spec 的**硬性要求**。错误校验管线（`validateFailure`）依赖 `orElse` 在错误分支触发——只有 `throwHttpErrors: true` 时非 2xx 才会走错误分支（`err(HttpError)`）；若设为 `false`，非 2xx 会走成功分支（`ok(RawResponse)`），`orElse` 不触发，`validateFailure` 不会被调用，错误 body 会被当作成功 body 解析。调用方**不得**配置 `throwHttpErrors: false`。

## 可组合解析器

解析器是 `(RawResponse) => Result<T, ApiError<never>>` 或返回 `ResultAsync` 的函数，用于把 `RawResponse` 转成具体 body 类型。本 spec 定义四种契约，函数名不约束。

### JSON 解析器

```ts
function parseJson(response: RawResponse): ResultAsync<unknown, ApiError<never>>
```

断言：

- 调用 `response.reader.json()`。
- 成功：`ok(parsed)`，`parsed` 类型为 `unknown`（交由 `validateSuccess` 校验具体 schema）。
- 抛错（body 不是合法 JSON）：`err({ _type: 'ValidationError', summary: 'Response body is not valid JSON', issues: null })`。`issues` 为 `null` 因为 JSON 解析失败不产生 arktype 错误实例（见 [`error-model.md` `ValidationError`](./error-model.md#基础错误联合-apierrorbase)）。

### Blob 解析器

```ts
function parseBlob(response: RawResponse): ResultAsync<BlobResult, ApiError<never>>

interface BlobResult {
  readonly blob: Blob
  readonly status: number
  readonly headers: Headers
}
```

断言：

- 调用 `response.reader.blob()`。
- 成功：`ok({ blob, status: response.status, headers: response.headers })`。**必须**保留 `headers`，因为 `/tasks/result-zip` 与 `/tasks/{id}/result` 的 `Content-Disposition` 携带文件名（`conventions.md` 前提 2）。
- blob 读取一般不抛；若抛，归为 `UnexpectedError`。

### ArrayBuffer 解析器

```ts
function parseArrayBuffer(response: RawResponse): ResultAsync<ArrayBuffer, ApiError<never>>
```

行为同 Blob，但返回 `ArrayBuffer`。用于需要直接处理字节的场景（如 ZIP 内存解析）。

### Passthrough（透传）

```ts
function passthrough(response: RawResponse): Result<RawResponse, ApiError<never>>
```

断言：

- 不读 body，直接 `ok(response)`。
- 用于 `/file_parse` 等透传端点：上游响应 shape 由上游定义，前端不校验、不解析，只把 `RawResponse` 交给调用方按需处理。

### 解析器组合自由度

调用方可以自由选择解析器，**不**被请求层强制。例如：

- `/auth/jwt/login` → `parseJson` → `validateSuccess(TokenPairSchema)`
- `/tasks/{id}/result` → `parseBlob`（直接用 blob）
- `/tasks/result-zip` → `parseBlob`（成功）或 `parseJson` + `validateFailure({409: ...})`（失败时 body 是 JSON）
- `/file_parse` → `passthrough`（交由调用方决定）

> `/tasks/result-zip` 的特殊性：成功（200）返回 ZIP（二进制），失败（409）返回 JSON。这要求组合方式支持"错误分支走 JSON 校验、成功分支走 blob"。`validation.md` 的 `validateFailure` 在 `ResultAsync` 的错误分支上工作，与成功分支的 `parseBlob` 互不干扰（见 [`validation.md` 组合契约](./validation.md#组合契约)）。

## ky 实例配置契约

请求层基于一个预配置的 ky 实例（`ky.extend(...)`）。本 spec 定义该实例**必须**暴露的配置点，**不**定义具体策略（留给后续 auth-flow spec）。

> **ky 2.x 运行时事实**：ky 实例是函数（非普通对象），hooks 在 `ky.extend({ hooks: {...} })` 时注入闭包，**不**作为实例属性暴露（`instance.hooks` 为 `undefined`）。因此本 spec 的"hook 点暴露"指**创建时可配置 + 运行时由 ky 内部调用**，非运行时数组可追加。

### `prefix`

- 从 Vite 环境变量读取：`import.meta.env.VITE_API_PREFIX`，默认 `''`（同源，适用于反向代理或 Vite dev server proxy 场景）。
- 调用点的 `url` 一律为相对路径（如 `'auth/jwt/login'`、`'tasks'`），base 由 `prefix` 提供。

### `hooks.beforeRequest`

签名（ky 标准）：

```ts
hooks: {
  beforeRequest: Array<(state: {
    request: Request
    options: NormalizedOptions
    retryCount: 0
  }) => Request | Response | void | Promise<Request | Response | void>>
}
```

- 该 hook 点**必须**在 ky 实例创建时可配置（通过 `ky.extend({ hooks: { beforeRequest: [...] } })`），用于 auth header 注入。
- 注入策略（`X-API-Key` / `X-Admin-Token` / `Authorization` 三选一或组合）由后续 auth-flow spec 定义。
- 本 spec 约束：hook 不得修改 `request.url`，只可设置 header。

### `hooks.afterResponse`

签名（ky 标准）：

```ts
hooks: {
  afterResponse: Array<(state: {
    request: Request
    options: NormalizedOptions
    response: KyResponse
    retryCount: number
  }) => Response | RetryMarker | void | Promise<Response | RetryMarker | void>>
}
```

- 该 hook 点**必须**在 ky 实例创建时可配置（通过 `ky.extend({ hooks: { afterResponse: [...] } })`），用于 401→refresh→retry。重试通过返回 `ky.retry({ request: newReq, code: 'TOKEN_REFRESHED' })` 触发。
- 本 spec **不**定义实现，但声明后续 auth-flow spec 必须满足的约束（基于 `conventions.md` 前提 3）：

  1. **不轮换**：刷新请求 `POST /auth/jwt/refresh` 返回 `{access_token, token_type}`，不含新 `refresh_token`。retry hook 只更新存储的 `access_token`，**不得**期望或写入新 `refresh_token`。
  2. **不递归**：刷新请求本身**不得**触发 401-retry（防止无限循环）。实现上：刷新调用使用一个**不带** `afterResponse` retry hook 的 ky 实例或绕过该 hook。
  3. **单次重试**：对原请求最多重试一次；重试后仍 401 则放行该 401 错误，不再次刷新。
  4. **并发去重**：多个并发请求同时收到 401 时，**必须**只触发一次刷新，其余请求等待同一刷新 promise，刷新完成后用新 token 重试各自请求。
  5. **失败传播**：刷新失败（401/网络错误等）时，所有等待的请求都收到原 401 错误（或刷新错误，由后续 spec 选择），但**不**清空 `refresh_token`（因 refresh 端点不轮换，旧 `refresh_token` 仍可能有效）。

  > 这些约束是后续 auth-flow spec 的输入，本 spec 只声明 hook 点存在 + 上述不变量必须被满足。

### 其他 ky 配置

- `retry`：建议设为 `0` 或有限值（由实现决定），避免 ky 自身重试与 `afterResponse` retry 语义混淆。本 spec 不强制。
- `timeout`：不约束具体值，但**必须**可配置（用于上传大文件时长超时）。
- 上传场景（`POST /tasks`、`POST /file_parse`）：调用方通过 `options.body` 或 ky 的 `FormData` 传 multipart；本 spec 不规定上传构造方式，只要求 `options` 透传给 ky。

## 不变量清单（可测试断言）

1. 请求成功返回 `ok(RawResponse)`；`RawResponse.status` 是 2xx；`RawResponse.headers` 是 `Headers` 实例；`RawResponse.reader` 提供 `json`/`text`/`blob`/`arrayBuffer` 四方法。
2. 4xx/5xx 响应（`throwHttpErrors: true` 默认）返回 `err(HttpError<status, data>)`；`data` 为 ky 预解析的 body（JSON 为 parsed 值，空 body 或解析失败为 `undefined`）。
3. `NetworkError`/`TimeoutError`/`AbortError` → `NetworkError`，`error` 是 `Error` 实例。
4. `options.signal` aborted → 结果为 `NetworkError`，`error.name === 'AbortError'`。
5. `RawResponse.headers.get('x-mineru-task-id')` 在 `POST /tasks` 成功响应上返回非 null 字符串。
6. `RawResponse.headers.get('content-disposition')` 在 `POST /tasks/result-zip` 成功响应上返回含 `filename="results.zip"` 的字符串。
7. ky 实例在创建时可通过 `ky.extend({ hooks: { beforeRequest: [...], afterResponse: [...] } })` 配置 hook；hook 在请求生命周期内由 ky 内部调用（hook 点可达）。
8. 调用点的 `url` 是相对路径（无协议头），base 由 `prefix` 提供。
9. `parseBlob` 返回的对象包含 `headers` 字段且其值等于 `RawResponse.headers`。
10. `passthrough` 不调用任何 `reader` 方法，返回输入 `RawResponse`。
