# AGENTS.md

## What this is

`mineru-gateway` frontend — SolidJS SPA for the gateway UI.
See `specs/` for design docs.

## Stack

- **SolidJS 1.x** + **Vite 7**
- **TypeScript 5.9** (strict mode)
- **ky 2.x** — HTTP client
- **neverthrow 8.x** — `Result` / `ResultAsync`
- **arktype 2.x** — runtime schema validation + type derivation
- **UnoCSS** — atomic CSS (mini preset)
- **Vitest 4.x** — test runner
- **pnpm** — package manager

## Essential commands

```bash
pnpm dev                           # start dev server
pnpm build                         # production build
pnpm test                          # run tests (single pass)
pnpm test:watch                    # watch mode
pnpm typecheck                     # tsc --noEmit
pnpm test -- tests/core/validation.test.ts   # run a single test file
```

**Before considering work done, run:** `pnpm test && pnpm typecheck`.

## Code organization

```
src/
  core/           # infrastructure layer: error-model, http-client, validation, conventions
    conventions.ts   # defineResponseSchema / defineRequestSchema (case-morphing schema helpers)
    error-model.ts   # HttpError, ApiError<>, type guards, createHttpError, InferHttpErrors
    http-client.ts   # request(), parseJson, parseBlob, parseArrayBuffer, passthrough
    validation.ts    # validate, validateSuccess, validateFailure, fetchAndValidate, etc.
  App.tsx          # root component
  index.tsx        # entry point
specs/core/        # infra-layer behavioral contracts (source of truth)
tests/core/        # tests for the infrastructure layer
```

## Layers & dependencies

- **conventions.ts**: schema helpers using `change-case/keys` morph via arktype `.pipe()`.
- **error-model.ts**: discriminated union error types (`ApiError<E>`) and type guards.
- **http-client.ts**: wraps ky in `ResultAsync`, returns `RawResponse` (not parsed body).
  Uses a lazy-singleton ky instance (`ky.extend()`) with configurable `beforeRequest` /
  `afterResponse` hooks (for future auth header injection and 401 -> refresh -> retry).
- **validation.ts**: arktype <-> neverthrow bridge. Composable `validateSuccess` /
  `validateFailure` for success/error body validation. `fetchAndValidate` /
  `fetchBinaryAndValidate` convenience pipelines.

## Critical constraints

- **All request/response key conversion** goes through `defineResponseSchema` /
  `defineRequestSchema` — these internally apply `camelCase(x, Infinity)` /
  `snakeCase(x, Infinity)` via arktype morph. Never call `change-case/keys` directly
  in endpoint code.
- **Error handling uses `Result` / `ResultAsync`, not `throw`.** Every HTTP call
  returns `ResultAsync<T, ApiError<E>>`. Use `andThen`/`orElse`/`orTee` combinators,
  never `try/catch` for expected errors.
- **ky instance is a singleton**, created once by lazy `ky.extend()`. Hook state
  (beforeRequest for auth, afterResponse for 401 retry) must be shared across all
  requests.
- **`throwHttpErrors: true` is enforced** inside `request()`. Callers cannot disable it.
- **Tests run in node environment** (`vitest.config.ts`), ky is mocked per test file
  via `tests/core/ky-mock.ts`.

## Where things live when adding a feature

- New API endpoint schemas / fetch functions? → new files under `src/` referencing
  core layer types, schemas defined with `defineResponseSchema`/`defineRequestSchema`.
- New endpoint contract? → add spec under `specs/`, implement under `src/`.
- New core primitives? → extend files in `src/core/`, update matching spec in
  `specs/core/`.

## Tests

- Layout: `tests/core/` mirrors `src/core/` — one test file per module.
- `tests/core/ky-mock.ts` provides a shared ky mock factory. Always use it;
  don't inline `vi.mock('ky', ...)`.
- Tests verify spec invariants (`specs/core/*.md` each have an "不变量清单" section).
  When adding a new invariant to a spec, add a matching test.
- Run the full suite before finishing: `pnpm test`.
