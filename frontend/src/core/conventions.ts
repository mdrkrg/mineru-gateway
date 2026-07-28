import type { Type } from 'arktype';

// Spec: frontend/specs/core/conventions.md (Schema construction helper contract)

export function defineResponseSchema<const D, const O>(
  def: D,
  output: O,
): Type & { infer: O; inferIn: D } {
  throw new Error('not implemented');
}

export function defineRequestSchema<const D, const O>(
  def: D,
  output: O,
): Type & { infer: O; inferIn: D } {
  throw new Error('not implemented');
}
