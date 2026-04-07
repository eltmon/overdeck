# PAN-507: beads db not initialized on fresh install

## Status: Implementation Complete

## Context

The three-layer fix for PAN-507 is already landed on main (commit `a2663a0b`):

1. **`createBeadsFromVBrief` auto-init** (`src/lib/vbrief/beads.ts:79-102`) — detects "database not found" errors from `bd list` and auto-runs `bd init --prefix`
2. **POST `/api/agents` auto-recovery** (`src/dashboard/server/routes/agents.ts:1219-1235`) — calls `createBeadsFromVBrief` as recovery before returning 422
3. **`pan sync` health check** (`src/cli/commands/sync.ts:244-269`) — tests connectivity per project and auto-inits on failure

However, **none of these paths have test coverage**. The existing `beads.test.ts` only covers `syncBeadStatusToVBrief` and `getVBriefACStatus`.

## Current Phase
Bead closed, awaiting inspection.

## Completed Work
- [x] feature-pan-489-msk: Add unit tests for createBeadsFromVBrief (commit: ab91a507)

## Remaining Work
None

## Key Decisions
- Created `src/lib/vbrief/__tests__/create-beads.test.ts` as a separate file (not added to beads.test.ts) to avoid vi.mock() interference with existing sync-only tests in that file.
- Fixed pre-existing TS errors in sync.ts: moved beads health-check block to after `projects` is declared (line 346), and changed `config.key` → `key` from destructure (key lives on the array item, not ProjectConfig).

## Specialist Feedback
None yet.

---

## Decision: Add unit tests for createBeadsFromVBrief

### What to test

The core auto-init logic lives in `createBeadsFromVBrief()`. Test the following paths:

1. **bd CLI not found** — `which bd` fails → returns `{ success: false, errors: ['bd not found'] }`
2. **Redirect file creation** — worktree with no `.beads/redirect` but main repo has `.beads/` → creates redirect
3. **Database not found → auto-init** — `bd list` fails with "database not found" → runs `bd init --prefix`
4. **Successful bead creation** — plan with items → creates beads via `bd create` with correct labels and dependencies
5. **Idempotency** — existing beads for same label → deletes old beads before creating new ones

### Test approach

Follow the established pattern from `tests/unit/lib/lifecycle/compact-beads.test.ts`:
- Mock `child_process` + `util.promisify` via `vi.hoisted()` to intercept `execAsync`
- Use real filesystem (tmpdir) for plan files and `.beads/` directory structure
- Sequence `mockExecAsync` responses to simulate `bd` CLI behavior

### What NOT to test

- `pan sync` health check (CLI code, uses `execSync`, integration-level)
- Agent start auto-recovery (Effect server route, requires full server context)
- These are better covered by e2e tests, not unit tests

## Files affected

- `src/lib/vbrief/__tests__/beads.test.ts` — add new `describe('createBeadsFromVBrief', ...)` block

## Difficulty

**simple** — single test file, well-established mocking pattern, no architectural decisions
