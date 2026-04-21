# PRD: Stuck Parallel Review Detection, Recovery, and UI Indicators (PAN-794)

## Background

PAN-569 was discovered in a severely stuck state after 25+ hours of cycling review attempts. The parallel review sub-agents (correctness, performance, security, requirements) had infrastructure failures (API `ECONNREFUSED`, tmux buffer errors) that left them dead or stuck at interactive prompts. The review status was `reviewing` for 25 hours, with **20 review history entries** showing repeated `reviewing → pending → failed` cycles, but the work agent had already completed and verified the code.

This PRD fixes the detection gap, adds circuit-breaker recovery, and provides clear UI indicators so users can see when an issue is in recovery and why.

---

## Problems Enumerated

### Problem 1: Dead/stuck parallel review sessions are invisible to deacon
- `checkOrphanedReviewStatuses` (deacon.ts:1180) checks if tmux sessions exist via `getActiveParallelReviewIssues`, but it treats "session exists" as "session is actively working."
- `checkStuckReviewing` (deacon.ts:1641) only checks `getAllProjectSpecialistStatuses()` and the global `review-agent` session. Parallel review sessions have no runtime state entries, so they are invisible.
- Result: A session stuck at a Claude Code permission prompt for 25 hours is never detected as stuck.

### Problem 2: No circuit breaker for infrastructure-failure cycling
- After N consecutive review cycles where all failures are infrastructure errors (not code issues), deacon keeps re-dispatching indefinitely.
- Each cycle spawns 4 sub-agents costing $5–$10. PAN-569 burned through 20 review cycles.
- Result: Token/financial burn with no code progress.

### Problem 3: Verification passed but review blocks the pipeline forever
- `verificationStatus: 'passed'` means the code passes all quality gates.
- But `reviewStatus: 'reviewing'` with stuck sub-agents means `testStatus` never advances from `pending`.
- Result: Verified code is permanently blocked from merge by a broken review pipeline.

### Problem 4: Incomplete parallel reviews waste completed findings
- If 2 of 4 sub-agents complete successfully but the others crash, `dispatchParallelReview` discards all partial results and waits forever.
- PAN-569's security agent found 4 real issues, but the batch was lost because performance crashed.

### Problem 5: `stuck` flag is never set, so re-dispatch never stops
- `checkOrphanedReviewStatuses` re-dispatch path (line 1324+) never checks `status.stuck`.
- Even if something is marked stuck, deacon keeps spawning new reviews.

### Problem 6: No UI indication that recovery is happening
- The kanban card shows "Needs recovery" in the phase label, but there's no visual distinction between "recovery in progress" and "permanently stuck needs human help."
- Users can't tell if deacon is actively retrying or if the issue has given up.

---

## Solution Overview

### Backend: Deacon stuck detection

1. **Detect dead parallel sessions** — Check if `reviewSpawnedAt` is old AND tmux sessions exist but their Claude processes are sleeping at a prompt or crashed.
2. **Detect infrastructure-failure cycling** — After 3 consecutive infrastructure-failure cycles, mark `stuck: true` with `stuckReason: 'review_infrastructure_failure'`.
3. **Honor the `stuck` flag** — Skip re-dispatch in all patrol paths when `status.stuck === true`.
4. **Partial results** — If some sub-agents complete and others crash, use partial results instead of discarding everything.

### Frontend: Recovery UI indicators

1. **Kanban card pulsing border** when deacon is actively retrying recovery.
2. **"Recovery: N/3" badge** showing retry count.
3. **"Infrastructure failure — manual review needed" badge** when stuck flag is set.
4. **Consistent with Panopticon style** using existing Tailwind tokens (`badge-bg-destructive`, `animate-pulse`, etc.).

---

## Detailed Changes

### A. `src/lib/cloister/deacon.ts`

#### A.1 Add `isInfrastructureFailure` helper

```typescript
function isInfrastructureFailure(notes?: string): boolean {
  if (!notes) return false;
  const infraPatterns = [
    /ECONNREFUSED/i,
    /tmux buffer/i,
    /load-buffer/i,
    /Unable to connect to API/i,
    /protocol failure/i,
  ];
  return infraPatterns.some((p) => p.test(notes));
}
```

#### A.2 Enhance `checkStuckReviewing` to detect dead parallel sessions

Current logic (deacon.ts:1641–1691):
- Checks `getAllProjectSpecialistStatuses()` + global `review-agent`
- Does **not** check parallel review tmux sessions

**Change:**
1. Also call `getActiveParallelReviewIssues(allSessions)`.
2. For each active parallel issue, verify the session's Claude process is actually alive (not sleeping at a prompt for >10 min).
3. If `reviewSpawnedAt` is >30 min old AND no truly active session exists, reset to `pending`.

**Implementation detail for detecting "truly active":**
```typescript
// After building activeReviewIssues from specialist statuses,
// also check parallel review sessions and verify they're not stuck at prompts
const { listSessionNamesAsync } = await import('../tmux.js');
const { getActiveParallelReviewIssues } = await import('./review-agent.js');
const allSessions = await listSessionNamesAsync();

for (const issueId of getActiveParallelReviewIssues(allSessions)) {
  const sessionNames = allSessions.filter((s) =>
    s.match(new RegExp(`^review-${issueId}-\\d+-`))
  );
  let anyTrulyActive = false;
  for (const sessionName of sessionNames) {
    const panePid = await getTmuxPanePid(sessionName);
    if (panePid && (await isProcessActive(panePid))) {
      anyTrulyActive = true;
      break;
    }
  }
  if (anyTrulyActive) {
    activeReviewIssues.add(issueId);
  }
}
```

`getTmuxPanePid` and `isProcessActive` are new helpers:
```typescript
async function getTmuxPanePid(sessionName: string): Promise<number | null> {
  try {
    const { execAsync } = await import('../tmux.js');
    const { stdout } = await execAsync(`tmux list-panes -t ${sessionName} -F "#{pane_pid}"`);
    const pid = parseInt(stdout.trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

async function isProcessActive(pid: number): Promise<boolean> {
  try {
    const { execAsync } = await import('../tmux.js');
    // Check if process has used CPU in last 60s (not sleeping at prompt)
    const { stdout } = await execAsync(`ps -p ${pid} -o pid,stat,etime`);
    const lines = stdout.trim().split('\n');
    if (lines.length < 2) return false;
    const parts = lines[1].trim().split(/\s+/);
    const stat = parts[1] || '';
    // 'S+' = sleeping, foreground; if etime is >10min and still S+, likely stuck
    const etime = parts[2] || '';
    if (stat.includes('S') && etime.includes(':')) {
      const minutes = parseInt(etime.split(':')[0], 10);
      if (minutes > 10) return false;
    }
    return true;
  } catch {
    return false;
  }
}
```

> **Note:** `isProcessActive` is heuristic. A truly robust approach would capture tmux pane content and check for the Claude Code prompt string (`⏵⏵ bypass permissions on`), but that requires reading pane output which is fragile. The CPU/etime check is a simpler proxy.

#### A.3 Add infrastructure-failure circuit breaker

In `checkOrphanedReviewStatuses`, before the re-dispatch block (around line 1324):

```typescript
// Circuit breaker: after 3 consecutive infrastructure-failure review cycles,
// mark stuck and stop re-dispatching to prevent token burn.
const recentReviewHistory = status.history
  ?.filter((h) => h.type === 'review')
  .slice(-6); // last 6 review entries

const infraFailureCount = recentReviewHistory?.filter(
  (h) => h.status === 'failed' && isInfrastructureFailure(h.notes)
).length ?? 0;

if (infraFailureCount >= 3) {
  setReviewStatus(issueId, {
    stuck: true,
    stuckReason: 'review_infrastructure_failure',
    stuckAt: new Date().toISOString(),
    stuckDetails: JSON.stringify({
      cycles: recentReviewHistory?.length ?? 0,
      infraFailures: infraFailureCount,
      lastNote: recentReviewHistory?.slice(-1)[0]?.notes,
    }),
    reviewNotes: `Review stopped after ${infraFailureCount} infrastructure failures. Manual review required.`,
  });
  actions.push(`Marked ${issueId} stuck: review infrastructure failure (${infraFailureCount} cycles)`);
  continue; // Skip re-dispatch
}
```

#### A.4 Honor `stuck` flag in re-dispatch path

At the top of the re-dispatch block (deacon.ts line ~1324):

```typescript
// PAN-794: Skip stuck workspaces to prevent infinite re-dispatch loops
if (status.stuck) {
  actions.push(`Skipped pending review for ${issueId}: workspace is stuck (${status.stuckReason})`);
  continue;
}
```

#### A.5 Detect verification/review contradiction

New patrol check `checkVerificationReviewContradiction`:

```typescript
export async function checkVerificationReviewContradiction(): Promise<string[]> {
  const actions: string[] = [];
  try {
    const { loadReviewStatuses, setReviewStatus } = await import('../review-status.js');
    const statuses = loadReviewStatuses();

    for (const [issueId, status] of Object.entries(statuses)) {
      // If verification passed but review has been cycling with infra failures,
      // the review is not adding value. Mark review as passed so pipeline can proceed.
      if (
        status.verificationStatus === 'passed' &&
        status.reviewStatus === 'reviewing' &&
        status.stuckReason === 'review_infrastructure_failure'
      ) {
        setReviewStatus(issueId, {
          reviewStatus: 'passed',
          reviewNotes: 'Review bypassed: verification passed but review infrastructure repeatedly failed.',
        });
        actions.push(`Bypassed review for ${issueId}: verification passed, review infra failed`);
      }
    }
  } catch (error: unknown) {
    console.error('[deacon] Error checking verification/review contradiction:', error);
  }
  return actions;
}
```

Wire this into the main patrol loop alongside `checkOrphanedReviewStatuses` and `checkStuckReviewing`.

#### A.6 Partial results from incomplete parallel reviews

In `src/lib/cloister/review-agent.ts`, modify `dispatchParallelReview` or `spawnReviewAgent`:

When `runParallelReview` resolves, if some sub-agents crashed but others completed, synthesize partial results instead of failing the whole batch.

Current behavior (review-agent.ts:885–893):
```typescript
const { result, reviewId } = await runParallelReview(context, filesChanged, reviewAgents);
await logReviewHistory(context, result, reviewId);
await sendFeedbackToWorkAgent(context, result);
return result;
```

**Change:** In `runParallelReview`, when a sub-agent crashes, capture its partial output (if any) and include it in the synthesized result with a note that it was incomplete.

> **Note:** This is a deeper change in `runParallelReview`. If `runParallelReview` is in another file, the junior developer should trace its implementation and add try/catch around each sub-agent spawn.

### B. `src/lib/review-status.ts`

#### B.1 Add `reviewRetryCount` to `ReviewStatus` interface

```typescript
export interface ReviewStatus {
  // ... existing fields ...
  /** PAN-794: number of consecutive review re-dispatch attempts (circuit breaker) */
  reviewRetryCount?: number;
  /** PAN-794: timestamp when deacon started recovery for this issue */
  recoveryStartedAt?: string;
}
```

#### B.2 Increment `reviewRetryCount` on each deacon re-dispatch

In `checkOrphanedReviewStatuses` re-dispatch block, before calling `dispatchParallelReview`:

```typescript
setReviewStatus(issueId, {
  reviewRetryCount: (status.reviewRetryCount ?? 0) + 1,
  recoveryStartedAt: status.recoveryStartedAt || new Date().toISOString(),
});
```

#### B.3 Reset `reviewRetryCount` on successful review completion

In `review-agent.ts` `dispatchParallelReview` `.then()` block:

```typescript
setReviewStatus(opts.issueId, {
  reviewStatus: reviewResultToReviewStatus(result.reviewResult),
  reviewNotes: result.notes,
  reviewRetryCount: 0, // Reset on success
  recoveryStartedAt: undefined,
});
```

### C. Frontend: Kanban Card Recovery Indicators

#### C.1 Update `isReviewPipelineStuck` in `src/dashboard/frontend/src/lib/pipeline-state.ts`

Current (line 16–29):
```typescript
export function isReviewPipelineStuck(status?: PipelineStateLike | null): boolean {
  if (!status) return false;
  return (
    status.mergeStatus === 'failed' ||
    status.reviewStatus === 'failed' ||
    status.reviewStatus === 'blocked' ||
    // ...
  );
}
```

**Change:** Add detection for stuck infrastructure failure:
```typescript
export function isReviewPipelineStuck(status?: PipelineStateLike | null): boolean {
  if (!status) return false;
  return (
    status.mergeStatus === 'failed' ||
    status.reviewStatus === 'failed' ||
    status.reviewStatus === 'blocked' ||
    status.testStatus === 'failed' ||
    status.testStatus === 'dispatch_failed' ||
    status.inspectStatus === 'failed' ||
    status.uatStatus === 'failed' ||
    status.verificationStatus === 'failed' ||
    // PAN-794: infrastructure-failure stuck
    (status as any).stuck === true
  );
}
```

#### C.2 Add recovery indicator helpers to `KanbanBoard.tsx`

In the `IssueCard` component, after the `isPipelineStuck` check (line ~2166):

```typescript
// PAN-794: Recovery state indicators
const isRecoveryInProgress = !isTerminal && (reviewStatus as any)?.stuckReason === 'review_infrastructure_failure';
const recoveryRetryCount = (reviewStatus as any)?.reviewRetryCount ?? 0;
const isPermanentlyStuck = (reviewStatus as any)?.stuck === true;
```

#### C.3 Add pulsing border and recovery badge to the card

The card root element currently has (around line ~2370):
```typescript
<div
  ref={cardRef}
  onClick={onSelect}
  className={`relative ... bg-gradient-to-br ${cardTone} ...`}
>
```

**Change:** Add conditional classes for recovery state:

```typescript
const recoveryBorderClass = isRecoveryInProgress && !isPermanentlyStuck
  ? 'border-2 border-destructive animate-[pulse_2s_ease-in-out_infinite]'
  : isPermanentlyStuck
    ? 'border-2 border-destructive'
    : '';
```

And in the card's className:
```typescript
className={`relative ... bg-gradient-to-br ${cardTone} ${recoveryBorderClass} ...`}
```

#### C.4 Add recovery badge in the card header

In the card header where badges are rendered (around the phase label area, line ~2170), add:

```typescript
{isRecoveryInProgress && !isPermanentlyStuck && (
  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium badge-bg-destructive text-destructive-foreground animate-pulse">
    <Loader2 className="w-2.5 h-2.5 animate-spin" />
    Recovery {recoveryRetryCount}/3
  </span>
)}
{isPermanentlyStuck && (
  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium badge-bg-destructive text-destructive-foreground">
    <AlertTriangle className="w-2.5 h-2.5" />
    Stuck — manual review
  </span>
)}
```

#### C.5 Update `phaseLabel` to show recovery state

Current (line 2168–2174):
```typescript
const phaseLabel =
  canonical === 'backlog' ? 'Backlog' :
  // ...
  canonical === 'in_review' ? (isReadyToMerge ? 'Awaiting merge' : isPipelineStuck ? 'Needs recovery' : 'Review pipeline') :
  // ...
```

**Change:**
```typescript
const phaseLabel =
  canonical === 'backlog' ? 'Backlog' :
  canonical === 'todo' ? 'Ready to start' :
  canonical === 'in_progress' ? (isRunning ? 'Agent active' : 'Work paused') :
  canonical === 'in_review' ? (
    isReadyToMerge ? 'Awaiting merge' :
    isPermanentlyStuck ? 'Stuck — manual review needed' :
    isRecoveryInProgress ? `Recovering review (${recoveryRetryCount}/3)` :
    isPipelineStuck ? 'Needs recovery' :
    'Review pipeline'
  ) :
  canonical === 'done' ? 'Completed' :
  'Canceled';
```

#### C.6 Style compliance

All badge classes use existing Panopticon Tailwind tokens:
- `badge-bg-destructive` — red background for error/stuck states
- `text-destructive-foreground` — white text on red
- `animate-pulse` — Tailwind built-in pulse animation
- `animate-[pulse_2s_ease-in-out_infinite]` — custom pulse for border (matches existing `AgentBadge` conflict animation)
- `Loader2` with `animate-spin` — matches existing loading spinner pattern in `tasksChip`

No new CSS files or custom colors are needed.

### D. `packages/contracts/src/types.ts`

#### D.1 Add new fields to `ReviewStatusSnapshot`

```typescript
export interface ReviewStatusSnapshot {
  // ... existing fields ...
  /** PAN-794: number of consecutive review re-dispatch attempts */
  reviewRetryCount?: number;
  /** PAN-794: timestamp when deacon started recovery */
  recoveryStartedAt?: string;
  /** PAN-794: whether the workspace is stuck */
  stuck?: boolean;
  /** PAN-794: reason workspace is stuck */
  stuckReason?: string;
  /** PAN-794: timestamp when workspace was marked stuck */
  stuckAt?: string;
  /** PAN-794: JSON details about the stuck event */
  stuckDetails?: string;
}
```

> **Note:** `stuck`, `stuckReason`, `stuckAt`, `stuckDetails` already exist on `ReviewStatus` (added in PAN-653). Verify they are also present on `ReviewStatusSnapshot` for the frontend. If not, add them.

### E. Tests

#### E.1 Unit test: `isInfrastructureFailure`

```typescript
describe('isInfrastructureFailure', () => {
  it('returns true for ECONNREFUSED', () => {
    expect(isInfrastructureFailure('API Error: Unable to connect to API (ECONNREFUSED)')).toBe(true);
  });
  it('returns true for tmux buffer error', () => {
    expect(isInfrastructureFailure('tmux load-buffer: No such file or directory')).toBe(true);
  });
  it('returns false for code issue', () => {
    expect(isInfrastructureFailure('Missing null check in issues.ts')).toBe(false);
  });
});
```

#### E.2 Unit test: circuit breaker in `checkOrphanedReviewStatuses`

Mock review status with 3 failed history entries containing infrastructure errors. Verify that:
1. `stuck` is set to `true`
2. `stuckReason` is `'review_infrastructure_failure'`
3. No re-dispatch occurs

#### E.3 Unit test: `checkStuckReviewing` with dead parallel sessions

Mock:
- `reviewStatus: 'reviewing'`
- `reviewSpawnedAt` = 35 minutes ago
- tmux session exists but `ps` shows `S+` with etime >10 min

Verify:
- Status is reset to `pending`
- Action message includes "Reset stuck reviewing status"

#### E.4 Frontend test: recovery badge renders

Render `IssueCard` with `reviewStatus` having `stuckReason: 'review_infrastructure_failure'` and `reviewRetryCount: 2`.

Verify:
- Badge text is "Recovery 2/3"
- Card has pulsing border class

---

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| False positive: killing a legitimate long review | 30-minute threshold + process activity check (not just session existence) |
| `ps` command fails or is unavailable | Graceful fallback: if `ps` fails, treat session as inactive (safer to reset than to leave stuck) |
| `isProcessActive` heuristic is wrong | Future improvement: read tmux pane content for Claude prompt string |
| Circuit breaker triggers too early | Threshold is 3 cycles over 6 history entries — requires sustained failure pattern |
| `reviewRetryCount` not reset on manual restart | Reset in `dispatchParallelReview` success path AND when work agent re-submits |
| UI badge clutter on already-busy kanban card | Badges are small (text-[10px]), only shown on `in_review` cards, and use existing color tokens |
| Border pulse is visually distracting | Only pulses during active recovery (not when permanently stuck); uses subtle 2s pulse |

---

## Acceptance Criteria

- [ ] `checkStuckReviewing` detects dead parallel review sessions (sleeping >10 min at prompt)
- [ ] After 3 infrastructure-failure cycles, `stuck: true` is set with `stuckReason: 'review_infrastructure_failure'`
- [ ] Deacon re-dispatch path skips stuck workspaces
- [ ] `reviewRetryCount` increments on each re-dispatch and resets on success
- [ ] When `verificationStatus === 'passed'` + `stuckReason === 'review_infrastructure_failure'`, review is bypassed to `passed`
- [ ] Kanban card shows "Recovery N/3" badge with pulsing border during active recovery
- [ ] Kanban card shows "Stuck — manual review" badge (no pulse) when permanently stuck
- [ ] All new code has unit tests
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm test` passes

---

## Files Modified

- `src/lib/cloister/deacon.ts`
- `src/lib/cloister/review-agent.ts`
- `src/lib/review-status.ts`
- `src/dashboard/frontend/src/lib/pipeline-state.ts`
- `src/dashboard/frontend/src/components/KanbanBoard.tsx`
- `packages/contracts/src/types.ts` (if `ReviewStatusSnapshot` is missing stuck fields)
- `src/lib/cloister/__tests__/deacon.test.ts` (add new tests)
- `src/dashboard/frontend/src/lib/__tests__/pipeline-state.test.ts` (add new tests)
- `src/dashboard/frontend/src/components/__tests__/KanbanBoard.test.tsx` (add new tests)
