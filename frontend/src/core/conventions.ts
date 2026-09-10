import { type, type Out, type Type } from 'arktype';
import { camelCase, snakeCase } from 'change-case/keys';

// Spec: frontend/specs/core/conventions.md (Schema construction helper contract)

type ConvertedSchema<D, O> = Type<(In: type.infer.In<D>) => Out<O>>;

/**
 * Creates an arktype schema that validates incoming JSON and converts all
 * keys from `snake_case` (wire format) to `camelCase` (domain type).
 *
 * Uses `change-case/keys` `camelCase(x, Infinity)` internally so nested
 * objects are recursively converted (the library defaults to depth=1).
 *
 * The `output` parameter is used only for type inference; it declares
 * the expected domain type after morph.  The returned schema's `.infer`
 * will match the `output` type, and `.inferIn` will match the input
 * type derived from `def` (snake_case wire format).
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
 * //       TaskSchema['inferIn'] === { task_id: string; file_names: string[] }
 */
export function defineResponseSchema<const D, const O>(
  def: D,
  _output: O,
): ConvertedSchema<D, O> {
  const base = type.raw(def);
  return base.pipe((x): O => camelCase(x, Infinity) as O) as unknown as ConvertedSchema<D, O>;
}

/**
 * Creates an arktype schema that validates an outgoing request body and
 * converts all keys from `camelCase` (domain type) to `snake_case`
 * (wire format).
 *
 * Uses `change-case/keys` `snakeCase(x, Infinity)` internally so nested
 * objects are recursively converted.
 *
 * The `output` parameter declares the wire format type.  The returned
 * schema's `.infer` will match the `output` type, and `.inferIn` will
 * match the input type derived from `def` (camelCase domain type).
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
 *
 * // Type: BodySchema['infer'] === { task_ids: string[] }
 * //       BodySchema['inferIn'] === { taskIds: string[] }
 */
export function defineRequestSchema<const D, const O>(
  def: D,
  _output: O,
): ConvertedSchema<D, O> {
  const base = type.raw(def);
  return base.pipe((x): O => snakeCase(x, Infinity) as O) as unknown as ConvertedSchema<D, O>;
}
