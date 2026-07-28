import { type, type Type } from 'arktype';

// Spec: frontend/specs/core/conventions.md (Schema construction helper contract)
//
// Stub returns a schema that throws on invocation. This allows
// module-level schema construction (type-checking) to succeed while
// keeping runtime calls in the red phase.

function throwNotImplemented() {
  throw new Error('not implemented');
}

export function defineResponseSchema<const D, const O>(
  def: D,
  _output: O,
): Type<O> {
  return type(def as never).pipe(() => {
    throwNotImplemented();
  }) as unknown as Type<O>;
}

export function defineRequestSchema<const D, const O>(
  def: D,
  _output: O,
): Type<O> {
  return type(def as never).pipe(() => {
    throwNotImplemented();
  }) as unknown as Type<O>;
}
