# Merge Workflow

Panopticon's merge workflow is a four-state pipeline between two actors: the
**dashboard server** and **GitHub**. Agents participate in the upstream work
(implementation, review, test) but no agent makes the merge decision and no
agent performs the rebase.

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

The only Panopticon component that mutates git state on the merge side. It:

- Runs `rebaseFeatureBranch(workspacePath, featureBranch, baseBranch)` from
  [`src/lib/cloister/merge-rebase.ts`](../src/lib/cloister/merge-rebase.ts)
  after review + test pass.
- Surfaces rebase conflicts to the dashboard UI with a "Resume in workspace"
  action — never auto-resolves.
- Calls `gh pr merge --squash` when the human clicks the Merge button.
- Runs `postMergeLifecycle()` after the squash succeeds — labels, agent pause,
  Docker cleanup, single-oracle merge verification.

### GitHub

Owns the actual ref movement on `origin/main`. The dashboard never pushes to
main directly — every change lands via squash-merge through GitHub's PR API.

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

If the rebase produces conflicts, the dashboard surfaces them with the
conflict file list and a "Resume in workspace" action. The work-agent or
operator resolves manually in the worktree, pushes, and the dashboard
re-attempts the rebase.

### merged

The human has clicked the dashboard Merge button. The dashboard calls
`gh pr merge --squash`, waits for GitHub to report success, then runs
`postMergeLifecycle()` to clean up: label transitions, Docker network
cleanup, agent pause, single-oracle merge verification via the GitHub PR API.

## Single Merge Oracle

`verifyMergedBeforeLifecycle()` checks one thing: the GitHub PR API's
`mergedAt` / `mergeCommit` fields. If the API answers definitively
(merged or not merged), we use that answer. If the API is unreachable or
returns uncertain state, we surface "Unable to verify merge state" to the
dashboard and the human decides whether to proceed with cleanup.

There is no ancestor-of-main heuristic and no diff-fallback. Both were sources
of "the oracles disagree" bugs (notably PAN-1024 in May 2026).

For non-GitHub projects (Linear with no GitHub remote), `verifyMerged` returns
uncertain and the operator confirms manually.

## Stash Discipline

The merge workflow does not create stashes. Agents never run `git stash`.
The single supported stash kind is `salvageable:`, which only humans create
when preserving uncommitted work they want to recover later.

See the "Stash Discipline" section of `/home/eltmon/.panopticon/context/global.md`
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

- [PAN-1531](https://github.com/eltmon/panopticon-cli/issues/1531) — this
  workflow simplification
- [PAN-632](https://github.com/eltmon/panopticon-cli/issues/632) — in-process
  rebase that replaced the ship-role git operations
- [PAN-1024](https://github.com/eltmon/panopticon-cli/issues/1024) — the
  three-oracle disagreement bug that motivated single-oracle verification
- [PAN-879](https://github.com/eltmon/panopticon-cli/issues/879) — the
  original stash taxonomy this workflow shrinks
- [`src/lib/cloister/merge-rebase.ts`](../src/lib/cloister/merge-rebase.ts)
  — server-side rebase implementation
- [`src/lib/cloister/merge-agent.ts`](../src/lib/cloister/merge-agent.ts)
  — `postMergeLifecycle()` and merge-button handler
- [`src/lib/stashes.ts`](../src/lib/stashes.ts) — canonical
  `salvageable:` stash builder and parser
