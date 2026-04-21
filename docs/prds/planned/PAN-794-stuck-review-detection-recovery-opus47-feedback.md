# PAN-794 review feedback

I reviewed `docs/prds/planned/PAN-794-stuck-review-detection-recovery-opus47.md` against the current code in:
- `src/lib/cloister/deacon.ts`
- `src/lib/cloister/review-agent.ts`
- `src/lib/review-status.ts`
- `packages/contracts/src/types.ts`
- `src/dashboard/frontend/src/lib/pipeline-state.ts`
- `src/dashboard/frontend/src/components/KanbanBoard.tsx`
- `src/dashboard/server/routes/workspaces.ts`

Overall: the PRD is directionally solid and much better grounded than the original, but there are a few implementation concerns that should be fixed before anyone codes from it.

## 1. The breaker logic and the reset logic do not match

The PRD says the circuit breaker should trip based on **review history** (`last 6 review entries`, `3 infra failures`) and separately says `reviewRetryCount` should reset on new commits so stale failures do not poison later cycles.

Those two ideas conflict.

### Why this is a problem

In current code, `setReviewStatus()` appends review status transitions into history and keeps the last 10 entries: `src/lib/review-status.ts:133-148`.

The PRD’s breaker counts history entries, not `reviewRetryCount`: `docs/prds/planned/PAN-794-stuck-review-detection-recovery-opus47.md:221-236`.

So if an issue has:
- 2 infra-failure review cycles,
- then the work agent pushes a new commit,
- then 1 more infra-failure review cycle,

`reviewRetryCount` may be reset, but the **history still contains 3 infra failures in the last 6 review entries**, so the issue will still be marked stuck.

That directly contradicts the PRD’s intent in `C.4`: `docs/prds/planned/PAN-794-stuck-review-detection-recovery-opus47.md:450-464`.

### Recommendation

Pick one source of truth:
- either make the breaker use `reviewRetryCount`, or
- keep the breaker history-based but define an explicit **cycle boundary** on new commits/manual retry/clean completion and only count failures after that boundary.

As written, the reset behavior is mostly cosmetic.

## 2. `manual_retry` does not fit the current history type

The PRD proposes recording:

```ts
{ type: 'review', status: 'manual_retry', notes: '<user trigger>' }
```

See `docs/prds/planned/PAN-794-stuck-review-detection-recovery-opus47.md:601-604`.

### Why this is a problem

Current history entries are free-form strings in storage, but the code paths that reason about them only know the existing status values. More importantly, the PRD never updates any schema or helper logic to account for `manual_retry`.

Relevant places:
- `src/lib/review-status.ts:16-21`
- `src/lib/review-status.ts:136-146`
- `src/lib/cloister/deacon.ts:1234-1269`

Today, deacon logic looks for terminal review statuses like `passed`, `failed`, and `blocked`: `src/lib/cloister/deacon.ts:1268`.

### Recommendation

Either:
- do **not** write a new pseudo-status into history and instead log the action elsewhere, or
- explicitly define `manual_retry` as a supported review-history status and audit every consumer of review history.

Right now the PRD introduces a new history status without carrying that change through the rest of the system.

## 3. The `markWorkspaceStuck()` sample call is type-wrong

The PRD correctly says to use the existing helper instead of raw `setReviewStatus()`, but the sample call passes a JSON string as `details`:

```ts
markWorkspaceStuck(
  issueId,
  'review_infrastructure_failure',
  JSON.stringify({ ... }),
);
```

See `docs/prds/planned/PAN-794-stuck-review-detection-recovery-opus47.md:236-246`.

### Why this is a problem

`markWorkspaceStuck()` expects `details?: Record<string, unknown>` in current code: `src/lib/review-status.ts:401-405`.

So the PRD’s example is not aligned with the actual helper surface it is trying to preserve.

### Recommendation

Pass the object directly, not a pre-stringified payload.

## 4. The new retry endpoint overlaps heavily with the existing unstick flow

The PRD proposes a new endpoint:
- `POST /api/issues/:issueId/review/retry`

See `docs/prds/planned/PAN-794-stuck-review-detection-recovery-opus47.md:593-606`.

### Why this is a problem

There is already a stuck-recovery endpoint and semantics in the dashboard server:
- route: `src/dashboard/server/routes/workspaces.ts:3127-3145`
- core logic: `src/dashboard/server/routes/workspaces.ts:3048-3103`

That current flow:
- clears the stuck flag,
- resets lifecycle state,
- preserves a single recovery path for stuck workspaces.

Adding a second route for a different flavor of stuck state increases the chance that the UI and server drift into multiple overlapping recovery models.

### Recommendation

Decide whether review-infra stuck is:
- just another `stuckReason` handled by the existing unstick route, or
- a genuinely different recovery action.

If it is different, the PRD should explain **why the existing unstick path is insufficient**. Right now that rationale is missing.

## 5. `checkStuckReviewing()` may become too aggressive if tmux output pauses

The PRD adds a liveness heuristic based on `tmux pane_last_activity` with a 10-minute silence threshold.

See:
- `docs/prds/planned/PAN-794-stuck-review-detection-recovery-opus47.md:175-198`
- `docs/prds/planned/PAN-794-stuck-review-detection-recovery-opus47.md:275-295`

### Why this is a problem

Current `checkStuckReviewing()` only checks whether there is an active review session at all: `src/lib/cloister/deacon.ts:1641-1684`.

The PRD changes the meaning from:
- “session exists and is active”

to:
- “session produced pane output recently.”

That is probably better for true hangs, but it also means any legitimately quiet period in:
- long GitHub API waits,
- model-side stalls,
- synthesis without streaming output,
- permission waits,

can cause deacon to reset a still-live review back to pending.

The PRD argues synthesis should emit within 10 minutes, but that is an assumption, not something enforced by the current code path in `src/lib/cloister/review-agent.ts:697-721`.

### Recommendation

If you keep this heuristic, treat it as secondary cleanup only and make the threshold/configuration explicit. I would also avoid letting this path fight with the new breaker logic; otherwise you may get:
- session still alive,
- deacon resets to pending,
- orphan recovery re-dispatches,
- stale session cleanup kills the still-live run.

## 6. The PRD should call out interaction with stale-session cleanup in `runParallelReview()`

Current `runParallelReview()` already kills all prior `review-<issue>-<timestamp>-*` sessions before starting a new review:
- `src/lib/cloister/review-agent.ts:583-600`

### Why this matters

The PRD separately proposes:
- killing sessions when the breaker trips,
- probing session liveness in deacon,
- re-dispatching after failure.

That means there are now **multiple actors** manipulating the same review tmux sessions:
- `runParallelReview()` cleanup,
- deacon stuck-review detection,
- deacon breaker cleanup.

Without a clear ownership rule, it becomes hard to reason about races and logs.

### Recommendation

The PRD should explicitly state session ownership and expected race behavior. For example:
- deacon may kill only sessions for issues it just marked stuck,
- `runParallelReview()` may kill only older sessions before spawning a fresh run,
- both operations must tolerate already-missing sessions.

The code can probably handle that, but the PRD should acknowledge it.

## 7. The frontend copy and state model are good, but the PRD under-specifies how `stuckReason` should drive copy

The PRD correctly notes that `stuck` already exists and can mean other things like `main_diverged`.
See `docs/prds/planned/PAN-794-stuck-review-detection-recovery-opus47.md:681-682`.

### Why this is a problem

Current Kanban code already renders a divergence/stuck badge using the generic stuck fields:
- `src/dashboard/frontend/src/components/KanbanBoard.tsx:2784-2789`
- `src/dashboard/frontend/src/components/KanbanBoard.tsx:2024-2040`

The PRD adds a new generic `isPermanentlyStuck = reviewStatus?.stuck === true` path for in-review cards:
- `docs/prds/planned/PAN-794-stuck-review-detection-recovery-opus47.md:528-533`

If implemented naively, the same underlying stuck state may produce:
- a generic “Manual review” badge,
- the existing divergence badge/copy,
- or both.

### Recommendation

Specify whether the new card badge is:
- only for `stuckReason === 'review_infrastructure_failure'`, or
- for all stuck reasons in in-review,

and how it coexists with `DivergedBadge`.

## 8. Minor path/documentation mismatch

The PRD’s early audit note references `review-agent.ts` without the `cloister/` path segment, but the actual file is:
- `src/lib/cloister/review-agent.ts`

This is minor, but worth fixing so future readers do not grep the wrong path.

## Bottom line

The PRD’s core direction is good:
- add a breaker,
- preserve partial reviewer output,
- expose recovery state in the UI,
- stop auto-bypassing review.

But before implementation, I would tighten four things:
1. make the breaker/reset model internally consistent,
2. remove or fully define `manual_retry` in history,
3. reuse or clearly differentiate the existing unstick route,
4. specify the interaction between session-liveness checks and existing session cleanup.
