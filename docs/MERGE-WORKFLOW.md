# Merge Workflow

Overdeck's merge workflow is a two-actor pipeline: the **dashboard server**
and **GitHub** (or the configured forge). Agents participate in
implementation, review, and test. The dashboard owns the merge decision and
deterministic rebase; a work agent joins only when a rebase needs conflict
resolution. Nothing here is a stored pipeline status — merge readiness is
computed live from the PR, its checks, and the forge's own mergeability
verdict, every time it's asked.

> **Scope.** This describes the **per-issue** merge — one feature, one click. While
> a Flywheel run with the merge train enabled is active, the primary path is
> **promoting a UAT batch** (merging several tested features at once). The
> per-issue flow below remains the escape hatch (the "Merge one feature to
> main…" control) and the path for everything outside an active batch-train
> run. A batch assembles only when **two or more** features are ready
> (PAN-3965): a one-member batch is byte-identical to the PR branch and its CI
> run a duplicate, so a single ready feature always merges directly through
> this flow (Merge button / `gh pr merge`). The Merge train page says so:
> "1 feature ready — merges directly; batches assemble when 2+ are ready".

## Flow

1. **Work agent calls `pan done`** on a clean tree. The work-agent role
   prompt refuses `pan done` from a dirty worktree. `pan done` runs quality
   gates (typecheck and lint on the host; the test suite runs once, on CI, for
   a `verification.tests: ci` project — see
   [PIPELINE-GATES.md](PIPELINE-GATES.md#one-full-suite-run-per-push-on-ci-pan-3965)),
   rebases onto the target branch and pushes, opens or updates the PR
   and marks it ready, moves the tracker to In Review, and finally POSTs
   `/api/review/<id>/request` — the same request `pan review request` makes,
   through the same helper
   ([`src/cli/commands/request-review.ts`](../src/cli/commands/request-review.ts)).
   That request is what starts verification and, when it passes, the review
   convoy. A dashboard that cannot be reached prints
   `Review not started (dashboard unreachable): run pan review request <id>`
   and `pan done` still exits 0 — the PR and the tracker are already updated,
   so re-running `pan done` is never the fix.
2. **A PR opened or readied by hand gets the same pipeline.** The GitHub
   webhook handler starts it on `opened` and `ready_for_review` when the PR is
   not a draft, the repository is tracked and the head branch maps to an issue
   ([`src/lib/webhook-handlers.ts`](../src/lib/webhook-handlers.ts)). It reaches
   the dashboard's starter through the registry in
   [`src/lib/cloister/request-review-pipeline.ts`](../src/lib/cloister/request-review-pipeline.ts),
   never by importing a route, and `requestReviewPipeline.isInFlight` coalesces
   it with the request `pan done` just made. The webhook path logs and returns
   on every failure — it never throws.
3. **Review and test.** The four reviewer roles (correctness, security,
   performance, requirements) post PR reviews — approve or request changes.
   Verification (typecheck, lint, tests) runs as check runs on the PR.
   "Ready" is derived, not stored: approvals in, checks green, forge reports
   `mergeable: true`.
4. **Human clicks the dashboard Merge button** (or `gh pr merge`). The
   dashboard:
   - Merges a GitHub-clean PR directly when its head already contains the
     required base and checks are complete.
   - Otherwise runs `rebaseFeatureBranch(workspacePath, featureBranch, baseBranch)`
     ([`src/lib/cloister/merge-rebase.ts`](../src/lib/cloister/merge-rebase.ts))
     and pushes with `--force-with-lease`.
   - Escalates real conflicts to the work agent for resolution — the server
     never invents a conflict resolution.
   - Calls `gh pr merge --squash` once the branch is clean, then runs the
     post-merge handoff (below).

## Merge-executor escalation

1. **GitHub-clean PR:** `mergeable: true`, `mergeableState: clean`, no
   pending/failed checks, non-draft open PR → squash-merge through the forge
   adapter directly. Work-agent liveness does not affect this path.
2. **Server-side rebase:** branch needs its target branch → `rebaseFeatureBranch()`
   + push with `--force-with-lease`.
3. **Agent conflict resolution:** deterministic rebase reports conflicts →
   engage the work agent, wait for the resolved branch to be pushed. A
   non-conflict workspace failure uses the same path since the agent may be
   able to repair the workspace.

Content failures — red CI, a closed or draft PR, unresolved conflicts — are
visible directly on the PR; there is no separate failure status to set.

## Review freshness

A review verdict is a PR review against a specific commit. A push after
approval is visible on the PR itself (GitHub marks the approval stale on
some branch-protection configs, or the new commits simply postdate the
review) — there is no separate "stale" flag to maintain; `pan done` or
`pan review request` triggers the re-review directly.

## Single Merge Oracle

The forge's own review/merge state is the only oracle. GitHub repositories
read the PR's `mergedAt` / `mergeCommit` fields directly; other configured
forges use their adapter's merged-artifact lookup. A polyrepo issue is
complete only when every required repository is merged or change-free and
at least one repository has positive merged-artifact evidence — an
all-change-free result is not proof a merge occurred. There is no inferred
ancestor-of-main or diff fallback; both were sources of "the oracles
disagree" bugs (PAN-1024, May 2026).

A repeated Merge click re-reads the merge set from the forge before acting.
Repositories the forge already reports merged or skipped are excluded from
rebase, verification, and merge calls; a partially merged issue processes
only its unmerged repositories.

## Polyrepo completeness blocker

`unmerged_sibling_repo` means a required sibling repository still has
commits on its feature branch but the forge shows no merged PR/MR for them.
The issue stays unmerged even when the tracker repository's own PR is
already merged.

The blocker appears on the dashboard merge-blockers surface. It names the
repository, source branch, target branch, and ahead count. Recover by
creating and merging the missing PR/MR in that repository, then retry the
merge. If a configured repository is intentionally read-only and should
never participate in issue merges, set `readonly: true` on that entry under
`workspace.repos` in `projects.yaml` — do not mark a writable code
repository read-only to bypass a real stranded branch.

## After another feature merges

A merge does not trigger a background scan of sibling branches. An open
feature branch advances only when its work agent or operator explicitly
runs `pan sync-main <id>`, which brings the branch forward to current
`main` and surfaces any real conflict for the work agent to resolve. If CI
fails after the merge, treat the failing check as the evidence: fix it and
let review/verification run again — nothing here is silently re-dispatched.

## Stash Discipline

The merge workflow does not create stashes. Agents never run `git stash`.
The single supported stash kind is `salvageable:`, which only humans create
when preserving uncommitted work they want to recover later. See the
"Stash Discipline" section of `/home/eltmon/.overdeck/context/global.md`
for the full rule.

## Post-merge handoff and Docker cleanup

The merge agent's post-merge handoff
([`src/lib/cloister/merge-agent.ts`](../src/lib/cloister/merge-agent.ts)) is
non-destructive: it pauses the work/planning/strike agents and closes their
terminals, closes the review/test/uat specialists' terminals, preserves
workspace/branches/xBRIEF, and removes the workspace's Docker containers and
`overdeck-feature-<issue>_devnet` network. Terminals close through the terminal
backend (`closeAgentPane` / `closeIssuePanes` in
[`src/lib/terminal-backends/launch.ts`](../src/lib/terminal-backends/launch.ts)):
`kill-session` on tmux, `pane.close` on Herdr. A tmux-only kill left every Herdr
pane alive, and close-out's DoD row 5 then failed on "running agents" (PAN-3947). This must run **at most once per
merge** — a concurrency guard prevents the handoff from re-triggering itself
(a missing guard caused a 24,626-call tracker API loop, PAN-328).

Docker cleanup happens at merge time because orphaned networks from merged
workspaces accumulate and eventually block new workspace creation ("all
predefined address pools have been fully subnetted" — Docker's default pool
supports ~31 bridge networks). NEVER remove this cleanup step.

The durable, verified teardown owner is **close-out**: `pan close <id>` /
dashboard Close Out stops and removes the remaining workspace Docker stack,
verifies the network is gone, completes the xBRIEF, archives planning
artifacts, and closes the tracker issue per `close_out` config. Host
hygiene (orphaned Docker networks/containers, stale worktrees, disk
pressure) also runs from a plain interval scheduler independent of any
issue's merge — check `pan workspace list --stale [--all]` for merged
branches still on disk and reclaim with `pan workspace destroy <id>`.

Close-out prunes only regenerable agent-directory weight: `pending.lock`,
`*.sock`, and each `codex-home*/` entry except `sessions/`. It keeps
`state.json`, the append-only `sessions.json` index, lifecycle and activity
logs, context receipts, Codex thread IDs, and every transcript. Explicit wipe,
garbage collection, and retention remain the destructive cleanup paths.
The ceremony runs no agent-row garbage collection of its own (PAN-3968 removed
the `close-out:prune-agent-rows` step); the paths that delete `state.json` are
deep-wipe, `pan admin db gc-agents`, the startup legacy-row sweep
(`dropLegacyAgentStatesMissingRoleAsync`), review-agent purge, and swarm reset
— all of them route through `removeAgentStateDir`. Transcript retention
deletes only `*.jsonl` transcripts and keeps `state.json`.

When the merge-train flag (`flywheel.merge_train_enabled`, default off) is
ON, a merge-train reconcile pass rebases/re-verifies ready sibling branches
(PAN-1691); with the flag off, reconcile an affected workspace explicitly
with `pan sync-main <id>` before it proceeds through review or merge. The
UAT reconciler (`src/lib/cloister/uat-reconciler.ts`) assembles a batch only
for 2+ ready features; with exactly one it returns `single-feature` and
builds nothing, even on a forced rebuild.

## What This Replaces

This design supersedes the multi-actor "ship-role" pipeline removed in
PAN-1531 (an LLM agent spawned in a dedicated tmux session to rebase, run
verification, push, and flip a stored ready flag) — retired because rebase
conflict resolution is deterministic mechanical work, not something an LLM
should improvise, and the ship-role's own verification gates duplicated the
test specialists'. It was further simplified in PAN-3917 ("The Overdeck
Cut"): merge readiness is now read live from the PR/checks/forge instead of
mirrored into a pipeline record, and Deacon's patrol-driven reconciliation
of merge state was replaced by direct forge reads at the moment they're
needed.

## References

- [PAN-1531](https://github.com/eltmon/overdeck/issues/1531) — the ship-role removal
- [PAN-632](https://github.com/eltmon/overdeck/issues/632) — in-process rebase
- [PAN-1024](https://github.com/eltmon/overdeck/issues/1024) — the three-oracle disagreement bug
- [PAN-3917](https://github.com/eltmon/overdeck/issues/3917) — The Overdeck Cut; see [`THE-CUT.md`](./THE-CUT.md)
- [`src/lib/cloister/merge-rebase.ts`](../src/lib/cloister/merge-rebase.ts) — server-side rebase
- [`src/lib/cloister/merge-agent.ts`](../src/lib/cloister/merge-agent.ts) — merge-button handler and post-merge handoff
- [`src/lib/stashes.ts`](../src/lib/stashes.ts) — canonical `salvageable:` stash builder and parser
