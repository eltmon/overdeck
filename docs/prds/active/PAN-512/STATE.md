# PAN-512: Effect yield* failures not caught by JS try/catch

## Status: Planning Complete

## Problem

Inside `Effect.gen(function*() { ... })` blocks, `yield*` propagates failures through the Effect fiber error channel, not as JS exceptions. Any JS `try/catch` surrounding a `yield*` call is a no-op for Effect failures — they silently bypass the catch and surface as top-level route errors (500s).

This was discovered when `git diff --cached --quiet` failed during planning artifact commit in `routes/agents.ts` (fixed in 783d85f as a workaround).

## Audit Results

**17 instances** across 4 route files:

| File | Count | Examples |
|------|-------|---------|
| `routes/agents.ts` | 5 | tmux kill-session, rm completed marker, Docker checks, runtime JSON parse |
| `routes/workspaces.ts` | 9 | planning copy, beads copy, symlink repair, .env repair, Docker checks, Flyway repair, container control loop |
| `routes/mission-control.ts` | 2 | Linear comment sync, Rally story sync |
| `routes/specialists.ts` | 1 | work state file parse |

## Decision: Fix Patterns

Three replacement patterns based on intent:

1. **"Ignore failure"** (`try { yield* } catch {}`) → `yield* someEffect.pipe(Effect.catchAll(() => Effect.void))`
2. **"Return error response on failure"** (`try { yield* } catch { return jsonResponse(...) }`) → `yield* someEffect.pipe(Effect.catchAll((e) => Effect.succeed(jsonResponse({error: ...}, {status: 400}))))`
3. **"Retry/fallback loop"** → Use `Effect.either` to get `Either<Error, A>`, then branch on `Either.isLeft`

For mixed cases (JSON.parse + yield* in same try block): separate the yield* from the sync code — yield* first into a variable, then try/catch the sync parse.

## Decision: ESLint Prevention

Add a `no-restricted-syntax` ESLint rule that flags `TryStatement` containing `YieldExpression` when inside `Effect.gen`. This catches the pattern at lint time before it reaches production.

## Scope

- All 17 instances in 4 route files
- 1 ESLint rule addition
- Extend existing `effect-patterns.test.ts` with a comment documenting the pattern (the ESLint rule is the real enforcement)

## Out of Scope

- Refactoring routes beyond the try/catch fix
- Services (audit found no problematic instances)
- Non-route code (CLI commands use sync patterns legitimately)
