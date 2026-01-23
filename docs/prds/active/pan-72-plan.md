# PAN-72: Cloister - Convert remaining execSync calls to async

## Status: PLANNING COMPLETE

## Problem Statement

PAN-70 converted execSync calls in `server/index.ts`, `specialists.ts`, and `health.ts`, but there are still blocking execSync calls in the cloister code that cause the dashboard to hang on startup.

## Decisions Made

### Scope
- **Convert ALL execSync calls** in the three target files
- Include git commands, find/xargs, and CLI-only paths (not just beads commands)
- Consistent approach across the codebase

### Async Propagation
- **Propagate async upward** to parent functions
- `checkAllTriggers()` becomes async so callers can await properly
- Clean, idiomatic async/await throughout

### Files to Modify

| File | execSync Calls | Functions to Convert |
|------|---------------|---------------------|
| `src/lib/cloister/triggers.ts` | 3 | `checkPlanningComplete()`, `checkTaskCompletion()`, `checkAllTriggers()` |
| `src/lib/cloister/handoff-context.ts` | 4 | `captureGitState()`, `captureBeadsTasks()` |
| `src/cli/commands/work/plan.ts` | 6 | `findPRDFiles()`, `createBeadsTasks()` |

### Pattern to Follow

Use the existing pattern from `health.ts`:

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Before
const output = execSync(`bd list --json -l ${label}`, { encoding: 'utf-8' });

// After
const { stdout: output } = await execAsync(`bd list --json -l ${label}`, { encoding: 'utf-8' });
```

### Error Handling
- Keep existing try/catch patterns
- Return same default values on error (empty arrays, false, etc.)
- No change to error behavior, just make it async

### Testing
- Run existing test suite (`npm test`)
- No new tests required for this refactor

## Detailed Analysis

### triggers.ts (3 execSync calls)

| Line | Function | Command | Notes |
|------|----------|---------|-------|
| 167 | `checkPlanningComplete()` | `bd list --json -l ${issueId} --status closed` | Returns TriggerDetection |
| 350 | `checkTaskCompletion()` | `bd list --json -l ${issueId} --status closed` | Returns TriggerDetection |
| 361 | `checkTaskCompletion()` | `bd list --json -l ${issueId} --status open` | Second call in same function |

**Impact**: `checkAllTriggers()` calls both functions, so it must become async too.

### handoff-context.ts (4 execSync calls)

| Line | Function | Command | Notes |
|------|----------|---------|-------|
| 137 | `captureGitState()` | `git branch --show-current` | Already marked async but uses execSync |
| 144 | `captureGitState()` | `git status --porcelain` | Same function |
| 154 | `captureGitState()` | `git log -1 --oneline` | Same function |
| 171 | `captureBeadsTasks()` | `bd list --json -l ${label}` | Already marked async |

**Note**: These functions are already declared `async` but use execSync internally - just need to swap to execAsync.

### plan.ts (6 execSync calls)

| Line | Function | Command | Notes |
|------|----------|---------|-------|
| 77-79 | `findPRDFiles()` | `find ... \| xargs grep ...` | Search for PRD files |
| 468 | `createBeadsTasks()` | `which bd` | Check if bd CLI exists |
| 498 | `createBeadsTasks()` | `bd create ...` | Create individual tasks |
| 517 | `createBeadsTasks()` | `bd flush` | Sync beads to git |

**Impact**: `planCommand()` already uses async/await, just need to await these functions.

## Acceptance Criteria

- [ ] All execSync calls converted to execAsync in all 3 files
- [ ] Functions properly propagate async to callers
- [ ] `npm test` passes
- [ ] No regressions in dashboard functionality

## Out of Scope

- Polling interval tuning
- Beads daemon performance issues (separate issue with beads itself)
- New features or functionality
- Converting execSync in files not listed above

## Callers of checkAllTriggers()

These files will need `await checkAllTriggers(...)` after the conversion:

| File | Line | Context |
|------|------|---------|
| `src/dashboard/server/index.ts` | 2724 | API endpoint handler (already async) |
| `src/lib/cloister/service.ts` | 783 | Monitoring loop in CloisterService |

## Tasks

1. **Convert triggers.ts** - Convert 3 execSync calls, make `checkPlanningComplete()`, `checkTaskCompletion()`, and `checkAllTriggers()` async
2. **Convert handoff-context.ts** - Convert 4 execSync calls (functions already async, just swap to execAsync)
3. **Convert plan.ts** - Convert 6 execSync calls, make `findPRDFiles()` and `createBeadsTasks()` async
4. **Update checkAllTriggers() callers** - Add await in server/index.ts:2724 and service.ts:783
5. **Run tests** - Verify npm test passes
