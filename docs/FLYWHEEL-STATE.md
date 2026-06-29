# Flywheel State

Durable cumulative memory across Flywheel orchestrator runs. Status snapshots are ephemeral and live in `~/.overdeck/flywheel/`; this file is for facts that future runs should not have to rediscover.

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

When `pan plan <id> --auto` (or any spawn route) creates an agent state directory and starts the tmux session, the Deacon's orphan-recovery patrol can fire before the tmux session is fully up and mark the agent `stopped` with reason "orphaned: tmux session missing at boot". The agent still runs to completion (verified — PAN-1235 planning finalized + auto-promoted despite the runtime status row being marked stopped at spawn+0ms), but the dashboard and any consumers of agent state see a misleading "stopped" while the agent is actually running.

**Why it matters.** Cosmetic for now, but if any downstream system uses agent state as the source of truth for "should I restart this", it could double-spawn or skip restarts. PAN-1213 (synthesis→review-status bridge) is the same family of bug. Worth a dedicated fix that gates orphan-detection on a minimum age since `startedAt`.

**How to apply.** When you see "agent stopped immediately after spawn" but the workspace artifacts still appear, do not panic — check the actual artifacts (spec file, beads, commit log) rather than trusting a single status source. Runtime status now lives in the SQLite `agents` table.

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

## Cross-run operational gotchas (compacted from RUN-1…RUN-28)

Still-live diagnostic heuristics distilled from earlier runs. The full tick-by-tick
narrative they came from was compacted on 2026-06-14 (RUN-35) and remains in git
history (`git log --follow docs/FLYWHEEL-STATE.md`).

- **Verify main CI *conclusion* every tick, not the HEAD sha.** A green `Main HEAD: <sha>`
  line is NOT a green CI result. Use `gh run list --branch main --workflow CI --limit 1`.
  Red main silently empties the merge gate (every PR inherits the failing `test` check).
  (RUN-32 t7, RUN-34 t1)
- **`pan flywheel emit-status` 404s in the standard host env** when `DASHBOARD_URL=https://pan.localhost`
  is set — `dashboardBaseUrl()` (`src/cli/commands/flywheel.ts:103`) POSTs through the Traefik proxy,
  which 404s POST mutations even though the route is healthy on the local server (`GET localhost:3011/api/flywheel/status` → 200).
  **Every tick, emit with the loopback override:** `OVERDECK_DASHBOARD_URL=http://localhost:3011 pan flywheel emit-status --file <path>`
  (→ "Flywheel status emitted"). Tracked as PAN-1386 (mechanical root cause commented RUN-2). Without the
  override the snapshot is silently lost and the stuck-remediation watchdog eventually flags the orchestrator. (RUN-2 t1)
- **`pan flywheel status` can report "no active flywheel run" during a live run.** emit-status publishes
  a snapshot but does NOT register the active-run gate (that's `pan flywheel start`, which would spawn a
  DUPLICATE orchestrator — do NOT call it from inside a live orchestrator). The CLI status/manifest and the
  emitted-snapshot surface disagree; trust the live `flywheel-orchestrator` tmux session as ground truth. (RUN-2 t1)
- **kimi-k2.7-code renders raw JSON in the tmux pane — this is normal, not a crash.**
  Distinguish live-vs-wedged by whether `timestamp`/`responseId` ADVANCES between two
  captures. Same `responseId` across ticks = genuinely frozen. (RUN-32 t3)
- **"healthy" = process-alive, NOT making-progress.** A two-snapshot diff (ctx/cost/commits
  advancing) is the only reliable progress test; do not trust the health flag alone. (RUN-14)
- **`pan plan --auto` stops at `proposed` — it does NOT auto-spawn the work agent.** Follow
  with `pan start <id>`. Confirmed 3× (PAN-1658/1629). (RUN-17)
- **`pan strike`/`pan plan`/`pan start` need the `PAN-` prefix; `gh` takes the bare number.** (RUN-17)
- **A strike's code lands on main BEFORE `pan done`** — a "Pending" tracker status ≠ "no work
  done". Check the branch commits. (RUN-17)
- **Gated-PR CI reading:** `CANCELLED` ≠ failed; empty conclusion = in-progress; a smoke-job
  `CANCELLED` is usually a ~20-min timeout killing a silent server-boot hang. (RUN-17, RUN-18)
- **Never `--admin`-bypass a failing `test` check while main is RED** — you cannot distinguish a
  stale base from the PR's own break. Only admin-merge on GREEN main. (RUN-32 t12; in memory)
- **A CI failure that "passes locally" can be real** — a CI-only/integration test, or
  `CI=true`/`maxForks:1` single-fork cross-file mock pollution. Reproduce with
  `CI=true npx vitest run`; read the actual assertion, don't assume the known flaky family.
  Expect TWO fixes for the pollution class: plug the polluter AND make the victim hermetic.
  (RUN-32 t9, RUN-34 t1-2)
- **`pan unpause` ≠ resume.** Governor backpressure / deferred-dispatch is the usual reason a
  session doesn't appear; the deacon's deferred-dispatch log line is the definitive
  stall-vs-queue distinguisher. (RUN-18)
- **Verifying a merged fix is LIVE takes three checks, in order:** merged to main → DEPLOYED
  (`pan reload` for deacon/server code) → observed firing in the deacon log. "landed != live."
  `pan reload` mid-run is low-risk when the build is incremental — overdeck-socket agents
  survive; only the server/deacon restart. (RUN-15, RUN-18, RUN-32 t10)
- **Ground truth for "is this agent running" is tmux (`tmux -L overdeck ls`), not any single state file.**
  Ghosts show `status: running` with no session, especially after a `--no-resume` boot. (RUN-34 t1)
- **Confirm a squash-merge landed with `git merge-base --is-ancestor <mergeCommit> origin/main`** —
  the "N commits not on main" branch-ahead count is a normal squash artifact, not "unmerged". (RUN-34 t3)
- **Always use `gh issue create --body-file`** for bodies containing backticks/quotes/parens —
  inline `--body '...'` breaks shell parsing and can execute body fragments as commands. (RUN-32 t12)
- **swap-full ≠ memory pressure** when RAM is ample — it's cold-page eviction, not imminent OOM. (RUN-20, RUN-32)
- **Stale `Boot --no-resume` gates persist in the SQLite `agents` table and `state.json` across reboots** and mislead. Verify the
  real resume policy from the live dashboard cmdline (`ps aux | grep dashboard/server.js`), not the
  per-agent gate. Re-enabling auto-resume needs a restart WITH resume on (not just the deacon process up). (RUN-32 t1, RUN-34 t4)
- **Re-landing playbook for an approved-but-conflict-stranded fix:** reopen its PR + `pan start <id>
  --force` to re-engage the paused work agent → it rebases+resolves+re-submits → verify the core diff
  intact + CI green → admin-merge on green main → `pan reload` if it's deacon code. NOTE: fails for
  hard-conflicted old branches via the PAN-1872 `pan start` sync-main crash. (RUN-32 t22-23)

## Compacted run log (RUN-1 … RUN-28)

One line per earlier run — outcome + durable lessons + key issues. Compacted 2026-06-14
(RUN-35); the original tick-by-tick detail is preserved in git history. (RUN-1/RUN-3 fixes
live in **Substrate fixes** above; RUN-32/34/35 are kept verbatim below.)

- **RUN-9 (2026-05-24)** — Zombie inspect sessions carried over from RUN-8; PAN-1418 parked
  (`needs-discussion`) but its review convoy stayed live; 4 issues (1419/1417/1415/1414) merged
  + awaiting human UAT; noted `ctxPercent:0` orchestrator-snapshot quirk.
- **RUN-11 (2026-05-25)** — 20-deep verifying-on-main backlog dominated; observed tracker drift
  (In Progress + closed-out + merged simultaneously); all v1.0-required MUST issues unstarted;
  `awaitingUat` confirmed a load-bearing metric; made parked-item triage decisions; filed two
  substrate gaps (orchestrator was suggest-only → Command Deck sat empty; discretion-on-unpark
  rule existed only in user memory).
- **RUN-14 (2026-06-04)** — `auto_pickup_backlog=false` ⇒ restricted-to-in-flight inventory
  (semantics confirmed); swap 99.9% full → memory, not `maxAgents`, was the real ceiling;
  awaiting-UAT (human gate) was the bottleneck; established "healthy ≠ progressing" + two-snapshot
  diff; PAN-1213 (review→ship bridge) live, fix = PAN-1059; PAN-1616 un-overridable `.claude/**`
  settings-protection; "0 producers" is a valid finding (repair > launch); closed out PAN-1574;
  PAN-1450 reopened→merged; PAN-1613 deacon drove review→ship on a CLOSED issue; operator pushback
  → struck all 6 substrate bugs (1 landed, 5 self-declined → converted to full pipeline).
- **RUN-15 (2026-06-08)** — new world: deacon unfrozen, governor live, brakes landed; PAN-1213
  meta-blocker appeared CLEARED live; don't confuse paused with stalled; PR CI-rollup is a
  single-tick stall/ready distinguisher; "test FAILURE" has TWO independent signals — check both;
  correction: bottleneck was ship-on-broken-docker, not UAT laziness; keystone PAN-1678 landed
  (deacon-unfreeze gate cleared); a delegated worker can stall on an UNSUBMITTED operator message;
  PAN-1645 (ship) proven the binding constraint; PAN-1675 (resume --compact) landed ("landed != live").
- **RUN-17 (2026-06-09)** — stabilization over, resumed aggressive launch; the 5 carried-over
  in-flight issues were DONE + operator-gated, not blocked; main went RED beneath "green" PRs
  (PAN-1698 filed+struck, fixed ~25min); learned the PAN- prefix gotcha, the strike-lands-before-
  `pan done` gotcha, the stop-at-proposed contract, and the CANCELLED/empty-conclusion CI reading;
  orchestrator survived a mid-run model switch (Opus 4.8 → Fable 5).
- **RUN-18 (2026-06-10)** — pipeline cascading under its own power; PAN-1675 compact-recovery
  confirmed live (first prod observation); pause gates carry resume CONDITIONS (evaluate them);
  merge train does NOT heal test=pending (→ PAN-1658); `pan unpause` ≠ resume; a failed post-rebase
  verification can be MAIN's fault (cross-check main CI; bisect-by-run-history); first merge of run
  (PAN-1455 attempt 2); **THE BIG ONE — post-merge-deploy builds the primary worktree WITHOUT
  syncing origin (PAN-1723)**; PAN-1716 reaper live; deferred-dispatch log line = stall/queue
  distinguisher; "verify-live = 3 checks in order"; overnight livelock arc (diagnose→jam-break→
  strike×2→drain); 3rd red main, test-starvation named, FIVE at the gate.
- **RUN-20 (2026-06-11)** — post-reboot re-baseline (deacon re-drove everything); struck PAN-1723
  + PAN-1699; PAN-1746 filed (boot reconciliation dispatches ship on MERGED issues + `$HOME` spawn)
  → landed+reloaded+closed; strike-1747 surfaced a PAN-1531 architecture contradiction; 4th red main
  of the week (PAN-1746 fixture fallout, green ~35min); rolling-rebase churn quantified; compact brake
  saved 1744; tell-fix live-verified; batch train MERGED 3; PAN-1723 + PAN-1760 live-verified+closed;
  convoy circular-wait jam-break; PAN-1765 bulk-reset mystery solved; swap-full ≠ pressure. Plus a
  handoff session that closed spawn-guardrail fixes PAN-1763/PAN-1764.
- **RUN-22 (2026-06-11)** — full fleet self-recovery observed; PAN-1765 churn live again; operator
  interlude PAN-1771 stale-blocker sweep (filed→fixed→live in ~30min); partial convoys do NOT
  retro-fill; planner stalled pre-finalize (finalize is a host-side surface; webhooks were DOWN);
  gate drained 3 merges in one batch; convoy self-recycled; ran at full tilt.
- **RUN-28 (2026-06-12)** — post-reboot re-baseline; idle-at-prompt agents dominated; freed slots,
  pruned docker networks, launched planning on 4 critical substrate bugs; killed corrupted PAN-1775,
  paused idle done agents, freed stuck count to 0; confirmed the `pan start --auto` beads-recovery
  path is broken for fresh issues (PAN-1647/PAN-1799 class) → prefer `pan plan --auto`.


## Recent runs (RUN-29 onward)

Per-run detail lives in `~/.overdeck/flywheel/runs/RUN-N/report.md`. This file holds only cross-run **durable** memory; per-tick logs were redundant with the run reports and were compacted out on 2026-06-29 (was 373KB / 3253 lines).

## RUN-39 tick 2 (2026-06-29) — PAN-2155 drained; kickoff-delivery bugs gate the rest

- **PAN-2155 MERGED** (commit 9bebbf24, auto-merge fired 20:14Z) → `pan close --force` → terminal. Cohort now 13/15 terminal.
- **Remaining cohort (PAN-2086, PAN-1718, PAN-2146) all hit agent kickoff/relaunch bugs:**
  - **agent-pan-1718** — my tick-1 `pan start --fresh` produced a ZOMBIE: ctx 0% / out 0 / cost $0, `status=running` but `lastActivity=None`, `failures=1` (kickoff delivery failed). Known bug **PAN-2172** (host/fresh respawn never delivers kickoff). Plus its PR #2103 is still CONFLICTING.
  - **agent-pan-2086** — byte-identical metrics across ticks (out 198 / $0.4306) = stalled; the RUN-37 `--fresh --host` respawn that PAN-2172 describes.
  - **agent-pan-2146** — flipped to `stopped+troubled` with **0 failures** (spurious gate, RUN-37 pattern) despite a stale "Working" pane frame. `pan untroubled pan-2146` → deacon resumed it cleanly (back to running).
- **Action:** launched `pan plan pan-2172 --auto` (kickoff-delivery fix is a named pipeline-flow blocker = agent spawning). Chose full pipeline over strike — RUN-37 showed lifecycle/delivery-path strikes can red-main; review/test gates protect it. planning-pan-2172 confirmed alive (Opus, ctx 11%, advancing) — **normal fresh planning spawns deliver kickoff fine; only `--fresh`/`--host` respawns + relaunches are broken.**
- **PAN-2179** (relaunch zombie — session alive, kickoff never delivered, liveness fooled) likely shares PAN-2172's root cause; flagged for the planner to dedupe/collapse rather than launching a second racing fix on the same delivery code.
- These three stuck agents drain only after PAN-2172 (+PAN-2179) lands AND the operator `pan reload`s (deacon runs compiled dist). Carry to next run.

**Reusable:** distinguish a productive vs zombie fresh-spawn by `ctx%`/`out` advancing across ticks AND `state.json.lastActivity != None`. A `running` status with `lastActivity=None` + `failures=1` = kickoff never landed (PAN-2172/2179), not a live agent.

## RUN-39 tick 3 (2026-06-29) — zombies can self-recover; cohort drains cleanly

- Main green (e2b74a5516 + 0469f6d038 both CI success).
- **agent-pan-1718 SELF-RECOVERED.** Tick-2 it was a zombie (status=running, lastActivity=None, failures=1). Tick-3: failures=0, lastActivity recent, ctx 72%, actively running git merge-base. The deacon's nudge/re-engage delivered the kickoff after all, AND the agent resolved its conflict: **PR #2103 went CONFLICTING/DIRTY -> MERGEABLE/UNSTABLE.** It's now addressing review feedback (.pan/feedback/001-review-agent-changes-requested.md). Lesson: do NOT prematurely write off a `lastActivity=None`/`failures=1` zombie as dead — the deacon re-delivery sometimes lands a tick later. Re-check before escalating.
- **PAN-2146 advanced to in-review** (work done) with a healthy convoy (agent-pan-2146-review wrote review.md, not wedged).
- **agent-pan-2086 is the lone persistent zombie** (status=running, lastActivity=None, failures=1, unchanged across 3 ticks). Operator-started (flywheelRunId=None) -> exempt from reaping; flywheel has no tell/resume/wake lever. Drains only on PAN-2172 fix + operator `pan reload`.
- PAN-2172 planning healthy (Opus, ctx 22%, advancing). Flagged PAN-2179 dedupe.
- Accurate cohort count: 12 terminal (10 closed + 2 parked) + 3 in-flight (PAN-2146 in-review healthy, PAN-1718 active healthy, PAN-2086 zombie). Two of three in-flight are moving to merge under their own steam.

## RUN-39 tick 4 (2026-06-29) — PAN-2146 to merge gate, PAN-2172 work started

- Main green (3 consecutive CI successes: 12c4fa7ce8 / e8c3e13919 / e2b74a5516).
- **PAN-2146 reached ready-for-merge** (review+test passed, PR #2180). Scheduled auto-merge (id 7, fires 21:22:31Z). Origin header required as always.
- **PAN-1718 re-entered review** (agent-pan-1718-review) on its now-MERGEABLE PR #2103 (conflict resolved tick-3). Healthy.
- **PAN-2172 planning completed** (issue went to `planned`, vBRIEF + 3 beads). BUT `pan plan --auto` did NOT auto-chain into work; the planning agent sat idle 14m at `planned`. Started work manually with `pan start pan-2172` (codex/gpt-5.5) -> got kickoff, implementing. OBSERVATION: flywheel-launched `pan plan --auto` stops at `planned` rather than auto-starting work, despite the brief calling it "planning + work in one chain." Watch whether this is consistent; may be a handoff gap worth filing if it recurs.
- agent-pan-2086 unchanged (lone zombie, gated on PAN-2172 merge + reload).
- Confirms again: NORMAL `pan start`/`pan plan` spawns deliver kickoff fine; only `--fresh`/`--host` respawns + relaunches are broken (PAN-2172/2179).

## RUN-39 tick 6 (2026-06-29) — pan CLI outage recovered + gh rate-limit + PAN-2054 stale-ready

- **INCIDENT: `pan` CLI broke pipeline-wide.** Between tick 5 (21:36, pan working) and tick 6 (~21:55), `dist/cli/` was wiped: `dist/dashboard` remained (built 21:36) but `dist/cli/index.js` was gone and NO build process was running. The global `pan` is npm-linked to this repo, so the missing artifact broke `pan` for every agent (`pan done`, `pan start`) and for the flywheel's own emit-status. Cause: a build started ~21:55 (dist/ mtime), tsdown cleared output, then the build died/was killed before the CLI chunk. CI was green on bce5b93b6e (code builds fine) => purely a local artifact outage. RECOVERY: `npm run build` (CI-proven, restores dist/cli, does not restart the running server). pan back to v0.41.1, emit-status restored. Watch for recurrence; if builds keep dying mid-flight, suspect OOM or an interrupted `pan reload`.
  - REUSABLE: if `pan` suddenly returns "command not found" / dangling symlink, check `ls dist/cli/index.js`. Global pan -> @overdeck/core -> npm-linked to /home/eltmon/Projects/overdeck. A missing dist/cli means a killed build; `npm run build` restores it. The running dashboard server (in-memory dist) is unaffected and keeps serving.
- **GitHub GraphQL rate limit hit 0** mid-tick (reset ~21:55Z). The auto-merge schedule endpoint internally calls `gh pr view`, so it failed with a rate-limit error that LOOKED like a substrate bug but was quota exhaustion. Retried after reset -> PAN-1718 scheduled (id 8, fires 22:01:32Z). Back off gh polling when remaining is low.
- **PAN-2054 bug is live.** `pan review pending --ready` listed PAN-2152 (merged commit 2a41e2ecbd) and PAN-1884 (2f83da8df1) as ready-for-merge even though both are merged + closed-out. Instance of PAN-2054 (close-out not terminal: closed-out issues reappear). PAN-2054 itself is closed-out but the bug persists; consider reopen. Do NOT schedule merges on these stale entries.
- PAN-1718 reached ready-for-merge (review+test passed) and is scheduled to merge. PAN-2172 work agent still implementing (single 35m+ turn; watch for wedge). agent-pan-2086 unchanged zombie.
