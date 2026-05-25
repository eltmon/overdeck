# Flywheel State

Durable cumulative memory across Flywheel orchestrator runs. Status snapshots are ephemeral and live in `~/.panopticon/flywheel/`; this file is for facts that future runs should not have to rediscover.

## Substrate fixes

### Autonomous planning auto-promote (commit 861cf8baa, 2026-05-20, RUN-1)

**Problem.** Planning agents finished `pan plan finalize` (writes workspace `.pan/spec.vbrief.json` with `plan.status: "proposed"` plus beads) and then stopped, waiting for a human to click "Done" in the dashboard or run `pan plan done`. `roles/plan.md` explicitly told them to wait for the user. Under an autonomous Flywheel run nothing ever clicks Done, so planning agents sit forever — observed with PAN-1228 through PAN-1234 stuck for ~5h at session start.

**Fix.** `pan plan finalize` now chains to the dashboard's `complete-planning` endpoint by default (`--no-promote` opts out for humans who genuinely want manual review). The route's tmux session kill is deferred via `setTimeout` so a chained call from inside the planning session itself sees its own success response before the pane dies. Role prompt updated to drop "wait for user Done" language.

**Why this matters.** The only required human input is the merge decision after UAT. Any earlier human gate is a substrate gap, not a feature.

### Orphan-test recovery loops on an unhealthy docker stack (commit ebb7f1387, 2026-05-20, RUN-3)

**Problem.** PAN-1190's review passed but the issue stalled for ~18h. The deacon's
`checkOrphanedReviewStatuses()` re-dispatched the test role every 60s patrol while
`testStatus === 'dispatch_failed'`. The dispatch kept failing because
`assertWorkspaceStackHealthyForSpawn()` throws when the workspace docker stack is
unhealthy — PAN-1190's `server`/`dev` containers had exited. The recovery had no
path to *make* the stack healthy (only the manual `pan workspace rebuild`), so it
re-failed the identical dispatch forever. The work agent sat idle the whole time.

**Fix.** New `rebuildWorkspaceStack()` library primitive in
`src/lib/workspace/rebuild-stack.ts` (the host/CLI-safe rebuild extracted from the
`pan workspace rebuild` command, which now wraps it). The deacon's
`recoverUnhealthyTestStack()` checks stack health before re-dispatch and rebuilds an
unhealthy stack, bounded by a 15-min cooldown + 3-attempt cap; an unrebuildable
stack escalates once via an activity-log error instead of looping. Tracked as
PAN-1247. Verified: on the first patrol after deploy the deacon rebuilt PAN-1190's
stack and dispatched `agent-pan-1190-test`.

**Why this matters.** Any pipeline step that depends on infrastructure (docker
stack, network, auth) must have a *recovery* path, not just a *gate*. A gate with no
recovery is an infinite stall. When you add a `assert*HealthyFor*` style gate, also
add the self-heal.

### Root `tsc --noEmit` broken by a contracts type mismatch (commit 56e29937a, 2026-05-20, RUN-3)

**Problem.** `npm run typecheck` failed on clean `main`: `FlywheelPipelineItem`'s
hand-written interface declared `conflictsWith?: string[]` while the paired
`Schema.Struct` decodes it as `readonly string[]`. A release-blocker.

**Fix.** Made the interface field `readonly string[]` to match the Schema output
(PAN-1248). Note: `packages/contracts`' *own* `tsc --noEmit` still fails on
pre-existing errors (`event-reducers.ts` read-only assigns, `index.ts` duplicate
exports) — that workspace's typecheck is not wired into the root gate. Left as
documented follow-up in PAN-1248.

## Recurring patterns to watch

### Deacon orphan-detection races new agent spawn (observed RUN-1 tick 2)

When `pan plan <id> --auto` (or any spawn route) creates an agent state directory and starts the tmux session, the Deacon's orphan-recovery patrol can fire before the tmux session is fully up and mark the agent `stopped` with reason "orphaned: tmux session missing at boot". The agent still runs to completion (verified — PAN-1235 planning finalized + auto-promoted despite state.json being marked stopped at spawn+0ms), but the dashboard and any consumers of agent state see a misleading "stopped" while the agent is actually running.

**Why it matters.** Cosmetic for now, but if any downstream system uses agent state as the source of truth for "should I restart this", it could double-spawn or skip restarts. PAN-1213 (synthesis→review-status bridge) is the same family of bug. Worth a dedicated fix that gates orphan-detection on a minimum age since `startedAt`.

**How to apply.** When you see "agent stopped immediately after spawn" but the workspace artifacts still appear, do not panic — check the actual artifacts (spec file, beads, commit log) rather than trusting state.json alone.

### GitHub App credential config fails ENOTDIR in worktrees (observed RUN-3)

`pan start` logs `GitHub App config failed (falling back to SSH): ENOTDIR ...
<workspace>/.git/pan-credentials` for every workspace agent. In a git *worktree*
`.git` is a file (a gitdir pointer), not a directory, so `open('.git/pan-credentials')`
always fails. Agents fall back to SSH and function normally, so this is cosmetic —
but the GitHub App credential path is effectively dead code for all worktree
workspaces (which is all of them). Candidate substrate fix: resolve the real gitdir
(`git rev-parse --git-dir`) before writing `pan-credentials`. Not yet filed.

## Parked items

(none recorded yet — `needs-discussion` / `needs-design` labels are the canonical park signal; do not duplicate that state here unless there is something additional to remember about the rationale)

## RUN-9 observations (tick 1, 2026-05-24)

### Zombie inspect sessions from RUN-8 still present
Sessions `inspect-pan-1415-workspace-ce9s`, `inspect-pan-1415-workspace-psqu`,
`inspect-pan-1419-workspace-6uj4`, `inspect-pan-1419-workspace-ie4o` were still
running when RUN-9 started. PAN-1415 and PAN-1419 are both merged+verifying-on-main,
so these inspect sessions are either completed zombies or orphaned from RUN-8's
flywheel patrol. Worth a `pan kill` or investigating whether the inspect agents
should self-terminate after their parent issue merges.

### PAN-1418 parked but review convoy still live
PAN-1418 has `needs-discussion` label and is effectively parked. Its full review
convoy (agent-pan-1418 + 5 sub-reviewers + ship + test) was still running at
tick 1. The work agent completed but the review is blocked on a human design
decision. Suggestion: abort the review convoy or park explicitly.

### 4 issues awaiting human UAT
PAN-1419, 1417, 1415, 1414 are all `merged` + `verifying-on-main` — PRs closed,
code on main, awaiting operator UAT and merge confirmation. The only required
human input. All four show `ship` status passed; no PR number since merged.

### `ctxPercent: 0` in orchestrator snapshot
The orchestrator object in FlywheelStatus shows `ctxPercent: 0` — this is the
Claude Code context percentage at spawn. Likely a schema mismatch or
orchestrator not populating it correctly. Tracked implicitly; not filed as bug.

## Open questions for the human

- **PAN-1229** is at the human merge gate (ship complete, `readyForMerge=true`, PR
  #1241). Awaiting the operator's MERGE decision — the only required human input.
- **PAN-1228** (work role) has been stopped ~15h while its issue still shows
  In Progress. Next tick must classify it (genuine stall vs. paused) and
  resume/restart it via the pipeline.
- `packages/contracts`' own `tsc --noEmit` is broken (pre-existing) and not part of
  the root typecheck gate — see PAN-1248. Wiring it in will surface
  `event-reducers.ts` / `index.ts` errors that need their own fix.

## RUN-11 observations (tick 1, 2026-05-25)

### 20-deep verifying-on-main backlog dominates the system

At RUN-11 tick 1 there were 20 PAN issues in `verifying-on-main` simultaneously
(PAN-829, 1052, 1053, 1059, 1111, 1139, 1140, 1141, 1148, 1158, 1189, 1190,
1215, 1221, 1229, 1249, 1414, 1415, 1417, 1419). All merged, all awaiting the
operator's UAT + close-out. No active work agents.

**Why it matters.** Per `vision.mdx` the only required human input is UAT +
merge. A 20-deep awaiting-UAT queue means the human checkpoint has become the
bottleneck and is blocking the seven readiness criteria from being measured —
specifically criterion #5 (operator intervention rate per pipeline run) cannot
be cleanly measured when the operator is batch-UATing 20 issues at once.

**How to apply.** Future runs should rank `merge`-action suggestions high but
not urgent unless one of them is itself a substrate-bug fix. Surfacing the
backlog ahead of new-work suggestions is the right ordering — the operator
should not start new work while a 20-issue UAT batch is unresolved.

### Tracker drift: `In Progress` + `closed-out` + `merged` simultaneously

10 PAN issues are tracker-`In Progress` while carrying both `closed-out` and
`merged` labels: PAN-457, 1358, 1379, 1381, 1385, 1389, 1391, 1393, 1407, 1408.
These have completed the close-out ceremony but the tracker status was never
flipped to `Done`. PAN-1381 has only `closed-out` (no `merged`) so its drift
shape differs slightly.

**Candidate root cause.** Close-out should be the canonical state transition
that flips tracker status; somewhere between the close-out flow and the
tracker-sync path the status update is dropped or overwritten. May be related
to the substrate epic PAN-1454 (9 systemic failure patterns from the 80-issue
audit) but that's `needs-design`-parked.

**How to apply.** When inventorying `In Progress` issues, check the labels — an
`In Progress + closed-out + merged` issue is almost certainly drift, not
in-motion work, and should not be ranked for `start`/`resume` suggestions.
Worth filing a dedicated substrate-improvement bug if PAN-1454's scope does not
cover this specific gap.

### v1.0-required MUST issues all unstarted

PAN-1486 (toggles), PAN-1487 (telemetry), PAN-1491 (metric-aware
prioritization) — all three MUST issues for the v1.0 readiness measurement
program are open with no agent started. Until at least PAN-1487 lands, the
seven readiness criteria in `vision.mdx` are aspirational; this run cannot
self-measure intervention rate, bugs-per-run, etc.

**How to apply.** PAN-1487 should remain a `start` suggestion at high priority
every tick until it has an agent. PAN-1491 depends on PAN-1487 and should be
medium-priority until 1487 ships.

### Headline `awaitingUat` is now a load-bearing metric

The FlywheelStatus headline's `awaitingUat` field at 20 is the first time this
counter has carried real signal — earlier runs were dominated by in-flight
agents. Confirms the suggestion in `vision.mdx` that this metric belongs in
the UI as a first-class number rather than buried in `parked`/`activePipeline`.

### Parked-item triage decisions (tick 2, 2026-05-25)

The operator named all three parked items (PAN-1418, PAN-1454, PAN-1489) for
unpark. The orchestrator's first pass surfaced the issues' sub-questions back
to the operator, which the operator called out as a failure mode: the
Flywheel must decide for itself on parked items, not delegate decisions back
to the human. The discretion rule is now baked into `roles/flywheel.md` and
`docs/flywheel-brief.md` so it travels to other machines.

Decisions taken this tick:

- **PAN-1418 collapsed into PAN-1486.** "Auto-merge enabled" and "UAT not
  required" are the same decision viewed from two angles, not two orthogonal
  toggles. PAN-1486 rewritten to be the single `require_uat_before_merge`
  issue (default ON), with the cooldown + cancel mechanism folded in as
  part of its scope when the toggle is OFF. PAN-1418 closed as superseded.
- **PAN-1454 patterns 1, 2, 4, 8 chosen** as the prioritized substrate work
  (silent-miss, transparent-deferral, scope-creep-stubs, test-plan-skip).
  Filed PAN-1498 / PAN-1499 / PAN-1500 / PAN-1501 as focused fix issues.
  Selection rationale: highest-frequency patterns in the audit + all four
  have mechanical fixes (prompt edits + a regex/diff-scan gate). Patterns
  3/5/6/7/9 stay in the META until the next 7-day audit window measures
  whether the action-required rate drops below 15%.
- **PAN-1489 stays parked.** Body explicitly says "do not action yet,
  depends on telemetry + 30d of data." Nothing to discuss until PAN-1487
  ships and ~30 days of data exists. Do not re-surface as a suggestion.

### Substrate gap: discretion-on-unpark rule was only in user memory

The original "decide, don't delegate" rule was first written into
`~/.claude/projects/.../memory/feedback_flywheel_use_discretion.md`. The
operator pointed out this is machine-local and will not travel when the
Flywheel runs on other machines. Promoted the rule into
`roles/flywheel.md` (the canonical role prompt) and
`docs/flywheel-brief.md` (the runtime brief) in commit landing with this
state update. Lesson: durable orchestration guidance belongs in the
repo-tracked role/brief, not in agent memory.
