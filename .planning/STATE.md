# PAN-70: Convert remaining execSync calls to async

## Status: IN_PROGRESS

## Problem Statement

The dashboard server has ~70 blocking `execSync` calls that can cause event loop starvation and perceived hangs/slowness. This is a follow-up to PAN-35 (Terminal latency: Phase 2).

## Decisions Made

### Scope
- **Convert ALL remaining execSync calls** across three files
- Focus on making calls non-blocking, not tuning polling intervals

### Files to Modify
1. `src/dashboard/server/index.ts` (~51 execSync calls)
2. `src/lib/cloister/specialists.ts` (~15 execSync calls)
3. `src/lib/health.ts` (~3 execSync calls)

### API Changes
- **Make existing functions async directly** (not backward-compatible variants)
- Update all callers to use `await`
- Functions affected:
  - `specialists.ts`: `isRunning()`, `isIdleAtPrompt()`, `initializeSpecialist()`, `resetSpecialist()`, `wakeSpecialist()`, `sendFeedbackToAgent()`
  - `health.ts`: `isAgentAlive()`, `getAgentOutput()`, `sendHealthNudge()`, `pingAgent()`, `handleStuckAgent()`, `runHealthCheck()`

### Error Handling
- **Keep same try/catch pattern**, just make it async
- Return `false`/`null` on error (same as current behavior)

### Acceptance Criteria
- All existing tests pass
- **Run `terminal-latency.spec.ts` tests**
- **P95 latency < 50ms** (hard requirement)

## High-Impact Calls (Priority Order)

These are called frequently and should be converted first:

1. **`detectSpecialistCompletion()`** (server/index.ts:195)
   - Called every 5 seconds by `pollReviewStatus()`
   - Uses: `tmux capture-pane`

2. **`isIdleAtPrompt()`** (specialists.ts:485)
   - Called on every specialist status check
   - Uses: `tmux capture-pane`

3. **`isRunning()`** (specialists.ts:463)
   - Called frequently for status checks
   - Uses: `tmux has-session`

4. **`isAgentAlive()`** (health.ts:85)
   - Called during health check cycles
   - Uses: `tmux has-session`

5. **`getAgentOutput()`** (health.ts:97)
   - Called during health check cycles
   - Uses: `tmux capture-pane`

## Implementation Approach

### Pattern to Follow
The codebase already has `execAsync = promisify(exec)` and uses it in many places. Follow the existing pattern:

```typescript
// Before
function isRunning(name: SpecialistType): boolean {
  try {
    execSync(`tmux has-session -t ${session}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// After
async function isRunning(name: SpecialistType): Promise<boolean> {
  try {
    await execAsync(`tmux has-session -t ${session}`);
    return true;
  } catch {
    return false;
  }
}
```

### Order of Operations
1. **specialists.ts first** - Convert low-level utility functions
2. **health.ts second** - Depends on some patterns from specialists.ts
3. **server/index.ts last** - Update callers to use await

### Special Considerations

#### pollReviewStatus()
Currently synchronous, calls `detectSpecialistCompletion()` in a loop. After conversion:
- Make `pollReviewStatus()` async
- Use `Promise.all()` for parallel specialist checks where possible
- Keep `setInterval(pollReviewStatus, 5000)` but handle async properly

#### getSpecialistStatus()
Called by multiple API endpoints. After `isRunning()` and `isIdleAtPrompt()` become async:
- Make `getSpecialistStatus()` async
- Update all API handlers that call it

## Categorized execSync Calls

### specialists.ts (15 calls)

| Line | Function | Command | Priority |
|------|----------|---------|----------|
| 463 | isRunning | `tmux has-session` | HIGH |
| 485 | isIdleAtPrompt | `tmux capture-pane \| tail` | HIGH |
| 667-679 | initializeSpecialist | `tmux new-session`, `send-keys` x2 | MEDIUM |
| 756-767 | resetSpecialist | `send-keys` x5 | MEDIUM |
| 824 | wakeSpecialist | `tmux new-session` | MEDIUM |
| 850-852 | wakeSpecialist | `send-keys` x2 | MEDIUM |
| 1139-1147 | sendFeedbackToAgent | `has-session`, `send-keys` x2 | LOW |

### health.ts (3 calls)

| Line | Function | Command | Priority |
|------|----------|---------|----------|
| 85 | isAgentAlive | `tmux has-session` | HIGH |
| 97 | getAgentOutput | `tmux capture-pane` | HIGH |
| 284 | runHealthCheck | `tmux list-sessions` | MEDIUM |

### server/index.ts (~51 calls)

| Category | Count | Priority |
|----------|-------|----------|
| Polling (detectSpecialistCompletion) | 1 | HIGH |
| tmux operations (send-keys, has-session) | ~15 | MEDIUM |
| Git operations | ~12 | MEDIUM |
| Workspace management | ~8 | LOW |
| Docker checks | ~3 | LOW |
| beads (bd) commands | ~4 | LOW |
| Other | ~8 | LOW |

## Risk Mitigation

1. **Cascading changes**: Many functions call the utilities being changed. Plan for significant caller updates.
2. **Race conditions**: Async operations could introduce race conditions where sync was safe. Review polling loops carefully.
3. **Error propagation**: Ensure all async errors are caught at appropriate levels.

## Out of Scope

- Polling interval tuning (explicitly excluded)
- New features or functionality
- Performance optimizations beyond async conversion

## Current Status

### Completed (2026-01-23)

✅ **specialists.ts** (beads: panopticon-btbw)
- Added `execAsync = promisify(exec)` import
- Converted all functions to async:
  - `isRunning()` → returns `Promise<boolean>`
  - `isIdleAtPrompt()` → returns `Promise<boolean>`
  - `getSpecialistStatus()` → returns `Promise<SpecialistStatus>`
  - `getAllSpecialistStatus()` → returns `Promise<SpecialistStatus[]>`
  - `sendFeedbackToAgent()` → returns `Promise<boolean>`
  - `initializeSpecialist()` - converted internal execSync calls
  - `resetSpecialist()` - converted internal execSync calls
  - `wakeSpecialist()` - converted internal execSync calls
- Updated all callers:
  - `src/dashboard/server/index.ts`: API endpoints `/api/specialists`, `/api/specialists/:name/wake`, `/api/specialists/:name/reset`
  - `src/cli/commands/specialists/list.ts`: `listCommand()`
  - `src/cli/commands/specialists/reset.ts`: `resetCommand()` and `resetAllSpecialists()`
  - `src/cli/commands/specialists/wake.ts`: `wakeCommand()`

✅ **health.ts** (beads: panopticon-dy2a)
- Added `execAsync = promisify(exec)` import
- Converted all functions to async:
  - `isAgentAlive()` → returns `Promise<boolean>`
  - `getAgentOutput()` → returns `Promise<string | null>`
  - `sendHealthNudge()` → returns `Promise<boolean>`
  - `pingAgent()` → returns `Promise<AgentHealth>`
  - `runHealthCheck()` - converted internal execSync call
- Updated all callers:
  - `src/cli/commands/work/health.ts`: `healthCommand()` ping action

### Next Steps

1. **server/index.ts** (beads: panopticon-0cyo) - Convert remaining execSync calls in API endpoints and polling logic

### Remaining Work

- [x] Convert specialists.ts to async ✅
- [x] Convert health.ts functions to async ✅
- [ ] Convert server/index.ts remaining execSync calls (IN PROGRESS)
- [ ] Run tests to verify no regressions
- [ ] Measure terminal latency (P95 < 50ms target)
