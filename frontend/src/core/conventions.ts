import { type, type Type } from 'arktype';
import { camelCase, snakeCase } from 'change-case/keys';

// Spec: frontend/specs/core/conventions.md (Schema construction helper contract)

// FIXME: The `as unknown as Type<O>` cast below destroys arktype's morph
// input-type info, making `inferIn === infer` (both = O) for ALL schemas
// produced by these helpers.
//
// Root cause: `camelCase` / `snakeCase` return `unknown`, so arktype's
// morph output type is `unknown` without `.as<O>()`.  The cast fixes
// `infer` (= O) but loses the input type (D).  `D` itself is captured as
// arktype def strings (`'string'`, `'string[]'`, `'boolean | null'`)
// which have no type-level mapping to JS types (`string`, `string[]`,
// `boolean | null`), so `Type<D>['infer']` cannot recover the JS input
// type either.
//
// Impact:
//   - `defineRequestSchema.col.inferIn` = O (snake_case wire), not D (camelCase).
//     Callers must NOT use `.inferIn` for request input types.
//     Workaround: explicit camelCase interfaces in `api/schemas/*.ts`
//       (LoginRequest, UserCreateRequest, UserUpdateRequest,
//        RefreshTokenRequest, ApiKeyCreateRequest, MyApiKeyCreateRequest,
//        ResultZipRequest, BatchCancelRequest).
//   - `defineResponseSchema.col.inferIn` = O (camelCase domain), not D (snake_case wire).
//     No impact — no code consumes `.inferIn` from response schemas.
//
// When this is fixed: delete explicit request interfaces, derive param
// types from `Schema.inferIn`, and update `validateRequest` to use
// `S['inferIn']` instead of `unknown`.

/**
 * Creates an arktype schema that validates incoming JSON and converts all
 * keys from `snake_case` (wire format) to `camelCase` (domain type).
 *
 * Uses `change-case/keys` `camelCase(x, Infinity)` internally so nested
 * objects are recursively converted (the library defaults to depth=1).
 *
 * The `output` parameter is used only for type inference; it declares
 * the expected domain type after morph.  The returned schema's `.infer`
 * will match the `output` type.
 *
 * @typeParam D - arktype definition (e.g. `{ task_id: 'string' }`).
 * @typeParam O - Output domain type in camelCase (e.g. `{ taskId: string }`).
 *                Pass `{} as MyType` to provide the type at call site.
 *
 * @example
 * const TaskSchema = defineResponseSchema(
 *   { task_id: 'string', file_names: 'string[]' },
 *   {} as { taskId: string; fileNames: string[] },
 * );
 *
 * // Runtime: snake_case input -> camelCase output
 * TaskSchema({ task_id: 't1', file_names: ['a'] })
 * // => { taskId: 't1', fileNames: ['a'] }
 *
 * // Type: TaskSchema['infer'] === { taskId: string; fileNames: string[] }
 */
export function defineResponseSchema<const D, const O>(
  def: D,
  _output: O,
): Type<O> {
  const base = type(def as never);
  return base.pipe((x: unknown) => camelCase(x, Infinity)) as unknown as Type<O>;
}

/**
 * Creates an arktype schema that validates an outgoing request body and
 * converts all keys from `camelCase` (domain type) to `snake_case`
 * (wire format).
 *
 * Uses `change-case/keys` `snakeCase(x, Infinity)` internally so nested
 * objects are recursively converted.
 *
 * The `output` parameter declares the wire format type. The returned
 * schema's `.infer` will match the `output` type.
 *
 * @typeParam D - arktype definition in camelCase (e.g. `{ taskIds: 'string[]' }`).
 * @typeParam O - Output wire format type in snake_case
 *                (e.g. `{ task_ids: string[] }`).
 *
 * @example
 * const BodySchema = defineRequestSchema(
 *   { taskIds: 'string[]' },
 *   {} as { task_ids: string[] },
 * );
 *
 * // Pass the result as `options.json` to ky:
 * BodySchema({ taskIds: ['t1', 't2'] })
 * // => { task_ids: ['t1', 't2'] }
 */
export function defineRequestSchema<const D, const O>(
  def: D,
  _output: O,
): Type<O> {
  const base = type(def as never);
  return base.pipe((x: unknown) => snakeCase(x, Infinity)) as unknown as Type<O>;
}
