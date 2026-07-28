import { type, type Type } from 'arktype';
import { camelCase, snakeCase } from 'change-case/keys';

// Spec: frontend/specs/core/conventions.md (Schema construction helper contract)

export function defineResponseSchema<const D, const O>(
  def: D,
  _output: O,
): Type<O> {
  const base = type(def as never);
  return base.pipe((x: unknown) => camelCase(x, Infinity)) as unknown as Type<O>;
}

export function defineRequestSchema<const D, const O>(
  def: D,
  _output: O,
): Type<O> {
  const base = type(def as never);
  return base.pipe((x: unknown) => snakeCase(x, Infinity)) as unknown as Type<O>;
}
