# PRD: Merge System Architectural Refactor (PAN-632)

## Problem Statement

The merge pipeline has five systemic issues discovered during Operation Fix-All:

1. **Specialist session killing**: `spawnEphemeralSpecialist` kills the in-flight specialist when the merge queue dequeues the next merge. The queue serializes `triggerMerge()` but the specialist system doesn't know about the queue.
2. **In-memory queue lost on restart**: `_mergeQueues` Map in `workspaces.ts:3002` is volatile. Server restarts (including from the post-merge deploy script) lose all queued state.
3. **Double PR merge race**: The specialist prompt (`merge-agent.ts:1538`) runs `gh pr merge --squash`, AND `triggerMerge` (`workspaces.ts:3401-3406`) also runs `gh pr merge --squash`. Both race to merge the same PR.
4. **Polling-based completion**: `spawnRebaseAgentForBranch` polls every 5s for git remote HEAD changes. `spawnMergeAgentForBranches` polls every 5s for local HEAD changes. `syncMainIntoWorkspace` polls tmux output every 5s for MERGE_RESULT markers. All fragile, latency-prone, miss fast completions.
5. **Specialist is overkill for rebase**: The rebase specialist prompt is just 5 git commands and 1 gh command — no AI reasoning needed. An entire Claude Code session (cost, startup time, tmux slot) for commands that `execAsync` handles in milliseconds.

Additional bug: **`_serverManagedMerges` split-brain** — `workspaces.ts:83` defines a local Set, while `specialists.ts:111` exports a separate one. The polyrepo guard in `/api/specialists/done` is broken.

## Design: In-Process Rebase + SQLite Queue

### Architecture

```
MERGE click
→ SQLite queue check (persistent, survives restart)
→ rebaseFeatureBranch() — in-process execAsync, no specialist
→ If conflicts → notify work agent directly, dequeue next
→ runVerificationForIssue() — typecheck/lint/test
→ Report commit statuses on post-rebase HEAD
→ Single gh pr merge --squash — no double-merge race
→ Mark completed in DB, dequeue next
→ postMergeLifecycle()
```

For remaining specialist use cases (conflict resolution), replace polling with Promise-based event-driven completion.

## Implementation Phases

### Phase 1: Schema + DB Module (pure addition)

**`src/lib/database/schema.ts`** — v14 migration:

```sql
CREATE TABLE IF NOT EXISTS merge_queue (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_key TEXT NOT NULL,
  issue_id    TEXT NOT NULL UNIQUE,
  position    INTEGER NOT NULL,
  queued_at   TEXT NOT NULL,
  started_at  TEXT,
  status      TEXT NOT NULL DEFAULT 'queued'
);
CREATE INDEX IF NOT EXISTS idx_merge_queue_project
  ON merge_queue(project_key, status, position);
```

**NEW `src/lib/database/merge-queue-db.ts`**:
- `enqueueMerge(projectKey, issueId): number` — returns position
- `dequeueMerge(projectKey): string | null` — returns next issueId
- `markMergeProcessing(projectKey, issueId): void`
- `getCurrentMerge(projectKey): string | null`
- `removeMerge(issueId): void`
- `getQueueForProject(projectKey): MergeQueueEntry[]`
- `getAllActiveQueues(): { projectKey, current, queue }[]`
- `resetProcessingToQueued(): number` — startup recovery

### Phase 2: In-Process Rebase

**NEW `src/lib/cloister/merge-rebase.ts`**:

```typescript
export interface RebaseResult {
  success: boolean;
  skipped?: boolean;
  conflictFiles?: string[];
  reason?: string;
  newHead?: string;
}

export async function rebaseFeatureBranch(
  workspacePath: string,
  featureBranch: string,
  baseBranch: string,
  issueId: string,
): Promise<RebaseResult>
```

Steps: fetch → check if behind → remove .planning/ → rebase → push --force-with-lease. On conflict: abort and return conflict files.

### Phase 3: Event-Driven Specialist Completion

**NEW `src/lib/cloister/specialist-completion.ts`**:
- `waitForSpecialistCompletion(issueId, timeoutMs): Promise<Result>`
- `reportSpecialistCompletion(issueId, result): boolean`

In-memory Map of pending Promises. `/api/specialists/done` calls `reportSpecialistCompletion` to resolve. Timeout rejects.

### Phase 4: Rewire triggerMerge + Fix _serverManagedMerges

**`src/dashboard/server/routes/workspaces.ts`**:
- Remove: `_serverManagedMerges` local Set, `_mergeQueues` Map, `getOrCreateMergeQueue()`, `dequeueNextMerge()`
- Import `_serverManagedMerges` from `specialists.ts` (single source of truth)
- Replace `spawnRebaseAgentForBranch` with `rebaseFeatureBranch`
- Replace in-memory queue with DB functions
- Single `gh pr merge` — no specialist does it anymore

### Phase 5: Wire Event-Driven Completion Into Specialists

**`src/dashboard/server/routes/specialists.ts`**: Add `reportSpecialistCompletion` call in `/api/specialists/done` for merge specialist.

**`src/lib/cloister/merge-agent.ts`**: Replace polling in `spawnMergeAgentForBranches` and `syncMainIntoWorkspace` with `await waitForSpecialistCompletion()`.

### Phase 6: Startup Recovery + Cleanup

**`src/dashboard/server/main.ts`**: Call `resetProcessingToQueued()` on startup, resume pending merges.

**`src/lib/review-status.ts`**: Don't clear `queued` status — DB handles it.

**`src/lib/cloister/merge-agent.ts`**: Delete `spawnRebaseAgentForBranch` (replaced by merge-rebase.ts).

## Files Modified

| File | Change |
|------|--------|
| `src/lib/cloister/merge-rebase.ts` | **NEW** — In-process rebase |
| `src/lib/cloister/specialist-completion.ts` | **NEW** — Promise-based completion |
| `src/lib/database/merge-queue-db.ts` | **NEW** — SQLite queue operations |
| `src/lib/database/schema.ts` | Add merge_queue table (v14 migration) |
| `src/dashboard/server/routes/workspaces.ts` | Replace in-memory queue + specialist with DB + in-process |
| `src/dashboard/server/routes/specialists.ts` | Wire reportSpecialistCompletion; fix _serverManagedMerges |
| `src/lib/cloister/merge-agent.ts` | Remove spawnRebaseAgentForBranch; replace polling |
| `src/dashboard/server/main.ts` | Startup recovery |
| `src/lib/review-status.ts` | Adjust clearStuckMergeStatuses |

## What This Removes

- `spawnRebaseAgentForBranch()` — replaced by `rebaseFeatureBranch()`
- In-memory `_mergeQueues` Map — replaced by SQLite
- 5s polling loops — replaced by event-driven
- Double `gh pr merge` race — single merge point
- Specialist session for simple git rebase — in-process
- `_serverManagedMerges` split-brain — single exported Set

## Acceptance Criteria

1. Click MERGE on 5 issues rapidly → first starts, rest show QUEUED with DB-backed position
2. First merge completes → second starts automatically from DB
3. Kill server mid-queue → restart → queue resumes from DB
4. Rebase with conflicts → work agent notified immediately, no specialist wasted
5. No specialist session spawned for standard rebase merge
6. `GET /api/merge-queue` returns persistent queue state
7. `_serverManagedMerges` guard works for polyrepo merges
8. `npm run typecheck && npm run lint && npm test` pass
