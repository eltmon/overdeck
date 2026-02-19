# PAN-205: Convert remaining execSync calls to async (server-reachable only)

## Decision: Scope

**Convert only server-reachable execSync calls.** CLI-only files (`src/cli/commands/*`, `src/cli/index.ts`) are out of scope — they run in their own process and don't block the dashboard event loop.

### Verified scope

| File | execSync calls | Server-reachable? | Action |
|------|---------------|-------------------|--------|
| `src/lib/cloister/session-rotation.ts` | 4 | YES — via cloister service | Convert to execAsync |
| `src/dashboard/server/index.ts` | 1 | YES — directly in Express routes | Convert to execAsync |
| `src/lib/cloister/handoff.ts` | 0 (dead import) | YES — but no actual calls | Remove dead import |

### Out of scope (verified CLI-only)

| File | execSync calls | Reason |
|------|---------------|--------|
| `src/lib/worktree.ts` | 6 | Only imported by `src/cli/commands/workspace.ts` (CLI) |
| `src/lib/tmux.ts` | 13 | Sync versions kept for CLI; async versions exist for server (`sendKeysAsync`) |
| `src/lib/dns.ts` | 3 | CLI-only, explicitly documented |
| `src/cli/commands/install.ts` | 14 | CLI one-shot |
| `src/cli/index.ts` | 8 | CLI entry |
| `src/cli/commands/setup/hooks.ts` | 8 | CLI one-shot |
| `src/cli/commands/work/approve.ts` | 5 | CLI |
| `src/cli/commands/beads.ts` | 4 | CLI |
| `src/cli/commands/update.ts` | 3 | CLI |
| `src/cli/commands/sync.ts` | 3 | CLI |
| `src/cli/commands/doctor.ts` | 3 | CLI |
| `src/lib/skills-merge.ts` | 2 | CLI-only (imported by workspace.ts) |
| `src/cli/commands/work/issue.ts` | 2 | CLI |

## Decision: tmux.ts strategy

**Keep sync and async functions side by side.** The existing pattern (`sendKeys` for CLI, `sendKeysAsync` for server) works well. No new async tmux functions needed — the only tmux call in scope is a raw `execSync('tmux kill-session ...')` in session-rotation.ts, which can use `execAsync` directly.

## Architecture

### Pattern (established by PAN-70)

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

// Before:
const output = execSync('cmd', { encoding: 'utf-8' });

// After:
const { stdout: output } = await execAsync('cmd', { encoding: 'utf-8' });
```

### File 1: `src/lib/cloister/session-rotation.ts`

**4 execSync calls to convert:**

1. **Line 103**: `execSync('git log --merges ...')` in `buildMergeAgentMemory()` (sync function)
2. **Line 139**: `execSync('git show --name-only ...')` in `buildMergeAgentMemory()`
3. **Line 150**: `execSync('git show ... --stat')` in `buildMergeAgentMemory()`
4. **Line 243**: `execSync('tmux kill-session ...')` in `rotateSpecialistSession()` (already async)

**Changes needed:**
- Add `exec` import and `execAsync = promisify(exec)` at module level
- Change `import { execSync }` to `import { exec }` (remove execSync import)
- Make `buildMergeAgentMemory()` async → `async function buildMergeAgentMemory(...): Promise<string>`
- Convert 3 git commands to `await execAsync()`
- Convert 1 tmux kill-session to `await execAsync()`
- Line 234: `buildMergeAgentMemory(workingDir)` → `await buildMergeAgentMemory(workingDir)` (caller is already async)

**Cascade:** None — `rotateSpecialistSession()` already async, callers already await it.

### File 2: `src/dashboard/server/index.ts`

**1 execSync call to convert:**

1. **Line 667-668**: Dynamic `require('child_process').execSync(...)` in `getAgentWorkspace()`

**Changes needed:**
- Make `getAgentWorkspace()` async → `async function getAgentWorkspace(...): Promise<string | null>`
- Replace `execSync` with `await execAsync` (use existing module-level `execAsync` already defined in this file)
- Remove dynamic `require('child_process')` — use existing `execAsync`
- Make `getAgentJsonlPath()` async → `async function getAgentJsonlPath(...): Promise<string | null>`
- Update `getAgentPendingQuestions()` to `await getAgentJsonlPath()` (already async)
- Update the Express route on line 1839 — already inside an async handler with `await getAgentPendingQuestions()`

**Cascade:** `getAgentWorkspace` → `getAgentJsonlPath` → `getAgentPendingQuestions` (already async) → 3 Express routes (already async). Clean cascade, minimal blast radius.

### File 3: `src/lib/cloister/handoff.ts`

**0 actual calls, just a dead import.**

**Change:** Remove `import { execSync } from 'child_process';` on line 11.

## Testing

- Build succeeds (`npm run build`)
- Dashboard starts and serves agents list (`GET /api/agents`)
- Session rotation doesn't crash when specialist hits context limits
- Pending questions endpoint responds correctly

## Risk Assessment

**Low risk.** All changes follow the established PAN-70 pattern. The cascade for server/index.ts is well-contained (3 private functions, all within the same file). Session-rotation.ts changes are even simpler — the caller is already async.

## Current Status

**IMPLEMENTATION COMPLETE** — commit `21de8a2` on `feature/pan-205`, pushed to remote.

All 3 files changed:
- `src/lib/cloister/session-rotation.ts`: 4 execSync → execAsync, buildMergeAgentMemory made async
- `src/dashboard/server/index.ts`: getAgentWorkspace + getAgentJsonlPath made async, dynamic require removed
- `src/lib/cloister/handoff.ts`: dead execSync import removed

Build passes. All beads closed.

## Specialist Feedback

- **[2026-02-18T13:20Z] test-agent → FAILED** — `.planning/feedback/001-test-agent-failed.md`
- **[2026-02-18T14:16Z] test-agent → FAILED** — `.planning/feedback/002-test-agent-failed.md`
- **[2026-02-18T19:20Z] FIXED** — both regressions resolved in commit `6259b77`
