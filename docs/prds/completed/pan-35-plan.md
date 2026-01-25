# PAN-35: Terminal Latency Phase 2 - Remaining Blocking Operations

## Issue Summary

Convert remaining `execSync` calls to `execAsync` to eliminate occasional lag spikes in the dashboard. While PAN-17 fixed the main terminal latency issues (WebSocket now ~2ms, keystroke latency ~1ms), there are still 73 `execSync` calls throughout the server that could cause lag during workspace/agent management operations.

## Current Status (2026-01-21)

**Terminal Performance: ✅ EXCELLENT**
- WebSocket connect: 1.80ms (was 2354ms before PAN-17)
- First keystroke: ~1ms (was 2066ms before PAN-17)
- P95 latency: 1.20ms (was 2066ms before PAN-17)
- Throughput: 7,362 keys/sec

**Remaining Work:**
73 `execSync` calls in non-critical paths that could cause occasional lag spikes:
- Workspace management (create, delete, approve): ~25 calls
- Git operations (status, commit, push): ~20 calls
- Beads integration: ~5 calls
- Docker operations: ~8 calls
- Planning session management: ~10 calls
- Misc (ensureTmuxRunning, file operations): ~5 calls

## Key Decisions

### 1. Scope - Focus on User-Facing Operations
**Decision:** Convert only operations that users actively trigger

**Rationale:**
- Terminal latency (high-frequency) is already fixed in PAN-17
- Focus on operations users click/interact with directly
- Skip one-time startup operations like `ensureTmuxRunning()`

**Priority order:**
1. **High**: Agent management (message, kill, poke) - Already async in PAN-17 ✅
2. **High**: Workspace operations (create, delete) - Still sync
3. **Medium**: Approval flow (merge, push) - Still sync
4. **Medium**: Beads operations - Still sync
5. **Low**: Git status helpers - Async version exists, but sync version still called in places
6. **Low**: Docker checks - Infrequent, acceptable to block briefly

### 2. Conversion Strategy
**Decision:** Incremental conversion with parallel execution where possible

**Pattern:**
```typescript
// BEFORE (blocking)
const result = execSync('command', { encoding: 'utf-8' });

// AFTER (non-blocking)
const { stdout: result } = await execAsync('command', { encoding: 'utf-8' });
```

**For multiple sequential operations:**
```typescript
// BEFORE (3x blocking)
execSync('git add .');
execSync('git commit -m "msg"');
execSync('git push');

// AFTER (parallel where possible, or Promise.all)
await Promise.all([
  execAsync('git add .'),
  execAsync('git commit -m "msg"').then(() => execAsync('git push'))
]);
```

### 3. Testing Strategy
**Decision:** Use existing Playwright latency tests + manual verification

**Tests:**
- Run `npm run test:latency` before/after each conversion
- Verify no regression in terminal performance
- Manual testing of converted endpoints in dashboard UI
- Check error handling (timeout, failures)

### 4. Error Handling
**Decision:** Preserve existing error handling behavior

**Pattern:**
```typescript
// BEFORE
try {
  const result = execSync('cmd', { encoding: 'utf-8' });
  // ...
} catch (err) {
  return res.status(400).json({ error: err.message });
}

// AFTER (same behavior)
try {
  const { stdout: result } = await execAsync('cmd', { encoding: 'utf-8' });
  // ...
} catch (err: any) {
  return res.status(400).json({ error: err.message });
}
```

### 5. Backwards Compatibility
**Decision:** No API changes, only internal implementation changes

**Why:**
- All endpoints keep same request/response format
- Same error codes and messages
- Same side effects (files created, git commits, etc.)
- Only difference: non-blocking execution

## Architecture

### Remaining execSync Calls by Category

#### 1. Workspace Management (High Priority)
**Location:** `/api/workspaces/create`, `/api/workspaces/:id/delete`
**Impact:** User clicks "Create Workspace" or "Delete Workspace" button, UI freezes during operation
**Count:** ~25 calls

Operations:
- `pan workspace create` (spawns Docker containers)
- `git worktree` operations
- `rsync` for backups
- `docker run` for cleanup

**Conversion impact:** Eliminates 2-5 second freezes when creating/deleting workspaces

#### 2. Approval Flow (Medium Priority)
**Location:** `/api/workspaces/:id/approve`
**Impact:** User clicks "Approve & Merge" button, UI freezes during git operations
**Count:** ~20 calls

Operations:
- `git status`, `git push`, `git checkout`, `git merge`
- `git worktree remove`
- `gh issue close`

**Conversion impact:** Eliminates 3-10 second freeze during approval

#### 3. Beads Integration (Medium Priority)
**Location:** `/api/plans/:id/beads`
**Impact:** Planning session creates beads tasks
**Count:** ~5 calls

Operations:
- `which bd`
- `bd create` (multiple)
- `bd flush`

**Conversion impact:** Eliminates 1-3 second lag when creating beads tasks

#### 4. Git Status Helper (Low Priority)
**Location:** `getGitStatus()` helper function
**Impact:** Called occasionally, but async version `getGitStatusAsync()` already exists and is used in most places
**Count:** 3 calls in sync version

**Note:** The sync version (`getGitStatus()`) appears to be unused or only used in non-critical paths. Verify and remove if unused.

#### 5. Planning Sessions (Low Priority)
**Location:** `/api/planning/:id/start`, `/api/planning/:id/continue`
**Impact:** Starting planning sessions
**Count:** ~10 calls

Operations:
- `mkdir`, `git add`, `git commit`, `git push`
- `tmux new-session`, `tmux send-keys`

**Conversion impact:** Minor, infrequent operation

#### 6. Docker Checks (Very Low Priority)
**Location:** Various endpoints
**Impact:** Checking if Docker is running
**Count:** ~3 calls

Operation: `docker info`

**Note:** This is fast (10-50ms) and only called when creating containerized workspaces. Low priority.

### Files to Modify

```
src/dashboard/server/index.ts
├── getGitStatus()              # REMOVE if unused, or convert to async
├── /api/workspaces/create      # Convert git/docker operations
├── /api/workspaces/:id/delete  # Convert cleanup operations
├── /api/workspaces/:id/approve # Convert git operations
├── /api/plans/:id/beads        # Convert bd commands
└── /api/planning/*             # Convert git/tmux operations
```

## Implementation Order

### Phase 1: High Priority (User-Blocking Operations)
1. **Convert workspace creation** (`/api/workspaces/create`)
   - `pan workspace create` execution
   - Git worktree operations
   - Docker container startup checks
2. **Convert workspace deletion** (`/api/workspaces/:id/delete`)
   - `git worktree remove`
   - Backup operations (rsync)
   - Docker cleanup

### Phase 2: Medium Priority (Frequent Operations)
3. **Convert approval flow** (`/api/workspaces/:id/approve`)
   - Git status, checkout, merge, push
   - Branch cleanup
   - Issue closing (gh CLI)
4. **Convert beads operations** (`/api/plans/:id/beads`)
   - `bd create` commands
   - `bd flush`

### Phase 3: Low Priority (Polish)
5. **Audit getGitStatus() usage** - Remove if unused, or ensure all callers use async version
6. **Convert planning session operations** (optional)
7. **Add timeout handling** for long-running async operations

## Testing Plan

### Before Each Conversion
```bash
cd src/dashboard/frontend
npx playwright test tests/terminal-latency.spec.ts --reporter=list
```

**Baseline:**
- WebSocket connect: < 5ms
- First keystroke: < 5ms
- P95: < 10ms
- No dropped keystrokes

### After Each Conversion
1. Run latency tests again - verify no regression
2. Manual test in dashboard UI:
   - Create workspace for test issue
   - Delete workspace
   - Approve & merge (with test branch)
3. Check server logs for errors
4. Verify async operations complete successfully

### Integration Test Scenarios
1. Create multiple workspaces rapidly (test concurrent operations)
2. Approve while creating workspace (test no event loop blocking)
3. Terminal typing during workspace creation (should remain responsive)

## Beads Tasks

| ID | Title | Phase | Blocked By |
|----|-------|-------|------------|
| pan35-01 | Audit getGitStatus() usage and remove/convert | 3 | - |
| pan35-02 | Convert workspace creation to execAsync | 1 | - |
| pan35-03 | Convert workspace deletion to execAsync | 1 | - |
| pan35-04 | Convert approval flow git operations to execAsync | 2 | - |
| pan35-05 | Convert beads integration to execAsync | 2 | - |
| pan35-06 | Add timeout handling for long async operations | 3 | pan35-02, pan35-03, pan35-04 |
| pan35-07 | Run comprehensive latency tests and verify metrics | 3 | pan35-02, pan35-03, pan35-04, pan35-05 |

## Success Metrics

### Performance Targets (Already Met for Terminal!)
- WebSocket connect: < 5ms ✅ (currently 1.8ms)
- First keystroke: < 5ms ✅ (currently ~1ms)
- P95 latency: < 10ms ✅ (currently 1.2ms)

### New Targets for User Operations
- Workspace create: < 100ms time-to-first-response (spinner shows immediately)
- Workspace delete: < 100ms time-to-first-response
- Approval flow: < 100ms time-to-first-response
- Terminal remains responsive during all operations

**Note:** The operations themselves may take seconds (Docker, git), but the HTTP endpoint should return immediately with a "in progress" response, allowing the UI to show loading states without freezing.

## Open Questions

### 1. Should workspace operations be truly async?
**Current:** Synchronous - endpoint blocks until operation completes
**Alternative:** Return immediately, poll for completion status

**Recommendation:** Keep synchronous for MVP (Phase 2), but ensure they're non-blocking. Consider background jobs for Phase 3.

### 2. What about very long operations (git clone, docker build)?
**Current:** Can take 30+ seconds
**Concern:** Even with execAsync, the HTTP request hangs

**Recommendation:**
- Short timeout on HTTP response (5-10s)
- Return "in progress" if operation not complete
- Client polls for status
- (Future work, out of scope for PAN-35)

## Technical Notes

### execAsync is Already Available
```typescript
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

// Usage
const { stdout, stderr } = await execAsync('command', {
  encoding: 'utf-8',
  maxBuffer: 10 * 1024 * 1024,
  timeout: 30000
});
```

### Common Patterns

**Pattern 1: Simple replacement**
```typescript
// BEFORE
const branch = execSync('git branch --show-current', { cwd, encoding: 'utf-8' }).trim();

// AFTER
const { stdout: branch } = await execAsync('git branch --show-current', { cwd, encoding: 'utf-8' });
const branchTrimmed = branch.trim();
```

**Pattern 2: Multiple sequential commands**
```typescript
// BEFORE
execSync('git add .', { cwd });
execSync('git commit -m "msg"', { cwd });
execSync('git push', { cwd });

// AFTER (sequential - commit depends on add, push depends on commit)
await execAsync('git add .', { cwd });
await execAsync('git commit -m "msg"', { cwd });
await execAsync('git push', { cwd });

// OR (if bash chaining is acceptable)
await execAsync('git add . && git commit -m "msg" && git push', { cwd, shell: '/bin/bash' });
```

**Pattern 3: Parallel operations**
```typescript
// BEFORE (sequential, wastes time)
const branch = execSync('git branch', { cwd, encoding: 'utf-8' });
const status = execSync('git status', { cwd, encoding: 'utf-8' });

// AFTER (parallel, faster)
const [{ stdout: branch }, { stdout: status }] = await Promise.all([
  execAsync('git branch', { cwd, encoding: 'utf-8' }),
  execAsync('git status', { cwd, encoding: 'utf-8' })
]);
```

### Error Handling

**execAsync rejects on non-zero exit code**, just like execSync throws:
```typescript
try {
  await execAsync('command-that-fails');
} catch (err: any) {
  console.error('Command failed:', err.message);
  // err.stdout and err.stderr available
}
```

## References

- PAN-17: Original async conversion (terminal endpoints)
- Playwright tests: `src/dashboard/frontend/tests/terminal-latency.spec.ts`
- Server code: `src/dashboard/server/index.ts`
- Issue: https://github.com/eltmon/panopticon-cli/issues/35
