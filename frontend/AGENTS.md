# AGENTS.md

## What this is

`mineru-gateway` frontend - SolidJS SPA for the gateway UI.
See `specs/` for design docs and `../plans/frontend-plan.md` for the roadmap.

## Stack

- **SolidJS 1.x** + **Vite 7**
- **TanStack Solid Router 1.x** - file-based routing (`src/routes/`)
- **TypeScript 5.9** (strict mode)
- **ky 2.x** - HTTP client
- **neverthrow 8.x** - `Result` / `ResultAsync`
- **arktype 2.x** - runtime schema validation + type derivation
- **UnoCSS** - atomic CSS (Wind4 preset)
- **Kobalte** - UI components
- **Lucide** - icons
- **Vitest 4.x** - test runner
- **pnpm** - package manager

## Essential commands

```bash
pnpm dev                           # start dev server
pnpm build                         # production build
pnpm test                          # run tests (single pass)
pnpm test:watch                    # watch mode
pnpm e2e                           # run e2e tests
pnpm typecheck                     # tsc --noEmit
pnpm test -- tests/core/validation.test.ts   # run a single test file
```

**Before considering work done, run:** `pnpm test && pnpm typecheck`.

## Code organization

```
src/
  core/             # infrastructure layer (see below)
  api/
    functions/      # endpoint functions (auth, health, tasks)
    schemas/        # request/response schemas + types
  routes/           # TanStack file-based routes (__root.tsx, index.tsx, ...)
  stores/           # global state (auth)
  App.tsx           # unused (scaffold remnant)
  index.tsx         # entry point - creates authStore, AuthProvider, RouterProvider
  routeTree.gen.ts  # auto-generated route tree (do not edit)
specs/core/         # infra-layer behavioral contracts (source of truth)
tests/core/         # tests for the infrastructure layer
tests/e2e/          # e2e tests against running gateway + mock upstream
```

### `core/` - infrastructure layer

| File | Purpose |
|------|---------|
| `conventions.ts` | `defineResponseSchema` / `defineRequestSchema` (snake↔camel morph via arktype `.pipe()`) |
| `error-model.ts` | `HttpError`, `ApiError<>`, type guards, `createHttpError` |
| `http-client.ts` | `request()`, `parseJson`, `parseBlob`, `parseArrayBuffer`, `passthrough`; lazy-singleton ky instance with `beforeRequest`/`afterResponse` hooks (reserved for auth injection + 401->refresh->retry) |
| `validation.ts` | arktype ↔ neverthrow bridge: `validateSuccess`, `validateFailure`, `fetchAndValidate`, `fetchBinaryAndValidate` |

### `api/` - HTTP layer

| Directory | Purpose |
|-----------|---------|
| `functions/` | `auth.ts` (login, refreshToken, logout, register, getCurrentUser), `health.ts` (getHealth), `tasks.ts` (submitTask, parseFile, listTasks, getTaskStats, getTaskDetail, cancelTask, getTaskResult, downloadResultZip, batchCancelTasks) |
| `schemas/` | `auth.ts`, `health.ts`, `tasks.ts`, `shared.ts` (ErrorDetailSchema), `mineru-options.ts` (MineruBackend/MineruLanguage/MineruEffort/MineruParseMethod enums with arktype schemas, `ParseRequestFields` typed form builder, `createParseFormData()`) |

### `stores/` - global state

| File | Purpose |
|------|---------|
| `auth.tsx` | `AuthStore` - JWT tokens in localStorage, `login`/`logout`/`refresh`/`init`, error mapping |
| `auth-context.tsx` | `AuthContext` + `useAuth()` hook + `AuthProvider` |
| `guard.ts` | `requireAuth()` - throws `redirect('/login')` if not authenticated |

## Critical constraints

- **All request/response key conversion** goes through `defineResponseSchema` /
  `defineRequestSchema` - these internally apply `camelCase(x, Infinity)` /
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
- **Task submission uses `ParseRequestFields`**, not raw `FormData`. Build form data
  via `createParseFormData(fields)` - `backend`, `lang_list`, `effort`, and
  `parse_method` are restricted to their MinerU enum values at type level.
- **TanStack Router routes are file-based.** Add pages under `src/routes/`.

## Where things live when adding a feature

- New API endpoint schemas / fetch functions? -> `src/api/schemas/` + `src/api/functions/`
- New route/page? -> add a file to `src/routes/`
- New global state? -> add to `src/stores/`
- New core primitives? -> extend files in `src/core/`, update matching spec in
  `specs/core/`.

## Tests

- Layout: `tests/core/` mirrors `src/core/` - one test file per module.
- `tests/core/ky-mock.ts` provides a shared ky mock factory. Always use it;
  don't inline `vi.mock('ky', ...)`.
- Tests verify spec invariants (`specs/core/*.md` each have an "不变量清单" section).
  When adding a new invariant to a spec, add a matching test.
- E2E tests live in `tests/e2e/` and use `helpers.ts` (mock control API, PDF blob,
  API key factory). Run with `pnpm e2e`.
- Run the full suite before finishing: `pnpm test`.
