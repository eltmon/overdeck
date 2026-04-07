# PAN-512: Effect yield* failures not caught by JS try/catch

## Status: In Progress

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

## Current Phase
Implementing bead feature-pan-489-ejs: Fix all try/catch-around-yield* instances in routes/workspaces.ts

## Completed Work
- [x] feature-pan-489-2l3: Fixed 14 try/catch-around-yield* instances in routes/agents.ts (commit: cffb3138)
- [x] feature-pan-489-ejs: Fixed 22 try/catch-around-yield* instances in routes/workspaces.ts — URL file read, rm/docker fallback, 3x docker info checks, planning/beads copy, symlink+chmod, .env repair, Flyway checks, container loop, feedback send, messageAgent, git info, spawnEphemeralSpecialist, resetPostMergeState, dispatchToSpecialist, fetch forward, docker stop/start, customerCount (commit: pending)

## Remaining Work
- [ ] feature-pan-489-wmt: Fix 2 try/catch-around-yield* instances in routes/mission-control.ts
- [ ] feature-pan-489-3hk: Fix 1 try/catch-around-yield* instance in routes/specialists.ts
- [ ] feature-pan-489-dzt: Add ESLint rule to prevent try/catch around yield* in Effect.gen
- [ ] feature-pan-489-svx: Verify typecheck, lint, and tests pass

## Key Decisions
- Fixed ALL try/catch-around-yield* instances in agents.ts (14 total, planning said 5 — the count was conservative)
- Pattern: readFile/execAsync → .pipe(Effect.catchAll(() => Effect.succeed(null))) then try/catch around JSON.parse separately
- For "return on error" pattern: used local variable + Effect.catchAll to capture the error, then check after
- For "set flag on success" (docker, cp): used Effect.map(() => true).pipe(Effect.catchAll(() => Effect.succeed(false)))

## Specialist Feedback
(none yet)

## Out of Scope

- Refactoring routes beyond the try/catch fix
- Services (audit found no problematic instances)
- Non-route code (CLI commands use sync patterns legitimately)
