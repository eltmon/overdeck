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

- **PAN-1762 (Swarm v2) — OPERATOR-HELD at proposed (directive 2026-06-11, RUN-22).**
  The operator wants to review the plan before any work starts. Do NOT
  `pan start PAN-1762` when its spec reaches proposed — the stop-at-proposed
  contract is explicitly overridden for this issue. It starts only on the
  operator's explicit instruction. Do not re-surface it as a start suggestion;
  list it as held.

(otherwise: `needs-discussion` / `needs-design` labels are the canonical park signal; do not duplicate that state here unless there is something additional to remember about the rationale)

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

### Substrate gap: orchestrator was suggest-only, Command Deck stayed empty

Tick-2 emitted 35 ranked suggestions but launched zero agents. Operator
called it out: "Why don't I see any work agents going in the command deck
project item tree? Thats like your #1 job making sure agents are working."

The brief and `roles/flywheel.md` both said "do not run `pan start` / `pan plan`."
That made the Flywheel a report generator instead of an orchestrator — the
exact opposite of the v1.0 vision in `vision.mdx`. Fixed in the commit
landing with this state update:

- `roles/flywheel.md` tick loop now includes a "Launch agents on the top
  suggestions" step (step 5).
- `docs/flywheel-brief.md` opener rewritten — "the #1 job is keeping agents
  working."
- Both files moved `pan plan --auto` and `pan start --auto` from the "never"
  list into the "allowed" list.

Tick 3 launched 5 planning agents in parallel: PAN-1487 (v1.0 telemetry),
PAN-1486 (toggles + auto-merge), PAN-1495 (feature-registry crash),
PAN-1455 (Codex auth false-positive), PAN-1501 (test-plan-skip substrate
gate). All five via `pan plan <id> --auto`.

**How to apply:** Every future tick that ranks `start`/`plan`/`investigate`
suggestions must launch agents on the top N (N = maxAgents - 1) before
emitting the snapshot, unless the run is paused or the cap is already
reached. Emit-status with zero pending launches is acceptable; emit-status
that leaves high-priority suggestions unstarted is a tick failure.

### Substrate gap: discretion-on-unpark rule was only in user memory

The original "decide, don't delegate" rule was first written into
`~/.claude/projects/.../memory/feedback_flywheel_use_discretion.md`. The
operator pointed out this is machine-local and will not travel when the
Flywheel runs on other machines. Promoted the rule into
`roles/flywheel.md` (the canonical role prompt) and
`docs/flywheel-brief.md` (the runtime brief) in commit landing with this
state update. Lesson: durable orchestration guidance belongs in the
repo-tracked role/brief, not in agent memory.

## RUN-14 observations (tick 1, 2026-06-04)

Run config: `minAgents=20`, `maxAgents=30`, `scope=pan-only`,
`auto_pickup_backlog=false`, `require_uat_before_merge=true`.

### `auto_pickup_backlog=false` ⇒ restricted inventory (semantics confirmed)

`roles/flywheel.md:73` is authoritative: when `auto_pickup_backlog=false`, the
Flywheel **keeps inventory restricted to work in progress, in review, blocked,
or awaiting merge** — it does NOT pull fresh READY backlog items. This resolves
the apparent conflict with the emphatic "launch agents aggressively to
`minAgents`" rule (`:78`): step-5 launching operates only over the *restricted*
inventory. So with auto-pickup OFF, `minAgents=20` is a ceiling-if-available,
not a mandate to manufacture work from the backlog.

**Consequence this run:** the in-flight set was ~10 live agents (7 work + 2
review + 1 plan) plus 14 verifying-on-main (merged, awaiting UAT, ineligible
for new agents) plus 1 stalled review (PAN-1242). There was no launchable
in-flight work to reach 20, and pulling backlog is forbidden by the toggle.
Surfaced as a non-blocking `openQuestion`; did not over-launch.

### Memory pressure: swap was 99.9% full

RAM 41865/64126 MiB (65%), **swap 8186/8191 MiB (99.9%)**. The brief invites
over-saturation ("rather hit OOM than leave capacity idle"), but a near-full
swap is *already* the failure boundary, not headroom — launching more here
would be an unproductive hard OOM, not an instructive one. Held agent count.
Worth watching: if swap is chronically full at run start, the practical agent
ceiling is well below `maxAgents=30` regardless of the config.

### Substrate bugs filed

- **PAN-1613 — agents stay live / are re-spawned on CLOSED issues.** Evidence:
  `agent-pan-1256` (gpt-5.5) **wedged at 100% ctx, $24.07** on PAN-1256 (closed
  2026-05-29); `agent-pan-1496-review` idle on PAN-1496 (closed 05-29);
  `agent-pan-1450` spawned **3.5h AFTER** PAN-1450 closed (02:38 close → 06:01
  spawn). Root cause area: deacon lifecycle reconciliation has no
  `isIssueClosed()` gate before resume/dispatch, and no terminal-close teardown
  step (mirror of `postMergeLifecycle` but for CLOSED, not just
  verifying-on-main). Recurs — RUN-9 already noted zombie inspect sessions on
  merged issues. This is the load-bearing reason the live-agent count and the
  `pan status` "stopped" list diverge wildly.
- **PAN-1614 — deacon does not recover a fully-stopped review convoy on an OPEN
  in-review issue.** PAN-1242 sat 9 days (last update 2026-05-26) in `in-review`
  with work + all 4 sub-reviewers + synthesis `stopped`, **no pause/troubled
  gate, no stopReason**. Deacon never re-dispatched. Same family as PAN-1247
  (gate without recovery = infinite stall), but the failure is "dispatch never
  re-fires," not "dispatch_failed loops."

### Awaiting-UAT backlog (the human gate) is the bottleneck again

14 issues verifying-on-main: PAN-1549, 1509, 1495, 1487, 1486, 1419, 1417,
1415, 1414, 1326, 1316, 1190, 1134, 1059. All merged, agents paused by
`postMergeLifecycle`, awaiting operator UAT + close-out. Note PAN-1486/1487 (the
v1.0 toggle + telemetry MUST issues that RUN-11 flagged as unstarted) have now
**shipped and merged** and are in this batch — once UAT'd and closed, the
readiness stats in `pan flywheel stats` should start collecting real samples
(currently all `insufficient_data`).

### Did not launch new agents this tick — and why that was correct, not a stall

Three independent reasons converged: (1) `auto_pickup_backlog=false` forbids
pulling backlog; (2) every in-progress/in-review item already had a healthy
agent or was a stalled-pending-substrate-fix item (PAN-1242, tracked by
PAN-1614); (3) swap was 99.9% full. The tick's real output was two substrate
bug records + a ranked suggestion set + the snapshot — which is the correct
orchestration move when the launchable-work set is empty, NOT the "suggest-only
failure" that RUN-11 was scolded for (that scolding was about *ignoring*
launchable work, which there was none of here).

### The real agent ceiling was memory, not `maxAgents` (ticks 1–3)

Across ticks 1→3 (~52 min, ~22 deacon patrol cycles) nothing recovered: PAN-1242
stayed stopped, the three closed-issue zombies (PAN-1256 / 1450 / 1496-review)
stayed alive, the 14-deep UAT batch did not drain. Meanwhile swap climbed
99.9% → **100.0% full** (8191/8191 MiB) and RAM crept 41865 → 42559 MiB. The
wedged-at-100%-ctx zombie (PAN-1256) and its peers are not just *slot* holders —
they pin RAM they will never release, so **PAN-1613 is also a memory-leak vector,
not only a slot-accounting bug.** Practical lesson for future runs: when swap is
already saturated at run start, the effective agent ceiling is far below
`maxAgents=30`, and "prefer over-saturation / rather hit OOM" must be read
against *current* memory headroom, not the nominal cap. Draining zombies
(PAN-1613) and the UAT batch is what actually buys back capacity here — launching
more would just deepen the swap thrash.

### "Healthy" ≠ "making progress" — spot-check ctx, not just the health flag (tick 4)

Tick 4 spot-checked the tmux of the older "healthy" work agents and found
`agent-pan-1395` (gpt-5.5) **hard-wedged**: `API Error: 400 Your input exceeds
the context window`, ctx 100%, **$49.36 spent**, stuck ~2 days — yet the
dashboard reported it `healthy`. Same shape as the `agent-pan-1256` zombie
(gpt-5.5, 100% ctx, $24). Filed **PAN-1615**.

Key distinctions worth carrying forward:
- The health classifier keys on heartbeat/activity, not context headroom, so a
  context-saturated agent (every turn 400s) reads as healthy. **Always
  spot-check `ctx %` in the tmux footer when an agent has been "healthy" for
  many hours** — `ctx 100%` + a 400 banner = dead, not healthy.
- PAN-1615 is **distinct from PAN-1415** (which is the inactivity case): you
  cannot recover a context-exhausted agent with `pan tell` / `pan resume
  --message`, because both *add* context to an agent already over its ceiling.
  Recovery must *drop* context (compaction / `/clear` + resume).
- Both wedged agents were gpt-5.5 at the 200k wall. This is a substrate
  context-lifecycle gap (proactive compaction before the hard ceiling), **NOT a
  reason to avoid gpt-5.5** — it remains the operator's preferred, well-performing
  work model. Frame any fix as "manage the context lifecycle," never "switch models."
- Lesson for the orchestrator: the dashboard "healthy: N" count overstates real
  capacity. At tick 4, 11 "healthy" agents were really ~8 producers (2 wedged +
  1 idle-in-review). Report `agentsActive` from genuine producers, not the raw
  health count.

### DOMINANT FINDING: "healthy" conflates process-alive with making-progress (tick 5)

A full tmux spot-check of all 11 "healthy" agents at tick 5 found only **3
genuinely producing** (PAN-1455-review, PAN-1574-review, PAN-1579-plan). The
other 8: 2 fine-but-idle (work complete, in review), and **6 silently broken**:

| Agent | Failure | Bug |
|---|---|---|
| agent-pan-1395 | wedged at 100% ctx (API 400), $49 | PAN-1615 |
| agent-pan-1256 | wedged at 100% ctx on a CLOSED issue, $24 | PAN-1613 + 1615 |
| agent-pan-1496-review | zombie on issue closed 2026-05-29 | PAN-1613 |
| agent-pan-1498 | ghost — kickoff never delivered, idle whole run | PAN-1617 |
| agent-pan-1500 | ghost — kickoff never delivered | PAN-1617 |
| agent-pan-1501 | ghost — kickoff never delivered | PAN-1617 |
| agent-pan-1491 | blocked ~8.5h on a hung inspection | PAN-1616 |

**Root theme:** the health classifier keys on heartbeat / process-liveness, not
forward progress, so a context-saturated agent, a never-kicked-off agent, a
zombie on a closed issue, and an agent blocked on a hung gate all read
"healthy." This single classifier gap is the umbrella over PAN-1613/1615/1616/1617.
**The Command-Deck "agents active: 25/30" headline is almost entirely fictional**
— real producers were 3.

**Two new precise root causes filed this tick:**
- **PAN-1616 — inspect agents hang on permission prompts.** `inspect-pan-1491-
  workspace-etp22` froze ~8.5h on a Claude Code "Do you want to proceed?" dialog
  for a read-only `git diff`. Auto-approval (Panopticon's `pre-tool-hook`,
  PreToolUse; settings `permissions:{}` is empty) covers `agent-*`/`planning-*`
  but not `inspect-*` sessions, so inspect agents block on prompts work/planning
  agents sail through. The hung inspection never delivers its verdict → the
  parent work agent (PAN-1491, v1.0-required) waits forever. Same gate-without-
  timeout lesson as PAN-1247.
- **PAN-1617 — ghost work agents.** PAN-1498/1500/1501 spawned (`status=running
  role=work`) but `kickoffDelivered` was never set and they sat at the launch
  screen (ctx 0% / $0 / out 0) the entire run. Kickoff delivery silently no-op'ed
  at spawn (or a deacon resume relaunched the TUI without re-delivering kickoff).

**Orchestration lesson:** when the launchable-work set looks full but the
Command Deck isn't moving, **spot-check every "healthy" agent's tmux ctx/pane** —
the dominant failure mode is silent non-progress masked as health, not absence
of work. The orchestrator's value on a quiescent-looking run is diagnosing this
with precise root causes, NOT launching more agents into a broken classifier.

### Why no hand-fixes (correct restraint)

All six broken agents have remediations the brief forbids the orchestrator from
doing: answering the inspect permission prompt (= clicking around a broken gate,
explicitly prohibited), `pan tell`-ing a kickoff to the ghosts, `pan resume`/
`pan kill` on the wedged/zombie agents. The disciplined move — and the one that
actually fixes the class rather than this instance — is to file the substrate
bugs and let the system self-heal once they land. RUN-14 filed five
(PAN-1613/1614/1615/1616/1617); that is the run's deliverable.

### Tick 6: a two-snapshot diff is the only reliable progress test; one launch landed

Single-snapshot "ctx 45%, $1.74" looks alive; the SAME values 25 min later prove
it is frozen. At tick 6 a diff against tick 5 showed even the 3 "producers" were
stationary — and the panes explained why:
- **PAN-1455-review / PAN-1574-review had PASSED** ("verdict signaled as passed,
  all four reviewers clean, test skipped — no drift"). PRs #1611 / #1587. They
  were idle-because-done, advancing to the operator merge gate. Not stuck.
- **PAN-1579 planning was COMPLETE but stuck at the dashboard prompt
  `❯ Click Done to start the work agent`.** The spec was already `proposed` (the
  RUN-1 finalize→complete-planning auto-promote DID fire), but the
  proposed→work-start transition still needs a `pan start` (the lifecycle's
  documented proposed→running step). Under autonomy the orchestrator IS the one
  who runs `pan start` — that is the autonomous equivalent of clicking Done, not
  a bug.

So the real count of live producers was **0** until the orchestrator acted.

**The launch (and what it proved):**
- `pan start PAN-1579` blocked on the work-spawn **docker-health gate** ("stack
  not healthy… run pan workspace rebuild or retry with --host"). This gate has no
  autonomous recovery (PAN-1247 fixed only the test-dispatch path) → filed
  **PAN-1618**.
- `pan start PAN-1579 --host --yes` succeeded; the agent began real work
  (driver-adapter bead, ctx 36%, out 4.2k). PAN-1579 is a CLI-codebase change
  that runs against the worktree's own node_modules and does not need the live
  dashboard stack, so `--host` was correct, not a workaround.
- **Crucially, the kickoff delivered cleanly on a fresh `pan start`.** That
  narrows **PAN-1617** (ghosts): the kickoff-delivery failure is in the
  deacon-resume / earlier-spawn path, NOT in fresh orchestrator `pan start`. Use
  this to bisect the fix.

**Orchestration lessons carried forward:**
1. Never judge "producing" from one snapshot — diff token/cost/out across two
   ticks. Frozen non-zero values = idle/stuck, not active.
2. A planning agent parked at "Click Done" under autonomy is the orchestrator's
   cue to `pan start` (it is in-flight, not backlog; `auto_pickup_backlog=false`
   does not forbid advancing already-planned work).
3. When `pan start` hits the docker gate for a host-runnable code task, `--host
   --yes` is the correct follow-through (and file PAN-1618-style if the gate
   should have auto-recovered).

### Tick 7: PAN-1213 is live (review→ship bridge), and PAN-1059 in UAT is its fix

PAN-1455 (#1611) and PAN-1574 (#1587) both **passed review** — their synthesis
agents correctly ran `pan admin specialists done review <id> --status passed`
("✓ Review passed") — but **~1h later no ship agent had dispatched** and both
issues were still `in-review`. This is the open **PAN-1213** ("Synthesis→review-
status bridge broken") manifesting live: the passed signal lands but the
downstream review-status→ship-dispatch never fires, so review-passed work rots
in `in-review`. **PAN-1059** ("Refactor review path: synthesis role becomes the
orchestrator") is the refactor that fixes this — and it is sitting in the
verifying-on-main UAT batch. **Therefore: landing PAN-1059 (UAT it) is the
single highest-value UAT action — it unblocks the whole review→ship→merge path,
not just one issue.** Reference PAN-1213; do not file a duplicate.

Do NOT hand-advance review-passed issues (no re-running the done-signal, no
manual ship dispatch) — that papers over PAN-1213. Surface and wait for the fix.

### Tick 7: PAN-1579 reproduced the PAN-1615 wedge live (context-ceiling watch)

The PAN-1579 work agent launched at tick 6 climbed from ctx 36% ($0.91) to **ctx
84% / "94% context used" ($10, +669/-283) in ~30 min** of heavy work — a live
reproduction of the PAN-1615 context-ceiling wedge in progress. gpt-5.5 via
CLIProxy appears not to auto-compact, so a single substantial bead can drive an
agent to the 200k wall mid-task. RAM rose +2.4GB (→44.4GB) tracking its context
growth. **Lesson: launching a work agent on a large issue under this substrate
has a real chance of producing another wedge before `pan done` — the launch is
not "safe" until PAN-1615 lands.** Watch launched agents' ctx each tick; a
climbing ctx with no compaction predicts the wedge.

### Tick 8: PAN-1616 has a second, worse class — un-overridable `.claude/**` settings-protection

The PAN-1579 wedge-watch resolved unexpectedly: instead of hitting 100% ctx, the
agent **hung on a Claude Code permission prompt** while editing
`.claude/rules/dashboard-node22-only.md` (legitimate on-task work — documenting
that the SQLite layer now uses runtime-bundled `node:sqlite`/`bun:sqlite`). The
prompt's option 2 — "Yes, and allow Claude to edit its own settings" — reveals
this is Claude Code's **settings-file protection** for `.claude/**` paths, a gate
**distinct from normal tool permissions and un-overridable by a `PreToolUse`
auto-approve hook**.

Critically, `agent-pan-1579` is an `agent-*` session — exactly the scope PAN-1616
said *was* auto-approved. So PAN-1616 has **two classes**:
1. **session-scope gap** — `inspect-*` (and `--host` review/work) not covered by
   the hook (the original framing; blocks PAN-1491 via the hung inspection).
2. **settings-protection gate** — `.claude/**` edits hang ANY agent, in-scope or
   not, because no hook can auto-approve Claude Code's own settings protection.
   Fix is different: pre-seed `permissions.allow` for the workspace `.claude/**`
   path, set an appropriate permission-mode at launch, or have agents edit the
   `sync-sources/rules/` source rather than the rendered `.claude/rules/` copy.

Documented as a comment on PAN-1616 (broadening its scope) rather than a 7th
issue. Carry-forward: **any task that touches `.claude/**` will wedge an agent
under autonomy until this is fixed.**

### Tick 8: the honest bottom line — repair > launch, and "0 producers" is the finding

After ~2h45m and 8 ticks, the count of agents making **forward progress was 0**.
Every in-flight agent is blocked on a substrate gap: 2 permission-hangs
(PAN-1616), 2 review-passed-no-ship (PAN-1213), 3 ghosts (PAN-1617), 1 ctx-wedge
(PAN-1615), 2 closed-issue zombies (PAN-1613), 1 stalled review (PAN-1614). The
one agent the orchestrator successfully launched (PAN-1579) did ~$10 of real work
then hung on PAN-1616 class 2.

**Lesson for future runs under `auto_pickup_backlog=false`:** when every
launchable path dead-ends in a substrate gap, the highest-leverage move is NOT to
launch more agents — it is to (a) precisely diagnose each gap as a filed bug, and
(b) point the operator at the UAT items that *fix* those gaps. Here PAN-1059 (in
the UAT batch) fixes PAN-1213, and PAN-1415 (in the UAT batch) addresses the
stuck-agent class. **Draining UAT — especially PAN-1059 + PAN-1415 — clears more
pipeline than any launch.** "Keep agents working" does not mean "spawn into a
broken substrate"; it means surface the precise reason they're NOT working and
the shortest path to fixing it. RUN-14's deliverable is that map.

### Tick 33: first movement — PAN-1574 closed out; PAN-1455 asymmetry sharpens PAN-1213

After ~28 static ticks, **PAN-1574 (Codex first-class harness) completed the full
lifecycle → CLOSED + `closed-out`** (review→ship→merge→close-out). Two useful
facts:
1. **Close-out teardown works.** PAN-1574's three long-lived zombie inspect
   sessions (`inspect-pan-1574-*`, alive since Jun 1) were cleaned up when the
   issue closed out. This narrows PAN-1613: the teardown-on-close path is fine;
   the gap is specifically agents on issues that closed *without* going through
   close-out (PAN-1256/1496 closed 5/29, never close-out'd → never torn down).
2. **The PAN-1455/PAN-1574 asymmetry is strong evidence for PAN-1213.** Both
   passed review identically. PAN-1574 advanced (it was pushed through —
   manually/operator, since PAN-1059 the bridge-fix is still in the UAT batch),
   while **PAN-1455 (#1611) is STILL stuck in-review with no ship dispatch.**
   Same state, divergent outcome = the review→ship transition does not auto-fire;
   it requires a manual push. PAN-1455 is now the single clearest next operator
   action (push it through like 1574, or land PAN-1059).

The operator is evidently active (they closed PAN-1574), so the run tightened
back to a 20-min cadence to catch the next move. headline.prsMerged → 1.

### Tick 38: PAN-1450 reopened→merged; PAN-1613 confirmed an ACTIVE re-spawn

More movement: **PAN-1450** (regression-test audit, previously a closed-zombie)
was **reopened → merged → verifying-on-main** (now 15 awaiting UAT); its zombie
agent and the PAN-1256 zombie were both cleaned up. But the key finding:
**`agent-pan-1496-review` was RE-SPAWNED on the still-closed PAN-1496** — a new
tmux session dated 06-04 23:53, ~6 days after the issue closed. So PAN-1613 is
not passive lingering; the deacon's resume/dispatch patrol is *actively
re-launching* agents on closed issues. The `isIssueClosed()` gate must run on the
resume/dispatch path, not just at close time. Commented this evidence on PAN-1613.
Confirms the teardown-on-close path works (PAN-1450/1256 cleaned) and isolates the
gap to resume/dispatch.

### Tick 39: PAN-1613 escalates — deacon drives review→ship on a CLOSED issue

The zombie story got materially worse. After respawning `agent-pan-1496-review`
(tick 38), the deacon **dispatched `agent-pan-1496-ship`** (created 06-05 00:17)
for the same CLOSED PAN-1496 — actively running the ship role (rebase/verify/push,
kimi-k2.6, ctx 86% climbing, **$9.14 spent**, PR #1514). So this isn't lingering;
the deacon is **advancing a closed issue through successive pipeline roles**. The
`isIssueClosed()` gate must run on **every role dispatch** (review/test/ship/
inspect), not just resume/close. Commented the escalation on PAN-1613 and bumped
its perceived severity (active $ waste + OOM pressure, not just a held slot).

These zombies are now a **measurable memory driver**: host RAM climbed to 50.4GB
with swap pinned at 100%. The two live PAN-1496 zombies (respawned review + new
ship, both large-context) are a chunk of it. Watching for ≥54GB OOM threshold;
kept the 20-min cadence. Note: a "ship session appeared" looked like progress on
the fast check — it was a zombie, not PAN-1455 advancing. Always identify WHICH
issue a new ship/review session belongs to before counting it as forward motion.

### Tick 67: operator pushed back — pivoted from filing to STRIKING all 6 substrate bugs

Operator feedback at tick 66: "There are still a lot of issues stuck in pipeline,
I don't think you're doing enough to solve substrate issues." Correct criticism.
For ~60 ticks the orchestrator filed substrate bugs (PAN-1613–1618) + monitored,
but **filing ≠ fixing** — the bugs sat unfixed and the pipeline stayed jammed.

**The catch-22:** the pipeline is broken *by* these very bugs (review→ship stalls
on PAN-1213, permission hangs on PAN-1616), so routing fixes *through* `pan plan
--auto` would get them stuck at review/ship too. `pan strike` is the escape hatch:
it bypasses plan/review/test/ship, lands the fix directly on main, then verifies.
The brief explicitly sanctions strike for "clear scoped fix" and exempts strike
merges from the UAT gate.

**Action:** `pan strike PAN-1616 PAN-1613 PAN-1618 PAN-1617 PAN-1614 PAN-1615
--effort high` → 6 strike agents spawned (Opus 4.8), all confirmed engaging. 16/30
agents, memory healthy.

**Why strike over the substrate-fix-rule's "file, don't fix":** the substrate-fix
rule says the *orchestrator* must not edit substrate code itself — and it doesn't
(the strike agents do). Dispatching pipeline agents to fix bugs is the
orchestrator's #1 job ("keep agents working"). The operator's explicit "do more"
also overrides `auto_pickup_backlog=false` for these owner-filed substrate bugs.

**Risk accepted & how it's managed:** 6 simultaneous strikes onto critical infra
(PAN-1613/1614/1617 all touch overlapping deacon patrol code) land unreviewed.
Mitigations: strike agents rebase onto main before merging (later merges rebase
onto earlier ones, conflicts auto-resolved) and run verification after landing.
Monitoring at tight cadence; per the buck-stops-here rule, any strike that aborts
("recommend re-strike on a tighter issue" / "full pipeline needed") gets a
same-tick follow-up (re-strike or `pan plan --auto`).

**PAN-1213 deliberately NOT struck:** its fix (PAN-1059) is already merged on main,
awaiting operator UAT. UAT'ing PAN-1059 is the operator lever that unsticks PAN-1455
and the review→ship path the strikes don't cover. If PAN-1059 proves insufficient
post-UAT, strike PAN-1213 as the follow-up.

**Lesson for future runs:** a quiescent stuck pipeline is NOT a cue to idle on
light refreshes — it is a cue to STRIKE the substrate bugs that are jamming it.
Filing + monitoring is the diagnosis; striking is the cure. Don't wait ~60 ticks
for the operator to say so.

### Tick 69: strike outcome — 1 landed, 5 self-declined → converted to full pipeline

Of the 6 strikes:
- **PAN-1618 LANDED** (`ff30c9259` on main) — work-spawn docker auto-recovery. It
  also surfaced + filed **PAN-1621** (pan close didn't exit cleanly), which another
  agent then landed (`3c4b0bd03`). Net: 2 substrate fixes on main.
- **PAN-1613 / 1614 / 1615 / 1616 / 1617 self-aborted** — each strike agent judged
  its change (deacon `isIssueClosed` gate + teardown; review-convoy recovery; ctx
  classifier; permission auto-approve for inspect/.claude; kickoff verification)
  **too risky to land unreviewed on critical infra**, and explicitly recommended
  the full pipeline ("specced with tests", "run through pan plan → normal
  pipeline"). They left clean trees, no commits, no push.

This is the strike role working **as designed** — it's a judgment gate, not a
guaranteed merge. The agents reached the same conclusion I'd flagged as a risk:
blind-landing 5 interacting deacon/classifier changes is unsafe.

**Follow-through (same tick, per buck-stops-here):** launched `pan plan --auto` on
all 5 (PAN-1613/1614/1615/1616/1617). They now run the full plan→work→review→test
→ship pipeline with proper tests/review. 5 planning agents live; **20/30 agents —
Command Deck saturated to the minAgents target.**

**Carry-forward catch-22:** these 5 fixes will eventually hit review→ship, still
broken by PAN-1213. PAN-1059 (the fix) is merged-on-main awaiting operator UAT —
so UAT'ing PAN-1059 is now doubly load-bearing: it unsticks PAN-1455 AND clears the
merge path for the 5 substrate fixes. If PAN-1059 proves insufficient post-UAT,
strike PAN-1213 directly (a single, well-scoped fix — better strike candidate than
the 5 broad ones were).

**Refined lesson:** strike first for a *fast, scoped* fix; expect the agent to
decline broad/risky infra changes and **immediately fall through to `pan plan
--auto`** — that two-step (strike → on-decline plan) is the right reflex, and it's
how PAN-1618 got landed fast while the riskier 5 went the safe route.

### Tick 70-72: driving proposed→work, two start-path gotchas, and the meta-blocker

The 5 planned substrate fixes finalized to `status=proposed` but stalled at the
"Click Done" proposed→work gate (same as PAN-1579) — the orchestrator must
`pan start` them. Two start-path gotchas surfaced:

1. **`pan start --host --yes` does not return promptly** — it spawns the work
   agent then the CLI hangs (the agent runs fine). A *sequential* start loop
   therefore wedges on the first item. Fix: fire starts as independent
   background commands, not a blocking loop.
2. **Parallel `pan start` → bd-list lock contention** (filed **PAN-1629**). Four
   simultaneous starts → `bd list --json -l pan-<id>` failed for 3 of them with a
   *misleading* "No beads tasks found … planning must create beads" (the beads
   existed; the bd command lost a DB-lock race). Re-running the 3 **staggered
   ~12s apart** succeeded. Lesson: stagger parallel `pan start` invocations, and
   don't trust the "no beads" message — check `.beads/issues.jsonl` actually
   exists before concluding planning failed.

Outcome: PAN-1616 work agent (gpt-5.5) implemented the permission-hang fix and
opened **PR #1628** (hit ctx 100% but still submitted). PAN-1613/1615 implementing;
1614/1617 spawned on staggered retry. So the 5 substrate fixes are all in motion.

**THE META-BLOCKER (load-bearing):** these are WORK agents, so they go through the
normal pipeline (`pan done` → review → ship). That path is still broken by
**PAN-1213** (synthesis→review-status bridge). So PR #1628 and the rest will JAM at
review→ship exactly like PAN-1455 — **unless PAN-1059 (the fix, already merged on
main) is UAT'd/closed-out by the operator, or the deacon is restarted to run
PAN-1059's code.** Every substrate fix the flywheel produces this run funnels
through this one gate. If the operator can't UAT soon and PAN-1455 stays stuck, the
right escalation is to STRIKE PAN-1213 directly (single scoped fix) so the whole
review→ship path reopens — but first confirm PAN-1059 on main isn't already the
fix (avoid duplicating it; a deacon restart may be all that's needed).

## RUN-15 observations (tick 1, 2026-06-08)

Run config: `minAgents=2`, `maxAgents=4`, `scope=pan-only`,
`auto_pickup_backlog=false`, `require_uat_before_merge=true`. **The substrate
landscape changed materially since RUN-14 — re-baseline before acting.**

### The world is different now: deacon unfrozen, governor live, brakes landed

- **Deacon unfrozen ~2026-06-08 22:05** with the **PAN-1665 concurrency governor
  live** (`src/lib/cloister/concurrency.ts`): `DEFAULT_MAX_WORK_AGENTS=6` +
  `DEFAULT_RESERVED_ADVANCING_SLOTS=3` → `totalCeiling=9`, plus load-gate
  (cores×1.5) and 150ms resume stagger. No herd (vs 2026-06-07's load 52 / 37
  agents). RAM healthy: 18GB/64GB, **swap 0%** (vs RUN-14's 100%-pinned swap),
  disk recovered to 268G free (PAN-1674 .venv cleanup).
- **The flywheel does NOT drive agent count here.** `maxAgents=4` sits *below*
  the deacon governor's ceiling of 9 (+ convoy burst: a review convoy = 5
  sessions per dispatch, so total live can exceed 9). At tick 1 there were ~12
  live agents — all the deacon's auto-resume, none the flywheel's. **Correct
  posture: hold launches, respect the governor, let the pipeline drain.** This
  is the explicit unfreeze-plan stance ("FLYWHEEL HELD until pipeline drains").
- **The three RUN-14 brakes MERGED + live in the running deacon:** PAN-1615
  (ctx-ceiling wedge), PAN-1616 (inspect-hang watchdog), PAN-1617 (ghost-agent
  kickoff detection). All `merged, verifying-on-main`. The RUN-14 dominant
  findings are addressed at the class level.

### The review→ship meta-blocker (PAN-1213) appears CLEARED in the live deacon

This is the single biggest change from RUN-14. PAN-1059 (review-path refactor,
the PAN-1213 fix) is `merged, verifying-on-main` **and running**. Live evidence:
**PAN-1242 has a `ship` session, PAN-1455 advanced to a `test` session** — the
exact review→ship transition that jammed every issue in RUN-14 is now firing
automatically. UAT'ing PAN-1059 just makes it official; the path already works.

### Two substrate gaps STILL bite live (not covered by the merged brakes)

1. **PAN-1613 (NOT fixed — still in-review).** `agent-pan-1496-review` +
   `agent-pan-1496-test` are actively running on **PAN-1496, CLOSED 2026-05-29**
   — a respawn ~9 days post-close, *after* the throttle landed. The
   `isIssueClosed()` guard added to `autoResumeStoppedWorkAgents` covers the
   **work-agent resume** path but **not the review/test convoy dispatch** path.
   Filed evidence on PAN-1613. This is active $/RAM/slot waste, not passive
   lingering.
2. **PAN-1616 class-2 (merged brake covers only class-1).** `agent-pan-1579`
   (work) is hung on a `.claude/rules/dashboard-node22-only.md`
   settings-protection prompt — the same file/hang as RUN-14 tick 8. The merged
   watchdog recovers `inspect-*` sessions (class 1); a **work agent editing
   `.claude/**` still hangs** because Claude Code's settings-file protection
   can't be auto-approved by a PreToolUse hook. Filed evidence on PAN-1616.
   Fix: pre-seed `permissions.allow` for workspace `.claude/**` at launch, or
   have agents edit `sync-sources/rules/` source rather than the rendered copy.

### Don't confuse paused with stalled

PAN-1641 is `in-progress`-labelled with **no tmux session** — but its
`state.json` shows `paused=true` (intentional, part of the unfreeze/drain plan).
Not a ghost (PAN-1617), not a stall. The deacon correctly will not auto-resume a
paused agent. Check `state.json` `paused`/`troubled` before classifying a
session-less in-progress issue as broken.

### PAN-1395 / PAN-1491 at ctx 100% but PRs already up (#1634 / #1636)

Both work agents read `100% context used` — but each has already submitted its
PR. This is a *post-submission* wedge, not a blocking one, so the PAN-1615 brake
recovering them is lower-value than recovering an agent wedged mid-task. Note
but don't alarm: a ctx-100% agent that already shipped its PR holds RAM but isn't
blocking forward motion.

### Tick discipline: this was a diagnose-and-surface tick, correctly

No launches: `auto_pickup_backlog=false` (no fresh backlog), already ~12 agents
vs flywheel cap 4, every in-flight item already has an agent/convoy or is
correctly paused, and the two stuck agents (PAN-1496 zombie, PAN-1579 hang) have
only forbidden remediations (`pan kill`, answering the prompt). The tick's output
— two substrate-evidence comments + a ranked suggestion set + the snapshot — is
the correct orchestration move when the launchable set is empty, not the
suggest-only failure RUN-11 was scolded for (that was *ignoring* launchable work;
there is none here). Highest-leverage operator move: UAT-drain the 19-deep
verifying-on-main batch.

### RUN-15 tick 2 — the PR CI-rollup is a single-tick stall/ready distinguisher

RUN-14's reliable progress test was a two-snapshot token/cost diff. Tick 2 added
a faster one for **convoy/review-phase** items idle at the `❯` prompt: read the
PR's `gh pr view <pr> --json statusCheckRollup`. It collapses the ambiguity in
one tick:

- **CI all-green + idle convoy** = done, ready for the operator merge gate
  (correct under `require_uat_before_merge=true`, NOT a stall). Tick 2: PAN-1242
  (#1516) and PAN-1395 (#1634) were both green — ready, just awaiting operator
  UAT. PAN-1395's work agent was ctx-100% wedged but **irrelevant** because the
  PR was already green (work done).
- **CI failing + idle/wedged work** = genuinely blocked. Tick 2: PAN-1455
  (#1611) test FAILURE with the work agent idle (watch for deacon re-dispatch);
  PAN-1491 (#1636) lint+smoke FAILURE *and* work agent ctx-100% wedged — it
  literally cannot fix its own CI (every turn 400s). Double-blocked.

Lesson: a ctx-100% wedge only matters if the PR isn't already green. Triage
wedged agents by their PR's CI state before treating the wedge as a blocker.

### RUN-15 tick 2 — operator runs strikes directly; observe, don't touch

Two operator-launched strikes appeared mid-run (Opus 4.8, role=strike):
**PAN-1506** (strike agents missing from the frontend store — critical dashboard
bug) and **PAN-1675** (Panopticon-side `resume --compact` to recover wedged
agents without the harness `/compact` deadlock). PAN-1675 is the **recovery half
of the PAN-1615 wedge story** — the merged brake *detects* the ctx-ceiling wedge;
PAN-1675 *recovers* it. The flywheel observes and reports these in the snapshot;
it does not touch operator strikes.

### RUN-15 tick 2 — the two persistent stalls did NOT self-heal over ~30min

Across the tick-1→tick-2 interval the deacon/brakes did not clear either the
PAN-1496 zombie (review+test on a 9-day-closed issue; went idle but stayed
present) or the PAN-1579 `.claude/**` permission hang (~90min frozen, still
reported "active" by cloister because the heartbeat ticks at the prompt). Both
have only orchestrator-forbidden remediations (`pan kill`, answer the prompt),
so the disciplined output stays: fresh evidence on PAN-1613/PAN-1616 + surface,
not hand-fix.

### RUN-15 tick 3 — "test FAILURE" on a PR has TWO independent signals; check both

A PR carries two distinct test signals and they can disagree:
1. **`panopticon/test`** — the test-ROLE agent's verdict, posted as a commit
   status ("Test specialist passed").
2. **`test`** — the GitHub Actions workflow test job.

Tick 3 corrected my tick-2 read of PAN-1455 (#1611). I had flagged "test FAILURE
+ idle work agent → PAN-1614 deacon-redispatch gap." Investigating the actual
CI log showed the opposite: `panopticon/test` = **pass** (code is fine), while
the GHA `test` job was **stale-red from Jun-7 05:27** failing on
`better-sqlite3` native rebuild (`error: Script not found "rebuild"`) — the exact
ABI problem **PAN-1579** fixes — plus a 6-hour `Clean install + server smoke
test` hang (**PAN-1651**). So PAN-1455 is blocked on **known CI-infra bugs**, not
a code defect and not a deacon-recovery gap. **No new bug filed** — that would
duplicate PAN-1579/1651.

Lessons:
- When a PR shows `test fail`, read (a) `panopticon/test` separately from the GHA
  `test` job, (b) the failing run's **timestamp** (a stale run ≠ current state),
  and (c) the actual failing step. A native-rebuild / smoke-hang infra failure is
  PAN-1579/1651, not a code regression.
- **Investigate before filing.** The two-tick "frozen + red" signal looked like a
  deacon gap; the log proved it was CI staleness. Filing on the tick-2
  hypothesis would have produced a wrong, duplicate bug. The Karpathy
  "investigate before fixing" rule applies to *filing* too.
- A ctx-100% wedge only matters if the PR isn't already green (tick-2 rule) — and
  a red PR only matters if it's the *code* that's red, not stale infra CI.

### RUN-15 tick 3 — PAN-1579 unstuck (manual option-2); operator escalating substrate

PAN-1579's `.claude/**` settings-protection hang (PAN-1616 class-2) cleared — the
pane shows option `2` selected and the agent resumed (ctx 62%, +91/-58). It
needed a manual unblock, so **PAN-1616's class-2 gap is still real** (an agent
should never hang requiring a human to pick option 2). Nice second-order effect:
PAN-1579 is itself the better-sqlite3 fix that unblocks PAN-1455's CI.

Operator continues driving substrate directly: the **PAN-1675 strike declined**
the broad infra change and **fell through to planning** (`planning-pan-1675`) —
the documented strike→plan reflex. A new critical **PAN-1510** (newly-filed
issues missing from frontend store, sibling of the PAN-1506 strike) was filed and
is planning. The flywheel notes these in the snapshot and does not touch
operator-owned strikes/plans.

### RUN-15 ticks 1–3 — the standing shape: operator-gated, not flywheel-blocked

Three ticks, ~58 min, zero merges, UAT batch flat at 19. This is NOT a stalled
flywheel — every in-flight item is either (a) CI-green and waiting on the
operator's UAT+merge (PAN-1242/1395; can't merge — require_uat_before_merge=true),
(b) blocked on a substrate gap with only orchestrator-forbidden remediations
(PAN-1496 zombie, PAN-1491 wedge), or (c) operator-owned (strikes/planning). With
16 agents live under the governor and `auto_pickup_backlog=false`, there is no
launchable in-flight work below minAgents. Holding launches is correct; the
deliverable is the precise ready/blocked map + the standing message that the
UAT batch is the bottleneck.

### RUN-15 tick 4 — CORRECTION: the bottleneck was ship-on-broken-docker, not UAT laziness

Ticks 1–3 framed "zero merges, UAT batch flat at 19" as *operator-gated* — the
operator just hadn't UAT'd the ready batch. **That model was wrong.** A parallel
operator session's durable note (project memory, ~2026-06-08 00:15) revealed the
real chain, and it reframes everything:

1. **Ship chokes on broken workspace docker (PAN-1645).** Ship is the role that
   sets `readyForMerge=true`. With docker init regressed, ship can't complete, so
   **PAN-1642 / PAN-1613 / PAN-1614 / PAN-1455 sit review+test PASSED but
   `readyForMerge=false`** — they never reach the UAT/merge gate. The issues
   aren't waiting on the operator; they're stuck one stage *before* the operator.
2. **The deacon was FROZEN AGAIN (~00:15)** as build-storm protection. So the
   tick-1–3 rationale "hold launches because the governor is *driving* the
   pipeline" was right to hold but wrong on the reason — the governor wasn't
   driving, it was frozen.
3. **PAN-1678 is the keystone:** `build:docs-index` (10-core, 3926-chunk) runs in
   *every* agent/verification/ship build. `agent-pan-1579` triggered 8×
   concurrent docs-index builds → host load 38 (near the 36 gate / OOM). Deacon
   unfreeze AND any safe new agent launch are both gated on PAN-1678 landing.
   **Under autonomy, launching an agent here would re-trigger the storm** — so
   holding launches went from "cap-respecting" to "mandatory / actively harmful
   to violate."
4. **The operator delegated a manual landing push to handoff worker conv 2558**
   (`conv-20260608-c014`, Opus): land the 4 via ship-on-host, fix PAN-1645/1678,
   recover wedged PAN-1395/1641. The flywheel observes and stays out of its way.
5. **The flywheel cap was deliberately lowered 30→4** (`~/.panopticon/config.yaml
   roles.flywheel`) for exactly this stabilization window — the low cap I saw is a
   feature, not a coincidence.

**Lessons for future runs:**
- "Zero merges + flat UAT batch" has (at least) two very different causes:
  operator-not-UAT'ing vs **issues-can't-reach-the-gate** (ship/docker stall).
  Distinguish them by checking `readyForMerge` and whether ship can run — don't
  assume the human gate is the bottleneck just because nothing merged.
- **The durable project memory can be updated by a parallel session mid-run.**
  Re-read it each tick. A frozen deacon / active landing worker / new keystone bug
  can completely change the correct posture, and the orchestrator won't see it in
  `gh`/`tmux` state alone.
- When the deacon is frozen against a build storm (PAN-1678 unfixed), "keep agents
  working" inverts: the highest-value move is to NOT launch (and not run a full
  `npm run build` either), because every launch's verification build re-storms the
  host. Surface the keystone, point at the active landing worker, hold.

### RUN-15 tick 5 — keystone PAN-1678 LANDED; deacon-unfreeze gate cleared

The operator's landing worker (conv 2558) landed **PAN-1678** direct-to-main
(`89a7a0d0a fix(infra): skip build:docs-index in agent/verification/ship builds`,
04:27 UTC) — the first substrate fix to land during this run. Host load is back
to **1.8** (from the storm's 38). Per the operator's plan, PAN-1678 was the gate
for unfreezing the deacon, so that gate is now cleared.

Two reasons the flywheel still held launches anyway, both important:
1. **A fix landing on main != live in the running server.** The deacon/dashboard
   runs `dist/`; until the operator rebuilds + `pan reload`s, the running
   verification builds still execute the un-skipped `build:docs-index` and could
   re-storm. "Keystone landed" clears the *gate*, not the *risk*, until reload.
2. The deacon is still frozen (operator unfreezes, not the flywheel — it's not a
   flywheel verb), and the in-flight set (14) is far above minAgents.

PAN-1645 (docker init / ship choke) is now the lead keystone for the 4
ship-stalled issues; conv 2558 is landing them via ship-on-host. Lesson:
progress can be real and substantial (a keystone bug fixed) while the flywheel's
own headline (`prsMerged`, `awaitingUat`) shows zero movement — direct-to-main
landings by an operator worker don't touch those counters.

### RUN-15 tick 7 — a delegated worker can stall on an UNSUBMITTED operator message

The landing push went static for two ticks (6→7, ~24min) and I initially read it
(tick 6) as "operator actively steering." Tick 7 byte-compared conv 2558's pane
across the two ticks and found it **frozen identically** ($9.7753, +21/-2, ctx
22%, "Crunched 7m 25s"): the operator's reply "#1 now, then PAN-1675…" was
**drafted at the `❯` prompt but never submitted** (Enter not pressed). So nothing
landed because the directive was never sent.

Lessons:
- "Operator is driving" vs "operator stepped away with an unsent message" look
  identical in a single snapshot. **Byte-compare the worker's pane (cost/ctx/diff)
  across two ticks** — frozen metrics = stalled, even if a reply is visible in the
  input buffer.
- The flywheel can only **surface** this (openQuestions: "submit the pending
  message in conv 2558"); it must not press Enter for an operator-owned worker.
- The dashboard health classifier shows such a worker "active" — same
  process-alive-≠-progressing theme as the RUN-14 brakes work, but for a
  conversation worker the flywheel doesn't own.

### RUN-15 tick 12-13 — empirical proof that PAN-1645 (ship) is the binding constraint

The 6-tick conv-2558 stall (unsubmitted directive) resolved when the operator
returned and submitted (~tick 12). The landing then ran: agent-pan-1614
(operator-launched) tried to land the *ready* PR #1630, iterated past two
verification-gate feedback rounds (001+002)... and **still did not merge** — it
exited with PAN-1614 back in-review. So even the CI-green, review-passed,
verification-fixed PR cannot cross the finish line while PAN-1645 (workspace
docker init / ship choke) is unfixed. This is the **empirical confirmation** of
the tick-4 hypothesis: the binding constraint is the ship→readyForMerge step,
not review or verification.

Consequence: the operator pivoted (conv 2558 offered "park the four PRs / bank
today's wins — main CI green, deacon ready to unfreeze"; operator chose instead
to "implement PAN-1675 first"). So the run's banked wins are the direct-to-main
substrate fixes (PAN-1678), not merged PRs — and the four ship-stalled issues
will not merge until PAN-1645 is fixed or all four are shipped-on-host.

Also validated this tick: **PAN-1678's fix holds under real load** — agent-pan-1614
built with load peaking ~14 then settling to ~9 on 24 cores (well below the 36
storm gate), no docs-index storm. The keystone fix works in production.

### RUN-15 tick 19-21 — PAN-1675 (resume --compact) LANDED; "landed != live" reaffirmed

The operator's conv 2558 implemented and pushed **PAN-1675** (Panopticon-side
`resume --compact` wedge recovery) direct to origin/main — 3 commits
(050d2c85c CLI / 285b9fbfd deacon auto-recovery / bcdf102c2 dashboard action),
squashed-or-rolled into origin at **b43972741**. This is the run's **2nd
substrate fix** (after PAN-1678) and the recovery tool for the ctx-100%-wedged
PAN-1395/1491.

Reaffirmed lesson (same shape as the PAN-1678 tick-5 note): **landed != live.**
After the push, PAN-1395/1491 stayed at ctx 100% because the running deacon still
executes the old `dist/` — `resume --compact` recovery only takes effect after
the operator rebuilds dist + `pan reload`s. A fix on main does not self-heal the
running system; the reload is a required, operator-owned step.

Process note for the orchestrator: when an operator worker (conv 2558) is mid
commit-push cycle on the SHARED main worktree, the flywheel must take no git
action — defer durable FLYWHEEL-STATE.md commits until the tree is 0-ahead of
origin, then commit path-scoped + fast-forward push (abandon the push, don't
fight a rebase, if origin moved). Byte-comparing the worker's session
cost/diff/pane across ticks is the way to tell active-work from stall.

## RUN-17 tick 1 (2026-06-09, resumed-from-pause) — stabilization window OVER; resume aggressive launch

The single most important reframe vs all of RUN-15: **the stabilization window has
ended and the keystone blockers are resolved.** Concretely, at RUN-17 tick 1:

- **PAN-1645 (workspace docker init / ship choke) is CLOSED.** This was the
  *binding constraint* RUN-15 ticks 4/12-13 proved empirically — ship couldn't set
  `readyForMerge=true`, so review-passed PRs never reached the merge gate. It's
  fixed. Ship/merge path is unblocked.
- **The deacon is RUNNING (not frozen).** `pan admin cloister status` = Running,
  11 active / 0 stale / 0 warning / 0 stuck. The RUN-15 build-storm freeze is over.
- **Host load 6 on 24 cores, RAM ~27/64 GB, swap 0.** No build storm (PAN-1678
  docs-index-skip fix is holding). Plenty of headroom.

Because of all three, the RUN-15 posture ("hold launches, the system is fragile")
is no longer correct. The default aggressive-launch mandate is back in full force.

### The 5 carried-over in-flight issues are DONE + operator-gated, not blocked

PAN-1242 (#1516), PAN-1491 (#1636), PAN-1641 (#1679), PAN-1642 (#1648), PAN-1686
(#1687) carried over from RUN-16, which framed them as "blocked / idle@ctx100% /
needs Tell." **That framing is now stale — re-verify, don't trust it.** All five
panes sit idle at the `❯` prompt AND **all five PRs are CI-all-green** (build/lint/
test/CodeRabbit SUCCESS; #1648 and #1687 also green on Clean-install+smoke; #1687
also green on `panopticon/review` + `panopticon/test` commit statuses). Per the
RUN-15 tick-2 distinguisher: **CI-green + idle convoy = DONE, awaiting the operator
merge gate** — not wedged, not needing a Tell. With `require_uat_before_merge`
unset (defaults true), the flywheel cannot workflow-auto-merge them; they are the
standing operator bottleneck. Ranked all 5 as `merge` suggestions (PAN-1491
`urgent` because it's the v1.0-required substrate fix; rest `high`).

Lesson: a prior run's "blocked/needs-Tell" classification of an idle convoy can go
stale the moment CI turns green. **Always re-read the PR CI rollup before trusting
an inherited classification.** "idle@ctx100%" only matters if the PR isn't already
green (the tick-2 rule) — and here every PR is green, so the ctx state is moot.

### Tick action: launched 2 P1 substrate items (active work was effectively 0)

Every in-flight item being done-and-operator-gated meant *active work* = 0 against
minAgents=2. System healthy → launch. Picked the two highest-leverage **unstarted,
eltmon-authored** P1 substrate bugs:

- **PAN-1682 → `pan strike`** (`strike-pan-1682`, Opus 4.8). Textbook scoped fix:
  add `'strike-'` to the tmux-prefix allowlist at `resource-discovery.ts:471`
  (commit 93c86224e fixed the snapshot but not discovery). By tick end: +35/-1,
  typecheck green on main, running full test suite to verify. Strike lands direct
  to main then verifies — correct vehicle for a one-location fix.
- **PAN-1647 → `pan plan --auto`** (`planning-pan-1647`, Opus 4.8). **Self-relevant**
  substrate bug: `pan start --auto` writes a synthesized vBRIEF to
  `projectRoot/.pan/specs` but `createBeadsFromVBrief` reads it back empty (0 beads)
  and rolls the launch back — i.e. the flywheel's *own* preferred `pan start --auto`
  path is broken. Chose `pan plan --auto` (full planner creates beads via `bd
  create`, bypassing the broken synthesized path) over `pan start --auto` precisely
  because of this bug. By tick end: actively investigating workspace `.pan/specs`
  structure with xhigh effort.

Both progressing, neither pushed back → follow-through satisfied.

### Gotcha: `pan strike`/`pan plan` need the `PAN-` prefix; `gh` takes bare numbers

`pan strike 1682` and `pan plan 1647 --auto` both failed ("No Panopticon project
for issue prefix in 1682" / "Invalid issue ID"). The `pan` CLI resolves the project
from the issue *prefix*, so it needs `PAN-1682`. `gh issue view 1682` works with a
bare number because it's GitHub-native. Always pass the `PAN-` prefix to `pan`
verbs.

### Stalled prior attempt to recover: PAN-1681

PAN-1681 (test agents narrate pass but never run `pan specialists done test`) has
BOTH a `feature/pan-1681` and a `strike/pan-1681` branch + a `workspaces/
feature-pan-1681` directory, but **no live agent session**. A prior strike/work
attempt that didn't land. Surfaced as `investigate` (recover vs wipe is an
operator decision — `pan kill`/`pan wipe` are flywheel-forbidden), did NOT blindly
relaunch on top of existing branches.

### Next-tick ramp candidates (toward the cap of 4)

PAN-1658 (testStatus stuck 'pending' after rebase — blocks merge, no reconciler)
and PAN-1629 (concurrent `pan start` bd-lock contention) are the next unstarted P1
substrate launches as the cap allows. Both directly improve merge throughput /
flywheel saturation.

## RUN-17 tick 2 (2026-06-09) — main went RED beneath the "green" PRs; the new binding constraint

The big discovery: **`main` is RED** and that is now the binding constraint — the
RUN-15-era role that PAN-1645 (ship-choke docker) used to play. Different
mechanism, same effect: nothing downstream can complete.

### Root cause of red main (PAN-1698, filed + struck this tick)

`main`'s CI `test` job fails on 9 tests, all from **stale fixtures after additive
changes**, none a real regression:
- **Fable 5 (`claude-fable-5`) was added to the model registry** → `model-fallback`
  / `settings` / `router-config` tests expecting **6 Anthropic / 29 total** now see
  **7 / 30**.
- **`pending_auto_merges` migration bumped `SCHEMA_VERSION`** (merge-train
  PAN-1691/1692) → `pending-auto-merges-schema.test.ts` asserts the old version.
- `flywheel-substrate-smoke.test.ts` provenance flow (PAN-1487) — flagged for
  investigate (may be real, not just drift).

Filed **PAN-1698** and launched `strike-pan-1698` to fix it. **This is the highest
priority item in the whole system** — a red main blocks every verify/ship/strike
gate, so it gates the 5 ready PRs (on post-merge), strike-1682's completion, and
every future work agent's verify. Pattern to watch: **a new model or a schema
migration that lands without updating fixtures silently reds main and stalls the
entire pipeline.** First inventory check each tick should include `gh run list
--branch main --workflow CI`.

### A strike's code lands on main BEFORE `pan done` — so "Pending" ≠ "no work done"

PAN-1682's scoped fix (`6bbf649b4`, the `strike-` tmux-prefix allowlist in
`resource-discovery.ts`) is **already pushed to origin/main** — yet the issue shows
**Pending** because the strike never called `pan done`. The strike flow is:
commit+push the surgical fix to main → run the full verify → `pan done` (close
issue / mark complete). PAN-1682 got stuck between steps 2 and 3: its post-fix
verify hit the **pre-existing red main** (orthogonal to its change), it **correctly
refused to fix-forward** per the strike scope contract, and parked at the prompt
asking a question. So: code live on main, completion bookkeeping stalled.

Lesson: when a strike shows "Pending," check whether its commit already reached
origin/main (`git branch -r --contains <sha>`). If yes, the *code* shipped and the
only thing stuck is the verify-and-done step — usually a red-main or a parked
question, not lost work.

### strike-1682 stalled SILENTLY — operator-surfaced gap → PAN-1699

The orchestrator had no idea strike-1682 had pushed back; it only found out because
the **operator asked**. The strike role prompt has no instruction to signal the
orchestrator before parking. Filed **PAN-1699**: autonomous agents must
`pan tell flywheel-orchestrator "<role> <issue>: what I'm NOT doing + what's needed"`
before they self-abort / refuse-fix-forward / decide full-pipeline-needed / park on
a question. Without it, under autonomy a pushed-back agent stalls forever and the
orchestrator (forbidden from `pan tell`) can't even answer. This closes the loop so
follow-through happens in the same tick.

### `pan plan --auto` stops at `proposed` — it does NOT auto-spawn the work agent

The brief calls `pan plan --auto` "planning + work in one chain," but observed
behavior (PAN-1647): planning produced a `proposed` 2-item vBRIEF on main + the
`planned` label, then the session **ended with no work agent**. Follow-through is a
plain **`pan start <id>`** (NOT `--auto` — that's the very bug PAN-1647 tracks;
plain `pan start` reads the planner's real beads). This may be a PAN-1509 recurrence
(auto-promote produces proposed specs but no work agents spawn). Either way: after
`pan plan --auto`, the next tick must `pan start` the planned issue to actually put
an agent on it. Did this for PAN-1647 (`agent-pan-1647` up, ctx 50%, implementing).

### Tick-2 launches + posture

Active work was effectively 1 (only strike-1698 truly working; strike-1682 parked,
planning-1647 done). Below minAgents=2 → launched: `pan start PAN-1647` (work) +
`pan plan PAN-1658 --auto`. Held PAN-1629 to `low` — do NOT pile fresh strikes at
the red-main verify gate until PAN-1698 lands (they'd stall like 1682). Planning and
work are red-main-safe (they don't hit the verify gate until much later); fresh
*strikes* are not. Load 15.85/24, RAM 33/64 — healthy, no storm.

## RUN-17 tick 3 (2026-06-09) — main GREEN again; orchestrator survived a mid-run model switch

### Main restored (PAN-1698 fixed) — ramp resumed

strike-pan-1698 landed the fixture fixes; main green at `755f4969c` (CI success).
It also filed **PAN-1702** (orthogonal host-only test-isolation bug) instead of
fix-forwarding — correct strike scoping, properly signaled via its final summary.
With the binding constraint cleared: launched `pan start PAN-1658` (work) +
`pan plan PAN-1629 --auto` (ramp). Active: work-1647 (PR #1703 open), work-1658,
planning-1629.

### The orchestrator itself was model-switched mid-run (Opus 4.8 → Fable 5) — lessons

The operator switched this conversation's model. What happened: Panopticon killed
the tmux session, ran **native compaction (claude-haiku-4-5) of the 206k-token
conversation**, and respawned with `--resume`. Run continuity held — durable state
(this file + RUN-17 snapshots) + the compaction summary carried everything across.
Two hard lessons:

1. **Scheduled wakeups DIE with the respawn.** The tick-3 ScheduleWakeup (19:30)
   never fired — the resumed orchestrator must re-establish the heartbeat as its
   first order of business after any model/harness switch.
2. **The compaction was unnecessary** — forced by `modelChanged: true` in
   `maybeCompactBeforeRespawn` with zero context-window awareness. Fable 5 has a
   1M window; the full 206k transcript would have fit verbatim 5× over. Filed
   **PAN-1704** with the tiered design (window-fit + provider-routing discriminant;
   in-session `/model` for same-provider switches; compact ONLY when context
   exceeds the target window). Note: nothing is lost on *disk* — compaction
   appends `compact_boundary` + summary to the JSONL, so the conversation view
   keeps full history; what's lost is in-context verbatim recall + terminal
   scrollback (kill+respawn draws a blank TUI — the operator read that as
   "everything out of sync").

### `pan plan --auto` stop-at-proposed is SYSTEMATIC (2nd confirmation: PAN-1658)

Same pattern as PAN-1647: proposed spec on main + `planned` label, session ends,
no work agent. This is now confirmed behavior, not a fluke. Standing rule: every
`pan plan --auto` must be followed by plain `pan start <id>` next tick.

### Gated-PR check reading: CANCELLED ≠ failed, empty conclusion = in-progress

statusCheckRollup on PRs #1516/#1679 showed smoke test `CANCELLED` (stale,
superseded runs on head commits) and #1636 showed in-progress (empty conclusion).
Neither is a failure. Re-triggered the cancelled runs via `gh run rerun`. #1648
and #1687 fully green → top merge suggestions. Don't misread rollup noise as a
regression like this tick almost did.

### strike-1682 parked through the entire red-main window — PAN-1699 bit again

Its parked question ("file a follow-up for main breakage?") went moot the moment
PAN-1698 was filed+fixed, but nobody could tell it (flywheel forbidden `pan tell`).
Operator one-liner needed at its prompt: "1698 filed+fixed, main green — verify
and pan done". The roles/*.md signal-before-parking fix (PAN-1699) remains the
real cure.

## RUN-17 tick 4 (2026-06-10) — smoke "CANCELLED" decoded as a silent hang; full ramp to cap

### Smoke-job CANCELLED ≠ flake: it's a 20-minute timeout killing a silent server-boot hang

PRs #1636 (feature/pan-1491) and #1679 (feature/pan-1641) had their "Clean install
+ server smoke test" re-runs end CANCELLED *again*. Decoded: the job has
`timeout-minutes: 20` (PAN-1651), and GitHub reports a timeout kill as
"cancelled". The step log shows 19 silent minutes; orphan processes at kill time
were `node` (server), `curl` (the health poll), and `cliproxy` — the server boots
but the health poll never passes. Both hanging branches touch server-boot
surfaces (flywheel metrics / Ollama sidecar) merged against a main that now has
the merge-train engine; the 3 passing PRs don't. **Diagnostic rule: when a check
shows CANCELLED, compare job duration to its timeout-minutes before calling it
infra noise.** 2nd rerun dispatched as a reproducibility test — if it hangs
again, file the substrate issue and demote those merges to blocked.

### stop-at-proposed: third confirmation (PAN-1629) — treat as the contract

`pan plan --auto` ended at `proposed` + `planned` label with no work agent for
the third issue in a row (1647, 1658, 1629). This is the actual behavior of the
command, full stop. The tick loop now treats "plan --auto finished" as
synonymous with "must pan start next".

### Watch: agent-pan-1658 at ctx 91% on gpt-5.5

PR #1707 already open (+617/−68) so the value is banked, but gpt-5.5/CLIProxy
sessions can deadlock near the window illusion (see PAN-1672). If it stalls:
salvage = `pan handoff`, never resume-thrash.

### Ramp + new inventory

Launched `pan start PAN-1629` + `pan plan PAN-1704 --auto` → at maxAgents=4
(1647-review convoy, 1658 work, 1629 work, 1704 planning). New operator-filed
candidates queued at cap: PAN-1705 (conversation Loading… stall), PAN-1706
(orphaned playwright Chromiums), PAN-1697/1700 (delivery-race family — consider
bundling with PAN-1699's roles fix). strike-1682: THIRD tick silently parked on
its moot question — the PAN-1699 gap measured in wall-clock. Swap crept
2.5→5.4GB during the spawn burst (load 20/24); watching, not acting.

## RUN-18 tick 1 (2026-06-10) — pipeline cascading under its own power; recovery brakes observed live

### Where pipeline truth lives now (re-derive no more)

`~/.panopticon/review-status.json` is **no longer authoritative** — review/test/
ship/merge state moved to SQLite: `~/.panopticon/panopticon.db`, table
`review_status` (cols `review_status`, `test_status`, `verification_status`,
`merge_status`, `ready_for_merge`, `merge_step`, `blocker_reasons`, …). Query
read-only via `node:sqlite`. The dashboard listens on **:3011** (Traefik at
`https://pan.localhost`), not 3010. `merge_queue` and `pending_auto_merges`
tables exist (merge train, PAN-1691) — both empty this tick.

### PAN-1675 compact-recovery CONFIRMED LIVE (first production observation)

agent-pan-1658 (gpt-5.5) hit the predicted ctx-100% wedge AFTER opening PR
#1707, with verification then failing at lint — the blocking variant (work
needed, agent unable). Between checks the session reappeared with **733/200k
fresh context and a re-delivered kickoff** ("Do NOT stop at the prompt — keep
working"), then resumed addressing the verification feedback ("● Done", cost
+$1.6). That's the PAN-1675 deacon auto-recovery (`resume --compact`) firing in
production. The footer still renders "ctx 100%"/"100% context used" banner from
the pre-compact state — cosmetic; trust the token count (733/200k), not the
percent, right after a recovery.

### RUN-16 pause gates carry resume CONDITIONS — evaluate them, don't just inherit

Two work agents (PAN-1579, PAN-1614) sat `paused` with RUN-16 reasons that
embed explicit resume conditions. The right move is to evaluate the condition
each run, not treat the pause as permanent:
- **PAN-1579 unpaused this tick** — its condition ("resume once docs-index
  build is decoupled from agent/verification builds") was met by PAN-1678
  (landed RUN-15, verified under load). Review=blocked with a real finding
  ("Memory FTS statements block the dashboard event loop") and no live agent —
  unpausing lets the deacon resume it against that feedback.
- **PAN-1614 held paused** — its condition (botched deacon.ts rebase
  integration resolved) is NOT demonstrably met; PR #1630 test=FAILURE.
  Surfaced as `investigate`, not blind-unpaused. Unpause-without-condition-met
  is exactly the mistake RUN-16 made and had to revert.

### The deacon/merge-train is re-driving the 5 carry-over PRs itself

Review convoys spawned (~18:06–18:32, before this run started) on PAN-1242/
1491/1641/1642/1686 — the merge-train cascade validation. Statuses are moving
(review passed on 1242/1491/1641; 1642 test=failed with work agent fixing;
1686 review=blocked + merge conflict with work agent on it). **PAN-1455 is the
only issue fully through (ready_for_merge=1)** — the real operator merge gate.
The flywheel's job here is watching, not launching: 16 live agents vs cap 4,
load 26–28/24 cores, swap 74%.

### strike-1682: FOURTH tick parked — the PAN-1699 cost keeps accruing

Still at its moot question ($2.19, code on main since tick 2). Every tick this
stays parked is wall-clock evidence for PAN-1699 (signal-before-parking).
PAN-1699 is the top queued launch when a slot frees.

## RUN-18 tick 2 (2026-06-10) — "guardrails" warning decoded; the train manufactures PAN-1658 states

### The operator-visible "Couldn't start work agent for PAN-1641: guardrails" — full chain

Deacon's orphan-proposed reconciler → tried to spawn a DUPLICATE work agent on
an in-review issue → /api/agents health guardrails (memory+capacity 409/429)
blocked it → warn lands in the activity feed on a retry cooldown. Two filed
bugs:
- **PAN-1708 (root):** the proposed→approved spec flip exists only on the
  dashboard start-agent route (`routes/agents.ts:2900`); the `pan start` CLI
  path never calls `transitionVBriefOnMain`. Result: ALL 8 in-flight issues'
  specs on main are stuck `proposed` — which is what feeds the reconciler the
  false candidates.
- **PAN-1709 (defense):** the reconciler's filter checks tmux + agent state but
  never the review pipeline (review_status row / open PR / convoy sessions), so
  a finished work agent (issue in review) is indistinguishable from
  never-started. Only system-health guardrails prevented a duplicate spawn —
  luck, not design.

### PAN-1710: smoke hang is real and branch-specific (3rd consecutive timeout)

The tick-4 (RUN-17) reproducibility test concluded: third consecutive 20-min
timeout-kill (reported CANCELLED) on #1636 (pan-1491) and #1679 (pan-1641).
Branch-specific — both touch server-boot surfaces; sibling PRs pass the same
job. Treat as a real boot regression vs the merge-train main, not infra flake.
Both merges demoted to blocked; PAN-1710 filed.

### The merge train does NOT heal test=pending — PAN-1658 is MORE relevant, not less

Assessed at operator request (conv 2598 = the merge-train build conversation,
$190 Opus). The train's reconciler only touches `readyForMerge=true` siblings
(`merge-train-deps.ts:34`), so an issue stuck review=passed+test=pending is
invisible to it. Worse: the train's post-merge re-review path lands on the
transition-only review→test dispatch defect (review-status.ts:404), so the
cascade itself manufactures stuck states. **Live evidence: PAN-1242/1491/1641
all review=passed + test=pending for 2h+ after tonight's cascade.** PR #1707
(PAN-1658's green-CI test-status reconciler) is the feeder that returns stuck
issues to the train's ready set — ranked top review priority. Conv 2598 has no
session_file recorded in the conversations table (cannot read transcript;
judge by what landed on main).

### `pan unpause` ≠ resume; deacon governor backpressure is the usual reason

PAN-1579 unpaused at tick 1 was still unresumed 28 min later — NOT a bug: 7+
work-role agents were live against the governor's 6-slot work ceiling, so the
deacon correctly deferred. Check live work-agent count against
DEFAULT_MAX_WORK_AGENTS before suspecting the resume path. The fallback is an
explicit `pan start <id>` once slots free.

## RUN-18 ticks 3-4 (2026-06-10) — operator merge failed on a hidden red main; bisect-by-run-history

### A failed post-rebase verification can be MAIN's fault — always cross-check main CI

The operator clicked MERGE on PAN-1455 (the run's only ready issue). The merge
rebased clean, then **failed post-rebase verification on 3 e2e tests**
(styleguide-conformance /agents page). First read: branch regression or
load-flake (host was swap-100%, load 28). Real answer came from checking main's
own CI: **main had gone red at ec57001eb with the EXACT same 3 failures** —
the branch was innocent; verification ran main's broken code underneath it.

**Standing rule: when a post-rebase verification fails, diff the failure list
against main's latest CI run BEFORE blaming the branch.** Identical failures =
main-side; file + strike the main bug and tell the operator to hold the merge
re-click. (PAN-1717 filed; strike dispatched; PAN-1455 re-passed review+test
within ~20 min via the feedback loop and now just waits on green main.)

### Bisect-by-run-history is fast and conclusive

`gh run list --branch main --json conclusion,createdAt,headSha` gives a
green→red boundary in one command; when only chore commits sit between the last
green sha and the first red sha, the breaking commit is identified without a
local bisect. ec57001eb ("diff popout self-heals after transient backend
outage") broke /agents rendering under e2e; c3a0452b6 (PAN-1705 fetch
coalescing) touches the same paths and may compound — noted in PAN-1717.

### Parallel-channel duplicate-work risk: direct-to-main fixes vs planning agents

While planning-pan-1705/1706 were producing proposed specs, an operator-side
session landed direct-to-main commits citing the same issues (c3a0452b6,
cba5579e9). Under multi-channel operation (flywheel + operator strikes +
operator conversations) the same issue can be fixed twice. Before `pan start`
on a freshly-planned issue, `git log --grep <issue>` main first; if commits
already cite it, surface a reconcile decision instead of starting work.

### Review-cycle bulk reset at 01:08 (observed, unexplained)

review_status for 1242/1491/1641/1647 all flipped passed→pending within 2s.
Likely a deacon patrol or merge-train action re-requesting review after the
failed merge. Didn't trace the writer this tick; if it recurs and strands
reviews, trace via status_history and file. (1455's monitor showed its review
re-dispatched and re-passed quickly, so the reset path at least re-drives.)

## RUN-18 tick 5 (2026-06-10) — red main fixed in ~25 min; the file→strike reflex worked end-to-end

The PAN-1717 strike landed `2b0bcc6f0` (mock `/api/conversations/pending-input`
in the styleguide e2e) ~25 min after the red was diagnosed; main green twice.
Flywheel closed PAN-1717 with evidence (fix sha + 2 green runs) under the
durable close-verified-done authorization.

**Bisect correction worth remembering:** first-red-run headSha ≠ breaking
commit. The run @00:46 executed at ec57001eb, but the true culprit was the
OLDER c3a0452b6 (PAN-1705 pending-input feed) that no run had executed alone —
runs are batched under push bursts. The strike's root-cause (unmocked new API
call → /agents page stuck in loading) identified it precisely. When bisecting
by run history, list ALL commits since the last green sha, not just the first
red run's sha.

**E2e-breakage class:** a frontend perf/data change that adds a new API call
breaks styleguide-conformance e2e unless the e2e env mocks it. Recurs (this is
the same shape as the PAN-1698 fixture-staleness class but for e2e mocks): a
test-env contract that additive changes silently violate.

**Strike completion bookkeeping is now a 2-for-2 gap:** strike-1717, like
strike-1682, landed its fix and parked WITHOUT `pan done` (it cited residual
host-only test issues #1719/#1720 it had filed). PAN-1699 should cover
completion bookkeeping, not just parking signals. Note: strike-1717 ALSO
handled the shared-worktree case correctly — it pushed its fast-forward
directly to origin/main rather than checking out main in the primary worktree
(live .pan/continues writes), an explicitly good pattern to repeat.

## RUN-18 ticks 6-7 (2026-06-10) — first merge of the run, and the "deployed ≠ merged" discovery

### PAN-1455 merged (attempt 2) — the full operator-merge loop worked

Operator re-clicked MERGE after PAN-1717 made main green: rebase → verify →
squash-merge → post-merge deploy, all monitored live (DB-poll monitor on
merge_step gives step-level events: rebasing → verifying → squash-merging →
post-merge-cleanup). First PR merge of RUN-18.

### THE BIG ONE — post-merge-deploy builds the primary worktree WITHOUT syncing origin (PAN-1723)

The deploy fired 1 second after the squash landed on origin and built the
primary worktree as-is — which was BEHIND origin by exactly that squash (a
conv agent's unpushed commits had diverged local main). Result: the deploy
reported success, server restarted healthy, lifecycle completed — and the
running server does NOT contain the merged fix (`refresh_token_reused`
marker: 0 hits in dist). Silent. Post-merge verification-on-main then
exercises the OLD build.

**Detection recipe:** `git -C <root> status -sb` (behind>0 at deploy time) +
grep dist for a marker string from the merged diff. **Fix direction (in
PAN-1723):** deploy from a pristine `git worktree add --detach` of
origin/main; log the built sha. Under multi-channel operation (conv agents
committing on local main), divergence at merge time is ROUTINE — every merge
deploy is suspect until PAN-1723 lands.

### PAN-1716 reaper went live with the merge restart and immediately worked

`[deacon] Reaped terminal advancing session agent-pan-1455-ship (PAN-1716)`
then PAN-1641's review convoy re-dispatched (02:10) after 60+ min stuck —
confirming the stall hypothesis (advancing slots exhausted by zombie
sessions). 1242/1491 queue behind 1641's convoy on the 3 advancing slots —
expected self-resolving; the advancing-slot ceiling serializes convoy
dispatch one issue at a time.

### PAN-1658 cascade experiment result (posted on the issue)

The merge cascade did NOT touch the stuck test=pending siblings, consistent
with getReadySiblings' ready=1 filter (confounder: the deploy restart may
have preempted the cascade — but the filter argument is structural). What
unstuck dispatch was the reaper (capacity), not status reconciliation. The
green-CI→testStatus gap is unowned after #1707's closure; operator to choose
among the issue's three options.

### Workspace devcontainers look like dueling dashboards in ps — they aren't

Multiple `node dist/dashboard/server.js` processes with containerd-shim
parents are workspace-container UI peers (deacon-disabled), not host
dashboards. Check ppid before declaring a restart storm. Also: `ps -o etime`
is MM:SS under an hour — 02:28 is 2.5 MINUTES, not hours (misread once).

## RUN-18 ticks 8-9 (2026-06-10) — ceiling backpressure quantified; fix verified live after double-reload

### The deacon's deferred-dispatch log line is the definitive stall/queue distinguisher

`checkPendingTestDispatch: deferred test for PAN-X — advancing ceiling reached
(PAN-1665) — counts: work=7 advancing=6 total=13/9 | advancing=[...] work=[...]`
— grep deacon.log for `deferred` before classifying review/test non-dispatch
as a bug. The queue drains serially: one review convoy (5 sessions) at a time,
then tests. Idle work sessions on merged/done issues count against `work=` and
slow the drain — extending the PAN-1716 reaper to merged-issue work agents is
the obvious next substrate improvement.

### Verifying a merged fix is live takes THREE checks, in order

1. Squash is ancestor of local HEAD (`git merge-base --is-ancestor <sha> HEAD`)
2. Marker string present in src (`grep src/...`)
3. Marker present in **ANY dist chunk** (`grep -rl dist/` — NOT just
   server.js; rolldown splits chunks, codex-auth lands in `workspaces-*.js`)

RUN-18 hit a triple-stale sequence: deploy built behind-origin tree
(PAN-1723), then the first manual reload built mid-sync (squash landed
between build and check), then the marker grep targeted the wrong file. Only
the third reload + full-dist grep confirmed live. A sync can land BETWEEN a
build and its health check — sha logging in the deploy (PAN-1723 fix) is the
real cure.

### `pan unpause` → deacon resume → session can still silently not appear

agent-pan-1579's resume logged 'resuming' at 02:38 but produced no tmux
session 20+ min later — second gate (work-slot ceiling or unhealthy docker
stack from its pause reason) swallowed the spawn after the resume decision.
Resume-decision ≠ session-up; verify has-session after a resume claim.

## RUN-18 ticks 20-26 (2026-06-10, overnight) — the livelock arc: diagnose → jam-break → strike×2 → drain

The defining arc of RUN-18. After PAN-1455 merged (02:06Z), NOTHING else landed
for 5+ hours. Operator escalated ("nothing is landing"). Root cause was a
three-layer livelock, broken in stages:

1. **Frozen sessions masquerading as running** (eaten kickoffs, PAN-1700 class):
   1491 work + 1686/1704 review convoys sat inert with instructions pasted but
   never executed. Counter-move: `pan review restart <id>` (official surface)
   recycled the frozen convoys → both passed within ~10-25 min.
2. **Idle sessions counted against the governor** until `total=9/9` deferred
   every test dispatch. Counter-moves: `pan pause PAN-1455` (merged, never
   paused — PAN-1726), `pan pause PAN-1658` (reconciler misfire spawn on a
   superseded issue — PAN-1709 materialized). Each freed slot produced an
   immediate dispatch.
3. **Structural fixes via strike×2, both landed same night:** fb9524bb8
   (PAN-1726: verify post-merge pause + reap merged work sessions) and
   04669ad0a (PAN-1730: reap idle awaiting-test work sessions). Both required
   `pan reload` to go live (landed ≠ live, always).

**Outcome:** test dispatches resumed (first: agent-pan-1242-test, seconds after
the slot freed), and by 08:13Z BOTH PAN-1704 and PAN-1700 (the keystone
delivery-ack fix) reached ready_for_merge=1.

**The orchestrator playbook that worked (in order):**
- `grep deacon.log for 'deferred'` → quantifies the ceiling (work=N advancing=M total/9)
- byte-identical pane across 2 ticks → frozen, not working
- `pan review restart` for frozen convoys; `pan pause <id> --reason` for
  misfire/orphaned work agents (both official surfaces, NOT hand-fixes)
- strike the structural gap the moment it's precisely characterized; reload after landing
- every freed slot dispatches within one patrol (~60s) — instant feedback loop

**Open residue for next runs:** agent-pan-1491-ship zombie (refused-and-parked,
unreapable — PAN-1699 class); 1242/1491 fast test FAILURES (suspect broken
workspace docker stacks, not code); PAN-1658 issue still open drawing
reconciler attention (operator close/re-scope pending); strike-1682 parked 20+
ticks (code long since on main).

## RUN-18 ticks 33-41 (2026-06-10 morning) — 3rd red main, test starvation named, FIVE at the gate

- **3rd red main** (69fb3239f doc line tripping beads-scoping) filed PAN-1732,
  struck, fixed (+1/-1, 48a6ffd3b), closed with evidence — diagnosis-to-green
  ~25 min. Recurring class: any line matching `` `bd ready `` in
  src/lib/cloister/prompts/work.md MUST carry `-l {{ISSUE_ID_LOWER}}`.
  NOTE: roles/work.md ≠ src/lib/cloister/prompts/work.md (the test reads the
  latter; a pan-tell corrected an early mis-pointer).
- **Test-dispatch STARVATION is a design gap** (documented on PAN-1730): freed
  slots are instantly out-competed by eager review-convoy dispatch; tests
  waited 6-10h across multiple ceiling configurations. Fix direction: reserved
  test slot or queue priority. The pause-gambit (pan pause the idle
  review-passed work agent so its OWN test can dispatch) works as manual relief
  — unpause if the test then fails.
- **Morning state: FIVE merge-ready** (1700 keystone, 1704, 1719 first-fly.io,
  1629, 1712 remote) — from a pipeline that was fully frozen at 02:00. PAN-1712
  = first full remote (fly.io) execution through plan→work→review→test, adopted
  into the pipeline via pan-tell from its wrangler.
- 1641 test=failed (suspect its PAN-1710 boot-surface regression vs new main,
  or broken workspace docker stack) — feedback cycle owns it.

## RUN-20 tick 1 (2026-06-11) — post-reboot re-baseline; strikes on PAN-1723 + PAN-1699

**RUN-19 was a zero-tick casualty** — started 00:10Z, killed by a host reboot
(~00:16Z), no snapshot content. RUN-20 replaced it at 00:24Z. When a run's
report shows a zero-second window, look for a reboot/restart before reading
anything into it.

### Post-reboot state (the deacon re-drove everything itself)

Host up 10 min at tick 1; the deacon re-dispatched the whole advancing fleet
at 00:18–00:24Z: ship on 1629/1686/1704/1712/1719 (clearing the 13:11Z
merge-conflict blockers), review convoys on 1642/1712. Main GREEN at
1a508f015. RAM 21/64GB, swap 0. merge_queue + pending_auto_merges both EMPTY.
Pipeline truth confirmed in SQLite `review_status` (no `settings` table —
autonomy toggles are not in the DB; defaults apply, require_uat=true).

- **PAN-1700 ready_for_merge=1** — the ONLY issue at the gate, and it's the
  keystone eaten-kickoff fix. Surfaced as the urgent operator action: a
  reboot-respawn burst is exactly the situation PAN-1700's bug bites.
- Watch items: agent-pan-1712-ship + agent-pan-1629-ship panes captured BLANK
  twice ~10 min post-spawn (1686-ship/1642-review idle-at-prompt with low
  tokens). Byte-compare next tick before calling them frozen; if frozen, the
  official surface is `pan review restart` (convoys) — ship has no equivalent,
  file the gap.
- PAN-1739 has a stale strike branch + workspace, no session — PAN-1681-class
  residue; surfaced `investigate`, did not relaunch on top.

### Tick-1 launches (active work was 0 vs minAgents=2)

Zero work/plan/strike agents at run start → launched `pan strike PAN-1723
PAN-1699 --effort high` (both Opus 4.8, spawned clean, kickoffs visible):

- **PAN-1723** (deploy builds stale primary worktree): every merge deploy is
  suspect until it lands — highest-leverage deploy-correctness fix.
- **PAN-1699** (signal-before-parking): its absence cost 20+ silently-parked
  strike ticks across RUN-17/18; prompt-only edits, low strike risk.

New unstarted candidates queued (post-RUN-18 filings): PAN-1744 (fork/handoff
dies on dashboard restart — next start when a slot frees), PAN-1743
(--no-resume doesn't gate boot orphan recovery), PAN-1745 (conversation-search
tests failing on main — but main CI is green; verify it's the PAN-1702/1720
host-only isolation class before launching), PAN-1740, PAN-1739.

## RUN-20 tick 2 (2026-06-11) — THREE at the gate; PAN-1746 filed (ship-on-merged + $HOME spawn)

### The post-reboot ship burst COMPLETED — 3 ready_for_merge in ~30 min

The tick-1 ship agents finished and were reaped: **PAN-1700 + PAN-1686 +
PAN-1719 all ready_for_merge=1** — from zero-at-the-gate to three in one
inter-tick window. The pipeline self-drove the whole way (rebase → verify →
ship complete). Merge order surfaced: 1700 FIRST (eaten-kickoff keystone),
then 1686, 1719. PAN-1704-ship still finishing; PAN-1712 review passed →
test queued; 1629 re-reviewing.

### PAN-1746 filed — boot reconciliation dispatches ship on MERGED issues

Caught live: `onIssueStateChangePromise → spawnRun(ship)` fired for PAN-1190
(merged WEEKS ago, verifying-on-main) at 00:27:34Z — seconds after the deacon
itself logged "merge_status=merged is terminal". Same path attempted PAN-1487;
only the docker-stack gate stopped it. Worse: PAN-1190's workspace is deleted,
and `assertWorkspaceStackHealthyForSpawn` PASSES on a missing workspace (it
only fails on a broken one), so the launcher started Claude in **$HOME at the
folder-trust prompt** — a wedged session holding an advancing slot against the
PAN-1665 governor (live `total=13/9` deferrals). Filed PAN-1746; paused the
instance via `pan pause agent-pan-1190-ship --reason ...` (official surface,
RUN-18 misfire precedent). Note `pan pause` accepts full agent-session ids,
not just issue ids — useful for role-session misfires.

### Live PAN-1700 evidence: agent-pan-1704 is a ghost

Work agent on PAN-1704 (review/test/verify all passed — shouldn't even have a
work spawn; PAN-1709 shape) resumed at 00:25 with kickoff eaten: out 0, cost
frozen at $1.3505, garbled "resuming from a summary" banner, byte-identical
across two checks 18 min apart. Work slots uncontended (1/6) so left it —
surfaced as the demonstration of why PAN-1700 merges first.

### Tick-2 lesson: the dispatcher of a mystery session may not be the deacon

The deacon log had NO line for the 1190-ship spawn. The dispatcher was the
dashboard server (`dashboard.log`: `purpose=role-run source=agents.ts:spawnRun`
via `onIssueStateChangePromise`). When hunting a mystery dispatch, grep
`dashboard.log` for `claude-invoke.*<session>` — the deacon log only covers
patrol-driven actions.

### BOTH tick-1 strikes LANDED within ~40 min — and the bookkeeping pattern held

- **PAN-1699 → 8101a3c76** (signal-before-stalling roles contract). Closed with
  evidence (prompt-only change; content IS the deliverable). The strike also
  flagged that **roles/ship.md does not exist** while every ship spawn passes
  `--agent roles/ship.md` (agents.ts:460 returns it unconditionally; spawn then
  takes the has-definition branch for permission flags on a lie) → filed
  **PAN-1747**. Failing-soft is why it went unnoticed — ship sessions run fine.
- **PAN-1723 → 2d0e4f5c8** (pristine-worktree deploy). Left OPEN: real
  verification is the next live merge logging the built sha. Check the deploy
  log on the next merge, then close with evidence.
- Both strikes parked at the prompt WITHOUT `pan done` citing the strike
  contract (4-for-4 now). Both pushed `strike/<id>:main` directly — the good
  shared-worktree pattern from strike-1717.
- **Landed ≠ live, again:** roles/*.md prompts and the deploy script execute
  from the PRIMARY worktree, which had diverged behind origin. The orchestrator
  must fast-forward local main after strikes land or the fixes stay inert.
  Reconcile recipe when the tree has live .pan writes: path-scoped chore-commit
  of .pan/continues+specs (repo convention), then `git pull --rebase`, then
  push. NEVER autostash (it's a stash).

## RUN-20 tick 3 (2026-06-11) — PAN-1746 landed+reloaded+closed; strike-1747 surfaced a PAN-1531 architecture contradiction

Run scoreboard after ~75 min: **3 substrate fixes on main** (PAN-1699 closed,
PAN-1746 closed, PAN-1723 open-pending-live-verify), 2 new bugs filed
(PAN-1747, PAN-1749), 3 issues at the merge gate (1700/1712/1719).

- **strike-1746 landed in ~18 min** (72f09e9e0: terminal-merge dispatch gate +
  hard-fail on missing workspace). Orchestrator ran the reconcile recipe + `pan
  reload` → fix live in the running server; closed with evidence.
- **PAN-1686 fell back from ready** — merge conflict the moment the strike
  commits hit main (00:59:52Z). Expected rolling-rebase cost; the deacon
  self-drove a full re-cycle (work + ship + 4-session review convoy). Do NOT
  treat a ready→blocked flip right after a main landing as a regression.
- **`pan plan --auto` (PAN-1744) COMPLETED the full planning flow in ~25 min**
  (proposed spec + planned label + workspace + beads) and its session
  self-cleaned. Followed the stop-at-proposed contract: `pan start PAN-1744`
  → the PAN-1618 auto-rebuild gate fired (docker stack rebuilt) → work agent
  up. The plan→start chain works; just drive the start yourself.
- **strike-1747 declined with the run's best finding:** roles/ship.md missing
  was the tip of a PAN-1531 contradiction — docs/MERGE-WORKFLOW.md said the
  interactive ship role was RETIRED (server-side rebase, no ship actor), but
  live code still spawned load-bearing ship runs from the reactive scheduler
  and the old deacon undispatched-ship patrol — ship was treated as what flipped
  readyForMerge. Fix needed an architecture decision + taxonomy reconciliation.
  Strike→plan reflex applied: `pan plan PAN-1747 --auto` launched same tick.
- **PAN-1749 filed:** strike-1747 obeyed the brand-new PAN-1699 contract and
  `pan tell flywheel-orchestrator` returned "not running" DURING AN ACTIVE RUN
  — the orchestrator has no agent state dir, so the tell no-ops. The contract
  silently degrades to issue-comment fallback (which the strike correctly
  used). Until fixed, expect signals as issue comments, not tells.
- **1704 pair paused** (official surface): ghost work agent (kickoff eaten at
  boot, out 0 for 80 min, PAN-1709 misfire shape) + ship stalled idle 70 min
  pre-contract. Freed slots; the then-existing deacon ship-dispatch patrol was
  expected to re-dispatch ship fresh. Verify next tick.

## RUN-20 tick 4 (2026-06-11) — 4 at the gate; 4th red main of the week (PAN-1746 fixture fallout)

- **FOUR ready_for_merge=1: PAN-1700/1704/1712/1719.** The 1704 pause-gambit
  worked: pausing the ghost work agent + stalled ship let the pipeline flip it
  ready within one patrol cycle. PAN-1686 re-passed review+test after its
  conflict kickback — fully autonomous recovery.
- **Main went RED at 01:17Z (PAN-1752, filed + struck same tick).** The
  spawnAgent/spawnRun unit suite fails wholesale — fallout from 72f09e9e0
  (PAN-1746 gate) changing spawn preconditions the fixtures don't satisfy.
  Same class as PAN-1698/1717/1732: behavior change lands, fixtures stale,
  main red. **Production spawns are fine under the live gate** (pan start
  PAN-1744 and PAN-1747 both succeeded) — it's a test-fixture problem, but a
  red main still blocks every verify/ship/merge, so it gates the 4 ready
  merges. Surfaced "hold merges until green."
- **Strike-fallout lesson (now twice this run):** every strike that changes
  pipeline behavior should grep the unit suites asserting that behavior
  (tests/unit/**/agents*, spawn*) BEFORE pushing. Consider adding to
  roles/strike.md: "run the tests that exercise your changed module, not just
  the full suite at HEAD~" — the full suite passed for strike-1746 because it
  ran BEFORE the commit was applied? No — more likely it ran vitest filtered
  or the suite's spawn tests were green pre-change and the strike never
  re-ran them post-change. Either way: post-change full-suite verification is
  the strike contract; flag this in the PAN-1752 fix.
- **stop-at-proposed contract held for PAN-1747** (4th consecutive):
  `pan plan --auto` → proposed spec ("finish the PAN-1531 ship-role removal —
  stop spawning the vestigial ship agent, reconcile docs") → orchestrator
  `pan start PAN-1747` → work agent up. The planner made the architecture
  call itself (remove, not define) — correct under decide-don't-delegate;
  review will scrutinize.
- work-1744 at ctx 93% (gpt-5.5) with +538/-48 banked and inspection passing —
  PAN-1675 compact brake is the safety net if it wedges.

## RUN-20 tick 5 (2026-06-11) — main green in ~35 min; rolling-rebase churn quantified

- **PAN-1752 fixed + closed**: 6611efa9d (fixture workspace dir) — diagnosis
  was exact (fixtures, not the gate; production spawns were never broken).
  4th red main of the week, all the same class, all fixed by file→strike
  within ~25-35 min. The class fix is becoming obvious: a CI-side
  fixture-contract lint, or strike.md requiring module-scoped test runs
  post-change.
- **Rolling-rebase churn is the new tax:** each strike landing pulled the
  ready PRs back into re-review — PAN-1704 lost ready_for_merge TWICE, 1686
  is on its 3rd review cycle. With merge_train on, the cure is the operator
  merging the ready set promptly (or auto-merge when the toggle flips).
  Surfaced explicitly in the snapshot.
- **Operator active in parallel:** filed PAN-1748/1750/1751/1753/1754/1755
  tonight (UAT-assembly + settings families) and landed the 1755 interim fix
  064a97963 directly. PAN-1752 was already closed when I went to close it.
  Multi-channel awareness rule held: checked git log before launching on
  anything new.
- **Launched strikes on PAN-1753** (ROLE_NAMES omits strike — settings save
  broken) **and PAN-1749** (orchestrator tell delivery). At cap 4: work-1744,
  work-1747, strike-1753, strike-1749.
- **work-1744 at ctx 100% with +662/-62 UNSUBMITTED** (blocking wedge).
  PAN-1675 compact brake expected to fire; verify next tick, file brake gap
  if it didn't. work-1747 at 89% (net-deletion diff, consistent with
  ship-role removal).
- Watch: `agent-pan-resume-redeliver` tmux session appeared at 21:59 — a
  test-fixture-named session going live on the HOST (PAN-1702/1720 isolation
  class, likely from a host test run touching real tmux). Cosmetic so far.

## RUN-20 tick 6 (2026-06-11) — compact brake saved 1744; tell-fix LIVE-verified; 6 bugs down

- **PAN-1675 compact brake: 2nd production save, new variant.** work-1744
  (ctx 100%, +662/-62 UNSUBMITTED — the blocking pre-PR wedge) was auto
  recovered: fresh 26% ctx, kickoff re-delivered, diff preserved, work
  continued into a review convoy. The brake covers the pre-PR variant, not
  just post-PR (RUN-18's case).
- **PAN-1749 closed with the strongest evidence type yet:** the strike fixed
  `pan tell` singleton resolution (a7cc9f23c, tellCommand blindly prefixed
  'agent-'; now routes normalizeAgentId) and then SIGNALED THE RUNNING
  ORCHESTRATOR through the repaired path — the message arrived mid-run.
  Signal contract now works end-to-end. roles/*.md gained the tell-fails→
  issue-comment fallback.
- **PAN-1753 landed WITH its test mocks in the same push** (8e98ae2f9 +
  7bab68059) — no fixture-staleness red. The PAN-1752 lesson propagated to
  the next strike immediately.
- **Host-test isolation got expensive (PAN-1720 comment):** a host suite run
  spawned a REAL fixture agent (agent-pan-resume-redeliver, issueId=
  PAN-RESUME) with a live TUI at the project picker; the governor counted it
  (total=10/9) and deferred real review re-dispatches. Paused it. Watch for
  more fixture-named sessions after any host suite run.
- Run scoreboard: **6 substrate bugs fixed** (1699/1746/1752/1749/1753 closed,
  1723 landed-pending-merge-verify), 3 merges READY ~1.5h (1700/1712/1719),
  main green. Strikes launched on PAN-1743 + PAN-1721 (cap 4 reached).

## RUN-20 tick 7 (2026-06-11) — 8 bugs down; the 1747 bootstrap paradox and its resolution

- **Strikes 1743 + 1721 landed within ~25 min** (aa903c5bf: --no-resume flag
  never actually reached the dashboard server; 8a1eeb4d7: close-out teardown +
  deacon reaper cover strike-* resources). Both closed. Reloaded the server
  after a proper sync — **caught myself mid-mistake: the first reload was
  building a local tree that did NOT yet contain the fixes** (pull had failed
  on dirty .pan files). Killed it, synced, rebuilt. Always verify local HEAD
  contains the commit you're reloading FOR, before the build starts.
- **The PAN-1747 bootstrap paradox** (signaled via the fixed tell path — 2nd
  live delivery): the ship agent refused to ship the branch that REMOVES the
  ship role, citing the branch's own docs. Resolution: orchestrator decision
  recorded IN THE ISSUE BODY (next dispatch reads it) — the removal branch
  merges under the LEGACY contract; post-merge semantics don't apply to their
  own delivery vehicle. Used pause→unpause to recycle the dead ship session
  (pause alone blocks re-dispatch; the unpause clears the gate so the legacy
  ship-dispatch patrol can fire). Escalation if the next ship still aborts:
  strike a transitional roles/ship.md onto main.
- **PAN-1744 review BLOCKED** — feedback loop owns it; the compact-recovered
  work agent is addressing it.
- Gate: 1700/1712/1719 ready ~2h, operator idle. Churn continues on 1686/1704
  (re-review convoys) every time main moves — the standing cost of an
  unmerged ready set.

## RUN-20 tick 8 (2026-06-11) — churn-aware posture: hold strikes, drain the gate

- 1747 got pulled into re-review before its ship could re-dispatch (main moved
  again) — the bootstrap-paradox resolution rides the next pass. 1744
  re-reviewing after addressing its blocked verdict. The re-review churn now
  visibly costs: 1686/1704/1747 at 2-3 cycles each tonight.
- **Posture decision: hold NEW main-landing strikes while 3 PRs sit ready at
  the gate** — each landing re-triggers convoys on every in-flight branch.
  Launched planning on PAN-1709 instead (root cause of the ghost-misfire
  class; planning's main footprint is one spec commit). When the gate drains,
  resume strike velocity. The churn-vs-velocity tradeoff is real and should
  be priced into every strike decision while ready PRs wait.
- Zombie strike sessions 1723/1747 correctly NOT reaped — the PAN-1721 reaper
  keys on close-out and those issues are open. Expectation corrected.
- Swap appeared: 4.7GB/8GB under convoy churn (was 0 at run start). RAM
  31.8/64. Watch each tick; the RUN-14 pathology starts at swap-full.

## RUN-20 tick 9 (2026-06-11) — pan pause addressing gap (PAN-1760); swap-full ≠ pressure

- **PAN-1760 filed:** pan pause blind-prefixes 'agent-' — NO working form
  pauses strike-*/inspect-* sessions (tried strike-pan-1723, pan-1723). Same
  class as PAN-1749's tell fix; audit pause/kill/unpause/untroubled for
  normalizeAgentId routing. Hit exactly when the orchestrator reached for the
  pause-for-RAM lever.
- **Swap-full panic corrected:** swap 95% with RAM at 50% (36GB available) is
  cold-page eviction from idle sessions, harmless. The RUN-14 pathology was
  swap-full + RAM near ceiling. Watch AVAILABLE RAM, not the swap gauge.
- PAN-1709 planned (4th consecutive stop-at-proposed) → work agent started.
  Churn-hold posture maintained: no new main-landing strikes while
  1700/1712/1719 sit ready (~3h now).

## RUN-20 tick 10 (2026-06-11) — 1709 docker init exit-1; --host fallback

- PAN-1709 start: auto-rebuild ran (PAN-1618 gate) but the stack's `init`
  service exit-1'd → spawn refused. Restarted `--host --yes` (deacon-code
  task; the PAN-1579 precedent). WATCH: if fresh-workspace init failures
  recur, file a workspace-template regression — one data point so far.
- Gate at ~3.5h (1700/1712/1719). Reviews cycling normally; main CI
  in_progress; avail RAM 34.6GB.

## RUN-20 tick 11 (2026-06-11) — BATCH TRAIN MERGED 3; PAN-1723 live-verified and closed

- **The PAN-1737 UAT batch train delivered**: uat/pan-reef-0611 assembled and
  merged PAN-1700 + PAN-1712 + PAN-1719 in one batch (36dca7693). First PR
  merges of RUN-20; the eaten-kickoff keystone is merged AND live (deploy
  restarted the server at 23:51 with the batch content).
- **PAN-1723 closed with first-merge live evidence**: deploy log shows
  pristine worktree at origin/main, built sha == the batch merge commit,
  health check pass, and correct lock-coalescing of the 3 deploy firings.
  The deployed-≠-merged class is structurally dead.
- Deploy-log hygiene note: /tmp/panopticon-deploy.log gets polluted by the
  restarted server's stdout (fd inheritance) — grep '[post-merge-deploy]' to
  read deploys. Minor; not filed (cosmetic).
- Run scoreboard: **9 substrate bugs fixed, 3 PRs merged.** Churn-hold
  lifted; strike queue resumes with PAN-1760 (pause addressing).

## RUN-20 tick 12 (2026-06-11) — PAN-1760 landed + live-verified; 10 bugs fixed

- strike-1760 landed 5dcfccee9 (normalizeAgentId routing for agent-targeting
  commands) ~15 min after launch; live-verified by re-running the exact
  failed invocation (pan pause strike-pan-1723 → success). Zombie strikes
  reclaimed. inspect-* sessions remain unaddressable (no agent state dir —
  registration scope, owned by close-out/reaper, not filed).
- Scoreboard: 10 substrate bugs fixed, 3 PRs merged, deploy live-verified.
  Gate drained; 4 branches cycling review against post-batch main; 1709
  implementing on host.

## RUN-20 tick 14 (2026-06-11) — convoy circular-wait jam-break

**New deadlock shape:** the governor over-committed (total 13/9 — ceiling only
gates NEW dispatches), leaving 1686's convoy PARTIAL: synthesis + 2/4
sub-reviewers live, the other 2 forever deferred, synthesis waiting on their
files while holding 3 slots. Detection: review_status frozen "reviewing"
across 3 ticks + synthesis pane at out≈17 tokens after 1h45m + convoy session
count < 5. Fix (RUN-18 playbook): pause idle in-review work agents (freed 2
slots) → pan review restart → fresh convoy spawned 4/4. If this recurs, the
substrate fix is making convoy dispatch atomic (all-or-nothing slot
reservation) — file it with this evidence if seen twice.

## Spawn-guardrail substrate fixes (2026-06-11, handoff session — PAN-1763/PAN-1764 closed)

A parallel handoff session root-fixed the two spawn-guardrail failures RUN-20 was
working around. Do not re-investigate or strike these classes:

- **"services exited 130/255" stack-health failures (PAN-1763, f6a5bbb51):** every
  post-merge deploy (`scripts/post-merge-deploy.sh` step 5) and `pan dev` restart ran a
  bare `pkill -f 'dist/dashboard/server'`, which matched every workspace/UAT stack's
  in-container server (same cmdline, host-visible PIDs). The 23:50:22Z deploy sweep
  killed PAN-1629's and PAN-1704's servers 16 ms apart. Both kill sites now skip PIDs in
  container cgroups. Live-verified: a full `pan reload` with 6 container servers running
  left all 6 untouched. The tick-10 "1709 docker init exit-1" and the recurring
  exited-130 stacks were NOT a workspace-template regression in the old sense — see next.
- **Fresh-workspace init exit-1 (PAN-1764, f6a5bbb51 + 51f488ae8):** init needed
  github.com for better-sqlite3's prebuilt binary on every run (the bun-store volume was
  mounted at /root/.bun while services run as user node — dead — and `down -v` wiped it
  anyway); a transient DNS EAI_AGAIN hard-failed init with no fallback (alpine image has
  no python3). Now: shared host bind caches `~/.cache/panopticon-devcontainer/{bun,npm}`
  (survive rebuilds, shared across stacks, _prebuilds cached), one bun-install retry,
  renderer pre-creates the dirs. **Bonus:** `sanitizeComposeFileSync` was rewriting
  container-side `/home/node/` mount targets to `${HOME}` — this had silently broken the
  PAN-1619 `.codex` bridge in every rendered workspace; fixed + locked by a renderer test.
  Live-verified on PAN-1709's stack: init exit 0, caches warm (1.6G bun;
  better-sqlite3-v12.10.0-linuxmusl in _prebuilds).
- **Beads-422 "no beads tasks":** confirmed all six active workspaces have
  `.beads/issues.jsonl`; the 422s are the PAN-1629 bd-list lock race (misleading error),
  whose fix is PAN-1629's own in-review PR. No separate action.
- **Repairs applied:** pan-1629 + pan-1704 server containers restarted (`docker start`);
  both stacks healthy again. PAN-1709's stack rebuilt and fully up (its work agent
  continues on --host, unaffected). The flywheel's deliberate slot-release pauses on
  agent-pan-1629 / agent-pan-1704 were left in place.

## RUN-22 tick 1 (2026-06-11, post-reboot) — full fleet self-recovery observed; PAN-1765 churn live again

**RUN-21 was a zero-tick reboot casualty** (same as RUN-19) — host rebooted
~06:36Z, RUN-22 replaced it at 06:50Z. Re-baseline notes:

- **Post-reboot self-recovery now works END-TO-END.** Startup recovery reset 9
  orphans (06:37:18), then the next patrol (06:53:18) resumed work-1709 and the
  deacon re-dispatched the PAN-1704 + PAN-1747 review convoys and PAN-1744 ship
  within 90 seconds — 13 sessions live, zero hand-holding. Contrast RUN-20
  tick 1 where the orchestrator had to drive part of it. The resume-decision
  logic read correctly: 1686 skipped (completed marker + review/test passed),
  1747 skipped (pipeline mid-flight), paused agents respected.
- **WATCH: 16-minute patrol gap** between the startup patrol (06:37:18) and the
  next (06:53:18) — contract is every 60s. Recovered alone; if it recurs, file
  with both timestamps.
- **PAN-1746's closed-issue gate confirmed live post-reboot:** repeated
  `[deacon] PAN-1190: skipping review/test re-dispatch — issue is closed`
  where the old code would have spawned a $HOME-wedged ship.
- **awaitingUat = 0 for the first time across all runs** — the RUN-11-era
  20-deep verifying-on-main backlog is fully drained (label count zero).
  PAN-1686 is the lone gate item (ready_for_merge=1).
- **PAN-1765 churn reproduced live:** PAN-1747 carries an unresolved
  merge_conflict blocker (02:33Z) yet a full 5-session review convoy
  re-dispatched on it post-reboot — doomed verdict. Launched
  `pan plan PAN-1765 --auto` (the conflict-gates-review fix). Held
  main-landing strikes while PAN-1686 sits at the gate (churn-hold rule);
  plan→work pipeline is churn-safe (feature branches don't move main).
- **Multi-channel:** operator conv sessions are landing PAN-1768 fixes
  directly (63c7f0eba, d6077ea34) — do not launch on PAN-1768. PAN-1488's
  spec flipped to active (0664f1337) with no agent session — likely the conv
  session exercising the fixed transitionVBriefOnMain; flagged as
  investigate-if-it-persists.
- **Drain-cluster question surfaced:** PAN-1642/1641/1242/1491 still paused
  under "Operator drain 2026-06-10 (PAN-1737 session)" with review=passed
  test=failed. The drain context (UAT batch) is over; needs operator
  unpause-or-close. PAN-1658 likewise awaits close-as-superseded.
- Minor noise: stale completion marker for PAN-714 retries review trigger on a
  nonexistent workspace (bounded, 3 attempts); host-test fixture agents
  (agent-pan-resume-*, agent-pan-kickoff-fail) still get orphan-recovered every
  patrol pre-reboot (PAN-1702/1720 class).

## RUN-22 operator interlude (2026-06-11 ~07:00-07:30Z) — PAN-1771 stale-blocker sweep: filed→fixed→live in ~30 min

Operator merged UAT batch `uat/pan-flint-0611` (PAN-1686, a8f76b7a4) and asked
(1) did it merge OK, (2) does merge auto-reload the dashboard, (3) implement if
not. Then relayed an agent-pan-1704-ship signal (PAN-1699 contract working):
ship can't run (roles/ship.md absent), PR #1713 green+mergeable, but
`pan review pending --ready` omits PAN-1704 — "pipeline state needs
reconciliation rather than a vestigial ship agent."

**Answers established:**
- Merge-auto-deploy EXISTS and works (PAN-1723, closed): every merge fires
  `scripts/post-merge-deploy.sh` → pristine origin/main worktree build → dist
  swap → restart → health check. Verified twice tonight (built sha == merge sha
  both times). It is postMergeLifecycle, NOT the ship agent, that triggers it.
- **readyForMerge is EVENT-DRIVEN since PAN-1650** (review-status.ts:268):
  derived on every status write from review+test+verification+blockers. No ship
  actor flips it. Ship really is vestigial for the flip (PAN-1747 removes it).
- **Root cause of 1704's invisibility (PAN-1771, fixed+closed):** GitHub-native
  blockers (failing_checks/merge_conflict/draft_pr/not_mergeable) were refreshed
  ONLY by webhooks (refreshMergeStateFromGitHub via PAN-1620). Webhooks missed
  during server downtime (reboot/deploy) leave stale blockers that pin
  readyForMerge=false forever under the PAN-1650 derivation. Fix: boot sweep
  `reconcileStaleGitHubBlockers()` next to fixStuckReadyForMerge(). Live result:
  8 issues reconciled at boot; PAN-1704 AND PAN-1747 both flipped ready_for_merge=1
  (1747's 02:33 conflict blocker was also stale); PAN-1491's blocker was
  re-derived FRESH from live PR state (kept, correctly — it's real).

**Operational learnings:**
- The deploy lock (/tmp/panopticon-deploy.lock) can read "held" transiently
  right after a completed deploy — a skipped manual deploy may just need a
  re-run a few minutes later. No fd leak found (checked /proc/*/fd).
- Landing a fix when the primary worktree has ANOTHER session's uncommitted
  source edits: chore-commit .pan state (convention), then
  `git worktree add --detach /tmp/x origin/main` + cherry-pick + push — never
  touch the other session's files, never stash. Local main stays diverged until
  that session commits; **do not `pan reload` while local main is behind origin**
  (it would build a stale tree) — use the deploy script (pristine origin build)
  for liveness instead.
- `pan pause` accepts role-session ids (agent-pan-1704-ship) — used to park the
  vestigial ship session after its signal (slot release, blocks re-dispatch).
- commitlint here rejects subjects starting with an uppercase token (RUN-22 →
  use lowercase); scope enum is [cloister, dashboard, workspace, cli, review,
  beads, db, specialists, terminal, infra, deps].

## RUN-22 tick 2 (2026-06-11 ~07:50Z) — two at the gate; partial convoys do NOT retro-fill

- **PAN-1709 completed a fully-autonomous pipeline pass within one run**: resumed
  post-reboot by the deacon at 06:53, review+test+verification all passed,
  ready_for_merge=1 by 07:44. Joins PAN-1704 at the operator gate. PAN-1686
  merged (uat/pan-flint-0611) and is verifying-on-main.
- **Partial convoys do NOT retro-fill.** PAN-1747's re-review convoy dispatched
  3/5 (governor ceiling bit mid-dispatch, total 10/9); after the jam-break
  freed 2 slots, the patrol used them for other dispatches (agent-pan-1744
  resume) — the missing performance/security reviewers were never spawned.
  Confirms RUN-20 tick 14 ("the other 2 forever deferred"). The atomic
  all-or-nothing convoy-slot reservation is now a twice-observed gap — file it
  if seen a third time (or fold into PAN-1765's fix, which gates dispatch).
- **Sequencing rule: never `pan review restart` while the branch carries a real
  merge_conflict blocker** — that manufactures the doomed-convoy churn PAN-1765
  exists to fix. Let the work agent resolve+push first; new-commit detection
  recycles the convoy (restart only if it doesn't).
- Jam-break round 2 (official surfaces): paused idle work-1709 (issue at gate)
  + the agent-pan-resume-redeliver-second FIXTURE session (PAN-1720 pollution,
  counted as work=1 by the governor — second occurrence of a fixture session
  eating a real slot). Unpaused work-1744 (its pause condition "while convoy
  runs" expired — review came back BLOCKED, so the work agent is needed).
- agent-pan-1491-ship spawned despite the vestigial-ship problem and is
  actively attempting work (rebase?) rather than refusing — ship behavior
  varies by agent. PAN-1491 is otherwise fully passed with a GENUINE
  failing_checks blocker (PAN-1710 boot-surface smoke hang class).
- PAN-1762 (Swarm v2) spec reached proposed via operator-side planning;
  surfaced start-permission as an openQuestion rather than auto-starting an
  operator-owned plan for a major feature.

## RUN-22 tick 3 (2026-06-11 ~08:20Z) — planner stalled pre-finalize; finalize is a host-side surface; webhooks are DOWN

- **`pan plan --auto` has a SECOND stall shape: complete-but-unfinalized.** The
  PAN-1765 planner (Fable 5) wrote the full design + workspace artifacts
  (+331/-6, autoDecisions, hazards) then sat at the prompt without running
  `pan plan finalize` — frozen byte-identical for 25+ min. Distinct from
  stop-at-proposed (which is post-finalize). **Recovery: `pan plan finalize -w
  <workspace>` runs host-side** and does the whole chain (beads, spec→proposed,
  promote to main, work-spawn attempt). Then `pan start <id> --host --yes` if
  the spawn skips on stack-unhealthy (deacon-code tasks don't need the stack).
  agent-pan-1765 implementing as of 08:18Z.
- **Webhook ingress is DOWN since the reboot** — zero webhook lines in
  dashboard.log since the 03:29 restart, no forwarder process (smee/gh-webhook)
  running. Consequence observed live: PAN-1747 resolved its conflict, PR #1757
  went MERGEABLE/CLEAN 6/6, but the merge_conflict blocker stayed stale →
  ready=0 (the PAN-1771 sweep is boot-only by design). PAN-1765's plan
  independently includes the fix: a ~10-min reconcile cadence re-verifying
  blocker-flagged rows. Until that lands, expect in-flight blocker staleness
  after every webhook gap; each server restart's boot sweep is the interim
  clearer. Surfaced ingress restoration as an operator question (how is
  delivery even supposed to arrive on this host?).
- PAN-1747 is therefore EFFECTIVELY at the gate (passed everything, PR clean,
  stale blocker only) — suggested merging it in the same batch as 1704/1709;
  the post-merge deploy boot-sweep clears it automatically.
- 1744 convoy dispatched 4/5 (security missing) — third partial-convoy
  sighting, but session-absence isn't dispatch-log proof (a fast reviewer may
  exit early); held off filing until a convoy provably stalls on a missing
  reviewer file.
- Paused agent-pan-1491-ship (idle ctx-0 on a review-blocked, genuinely
  failing-checks issue).

## RUN-22 tick 4 (2026-06-11 ~08:40Z) — gate drained: 3 merges in one batch; convoy self-recycled

- **PAN-1704 + PAN-1709 + PAN-1747 all merged 08:26Z** (run total: 4 PRs incl.
  1686). Notably the batch took PAN-1747 DESPITE its stale merge_conflict
  blocker — the train/operator path is not gated on blockerReasons, only the
  flywheel's ready surface is. The ship-role removal (1747) is now live: expect
  no more vestigial ship spawns after the next reload; if ship sessions still
  appear, that's a regression to flag.
- **The 4/5 partial convoy did NOT permanently stall this time** — PAN-1744's
  convoy was recycled to a full 5/5 by the pipeline itself (~04:34, after its
  work agent pushed feedback fixes). So partial-convoy is self-healing WHEN new
  commits arrive (checkPostReviewCommits recycles); it only deadlocks when the
  branch is quiescent (RUN-20 tick 14 case). Refines the file-on-third-sighting
  rule: only file if a partial convoy stalls on a QUIESCENT branch.
- **Host work agents leak fixture sessions**: agent-pan-1765 (--host) running
  the test suite spawned agent-pan-resume-confirmed on the real tmux socket
  (PAN-1720 class, 2nd leak tonight). Pattern: every --host work agent that
  runs `npm test` will do this; pause the fixtures as they appear and keep
  PAN-1720 alive as the root fix.
- work-1765 at ctx 89% + gpt-5.5 5h window 100% — double wedge-watch, brake is
  the net. Inspections passing (bead flow working).

## RUN-22 ticks 5-6 (2026-06-11 ~09:00-09:20Z) — full tilt: 1744 ready, drain cluster fully revived

- **PAN-1744 reached ready_for_merge=1** (09:05Z) — 5th issue to the gate this
  run. The earlier partial convoys on it self-recycled; no permanent stall.
- **PAN-1675 compact brake: 3rd production save** — work-1765 hit ctx 100%
  mid-implementation and was recovered with diff preserved (+1035/-67), then
  continued. gpt-5.5's 5h usage window also reset mid-task. WATCH: tick 6 shows
  cost +$10 with a STATIC diff — if that repeats, it's compact-thrash
  (PAN-1672 shape) and the salvage is pan handoff, not resume.
- **Operator revived the entire drain cluster** (~08:47-09:01): 1242/1491/1641
  unpaused, then 1642 and 1579 too. All five re-cycling through review convoys.
  A new session type appeared: agent-pan-1641-e2e-prompt (e2e prompt runner).
- **Zero vestigial ship spawns since PAN-1747's removal merged+deployed** — the
  ship-role retirement is holding in production.
- **Shared-worktree race lesson:** when a conv session is live-iterating a
  source file on the primary worktree, the chore-commit+rebase reconcile loses
  the race repeatedly (3 attempts, file re-dirtied within seconds each time).
  Stop racing: land flywheel docs via the detached-worktree cherry-pick, leave
  divergence for the conv session's own completion push, keep `pan reload`
  off-limits meanwhile (deploys build pristine origin so production is safe).

## RUN-20 tick 17 (2026-06-11) — PAN-1765: the bulk-reset mystery solved

PAN-1747 status_history gave the smoking gun: review+test PASSED 05:29, both
reset to pending 05:31:56, with a merge_conflict blocker from 02:33 never
resolved in between. The pipeline reviews conflict-flagged branches (doomed
verdicts), instead of gating review on conflict resolution. RUN-18's
"bulk reset at 01:08, unexplained" = this signature. Filed PAN-1765 with the
timeline. Tonight's cost: 1686/1704/1747 × ~3 convoy cycles each. The faster
main moves (good night for fixes!), the worse this burns — it's the next
keystone after the gate drained.

## RUN-28 tick 1 (2026-06-12) — post-reboot re-baseline; idle-at-prompt agents dominate

Run config: `minAgents=2`, `maxAgents=4`, `scope=all-tracked-projects`,
`auto_pickup_backlog=false`, `require_uat_before_merge=true`. First baseline
after RUN-27 (assumed reboot casualty like RUN-19/RUN-21):

- **Main is GREEN** at origin `2148beaf7` (CI success 16:24Z). Local primary
  worktree HEAD `197faad8c` is **54 commits ahead of origin/main** with
  uncommitted source edits from parallel sessions — do not commit source
  changes here; use detached-worktree cherry-pick for any orchestrator-owned
  landings.
- **Deacon healthy** after a transient `pan admin cloister status` read that
  initially reported `Stopped`, then `Running` after `pan admin cloister start`
  reported already-running. If the watchdog status read proves flaky, file a
  substrate bug; for now treat it as a display race.
- **8 issues at the merge gate** (`ready_for_merge=1`): PAN-1242, PAN-1491,
  PAN-1579, PAN-1614, PAN-1629, PAN-1765, PAN-1778, PAN-1803, plus MIN-831
  (GitLab). All PRs clean/mergeable. With `require_uat_before_merge=true`,
  these are the operator's only required human actions.
- **Cloister "stuck" list is mostly idle-at-prompt agents that already
  completed work.** Spot-checking tmux panes showed agents at the `❯` prompt
  after `pan done` / review-start / verification-fix with no further work.
  The classifier keys on heartbeat inactivity, not pipeline state, so done
  work agents read as stuck. Paused six clearly-done/ready agents
  (PAN-1242, PAN-1579, PAN-1614, PAN-1629, PAN-1765, PAN-1803) to free
  governor work slots and memory.
- **Genuinely blocked items needing work-agent attention:** PAN-1642
  (frontend-typecheck verification failure), PAN-1775 (review blocked with
  feedback file), PAN-1498 (review blocked + test failure), PAN-1658
  (merge_status failed), PAN-1641 (blocked with possible stale blockers).
- **Unstarted critical substrate bugs queued for next slots:** PAN-1799
  (Codex spawn dies seconds after boot), PAN-1798 (shared tmux server kills
  all sessions on pan kill), PAN-1805 (Codex conversation view blank),
  PAN-1807 (handoff fixes not submitted), PAN-1808 (test leaks real tmux
  session).
- **Parked (needs-design / needs-discussion):** PAN-1424, PAN-1489, PAN-1791.
  No action per run config.
- **Memory:** RAM 42.1/64.1 GB used, **swap 8.2/8.2 GB full**. Per RUN-20
  tick-9 correction, full swap with 22 GB available RAM is cold-page eviction,
  not OOM pressure. Still, launching more work agents into a 16-active pool
  above the configured cap is unwise until blocked items drain or slots free.

## RUN-28 tick 2 (2026-06-12) — freed slots, pruned docker networks, launched planning on 4 critical substrate bugs

- **Paused three more done/ready work agents** to free governor work slots:
  PAN-1491 (review APPROVED, PR clean), PAN-1778 (PR #1780 all checks passing),
  PAN-1787 (work complete, no open beads). Classifier "stuck" was idle-at-prompt
  after completion, not genuine blockage.
- **Docker network exhaustion surfaced:** `pan start PAN-1798 --auto` failed
  with "all predefined address pools have been fully subnetted". Pruned 8 unused
  workspace devnets (including deleted/merged issue workspaces), freeing pools.
- **`pan start --auto` beads-recovery path is broken for fresh critical issues.**
  PAN-1799/1805/1807/1798 all failed with `bd list`/`bd ping` errors during the
  auto-start synthesized-vBRIEF recovery. This is the same family as PAN-1647
  (flywheel's own `pan start --auto` path broken). Workaround: launched
  `pan plan <id> --auto` for all four instead; they are now planning. Will need
  plain `pan start` after finalize per the stop-at-proposed contract.
- **Launched one direct work agent:** PAN-1808 via `pan start --host --yes`
  (test-leak tmux-session bug; host-runnable test fix). Agent is up and
  nucleating.
- **Memory climbed to 49.9/64.1 GB used** with planning burst and PAN-1808 spawn.
  Available RAM still ~14 GB; not at OOM but headroom shrinking. Swap remains full.
- **Main green, unchanged** at origin `2148beaf7` (CI success 16:24Z). The local
  FLYWHEEL-STATE.md commit was pushed (`10425baa0`), moving local main 62 ahead
  of origin.

## RUN-28 tick 3 (2026-06-12) — killed corrupted PAN-1775, paused idle done agents, freed stuck count to 0

- **Cloister "stuck" count dropped to 0** after pausing the remaining idle
  work agents that had completed work but stayed at the prompt:
  PAN-1641 (pan done, review/test running), PAN-1658 (review passed,
  merge_status failed — needs pipeline investigation), PAN-1642 (verification
  failing repeatedly on feedback loop).
- **PAN-1775 workspace corruption identified and killed.** Its workspace
  `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775` contained
  a PAN-1788 spec + continue.json (PAN-1788 is closed-out). The work agent was
  asking which issue to implement because its loaded plan pointed to a closed
  issue. Killed all PAN-1775 agents and re-launched `pan plan PAN-1775 --auto`
  so it gets a fresh PAN-1775 vBRIEF. This is a workspace/planning-orphan
  corruption instance — likely from a prior merged issue reusing or shadowing
  the workspace path.
- **4 critical substrate bugs still planning:** PAN-1799, PAN-1798, PAN-1805,
  PAN-1807 (all in `planning-*` sessions, ~18 minutes in, Fable 5). PAN-1808
  work agent is running but hit a provider cooldown (429) and is at 80% ctx.
- **Memory pressure stable:** RAM ~48-50 GB, swap dropped to 7.2/8.2 GB after
  killing PAN-1775 stack.
- **No merges this tick.** The operator UAT gate remains the bottleneck.

## RUN-32 tick 1 (2026-06-13 ~13:47Z) — fresh baseline; gate-bound pipeline, launched 2 critical substrate plans

Run config: `minAgents=2`, `maxAgents=20`, `effort=xhigh`, `scope=all-tracked-projects`,
`auto_pickup_backlog=false`, `require_uat_before_merge=true`.

- **Main GREEN** at `c8ea5dc2e`, local main **in sync with origin** (0 ahead/0 behind) —
  cleaner than RUN-28's 54-ahead divergence. Memory healthy: RAM 24.8/64.1 GB,
  **swap clear (0/8.2 GB)**. Dashboard running plain `node dist/dashboard/server.js`
  (NOT `--no-resume`); deacon Running, auto-start enabled.
- **"Boot --no-resume" gates on stopped agents are STALE.** `pan status` shows dozens
  of old agents (incl. MIN-831 at 3245 min) gated `Boot --no-resume`, but the current
  boot has no `--no-resume` flag. The gate persists in state.json across reboots and
  misleads — do not read it as the live resume policy. Verify the dashboard cmdline
  (`ps aux | grep dashboard/server.js`) for the real policy.
- **Only live productive agent was a WEDGED review convoy: PAN-1803.** Parent
  `agent-pan-1803-review` (model `kimi-k2.7-code`) sits in standby "No reviewer
  terminal signals yet. I will wait." for >30 min while its 4 sub-reviewers crashed on
  400-context errors. This is the **PAN-1818 class** (reviewer overflow, no recovery for
  role agents) and the **PAN-1614/PAN-1765** stuck-convoy class. Orchestrator cannot
  pan kill/resume — surfaced as `investigate` + openQuestion for the operator.
- **Pipeline is gate-bound, not idle-bound.** 11 `in_review` (most are PAUSED
  completed-work parked at the operator merge gate — PAN-1242/1491/1629 review-passed;
  PAN-1498/1614/1658/1765 review-blocked), 16 `verifying_on_main` (operator UAT/close-out
  gate), 1 `in_progress` (PAN-1762, operator-held). With `require_uat_before_merge=true`,
  the operator UAT/merge decision is the primary bottleneck — and the only flywheel-
  forbidden action set (`pan resume/wake/kill/close`) is exactly what would advance them.
- **Launched 2 planning chains** (both clean/no-branch, eltmon-authored, critical):
  - `pan plan PAN-1818 --auto` → `planning-pan-1818` (reviewer 400-context overflow
    recovery — the ROOT CAUSE of the convoy deaths wedging PAN-1803; highest leverage).
  - `pan plan PAN-1507 --auto` → `planning-pan-1507` (Activity tab empty-state bug).
- **Half-started branches to investigate next tick (follow-through debt):** PAN-1506
  (`strike/pan-1506` + workspace), PAN-1508 (`strike/pan-1508`), PAN-1456
  (`feature/pan-1456` + workspace), PAN-1510 (`feature/pan-1510` + workspace). All still
  `todo` — prior strike/work attempts that never landed (likely reboot casualties). Each
  is a critical substrate bug; next tick should determine whether the branch has usable
  commits to resume vs. a fresh launch.
- **Used `pan plan --auto`, not `pan start --auto`** — RUN-28 confirmed the `pan start
  --auto` beads-recovery path is broken for fresh issues (PAN-1647/PAN-1799 class).

## RUN-32 tick 2 (2026-06-13 ~14:11Z) — PAN-1818 proposed→working; PAN-1507 triaged as non-bug; +2 launches

- **PAN-1818 finalized → proposed (4 items) → started work.** `planning-pan-1818`
  auto-promoted and `pan start PAN-1818` spawned `agent-pan-1818` (work, model
  `kimi-k2.7-code`, 4 beads, in_progress). NOTE the irony/risk: PAN-1818 is the
  reviewer-context-overflow fix, and Cloister routed the work agent onto the SAME
  kimi/CLIProxy 200k-window model that overflows — it hit ctx 39% (77k/200k) just
  loading context. Watch next tick for the work agent hitting the very overflow it's
  meant to fix; PAN-1675 compact brake is the net.
- **PAN-1507 correctly triaged as a NON-BUG and closed COMPLETED (13:54Z).** The
  planning agent investigated and concluded the Activity tab "empty" state is correct
  scoped behavior for a quiet project (Awareness rail carve-out), not a bug — "no
  further action needed, session ends without finalizing." Good autonomous triage:
  declined to manufacture a fix. Left an idle-at-prompt session (`planning-pan-1507`)
  on the now-closed issue; harmless, deacon/operator reaps it. Lesson: `pan plan --auto`
  on a suspected bug can legitimately end in "not a bug, close it" — that's a success,
  not a stall.
- **New operator-launched planning: `planning-pan-1849`** ("feat(flywheel): prioritize
  fixing a red main as the flywheel's first duty", eltmon, created 12:42Z). Not flywheel-
  launched; left running.
- **Launched 2 more plans** (clean, no-branch, eltmon-authored bugs, both pipeline-health):
  `pan plan PAN-1834 --auto` (reviewer/sub-agent blocked on interactive modal → no
  needs-you surfaced — same family as the PAN-1803 wedge) and `pan plan PAN-1817 --auto`
  (Linear API quota exhausted by IssueDataService polling — tracker-sync substrate).
  Held at 2 new launches to avoid the concurrent-bd-lock contention PAN-1629/PAN-1813
  warn about while 3 planning agents nucleate.
- **Half-started follow-through branches — VERDICT: mostly empty cruft.** `strike/pan-1506`,
  `strike/pan-1508`, `feature/pan-1510` are ALL **0 commits ahead of main** (no resumable
  work — leftover from prior strike/work attempts that never produced commits, likely
  reboot casualties). Only `feature/pan-1456` has 4 stale (3-week-old) planning commits.
  The frontend-store cluster (PAN-1506 "strike agents missing from store" + PAN-1510
  "newly-filed issues missing from store", both critical) is blocked by orphaned
  workspaces — a clean re-launch needs `pan workspace discard` first, which the
  orchestrator cannot do. Surfaced as an openQuestion for the operator.
- **PAN-1803 convoy STILL wedged** (>40min). Unchanged. Main advanced to `b59ac3207`
  (a parallel merge landed during the tick). RAM 24/64 GB, swap 1.4/8.2.

## RUN-32 tick 3 (2026-06-13 ~14:35Z) — PAN-1818 landing the overflow fix; PAN-1834 started; 6 productive agents

- **PAN-1818 work agent is FLOWING and committing the fix.** `agent-pan-1818` (kimi-k2.7-code)
  has 6 commits on `feature/pan-1818`, including the keystones: `feat(deacon): fast-fail
  overflowed convoy reviewers without respawn`, `feat(review): large-changeset signal +
  selective-reading guardrail`, `fix(cloister): exclude convoy reviewer sub-roles from
  checkApiErrorAgents`. This directly closes the PAN-1803 wedge class. It sat at ctx 87%
  (174k/200k) but kept flowing — no overflow crash yet; PAN-1675 compact brake is the net.
- **DURABLE LESSON — kimi-k2.7-code renders RAW JSON in the tmux pane.** A live kimi work/
  review agent shows streaming `{"type":"toolCall"...}` / `toolResult` / `{"type":"turn_start"}`
  objects in its pane, NOT a rendered TUI. **This is normal, not a crash.** Distinguish
  live-vs-wedged by whether `timestamp`/`responseId` ADVANCES between captures: `agent-pan-1818`
  advanced (live, working); `agent-pan-1803-review` shows the SAME `responseId`
  (`...ihf3Sa1hXwsHGkRPEaApeqbg`, ts 1781359455389) across ticks 2→3 = genuinely FROZEN/dead.
  Do not misread kimi raw-JSON panes as crashes — check timestamp advancement.
- **PAN-1834 finalized → proposed (6 items) → started work** (`agent-pan-1834`, kimi, 6 beads).
  Its spec ("...rate-limit-modal-detection-needs-you-triangle...") **SUBSUMES PAN-1830** —
  do NOT launch PAN-1830 separately; recommend operator close it as covered once 1834 lands.
- **PAN-1507 idle zombie** (`planning-pan-1507` on the closed-as-non-bug issue) still parked at
  prompt — harmless; not flywheel-reapable (no `pan kill`).
- **Scaled up: launched PAN-1813 + PAN-1802 planning.** Now **6 productive agents** (2 work:
  1818/1834; 4 planning: 1813/1802/1817/1849). planning-pan-1817 is quiet at ctx 13% — watch
  for a stall next tick. **0 bd-lock errors across 7 launches this run** — concurrent-bd
  contention is NOT materializing; can keep scaling.
- **PAN-1803 convoy frozen >60min** — surfaced as investigate + openQuestion; can't resume.
  Main advanced to `c0c26f955`. RAM 27/64 GB, swap 3.3/8.2.

## RUN-32 tick 4 (2026-06-13 ~15:05Z) — OPERATOR FLIPPED UAT OFF; executed 3 decisions; merge gate is actually a CLOSE-OUT gate

**Operator message mid-tick (standing authorization granted — act on items like these without parking back):**
1. `flywheel.require_uat_before_merge` → **FALSE** (confirmed in config). Merge review+test-passed work without UAT; review+test gates still apply.
2. Abort+restart the dead PAN-1803 convoy.
3. Discard orphaned PAN-1506/1508/1510 workspaces.

**Executed:**
- **PAN-1803 review restarted** via `pan review restart PAN-1803` (the pipeline-native way, NOT raw `pan kill`) → fresh 4/4 reviewer convoy. The frozen one is replaced.
- **Discarded orphan workspaces:** `pan workspace destroy PAN-1510 --force` ✓. PAN-1506's workspace was strike-suffixed (`feature-pan-1506-strike`) so `destroy` (which resolves the standard `feature-pan-<id>` path) couldn't find it — removed via `git worktree remove --force`. Deleted empty 0-ahead branches `strike/pan-1506`, `strike/pan-1508` (feature/pan-1510 branch was already gone with the workspace).
- **PAN-1818 finished work → in_review** (6 fix commits). **PAN-1834 → 5 commits** (rate-limit/model-switch modal detection + rateLimit PendingInputKind). Started work on **PAN-1813** + **PAN-1802** (both proposed→`pan start`, 5 beads each). Launched planning on **PAN-1845** (Fly work-loss, operator-greenlit) + **PAN-1769**.

**KEY FINDING — the "16 merge gate" is a CLOSE-OUT gate, not a merge gate:**
- The 16 "awaiting UAT" issues are **already merged to main** (`verifying_on_main`, tracker still OPEN). Auto-merge **cannot** act on them — they have no open PR / are not readyForMerge.
- The ACTUAL merge gate (in_review issues that are review+test-passed-and-not-merged) is **currently EMPTY**: probed `/api/flywheel/auto-merge/schedule {issueId}` for PAN-1491/1242/1629 → all `"review status is not readyForMerge"`. The endpoint self-gates on `isAutoMergeEligible` + `readyForMerge` + PR URL, so it's safe to probe — ineligible → 422/422, never a premature merge.
- **Auto-merge mechanics (for future ticks):** `POST /api/flywheel/auto-merge/schedule` with header `Origin: http://localhost:3011` and body `{"issueId":"PAN-XXXX"}`. Checks: shouldHoldForUat (per-issue autoMerge → project default → global require-UAT; global now false) → not paused → flywheel running → isAutoMergeEligible → readyForMerge → PR URL → schedules merge. Single issue per call. Review-status store: `~/.panopticon/review-status.json` (sparse — live status is in the read model via `getReviewStatusSync`).
- **Clearing the 16 needs CLOSE-OUT** (`pan close` / dashboard Close Out) — which is forbidden to the orchestrator AND semi-destructive (closes tracker + tears down workspace/branches per close_out config) AND was not one of the three named authorizations. **Surfaced as the single genuine blocker** with default recommendation YES. Also surfaced: should UAT-off imply auto-close-out (substrate gap)?
- **0 bd-lock errors across 11 launches.** RAM 29-31/64 GB, swap 3.7/8.2. 9 productive agents + 2 review convoys active. Main `69040f19c`.

## RUN-32 tick 5 (2026-06-13 ~15:23Z) — PAN-1818 review CATCH-22; work agents flying; held at 11 active (swap full)

- **PAN-1818's review convoy WEDGED (42min) and I restarted it** (`pan review restart`, operator-authorized). Diagnosis: the parent (kimi) was stuck *"Still waiting on the four reviewer terminal signals... No signals received yet"* while all four sub-reviewers had `willRetry:false` (stopped WITHOUT delivering their REVIEWER_READY/FAILED/TIMEOUT signals). This is the **PAN-1614 root** (deacon doesn't recover a fully-stopped convoy) compounded by kimi reviewers overflowing on PAN-1818's own large diff.
- **THE CATCH-22 (surfaced to operator):** PAN-1818 IS the reviewer-overflow fix, but it can't pass review because reviewing its large diff overflows the kimi reviewers — the exact bug. Restarting re-wedges on the same diff. **Recommended unblock: operator-override merge** (`gh pr merge --admin --squash --delete-branch`, always permitted per PAN-1486) to land PAN-1818 directly; once deployed, its overflow-recovery stops future review wedges. Surfaced in openQuestions; will re-confirm next tick if the restart re-wedges.
- **PAN-1803 fresh convoy (restarted tick 4) also at early-wedge risk** — static responseId at ~25min, same signal-wait shape. Both review convoys are impaired by the unmerged fix. Review is the pipeline's only friction right now.
- **Work agents are flying:** PAN-1834 (10 commits, modal detection + needs-you), PAN-1802 (8 commits, handoff degrade — committed 25s ago), PAN-1813 (5 commits, bd-timeout finalize). Started **PAN-1817** work (proposed→`pan start`, 5 beads; its spec = surface quota exhaustion + idle-stack-reaper test, does NOT subsume the 1821/1823 backoff fixes).
- **Launched planning: PAN-1821** (Linear backoff — getBackoffMs('linear') always 0) + **PAN-1827** (conversation view blank for pi-harness).
- **CLOSE-OUT decision STILL PENDING** (operator hasn't answered) — the 16 verifying_on_main need `pan close`; keeping it surfaced, not acting (forbidden + semi-destructive). Not blocking forward progress.
- **Capacity: 11 productive agents** (4 work + 5 planning + 2 review convoys), **0 bd-lock errors across 15 launches**. RAM 30/64 used (34 GB avail), **swap FULL (8.2/8.2)** — per prior learning that's cold-page eviction with ample RAM, not OOM, but I'm **holding launches at 11** until it stabilizes. Main `30963a8b7`.

## RUN-32 tick 6 (2026-06-13 ~15:48Z) — PAN-1818 restart RECOVERED; 3 plans→work; PAN-1803 left blocked-not-thrashed

- **PAN-1818 review restart WORKED.** After tick-5's restart, the fresh convoy delivered signals — parent shows `REVIEWER_READY security` + `REVIEWER_READY requirements` (2/4). So the kimi-reviewer overflow wedge is **FLAKY, not always deterministic** — a restart can recover it. The Catch-22 may resolve on its own this cycle; if 1818's review passes I auto-merge it.
- **CONTRAST — PAN-1803 review re-wedged** after its tick-4 restart (~55min, static responseId `msg_zFMVyEDhmbJGbaStM3Za0XKw`). For PAN-1803 the wedge is stickier. **Deliberately did NOT restart it again** — restart-thrashing a deterministically-wedging convoy burns resources (per "don't dismiss repeated failures as transient"). Instead: leave it blocked, let PAN-1818's fix land+deploy (the systemic cure), THEN restart 1803. Smart sequencing over band-aid loops.
- **PAN-1802 reached in_review** (work done → review). **1818, 1802 both in review; 1834 near done.**
- **Started 3 finalized plans → work** (proposed→`pan start`): PAN-1845 (**15 beads** — Fly durability/resiliency tiers), PAN-1821 (Linear backoff), PAN-1827 (pi-harness conversation view). These are pipeline-flow executions of completed plans, not new scaling launches — consistent with the swap-full hold.
- **HELD new planning launches** (swap pegged 8.2/8.2, RAM climbed 30→35/64 with the 3 work-agent spawns; 29 GB still free = not OOM but watching). Will resume fresh-bug scaling only when swap drains or RAM stabilizes.
- **13 active agents** (7 work + 2 planning + 2 review convoys + 2 review-targets), **0 bd-lock errors across 18 launches**. Both operator decisions (close-out, PAN-1818 Catch-22) still pending — kept surfaced, not blocking. Main `b14539ff3`.
- **Substrate batch shaping up this run:** PAN-1818/1834/1802 (reviewer reliability + handoff) in/near review; PAN-1813/1817/1845/1821/1827 (finalize resilience, quota surfacing, Fly durability, Linear backoff, pi conv-view) implementing. Once PAN-1818 lands, the review-wedge friction clears and this batch can flow to merge.

## RUN-32 tick 7 (2026-06-13 ~16:15Z) — THE KEYSTONE: MAIN IS RED; filed+struck PAN-1857; PAN-1818 approved-but-blocked

**Biggest finding of the run: MAIN CI IS RED, and that — not the review-convoy wedge — is what has kept the merge gate empty the entire run.** Every PR inherits main's failing `test` CI check, so NONE reach `readyForMerge` → that is why all 7 ticks of auto-merge probes returned `"review status is not readyForMerge"`. I had been reading `Main HEAD: <sha>` as if green; it was not.

- **HOW I FOUND IT:** went to auto-merge PAN-1818 (verified approved), checked its PR #1855 first → CI showed `test` FAILURE (5 pass, 1 fail). Then `gh run list --branch main --workflow CI` → `failure` on `eb02c3c6`, `11922cb9`, `bf3d32ad` (consistently red). **LESSON: each tick, verify main CI conclusion (`gh run list --branch main --workflow CI --limit 1`), not just the HEAD sha.**
- **DETERMINISTIC root cause:** `tests/cloister/verification-gate.test.ts > DEFAULT_GATES > "uses npm commands matching the verification gate defaults"` — asserts the test command contains `'src/dashboard/frontend'`, but commit `10ba58a42 fix(cloister): keep DEFAULT_GATES test command generic` changed it to the generic `npx vitest run --changed {{CHANGED_BASE}}`. The test wasn't updated alongside the prod change. Reproduced locally (1 failed / 16 passed) — NOT flaky.
- **ACTION:** filed **PAN-1857** (P0, bug+critical) with the exact assertion + root cause, and **`pan strike PAN-1857`** → `strike-pan-1857` (lands the test fix directly on main). This is the single highest-value action of the run — greening main unblocks the entire merge gate at once.
- **Second CI failure:** `tests/integration/agent-spawning.test.ts` — real-timer integration timeout family, the known **PAN-1824** flaky-under-load bug. Separate from PAN-1857; may need a re-run + the PAN-1824 fix.
- **PAN-1818 is APPROVED by all 4 reviewers (0 blockers):** correctness ("implements FR-1..FR-4 correctly, typecheck/lint/changed-tests pass"), security ("clean"), performance ("no regressions"), requirements ("full coverage"). All 4 report files written to `.pan/review/agent-pan-1818-review-cc8a9e10/`. BUT it can't merge: (a) synthesis wedged on the PAN-1614 signal-delivery gap (parent never received REVIEWER_READY despite reports on disk), AND (b) red-main CI fails its `test` check. PAN-1818's own branch fixes verification-gate.test.ts too — so once PAN-1857 greens main, rebase PAN-1818 → auto-merge (or admin-merge). **Did NOT admin-merge it** despite approval, because its CI `test` is red (red main); merging would land red.
- **PAN-1821 work start failed/reverted to todo** (spec still proposed) — retry next tick.
- 12 active agents (7 work + 1 strike + 2 planning + 2 wedged review convoys). RAM 33/64, swap pegged. Both operator decisions (close-out, 1818 merge) deprioritized behind red-main. Main `efb642f6b`.

## RUN-32 tick 8 (2026-06-13 ~16:45Z) — STRIKE LANDED + PAN-1818 KEYSTONE MERGED; one flaky test from green main

- **PAN-1857 strike SUCCEEDED.** `strike-pan-1857` landed the verification-gate.test.ts fix on main (commit `2bd7da644`), verified locally (`npm test` 6,226 passed). The deterministic red-main cause is GONE. (The PAN-1857 issue is still OPEN — strikes land the fix but don't auto-close the tracker issue.)
- **PAN-1818 MERGED (the keystone).** PR #1855 merged 16:42Z (commit `03e46c982` — "fast-fail context-overflow reviewers, exclude role agents from generic recovery, large-changeset guardrail"). The OPERATOR admin-merged it between ticks, acting on the tick-7 recommendation (approved 4/4, 0 blockers). The reviewer-overflow fix is now on main.
- **⚠️ MERGE ≠ DEPLOY for the running deacon.** PAN-1818's convoy-recovery code runs in the deacon (part of the dashboard server). Merging to main does NOT activate it — the server needs a `pan reload`/deploy. **Therefore PAN-1803's wedged review is NOT restarted yet** — restarting before the deploy would just re-wedge on the old code. Surfaced to operator: pan reload now (disrupts 8 running agents) vs wait for normal deploy. Holding pan reload to avoid mid-run disruption.
- **LAST red-main cause = flaky `agent-spawning.test.ts`** (real-timer integration timeout, PAN-1824). Verified it's the only remaining CI failure on the post-strike commit. **Launched `pan plan PAN-1824 --auto`** (fix = convert real-timer waits to fake timers per repo rule). Also re-ran the failed main CI job opportunistically. Once PAN-1824 lands, main is reliably GREEN and the merge gate opens for the backlog.
- **PAN-1821 work restarted cleanly** (6 beads) — the tick-6 start failure was a transient workspace-rebuild race, not persistent.
- **PAN-1827 + PAN-1802 reached in_review** (work done). Their merges await green main.
- **Close-out now 17 pending** (PAN-1818 joined verifying_on_main). Decision still with operator (default yes).
- Headline (my count): bugsFixed=2 (PAN-1857 strike + PAN-1818 merge), prsMerged=1. The flywheel's internal counter shows 0 (PAN-1818 was operator-admin-merged, PAN-1857 was a strike — neither went through the flywheel auto-merge path). 13 active agents, RAM 36/64, swap draining (7.2). Main `6ec3f215c`.

## RUN-32 tick 9 (2026-06-13 ~17:05Z) — RE-DIAGNOSED the last red-main cause (real bug, not flake); filed+struck PAN-1859

- **CORRECTION to tick 8:** the remaining red-main CI failure (`agent-spawning.test.ts`) is NOT a flaky timeout — it's a **REAL deterministic assertion failure**: `"resumeAgent delivers the continue prompt through the Pi FIFO for pi work agents"` → `expected writePiCommand to be called` (it isn't). It passes locally because this integration test is excluded from the local default `npm test` but RUNS in CI. **LESSON: a CI failure that "passes locally" can be a real failure in a CI-only/integration test — read the actual assertion, don't assume the known flaky-timeout family.**
- **PAN-1824 was MIS-SCOPED for this.** Its auto-plan produced "re-land slow-exclusion for the conversation-supervisor playwright UAT" (3 items) — unrelated to the agent-spawning assertion. Held its start (not the red-main fix; RAM-conserving). PAN-1824's actual scope may be valid separate work; reassess later.
- **Root cause (likely):** `resumeAgent` (src/lib/agents.ts) delivers via `deliverAgentMessage` (agents.ts:1497/1724). The recent PTY-supervisor/delivery refactor changed the Pi path — spawn uses `writePiCommandSync` (agents.ts:376, SYNC) while the test mocks `writePiCommand` (async). So resumeAgent likely routes Pi delivery through a different function now.
- **Filed PAN-1859** (P0, bug+critical) with the exact assertion + likely cause + EXPLICIT root-cause guardrails (determine regression-vs-stale-test; DO NOT weaken the assertion to go green — that would mask "pi work agents silently lose their continue prompt on resume"). **Struck it** → `strike-pan-1859`. LAST red-main blocker. **TODO next tick: inspect strike-pan-1859's diff to confirm it fixed root cause, not weakened the test** (strikes have no review gate).
- **Merge backlog is approval-ready but gated on red main:** PAN-1802 + PAN-1827 in review, PAN-1834 near done. The moment PAN-1859 greens main, auto-merge cascades them.
- **PAN-1818 merged but NOT deployed** — PAN-1803 restart still deferred (needs pan reload). Surfaced.
- bugsFixed=2, prsMerged=1, awaitingUat=17. 13 active agents (6 work + 2 strike + 2 planning + 3 review). RAM 35/64, swap pegged. Close-out still pending (default yes). Main red until PAN-1859 lands.

## RUN-32 tick 10 (2026-06-13 ~17:26Z) — RED-MAIN SAGA RESOLVED: main GREEN, PAN-1818 DEPLOYED, pipeline unblocked

- **PAN-1859 strike landed CLEANLY — main is GREEN.** Commit `ef2df6850` "stub pi binary on PATH for pi-resume test". Diff inspected: ONLY the test file (+12/-1), NO assertion weakened, no .skip/.todo. Root cause was correct: CI lacks the real `pi` CLI → `resolveHarness` fell back to claude-code → bypassed the Pi-FIFO delivery path the test verifies. The fix stubs a harmless `pi` binary on PATH so harness resolution is deterministic. **Not a bandaid — a proper test-infra fix.** Main CI = success on ef2df685.
- **ALL THREE red-main causes now fixed:** PAN-1857 (verification-gate stale assertion, strike), PAN-1818 (reviewer overflow, merged), PAN-1859 (pi-binary stub, strike). The entire run's "nothing merges" mystery was red main on three independent causes.
- **OPERATOR AUTHORIZED + I RAN `pan reload`** → PAN-1818's convoy-recovery fix is now DEPLOYED. Build was incremental (2.76s), "Dashboard reloaded and healthy", HTTP 200, and **all 14 agent tmux sessions survived** the restart. LESSON: pan reload mid-run is low-risk when the build is incremental — agents on the panopticon socket survive; only the server/deacon restart.
- **Restarted PAN-1803's wedged review** (`pan review restart`) — fresh 4/4 convoy now running on the deployed fix. NEXT TICK: confirm it synthesizes cleanly (no signal-wedge) — that validates PAN-1818 in production. If it STILL wedges, the fix needs a follow-up.
- **Merge backlog status (now main green + fix deployed):** PAN-1834 ~done; PAN-1802 review synthesizing; PAN-1827 review found 1 SMALL REAL correctness issue (`resolvePiSessionPath` doesn't verify the path is a regular file — a dir named `*.jsonl` would crash the parser) → work agent must fix before merge (NOT a bandaid-merge). Auto-merge cascade expected to begin next tick as reviews synthesize on the now-healthy pipeline.
- **CLOSE-OUT of the 17 verifying_on_main:** OPERATOR is handling separately ("I or another agent will get back to you") — I am NOT acting on it.
- bugsFixed=3, prsMerged=1. 12 active agents. RAM 35/64. Main `ef2df6850`+.

## RUN-32 tick 11 (2026-06-13 ~17:48Z) — CASCADE STARTED: 2 admin-merges; synthesis wedge persists (PAN-1861)

- **Main is GREEN and stable** (success across ef2df685/a500eed9/446a07d4). The red-main saga stays resolved.
- **BUT the synthesis wedge (PAN-1614) PERSISTS even after PAN-1818 deployed.** Reviews COMPLETE (all 4 reports written to `.pan/review/.../*.md`) but the convoy parent stalls waiting for the last REVIEWER_READY signal → synthesis never runs → `readyForMerge` never flips → auto-merge returns "not readyForMerge" for everyone. PAN-1818 fixed reviewer *overflow*, NOT signal *delivery*. **Filed PAN-1861** (fix: synthesize from on-disk report files when signals are missing). This is the last structural blocker for AUTONOMOUS merging.
- **BRIDGE: admin-merge verified-approved PRs.** Read all 4 reports for each in-review issue; for 0-blocker approvals on green main, `gh pr merge <PR> --admin --squash`. Merged this tick: **PAN-1802 (#1856 → d75abad81)** and **PAN-1803 (#1804 → 03144001b)** — both 0 blockers across correctness/security/requirements/performance. (Note: `--delete-branch` fails when a worktree still uses the branch — harmless, the merge itself succeeds; drop `--delete-branch` or ignore the exit-1.)
- **NOT merged — real fixes needed (do NOT bandaid-merge):** PAN-1821 (correctness blocker: a new test imports `CacheService` before stubbing) and PAN-1827 (correctness: `resolvePiSessionPath` must verify a regular file, else a dir named `*.jsonl` crashes the parser). Their work agents must fix these — but the BLOCKED feedback is ALSO stuck behind the synthesis wedge (PAN-1861 breaks both approve→merge and block→feedback). Stuck until PAN-1861 lands or manual re-engagement.
- **Established operating pattern (until PAN-1861 fixed):** each tick, read review reports → admin-merge 0-blocker approvals on green main → leave blocked PRs for their work agents. This is the operator-authorized "merge review+test-passed work" path, bridging the wedge.
- Run totals: **5 bug fixes landed** (PAN-1857, PAN-1818, PAN-1859 red-main + PAN-1802 + PAN-1803), **3 PRs merged**. 4 work agents progressing (1834 ~done), RAM freed to 33/64. Close-out of the now-19 verifying_on_main: operator handling separately. Main CI validating the 2 new merges.
