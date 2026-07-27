# 错误模型

## 目标

定义 HTTP 客户端层与校验层共用的判别联合错误类型，使：

1. 调用方能对每个错误分支做穷尽式处理（编译期强制）。
2. 后续端点 spec 能注入端点专属的 `HttpError` 联合，不修改本层定义。
3. 错误体为空时取值确定（ky 为 `undefined`），消费者须用 `== null` 检查。

本文件自包含；类型守卫与构造器签名定义于此，`http-client.md` 与 `validation.md` 引用本文件的类型。

## `HttpError<Status, Data>`

HTTP 非 2xx 响应的 typed 错误。

```ts
interface HttpError<Status extends number, Data> {
  readonly _type: 'HttpError'
  readonly status: Status
  readonly data: Data
}
```

- `Status`：HTTP 状态码字面量类型（如 `401`、`404`、`422`）。
- `Data`：响应 body 的已校验类型。未声明 schema 校验时为 `unknown`；经 `validateFailure` 校验后为对应 schema 的 `['infer']`。

### 构造器

```ts
function createHttpError<S extends number, D>(status: S, data: D): HttpError<S, D>
```

行为：

- 输入状态码与数据，返回带 `_type: 'HttpError'` 的对象。
- 当响应 body 为空或非 JSON 时，`HttpError.data` 为 `undefined`（ky 的 `HTTPError.data` 预解析行为：空 body 或解析失败为 `undefined`）。

## 基础错误联合 `ApiErrorBase`

非端点专属的、本层固有的错误变体：

```ts
type ApiErrorBase =
  | { readonly _type: 'NetworkError'; readonly error: Error }
  | { readonly _type: 'ValidationError'; readonly summary: string; readonly issues: type.errors | null }
  | { readonly _type: 'UnhandledStatusError'; readonly status: number; readonly data: unknown }
  | { readonly _type: 'UnexpectedError'; readonly error: unknown }
```

各变体的**产生条件**（写入 spec 作为断言，`http-client.md` 与 `validation.md` 据此实现）：

| 变体 | 产生条件 |
|------|----------|
| `NetworkError` | 请求层捕获 `NetworkError`（ky 的 named export，网络错误，DNS 失败、连接拒绝等，`error.cause` 为原始 `Error`）、`TimeoutError`（ky 的 named export，超时）、`DOMException`（abort）。`error` 必须是 `Error` 实例。 |
| `ValidationError` | arktype schema 校验失败，或 JSON 解析失败等无法产生 `type.errors` 的情况。`issues` 为 arktype 返回的 `type.errors` 实例（schema 校验失败时）；为 `null`（JSON 解析失败等无 arktype 错误的情况）。`summary` 是人类可读的非空字符串——schema 校验失败时取 `type.errors` 实例的 `.summary`，其他情况由实现合成描述。 |
| `UnhandledStatusError` | 响应是 HttpError，但其状态码在调用方声明的 `failures` map 中无对应 schema，且未提供 `fallback`。`status` 为该状态码，`data` 为原始响应 body（空体时为 `undefined`）。 |
| `UnexpectedError` | 请求层捕获到上述三类之外的任何抛出（如 ky 内部 bug、序列化异常）。`error` 为原始抛出值，类型 `unknown`。 |

## `ApiError<E>`

```ts
type ApiError<E> = ApiErrorBase | E
```

- `E`：端点 spec 注入的 `HttpError` 联合，形如 `HttpError<401, A> | HttpError<409, B>`。
- 当 `E` 未注入（基础请求层）时，`ApiError<HttpError<number, unknown>>` = `ApiErrorBase | HttpError<number, unknown>`。
- 经 `validateFailure` 后，`E` 被窄化为具体状态码 + schema 推导类型（见 [`InferHttpErrors`](#inferhttperrorsf-fb)）。

**可扩展性契约**（核心约束）：

- 本层定义 `ApiErrorBase`，**不**枚举任何 HTTP 状态码。
- 端点专属错误通过泛型参数 `E` 注入，**不**修改 `ApiErrorBase`。
- 因此后续端点 spec 可声明 `failures: { 422: SchemaA, 409: SchemaB }` 并得到 `ApiError<HttpError<422, A> | HttpError<409, B>>`，本层代码无需变更。

## 类型守卫

每个变体提供类型守卫，签名与语义如下。守卫的实现通过检查 `_type` 字面量字段完成。

```ts
function isHttpError<E>(error: ApiError<E>): error is Extract<ApiError<E>, { _type: 'HttpError' }>
function isNetworkError<E>(error: ApiError<E>): error is Extract<ApiError<E>, { _type: 'NetworkError' }>
function isValidationError<E>(error: ApiError<E>): error is Extract<ApiError<E>, { _type: 'ValidationError' }>
function isUnhandledStatusError<E>(error: ApiError<E>): error is Extract<ApiError<E>, { _type: 'UnhandledStatusError' }>
function isUnexpectedError<E>(error: ApiError<E>): error is Extract<ApiError<E>, { _type: 'UnexpectedError' }>
```

断言：

- 每个守卫仅检查对应 `_type` 字面量，返回 `boolean`。
- 守卫对 `ApiError<E>` 中由 `E` 注入的 `HttpError` 变体同样适用：`isHttpError` 对任何 `HttpError<S, D>` 返回 `true`。

## `InferHttpErrors<F, FB>`

从调用方声明的状态码→schema map 推导出端点专属的 `HttpError` 联合类型。

```ts
type InferHttpErrors<
  F extends Record<number, Type>,
  FB extends Type | undefined = undefined,
> =
  | {
      [K in keyof F]: F[K] extends Type
        ? ParseInt<K> extends never ? never : HttpError<ParseInt<K>, F[K]['infer']>
        : never
    }[keyof F]
  | (FB extends Type ? HttpError<number, FB['infer']> : never)
```

其中 `ParseInt<T>` 将 TS 对象键的字符串形式转回数字字面量（TS 将数字键转为字符串，需还原）：

```ts
type ParseInt<T> = T extends number ? T : T extends `${infer N extends number}` ? N : never
```

推导规则（断言）：

1. 对 `F` 中每个数字键 `K`，生成 `HttpError<K, F[K]['infer']>`。
2. 若 `FB`（fallback schema）提供，追加 `HttpError<number, FB['infer']>`——注意 `Status` 为 `number`（非具体字面量），表示"任意未列举状态码"。
3. 若 `FB` 未提供，未列举状态码**不**产生 HttpError，而是产生 `UnhandledStatusError`（在 `validateFailure` 运行时判定，见 `validation.md`）。

**示例**（说明推导，非实现约束）：

- 声明 `failures: { 422: SchemaA, 409: SchemaB }`，无 fallback → `InferHttpErrors<F> = HttpError<422, A> | HttpError<409, B>`。
- 声明 `failures: { 422: SchemaA }`，`fallback: SchemaE` → `HttpError<422, A> | HttpError<number, E>`。

## 空体约定

ky 的 `HTTPError.data` 预解析行为：JSON 响应自动解析，非 JSON 响应为 `string`，空 body 或解析失败为 `undefined`。

- `HttpError.data` 取 `error.data`（ky 的原始值：`undefined`、`string` 或 parsed JSON）。
- `UnhandledStatusError.data` 同理。

`undefined` 表示"body 不存在或无法解析"，消费者须用 `== null` 检查（覆盖 `undefined` 与 `null`）。

## 不变量清单（可测试断言）

1. `ApiErrorBase` 恰好有 4 个变体，`_type` 分别为 `'NetworkError'` / `'ValidationError'` / `'UnhandledStatusError'` / `'UnexpectedError'`。
2. `ApiError<E>` 是 `ApiErrorBase | E`；`E` 默认为 `HttpError<number, unknown>`。
3. `createHttpError(401, { detail: 'x' })` 返回的对象满足 `isHttpError(...) === true` 且 `status === 401` 且 `data.detail === 'x'`。
4. `InferHttpErrors<{ 404: SchemaX }>` 恰为 `HttpError<404, SchemaX['infer']>`。
5. `InferHttpErrors<{ 404: SchemaX }, SchemaF>` 为 `HttpError<404, X['infer']> | HttpError<number, F['infer']>`。
6. 任何 `ApiError<E>` 值的 `_type` 字段恰好匹配一个变体（判别联合完整性）。
7. `HttpError.data` 与 `UnhandledStatusError.data` 在 body 缺失时为 `undefined`（ky 行为），消费者须用 `== null` 检查。
