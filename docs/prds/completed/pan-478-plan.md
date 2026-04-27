# PAN-478: Complete httpHandler adoption for remaining 4 route files + ensureLabel fix

## Status: Planning Complete

## Problem

PAN-470 (PR #474) migrated 9 of 13 route files to idiomatic Effect with `httpHandler()`. The 4 largest files were deferred:

| File | Routes | try/catch blocks | Lines |
|------|--------|-------------------|-------|
| agents.ts | 20 | 60 | 1,740 |
| issues.ts | 17 | 61 | 2,031 |
| specialists.ts | 33 | 45 | 2,126 |
| workspaces.ts | 19 | 86 | 3,669 |
| **Total** | **89** | **252** | **9,566** |

Additionally, `ensureLabel` in `github-client.ts` still uses raw `fetch()` instead of `ghFetch()`.

## Decisions

1. **Single issue** — all 4 files + ensureLabel in one PR. Mechanical/repetitive work following established pattern.
2. **Improve error typing** — beyond mechanical migration, convert generic `catch` blocks to typed Effect errors where intent is clear (e.g., "Issue not found" -> `IssueNotFound`, rate limiting -> `RateLimited`).
3. **No known risk areas** — standard mechanical migration.

## Approach

Follow the pattern from PAN-470 (see completed files like `metrics.ts`, `costs.ts`):

1. Import `httpHandler` from `./http-handler.js`
2. Wrap each route's Effect body in `httpHandler(...)`
3. Replace `Effect.promise(async () => { try { ... } catch { ... } })` with `Effect.gen` or `Effect.tryPromise`
4. Replace `Effect.runSync(service.method(...))` with `yield* service.method(...)`
5. Remove redundant try/catch — let typed errors flow through httpHandler's error channel
6. Where catch blocks map to obvious typed errors, use them instead of generic Error

For ensureLabel: replace raw `fetch()` on line 278 with `ghFetch()`, matching the pattern used by `removeLabel`.

## References

- `src/dashboard/server/routes/http-handler.ts` — the wrapper
- `src/dashboard/server/services/typed-errors.ts` — typed error definitions
- PR #474 — the PAN-470 migration (pattern reference)
