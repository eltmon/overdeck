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
