# 校验

## 目标

定义 arktype schema 与 neverthrow `Result` 之间的桥接，使：

1. 成功响应 body 经 arktype 校验后得到类型化的 `S['infer']`，失败转 `ValidationError`。
2. 错误响应 body 按状态码查 schema，校验后得到端点专属的 `HttpError<Status, S['infer']>` 联合；无 schema 则 `UnhandledStatusError`。
3. 三段式组合（请求 → 错误校验 → 成功校验）可串联表达，且请求层的二进制/JSON 解析器与校验层解耦。
4. 调用方可选地对出站请求 body 做 arktype 校验，失败时不发请求。
5. 不假设统一错误 shape（`conventions.md` 前提 4）。

本文件自包含；错误类型与 `InferHttpErrors` 见 `error-model.md`，请求层 `RawResponse` 见 `http-client.md`。本 spec 不规定内部辅助函数名。

## arktype→neverthrow 桥接 `validate`

```ts
function validate<S extends Type>(
  schema: S,
  data: unknown,
): Result<S['infer'], ArkErrors>
```

断言：

- 调用 `schema(data)`。
- 返回值是 `ArkErrors` 实例 → `err(thatInstance)`。
- 否则 → `ok(data as S['infer'])`。
- 泛型签名为 `validate<S extends Type>`，保证 `S['infer']` 正确推导。此签名适用于 morphing Type：当 schema 含 `.pipe(camelCase)` 等 morph 时，`S['infer']` 是 morph 后的输出类型，`schema(data)` 返回变换后的值。

## 成功校验 `validateSuccess`

```ts
function validateSuccess<S extends Type>(
  schema: S,
): (data: unknown) => Result<S['infer'], ApiError<never>>
```

断言：

1. 输入 `data: unknown`（来自 `parseJson` 的原始 snake_case JSON.parsed 值，或调用方手动传入）。
2. 调用 `validate(schema, data)`：schema 的 morph（`.pipe(camelCase)`）将 snake_case 键转为 camelCase。
   - 成功 → `ok(validated)`，类型 `S['infer']`（camelCase，因为 `infer` 取 morph 后的输出类型）。
   - 失败 → `err({ _type: 'ValidationError', summary: <string>, issues: <ArkErrors 实例> })`。
3. `summary` 取自 `ArkErrors` 实例的 `.summary`；若无该字段，实现可合成非空描述字符串（如 `"Schema validation failed"`）。本 spec 只要求 `summary` 为非空字符串。
4. 返回的错误类型参数为 `ApiError<never>`——即"不再含 HttpError"，因为这是成功分支的失败转化，不携带 HTTP 状态码信息。

## 错误校验 `validateFailure`

```ts
function validateFailure<
  F extends Record<number, Type>,
  FB extends Type | undefined = undefined,
>(
  failures: F,
  fallback?: FB,
): (
  error: ApiError<HttpError<number, unknown>>,
) => Result<never, ApiError<InferHttpErrors<F, FB>>>
```

行为断言（可测试）：

1. 输入 `error` 是请求层返回的 `ApiError<HttpError<number, unknown>>`。
2. **非 HttpError 分支**（`NetworkError` / `ValidationError` / `UnhandledStatusError` / `UnexpectedError`）：原样透传为 `err(error)`，类型窄化为 `ApiError<InferHttpErrors<F, FB>>`（这些变体不含端点专属 HttpError，类型兼容）。
3. **HttpError 分支**：
   - 取 `error.status`。
   - 查 `failures[status]`；未命中则用 `fallback`。
   - **无 schema 匹配**（既无 `failures[status]` 又无 `fallback`）：
      - 返回 `err({ _type: 'UnhandledStatusError', status, data: error.data })`。
      - `data` 保留请求层传入的值（空体时为 `undefined`，见 [`error-model.md` 空体约定](./error-model.md#空体约定)）。
   - **有 schema 匹配**：调用 `validate(schema, error.data)`：schema 的 morph（`.pipe(camelCase)`）将错误 body 的 snake_case 键转为 camelCase。
     - 成功 → `err(createHttpError(status, validated))`，类型 `HttpError<status, schema['infer']>`（`Data` 为 camelCase）。
     - 失败 → `err({ _type: 'ValidationError', summary: "Schema mismatch for HTTP ${status}: ${validateError.summary}", issues: <ArkErrors> })`。
4. 返回值恒为 `err(...)`（`Result<never, ...>`），因为该函数仅在错误分支工作，不产生成功值。
5. `InferHttpErrors<F, FB>` 的推导规则见 `error-model.md`：每个 `failures` 数字键产生 `HttpError<K, F[K]['infer']>`；`fallback` 产生 `HttpError<number, FB['infer']>`。

### `failures` map 的键类型

- `failures` 的键是数字字面量（`{ 422: SchemaA, 409: SchemaB }`）。
- TS 会把对象数字键转为字符串，`InferHttpErrors` 用 `ParseInt<K>` 还原（见 `error-model.md`）。
- 调用方**不得**用 `'422'` 字符串键，必须用数字键 `422:`，否则 `ParseInt` 还原失败。

### 不假设统一错误 shape

断言（基于 `conventions.md` 前提 4 + 命名转换契约）：

- `failures` **必须**逐状态码声明不同 schema。不存在"全局共享错误 schema"。
- 每个 schema **必须**以 `.pipe(camelCase)` 结尾，并通过 `.as<{...}>()` 声明精确输出类型（`camelCase` 返回 `unknown`，见 [`conventions.md` 命名转换契约](./conventions.md#命名转换契约)）。
- 举例（说明，非实现约束）：
  - FastAPI 422：`failures: { 422: FastApiValidationErrorSchema }`，其中 `FastApiValidationErrorSchema = type({ detail: FastApiErrorEntrySchema.array() }).pipe(camelCase)`。`infer` = `{ detail: [...] }`（`detail` 本身无下划线，不变化）。
  - `/tasks/result-zip` 409：`failures: { 409: ResultZipNonDownloadableSchema }`，其中 `ResultZipNonDownloadableSchema = type({ detail: 'string', non_downloadable: NonDownloadableItemSchema.array() }).pipe(camelCase)`。`inferIn` = `{ non_downloadable: [...] }`（wire format），`infer` = `{ nonDownloadable: [...] }`（domain type）。
  - 业务错误 `{ detail: 'string' }`：`failures: { 401: type({ detail: 'string' }).pipe(camelCase) }) }`。
- 调用方未声明的状态码（且无 `fallback`）→ `UnhandledStatusError`，**不**静默吞掉。

## 组合契约

请求层（`http-client.md`）返回 `ResultAsync<RawResponse, ApiError<HttpError<number, unknown>>>`。本 spec 定义三段式组合，**不**规定组合函数名，只定义可串联的形式。

### 形式 1：标准 JSON 端点

错误：

```ts
request(url, options)                                  // ResultAsync<RawResponse, ApiError<HttpError<number, unknown>>>
  .map(parseJson)                                     // 不对——parseJson 返回 ResultAsync
```

正确形式（用 neverthrow 组合子）：

```ts
request(url, options)                                  // ResultAsync<RawResponse, ApiError<HttpError<number, unknown>>>
  .andThen(parseJson)                                  // ResultAsync<unknown,   ApiError<HttpError<number, unknown> | ValidationError>>
  .orElse(validateFailure({ 422: SchemaA }, Fallback)) // ResultAsync<unknown,   ApiError<HttpError<422, A> | HttpError<number, F>>>  (错误分支窄化)
  .andThen(validateSuccess(SuccessSchema))             // ResultAsync<Success,  ApiError<...>>
  .orTee(logNonHttpErrors)                             // 副作用日志，保留原 Result
```

断言：

- `andThen`：成功时调用下一阶段，失败时直接透传错误（不调用下一阶段）。
- `orElse`：**只在错误分支**调用，转化错误类型；成功值原样透传。
- `orTee`：**只在错误分支**执行（回调接收 `E` 类型值），执行副作用（如日志），**不改变**原 Result 值。这也是为什么 `logNonHttpErrors`（接收 `ApiError<E>`）能配合 `orTee` 使用——它只在错误分支被调用。

### 形式 2：二进制端点（成功取 blob，错误校验 JSON）

适用 `/tasks/result-zip`：200 返回 ZIP，409 返回 JSON。

```ts
request(url, { method: 'POST', json: { task_ids } })
  .andThen(parseBlob)                                  // 成功分支得到 BlobResult
  .orElse(validateFailure({ 409: ResultZipNonDownloadableSchema }))
  // 错误分支：409 经 validateFailure 窄化为 HttpError<409, NonDownloadable>
  // 成功分支：parseBlob 的结果原样透传（不受 orElse 影响）
```

断言：

- 成功（200）：`parseBlob` 产出 `BlobResult`；`orElse` 不触发（无错误）；最终结果 `ok(BlobResult)`。
- 失败（409）：请求层返回 `err(HttpError<409, unknown>)`；`andThen(parseBlob)` 不触发（错误短路）；`orElse(validateFailure)` 触发，把 body 校验为 `NonDownloadable`，返回 `err(HttpError<409, NonDownloadable>)`。

> 关键点：`andThen(parseBlob)` 在错误分支不调用，故 409 的 JSON body 不会被 `parseBlob` 当二进制读。`validateFailure` 内部需要从 `HttpError.data`（已是请求层 JSON.parse 的产物）取值，**不**再次读 body。这要求请求层在错误归类时已完成 body 读取与 `JSON.parse`（见 [`http-client.md` 核心请求契约](./http-client.md#核心请求契约)）。

### 形式 3：透传端点

适用 `/file_parse`：上游 shape 任意，前端不校验。

```ts
request(url, { method: 'POST', body: formData })
  .map(passthrough)   // 或 .andThen(r => ok(r))
  // 不校验，RawResponse 交调用方处理
```

断言：

- 不调用 `validateSuccess` / `validateFailure`。
- 成功返回 `RawResponse`；调用方自行决定读 body 还是不读。

### 形式 4：全组合便利契约

spec 声明：**必须**存在一个把"请求 + 解析 + 错误校验 + 成功校验"四步组合的便利形式可被调用方使用。其签名等价于：

```ts
function fetchAndValidate<
  S extends Type,
  F extends Record<number, Type> = {},
  FB extends Type | undefined = undefined,
>(
  url: string,
  schemas: { success: S; failures?: F; fallbackFailure?: FB },
  options?: ky.Options,
): ResultAsync<S['infer'], ApiError<InferHttpErrors<F, FB>>>
```

断言：

- 内部串联 `request → andThen(parseJson) → orElse(validateFailure) → andThen(validateSuccess) → orTee(logNonHttpErrors)`。
- 默认使用 `parseJson`（形式 1）。二进制端点**不**用此便利形式，而用形式 2 的显式组合。
- `failures` 缺省为 `{}`，`fallbackFailure` 缺省为 `undefined`——此时所有非 2xx 都成 `UnhandledStatusError`。
- 函数名 `fetchAndValidate` 仅作说明，实现可任意命名；只要满足上述签名与行为。

## 请求体校验（可选 composable）

```ts
function validateRequest<S extends Type>(
  schema: S,
): (body: unknown) => Result<S['infer'], ApiError<never>>
```

断言：

- 输入待发送 body（camelCase domain type）。
- 调用 `validate(schema, body)`：schema 的 morph（`.pipe(snakeCase)`）将 camelCase 键转为 snake_case（wire format）。
  - 成功 → `ok(validated)`，类型 `S['infer']`（snake_case wire format），调用方将其作为 `options.json` 发送。
  - 失败 → `err({ _type: 'ValidationError', summary: 'Request body schema mismatch: ...', issues: <ArkErrors> })`。
- 失败时**不发请求**（在 `request` 之前短路）。
- 该 composable **可选**：不需要出站校验的端点可跳过。

## 副作用日志 `logNonHttpErrors`

```ts
function logNonHttpErrors<E extends HttpError<number, unknown>>(
  error: ApiError<E>,
): void
```

断言：

- `HttpError` 变体：**不**记日志（交调用方处理）。
- `NetworkError`：`console.error` 记录网络问题。
- `ValidationError`：`console.error` 记录 schema 不匹配（含 `summary`）。
- `UnhandledStatusError`：`console.error` 记录未处理状态码与 `data`。
- `UnexpectedError`：`console.error` 记录原始错误。
- 返回 `void`，**不**改变 error 值（配合 `orTee` 使用，保留原 Result）。

## 不变量清单（可测试断言）

1. `validate(SchemaA, validData)` 返回 `ok`，值类型为 `SchemaA['infer']`。
2. `validate(SchemaA, invalidData)` 返回 `err`，值为 `ArkErrors` 实例。
3. `validateSuccess(SchemaA)(invalidData)` 返回 `err`，`_type === 'ValidationError'`，`summary` 非空。
4. `validateFailure({ 422: SchemaA })(createHttpError(422, validA))` 返回 `err`，值 `_type === 'HttpError'`、`status === 422`、`data` 类型为 `SchemaA['infer']`。
5. `validateFailure({ 422: SchemaA })(createHttpError(404, whatever))` 返回 `err`，值 `_type === 'UnhandledStatusError'`、`status === 404`。
6. `validateFailure({ 422: SchemaA }, FallbackSchema)(createHttpError(404, validF))` 返回 `err`，值 `_type === 'HttpError'`、`status === 404`、`data` 类型为 `FallbackSchema['infer']`。
7. `validateFailure({})(createHttpError(500, undefined))` 返回 `err`，`_type === 'UnhandledStatusError'`，`data === undefined`。
8. `validateFailure({ 422: SchemaA })(createHttpError(422, invalidA))` 返回 `err`，`_type === 'ValidationError'`，`summary` 含 `"422"`。
9. `validateFailure` 对 `NetworkError` 输入原样透传（`_type` 不变）。
10. 形式 2 中，`/tasks/result-zip` 返回 409 时，最终结果是 `err(HttpError<409, NonDownloadable>)`，**不**触发 `parseBlob`。
11. 形式 2 中，`/tasks/result-zip` 返回 200 时，最终结果是 `ok(BlobResult)`，`validateFailure` 不触发。
12. `fetchAndValidate(url, { success: S })` 在非 2xx 且无 `failures`/`fallbackFailure` 时返回 `UnhandledStatusError`。
13. `validateRequest(SchemaA)(invalidBody)` 返回 `err`，`_type === 'ValidationError'`；且请求未发送（可通过 mock 验证 ky 未被调用）。
