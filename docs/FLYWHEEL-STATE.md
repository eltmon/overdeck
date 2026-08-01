# Flywheel State

Durable cumulative memory across Flywheel orchestrator runs. Status snapshots are ephemeral and live in `~/.overdeck/flywheel/`; this file is for facts that future runs should not have to rediscover.

> Historical-path note (PAN-2541): entries below are an append-only incident log.
> References to `.pan/records/`, `.pan/specs/`, and `.pan/drafts/` describe the
> legacy layout that existed when each event occurred; current permanent state
> lives in `records/`, `specs/`, and `drafts/` on `overdeck-state`.

## Substrate fixes

### Inspect bead→vBRIEF item resolution (commit b721b8b31d, 2026-07-09, RUN-60)

**Problem.** Tiered-execution inspection (`tieredExecution.supervisor.owns_inspection`) resolved the vBRIEF item for a bead via `doc.plan.items.find(i => i.id === context.beadId)` in `src/lib/cloister/inspect-agent.ts`, but `context.beadId` was the bd-assigned bead id (`workspace-<slug>`) while item ids are semantic (`mnemos-installer`, `okf-*`). Disjoint id spaces ⇒ `.find` returns undefined ⇒ throws "requires a readable vBRIEF item" on every `pan inspect <id> --bead <bd-id>`. The inspect gate could never pass for supervisor-inspection issues — observed repeatedly blocking PAN-2468's work agent.

**Fix.** New `resolveInspectBead()` in `src/cli/commands/inspect.ts` maps bd bead id → vBRIEF item id: direct item-id match → `bd show --json` `metadata.vbriefItemId`/`itemId` → unique plan-item title match → else a clear actionable error. The CLI sets `context.beadId` to the resolved item id and threads the original bd id as `trackerBeadId` (used for `getBeadDescription`). `src/lib/vbrief/beads.ts` now stamps `vbriefItemId` into bead metadata at materialization so resolution is deterministic going forward.

**Scope / follow-up.** Fixes the CLI / tiered auto-inspect path (the actual blocker; the work agent shells `pan inspect`). The manual dashboard route `POST /api/issues/:id/beads/:beadId/inspect` (`src/lib/overdeck/issue-reads.ts:292`) still passes the raw bead id — same latent bug, secondary human-triggered path — tracked as **PAN-2540** (share `resolveInspectBead` between CLI + server route).

**Landed.** Operator-directed strike (`pan strike PAN-2538`). Reviewed the diff (surgical, +164/-4 across 5 files) + typecheck green on the merged tree; fast-forwarded main to `b721b8b31d` and pushed under operator authorization (`OVERDECK_OPERATOR_PUSH=1`, flywheel-orchestrator). Strike branch was `strike/pan-2538` (no `feature/pan-2538`), so the pipeline merge endpoint did not apply.

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
- **`pan flywheel emit-status` 404s in the standard host env** when `DASHBOARD_URL=https://overdeck.localhost`
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
- **A green CI re-run can launder a second, genuinely load-sensitive new test onto main.**
  Re-running a flaked check to unblock a PR is not evidence about newly-added tests in the
  same PR — one such rerun caused a red-main incident that took three ticks to fix. (RUN-75)
- **When hunting stalls, look for transitional states that nothing is responsible for advancing**
  (`pending` with no dispatcher, `merging` with no timeout, feedback-needs-you that never
  re-attempts, machinery-latched `stoppedByUser`). All look healthy to surfaces that filter on
  terminal states; that single question found four separate bugs. (RUN-75)

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
- ~~**Hands-off PAN-1791**~~ — RESOLVED (RUN-55 t1): PAN-1791 is CLOSED + merged + closed-out. Follow-up work continues as PAN-2283 ("Tiered execution ignition"), a normal in-flight work agent.
- ~~**Hands-off PAN-2214**~~ — RESOLVED (RUN-55 t1): PAN-2214 is CLOSED + merged + closed-out. The hold that gated PAN-1791 is moot; both landed.


## Compacted run log (RUN-39 … RUN-75)

> Compaction 2026-08-01 (PAN-1889): runs RUN-29…RUN-75 compacted to run-log lines
> (RUN-75's final handover is kept verbatim below); full detail in git history
> (`git log --follow docs/FLYWHEEL-STATE.md`).

- **RUN-39 (2026-06-29)** — PAN-2155 + PAN-1718 drained (PAN-1718 was a stale-mergeability treadmill → filed PAN-2108 gap); kickoff-delivery bugs gated the rest of the cohort; zombies proved self-recoverable; weathered a pan-CLI outage, gh rate-limit, and a codex/gpt-5.5 auth outage; PAN-2146 reached the merge gate, PAN-2172 started. Key: PAN-2155, PAN-1718, PAN-2108, PAN-2054.
- **RUN-53 (2026-07-02→03)** — three red-mains struck same-run (PAN-2212 direct-push mock drift; PAN-2218 file-size guard; PAN-1935 strikes-skip-lint); planning DOWN twice for codex-routed agents — PAN-2274 fixed end-to-end (needed rebuild+restart) and PAN-2275 zombie plannings fixed+deployed, restoring the codex plan path; dual finalize saturates the bd lock; swap completely full. Standing directive born here: NEVER pass `--model` (config routes every role).
- **RUN-55 (2026-07-03→04, incl. post-reboot resume)** — operator-away "land the entire pipeline" push: 9 PRs landed, then a 6-issue release-scope drain, main green + deployed for the major-release tag; unified churn root cause = overdeck.db lock contention under sustained load (PAN-2318 fixed+deployed+verified); reboot strands swarm slots (state loss); new red-main class = operator UAT batch tripping a stale-HIGH file-size baseline; UAT candidate must be re-emitted every tick; strike-path bugs filed (PAN-2300).
- **RUN-56 (2026-07-05)** — special-orders run: prelude + B0 shipped as v0.43.0 (PAN-2283 tiered-exec ignition, PAN-2378 config UI, PAN-2318 event-loop remainder); learned the flywheel CANNOT cut releases (identity guards block it — operator cuts); PAN-2383 tiered-execution test-drive filmed — tier routing validated but convergence needed manual assembly (swarm dependency-isolation: dependent beads' tests fail without the foundation slot's branch); order book 1/19, Gate 2 held.
- **RUN-57 (2026-07-05)** — Order Book Run opened: census + A1 dispatched (single tick).
- **RUN-58 (2026-07-06→08, 157+ ticks)** — the big order-book run (Lanes A/B/M): ~15 merges incl. A1–A8, B1–B2, the priority cost-capture pair PAN-2387/2388, PAN-2405, PAN-1872, PAN-2464 Machine Room, and xBRIEF v0.8 (PAN-2426); 5+ red-mains struck (PAN-2433 frontend build, PAN-2456 mock isolation, PAN-2471 circular dep, PAN-2490/2496 duplicate NO_LOSS_MATRIX ship-log entries).
  Chronic blocker: PAN-2167 records add/add conflicts + record-push re-CI loops repeatedly deadlocking merges (A8 slipped 3×; the "schedule when the record converges" bet escaped it). Operator policy set: ALL MIN-* UAT-held project-wide — report at rfm, never merge without per-issue go; MIN-857 partial multi-repo merge exposed pipeline gap PAN-2467; run ended with primary main reconciled+pushed.
- **RUN-60 (2026-07-08→09)** — order-book CI/CD×Refactor drain COMPLETE: B3/PAN-2167 (state-plane dirty-gates), B4/PAN-2359(+2363), B5/PAN-2360, B6/PAN-2270 all merged+closed; red-mains struck (PAN-2508 + PAN-2509 chronic Playwright flake with a deeper BootReconciliationModal root cause; PAN-2525 god-file baseline + flake); learned the real merge path is `POST /api/issues/:id/merge` (`pan approve` removed); drain deliberately PAUSED while the live server was stale — merging through a stale server leaks docker + runs old lifecycle; filed PAN-2522 (finalize→autostart gap), PAN-2516 (flywheel push divergence).
- **RUN-62 (2026-07-10)** — Lane B COMPLETED: B7 (7-bead root-cause fix) and B8 merged, B3–B8 batch deployed+verified; A9 swarm frozen by the B8/PAN-2364 bug; silent work-agent spawn-fail recurred (PAN-2569); advancing-reconcile merge wedge surfaced (PAN-2567); v0.45.0/0.45.1 cut.
- **RUN-63 (2026-07-13→17, ~89 ticks)** — the long drain: UAT promotes + ~30 merges; red-mains struck repeatedly (PAN-2643, PAN-2703, PAN-2712 merge-gate trap fixed+live-verified, PAN-2748/#2756); kickoff chain root-caused and COMPLETED — "the pipeline was never slow, it was BLOCKED" (PAN-2770/2771/2777/2781); the deacon reaper kept killing live agents (incl. its own fixers) until the reaper fix was deployed and PROVEN live; PostHog telemetry shipped.
  Also: codex review-path deaths (PAN-2775) and the review-convoy wedge identified as autocompact thrash; near-miss almost killed a healthy agent → PAN-2731; wind-down landed ~11 fleet merges (PAN-1491, 1966, 2232, 2252, 2807, …); ended release-ready, main green, deployed.
- **RUN-65 (2026-07-17→18)** — operator sequence 2822→2661→1610 COMPLETE (merged+closed+deployed, v0.45.21); red-main PAN-2833 struck; order book resumed, A13/PAN-2445 merged; tail-jam pattern named: idle-at-prompt agents + re-reviews of uncommitted/unchanged code (held a non-deterministic ready=1 merge — hold validated); PAN-2846 stale-liveness blocks close-out; fixed git-object corruption on overdeck-state; strike cohort drained (PAN-2860/2879/2883/2884/2840); operator caught a strike-tunnel-vision stall — do full pipeline diagnosis, not just the strike lane.
- **RUN-66 (2026-07-19→25, extended)** — 12 merges in the first 5h (Kimi K3 PAN-2859; patrol auto-deploy restored PAN-2897; substrate set PAN-2898–2913: 8 filed, ALL fixed same run); capstone: FIRST fully-autonomous patrol deploy verified, then the deploy loop hardened to self-healing (PAN-2918/2924/2931); ~10 red-mains across the tail, mostly <30-min turnarounds (no-loss gate vindicated); MIN-882 polyrepo completion path hardened (6 substrate bugs); GitHub PR outage weathered mid-red-main.
  Standing lessons kept: watch cwd drift in long-lived shells; trust the DoD/deploy gates and satisfy rows honestly; emit shipping verbs BEFORE assemble-uat (PAN-1736).
- **RUN-69 (2026-07-25)** — MIN planning-handoff blocker struck+deployed (PAN-3042), recovering 5 stranded MIN issues; then a self-inflicted MEMORY EMERGENCY (host load 235, dashboard starved) from 5 simultaneous starts + DUPLICATE Docker stacks — recovered by shedding orphan stacks; filed PAN-3050 (reaper blind to non-Overdeck stacks) and PAN-3051 (5 agents frozen and invisible).
- **RUN-70 (2026-07-25→26)** — Docker bridge pool EXHAUSTED, silently halting the pipeline (PAN-3053 relief struck+proved); red-mains PAN-3056, PAN-3088, PAN-3101 struck+cleared; the deploy verification gate refused stale deploys correctly several times (one near-miss stale deploy caught); PAN-3068 frozen-agent invisibility fixed+verified live; close-out named a pipeline emergency (PAN-3067 struck→deployed→closed); stranded-verdict classes found (MIN-902 self-deadlock PAN-3092; min-858-test as a linear cost leak with no termination); retracted then corrected an orphan-detection predicate; owned a misdiagnosed+duplicated red-main fix.

## RUN-71 … RUN-75 (2026-07-26 → 2026-08-01, claude-fable-5 / Opus 5) — compacted summary

- **RUN-71 (07-26→27)** — OOM-reboot re-drive; Fable 5 quota exhaustion left 4 agents "running" at $0.00 (operator repointed the tier to k3); deploys repeatedly blocked by a dirty/stale shared primary worktree — two uncommitted lines blocked six close-outs until the operator discarded the debris; PAN-3116 dissolved the baseline-conflict class; PAN-3123 made swap visible to the memory governor; PAN-3093's stale-review class swept fleet-wide and the review non-convergence gate filed; operator correction: dissolve blockers, don't report them; polyrepo deployed + first MYN merge generation; v0.46.0 shipped.
- **RUN-72 (07-27→28)** — the drain run: merge queue 15→0, PAN-3187 repair closed 19/23, close-out sweep 99/123; PAN-3111 converged after four review cycles; PAN-3156 landed after being red for three runs; standing MYN directive recorded: merge train only, no hand-merges.
- **RUN-73 (07-28)** — emergency-lane items surfaced from a quiet queue; a broken PUBLISHED npm package found and fixed (PAN-3214 de-risked); the blocked-behind-a-permission-menu class caught (PAN-2882: a merge candidate frozen behind a menu while every health surface said fine); first cohort auto-merge scheduled; 9 close-outs.
- **RUN-74 (07-29)** — my own status query was hiding four stuck rows (corrected and made standing); reviewer-death class filed after recurrence; then PAN-3264 took the dashboard down for good — fleet flat, read-only ticks, awaiting operator.
- **RUN-75 (07-30→08-01)** — dashboard restored; two host-wide OOM incidents root-caused; the 50 GB stop-hook fan-out process leak (PAN-3294) permanently fixed and verified; red-mains PAN-3300/3320/3342 struck; six strikes merged+deployed in one arc; 16 close-outs, 12 PRs merged, ~110 GB reclaimed; verdict-laundering class discovered (PAN-3365 guard + PAN-3367 29-issue audit); a 26-hour loop lapse (a monitor ending is not a tick); ended at quiescence with a retrospective and the operator's "right the ship" correction — judgement about what counted as finished, not throughput, was the problem. Final handover kept verbatim below.

---

# HANDOVER — RUN-75 → next orchestrator (Fable 5)


Written 2026-08-01 by the outgoing flywheel-orchestrator (Opus 5) at operator request.
Read this **after** `roles/flywheel.md` and `docs/flywheel-brief.md`, and alongside
`docs/FLYWHEEL-STATE.md` (ticks 1–28 hold the full narrative and the lessons).

The operator's framing: *"right the ship a bit."* Throughput was not the problem —
**judgement about what counted as finished was.** Read the failure modes below before
picking up work; several are mine, and they are the ones most likely to repeat.

---

## 1. What is actually true right now

- `main` is **green**. Live dashboard build tracks it (deploy patrol is working and redeploys unprompted).
- The **process-leak treadmill is over** (PAN-3294 fix deployed and verified across multiple automated syncs; hook is 445 lines with `guard=1`).
- **Close-out debt is drained** — paused agents went 16 → 4. Two remaining are LEX-1 (see §4), one is a phantom (see §3).
- Infra is quiet: leak 0, ~30 GB free, PSI 0, load ~2.
- **Only one PAN issue is genuinely in flight: PAN-3358** (ship/version step).

## 2. Open work, in priority order

| Issue | What | State |
| --- | --- | --- |
| **PAN-3367** | **Code-level audit** of 29 issues whose negative verdict was reset then passed — *did the merged diff satisfy the failing AC?* | Filed, **not dispatched** |
| **PAN-3365** | The laundering mechanism itself. Fix is one rule: *a pass must not supersede an unresolved negative verdict when no commits landed between them* | Filed, not struck |
| **PAN-3366** | Tracker resolution ranks `github_repo` above a configured Linear team | `strike-pan-3366` **running** |
| **PAN-3362** | No way to seed tracker-backed issue fixtures in workspace containers — blocks every UI-redesign UAT | Filed |
| **PAN-3358** | Ship step: propagate version strings per batch. **Must include UI-configurable settings**, not just `projects.yaml` | In flight |
| **PAN-3356** | Issue cockpit redesign. **Merged but ACs never verified** — do not close out | Held, operator's call |
| **PAN-3305** | Residual landing-gate case: merged work whose branch is now *behind* main | Blocked, not forced |
| **PAN-3313** | CLIProxy benches its only auth on one stream error → ~21–47% of GPT calls fail | **Operator-gated** (needs a second auth entry) |

## 3. Known traps — these bit me, they will bit you

**`git -C` is not cwd hygiene.** I ran `cd <workspace> && npx vitest`, and the Bash cwd persisted for *hours*. Every `git -C` call stayed correct, which is exactly why the drift was invisible — it only surfaced when something read the process cwd. It cost: a state commit landed on a strike branch; `pan reload` refused; and finally a close-out **deleted the directory my shell was standing in**. Use subshells `( cd … && … )`; never a bare `cd`.

**Verify the artifact, then verify it *again*.** A deploy I made was silently reverted four minutes later by a patrol reading a frozen `pan reload` generation. A success message is a claim about a command, not about the world.

**`pan reload` alternates generations, and the `pan` shim does not follow.** Check which generation has the fresh CLI **every tick** (`date -r <gen>/dist/cli/index.js`) — never assume. Invoking a stale CLI made a fix appear not to work when it had merged fine.

**A monitor ending is not a tick.** I moved to event-driven watching during a merge cascade and never re-armed a wakeup; **the loop then went ~26 hours with no autonomous tick** while feeling productive, because operator prompts kept arriving. Always arm the next wakeup at the end of every tick, even when a monitor is armed.

**Flat cost has at least three meanings** — finished, wedged, or blocked on a long tool call. Read the **pane text**, not the cost delta. The `agents` table's `cost_so_far` is **0 for every row** and is not a signal; the pane footer is.

**"The count went down" ≠ "the mechanism works."** Draining paused agents 16 → 5 looked like a fix, but `agent-pan-3357` survived its own successful close-out — `close-out:prune-agent-rows` does not reliably clear *paused* rows. That is how the gate count silently inflates. Verify per row.

**A count is not a finding until it has a discriminator.** I nearly reported "74 suspicious issues" when most were healthy rework. The discriminator was *commits between failure and pass*. Also verify the branch still exists — a deleted ref returns 0 commits and manufactures a false positive.

**Five concurrent Opus strikes drove load to 55** and manufactured ~64 contention-only test failures that each agent then had to triage. Staggering beats parallelism when everything gates on one host.

## 4. Operator corrections I received — do not re-litigate

- **"Why are you not fixing whatever is wrong?"** I filed nine issues and struck almost none, then declared quiescence while holding dispatchable work. *Filing is recordkeeping; the fix is the point.* If a filed machinery bug has no strike in flight, that is a failed tick.
- **"Why wait for next tick?"** The wakeup is a floor, not a schedule. Act when there is something to act on.
- **Pauses are not laziness.** 12 of 16 were `awaiting close-out (verify on main)` — correct post-merge behaviour with close-out never run behind it. **Drain close-out debt every tick.**
- **Lexerra is an early POC and should not be in the pipeline at all.** Beyond PAN-3366's precedence bug, its pipeline scope is wrong. Its two agents have been paused since 07-08.
- **"Everything else should have been moving."** Throughput was the complaint. Do not let one investigation stall the fleet.

## 5. The judgement call I would keep

I refused every `--accept-*` override — 25 close-outs, zero overrides — and held PAN-3356 rather than rubber-stamp unverified work. **Keep that.** The overrides are the operator's lever; the machinery fix that makes them unnecessary is yours to dispatch. That distinction is the single most useful rule I applied, and PAN-3365 exists because a test agent held the same line.

## 6. Suggested first moves

1. Confirm infra + drain any `post_merge_limbo` (habit, every tick).
2. Drive **PAN-3366** to merge (running).
3. Strike **PAN-3365** — the guard is one cheap rule and it stops the bleeding.
4. Dispatch **PAN-3367** as real work with full context; do not attempt 29 shallow reviews.
5. Decide lexerra's pipeline scope with the operator's POC framing in mind.
6. Drive **PAN-3358**, checking the UI-configurability requirement is in the plan.

Everything else is either operator-gated (PAN-3313) or deliberately held (PAN-3356, PAN-3305).

## RUN-75 tick 29 (2026-08-01 02:34Z) — steady state; PAN-3358 is large but sound

- Infra: hook 445/guard=1, leak **0**, 28.7 GB, load 2.4. gen-a still the fresh CLI (21:27) — checked, not assumed.
- Sweep: **no new close-out debt**. panopticon-cli holds only PAN-3305 (blocked), PAN-3356 (held — ACs unverified), PAN-3358 (in flight), PAN-3366 (struck). MIN-908 + 13 zombie PRs out of merge scope; TIN-1 backlog.
- **`strike-pan-3366`** (tracker precedence) healthy: ctx 32%, $2.33, +74/-11, still writing, not pushed.
- **PAN-3358 flagged then cleared.** Its agent showed **$152.76, +7374/-1185, 25 commits, ctx 88%** — which on a "propagate version strings" issue reads like runaway scope. Checked the file breakdown before saying so, and it is coherent: `version-ship.ts` (382) + `version-ship-deps.ts` (530) + `ship-record.ts` (250) for the step, `projects.ts` (+356/-67) for the `version_sync` config, **`ProjectSettingsDisclosure.tsx` (+305) for the operator-required UI configurability**, `dod-gate-ship.test.ts` (206) for the DoD row, ~1,440 lines of tests, and a `no-loss-matrix.ts` entry. Roughly half the diff is tests.
- **LESSON: cost and diff size are not scope signals on their own.** $152 and +7,374 lines looked alarming; the file list showed a proportionate implementation of config + ship step + DoD row + UI, with the no-loss matrix updated. **Read what changed before judging how much changed** — the same discipline as reading a pane instead of a cost delta.
- Watch item: PAN-3358 is at **ctx 88%** with 25 unpushed commits on a clean tree. If it compacts badly the work is committed and safe, but it should push soon.

### Handover status

Handover to the incoming Fable 5 orchestrator is **prepared and durable** (appended above, pushed as `992b762bcb`). `roles.flywheel.model` is now `claude-fable-5`; config backed up at `~/.overdeck/config.yaml.bak-run75-handover`. **The switch takes effect on the next spawn** — `pan flywheel start` refuses while this session is alive (singleton invariant, working correctly). Continuing to tick until the operator ends this session rather than letting the loop go dark.

---

# INTERIM — Fable 5 acting-flywheel (operator conversation, not a `pan flywheel start` run)

## Interim tick 1 (2026-08-01 ~03:00Z) — handover picked up; PAN-3358 convoy wedge root-caused; two strikes dispatched

Operator directed this conversation (Fable 5) to act as the flywheel. Old `flywheel-orchestrator` session killed per its own recommendation (durable at `5f71966c14`).

- **Infra verified:** the "hook 445/guard=1" artifact is `~/.overdeck/bin/work-agent-stop-hook` — 445 lines, guard present, byte-identical to main's `sync-sources/hooks/work-agent-stop-hook`. (First check hit the wrong file: `pre-tool-hook` is 35 lines and always was. The handover metric never named its file — now recorded.) Leak ~0, 175 GB free, load ~3.9, dashboard healthy on **gen-a** (built 01:27Z, buildCommit `5194158a8e`).
- **PAN-3358 review wedge root-caused (new defect class → PAN-3368):** correctness sub-reviewer died 00:35Z (`orphaned: tmux session missing (reconcile)`, ~4s after its 00:30 resume) with no `correctness.md`. The deadline warm-respawn (02:26Z) and `pan review restart` (02:43Z) both resume ONLY the synthesis parent — no child liveness check, no re-dispatch. `pan review restart --role correctness` fails with "per-reviewer restart route retired" while the CLI still advertises the flag. Unwedged via `pan review abort` + `pan review request` (verification → fresh convoy, 25 auto-requeues remaining). Filed **PAN-3368**, dispatched **strike-pan-3368**.
- **strike-pan-3365 dispatched** (verdict-laundering guard — handover move #3). Investigating at dispatch time.
- **strike-pan-3366** finished: full gates passed at `2513075c1b`, PR **#3369** open, CI running. I own its merge; landing when green.
- **planning-pan-3367 started** (`pan plan --auto`) — the 29-issue audit gets a real plan, not 29 shallow reviews. First attempt failed "database is locked / dashboard is not responding" — dashboard was healthy; the lock was transient and the error message misdiagnoses it. Retry succeeded. (Watch for recurrence before filing.)
- **PAN-3356 is IN the live build** — its UAT batch merge `5194158a8e` IS the live buildCommit. Operator will UAT it live personally after the next `pan reload`; **pause directive**: once PAN-3366 lands and a fresh reload is verified healthy, hold ticking so the operator can test undisturbed.
- Second `dist/dashboard/server.js` (pid 937207) verified as a Docker workspace-container peer (cwd `/workspaces/overdeck`), not an orphaned duel.
- Held unchanged: PAN-3356 close-out (ACs → operator UAT), PAN-3305, PAN-3313 (operator-gated), lexerra scope (operator's POC call). No `--accept-*` overrides.

## Interim tick 2 (2026-08-01 ~03:15Z) — PAN-3366 landed; reload false-abort outage caught, root-caused, filed+struck (PAN-3370); PAUSED for operator UAT of PAN-3356

- **PAN-3366 merged** (PR #3369, squash, all checks green incl. 14m34s test lane) and handed off to verifying-on-main via `pan done --strike`. Its record-write hit a lock held by this conversation and fell back to the workspace `pipeline-verdict.json` (PAN-2583 sweep will pick it up — verify at close-out).
- **NEW OUTAGE + defect (PAN-3370, struck):** first `pan reload` built gen-b from `645e344255b4`, killed the live server, then aborted on a FALSE `PID 378934 (cmd: unknown) survived SIGKILL` — the pid was dead, `/proc` gone; the checker treats unreadable-cmdline as alive. Abort landed in the worst ordering: old server dead, new never started → **dashboard fully down** until manual `pan restart` (~3 min). That restart came up on stale gen-a; a reload retry then succeeded cleanly. Live = **`645e344255b4`** (pid 3144743), contains PAN-3356 + PAN-3366. **LESSON: a reload that reports failure may have already killed the server — check `:3011` immediately, not eventually.**
- Old gen-a dist was missing `dist/fts-worker.js` (merge-agent memory-reset marker failed, non-fatal) — watch whether the fresh build still lacks it before filing.
- Docker residue noted: container pid 2423895 runs `server.js` with a DELETED cwd (`/workspaces/overdeck (deleted)`) — a workspace container outliving its directory; reaper should own this, verify later.
- Fleet at pause: strike-pan-3365 ($15.01, +291/−65), strike-pan-3368 ($5.02, +176/−75), strike-pan-3370 (just spawned), planning-pan-3367 (k3, +241 notes). PAN-3358: verification → fresh review convoy cycle in flight server-side (25 auto-requeues).
- **PAUSED per operator directive:** PAN-3356 merged + deployed + fresh restart verified → operator UATs the issue-cockpit redesign live. No ticks, no reloads, no restarts until the operator finishes. Heartbeat stopped deliberately.

## Interim tick 3 (2026-08-01 ~03:50Z) — resumed; LIVE laundering specimen caught on PAN-3358 (Variant B: stale-head replay); PAN-3367 planned

Operator finished UAT pause and said resume.

- **THE FINDING: verdict laundering caught in the act, with full forensics — a second VARIANT.** PAN-3358 showed `review=passed test=passed ready_for_merge=1`, but the event log proves it is unearned: 02:45:16Z reset to pending after the security fix (f7babead96 → head e5e53eba); 03:00:17Z verification passed, convoy dispatched; all four sub-reviewers alive 03:01:08Z; **03:01:43Z the row flipped passed/passed — 35s after reviewers spawned — with testNotes citing HEAD `570d4777` (a commit BEFORE the security-fix commits) and NO review notes**, while `reviewed_at_commit` stamped the current head e5e53eba. The freshly-spawned convoy kept running, oblivious. Timing coincides to the second with my `pan done PAN-3366 --strike` whose journal write failed to the PAN-2583 workspace-fallback; suspects are the fallback sweep and/or durable-verdict restore rehydrating the record's `pipeline` block over a live row. **Variant A (PAN-3356): pass supersedes unresolved negative, no commits between. Variant B (this): stale verdict from an older head replayed onto a newer commit, overwriting an in-progress cycle.** Posted full evidence to PAN-3365 (comment 5149645219). The guard must anchor verdicts to the commit they verified. NOT merging PAN-3358 on this row; the real convoy (run e5e53eba) will supersede when it finishes — verify its verdict is organic before any UAT assembly.
- **PAN-3367 planned cleanly**: PRD `drafts/pan-3367.md` (20 KB) + 36 KB xBRIEF on overdeck-state at 03:12Z, planner exited normally. Awaiting operator release (autonomy OFF).
- **PAN-3370 fix reviewed** — correct on all three layers (EPERM-only liveness, ps re-probe kills the `cmd: unknown` race, ports-free ⇒ continue restart instead of aborting between kill and start). PR #3371 green except test lane; merging on completion.
- strike-pan-3365 verifying (ctx 80%, $22, +304/−101 incl. verdict-restore/review-status-db changes — review its final diff against BOTH variants before landing). strike-pan-3368 verifying ($10.6, +300/−104). PAN-3358 correctness reviewer verified genuinely working (compacted mid-review; reading files, searching).
- Main CI green on `ec2259d7d2`.

## Interim tick 4 (2026-08-01 ~04:25Z) — PAN-3366 + PAN-3370 closed out (zero overrides); operator-reported restart-UX defect filed+struck (PAN-3373)

- **PAN-3370 landed** (merge train merged #3371 at 03:51:29Z once checks went green — note: strike PRs DO get auto-merged by app/overdeck-agent; my ownership reduced to review + close-out). `pan done --strike` handed off; deploy patrol rebuilt at 04:09 (`d0def2307c`).
- **PAN-3366 and PAN-3370 closed out** via `pan close --force` (prompt-skip only): 8-row DoD gates recorded, tracker issues closed, review status cleared, **no `--accept-*` overrides**. post_merge_limbo for panopticon-cli back to PAN-3305 + PAN-3356 (both deliberate holds).
- **Operator reported (with screenshot) the restart-UX failure → PAN-3373 filed + struck.** Root causes located to file:line: (1) `loadProjectsConfigSync` (`src/lib/projects.ts:284`) fails open to `{projects:{}}` on any projects.yaml read error → `/api/registered-projects` serves 200 [] → CommandDeck renders a definitive "Unknown project / not a registered project" while the unreachable banner is up. Fail-closed fix + `ProjectRegistryErrorState` already exists. (2) `EventRouter.onReconnect` (`EventRouter.tsx:274`) calls `bootstrap()` on the just-disposed WsTransport (`wsTransport.ts:158` throws) → snapshot never re-bootstraps after a restart. (3) No RPC-side equivalent of the terminal's calm 4503 "Dashboard restarting" state; definitive negative empty-states render during known outages. **Same unknown-reported-as-definitive-negative shape as PAN-3370's pid check — that's now twice in one night; treat "fail-open to a confident answer" as a review lens.**
- Fleet: strike-pan-3365 (ctx 83%, $23.5), strike-pan-3368 ($11.8), strike-pan-3373 ($5.7, +254/−77) all in verify. **PAN-3358 convoy verified organic** — all four reviewers actively reading source (`projects.ts` routes, `secret-redaction.ts`, prior-cycle reports); no reports yet ~80 min in on the 7.4k-line diff. Laundered 03:01:43 row still quarantined — no merge until the convoy's own verdict lands.
- Infra: load 18–22 is three concurrent strike verify suites — CPU PSI avg10 0.31, memory PSI 0, 169 GB free. Not pressure. Main CI in_progress on the docs push.

## Interim tick 5 (2026-08-01 ~04:55Z) — PAN-3368 landed+deployed+closed; its new door immediately recovered a 100-min convoy freeze; PAN-3375 filed

- **PAN-3368 landed and closed out** (PR #3372, merge train, merge commit `d0def2307c` = the already-live build; 8-row DoD, no overrides). The fix went deeper than my filing: convoy-launch idempotency was **convoy-wide** — any one surviving lane made recovery a no-op for all four — now **per-lane** (relaunch iff no live session, no running state, no report). Per-reviewer route unretired, CLI `--role` wired, success = all-lanes-launched.
- **CORRECTION of my tick-4 claim:** the PAN-3358 reviewers were NOT "actively reading" — the pane lines were restored-transcript scrollback. All four froze at `lastActivity == resume+5s` (03:01:11Z) with costs byte-identical across three checks. **LESSON: progress claims need a DELTA (cost/ctx between two ticks), never a pane snapshot.** Record per-tick reviewer costs from now on.
- **The freeze class → PAN-3375:** warm-resumed reviewers never processed their kickoff (all four, same second — systematic, not flake), AND child `reviewDeadlineAt` (03:21Z) passed with zero enforcement (parent deadlines fire; child deadlines don't). 
- **Recovery: the PAN-3368 door, deployed ~20 min prior, un-froze all four lanes on first live use** (`pan review restart PAN-3358 --role <r>` × 4; correctness cost $1.24→$1.66 within 30s, ctx 22%, generating). Substrate fix → immediate operational payoff, same night.
- strike-pan-3365 still verifying (1h52m in verify — long; watch for a wedge next tick). strike-pan-3373 verifying. Main CI green.
- Reviewer cost baseline for delta checks next tick: correctness $1.66, security $1.19, requirements $1.35, performance $1.70.

## Interim tick 6 (2026-08-01 ~05:20Z) — PAN-3358 convoy finished ORGANIC APPROVED; PAN-3365 landed (Variant A killed), Variant B filed+struck (PAN-3377); PAN-3373 in CI

- **PAN-3358: organic verdict APPROVED at head e5e53eba** — all four reviewers ran for real after the per-lane restarts (correctness demoted its one finding via the convergence gate; 0 blocking across all four; synthesis written). The laundered 03:01:43 row's *conclusion* is now independently confirmed; the quarantine concern shifts from "unearned verdict" to one caveat: **browser-UAT evidence is from head 570d4777 (pre-lock-fix)** — the two lock commits are backend-only so the UI observations likely hold, but the operator should know at UAT/merge time. require_uat_before_merge=ON keeps this operator-gated.
- **PAN-3365 landed** (PR #3374, train; merge c15edea146, live build = that exact commit). The fix: durable `uatStatus`/`uatNotes` lane (schema migration + topups), failed UAT survives retries/restore and **hard-blocks readyForMerge**. Variant A (the PAN-3356 incident) is structurally dead. Close-out attempted → **DoD gate correctly blocked on main-verify (CI still running on c15edea146)** — no override taken; retry next tick.
- **Variant B is NOT covered** (verdict-restore change only widened restored fields; nothing anchors verdicts to commits). Filed **PAN-3377** (commit-anchored verdicts; restore must never overwrite a live cycle; loud refusal) and dispatched **strike-pan-3377** same tick.
- **PAN-3373 ready + reviewed**: fail-closed registry (`loadProjectsConfigSync` throws on read/parse failure of an EXISTING file; `existsSync` guard preserves fresh-install empty state), route 500s → existing `ProjectRegistryErrorState`; EventRouter bootstrap gets fresh-transport + retry-on-failure + promise dedup; new `BackendConnectionBoundary` wraps the route tree so NO definitive negative state can render while down/restarting/reconnecting. PR #3376 in CI (watch armed).
- strike-pan-3365 session lingering at ctx 85% post-ready (by design). Load down to ~5.

## Interim tick 7 (2026-08-01 ~05:40Z) — PAN-3365 closed out; PAN-3373 merged; laundering writer likely identified (PAN-2952's reconcile)

- **PAN-3365 closed out** (gate cleared once main CI went green on `3db4deb1` — the earlier block was the DoD gate working, not a defect). Variant A of laundering is landed, deployed, closed.
- **PAN-3373 merged** (#3376 squash → `b90a5bdd4b`, all checks green) and handed off to verifying-on-main. The operator's restart-UX report went screenshot → root-cause → fix → merged in ~3.5 hours. Close out next tick once deployed + main CI green.
- **The `pan done --strike` journal-write failure is 3/3 tonight** (PAN-3366/3370/3373: self-held record lock from the same invocation's tree + PAN-2583 fallback rescue). Filed PAN-3378, then found existing **PAN-2952** covering the identical class with a sharper mechanism — closed 3378 as dup, appended tonight's evidence. **KEY INSIGHT: PAN-2952's "reads reconcile stale journal over fresh DB state" is the prime suspect for the 03:01:43 laundered write** — stale journal (passed/passed @570d4777) restored over fresh DB (reviewing @e5e53eba) during pan-done-triggered status reads. PAN-3377's commit-anchoring strike is the complementary guard; the reconcile-direction fix in PAN-2952 is the other half. LESSON (mine): read the dedup search results BEFORE filing, not after.
- strike-pan-3377 in verify ($10.6, +341/−19). PAN-3358 unchanged: organic APPROVED, operator-gated on UAT (stale-UAT caveat stands).
- Load ~7. Main CI green on `3db4deb1`.

## Interim tick 8 (2026-08-01 ~06:10Z) — operator surfaced two more phantoms; PAN-3373 closed out; PAN-3377 ready and in CI

- **Operator reported (screenshots): 3 of 4 "Needs you" rows are for MIN issues merged and closed out weeks ago** (MIN-882 07-24, MIN-852 07-22, MIN-861 07-11 — verified via GitLab MR state + durable records; none had review_status rows). The 4th (MIN-864) is genuinely stalled but its "all checks passed" caption is false (record: pending/pending), and the cockpit shows "No PR" despite an open GitLab MR (GitLab-blind PR lens). **Filed PAN-3379** (needs-you escalations never retire + captions not derived from canonical state).
- **PAN-3356's first real UAT — the operator's click — FAILED**: contradictory states, eternal Loading, Worktree missing, empty placeholders on MIN-864. Evidence posted to PAN-3356; the close-out hold is vindicated. PAN-3362 (fixture seeding) remains the verification blocker.
- **PAN-3373 closed out** (8-row DoD, no overrides) — operator's restart-UX report went screenshot → merged → closed in ~4h.
- **PAN-3377 strike ready + reviewed**: write-door guard `rejectVerdictEvidenceHeadMismatch` cross-anchors gates (terminal review evidence vs lastVerifiedCommit; terminal test evidence vs reviewedAtCommit); verdict-restore refuses stale snapshots against a live cycle with a loud two-head warn; fallback-sweep merge gets the same comparator. PR #3380 in CI (watch armed).
- **Flywheel-succession question raised by operator.** My recommendation, delivered: start the real `pan flywheel start` run (Fable 5 config already active for next spawn); I stay as supervising conversation. Awaiting the operator's go — heartbeat continues with a stand-down check if the singleton appears.

## Interim tick 9 (2026-08-01 ~06:40Z) — PAN-3377 merged (both laundering variants now guarded); strikes dispatched for PAN-3379 + PAN-3375

- **PAN-3377 merged** (#3380, train, `34976119e7`) and handed to verifying-on-main. **Both laundering variants are now structurally guarded once deployed**: A (PAN-3365 — failed UAT survives and blocks merge) + B (PAN-3377 — verdicts commit-anchored, verdict-restore refuses stale snapshots over a live cycle with a loud two-head warn). Close-out pending main CI (in_progress on the merge commit) + deploy.
- **Fleet re-saturated**: `strike-pan-3379` (needs-you escalations never retire; captions must derive from canonical state) and `strike-pan-3375` (warm-resume kickoff loss + child reviewer deadline enforcement wired to the PAN-3368 per-lane door) dispatched. Both vetted: disjoint code areas, aligned with the two-door tenet.
- Load spike to ~21 = parallel vitest workers (verification on the PAN-3377 merge); CPU PSI 5.8, fine.
- Still no `pan flywheel start` from the operator — continuing interim loop with stand-down check each tick.

## Interim tick 10 (2026-08-01 ~07:00Z) — PAN-3377 closed out; both laundering guards are LIVE

- **PAN-3377 closed out** (main CI green past the merge; live build = the merge commit itself; 8-row DoD, no overrides). **The verdict-laundering defect class is now closed end-to-end**: Variant A guard (PAN-3365) + Variant B guard (PAN-3377) both merged, deployed, verified, closed — from first forensic specimen to both guards live in under 5 hours.
- strike-pan-3379 in verify ($4.98, +59/−14 — small surgical diff as expected for a retirement sweep). strike-pan-3375 pushing (+251/−38, deadline enforcement + resume-kickoff verification).
- Interim-run scoreboard so far: **8 issues landed and closed out** (PAN-3365, 3366, 3368, 3370, 3373, 3377 + close-out drains), 4 substrate issues filed with root causes (PAN-3368, 3373, 3375, 3379), 1 dup correctly folded (PAN-3378→PAN-2952), 2 live incidents recovered (reload outage, convoy freeze), 0 overrides, laundered PAN-3358 row quarantined until organically superseded.

## Interim tick 11 (2026-08-01 ~07:15Z) — both strikes ready and reviewed; CI watches armed

- **PAN-3379 reviewed**: needs-you classification now requires the canonical `pipelineBucket` from the membership resolver (terminal/zombie buckets can never classify as needs-you) and captions are derived labels ("plan approval") instead of the frozen "all checks passed". Render-time derivation from the canonical read door — structurally kills the phantom class rather than sweeping a store. Small surgical diff (+59/−14) + 41 lines of tests. PR #3381.
- **PAN-3375 reviewed**: deacon convoy monitor now (1) detects a warm-resumed reviewer whose activity mirror never advances → kill + per-lane respawn via the PAN-3368 door, bounded by `reviewRetryAttempt`; (2) enforces child `reviewDeadlineAt` with a single-lane retry before REVIEWER_FAILED. Fake-timer tests per repo rule (+185 test lines).
- Both PRs in CI with a combined background watch; land + close out on green. Load back to ~3.

## Interim tick 12 (2026-08-01 ~07:50Z) — PAN-3379 closed out; PAN-3375 merged; next wave dispatched (PAN-2952 strike, PAN-3362 plan)

- **PAN-3379 landed, deployed (live build = its merge commit), closed out** — the operator's "Needs you" phantoms are structurally dead: classification requires the canonical pipeline bucket. **PAN-3375 merged** (`239b80b51f`, I squash-merged after the train didn't take it) and handed to verifying-on-main; close-out pending main CI + deploy.
- **Every substrate defect found tonight is now merged**: convoy per-lane recovery (3368), reload false-abort outage (3370), restart-UX truthfulness (3373), laundering Variant A (3365) + Variant B (3377), needs-you phantoms (3379), reviewer freeze + child deadlines (3375). Nine landed issues, zero overrides.
- **Next wave**: `strike-pan-2952` (reconcile must prefer newer of journal/DB — the remaining half of the laundering machinery, 3/3 fresh evidence) and `planning-pan-3362` (tracker-backed UAT fixtures — unblocks PAN-3356 verification, made urgent by the operator's failed cockpit UAT).
- PAN-3358 still operator-gated on UAT. Load ~3.5.

## Interim tick 13 (2026-08-01 ~08:30Z) — 50-min dashboard outage found+recovered (PAN-3383); paused/close-out census answered; PAN-3358 + MIN-928 closed out

- **Operator merged PAN-3358 himself** (#3361, 05:26Z, UAT-batch merge) — closed out clean. MIN-928 closed out on retry (its earlier "canonical state unavailable" block was the outage below).
- **OUTAGE:** deploy patrol built gen-b (07:19, `bf3048484c`), something SIGTERMed the live server ~07:27 **without starting a successor or writing restart-status**, and the **supervisor watched 24 consecutive hard failures with `restartAttempts: []`, `gaveUp: false`** — the watchdog's one job never fired. Manual `pan restart` restored (gen-b, pid 3061308). ~50 min fully dark; this is what made the operator's dashboard buttons "do nothing." Filed **PAN-3383** (both defects: silent watchdog + kill-without-successor in the patrol's restart path — PAN-3370 fixed only pan reload's variant), struck.
- **Census answer to operator (paused + merged-needs-close-out):** the state is designed post-merge behavior; the accumulation causes are (a) close-out lag — drained: PAN-3358 + MIN-928 tonight; (b) deliberate holds PAN-3356 (ACs unverified) + PAN-3305; (c) **phantom paused rows**: close-out's prune step preserves rows for transcript retention but never clears `paused=1` (agent-pan-3357 paused forever post-close) — same never-retired-flag family; (d) LEX-1 pair, 24 days, operator's lexerra POC call.
- **PAN-3356 stuck banner root-caused:** `stuck=feedback_delivery_needs_you` set 20:50Z during a feedback loop, condition self-resolved (row: passed/passed/merged) but stuck flags have NO auto-retirement; only close-out clears them and 3356 is deliberately held. Manual doors BOTH broken: `pan unstick` doesn't exist (PAN-3321) and the dashboard's Clear-stuck-gate hits `/unstick` whose handler **resets the lifecycle to pending** — running it on a MERGED issue would corrupt the row (stale-approval guard is wrong for terminal issues). Left the flag in place rather than corrupt state; needs a merged-aware clear path.
- Fleet: strike-pan-2952 running, planning-pan-3362 running, strike-pan-3383 spawned.

## Interim tick 14 (2026-08-01 ~08:55Z) — PAN-3375 closed out (11 landed+closed); PAN-2952 merged; PAN-3362 planned

- Dashboard health verified first (pid 3061308 gen-b holding) — I'm the watchdog's backstop until PAN-3383 lands.
- **PAN-3375 closed out** (8-row DoD, no overrides). **Eleven issues landed and closed out this interim run.**
- **PAN-2952 merged** (#3384, train, `11489f48`): same-process record-rebuild serialization before the filesystem lock — with PAN-3377's verdict-restore + review-status-read guards, all three PAN-2952 asks are covered. Handed to verifying-on-main; close-out on CI+deploy. Observation (not proof): first `pan done --strike` tonight with no journal-write failure.
- **PAN-3362 planned** (PRD + xBRIEF on overdeck-state) — awaiting operator release; it unblocks PAN-3356 verification.
- strike-pan-3383 (watchdog no-restart + patrol kill-without-successor) implementing (+69/−7). CPU PSI ~21 from strike suites — contention real but transient; dispatching nothing further this tick.

## Interim tick 15 (2026-08-01 ~09:15Z) — PAN-2952 closed out (12 landed+closed); PAN-3383 scope-split honestly; deploy patrol restart self-healed this time

- Dashboard health first: **deploy patrol restarted onto the PAN-2952 build on its own** (pid 3868881, live = `11489f48`) — the patrol restart path works sometimes; last night's failure mode is intermittent, reinforcing the need for initiator logging.
- **PAN-2952 closed out** (8-row DoD). Twelve issues landed+closed this interim run.
- **PAN-3383 strike ready — but it fixed only defect 1** (watchdog self-explanation: `restartBlockedReason`/`restartInProgress`/`blockedUntil` on every deferral branch incl. named lock holder; silent watchdog now impossible). Verified `restart-lock.ts` already breaks dead-holder locks (EPERM-only alive check), so the incident holder was likely alive-and-hung — the new observability will name it next occurrence. **Defect 2 (initiator persistent logging + always-start-successor in the patrol path) NOT addressed — filed PAN-3386 as the split follow-up rather than closing 3383 as fully done.** That's the unearned-done pattern applied to my own close-outs.
- PR #3385 in CI (watch armed); land + close on green.

## Interim tick 16 (2026-08-01 ~09:45Z) — PAN-3383 merged and live; PAN-3386 struck

- **PAN-3383 merged** (#3385, train, `419851706f`) and the deploy patrol self-healed onto it (pid 4135575) — the watchdog now states its blocking reason on every deferral. Close-out pending main CI on the merge commit.
- **strike-pan-3386 dispatched** (initiator persistent logging + always-start-successor in the patrol restart path + hung-holder lock surrender) — fleet was drained, load 2.6.
- Interim scoreboard: 12 landed+closed, PAN-3383 at verify-on-main, 1 strike in flight, PAN-3362 + PAN-3367 planned awaiting release, PAN-3356 held (ACs), PAN-3305 held.

## Interim tick 17 (2026-08-01 ~10:05Z) — PAN-3383 closed out (13 landed+closed); PAN-3386 in verify

- Dashboard healthy (pid 4135575 holding). **PAN-3383 closed out** (main CI green past the merge; 8-row DoD, no overrides).
- strike-pan-3386 (+246/−86) in its verify phase — the last in-flight item of the interim run besides operator-gated holds.
- Current outstanding: PAN-3386 (verify), PAN-3362 + PAN-3367 planned awaiting operator release, PAN-3356 held (ACs unverified — fixture work PAN-3362 unblocks it), PAN-3305 held, lexerra scope = operator call, PAN-3313 operator-gated.

## Interim tick 18 (2026-08-01 ~10:25Z) — steady state; PAN-3386 verifying (delta-confirmed progress)

- Dashboard healthy (pid 4135575 holding, 3rd tick). Main CI green. Load ~7. post_merge_limbo drained.
- strike-pan-3386 in verify with real progress delta ($7.9→$11.2, +256/−92). Nothing else dispatchable — the remaining queue is entirely operator-gated (release PAN-3362 / PAN-3367; PAN-3356 hold; lexerra scope; PAN-3313 second auth).

---

# INTERIM RUN END (2026-08-01 ~10:35Z) — operator reactivating the real flywheel

Heartbeat stopped at operator direction; no monitors or background watches remain. **The incoming orchestrator inherits:**

1. **strike-pan-3386 in verify** (initiator logging + always-start-successor + hung-holder surrender). On its readiness signal: review the diff, land (train usually merges on green), `pan done PAN-3386 --strike`, close out when deployed + main CI green. Whoever spawns a strike owns its merge — I spawned this one; ownership transfers with this note.
2. **Operator-gated queue:** PAN-3362 + PAN-3367 planned, awaiting release; PAN-3356 held (ACs unverified — its first real UAT FAILED, evidence on the issue; PAN-3362 unblocks proper verification); PAN-3305 held; lexerra scope; PAN-3313 second CLIProxy auth.
3. **Watch items:** the deploy-patrol restart path failed once tonight (PAN-3383 incident, ~50-min outage) and self-healed three times since — intermittent; the watchdog now states its blocking reason, so read `:3012/status` when the dashboard is dark. `pan close`/`pan done` journal-write failures should be gone (PAN-2952) — if the PAN-2583 fallback line reappears, that's a regression signal. Stuck gates have no auto-retirement and BOTH manual clear doors are broken for merged issues (`pan unstick` missing per PAN-3321; `/unstick` route resets lifecycle to pending — corrupting for merged rows): needs a merged-aware clear path, not yet filed as its own issue.
4. **Interim totals:** 13 issues landed and closed out (PAN-3365, 3366, 3368, 3370, 3373, 3375, 3377, 3379, 3383, 2952, 3358, MIN-928, + drains), both verdict-laundering variants guarded and live, 2 outages recovered, 0 DoD overrides, 0 `--accept-*`.

---

# RUN-79 (2026-08-01, claude-fable-5, all-tracked-projects, auto_pickup=OFF, UAT-before-merge=ON, min 2 / max 20)

## RUN-79 tick 1 (2026-08-01 ~09:40Z) — inherited strike landed; PAN-1889 executed per operator directive; 3 new strikes dispatched

- **PAN-3386 LANDED** (PR #3387 squash `6d0bdf5e`, train merged it on green; `pan done --strike` handed off to verifying-on-main, no journal-write failure — PAN-2952 fix holding 2/2). Diff reviewed: deploy re-execs into independent systemd-run unit pre-destruction (kills the cgroup-reap mechanism of the PAN-3383 outage), durable initiator+`stopping` phase written BEFORE SIGTERM, restart-lock heartbeat + staleness-based (not pid-aliveness) surrender for alive-but-hung holders. Close-out pending main CI + deploy.
- **PAN-1889 executed (operator directive: "why is flywheel state so big — address now")**: one-time compaction 9,578 → 506 lines (1.5MB → 66KB) per the issue's policy — curated sections + RUN-75 handover + interim run kept verbatim (byte-verified), RUN-39…RUN-75 compacted to run-log lines, full detail in git history. `strike-pan-1889` dispatched for the mechanical half (threshold enforcement in `pan flywheel report`).
- **PAN-3389 filed + struck**: `pan memory search` dead on deployed builds — `memoryFtsWorkerUrl()` (fts-db.ts:169) resolves the worker by chunk-name whitelist; bundler renamed the chunk to `search-<hash>.js` → fallback path `dist/fts-worker.js` never exists. Worker itself present at `dist/lib/memory/fts-worker.js` all along. Interim tick-2 watch item, now root-caused.
- **PAN-3390 filed + struck (operator-reported)**: composer effort dropdown showed "Max" for this high-effort session — ComposerFooter.tsx:116 initializes from browser-global localStorage, never from conversation.effort. Verified my own process: `--effort high` in /proc cmdline. Same display-not-from-canonical-state family as PAN-3379.
- **MIN-929 fresh-restarted**: alive-but-inert 56 min at review-rework with unprocessed feedback, no pending operator decision (`pan answer` clean) → `pan start --fresh` per PAN-3150 door. Watch: if the delivered-feedback-never-processed class recurs, file it (PAN-3257 covers only the crash-resume PTY variant).
- Membership sweep: 4 typed blind spots (papers-please/puzzdom tracker_unconfigured, lexerra/krux forge_unavailable) surfaced as investigate suggestions. MIN zombie_pr ×11 audit-only. MIN-864 still stalled (pending/pending record, GitLab-blind PR lens) — investigate next tick.
- Held: PAN-3356 (ACs), PAN-3305, PAN-3362 + PAN-3367 awaiting release, lexerra scope, PAN-3313.

## RUN-79 tick 2 (2026-08-01 ~09:50Z) — PAN-3386 CLOSED OUT (fix live); MIN-864 unstuck after a week; state compaction pushed

- **PAN-3386 closed out** (main CI green on merge `6d0bdf5e`, deploy patrol shipped it — successor pid 1923951 came up in ~10s while I watched as backstop; 8-row DoD, no overrides). The supervised-deploy fix is LIVE, so future post-merge deploys can no longer kill-without-successor.
- **FLYWHEEL-STATE compaction pushed** (`e68d47c54d` after pull-merge). Tick-1 push had been blocked by ANOTHER session's dirty primary worktree tripping the file-size pre-push guard (settings.ts 1138>1134, model-capabilities.ts 1532>1463) — that session updated the allowlist and is mid-flight on a model-catalog/CLIProxy change set + a lint-file-size `--at` fix for exactly this dirty-tree-blocks-push defect. Left their work untouched.
- **MIN-864 unstuck after ~1 week**: polyrepo workspace (6 sub-repos on feature/min-864), verification passed 07-25, open GitLab MR, but NO registry agent state and review record pending/pending — pipeline lost track. `pan review request MIN-864` accepted (verification → convoy). Watch: if the convoy wedges on the wrapper shape, that's live evidence for the wrapper-blind stamp/compare sites (PAN-2948 follow-up).
- Strike baselines for delta checks: pan-1889 $4.59 +296/−21 · pan-3389 $3.84 +37/−13 · pan-3390 $4.21 +60/−6 · MIN-929 fresh session $3.54 +6/−11 (progressing).
- Main CI green ×2. Load normal.

## RUN-79 tick 3 (2026-08-01 ~10:10Z) — MIN-864 root-caused end-to-end; 2 substrate bugs filed+struck (PAN-3392, PAN-3393)

- **MIN-864 fully diagnosed**: my tick-2 re-review triggered verification, which failed at `sync-target-branch` — REAL merge conflicts vs main in fe (8 files) + api (4 files), all voice-pipeline area (main got competing voice work during the week it sat). Feedback was written but delivery failed: **resurrection silently returned false because the agent registry row is GONE** (`feedback-target.ts:167` null-state path has no log and no start fallback) → re-marked `stuck: feedback_delivery_needs_you`. Plain `pan start MIN-864` worked first try (7 checklist items, continue.json). Agent now resolving conflicts per the feedback file.
- **PAN-3392 filed+struck**: resurrection resume-only + silent null-state failure + no start fallback (the backstop-as-symptom rule — I manually did what the primary path should have).
- **PAN-3393 filed+struck**: stuck flags never auto-retire + `/unstick` route resets lifecycle (corrupting for merged rows) + `pan unstick` missing (PAN-3321). Two specimens: PAN-3356, MIN-864. This was the handover's unfiled watch item — now filed.
- Strike deltas (all progressing): pan-1889 $9.05 +331/−31 · pan-3389 $5.16 (out 344→534, verifying) · pan-3390 $6.09 (out 231→406, verifying). MIN-929 durable-review verification worker running. PAN-3390 merge-verify worker running.
- Noted, not chased: verification workers spawn from the stale `.pan-reload-generation-a` dist path while the live server is the post-merge primary-dist build — watch whether worker code lags fixes; candidate issue if it bites.
- Main CI green. Load ~11 (verification suites). Fleet: 5 strikes + 2 MIN work agents.

## RUN-79 tick 4 (2026-08-01 ~10:35Z) — OPERATOR SATURATION DIRECTIVE: full both-project audit; 6 zombies drained, 4 starts, 2 strikes landed/healed

Operator: "ALL issues in MYN and overdeck pipelines should be progressing" — treated as blanket release + full pane-level audit of both projects.

- **PAN-3390 (composer effort) LANDED** — train had merged PR #3391 while the strike sat in `pan monitor` for ~54 min unaware; `pan done --strike` handed off. **PAN-3389 PR #3394 in CI** (same monitor-blindness, 59 min). WATCH ITEM: `pan monitor` blocks strike agents for an hour+ without waking them on their own PR merge — candidate substrate issue after observing next occurrence.
- **PAN-3305 un-wedged**: not an operator hold — PR #3316 merged 2 days ago but 3 de-flake commits sat UNPUSHED on the local strike branch (remote branch deleted post-merge). Pushed, PR #3395 open. Close-out after it lands.
- **Starts**: PAN-3362 + PAN-3367 (operator directive = release), MIN-874 (planning was done, start was never issued — planning→start gap again), MIN-839 (auto-planning → auto-start).
- **MIN zombie sweep (11 rows)**: drained 6 by close-out (MIN-852, 729, 794, 861, 862 = real lag; MIN-882 already closed 07-23 = resolver residue). 7 recordless ancients (MIN-172, 572, 576, 596, 620, 622, 632) fail close-out "no record found" — no disposition path. Filed **PAN-3396** (resolver resurrects terminal issues + recordless dead-letter).
- **MIN-908 closed out.** MIN-929: work agent idle is NORMAL (in review); convoy lanes correctness+requirements were frozen at 0 output (PAN-3375 signature on FRESH spawns, not warm-resumes — the landed detector may not cover this variant); per-lane restarts issued — correctness recovered, requirements still 0-output, one more cycle before escalating.
- Fleet now ~10 active. Load watch: verification suites stacking.

## RUN-79 tick 5 (2026-08-01 ~10:50Z) — PAN-3389 + PAN-3305 both LANDED; MIN-929 review APPROVED; whole fleet delta-verified working

- **PAN-3389 landed** (train merged #3394; handed off). `pan memory search` fix reaches the next deploy.
- **PAN-3305 landed** (#3395 squash `4b2be68a` — the earlier test-lane FAILURE snapshot was stale, re-run green; handed off). The 2-day-old orphaned strike is fully recovered.
- **MIN-929 review APPROVED** (cycle-3 convergence, 0 blocking; all four reports + synthesis written). The per-lane restarts un-froze both lanes — but NOTE: the freeze hit FRESH spawns, not warm resumes; PAN-3375's detector may not cover this variant. Second specimen = file the variant.
- Delta-verified ALL active agents working: strike-1889 $12.65 (task output), strike-3392 $12.91 ctx 87% (WATCH context), strike-3393 $8.50 (tests), pan-3362 $10.21 +526, pan-3367 $13.32 +667, min-874 $12.99 +892, min-864 $6.76 +38/−102 (conflict resolution — deletions = taking main's side where superseded).
- Close-outs pending deploy/CI: PAN-3389, PAN-3390, PAN-3305.

## RUN-79 tick 6 (2026-08-01 ~11:05Z) — PAN-3390 closed out; strike-3392 READY (PR #3398 in CI); MIN-839 auto-started

- **PAN-3390 closed out** (live build 3dbdb49764 contains its merge; 8-row DoD). PAN-3389 + PAN-3305 close-outs wait on the next deploy (their merges postdate the live build).
- **strike-pan-3392 READY** — diff reviewed and it's the prescribed fix done right: null-state logs + canonical-start fallback (via agents endpoint = the write door), resume-failure and resume-lied paths also fall back, orphan-proposed-reconciler refactored onto the same shared spawn (single door, −65 dup lines). PR #3398: only test lane pending. Land on green.
- strike-3393 in verify ($11.61). strike-1889 still implementing ($13.32 → watch; longest-running strike).
- **MIN-839 work agent auto-started** post-finalize (06:58 local) — the planning→start gap did not recur here.
- MIN-929 awaiting test dispatch (review APPROVED). MIN-864 conflict resolution slowed ($6.99, +38/−102, nudge visible) — one more tick before intervening.
- pan-3362 $18.76 +809 · pan-3367 $29.49 +1432 (audit docs) · min-874 $24.30 +2364 (Java tests) — all delta-verified working. 21 agents active.

## RUN-79 tick 7 (2026-08-01 ~11:20Z) — PAN-3392 landed (train); PAN-3389 + PAN-3305 closed out; MIN-864 second freeze → fresh

- **PAN-3392 landed** (#3398 train-merged; handed off). Resurrection now logs its null-state path and falls back to the canonical start door — the MIN-864 wedge class is structurally covered once deployed.
- **PAN-3389 + PAN-3305 closed out** (live build e7911e9c contains both merges; 8-row DoD each, no overrides). Run scoreboard: 5 PAN issues landed+closed (3386, 3389, 3390, 3305, + 3392 at verify), 7 MIN close-outs drained, 6 substrate issues filed (3389, 3390, 3392, 3393, 3396, 3397).
- **MIN-864 froze again** (cost byte-identical $6.9884 across 2 ticks, stuck-nudge unprocessed in pane) — no pending decision → second `pan start --fresh`. WATCH CLASS (3 specimens today incl. MIN-929 pre-fresh): MYN gpt-5.6 work agents go inert with delivered-but-unprocessed nudges. Next occurrence: capture full pane + supervisor log to pin delivery-vs-harness before filing.
- strike-3393 verify long but moving ($14.55, 1h7m). strike-1889 slow-moving ($14.00) — if no readiness by next tick, read its full transcript tail. pan-3362 at "clean tree, running full suite before signaling" — pan done imminent. pan-3367 brewing 39m on audit batch (long-thought watch). min-874 $40.27 +2969 (heavy but proportionate Java test work). min-839 working.
- MIN-929 still awaiting test dispatch (0 test sessions) — governor/slot check next tick if still absent.

## RUN-79 interstitial (~11:25Z) — strike-3393 landing decision: CI arbitrates, not the loaded host

strike-pan-3393 reported: fix committed, typecheck/lint green, but 3 full local suite runs failed on random 5s setupOverdeckTestDb hook timeouts under host load 10-25 (every failed file passes alone); correctly refused to fix-forward the orthogonal infra flake or signal ready. **Owner decision: pushed its branch + opened PR #3400 myself — the PR's CI on GitHub runners is the authoritative gate; local verification is currently unusable under saturation load.** Appended the specimen to PAN-3344 (CPU-blind governor) including the no-headroom 5s hook timeout. Land #3400 on green + pan done --strike.

## RUN-79 interstitial (~11:32Z) — MIN-864 review wedge: DB-lock became durable BLOCKED; fresh cycle dispatched; PAN-3401 filed

Reviewer reported: correctness lane's transient database-lock failure durably signaled blocked on its runId; the lane then completed CLEAN but signal-once forbids in-place correction — 3 passed + 1 clean-but-uncorrectable. Recovery: `pan review abort MIN-864` + `pan review request` (fresh cycle, verification → convoy). Filed **PAN-3401**: verdicts must encode judgment, never infra outcomes — blocked-polarity sibling of PAN-2746, with the signal-once trap documented (same-run supersede for infra-blocked signals). Dispatch strike when a slot frees; fleet currently saturated.
