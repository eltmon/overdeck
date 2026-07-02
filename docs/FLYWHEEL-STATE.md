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

## RUN-53 operator directives (2026-07-02, standing)

- **NEVER pass `--model` to pan commands.** Config now routes every role to `claude-fable-5` (workhorse aliases changed). This SUPERSEDES the RUN-39 "re-route reviews to Sonnet via `--model claude-sonnet-4-6`" playbook — a codex auth outage no longer requires (or permits) a model override; restart with the bare command and let config route. Tick-1's three Sonnet-override restarts were re-issued without `--model` (CLI resumed the existing sessions; a fresh respawn on the config model would need an operator kill first).
- **Hands-off PAN-1791** — deacon-ignored, held until PAN-2214 lands. Do not dispatch, restart, or suggest actions for it.
- **Hands-off PAN-2214** — a whole-issue agent is driving it end-to-end. Do not dispatch or restart anything for it, including its slot-2 kickoff-zombie (drop the watch; the driving agent owns it).

## RUN-53 tick 4 (2026-07-02) — RED MAIN #3 (service.ts ratchet, PAN-1935 strike push) — strikes skip lint

- **Main RED again:** PAN-1935's strike commit `1f9c0041f7` grew `src/lib/cloister/service.ts` 2057→2077 (+20 ohmypi cost-reconcile lines), tripping the god-file ratchet on the **lint** job. The strike verified typecheck + focused vitest but **never ran `npm run lint`** — third file-size red-main of the run (PAN-2218 flywheel.ts, PAN-2192 family). Filed **PAN-2238** (blocks-main) with an extraction-only fix spec (move the +20 lines out; do NOT regen baseline; TENET-10 = touch nothing else in service.ts); dispatched `strike-pan-2238` (booted, working).
- **LESSON (systemic):** the strike role's mandatory pre-push verification omits lint. Every guard the strike doesn't run is a red-main class waiting. Interim fix = add `npm run lint` to the strike role verification; durable fix = PAN-2204 (no unreviewed direct-to-main pushes). Surfaced both.
- **PAN-2154 ready:** review=passed test=passed (PR #2236) → UAT bundle now 3 (PAN-2154, MIN-831, MIN-846). Operator ships.
- **codex auth paradox:** `pan pi-auth status` → "openai-codex: not logged in", yet gpt-5.5 sessions run fine (strike-pan-1935 completed 16-min run; strike-pan-2238 + pan-2181 review live). The status command may read a stale/different credential store than omp actually uses — do NOT treat its output as ground truth for holding gpt-5.5 pickup; verify with a live session instead.
- **Swap nearly full: 7.6/8 GB** (RAM fine, 20/64). Likely behind historical mid-build process kills (RUN-39 dist wipe). Surfaced urgent to operator.
- PAN-1935's full `npm test` in-workspace failed on sandbox EPERM/EROFS (environment, not code) — it noted this durably on the issue; orthogonal.
- Backlog pickup HELD while main is red (new PRs would queue behind the red gate).

## RUN-53 tick 3 (2026-07-02) — MAIN GREEN; both red-main issues closed; PAN-2234 strike aborted → needs-handoff

- **Main GREEN** (all recent runs success through `9dd2c6a422`). Both red-main issues **CLOSED with verification comments**: PAN-2217 (mock drift, `0e0cd31cf2`) and PAN-2218 (file-size trim, `b2a90b7516`, 960 lines).
- **PAN-2172 (PR #2182) MERGED by the operator directly on GitHub (18:40, green).** Direct-forge merges strand `postMergeLifecycle`: issue still `in-progress`, record verdicts still pending, no verifying-on-main handoff. Surfaced close-out to operator. REUSABLE: an operator GitHub-UI merge under require_uat_before_merge leaves the runtime record stale — check `mergedBy` before diagnosing a pipeline wedge.
- **PAN-2181 (PR #2183) now green + MERGEABLE/CLEAN** — the red-main inheritance cleared without a branch re-push. But its review had been dead since 06-29 under the NO_RESUME gate; restarted bare (`pan review restart PAN-2181`), convoy live.
- **strike PAN-2234 ABORTED (correctly): full-pipeline-needed** — 392-line PRD, 4 work items / ~9 files, and it modifies the complete-planning promotion route (the plan-promotion door) = TENET-10 pipeline machinery. Labeled `needs-handoff` + objection comment; PRD ready at `.pan/drafts/PAN-2234.md`. Nothing implemented/pushed by the strike. LESSON: vet strike targets against BOTH size (strike = small isolated diff) AND TENET-10 before dispatch — a PRD-backed multi-subsystem feature is never strike-shaped.
- **strike-pan-1935 is a LIVE gpt-5.5 session actively working** (resolving cost.ts rebase conflicts from the pi→ohmypi rename) — codex auth may have been restored by the operator; re-verify with `pan pi-auth status` next tick before changing the held-pickup posture.
- PAN-2150 CLOSED (no redispatch needed). Cohort live: PAN-2151/2154 work, PAN-2156/2224/2181 review, PAN-2153 planning, PAN-1935 strike, PAN-2214 review+test (hands-off). Swap jumped to 5.7/8 GB (RAM 27.5/64) — noted for operator.

## RUN-53 tick 2 (2026-07-02) — trim landed; NO_RESUME boot is the redispatch root cause

- **PAN-2218 trim LANDED** (`b2a90b7516` extracts flywheel start helpers to src/lib; flywheel.ts 1022→960). CI in_progress on it at tick end — conclusion check carried to tick 3 (short wakeup).
- **All three restarted reviews cleared pending:** PAN-2154 + PAN-2156 recorded verdicts; PAN-2172 advanced to test with its work agent actively resolving PR #2182's merge conflict (fable-5 test agent live alongside — config routing confirmed working).
- **NO_RESUME finding (verified, /proc/4043895/environ):** the host dashboard runs with `OVERDECK_NO_RESUME=1` — deacon patrols fire (log advancing) but orphan-recovery/auto-resume are OFF. THIS is why dead review/test agents (e.g. agent-pan-2150-test) never redispatch and why dozens of agents show "Boot --no-resume" gates. The known env-defeats-config trap. Surfaced to operator (resume-enabled restart is their call); flywheel drives stuck items via `pan review restart` meanwhile.
- **Three `dist/dashboard/server.js` processes in host ps is NOT a deacon duel:** two have cwd `/workspaces/overdeck` = workspace-container peers (legit, deacon-disabled); only the host pid binds 3011. Check `readlink /proc/<pid>/cwd` before diagnosing a duel.
- **Watchdog restart at 07:15 reported failure ("pan restart exited 1") but the server it spawned IS up and serving** — likely the <120s health-timeout false-fail class. Surfaced.
- codex OAuth still logged out (re-checked). MIN-831/MIN-846 still UAT-gated.

## RUN-53 tick 1.5 (2026-07-02) — PAN-2217 DONE; second red-main cause struck (PAN-2218 file-size guard)

- **PAN-2217 strike COMPLETE:** mock-factory fix `0e0cd31cf2` on main, test job green, `pan done --strike` handoff applied.
- **Main still red on the LINT job:** `08796258b0` ("fix(cli): pin flywheel start to the primary worktree root", direct push by panopticon-agent[bot]) grew `src/cli/commands/flywheel.ts` to 1022 lines — over the 1000-line file-size guard. Verified locally (wc -l = 1022). Filed as **PAN-2218** (blocks-main) by the strike agent; dispatched `strike-pan-2218` (config-routed fable-5, no --model).
- **Recurring pattern:** this is the second file-size-guard red-main on this exact file (PAN-2192 was "flywheel CLI exceeds file-size guard after harness resolver fix"). Every direct-push fix to flywheel.ts risks tripping the guard. Durable fix = decompose flywheel.ts — but the flywheel loop is TENET-10 pipeline machinery, so that decomposition is needs-handoff, not autonomous. Surfaced as a suggestion.

## RUN-53 tick 1 (2026-07-02) — RED MAIN struck (PAN-2212 direct-push mock drift) + codex auth outage again

- **Main RED, 3 consecutive CI failures.** Root cause: `803bb76681` "feat(cloister): reserved swarm dispatch budget (PAN-2212)" pushed **directly to main** by panopticon-agent[bot] (no branch, no review — the PAN-2204 hazard class, second confirmed incident). It added `tryReserveSwarmSlot` to `src/lib/cloister/concurrency.ts`; 8+ test files' explicit `vi.mock` factories of that module don't return the new export → 31 tests fail. Filed **PAN-2217** (blocks-main) + struck it (`strike-pan-2217`, Fable 5). CI logs show the mock under THREE relative paths — a fix must sweep ALL `vi.mock` factories of concurrency.js repo-wide.
- **PAN-2181 (PR #2183) "failing checks" merge-blocker is pure red-main inheritance** — identical mock-drift error on its rebased branch. No action on the PR itself; drains after PAN-2217 + re-run.
- **codex/gpt-5.5 OAuth logged out AGAIN** (`pan pi-auth status` → not logged in; same as RUN-39). agent-pan-2172-review dead mid-session ("refresh token revoked"); agent-pan-2154-review / agent-pan-2156-review / agent-pan-2150-test sessions gone. Applied RUN-39 playbook: `pan review restart <id> --model claude-sonnet-4-6` for 2172/2154/2156 (all spawned OK; 2172 needed one retry after a transient Bad Gateway). Held gpt-5.5 work pickup; surfaced `pan ohmypi-auth login` (operator-only) in openQuestions.
- **TENET-10 objections filed:** PAN-2145 (routes/conversations.ts), PAN-2147 (routes/agents.ts), PAN-2148 (routes/issues.ts), PAN-2149 (cloister/service.ts) — all four needsPlanning items are pipeline-runtime decompositions (verified: start-agent/spawnAgent/deliverAgentMessage hits in each). Labeled `needs-handoff` + objection comments, PAN-2189 precedent. Planning floor: nothing safe to plan this tick.
- **PAN-2214 swarm live on the same code the strike touches** (parent + slot-1 healthy Fable 5; slot-2 = kickoff zombie ctx0%/$0, PAN-2172-bug class — watching for deacon re-delivery per RUN-39 tick-3 lesson before escalating). Its `chore(state)` commits keep landing on main; strike told to rebase before push.
- MIN-831 + MIN-846 review+test passed — UAT-gated, surfaced to operator. UAT candidate endpoint returns null PAN-side (expected on red main).
- Primary-worktree dirty files (conversation-lifecycle.ts, conversations.ts) predate this run — not flywheel's, left untouched.

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

## RUN-39 tick 7 (2026-06-29) — PAN-1718 stale-mergeability treadmill (PAN-2108 gap)

- pan CLI healthy (no re-break). Main green (cf58ac2cba).
- **PAN-1718 scheduled merge (22:01Z) did NOT land.** PR #2103 has ALL checks green (build/lint/test/smoke SUCCESS) but GitHub flipped it to CONFLICTING/DIRTY after main moved (my tick-6 push + state commits). The auto-merge engine read DIRTY and dropped it; re-schedule rejects "PR is not mergeable (state=dirty)".
  - KEY: `git merge-tree --write-tree origin/main origin/feature/pan-1718` merges CLEAN (exit 0). So git says no real conflict; GitHub's mergeability is stale/lagging (likely a both-modified pipeline state file like .beads/issues.jsonl or .pan/records/pan-1718.json that git's ort auto-resolves but GitHub flags). Differing files are the PR's own code (reload.ts/status.ts/restart-status.ts/supervisor.ts) + state files.
  - To clear it, the feature branch needs a re-push (rebase onto latest main) to force GitHub to recompute. The work agent (idle since 20:49, status=running) should do it via `pan done`, but it has no signal that main moved and the flywheel has no legal lever to re-trigger it (cannot pan tell/resume; pan start refuses 'running').
  - This is exactly the **PAN-2108** gap (flywheel-safe rolling re-rebase: auto-rebase ready PRs when main moves). Without it, any ready PR can get stuck stale-DIRTY whenever main advances faster than the merge window.
  - DISPOSITION: carry PAN-1718, re-check next tick. If GitHub recomputes to MERGEABLE, re-schedule and it drains. If it stays stuck across ticks, prioritize PAN-2108.
- REUSABLE: when a ready PR won't merge with mergeable=CONFLICTING but `git merge-tree --write-tree` exits 0, it's stale GitHub mergeability, not a real conflict. Fix is a branch re-push; the systemic fix is PAN-2108.
- PAN-2172 work progressing (35m then 8m turns, through beads). PAN-2086 unchanged zombie.

## RUN-39 ticks 8–12 (2026-06-29) — PAN-1718 DRAINED + codex/gpt-5.5 auth outage

- **PAN-1718 (PR #2103) MERGED 23:30:43Z.** The "stale-mergeability treadmill" was a TWO-layer block:
  1. GitHub's stale `CONFLICTING/DIRTY` flag after main advanced (branch fell 29 behind). Confirmed FALSE conflict via `git merge-tree --write-tree` (exit 0, no markers). Cleared with `pan sync-main PAN-1718` + `git push` → GitHub recomputed `MERGEABLE+CLEAN`.
  2. The sync (new head) correctly auto-re-spawned review — but that review agent died because **codex/gpt-5.5 OAuth was logged out** (`pan pi-auth status` → not logged in; every gpt-5.5 agent hit "refresh token already used"). So review_status stuck `reviewing`, ready_for_merge never set.
  - Fix for layer 2: `pan review restart PAN-1718 --model claude-sonnet-4-6` — re-routed the review off dead gpt-5.5 onto Sonnet (native Anthropic → claude-code, no codex dep). Review passed → test passed → ready_for_merge=1 → `POST /api/flywheel/auto-merge/schedule` (id 9) → merged with full postMergeLifecycle (labels merged+verifying-on-main, agents paused).
- **REUSABLE:** a "ready PR won't merge" can be TWO independent failures stacked — (a) stale GitHub mergeability (fix: re-push; verify false via merge-tree) AND (b) a dead/auth-broken reviewer leaving review_status non-passed. Check BOTH the forge mergeability AND the runtime review_status before concluding.
- **codex/gpt-5.5 OAuth outage (operator-only fix: `pan ohmypi-auth login`).** While logged out, all gpt-5.5 work/review/test agents die instantly. Flywheel response: re-route cheap contextless steps (a single review) to Sonnet to make progress; HOLD new gpt-5.5 work pickup and context-heavy work agents rather than wholesale-downgrade the run (gpt-5.5 is the preferred work model).
- **PAN-2172 (PR #2182) HELD:** verification_status=FAILED (real typecheck/lint/test failure) + its work agent is auth-dead. Needs codex re-auth so the context-holding work agent can fix it — NOT a clean re-route (re-review would review broken code; a fresh claude work agent would lose context). Waiting on re-auth.
- **PAN-2086 zombie killed** (kimi, idle 13h, 34% ctx, unanswered resume prompt) — slot freed, workspace preserved.
- **Backlog ranking is poisoned with CLOSED issues** — the "MUST start PAN-2150" target and #6/#11/#12 (PAN-1982/1510/1506) are all CLOSED/released; #7/#8 (PAN-806/1864) are objection/parked. Instance of stale ranking + PAN-2054 close-out-non-terminal. Did NOT start any. Once codex is back, PAN-2143 (stale merge-blockers never re-evaluated) is the first systemic pick — it's the durable fix for the layer-1 treadmill above.
