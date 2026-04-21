# PRD: Stuck Parallel Review Detection, Recovery, and UI Indicators (PAN-794)

> **Revision:** incorporates feedback from
> `PAN-794-stuck-review-detection-recovery-opus47-feedback.md`.
>
> Feedback resolution (see inline `**FIX (feedback §N)**` callouts for details):
>
> 1. **Breaker/reset mismatch** → breaker now uses `recoveryStartedAt` as an
>    explicit cycle boundary; history older than the boundary is ignored (§A.3, §B.3).
> 2. **`manual_retry` history status** → dropped. Recovery goes through the
>    existing unstick route, which writes a plain `reviewStatus: 'pending'`
>    history entry (§G.1).
> 3. **`markWorkspaceStuck` typing** → pass a `Record<string, unknown>` directly,
>    not `JSON.stringify({...})` (§A.3).
> 4. **Endpoint overlap with unstick** → no new endpoint. `processUnstickRequest`
>    is extended to handle `review_infrastructure_failure` and skip the git-repair
>    precondition for non-git stuck reasons (§G.1, Files Modified).
> 5. **Liveness check aggressiveness** → explicitly secondary, bounded by the
>    breaker, threshold via `REVIEW_LIVENESS_MAX_SILENCE_MS` (§G.3).
> 6. **Session-cleanup ownership** → ownership matrix pinned down; no actor
>    kills sessions it does not own; every actor tolerates missing sessions (§G.2).
> 7. **`stuckReason` driving copy** → the "Review infra failed" badge renders only
>    for `stuckReason === 'review_infrastructure_failure'` and is mutually exclusive
>    with `DivergedBadge` (§E.2–E.5).
> 8. **Path typos** → all references now use `src/lib/cloister/review-agent.ts`
>    and `src/lib/cloister/deacon.ts`.

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
- If 2 of 4 sub-agents complete successfully but the others crash, `selectCompletedReviewers` in `runParallelReview` returns `null` and synthesis is aborted.
- PAN-569's security agent found 4 real issues, but the batch was lost because performance crashed.

### Problem 5: `stuck` flag is never checked in re-dispatch path
- `checkOrphanedReviewStatuses` re-dispatch path (line ~1324+) never checks `status.stuck`.
- Even if something is marked stuck, deacon keeps spawning new reviews.

### Problem 6: No cycle boundary for the circuit breaker
- A history-based breaker (counting infra failures in the last 6 `review`-type entries)
  keeps seeing failures from *earlier* cycles even after the work agent pushes a fix.
- `reviewRetryCount` alone cannot solve this — resetting the counter does not erase
  history rows that the breaker is still counting.
- Without an explicit cycle boundary, the reset logic is cosmetic: an issue with 2 old
  infra failures + 1 new one will still trip the breaker after a fresh commit.

### Problem 7: No UI indication that recovery is happening
- The kanban card shows "Needs recovery" in the phase label, but there's no visual distinction between "recovery in progress" and "permanently stuck needs human help."
- Users can't tell if deacon is actively retrying or if the issue has given up.

### Problem 8: Multiple actors can manipulate the same review tmux sessions
- `runParallelReview` already kills prior `review-<issue>-<timestamp>-*` sessions at
  the start of a fresh run (review-agent.ts:583–600).
- This PRD adds two more actors: the breaker kills sessions when it trips, and
  `checkStuckReviewing` may decide a session is dead based on `pane_last_activity`.
- Without explicit ownership rules these actors can race — e.g. the liveness check
  decides a session is stuck, resets to pending, orphan recovery re-dispatches,
  stale-session cleanup in the new `runParallelReview` kills the still-live run.

---

## Solution Overview

### Backend: Deacon stuck detection

1. **Detect dead parallel sessions** — Check if `reviewSpawnedAt` is old AND tmux sessions exist but their Claude processes are sleeping at a prompt or crashed.
2. **Detect infrastructure-failure cycling** — After 3 consecutive infrastructure-failure cycles, mark `stuck: true` with `stuckReason: 'review_infrastructure_failure'`.
3. **Honor the `stuck` flag** — Skip re-dispatch in all patrol paths when `status.stuck === true`.
4. **Partial results** — If some sub-agents complete and others crash, pass partial results to synthesis instead of aborting entirely.

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
  ];
  return infraPatterns.some((p) => p.test(notes));
}
```

> **CRITICAL FIX:** Removed `/protocol failure/i` from the pattern list. "Protocol failure" is ambiguous and could match legitimate code review findings about protocol implementations (e.g., "HTTP protocol failure handling is missing"). The remaining patterns are unambiguous infrastructure errors.

#### A.2 Enhance `checkStuckReviewing` to detect dead parallel sessions

Current logic (deacon.ts:1641–1691):
- Checks `getAllProjectSpecialistStatuses()` + global `review-agent`
- Does **not** verify whether parallel review tmux sessions have an active Claude process

**Change:**
1. Also call `getActiveParallelReviewIssues(allSessions)`.
2. For each active parallel issue, verify the session's root process is actually alive (not sleeping at a prompt for >10 min).
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
    s.match(new RegExp(`^review-${issueId}-\d+-`))
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
    const { stdout } = await execAsync(`tmux list-panes -t ${sessionName} -F "#{pane_pid}"`);
    const pid = parseInt(stdout.trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

async function isProcessActive(pid: number): Promise<boolean> {
  try {
    // Check if process has used CPU in last 60s (not sleeping at prompt)
    // etime format: [[dd-]hh:]mm:ss — we parse it to total minutes
    const { stdout } = await execAsync(`ps -p ${pid} -o pid,stat,etime`);
    const lines = stdout.trim().split('\n');
    if (lines.length < 2) return false;
    const parts = lines[1].trim().split(/\s+/);
    const stat = parts[1] || '';
    const etime = parts[2] || '';

    // Parse etime to total minutes
    let totalMinutes = 0;
    if (etime.includes('-')) {
      const [days, rest] = etime.split('-');
      totalMinutes = parseInt(days, 10) * 24 * 60;
      const timeParts = rest.split(':');
      if (timeParts.length === 3) {
        totalMinutes += parseInt(timeParts[0], 10) * 60 + parseInt(timeParts[1], 10);
      } else if (timeParts.length === 2) {
        totalMinutes += parseInt(timeParts[0], 10);
      }
    } else {
      const timeParts = etime.split(':');
      if (timeParts.length === 3) {
        // hh:mm:ss
        totalMinutes = parseInt(timeParts[0], 10) * 60 + parseInt(timeParts[1], 10);
      } else if (timeParts.length === 2) {
        // mm:ss
        totalMinutes = parseInt(timeParts[0], 10);
      }
    }

    // 'S+' = sleeping, foreground; if etime is >10min and still S+, likely stuck
    if (stat.includes('S') && totalMinutes > 10) return false;
    return true;
  } catch {
    return false;
  }
}
```

> **CRITICAL FIX:** `isProcessActive` now correctly parses `ps etime` format `[[dd-]hh:]mm:ss`. The original PRD incorrectly assumed `mm:ss` format only, which would break for processes running >1 hour (e.g., `01:23:45` would parse as 1 minute instead of 83 minutes).
>
> **NOTE:** `execAsync` is the existing promisified `exec` already imported at the top of `deacon.ts` (line 20). Do NOT import it from `../tmux.js` — that module does not export `execAsync`.

#### A.3 Add infrastructure-failure circuit breaker

In `checkOrphanedReviewStatuses`, before the re-dispatch block (around line 1324):

```typescript
// Circuit breaker: after 3 infrastructure-failure review cycles WITHIN THE CURRENT
// recovery window, mark stuck and stop re-dispatching to prevent token burn.
//
// The cycle boundary is `recoveryStartedAt`. It is set when the first re-dispatch
// begins, cleared on any of:
//   - successful review completion (review-agent.ts .then)
//   - new commits detected by checkPostReviewCommits
//   - manual retry via the dashboard unstick flow
// Clearing recoveryStartedAt forces the breaker to re-read history from scratch,
// so old infra failures cannot poison a new recovery window.
const recoveryBoundary = status.recoveryStartedAt
  ? new Date(status.recoveryStartedAt).getTime()
  : 0;

const infraFailureCount = (status.history ?? [])
  .filter((h) =>
    h.type === 'review' &&
    h.status === 'failed' &&
    new Date(h.timestamp).getTime() >= recoveryBoundary &&
    isInfrastructureFailure(h.notes),
  )
  .length;

if (infraFailureCount >= 3) {
  // markWorkspaceStuck is the authoritative helper; it takes a structured
  // Record<string, unknown>, not a pre-stringified string. The helper calls
  // dbMarkStuck which persists the JSON into review_status.stuck_details.
  const { markWorkspaceStuck } = await import('../review-status.js');
  markWorkspaceStuck(issueId, 'review_infrastructure_failure', {
    infraFailures: infraFailureCount,
    recoveryStartedAt: status.recoveryStartedAt,
    lastNote: (status.history ?? []).filter(h => h.type === 'review').slice(-1)[0]?.notes?.slice(0, 500),
  });
  actions.push(
    `Marked ${issueId} stuck: review_infrastructure_failure (${infraFailureCount} infra failures since ${status.recoveryStartedAt ?? 'unknown'})`,
  );
  // Kill any lingering review sessions owned by the breaker (see §G "Session
  // ownership"). Non-fatal on error — orphan cleanup will eventually reap them.
  try {
    const { listSessionNamesAsync, killSessionAsync } = await import('../tmux.js');
    const { getActiveParallelReviewIssues } = await import('./review-agent.js');
    const allSessions = await listSessionNamesAsync();
    if (getActiveParallelReviewIssues(allSessions).has(issueId.toUpperCase())) {
      const escaped = issueId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`^review-${escaped}-\\d+-`, 'i');
      await Promise.all(
        allSessions.filter(s => pattern.test(s)).map(s => killSessionAsync(s).catch(() => undefined)),
      );
    }
  } catch (err) {
    console.error(`[deacon] Breaker session cleanup for ${issueId} failed:`, err);
  }
  continue;
}
```

> **FIX (feedback §1):** The original breaker counted history entries regardless of
> when they happened, so resetting `reviewRetryCount` had no effect on the breaker.
> Using `recoveryStartedAt` as an explicit cycle boundary makes the reset behavior
> load-bearing: clearing the timestamp discards the history window the breaker sees.
>
> **FIX (feedback §3):** `markWorkspaceStuck` expects
> `details?: Record<string, unknown>` (review-status.ts:404). Passing an object
> directly (not a stringified JSON payload) matches the helper surface.

> **NOTE:** The circuit breaker depends on `status.history` being populated. Verify that `dispatchParallelReview` logs history entries on failure. If it does not, the circuit breaker will never trigger. The review-agent.ts `.catch()` block at line 855–858 sets `reviewStatus: 'pending'` but does NOT append to history. **This must be fixed:**
>
> ```typescript
> // In review-agent.ts dispatchParallelReview .catch():
> setReviewStatus(opts.issueId, {
>   reviewStatus: 'pending',
>   history: [
>     ...(existingStatus.history || []),
>     { type: 'review', status: 'failed', timestamp: new Date().toISOString(), notes: err.message },
>   ],
> });
> ```

#### A.4 Honor `stuck` flag in re-dispatch path

At the top of the re-dispatch block (deacon.ts line ~1324):

```typescript
// PAN-794: Skip stuck workspaces to prevent infinite re-dispatch loops
if (status.stuck) {
  actions.push(`Skipped pending review for ${issueId}: workspace is stuck (${status.stuckReason})`);
  continue;
}
```

#### A.5 ~~Detect verification/review contradiction~~ — REMOVED

The original A.5 auto-flipped `reviewStatus` to `passed` whenever verification had
passed and review infrastructure had failed. This is **not safe**:

- Verification only runs typecheck/lint/test; it does not catch the security,
  architecture, and requirements-coverage classes of defect that the review agents
  exist to find.
- Flipping review → passed on a mechanical infrastructure condition ships unreviewed
  code to `readyForMerge`, violating the project rule in `CLAUDE.md`: *"Never work
  around broken things — fix them."*
- A total review-infra outage (Anthropic API down, tmux misconfiguration, etc.)
  would cause the whole queue to auto-approve.

Recovery for `review_infrastructure_failure` goes through the existing unstick
route instead — see §G below.

#### A.6 Partial results from incomplete parallel reviews

In `src/lib/cloister/review-agent.ts`, modify `selectCompletedReviewers`:

```typescript
export function selectCompletedReviewers(
  results: ReviewerOutcome[],
  allowPartial = false,
): Array<{ role: string; outputFile: string }> | null {
  const completed = results.filter(r => r.status === 'completed');
  if (completed.length === 0) return null;
  if (!allowPartial) {
    const failed = results.filter(r => r.status === 'failed');
    if (failed.length > 0) return null;
  }
  return completed.map(r => ({ role: r.role, outputFile: r.outputFile }));
}
```

Then in `runParallelReview`, change Phase 3:

```typescript
// ── Phase 3: Synthesis ────────────────────────────────────────────────────
const completedReviewers = selectCompletedReviewers(reviewerResults, /* allowPartial */ true);
if (!completedReviewers) {
  const failed = reviewerResults.filter(r => r.status === 'failed').map(r => r.role);
  console.warn(`[review-agent] Aborting synthesis — all reviewer(s) failed or timed out: ${failed.join(', ')}`);
  return {
    result: {
      success: false,
      reviewResult: 'COMMENTED',
      notes: `Review aborted: all reviewer(s) failed or timed out (${failed.join(', ')}). Resubmit to retry.`,
      output: `Review ${reviewId}`,
    },
    reviewId,
  };
}

// Log which reviewers were incomplete so synthesis can note it
const incompleteReviewers = reviewerResults
  .filter(r => r.status !== 'completed')
  .map(r => r.role);
if (incompleteReviewers.length > 0) {
  console.warn(`[review-agent] Partial review: ${incompleteReviewers.join(', ')} failed; synthesizing with ${completedReviewers.length} reviewers`);
}
```

And append a note to the synthesis context about incomplete reviewers:

```typescript
const incompleteNote = incompleteReviewers.length > 0
  ? `\n**Note:** The following reviewers did not complete due to errors: ${incompleteReviewers.join(', ')}. Synthesis is based on partial findings.`
  : '';

const reviewerOutputsList = completedReviewers
  .map(r => `- **${r.role}**: ${r.outputFile}`)
  .join('\n');

const synthContextHeader = [
  `# Synthesis Context\n`,
  reviewerContext,
  `**Output file**: ${synthOutputFile}`,
  `\n## Reviewer Output Files\n${reviewerOutputsList}${incompleteNote}`,
  `\n---\n`,
].join('\n');
```

> **CRITICAL FIX:** The original PRD suggested modifying `runParallelReview` without showing how to pass the partial-completeness information into synthesis. The synthesis agent needs to KNOW that results are partial, otherwise it may incorrectly conclude "no security issues found" when the security reviewer actually crashed. The context header now explicitly lists missing reviewers.

### B. `src/lib/review-status.ts`

#### B.1 Add new fields to `ReviewStatus` interface

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

In `checkOrphanedReviewStatuses` re-dispatch block, after `dispatchParallelReview` succeeds:

```typescript
const { dispatchParallelReview } = await import('./review-agent.js');
try {
  await dispatchParallelReview({ issueId, workspace, branch });
  // dispatchParallelReview sets reviewStatus='reviewing' internally;
  // keep local status in sync so this patrol doesn't re-process the issue.
  status.reviewStatus = 'reviewing';
  // Increment retry count ONLY on successful dispatch
  setReviewStatus(issueId, {
    reviewRetryCount: (status.reviewRetryCount ?? 0) + 1,
    recoveryStartedAt: status.recoveryStartedAt || new Date().toISOString(),
  });
  actions.push(
    `Re-dispatched pending review for ${issueId} (deacon-orphan-recovery, attempt ${(status.reviewRetryCount ?? 0) + 1})`,
  );
  // ...
} catch (err) {
  // Do NOT increment retry count on dispatch failure — the review never started
  actions.push(
    `Failed to re-dispatch pending review for ${issueId}: ${err instanceof Error ? err.message : String(err)}`,
  );
}
```

> **CRITICAL FIX:** The original PRD incremented `reviewRetryCount` BEFORE calling `dispatchParallelReview`. If dispatch fails (e.g., workspace unavailable), the count is incremented but no review was actually attempted. This makes the circuit breaker trigger prematurely. Increment ONLY after successful dispatch.

#### B.3 Reset recovery window on clean completion and on new commits

A clean review completion closes the current recovery window. So does the work
agent pushing new commits — the old cycle is definitionally over once the code
under review has changed. Both paths must clear BOTH `reviewRetryCount` **and**
`recoveryStartedAt`, because the breaker (§A.3) reads `recoveryStartedAt` as its
cycle boundary and counter-only resets are cosmetic.

In `review-agent.ts` `dispatchParallelReview` `.then()` block:

```typescript
.then(result => {
  setReviewStatus(opts.issueId, {
    reviewStatus: reviewResultToReviewStatus(result.reviewResult),
    reviewNotes: result.notes,
    reviewRetryCount: 0,
    recoveryStartedAt: undefined, // closes the breaker window
  });
  // ...
})
```

In `deacon.ts` `checkPostReviewCommits` — when a new HEAD is detected past
`reviewedAtCommit`, the current recovery window is over:

```typescript
setReviewStatus(issueId, {
  reviewStatus: 'pending',
  // ... existing fields ...
  reviewRetryCount: 0,
  recoveryStartedAt: undefined,
});
```

> **FIX (feedback §1):** Both reset points clear `recoveryStartedAt`. Without this,
> the breaker's history window still contains infra failures from before the commit
> that fixed them, and the breaker would trip on the first new infra failure.

### C. Database schema changes (`src/lib/database/schema.ts` + `src/lib/database/review-status-db.ts`)

#### C.1 Add migration in `schema.ts`

```typescript
// v24 → v25: add review_retry_count and recovery_started_at columns (PAN-794)
if (currentVersion < 25) {
  try { db.exec(`ALTER TABLE review_status ADD COLUMN review_retry_count INTEGER DEFAULT 0`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE review_status ADD COLUMN recovery_started_at TEXT`); } catch { /* already exists */ }
}
```

#### C.2 Update `upsertReviewStatus` in `review-status-db.ts`

Add `review_retry_count` and `recovery_started_at` to the INSERT/ON CONFLICT columns and parameter list.

#### C.3 Update `rowToReviewStatus` in `review-status-db.ts`

Map `review_retry_count` → `reviewRetryCount` and `recovery_started_at` → `recoveryStartedAt`.

> **CRITICAL FIX:** The original PRD completely omitted database changes. Since review statuses are SQLite-authoritative (PAN-653), any new fields MUST be added to the schema, upsert, and row-mapping code or they will be silently lost on write.

### D. `packages/contracts/src/types.ts`

#### D.1 Add new fields to `ReviewStatusSnapshot`

```typescript
export const ReviewStatusSnapshot = Schema.Struct({
  // ... existing fields ...
  /** PAN-794: number of consecutive review re-dispatch attempts */
  reviewRetryCount: Schema.optional(Schema.Number),
  /** PAN-794: timestamp when deacon started recovery */
  recoveryStartedAt: Schema.optional(Schema.String),
  /** PAN-653: whether the workspace is stuck */
  stuck: Schema.optional(Schema.Boolean),
  /** PAN-653: reason workspace is stuck */
  stuckReason: Schema.optional(Schema.String),
  /** PAN-653: timestamp when workspace was marked stuck */
  stuckAt: Schema.optional(Schema.String),
  /** PAN-653: JSON details about the stuck event */
  stuckDetails: Schema.optional(Schema.String),
  // ... rest of fields ...
})
```

> **NOTE:** Verify `stuck`, `stuckReason`, `stuckAt`, `stuckDetails` are already present (added in PAN-653). If missing, add them. The new PAN-794 fields are `reviewRetryCount` and `recoveryStartedAt`.

### E. Frontend: Kanban Card Recovery Indicators

#### E.1 Update `isReviewPipelineStuck` in `src/dashboard/frontend/src/lib/pipeline-state.ts`

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
    (status as PipelineStateLike & { stuck?: boolean }).stuck === true
  );
}
```

> **FIX:** Use a typed intersection instead of `any`. The stuck fields are already in the contract type, so cast through an intersection type for type safety.

#### E.2 Add recovery indicator helpers to `KanbanBoard.tsx`

In the `IssueCard` component, after the `isPipelineStuck` check:

```typescript
// PAN-794: Recovery state indicators
// `stuck === true` with reason 'main_diverged' is already owned by DivergedBadge
// (KanbanBoard.tsx:2784–2791). This PRD's badges must only render for the
// review_infrastructure_failure reason to avoid duplicate/conflicting UI.
const isReviewInfraStuck =
  !isTerminal &&
  reviewStatus?.stuck === true &&
  reviewStatus?.stuckReason === 'review_infrastructure_failure';

const recoveryRetryCount = reviewStatus?.reviewRetryCount ?? 0;

// "Recovery in progress" = breaker window is open (recoveryStartedAt set) AND
// we have not yet given up (stuck !== true). This is driven by the runtime
// state the breaker actually uses, not by stuckReason, which is only set
// AFTER the breaker trips.
const isReviewRecoveryInProgress =
  !isTerminal &&
  reviewStatus?.stuck !== true &&
  (reviewStatus?.reviewRetryCount ?? 0) > 0 &&
  (reviewStatus?.reviewStatus === 'reviewing' || reviewStatus?.reviewStatus === 'pending');
```

> **FIX (feedback §7):** The "Manual review" badge is gated on
> `stuckReason === 'review_infrastructure_failure'` so it never co-renders with
> `DivergedBadge`. A `main_diverged` stuck workspace continues to use the existing
> divergence badge at KanbanBoard.tsx:2784–2791.
>
> **FIX:** Recovery-in-progress is driven by `reviewRetryCount > 0 && !stuck`.
> The original "`stuckReason === 'review_infrastructure_failure'`" guard was
> unreachable because that reason only sets when `stuck === true`, which the
> guard excludes — a logical contradiction.

#### E.3 Add recovery border and badges to the card

The card root element (around line ~2370):

```typescript
const recoveryBorderClass = isReviewRecoveryInProgress
  ? 'border-2 border-warning animate-pulse'
  : isReviewInfraStuck
    ? 'border-2 border-destructive'
    : '';
```

And in the card's className:
```typescript
className={`relative ... bg-gradient-to-br ${cardTone} ${recoveryBorderClass} ...`}
```

> **FIX:** Uses warning-tone border for recovery-in-progress (yellow = "deacon is
> working on it") and destructive-tone border for infra-stuck (red = "gave up,
> human needed"). The original used red for both, which defeats the point of
> distinguishing them. Reverted to the built-in `animate-pulse`; no custom
> keyframe arbitrary values required.

#### E.4 Add recovery badge in the card header

In the card header where badges are rendered:

```typescript
{isReviewRecoveryInProgress && (
  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium badge-bg-warning text-warning-foreground animate-pulse">
    <Loader2 className="w-2.5 h-2.5 animate-spin" />
    Recovery {recoveryRetryCount}/3
  </span>
)}
{isReviewInfraStuck && (
  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium badge-bg-destructive text-destructive-foreground">
    <AlertTriangle className="w-2.5 h-2.5" />
    Review infra failed
  </span>
)}
```

The existing `DivergedBadge` continues to render for `stuck === true &&
stuckReason === 'main_diverged'`. The two badges are mutually exclusive by
`stuckReason`, so a card will never show both.

#### E.5 Update `phaseLabel` to show recovery state

```typescript
const phaseLabel =
  canonical === 'backlog' ? 'Backlog' :
  canonical === 'todo' ? 'Ready to start' :
  canonical === 'in_progress' ? (isRunning ? 'Agent active' : 'Work paused') :
  canonical === 'in_review' ? (
    isReadyToMerge ? 'Awaiting merge' :
    isReviewInfraStuck ? 'Review infra failed — manual retry' :
    isReviewRecoveryInProgress ? `Recovering review (${recoveryRetryCount}/3)` :
    isPipelineStuck ? 'Needs recovery' :
    'Review pipeline'
  ) :
  canonical === 'done' ? 'Completed' :
  'Canceled';
```

#### E.6 Style compliance

All badge classes use existing Panopticon Tailwind tokens:
- `badge-bg-destructive` — red background for error/stuck states
- `text-destructive-foreground` — white text on red
- `animate-pulse` — Tailwind built-in pulse animation
- `animate-[pulse_2s_ease-in-out_infinite]` — custom pulse for border (matches existing `AgentBadge` conflict animation)
- `Loader2` with `animate-spin` — matches existing loading spinner pattern

No new CSS files or custom colors are needed.

### F. Tests

#### F.1 Unit test: `isInfrastructureFailure`

```typescript
describe('isInfrastructureFailure', () => {
  it('returns true for ECONNREFUSED', () => {
    expect(isInfrastructureFailure('API Error: Unable to connect to API (ECONNREFUSED)')).toBe(true);
  });
  it('returns true for tmux buffer error', () => {
    expect(isInfrastructureFailure('tmux load-buffer: No such file or directory')).toBe(true);
  });
  it('returns false for code issue mentioning protocol', () => {
    // Regression: original PRD had /protocol failure/i which matched legitimate findings
    expect(isInfrastructureFailure('HTTP protocol failure handling is incomplete in errors.ts')).toBe(false);
  });
  it('returns false for code issue', () => {
    expect(isInfrastructureFailure('Missing null check in issues.ts')).toBe(false);
  });
});
```

#### F.2 Unit test: circuit breaker in `checkOrphanedReviewStatuses`

Mock review status with 3 failed history entries containing infrastructure errors. Verify that:
1. `stuck` is set to `true`
2. `stuckReason` is `'review_infrastructure_failure'`
3. No re-dispatch occurs
4. `reviewRetryCount` is NOT incremented (dispatch never happened)

#### F.3 Unit test: `checkStuckReviewing` with dead parallel sessions

Mock:
- `reviewStatus: 'reviewing'`
- `reviewSpawnedAt` = 35 minutes ago
- tmux session exists but `ps` shows `S+` with etime `00:15:00`

Verify:
- Status is reset to `pending`
- Action message includes "Reset stuck reviewing status"

#### F.4 Unit test: `isProcessActive` etime parsing

Verify correct parsing of:
- `15` → 15 minutes
- `05:30` → 5 minutes
- `01:23:45` → 83 minutes
- `2-03:45:00` → 3147 minutes (2 days + 3h45m)

#### F.5 Frontend test: recovery and infra-stuck badges

Render `IssueCard` with `reviewStatus` having
`{ reviewStatus: 'reviewing', stuck: false, reviewRetryCount: 2, recoveryStartedAt: <now - 5min> }`.

Verify:
- "Recovery 2/3" badge rendered (warning tone), pulsing.
- "Review infra failed" badge NOT rendered.
- `DivergedBadge` NOT rendered.
- Phase label is "Recovering review (2/3)".

Render `IssueCard` with `reviewStatus` having
`{ stuck: true, stuckReason: 'review_infrastructure_failure', reviewRetryCount: 3 }`.

Verify:
- "Review infra failed" badge rendered (destructive tone), no pulse.
- "Recovery" badge NOT rendered.
- `DivergedBadge` NOT rendered.
- Phase label is "Review infra failed — manual retry".

Render `IssueCard` with `reviewStatus` having
`{ stuck: true, stuckReason: 'main_diverged' }`.

Verify:
- `DivergedBadge` rendered (existing behavior preserved).
- Neither of the PAN-794 badges rendered.

#### F.6 Unit test: breaker honors recovery window boundary

Seed history with 5 failed infra entries whose timestamps are older than
`recoveryStartedAt`. Verify the breaker does NOT trip (count is 0 within the
window). Then append 3 failed infra entries after `recoveryStartedAt`; verify
the breaker trips.

#### F.7 Unit test: unstick route resets recovery window

Seed status with
`{ stuck: true, stuckReason: 'review_infrastructure_failure', reviewRetryCount: 3, recoveryStartedAt: <old> }`.
Call `processUnstickRequest` with `workspaceExists: true`, `gitSafeState: false`.
Verify the route returns 200 (not 409) because git state is irrelevant for this
stuck reason, and verify the atomic reset clears `stuck*`, `reviewRetryCount`,
and `recoveryStartedAt`.

### G. Recovery flow, session ownership, liveness caveats

#### G.1 Reuse existing unstick route — do NOT add a new endpoint

The dashboard already has `POST /api/workspaces/:issueId/unstick`
(workspaces.ts:3127–3145) and its exported core `processUnstickRequest`
(workspaces.ts:3066–3103). For PAN-653's `main_diverged` it:

1. Verifies workspace exists.
2. Verifies `stuck === true`.
3. Verifies `git rev-list origin/main..main --count === 0` (operator ran
   `git reset --hard origin/main`).
4. Atomically clears `stuck/stuckReason/stuckAt/stuckDetails` and resets
   `reviewStatus`, `testStatus`, `mergeStatus`, `readyForMerge`, `reviewedAtCommit`.

`review_infrastructure_failure` does NOT need a git precondition — the workspace
HEAD is fine; the infrastructure was flaky. Extend the existing route rather than
add a new one:

```typescript
// workspaces.ts processUnstickRequest — skip git check for non-git stuck reasons
const reason = currentStatus?.stuckReason;
const requiresGitRepair = reason === 'main_diverged' || reason === undefined;
if (requiresGitRepair && !gitSafeState) {
  return { httpStatus: 409, body: { success: false, error: /* existing message */ } };
}
```

Also extend the atomic reset payload to clear the PAN-794 recovery fields so
the breaker window starts fresh after an unstick:

```typescript
setReviewStatusBase(issueId, {
  // ... existing reset fields ...
  reviewRetryCount: 0,
  recoveryStartedAt: undefined,
});
```

The dashboard's existing Unstick button (UI already wired to this route) becomes
the one-and-only human recovery affordance for PAN-794 as well. No new endpoint.
No `manual_retry` pseudo-status is written to history — the existing unstick path
produces a normal `reviewStatus: 'pending'` history entry, which every consumer
of review history already understands.

> **FIX (feedback §2):** The earlier draft proposed
> `{ type: 'review', status: 'manual_retry', notes: ... }`. That invents a new
> review-history status that no consumer handles — the terminal-status matcher
> at deacon.ts:1268 only knows `passed|failed|blocked`. Dropping the pseudo-status
> in favor of a plain `pending` entry avoids the need to audit every history
> consumer.
>
> **FIX (feedback §4):** No new endpoint. The existing unstick route is the
> single recovery path; the PRD extends it rather than forking a second flow.

#### G.2 Session ownership

Three actors now touch `review-<issue>-<timestamp>-<role>` tmux sessions. To avoid
races, each has an explicit scope:

| Actor | May kill | Must tolerate |
|------|----------|---------------|
| `runParallelReview` (src/lib/cloister/review-agent.ts:583–600) | Sessions whose `<issue>` matches the review it is about to start. Kills **before** spawning the new batch. | Already-missing sessions (session was killed by deacon between patrols). |
| Breaker cleanup in `checkOrphanedReviewStatuses` (§A.3) | Sessions for the one `<issue>` the breaker just marked stuck in this iteration. | Already-missing sessions; killed-then-respawned sessions (would be caught next patrol). |
| `cleanupOrphanedReviewSessions` (src/lib/cloister/deacon.ts, existing) | Sessions whose work agent is no longer running, for any issue. | Unchanged from today. |

`checkStuckReviewing` never kills sessions. It only decides whether to reset a
`reviewing` status back to `pending` — the ensuing kill-and-respawn belongs to
`runParallelReview` or to the breaker.

> **FIX (feedback §6):** Ownership is spelled out. Every actor tolerates missing
> sessions; no actor kills sessions it does not own.

#### G.3 Liveness-check caveats

`isReviewSessionLive` (via `tmux pane_last_activity`) is a **secondary** signal,
not a primary recovery driver:

- It is consulted only inside `checkStuckReviewing` to decide whether the 30-min
  `reviewSpawnedAt` heartbeat timeout applies.
- A false negative (declaring a live session dead) resets `reviewing → pending`;
  the next patrol re-dispatches; `runParallelReview` kills prior sessions before
  spawning new ones, so at worst we pay one wasted dispatch.
- Long quiet periods are possible during GitHub API waits, synthesis without
  streaming output, and permission prompts. The 10-minute silence threshold is
  tuned for the common case. Make it configurable via a module-level constant
  (`REVIEW_LIVENESS_MAX_SILENCE_MS`) so we can tune without redeploying logic.
- With the breaker in place, a pathological liveness false-positive loop is
  bounded: at most 3 spurious re-dispatches before the breaker marks the issue
  stuck and recovery lands in the human's hands.

> **FIX (feedback §5):** Liveness is explicitly secondary and bounded by the
> breaker. Threshold is a named constant, not a magic number. Failure modes
> (long syntheses, API waits) are documented.

---

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| False positive: killing a legitimate long review | 30-minute threshold + process activity check (not just session existence) |
| `ps` command fails or is unavailable | Graceful fallback: if `ps` fails, treat session as inactive (safer to reset than to leave stuck) |
| `isProcessActive` heuristic is wrong | `etime` parsing handles all `ps` formats; future improvement: read tmux pane content for Claude prompt string |
| Circuit breaker triggers too early | Threshold is 3 infra failures over last 6 review entries; requires sustained pattern; count only increments on successful dispatch |
| `reviewRetryCount` not reset on manual restart | Reset in `dispatchParallelReview` success path AND when work agent re-submits |
| UI badge clutter on already-busy kanban card | Badges are small (text-[10px]), only shown on `in_review` cards, and use existing color tokens |
| Border pulse is visually distracting | Only pulses during active recovery (not when permanently stuck); uses subtle 2s pulse |
| Database schema drift | Migration adds columns idempotently; row-mapping code handles null → undefined correctly |
| Partial synthesis misses findings from crashed reviewers | Synthesis context explicitly lists which reviewers were incomplete, so the synthesis agent knows findings are partial |

---

## Acceptance Criteria

- [ ] `checkStuckReviewing` detects dead parallel review sessions (sleeping >10 min at prompt)
- [ ] After 3 infrastructure-failure cycles, `stuck: true` is set with `stuckReason: 'review_infrastructure_failure'`
- [ ] Deacon re-dispatch path skips stuck workspaces
- [ ] `reviewRetryCount` increments on each successful re-dispatch and resets on success
- [ ] `reviewRetryCount` does NOT increment if `dispatchParallelReview` throws
- [ ] Breaker counts only infra failures whose `timestamp >= recoveryStartedAt` (cycle boundary)
- [ ] `recoveryStartedAt` is cleared on clean completion, new commits, and unstick
- [ ] The existing `POST /api/workspaces/:issueId/unstick` route handles `review_infrastructure_failure` without requiring git repair
- [ ] No new history status values are introduced (no `manual_retry`)
- [ ] The "Review infra failed" badge renders only when `stuckReason === 'review_infrastructure_failure'` and never co-renders with `DivergedBadge`
- [ ] Kanban card shows "Recovery N/3" badge with pulsing border during active recovery
- [ ] Kanban card shows "Stuck — manual review" badge (no pulse) when permanently stuck
- [ ] `runParallelReview` synthesizes partial results when some sub-agents crash (instead of aborting)
- [ ] Synthesis context explicitly notes which reviewers were incomplete
- [ ] All new code has unit tests
- [ ] Database migration added for `review_retry_count` and `recovery_started_at`
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm test` passes

---

## Files Modified

- `src/lib/cloister/deacon.ts`
- `src/lib/cloister/review-agent.ts`
- `src/lib/review-status.ts`
- `src/lib/database/schema.ts`
- `src/lib/database/review-status-db.ts`
- `src/dashboard/frontend/src/lib/pipeline-state.ts`
- `src/dashboard/frontend/src/components/KanbanBoard.tsx`
- `packages/contracts/src/types.ts`
- `src/dashboard/server/routes/workspaces.ts` — extend `processUnstickRequest` to skip
  the git-safe-state check when `stuckReason !== 'main_diverged'`, and include
  `reviewRetryCount: 0` + `recoveryStartedAt: undefined` in the atomic reset.
- `src/lib/cloister/__tests__/deacon.test.ts` (add new tests)
- `src/lib/cloister/__tests__/review-agent.test.ts` (add partial-synthesis test)
- `src/dashboard/server/routes/__tests__/workspaces.unstick.test.ts` (extend)
- `src/dashboard/frontend/src/lib/__tests__/pipeline-state.test.ts` (add new tests)
- `src/dashboard/frontend/src/components/__tests__/KanbanBoard.test.tsx` (add new tests)
