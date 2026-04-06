# PAN-470: Rewrite route handlers to idiomatic Effect

## Status: Planning Complete

## Problem

PAN-449 introduced Effect services with proper layer composition, but route handlers still wrap imperative code in `Effect.promise(async () => { try { ... } catch { ... } })` and call `Effect.runSync` to use services. This defeats Effect's error channel, composability, and async safety.

**Current counts across 13 route files (15,056 lines):**
- 48 `Effect.runSync` calls (block the event loop)
- 376 `try/catch` blocks (escape Effect error handling)
- 335 sync FS calls (`readFileSync`, `writeFileSync`, `readdirSync`, `statSync`, `existsSync`)
- 140 `Effect.promise(async ...)` wrappers mixing sync/async

## Decisions

### D1: Full scope — all 6 problem areas
All areas from the issue are in scope: route rewrites (1-4), service-layer fixes (5), and test improvements (6).

### D2: Typed error-to-HTTP mapping via `httpHandler` wrapper
Create a centralized `httpHandler` function that maps typed `TaggedError` classes to appropriate HTTP status codes:

| Error | Status |
|-------|--------|
| `IssueNotFound`, `WorkspaceNotFound` | 404 |
| `TrackerNotConfigured` | 503 |
| `RateLimited` | 429 |
| `AgentAlreadyRunning` | 409 |
| `BeadsNotInitialized`, `PlanEmpty` | 422 |
| `TrackerApiError` | 502 |
| `WorkspaceCreateError`, `AgentStartError` | 500 |
| Unknown errors | 500 |

### D3: Convert ALL sync FS calls including `existsSync`
Replace every sync FS call with async equivalents (`fs/promises`). CLAUDE.md says `existsSync` is acceptable, but the user chose full consistency — zero sync FS in routes.

### D4: Keep existing route composition pattern
Routes will continue exporting `Layer.mergeAll(...)` route layers composed in `server.ts`. The `httpHandler` wrapper is applied per-route inside `HttpRouter.add()`.

## Approach

### Phase 1: Foundation (httpHandler wrapper)
Create `src/dashboard/server/routes/http-handler.ts` with the typed error mapping wrapper. This is the dependency for all route rewrites.

### Phase 2: Route rewrites (13 files)
Rewrite each route file to:
1. Remove all `Effect.promise(async () => { ... })` wrappers
2. Replace `Effect.runSync(service.method(...))` with `yield* service.method(...)`
3. Replace sync FS calls with `fs/promises` equivalents
4. Wrap each route body in `httpHandler(...)` instead of manual try/catch
5. Remove unused service injections

### Phase 3: Service-layer fixes (5 files)
- `linear-client.ts`: Fix `(err as any)?._tag` → `err instanceof RateLimited`
- `github-client.ts`: `removeLabel`/`ensureLabel` use `ghFetch()` instead of raw `fetch()`
- `issue-lifecycle.ts`: Non-fatal `patchIssue` uses `Effect.try().pipe(Effect.ignore)` instead of try/catch
- `workspace-service.ts`: `containerize` checks `createWorkspace` result
- `agent-spawner.ts`: Remove unnecessary `typeof normalizeAgentId === 'function'` guard

### Phase 4: Test improvements
- Add tests that use actual `*Live` layers with only external APIs mocked
- Test error channel propagation through composed layers
- Test `httpHandler` wrapper maps errors to correct HTTP status codes
- Rename mislabeled "integration" tests to "unit"

## Risk Assessment

- **High**: Route rewrites touch 15K lines of server code. A missed conversion could silently change behavior. Mitigate with thorough testing and incremental file-by-file rewrites.
- **Medium**: Some routes may have subtle ordering dependencies in their `try/catch` flows that aren't immediately obvious in the imperative code. Need careful reading of each handler before rewriting.
- **Low**: The `httpHandler` wrapper design is straightforward — Effect's `catchTags` is purpose-built for this.

## Out of Scope
- WebSocket endpoints (`ws-rpc.ts`, `ws-terminal.ts`) — already Effect-native or raw WebSocket
- `read-model.ts` and `main.ts` — not route handlers
- Adding new typed errors beyond what exists in `typed-errors.ts`
- Changing the route composition pattern (Layer.mergeAll)
