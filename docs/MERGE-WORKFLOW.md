# Merge Workflow

Overdeck's merge workflow is a four-state pipeline between two actors: the
**dashboard server** and **GitHub**. Agents participate in implementation,
review, and test. The dashboard owns the merge decision and deterministic
rebase; a work agent joins only when a rebase needs conflict resolution.

> **Scope.** This describes the **per-issue** merge — one feature, one click. While
> a Flywheel run with the merge train enabled is active, the primary path is
> **promoting a UAT batch** (merging several tested features at once); see
> [`UAT-BATCH-TRAINS.md`](./UAT-BATCH-TRAINS.md). The per-issue flow below remains
> the escape hatch (the "Merge one feature to main…" control) and the path for
> everything outside an active batch-train run. Merging a single feature this way
> invalidates the live batches and triggers a reassembly.

## State Machine

```
┌─────────────┐    work-agent     ┌─────────────┐
│             │  calls `pan done` │             │
│ work-done   │ ────────────────► │ review-     │
│             │  on a clean tree  │ passed      │
└─────────────┘                   └─────────────┘
       ▲                                  │
       │                                  │ review specialists
       │ dirty-tree                       │ + test specialists all
       │ refusal                          │ report PASS
       │                                  ▼
       │                          ┌─────────────┐
       │                          │             │
       │                          │ rebased     │
       │                          │             │
       │                          └─────────────┘
       │                                  │
       │                                  │ server-side
       │                                  │ rebaseFeatureBranch()
       │                                  │ + git push --force-with-lease
       │                                  ▼
       │                          ┌─────────────┐
       │     human clicks         │             │
       └─────────  ◄────  ─────── │ merged      │
            dashboard Merge       │             │
                                  └─────────────┘
                                          │
                                          │ gh pr merge --squash
                                          │ + postMergeLifecycle
                                          ▼
                                     GitHub squashes
                                     to origin/main
```

## Actors

### Dashboard server

The only Overdeck component that mutates git state on the merge side. It:

- Merges a GitHub-clean PR directly because its head already contains the
  required base and its required checks are complete.
- Otherwise runs `rebaseFeatureBranch(workspacePath, featureBranch, baseBranch)`
  from [`src/lib/cloister/merge-rebase.ts`](../src/lib/cloister/merge-rebase.ts).
- Escalates conflicts to the work agent for resolution; the server does not
  invent conflict resolutions.
- Calls `gh pr merge --squash` when the human clicks the Merge button.
- Runs `postMergeLifecycle()` after the squash succeeds — labels, agent pause,
  Docker cleanup, single-oracle merge verification.

### GitHub

Owns the actual ref movement on `origin/main`. The dashboard never pushes to
main directly — every change lands via squash-merge through GitHub's PR API.

## Merge-executor escalation

The per-issue merge executor uses this order:

1. **GitHub-clean PR:** When GitHub reports `mergeable: true`,
   `mergeableState: clean`, no pending or failed checks, and a non-draft open
   PR, the server skips rebase preparation and squash-merges through the forge
   adapter. Work-agent liveness does not affect this path.
2. **Server-side rebase:** For a branch that still needs its target branch, the
   server runs `rebaseFeatureBranch()` and pushes with `--force-with-lease`.
3. **Agent conflict resolution:** If the deterministic rebase reports conflicts,
   the server engages the work agent and waits for the resolved branch to be
   pushed. Non-conflict workspace failures use the same agent path because the
   agent may repair the workspace.

A transient preparation failure returns `retryable: true` and writes
`mergeStatus: queued`, so `readyForMerge` remains derivable from the passed
review, test, and verification verdicts. This includes a missing local
monorepo workspace, a non-conflict server-side rebase failure, an agent that
stops, and a live agent that times out without pushing. Content failures such
as red CI, a closed or draft PR, or unresolved conflicts remain non-retryable
and set `mergeStatus: failed`.

Pipeline verdicts belong to reviewed code, not to an agent session. Starting a
fresh or resumed work agent preserves earned verdicts while the current HEAD
matches `reviewedAtCommit`, including a proven-benign commit-anchor move. A
real code change, an unreadable anchor, or a missing passed-review anchor resets
the verdicts before new work starts.

## States

### work-done

The work agent has called `pan done`. The work-agent role prompt refuses
`pan done` from a dirty worktree, so this state guarantees the workspace
branch contains only committed work.

If the worktree is dirty at `pan done` time, the CLI returns non-zero with
three options surfaced to the agent or operator:

- **Commit** the changes with a meaningful message
- **Discard** the changes (requires typed `discard` confirmation)
- **Stash as salvageable** (creates a `salvageable:` stash for human review)

### review-passed

Review specialists (correctness, security, performance, requirements) and
test specialists have all reported PASS. The dashboard sees the terminal
review+test signals and proceeds to the rebase step automatically. The reactive
`shipping` lifecycle state is retained for phase display and merge-gate logic,
but it no longer spawns an agent.

### rebased

The dashboard server has run `rebaseFeatureBranch()` and pushed the rebased
branch to `origin/feature/<issue>` with `--force-with-lease`. The PR is now
fast-forwardable on top of current `origin/main`. The dashboard flips
`readyForMerge: true` on the review status, which renders the Merge button.

If the server-side rebase produces conflicts, the merge executor engages the
work agent with the conflict-resolution request and waits for a pushed branch.
If that path cannot finish, the dashboard keeps the conflict file list as a
non-retryable merge failure for operator recovery.

### merged

The human has clicked the dashboard Merge button. The dashboard asks each
repository's forge adapter to merge its PR or MR, waits for positive forge
evidence, then runs `postMergeLifecycle()` to clean up labels, Docker networks,
and agent sessions.

## After another feature merges

A merge does not trigger a background scan of sibling branches. An open feature
branch stays in its current pipeline state until its work agent or operator
explicitly runs `pan sync-main <id>`; that command brings the branch forward to
current `main` and exposes any real conflict for the work agent to resolve.

If the sync produces a conflict, resolve it in the feature workspace, commit and
push the rework, then request review again. If CI fails after the merge, treat
the failing check as the evidence: repair the reported code or test failure and
run the normal review and verification gates again. Neither case is inferred
from a historical marker or silently re-dispatched by the Deacon.

## Single Merge Oracle

The forge review artifact is the merge oracle. GitHub repositories read the
PR's `mergedAt` / `mergeCommit` fields. GitLab and other configured forges use
the adapter's merged-artifact lookup for the feature branch. A polyrepo issue
is complete only when every required repository is merged or change-free and
at least one repository has positive merged-artifact evidence. An all
change-free result is not proof that a merge occurred.

`verifyMergedBeforeLifecycle()` reads this evidence without writing state.
`observeForgeMergeState()` uses the same check during the Deacon patrol and
writes discovered per-repository merge truth through the merge-set write door.
Git or forge errors produce an `unverifiable` result, so the patrol leaves the
issue unchanged and retries on a later tick.

The Deacon also bounds `merging` and `verifying` states at 30 minutes. After
that age it checks the forge: confirmed complete work advances to post-merge
cleanup, unmerged work resets to `pending` with readiness derived from the
review, test, UAT, and verification gates, and unverifiable work remains
unchanged.

A repeated Merge click first refreshes the merge set from the forge. Repositories
already marked `merged` or `skipped` are excluded from rebase, verification, and
merge calls. A partially merged issue processes only its unmerged repositories;
a fully merged issue takes the existing "No changed repos remain" success path
and starts post-merge cleanup without another forge merge call.

There is no inferred ancestor-of-main or diff fallback for forge observation.
Both were sources of "the oracles disagree" bugs (notably PAN-1024 in May
2026). Explicit batch-promotion evidence remains separately verified by commit
ancestry in each repository.

## Polyrepo completeness blocker

`unmerged_sibling_repo` means a required sibling repository still has commits on
its feature branch but no merged review artifact proves those commits landed. The
issue remains unmerged even when the tracker repository's PR is already merged,
so a partial multi-repo feature cannot enter post-merge cleanup.

The blocker appears on the dashboard merge-blockers surface and in:

```bash
pan flywheel merge-blockers
```

The blocker summary names the repository, source branch, target branch, and ahead
count. Recover by creating and merging the missing PR or MR in that repository,
then retry the merge so Overdeck rediscovers the artifact. If the configured
repository is intentionally read-only and should never participate in issue
merges, set `readonly: true` on that entry under `workspace.repos` in
`projects.yaml`; do not mark a writable code repository read-only to bypass a real
stranded branch.

## Stash Discipline

The merge workflow does not create stashes. Agents never run `git stash`.
The single supported stash kind is `salvageable:`, which only humans create
when preserving uncommitted work they want to recover later.

See the "Stash Discipline" section of `/home/eltmon/.overdeck/context/global.md`
for the full rule.

## What This Replaces

This design supersedes the multi-actor "ship-role" pipeline removed in
PAN-1531. Prior to PAN-1531 the rebase was performed by an LLM agent
(`roles/ship.md`) spawned in a dedicated tmux session. The LLM agent
followed a prompt to rebase, run verification, push, and flip
`readyForMerge`. That design was retired because:

1. Rebase conflict resolution is deterministic mechanical work; LLM
   "creative" resolutions changed semantics.
2. The ship-role was an extra actor that added orchestration cost without
   adding value — the rebase is ~40 lines of typed TypeScript.
3. The verification gates the ship-role re-ran were redundant with the
   test specialists that had already passed.

PAN-1531 also retired three of four `CanonicalStashKind` values
(`pre-merge`, `pre-spawn`, `review-temp`), the three-oracle
merge-verification heuristic, and the silent dirty-worktree handling at
spawn and `pan done` time. The system trades implicit state movement for
explicit user choice; the merge workflow is now a state machine a new
contributor can read in one diagram.

## References

- [PAN-1531](https://github.com/eltmon/overdeck/issues/1531) — this
  workflow simplification
- [PAN-632](https://github.com/eltmon/overdeck/issues/632) — in-process
  rebase that replaced the ship-role git operations
- [PAN-1024](https://github.com/eltmon/overdeck/issues/1024) — the
  three-oracle disagreement bug that motivated single-oracle verification
- [PAN-879](https://github.com/eltmon/overdeck/issues/879) — the
  original stash taxonomy this workflow shrinks
- [`src/lib/cloister/merge-rebase.ts`](../src/lib/cloister/merge-rebase.ts)
  — server-side rebase implementation
- [`src/lib/cloister/merge-agent.ts`](../src/lib/cloister/merge-agent.ts)
  — `postMergeLifecycle()` and merge-button handler
- [`src/lib/stashes.ts`](../src/lib/stashes.ts) — canonical
  `salvageable:` stash builder and parser

## Post-merge lifecycle idempotency (moved from CLAUDE.md 2026-08-07)

The post-merge lifecycle must run **at most once per merge**. ("postMergeLifecycle" survives
only as a legacy label — `src/core/state-mapping.ts` — the merge agent owns the behavior.)
If it can re-trigger itself, you get an infinite loop — that once burned 24,626 tracker API
calls (PAN-328). The original loop was:
specialists/done → onMergeComplete → post-merge lifecycle → (re-trigger) → specialists/done.

This protection is now **structural, not advisory** — you don't have to remember
a rule:

- The concurrency guard is `createInFlightGuard()` in
  `src/lib/cloister/in-flight-guard.ts`, used by `firePostMergeLifecycle` in
  `src/dashboard/server/routes/specialists/shared.ts` (re-exported from
  `specialists.ts`). A second *concurrent* call for the same issue is a no-op.
- It is locked by `tests/unit/lib/cloister/in-flight-guard.test.ts`. **Weaken or
  delete the guard and that suite goes red** — that is the real protection.
- The lifecycle also checks `mergeStatus` / `_completedPostMerge`
  (defense-in-depth).

So the rule is just: if you touch the merge-completion path, keep that test
green. A red guard test means you've reopened the loop. Adding new work to the
post-merge path (e.g. a rolling re-rebase fan-out) is fine as long as it stays
idempotent and the test stays green.

A merge to `main` can make another open branch stale. When the merge-train flag
(`flywheel.merge_train_enabled`, default off) is ON, `runMergeTrainReconcile()` runs
inside the post-merge guard and rebases/re-verifies ready siblings (PAN-1691); with the
flag off, nothing acts on stale siblings automatically — reconcile an affected workspace
explicitly with `pan sync-main <id>` before it proceeds through review or merge.


## Post-merge verify handoff and Docker cleanup (moved from CLAUDE.md 2026-08-07)

The merge agent's post-merge handoff (`src/lib/cloister/merge-agent.ts`; the old
`postMergeLifecycle()` function no longer exists) is non-destructive. After
merge it marks the issue `verifying_on_main`, applies the `verifying-on-main` label,
pauses the work/planning agents, preserves workspace/state/xBRIEF/branches, and removes
the workspace Docker containers and `overdeck-feature-<issue>_devnet` network.

Docker cleanup still happens at merge time because orphaned networks from merged
workspaces accumulate and eventually block new workspace creation with "all predefined
address pools have been fully subnetted". Docker's default pool only supports ~31 bridge
networks. NEVER remove this cleanup step.

The durable, verified teardown owner is **close-out**: `pan close <id>` / dashboard
Close Out stops and removes the workspace Docker stack (including the
`overdeck-feature-<issue>_devnet` network) and verifies the network is gone. The deacon's
reaper is the backstop: it runs full `reapIssueResidue` cleanup for tracker-closed issues
and queues Docker-only teardown for merged-but-not-closed issues on a deduplicated serial
worker with retry backoff. Tracker-backed devnet closure checks run in batches of four. The worker revalidates canonical merged status before each
attempt, while a fresh merge-agent enqueue may use its just-verified merge for the first
retry if status persistence lags. Durable `mergeStep: post-merge-cleanup` marks an incomplete
handoff. Startup atomically claims the pending file and runs it in a supervised background
promise, so dashboard boot continues while the claim remains owned. Failure moves the claim to
a discoverable queued generation unless canonical status positively owns the retry; a newer
pending generation is never overwritten or discarded. Startup and patrol reclaim queued files
and claims whose owner PID is dead. Issue IDs are validated at the route and lock boundaries,
and the resolved lock path must remain inside the lifecycle lock directory. Completion records
`mergeStep: merged`. Patrol reconciliation prunes Docker retries that are
no longer eligible. The worker removes Compose
volumes, project-owned containers, and the leaked devnet while preserving workspace files,
branches, agents, sessions, state, and xBRIEF. The single `rebuildWorkspaceStack`
chokepoint no-ops for closed and merged issues, so patrols never recreate a terminal stack.

The destructive/non-reversible completion steps are owned by close-out, not merge:
`pan close <id>` / dashboard Close Out completes the xBRIEF, archives planning artifacts,
optionally tears down the workspace or deletes feature branches according to `close_out`
config, closes the tracker issue, and clears review status.

