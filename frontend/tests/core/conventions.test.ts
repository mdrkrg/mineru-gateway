import { describe, it, expect } from 'vitest';
import { type, ArkErrors } from 'arktype';
import {
  defineResponseSchema,
  defineRequestSchema,
} from '../../src/core/conventions';

// Spec: frontend/specs/core/conventions.md
//
// This file tests the Schema construction helper contract and naming
// conversion invariants (invariants 1-8 in conventions.md).
//
// Tests call the schema directly (schema(data)) rather than through
// validate() to avoid TS2589 deep instantiation from resolving
// S['infer'] through the Type intersection. validate() is tested in
// validation.test.ts.

function callSchema<O>(schema: { (data: unknown): O | ArkErrors }, data: unknown): O {
  const result = schema(data);
  if (result instanceof ArkErrors) {
    throw new Error(`schema validation failed: ${result.summary}`);
  }
  return result;
}

describe('conventions: defineResponseSchema', () => {
  // Spec: conventions.md "Schema construction helper contract"
  // defineResponseSchema(def, output) internally equals:
  //   type(def).pipe((x) => camelCase(x, Infinity)).as<output>()
  // - Runtime: deep recursive snake_case -> camelCase key conversion
  // - Compile-time: Type['infer'] locked to O

  it('returns a callable Type that validates and converts keys to camelCase', () => {
    const schema = defineResponseSchema(
      { task_id: 'string', file_names: 'string[]' },
      {} as { taskId: string; fileNames: string[] },
    );
    // Spec invariant 4: schema(data) applies morph.
    // Input is snake_case wire format, output should be camelCase.
    const val = callSchema(schema, { task_id: 't1', file_names: ['a', 'b'] });
    expect(val.taskId).toBe('t1');
    expect(val.fileNames).toEqual(['a', 'b']);
  });

  it('converts nested object keys recursively (depth=Infinity)', () => {
    // Spec: conventions.md invariant 1 - must pass depth=Infinity
    // change-case/keys defaults to depth=1 (top-level only); nested keys
    // would NOT be converted without Infinity.
    const schema = defineResponseSchema(
      {
        detail: 'string',
        non_downloadable: type({
          task_id: 'string',
          status: 'string',
          reason: 'string',
        }).array(),
      },
      {} as {
        detail: string;
        nonDownloadable: { taskId: string; status: string; reason: string }[];
      },
    );
    const input = {
      detail: 'some failed',
      non_downloadable: [
        { task_id: 't1', status: 'failed', reason: 'not_completed' },
      ],
    };
    const val = callSchema(schema, input);
    expect(val.nonDownloadable[0].taskId).toBe('t1');
    expect(val.nonDownloadable[0].status).toBe('failed');
  });

  it('returns ArkErrors on schema validation failure', () => {
    const schema = defineResponseSchema(
      { task_id: 'string' },
      {} as { taskId: string },
    );
    const result = schema({ task_id: 123 });
    expect(result).toBeInstanceOf(ArkErrors);
  });

  it('preserves keys that have no underscore (no-op for camelCase-safe keys)', () => {
    const schema = defineResponseSchema(
      { detail: 'string', count: 'number' },
      {} as { detail: string; count: number },
    );
    const val = callSchema(schema, { detail: 'msg', count: 5 });
    expect(val.detail).toBe('msg');
    expect(val.count).toBe(5);
  });
});

describe('conventions: defineRequestSchema', () => {
  // Spec: conventions.md "Schema construction helper contract"
  // defineRequestSchema(def, output) internally equals:
  //   type(def).pipe((x) => snakeCase(x, Infinity)).as<output>()
  // - Runtime: deep recursive camelCase -> snake_case key conversion
  // - Compile-time: Type['infer'] locked to O (wire format type)

  it('returns a callable Type that validates and converts keys to snake_case', () => {
    const schema = defineRequestSchema(
      { taskIds: 'string[]' },
      {} as { task_ids: string[] },
    );
    // Spec invariant 4: input is camelCase domain type, output is snake_case wire format
    const val = callSchema(schema, { taskIds: ['t1', 't2'] });
    expect(val.task_ids).toEqual(['t1', 't2']);
  });

  it('converts nested object keys recursively (depth=Infinity)', () => {
    const schema = defineRequestSchema(
      {
        outerKey: type({
          innerValue: 'string',
        }),
      },
      {} as { outer_key: { inner_value: string } },
    );
    const val = callSchema(schema, { outerKey: { innerValue: 'v1' } });
    expect(val.outer_key.inner_value).toBe('v1');
  });

  it('returns ArkErrors on schema validation failure', () => {
    const schema = defineRequestSchema(
      { taskIds: 'string[]' },
      {} as { task_ids: string[] },
    );
    const result = schema({ taskIds: 'not-an-array' });
    expect(result).toBeInstanceOf(ArkErrors);
  });
});

describe('conventions: naming conversion invariants (type-level)', () => {
  // Spec: conventions.md invariants 1-3
  // Invariant 1: response schemas must use defineResponseSchema (camelCase morph)
  // Invariant 2: request schemas must use defineRequestSchema (snakeCase morph)
  // Invariant 3: Type['infer'] is locked to output param via .as<>()

  // Helper: bidirectional exactness check
  type IsExact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

  it('defineResponseSchema infer is exactly the declared output param', () => {
    const schema = defineResponseSchema(
      { task_id: 'string' },
      {} as { taskId: string },
    );
    type Inferred = (typeof schema)['infer'];
    type Check = IsExact<Inferred, { taskId: string }>;
    const _c: Check = true;
    expect(_c).toBe(true);
  });

  it('defineRequestSchema infer is exactly the declared output param', () => {
    const schema = defineRequestSchema(
      { taskIds: 'string[]' },
      {} as { task_ids: string[] },
    );
    type Inferred = (typeof schema)['infer'];
    type Check = IsExact<Inferred, { task_ids: string[] }>;
    const _c: Check = true;
    expect(_c).toBe(true);
  });

  // Spec: conventions.md "Schema construction helper contract" lines 105-114
  // defineResponseSchema(def, output): infer = O (camelCase domain),
  //                                    inferIn = snake_case wire format (from def)
  // defineRequestSchema(def, output):  infer = O (snake_case wire),
  //                                    inferIn = camelCase domain type (from def)

  it('defineResponseSchema inferIn is the snake_case wire input type', () => {
    const schema = defineResponseSchema(
      { task_id: 'string', file_names: 'string[]' },
      {} as { taskId: string; fileNames: string[] },
    );
    type InferredIn = (typeof schema)['inferIn'];
    type Check = IsExact<InferredIn, { task_id: string; file_names: string[] }>;
    const _c: Check = true;
    expect(_c).toBe(true);
  });

  it('defineRequestSchema inferIn is the camelCase domain input type', () => {
    const schema = defineRequestSchema(
      { taskIds: 'string[]' },
      {} as { task_ids: string[] },
    );
    type InferredIn = (typeof schema)['inferIn'];
    type Check = IsExact<InferredIn, { taskIds: string[] }>;
    const _c: Check = true;
    expect(_c).toBe(true);
  });
});
