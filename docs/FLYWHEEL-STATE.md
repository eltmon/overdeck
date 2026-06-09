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
