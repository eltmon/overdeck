# Flywheel State

Durable cumulative memory across Flywheel orchestrator runs. Status snapshots are ephemeral and live in `~/.overdeck/flywheel/`; this file is for facts that future runs should not have to rediscover.

`pan flywheel report` compacts this working copy when it exceeds 1,000 lines or 120 KiB. The curated sections and latest three runs remain verbatim; older run detail becomes one line per run. Compaction never deletes history — the original detail remains available through `git log --follow docs/FLYWHEEL-STATE.md`.

> Historical-path note (PAN-2541): references to `.pan/records/`, `.pan/specs/`,
> and `.pan/drafts/` describe the legacy layout that existed when each event
> occurred; current permanent state lives in `records/`, `specs/`, and `drafts/`
> on `overdeck-state`.

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

## RUN-79 tick 8 (2026-08-01 ~11:40Z) — strike-1889 landed via CI path (#3403); MIN-929 verdict-signal loss found + re-driven

- **strike-1889 diagnosed**: fix committed (`63af28265b`), clean tree — but the agent is poll-looping a silent background task ("Task Output → (No output)" ×6) around the same load-flaked local suite. Same landing decision as 3393: pushed + **PR #3403**, CI arbitrates. (Two strikes in one day burned hours on unusable local verification — PAN-3344 is compounding; consider raising its priority.)
- **MIN-929: review verdict announced but never recorded.** Parent printed "Review passed after cycle-3 convergence gate" + synthesis written ~1.5h ago, yet no test dispatch, no ready flip, health monitor still nudging the idle work agent — the signal step silently failed (synthesis-present variant of REVIEWER_READY-never-landed). `pan review restart MIN-929` resumed the parent (per-lane idempotency re-runs nothing). VERIFY next tick: verdict recorded + test dispatched; if the signal fails twice, file the specimen with pane+transcript evidence.
- #3400 (PAN-3393) test lane pending. PAN-3392 close-out still deploy-gated (live e7911e9c predates its merge).
- Fresh MIN-864 session working ($0.70, new review convoy live since 07:32). pan-3362 $32.93 post-compaction continuing. pan-3367 $68.51 audit (COST WATCH — biggest spender of the run). min-874 $58.32 out 3.4k. min-839 $17.34 +782/−67.

## RUN-79 tick 9 (2026-08-01 ~11:55Z) — PAN-3393 LANDED (stuck-flag machinery fixed); cost + crash-restore watch

- **PAN-3393 landed** (#3400 squash `2a04120c02`, handed off): stuck flags auto-retire, /unstick is merged-aware, `pan unstick` exists (PAN-3321 gap closed). Close-out on CI+deploy. #3403 (PAN-1889) test lane in CI.
- **Crash-restore cluster**: pan-3367, pan-3362, MIN-929's work agent all show "prior process ended unexpectedly" restores this tick. No OOM lines visible; RAM 50.6/64GB (13.5GB avail). Likely the deploy-window restarts; all restored and continuing. Watch for recurrence — if another cluster appears without a deploy, investigate the killer.
- **COST WATCH: pan-3367 at $93.93** (29-issue audit, +2343/−391 docs; crashed+restored at ctx 82%). min-874 $75.68 +3343/−211. Cost limits are warn-only per operator policy — flagging, not stopping. Both producing proportionate output.
- MIN-929 verdict signal still not confirmed post-re-drive (parent idle again; sessions recreated 07:36/07:47). NEXT TICK: hard-verify via durable record; if the signal failed twice, file the synthesis-present signal-loss specimen.
- PAN-3392 close-out deploy-gated. MIN-864 fresh session + convoy progressing slowly ($0.86).

## RUN-79 tick 10 (2026-08-01 ~12:05Z) — operator promoted uat/min-crow-0801 (MIN-929); fresh sweep + close-out driven

- **Operator promoted MIN-929** to MYN main (fe@e8b6f61 api@74aca93 + 4 more repos). Close-out attempted immediately: blocked ONLY on the still-running post-merge lifecycle (mergeStatus merged, agent-min-929 still registered) — no override taken, retry next tick. The tick-8/9 verdict-signal question is moot for merge purposes (operator promoted), but the signal-loss specimen remains real for the machinery.
- Fresh membership sweep re-derived: PAN pipeline = 1889/3392/3393 post_merge (close-outs pending deploy or CI), 3362/3367 in_flight, 3356 held; MYN = MIN-864 (fresh review cycle), 874/839 working, 929 merged-pending-close, 7 recordless zombies (PAN-3396); TIN-1 planned; 4 typed blind spots (papers-please/puzzdom tracker_unconfigured, lexerra/krux forge_unavailable GitHub App 404s).
- **Clean UAT batch = EMPTY** (uat-candidate null; nobody review+test passed post-promote). Nothing assembled — correct, not an omission.

## RUN-79 tick 11 (2026-08-01 ~12:25Z) — 🔴 RED MAIN root-caused (time-bomb test) → PAN-3404 struck; MIN-929 closed out

- **RED MAIN P0**: transcript-retention test failing every run since exactly 12:00Z. Root cause verified to file:line — `transcript-retention.ts:75` captures `now: Date.now` BY REFERENCE at module load, so fake timers never intercept it; the sweep cutoff runs on the REAL clock. Fixtures (fake NOW 07-31T12:00, newEnded mtime 07-30T12:00) agreed with the real clock until real 08-01T12:00Z, then `cutoff = realNow−2d` crossed the fixture mtime → deterministic failure everywhere (local repro confirmed; last green run started 11:47Z). A time bomb from authoring, not a regression — the "breaking range" was docs-only. Filed **PAN-3404** (blocks-main) + struck. Fix: lazy `now: () => Date.now()` + audit the capture pattern repo-wide.
- **MIN-929 closed out** (3rd attempt): post-merge lifecycle never paused the leftover work agent (defect specimen — MYN promote path); `pan pause` with attribution cleared the running-agent DoD blocker, close-out clean, NO --accept overrides.
- PAN-1889/3392/3393 close-outs now ALSO gated on red main — they queue behind PAN-3404.
- **COST: pan-3367 at $113.75** (ctx 87%, +2432/−425). pan-3362 $54.33. Warn-only policy — surfacing, not stopping.
- MIN-864 fresh session slow-progressing ($1.47). Load moderate.

## RUN-79 tick 12 (2026-08-01 ~12:40Z) — PAN-3404 fix in CI (#3405); time bomb poisons ALL open PRs until it lands

- **strike-3404 fix reviewed + pushed by me** (PR #3405): audit found the `now: Date.now` capture pattern in FOUR files (transcript-retention, pipeline-membership service, deacon-auto-merge-reconcile, deacon-stuck-merging) — all now lazy `() => Date.now()`. #3405's own test lane contains the fix so it can go green; **every OTHER open PR's test lane inherits the wall-clock detonation** — #3402 (pan-3362's UAT fixtures PR, in CI now) will fail through no fault of its own and needs a lane re-run post-merge.
- pan-3362 NOT wedged — it submitted PR #3402 and is monitoring. min-874 $132.93 +4161/−327 (huge but moving). pan-3367 $123.90 crash-restored AGAIN (2nd), min-839 also restored — second cluster, no deploy this time, no OOM lines visible in journalctl, RAM fine (17.5GB avail). Killer unidentified; watching (kernel log needs sudo).
- MIN-864 crawling ($1.89). Close-outs for 1889/3392/3393 still queued behind red main.

## RUN-79 tick 13 (2026-08-01 ~12:50Z) — MIN-864 cycle-2 verdict is ANOTHER infra-failure verdict; PAN-3401 struck; #3405 watch armed

- **MIN-864 cycle-2: CHANGES REQUESTED for "correctness reviewer failed — agents database was locked"** — the PAN-3401 class detonating one cycle after filing (3rd DB-lock specimen today). Synthesis also jumped the gun: it declared the verdict while the deacon's per-lane relaunch of correctness was LIVE (restart door refused: "already running"). When the lane reports, the cycle needs re-synthesis — verify next tick. **strike-pan-3401 dispatched** (verdicts must never encode infra outcomes; same-run supersede for infra signals).
- #3405 (red-main fix) test lane in progress — background watch armed, merging on flip. #3402's lane will need a re-run after (wall-clock poisoning).
- min-874 $137.29 +4470/−328 (Java debrief service — huge but continuously producing).

## RUN-79 tick 14 (2026-08-01 ~13:05Z) — PAN-3404 MERGED (650f7ef4d0): time bomb defused, main re-green watch armed

- **PAN-3404 landed** (#3405 squash, test lane green on the fix branch itself) and handed off. Lazy-clock fix covers 4 files. Main CI watch armed on the merge — on green: drain PAN-1889/3392/3393 close-outs + re-run #3402's poisoned test lane + close out PAN-3404 itself once deployed.
- Red-main duration: ~12:00Z detonation → ~13:05Z merge (~65 min from detonation to fix-on-main, root cause to file:line in ~25 min).

## RUN-79 tick 15 (2026-08-01 ~13:15Z) — main GREEN, deployed, ALL close-outs drained; 4/4 implementation-verified; auto-closeout gap named

- Main re-greened (133aa316e9 success), **I deployed via pan reload** (live = 133aa316e9), and **PAN-1889, PAN-3392, PAN-3393, PAN-3404 all closed out** (8-row DoD each, no overrides). Run totals: 9 PAN issues landed+closed today + MIN-929/MIN-908 + 6 zombie drains.
- **Implementation verification (operator-requested), 2 parallel reviewers, all CONFIRMED**: 1889 (threshold in pan flywheel report + verbatim-preservation test), 3404 (4 lazy-clock sites + repo-wide grep clean), 3392 (null-state logs, start fallback through the agents endpoint, needs-you only on double exhaustion, demanded tests present), 3393 (patrol retirement via write door, merged-aware /unstick, pan unstick CLI + skill). Two scoped observations recorded: 1889's summarizer does no lesson-folding (not an AC); 3393's auto-retirement covers feedback_delivery_needs_you+merged only — other stuck reasons still never retire (follow-up candidate).
- **WHY THE OPERATOR HAD TO ASK (named gap): `close_out.auto` is OFF.** The deacon auto-closeout patrol EXISTS (deacon-auto-closeout, config close_out.auto + auto_delay_minutes) and is disabled — no close_out section in config.yaml. With it ON, merge → deploy-patrol → auto-closeout is fully mechanical (DoD gate still enforces every row). Recommended to operator; their call to enable.
- My own gap this run: the re-green watch covered CI but not the deploy row — the drain would have waited for the deploy patrol. Lesson: arm watches on the LAST gate in the chain, not the first.

## RUN-79 tick 16 (2026-08-01 ~13:30Z) — self-correction on #3402 ownership; MIN-864 held for the PAN-3401 fix; operator-reported bug pair struck

- **Correction of my own tick prompt**: PR #3402 (PAN-3362) is normal-pipeline work, NOT a strike merge I own — the agent is still working ($86.96, pushing); review/test/UAT gate its merge. "Merge on green" applies only to strikes I spawned.
- **MIN-864 decision**: correctness re-run produced its report (3,975B, 09:18) but the run is durably blocked (signal-once) — re-synthesis needs a fresh cycle, and cycles 1+2 were BOTH poisoned by DB-lock infra verdicts (PAN-3401 class, 2/2). Holding the final cycle until strike-pan-3401 lands+deploys (its fix: write retry + no infra verdicts + same-run supersede), then one clean abort+request. Avoids burning a third 4-reviewer convoy on a coin-flip.
- Operator surfaced 2 more dashboard bugs from the PAN-3367 cockpit (tick 15.5): **PAN-3407** (Terminal toggle silent no-op while tmux session verifiably alive) + **PAN-3408** (phantom "waiting for your answer" banner on an actively-working agent; pan answer empty) — both filed with specimens, both struck. Stale reviewer residue on 3367 cleared via abort door.
- **PAN-3406 (order-book issue titles) filed + started** per operator (planning underway, $1.46).
- Fleet: strike-3401 $11.44 +185/−81 · strikes 3407/3408 spawning · min-874 $161.49 +5483 (biggest producer) · min-839 $38.96 · pan-3367 rework mid-compaction · PAN-3362 active. Main green. #3402 green awaiting pipeline review.

## RUN-79 tick 17 (2026-08-01 ~13:47Z) — PAN-3362 through verification; PAN-3401 in CI (#3409)

- **PAN-3362 verification PASSED** (worker result clean) — pipeline dispatching its review convoy; merge stays UAT-gated. The PAN-3356 unblock chain is one review+UAT away.
- **strike-3401 landed via CI path** (PR #3409; local gates load-flaked again — 3rd strike today). Fix: `keep infra contention out of verdicts` — retry+durable-queue on lock failure, same-run supersede after infra-blocked. On merge+deploy: run MIN-864's final clean cycle.
- strike-3407 building a cockpit test (+137/−3); strike-3408 investigating ($3.38); PAN-3406 planning; pan-3367 rework continuing ($157.68); min-874 $173.06 +6410 (1h17m single task — check its bead progress next tick if diff stalls); min-839 $48.81 +2586.
- Main green. Fleet 15.

## RUN-79 tick 18 (2026-08-01 ~14:05Z) — PAN-3401 LANDED + DEPLOYED; MIN-864 clean cycle dispatched under the new guard

- **PAN-3401 landed** (#3409 squash `cfb969ba3e`, handed off) **and deployed** (live build = the merge itself). Infra contention can no longer become a reviewer verdict: lock failures retry + queue durably; same-run supersede after infra-blocked signals.
- **MIN-864 final review cycle dispatched** (abort found 0 stale sessions; request accepted, verification → convoy). Cycles 1-2 were both lock-poisoned; this one runs with the guard live. If THIS cycle produces a clean organic verdict, MIN-864 finally exits its 8-day limbo.
- PAN-3406 planning finalized → work agent auto-started (09:32). Strikes 3407 ($7.64 +143/−15) / 3408 ($6.05) progressing. min-874 $186.67 +6809 still producing. Close-out for PAN-3401 pending main CI on the merge.

## RUN-79 interstitial (~14:20Z) — strike-3408 landed via CI path (#3414); declined the quiet-window serialization ask

strike-3408 reported the load-flake pattern (34 unrelated setup timeouts, load ~30 from overlapping Vitest runs) and asked me to hold other full suites while it waits for a quiet window. Declined the serialization — standing decision: CI arbitrates, local verification is not a gate under saturation (4th strike today). Pushed its committed fix (`738b007393` retire stale input fallback on activity) + opened PR #3414. The suite-contention root cause remains PAN-3344's to fix mechanically, not mine to schedule around.

## RUN-79 tick 19 (2026-08-01 ~14:25Z) — steady state; MIN-864 clean cycle 2/4 reports, no poisoning

- MIN-864 run a04d2574: performance + security reports written, correctness/requirements running — first cycle under the PAN-3401 guard, no infra verdicts so far. #3414 (banner fix) mid-CI. Main CI in_progress (PAN-3401 close-out retries on green).
- strike-3407 $9.90 ctx 79% (compaction watch) · PAN-3406 working $6.78 · min-874 $202.50 +7976/−428 (diff still growing = real work) · 28 sessions total (convoys included; my dispatched set well under the 20 cap).

## RUN-79 interstitial (~14:35Z) — strike-3407 landed via CI path (#3415); 5th load-flake casualty

strike-3407 (cockpit terminal reveal + size-ratchet compliance) committed, gates green except the load-flaked full suite (9 failures default / 4 with CI workers, all pass in isolation) — pushed + PR #3415 per standing decision. #3414 test lane still running. PAN-3344 tax count today: 5 strikes.

## RUN-79 tick 20 (2026-08-01 ~14:40Z) — PAN-3408 landed; PAN-3401 closed out; MIN-864 organic APPROVED (limbo exit)

- **PAN-3408 landed** (#3414 squash `b384f431ea`, handed off) — phantom waiting-banner retires on demonstrated activity. **PAN-3401 closed out** (14th landed+closed this run).
- **MIN-864: organic APPROVED** on the first cycle under the PAN-3401 guard (verdict commit-anchored fe@e1669c15 api@b6455904) — 8-day limbo exit; test phase next, merge operator-gated (MYN hold; check CURRENT UAT policy at merge time). Operator confirmed the yield display confusion was just after-state (reviewers finished in ~10 min and exited).
- Operator flagged a possible real-subscription UAT attempt: verified FALSE — agent-min-874 is testing the BYO-AI card's "connect not available yet" unavailable-state with a test token, not a live OAuth. Nothing to stop.
- **Watch item fired**: PAN-2583 fallback line reappeared on PAN-3408's pan done (journal write lock contention CLI-vs-server). Cross-process fallback is the designed rescue (PAN-2952 covered same-process); operations completed on retry. Recording occurrences — file only if it becomes chronic or the sweep misses a verdict.
- #3415 (terminal fix) mid-CI. PAN-3362 in test phase (agent-pan-3362-test spawned 10:31). PAN-3367 test session spawned 10:15.

## RUN-79 interstitial (~14:45Z) — operator couldn't see MIN-839/864 reviews; tree crew gap filed+struck (PAN-3416)

Operator screenshot: MYN tree shows no Review crew rows while agent-min-839-review + performance lane are LIVE (3/4 reports written) and MIN-864's review completed APPROVED. Third review-invisibility specimen today (3407 terminal, 3408 banner, now crew rows) — filed **PAN-3416** + struck. Also in-frame: MIN-852/861 "Planning" badges despite this morning's close-outs (PAN-3396 residue family, cross-referenced). MIN-839 work agent yield-paused 21m is designed behavior (self-resumes on slot).

## RUN-79 interstitial (~14:50Z) — strike-3408 was grinding moot gates post-merge; paused; merged-awareness gap filed (PAN-3417)

strike-3408 messaged for a gate exception 45 min AFTER I merged its fix (#3414) — no merged-awareness in the strike loop. Paused with attribution (burn stopped). Its measurement was valuable: fixture beforeEach ~4.4s under load vs fixed 5s hook timeout → appended to PAN-3344 (now 6 affected gate runs today). Filed **PAN-3417** (strike agents keep verifying after their branch lands; 3 specimens: 3389/3390 pan-monitor-blind ~1h each, 3408 gate-looping) — the tick-4 watch item now has enough evidence. Not struck yet — fleet at capacity with PAN-3416; queue behind current strikes.

## RUN-79 tick 21 (2026-08-01 ~14:55Z) — operator promoted uat/pan-sable-0801 (PAN-3406); closed out same hour as filing

- **PAN-3406 promoted + closed out** (leftover-agent pause + deploy `6e3cda7a` + clean 8-row DoD): operator request → filed → planned → built → UAT-promoted → closed in ~95 minutes. Second promote today with the lifecycle leaving the work agent running (MIN-929 pattern — the postMergeLifecycle agent-pause gap now has 2 specimens; file next occurrence).
- Deploy also brings #3414 (banner) live. PAN-3408 close-out waits on main CI green past its merge. Clean UAT batch EMPTY (candidate null — correct). New backlog appeared: MIN-930/MIN-931 planned, PAN-3413 (not mine — investigate provenance next tick). **MIN-874 bucket dropped to planned_backlog despite its +8k branch — verify next tick.**

## RUN-79 tick 21 (2026-08-01 ~14:55Z) — operator promoted uat/pan-sable-0801 (PAN-3406); closed out same hour as filing

- **PAN-3406 promoted + closed out** (leftover-agent pause + deploy `6e3cda7a` + clean 8-row DoD): operator request → filed → planned → built → UAT-promoted → closed in ~95 minutes. Second promote today with the lifecycle leaving the work agent running (MIN-929 pattern — the postMergeLifecycle agent-pause gap now has 2 specimens; file next occurrence).
- Deploy also brings #3414 (banner) live. PAN-3408 close-out waits on main CI green past its merge. Clean UAT batch EMPTY (candidate null — correct). New backlog appeared: MIN-930/MIN-931 planned, PAN-3413 (not mine — investigate provenance next tick). **MIN-874 bucket dropped to planned_backlog despite its +8k branch — verify next tick.**

## RUN-79 interstitial (~15:05Z) — strike-3420 scope-abort accepted; PAN-3420 rerouted to planning

Operator-filed **PAN-3420** (closed-out issues render as never-started — post-close-out history wipe, observed on MIN-929 minutes after its close-out). The strike ABORTED WITHOUT EDITS, correctly: it verified SIX independent live-only read paths (nulled journal, wrong-source drawer badges, snapshot-agents conversations, cleared review_status history, transient activity arrays, removed cv.json) — this is the two-door tenet applied to issue history, needing a unified durable issue-history resolver + no-loss regression, not a precision fix. Findings preserved as an issue comment (PRD input); `pan plan PAN-3420 --auto` dispatched. NOTE the meta-point: today's close-out sprint (16 issues) made this class VISIBLE — every close-out wipes the operator-facing history of the work just completed. High operator-value plan.

## RUN-79 tick 22 (2026-08-01 ~15:15Z) — PAN-3407 landed; MIN-874 wedge #4 → composer-submit class FILED (PAN-3422); strike-3413 via CI (#3421)

- **PAN-3407 landed** (#3415 squash `318f63d663`, handed off — the journal fallback line fired again mid-handoff, 3rd today; retry confirmed). Close-out on CI+deploy.
- **MIN-874 was the 4th composer-wedge specimen** (post-compaction resume nudge visibly unsubmitted, 2.5h idle at $242; sub-branches all pushed so nothing lost) → `--fresh` (new session working, $0.28). **Filed PAN-3422** with the testable mechanism: paneHasBlockingChoiceMenu() false-positives would produce paste-without-Enter systematically — 4/4 specimens match. Its bucket anomaly (planned_backlog) likely reflects the pushed-branch/no-unique-vs-main resolver view — recheck after agent progresses.
- **strike-3413** (operator-filed, record-reconcile orphaned-drafts fix): same load-flake gate story (6th) → pushed + **PR #3421**, CI arbitrates.
- PAN-3420 planning underway (unified issue-history resolver). PAN-3408 close-out still waiting on a green main run containing its merge (CI was in_progress).

## RUN-79 tick 23 (2026-08-01 ~15:35Z) — PAN-3413 landed; strike-3422 dispatched; MIN-839 in organic rework

- **PAN-3413 landed** (#3421 squash `dea43f848b`, handed off) — record reconcile adopts canonical writes. 17th landed issue this run.
- **strike-pan-3422 dispatched** (composer-submit wedge class — the run's costliest recurring operational failure, ~4h agent time + \$300 today).
- **MIN-839 review: organic CHANGES REQUESTED** ("reconciliation fails on detached lazy associations before scanning cards") — real code finding, pipeline working as designed; rework beginning. WATCH: its agent showed ctx 0/out 0 post-feedback — if no delta next tick, that's composer-wedge specimen #5 (--fresh + append to PAN-3422).
- strike-3416 ctx 88% compaction watch. MIN-874 fresh session producing. 3 test phases live (3362/3367/864). Main CI backlog (2 runs in progress) — 3408/3407 close-outs queued behind.

## RUN-79 tick 24 (2026-08-01 ~15:50Z) — 3 more closed out (20 total); memory watch armed per operator

- **PAN-3408, PAN-3407, PAN-3413 all closed out** (deploy `85b623885d` + green CI; 8-row DoD each). **Run totals: 20 issues landed+closed** (12 PAN strikes/fixes + PAN-3406 + MIN-929/908 + 6 zombie drains, minus overlaps: see close-out records).
- **Operator flagged memory pressure**: verified 53.2/64GB used, 10.9GB avail, PSI low (no stalling). Suspects cleared: "gen-a server" IS the live reload (generation alternation), the pan-1577 tsc was a transient 37s gate. Real load = 4 MYN Java stacks + container vite (legitimate). **Persistent memory Monitor armed** (alerts at <6GB avail or PSI full avg60 >5); close-out drain frees stacks.
- MIN-839 genuinely reworking ($19.33 delta — NOT specimen 5). strike-3422 editing pty-supervisor.ts (right area). strike-3416 post-compaction $14.54 — readiness check next tick. MIN-874 fresh producing.

## RUN-79 interstitial (~16:05Z) — memory watch fired (5.9GB); assessed, no shed taken, dispatch freeze on

Monitor fired at 5.9GB avail (PSI 0.58, no stalling; bounced to ~7GB). Growth = restic backup (transient) + recurring pan-1577 tsc churn (2nd specimen, 1.9GB — file the gate-churn class if it recurs again) + MIN-922 stack. **MIN-922 checked before shedding: LIVE healthy agent (5 min activity) — entered pipeline after my sweep; NOT shed-eligible.** All load legitimate → no kills, no stack teardowns. Mitigation: dispatch freeze on new strikes (3417/3397/3396 queued) until pressure eases; governor + close-out teardowns are the mechanism; Monitor stays armed (<6GB / PSI>5).

## RUN-79 interstitial (~16:10Z) — memory emergency handled: server restart at 2.7GB/8MBps; verdict = allocation churn, not proven leak

Escalation chain: Monitor 5.9GB → 3.5GB avail with PSI 12.77 (real stalling). Growth driver = dashboard server 1.9→2.7GB at ~8MB/s on build `85b623885d`. **Restarted the server** (pan restart, healthy, ~60s outage). Fresh process: 743→1914MB then GC DROPPED it to 1318MB — heavy allocation churn with high watermark, NOT proven monotonic leak (old process killed before it could plateau). Two Monitors now armed: system memory (<6GB/PSI>5) + server RSS (>3GB + :3011 liveness). Dispatch freeze holds until stable. If server RSS alerts >3GB again → treat as real leak, bisect today's merges (#3414 activity-derivation, #3421 reconcile-adoption prime suspects). Other pressure: restic (transient), host-side mvn build (transient), pan-1577 tsc churn (2 specimens — file on 3rd).

## RUN-79 tick 25 (2026-08-01 ~16:25Z) — strike-3416 via CI (#3425); verification green on 3362/3367/864; memory stable

- **strike-3416 landed via CI path** (PR #3425 — shared specialist session tree builder; 7th load-flake preemption). strike-3422 root cause confirmed, implementing (+249/−47 in pty-supervisor area).
- Verification gates green on PAN-3362/PAN-3367/MIN-864; review/test specialist verdicts still converging server-side — ready set empty, UAT candidate null (correct, not a wedge). MIN-839 rework crunching ($19.95, slow delta — recheck). MIN-874 hardening OAuth state (50m task, $18.40 fresh session).
- Memory stable post-restart (no Monitor events ~15 min): server churns to ~1.9GB then GC reclaims. Dispatch freeze still on for NEW strikes (3417/3397/3396 queued) until an hour of stability.

## RUN-79 tick 26 (2026-08-01 ~16:30Z) — HERMES CAMPAIGN ADOPTED: order book folded in, both lane heads live

- **Operator campaign handoff**: order book `2026-08-01-myn-hermes-smoke-test-remediation` (5 issues from today's Hermes smoke test), status=ready, laneAConcurrency=1. Book membership = release per pickup-gate doctrine. PRDs FINAL on drafts/ — no re-derivation.
- **Lane A (myn api, serial): agent-min-930 STARTED** — P0 token leak, highest urgency across ALL projects (overrode the memory dispatch freeze on emergency class); then MIN-932 → MIN-933 (932 first, shared project-DTO design). **Lane B (hermes repo, serial): agent-min-931 STARTED** (27 items, WI-1/WI-2 first); then MIN-934 (hard dep on 931's guarded_write, same files).
- Completion condition: all five terminal → `pan orders show` from the myn root + mark book complete. Campaign rules live in the myn project's flywheel-brief.
- Non-campaign fleet unchanged: #3425 in CI, strike-3422 implementing, 3362/3367/864 verdicts converging, MIN-839 reworking. Memory stable (~35 min quiet). Freeze stays for non-campaign strikes (3417/3397/3396).

## RUN-79 tick 27 (2026-08-01 ~16:45Z) — campaign heads verified advancing; PAN-3416 landed

- **Both Hermes heads producing**: MIN-930 (P0 token leak) +49/−39 first commits; MIN-931 +503/−18 (WI-1/2). Serial tails queue mechanically.
- **PAN-3416 landed** (#3425 squash `706492b6e8`, handed off) — issue-tree crew now shows live review/test sessions. Close-out on CI+deploy. strike-3422 committed + rebased, in gates (~ready next tick).
- Ready set still empty (3362/3367/864 verdicts converging). Memory: watch retuned (<4GB or PSI>5) after a benign 5.9GB/PSI-0.12 fire from campaign stack spin-up; freeze-lift decision deferred while campaign warms up.

## RUN-79 interstitial (~17:00Z) — SECOND memory emergency: PSI 41.9, governor shed never fired → manual [governor-slot] pause; PAN-3429 filed

Pressure climbed to 2.2GB avail / PSI full 41.9 (severe stalling): THREE concurrent heavy toolchain runs (2 host Java builds from campaign gates + strike-3422's full vitest). **The governor only deferred admissions — no shed rung covers running gate/build processes, and nothing escalates when deferral proves insufficient.** Manual action: `pan pause PAN-3422 --reason "[governor-slot] ..."` → +2.4GB freed, PSI avg10 → ~1 instantly. Filed **PAN-3429** (shed rung for gate-holding agents, one admission door for heavy toolchains with memory+CPU checks, escalation on sustained PSI — the memory twin of PAN-3344). UNPAUSE strike-3422 once campaign builds finish (its branch has commit 57ede5b334; gates just re-run). Campaign P0 (MIN-930) untouched throughout. Operator notified inline.

## RUN-79 tick 28 (2026-08-01 ~17:15Z) — memory recovered; strike-3422 landed via CI (#3430) with corrected root cause

- Memory recovered (8.4GB avail; campaign host builds finished). Campaign: MIN-930 $1.71 +533/−40 (P0 advancing), MIN-931 $3.18 +575/−51. MIN-839 rework respawned + progressing (+161).
- **strike-3422 → PR #3430** (paused agent's committed fix pushed directly — no local re-grind). CORRECTED root cause: the PTY supervisor path didn't VERIFY Enter submission (commits: verify supervisor Enter submission + confirmation-budget test) — not the tmux menu detector I hypothesized. The composer-wedge class gets its structural fix once landed+deployed.
- Main CI in progress (PAN-3416 close-out queued). PAN-3420 planned, awaiting operator release.

## RUN-79 interstitial (~17:30Z) — THIRD memory crisis: server leak CONFIRMED (2nd balloon) → restart #2 + PAN-3431 struck

PSI avg10 hit 94 (thrashing) at 1.9GB avail: server ballooned AGAIN (743MB→2.4GB on the same 85b623885d build) + two concurrent campaign Java builds. Restart #2 freed to 14GB (a build finished simultaneously). **Two balloons in 75 min = real leak under sustained load, not churn — diagnosis upgraded.** Filed **PAN-3431** (heap-profile bisect directive; suspects #3414 activity-polling banner / #3421 reconcile / #3400 patrol retirement; NOT #3425/#3430 which postdate the build) + struck. Until fixed: server RSS Monitor (>3GB) is the tripwire; expect ~hourly restarts under fleet load. NOTE for next deploy: it will include #3425+#3430 — attribution of any new balloon must account for the changed surface.

## RUN-79 tick 29 (2026-08-01 ~17:15Z) — PAN-3422 LANDED (composer-wedge class fixed); yield storm found + filed (PAN-3432)

- **PAN-3422 landed** (#3430 squash `1d30a2a2bc`, handed off) — PTY supervisor now verifies Enter submission; the 4-specimen composer-wedge class gets its structural fix at next deploy. strike-3422's governor pause is moot (work shipped).
- **Pause audit (10 gates): yield STORM discovered** — 7 work agents simultaneously yielded for ONE review (MIN-874's convoy, live since 16:47Z). Scheduler re-fires yields per patrol without counting existing ones for the same beneficiary. Filed **PAN-3432**. Remaining pauses: 2 lex slots (operator POC), strike-3422 (moot).
- Main CI in progress (3416 + now 3422 close-outs queue on it + next deploy). Campaign heads advancing. Memory stable (18.8GB).
- Freeze-lift decision: HOLDING new strikes (3417/3397/3396/3431 is dispatched) — 7 yielded agents will flood back on resume; adding dispatches now would re-trigger contention. Reassess after the yield backlog drains.

## RUN-79 tick 30 (2026-08-01 ~17:30Z) — PAN-3416 + PAN-3422 closed out (24 landed+closed); both operator-pain fixes LIVE

- **Deployed `87bba552dc`** → PAN-3416 (crew rows show live reviews) + PAN-3422 (supervisor verifies Enter submission — composer-wedge class ends) both LIVE and closed out with clean DoD.
- **MIN-874 review: organic CHANGES REQUESTED** with substantive scope findings (OAuth/fallback/streaming/credential-safety/lifecycle/rollout incomplete) — rework drives server-side; its 7 yield victims free up as the convoy releases slots (PAN-3432 tracks the fan-out defect).
- Campaign heads advancing post-memory-events (MIN-930 $4.46, MIN-931 $4.31 — modest but moving; trend-check next tick). strike-3431 (server leak) implementing (+175/−13).
- Run scoreboard: **24 issues landed and closed out**, 19 substrate issues filed (14 fixed+landed same-day), 3 memory crises handled, 2 UAT promotes processed, 1 campaign adopted (5 issues, 2 in flight).

## RUN-79 tick 31 (2026-08-01 ~17:50Z) — steady state; campaign heads strong

- MIN-930 $6.06 +814/−50 (P0 tracking well) · MIN-931 $6.28 +714/−185. strike-3431 profiling ($14.58). MIN-839 session ended (rework done → server-side redispatch expected). No merge-ready set yet. Memory healthy. Yield backlog: 9 gates (down 1).

## RUN-79 tick 32 (2026-08-01 ~18:10Z) — leak root-caused (unbounded conversation watchers) → PR #3434; MIN-931 in verification-feedback cycle

- **strike-3431 root cause: unbounded conversation watcher accumulation** (`20fa53c952 fix(dashboard): bound conversation watcher memory`) → **PR #3434** (8th CI-arbitrated landing). Matches the load-dependence observation: current calmer fleet shows NO leak curve (523MB at 38min, DOWN from 752).
- MIN-930 $7.30 +907/−100 (P0 strong). **MIN-931: verification FAILED post-handoff, feedback delivered** — its composer shows the feedback text; with PAN-3422's submission-verification LIVE, this is the first real-world test of the fix. If the text sits unsubmitted next tick → regression signal on 3422.
- Server RSS healthy. No merge-ready set. Yield backlog 9 (stable — MIN-874's convoy still holds slots pending rework redispatch).

## RUN-79 tick 33 (2026-08-01 ~18:25Z) — PAN-3422 fix PASSED first live test; campaign healthy

- **MIN-931's verification feedback submitted and processed** — the first real-world exercise of the supervisor Enter-verification fix: no wedge, agent reworking ($9.77, +1301/−201). The 4-specimen composer class appears structurally dead.
- MIN-930 P0 advancing ($8.14, +912/−104). #3434 (leak fix) test lane in CI. Fleet 29 agents, memory healthy.

## RUN-79 tick 34 (2026-08-01 ~18:45Z) — PAN-3431 leak fix LANDED + DEPLOYED

- **PAN-3431 landed** (#3434 squash `e5c9897ffd`, handed off) **and deployed** — conversation watchers bounded; the balloon class that forced two emergency restarts is structurally closed pending soak validation. Close-out next tick on merge-commit CI.
- Campaign: MIN-931 $11.26 +1591/−205 (rework productive); MIN-930 $9.10, diff static at +912 (plateau watch — one more tick before intervening; it may be running gates).

## RUN-79 tick 35 (2026-08-01 ~19:05Z) — PAN-3431 closed out (25 total); partial freeze-lift (strike-3417 dispatched)

- **PAN-3431 closed out** — leak fix live and soaking clean (644MB at 19min under 30-agent load). Campaign heads active (930 cooking, 931 $12.49). No ready set.
- **Partial freeze-lift**: dispatched strike-3417 (strike merged-awareness — stops the moot-burn waste class). Holding 3397/3396 until campaign heads land — admission-gap fixes (PAN-3344/3429) still pending, 30 agents live.

## RUN-79 tick 36 (2026-08-01 ~20:05Z) — RESUMED after operator pause; P0 PAN-3436 unblocked; campaign Lane A advanced

Session resumed (monitors re-armed as one combined memory+RSS+liveness watch). **Config change noted: `require_uat_before_merge` is now FALSE** — merges are schedulable this run, no longer UAT-gated. Ready set currently empty, so nothing to schedule yet.

- **While paused, a reboot incident produced P0 PAN-3436**: supervisor watchdog serially SIGTERMed every dashboard as "foreign" while its own replacement spawn failed the non-primary-checkout guard — dashboard unable to stay up until the supervisor was stopped. Its strike had the fix committed (`ba020bf2ff survive stale deployment cwd`) but **stalled**: git guard blocks rebase, `pan sync-main` rejects strike workspaces as unregistered. Correct refusal by the agent. **I pushed + opened PR #3438** (a mergeable branch needs no rebase) and filed **PAN-3440** for the missing sanctioned strike-sync path (merge-based sync is permitted but undocumented folklore).
- **MIN-930 (campaign P0 token leak) COMPLETED and handed off** while paused. Lane A advanced serially: **MIN-932 started** (auto-planning → work). MIN-931 continues Lane B ($1.39 fresh session post-rework).
- Server RSS 1936MB at 18min under 31 sessions — higher than the 644MB post-fix reading; combined monitor will trip at 3GB. Watch for leak-fix regression vs. legitimate load.
- New non-campaign issues appeared while paused (PAN-3419/3423/3436, MIN-923/924) — triage next tick.

## RUN-79 tick 37 (2026-08-01 ~20:20Z) — 🏁 CAMPAIGN P0 SHIPPED: MIN-930 promoted + closed out

- **Operator promoted uat/min-crow-0801** (7 repos incl. hermes-plugin) carrying **MIN-930 — the Hermes campaign's P0 token leak, the highest-urgency item across all projects** — plus MIN-922. **Both closed out clean** (no leftover-agent block this time: MIN-930 had already handed off, MIN-922 likewise — the postMergeLifecycle pause gap did NOT recur, 2 promotes without it).
- Campaign status: Lane A = MIN-930 ✅ shipped → MIN-932 planning → MIN-933 queued. Lane B = MIN-931 reworking → MIN-934 queued (hard dep). **1 of 5 campaign issues terminal.**
- Full read-door sweep re-derived: 13 PAN + 22 MIN + TIN-1 in pipeline; 4 typed blind spots unchanged (papers-please/puzzdom tracker_unconfigured, lexerra/krux forge_unavailable). Clean UAT batch EMPTY (candidate null) — correct.
- NOTE: scratchpad was cleared by the session restart; status snapshot rebuilt from live state (FLYWHEEL-STATE.md was the recovery source — the durable-memory design working as intended).
- P0 PAN-3436 PR #3438 in CI. UAT gate now OFF → eligible merges get scheduled as the ready set fills.

## RUN-79 tick 38 (2026-08-01 ~20:40Z) — P0 PAN-3436 LANDED; leak fix INCOMPLETE (reopened + re-struck)

- **P0 PAN-3436 landed** (#3438 squash `9847ceb60e`, handed off) — supervisor no longer serially evicts dashboards after a reboot. Deploy + close-out next tick.
- **LEAK NOT CLOSED — self-correction.** My tick-35 "soaking clean (644MB at 19min)" was a LOW-LOAD window, not proof. Current build post-fix: 1936MB@18min → **2591MB@47min = ~22MB/min sustained**. A second growth path survives the watcher bound. Reopened PAN-3431 with the three-point curve + heap-diff directive (15min vs 45min snapshots under load), suspects: #3414 per-agent activity polling, event-store arrays, #3400 patrol structures. **Re-struck.** LESSON (repeat of the reviewer-cost lesson): a single favorable reading under different load is not verification — require a TREND at comparable load.
- MIN-931 review convoy live (4 lanes spawned 16:36). MIN-932 planning deep ($5.83, +833). Campaign healthy.

## RUN-79 interstitial (~20:50Z) — pre-emptive reload at 3.4GB; P0 deployed; leak curve characterized

Monitor tripped at 3383MB/52min (predicted). System had 32GB headroom so no crisis — used the moment for a **`pan reload`, which BOTH deployed the merged P0 (PAN-3436) and reset the server** (fresh: 391MB). Four-point curve appended to PAN-3431: 391MB@0 → 1936@18min → 2591@47min → 3383@52min ≈ 3GB/hour under fleet load, **non-linear — half the growth lands in the first 18 minutes**, pointing at per-agent/per-session accumulation at attach/discovery time rather than a steady drip; told the strike to snapshot at 2min vs 18min. Operational baseline until fixed: reload ~hourly.

## RUN-79 interstitial (~20:55Z) — PAN-3338 convoy dead-end root-caused (PAN-3446) + unblocked

Agent reported discovery-ready failing to launch reviewers. Verified on disk: parent `state.json` has `reviewRunId: null` (status `starting`) while the run dir `.pan/review/agent-pan-3338-review-6130a234/` EXISTS. **Two defects: (1) reviewRunId never durably persisted at discovery-ready — plausibly erased by one of today's restarts; (2) dispatch (`project-routes.ts:665`) 409s instead of deriving the run id from the artifact sitting in the workspace.** Filed **PAN-3446** with both, + the derivation-with-repair fix and its ambiguity guard; **struck**. PAN-3338 unblocked via abort + request (fresh verification → convoy). The agent correctly refused to mutate state — right call, that's how the defect stayed diagnosable.

## RUN-79 tick 39 (2026-08-01 ~21:00Z) — P0 PAN-3436 CLOSED OUT (26 total); campaign Lane A item 2 in work

- **P0 PAN-3436 closed out** (deployed in the 20:45 reload; 8-row DoD, no overrides). 26 issues landed+closed this run.
- Campaign: **MIN-932 work agent live** ($6.36, +622/−64 — planning→work chained cleanly), MIN-931 reworking an organic review finding (`dryRun returns a successful empty preview even though preview is unsupported` — genuine correctness catch, the convoy is earning its keep).
- Leak strike round 2 investigating (+41/−92 — already reverting/adjusting the prior approach). PAN-3446 strike warming. Server 1102MB@10min post-reload — consistent with the ~3GB/hr curve; next pre-emptive reload when the monitor trips.
- Ready set still empty; nothing schedulable despite the UAT gate being off.

## RUN-79 tick 40 (2026-08-01 ~21:20Z) — state push unblocked; composer-wedge specimen #5 WITH THE FIX LIVE → PAN-3422 reopened

- State push resolved: the other session pushed, my tick-39 record rode along (no bypass taken — PAN-3062 specimen stands).
- **PAN-3422 REOPENED — specimen #5 on the fixed build.** MIN-931 wedged with TWO unsubmitted feedback pointers, cost byte-identical across two ticks, no pending decision. **New distinguishing detail: context at 92%** — the compaction boundary is the lead. Hypothesis appended: the supervisor verifies the Enter keystroke was accepted, but a turn started near compaction can discard it; verification must confirm an ACTIVITY DELTA (turn actually started), not just keystroke acceptance, and re-deliver once if absent. 5th manual `--fresh` of this class today.
- **Self-correction:** at tick 33 I called this class "structurally dead" after ONE successful delivery on MIN-931. Same error shape as the leak: a single favorable observation is not verification. (Twice today. The rule I keep re-learning: confirm with a trend or an adverse-condition test — here, delivery at high context — before declaring a class closed.)
- Leak strike round 2 ($4.84) and PAN-3446 strike ($5.65, +279) both progressing. MIN-932 deep in work ($13.83, +1189). Server 1032MB@29min — notably flatter than the earlier 1936MB@18min curve; leak may be load-dependent (fleet is lighter now). Keep measuring at comparable load before concluding anything.

## RUN-79 interstitial (~21:35Z) — 🔴 RED MAIN P0 (PAN-3448) reported by a strike; struck immediately

strike-3446 refused to signal ready and reported main's suite RED for an orthogonal reason — CORRECT call, and it caught something I had missed. Verified: `render.test.ts:124,147` ship literal `bd ready` fixtures that `beads-removal-no-loss.test.ts` forbids; CI red on 8519e39408 + 1dc4b9494e. Source: `51fb0d1370` — **the very commit that blocked my tick-39 push** (PAN-3062 specimen), whose stated purpose was stripping bd boilerplate while its fixtures embed the forbidden strings. Filed **PAN-3448** (blocks-main) + struck; fix direction = build fixture text without literal matches, never weaken the guard. strike-3446's own fix pushed as **PR #3447**, merges when main is green.
LESSON: a strike's "I won't fix-forward" report is a P0 SENSOR — it found red main before my own tick sweep did.

## RUN-79 tick 41 (2026-08-01 ~21:50Z) — red-main strike on target; MIN-931 wedge recovery CONFIRMED; PAN-3422 re-struck

- strike-3448 "Fixing forbidden fixture literals" — exactly the prescribed fix (build fixture text without literal matches, guard untouched). Main CI queued on a newer head; watch for green.
- **MIN-931 fresh session verified working** ($2.97/+46−79 frozen → $5.23/+448−143). Wedge recovery real, not cosmetic.
- **PAN-3422 re-struck** with the compaction-boundary lead (verify activity delta, not just keystroke acceptance; re-deliver once if the turn never starts). This class has cost 5 manual interventions today — highest-frequency operational failure of the run.
- MIN-932 deep in Lane A work ($18.10, +1535/−157). Leak strike round 2 still at +42/−92 (small diff, high thought — heap analysis).

## RUN-79 tick 42 (2026-08-01 ~21:55Z) — red-main fix pushed (#3452), watch armed

- strike-3448's fix committed (`695dbbf5b2 avoid forbidden bd-ready fixture literal`; forbidden literal count in its workspace: 0) → pushed + **PR #3452**. Its local gate run failed on the usual load flake — irrelevant, red main outranks it and CI is the gate. Background watch armed on the test lane; merging on green, then verifying main re-greens and landing #3449 (PAN-3446) behind it.
- Fleet 32 sessions (convoys + campaign + 4 strikes). Campaign untouched by the red-main event — MIN-932 still working Lane A.

## RUN-79 tick 43 (2026-08-01 ~21:58Z) — PAN-3367 promoted; close-out deploy-gated (gate respected, no --force)

- **Operator promoted uat/pan-sable-0801 carrying PAN-3367** (the 29-issue code-level audit — the run's costliest item at ~$236). Close-out blocked at the deploy row: live build predates the merge. Tried a reload; **the deploy gate refused with an explicit reason — "post-merge lifecycle is pending", queued 21:54:57Z, fires automatically; do not retry or --force."** Respected it; close-out retries next tick. (This is PAN-3383's observability fix EARNING ITS KEEP: the gate stated its blocking reason instead of failing silently — exactly what that issue added.)
- Full read-door sweep re-derived: 17 PAN + 20 MIN + TIN-1 in pipeline. **Read-door robustness note:** papers-please and lexerra returned EMPTY on the first pass (curl/jq under load) and only yielded their typed `unavailable` objects on retry — an empty response is NOT a bare array and must never be read as "no pipeline"; retried both rather than assuming.
- Clean UAT batch EMPTY (candidate null) — nothing review+test passed. Red main (PAN-3448) still active; #3452 watch running.

## RUN-79 tick 44 (2026-08-01 ~22:10Z) — 🟢 RED MAIN FIX MERGED (#3452 → 286847320e)

- **PAN-3448 landed** and handed off — forbidden `bd ready` fixture literals removed, beads-removal guard untouched. Main re-green watch armed on the merge commit. Red-main duration: reported by strike-3446 at ~21:30Z → fixed and merged ~22:08Z (~38 min, and the report came from an agent refusing to fix-forward — the sensor pattern again).
- #3449 (PAN-3446 reviewRunId recovery) test lane running; merges on green now that main's blocker is gone.

## RUN-79 tick 45 (2026-08-01 ~22:20Z) — PAN-3367 CLOSED OUT (27 total); operator deploy request satisfied by the same reload

- **PAN-3367 closed out** — the deploy gate cleared itself exactly as it announced (no --force, no override). 27 issues landed+closed this run.
- **Operator asked for a deploy of the file-path-chips fix (0dea908ff0) mid-tick; already satisfied** — my reload had built `27703fb4d7`, verified via `git merge-base --is-ancestor` to contain it; live pid 2553912 healthy. Recorded because it validates the reload-as-deploy path: one atomic swap served both the close-out gate and an operator request without disrupting 29 in-flight agents.
- Main CI running on two heads (27703fb4d7, 9a6c51bec4) — re-green watch still armed; #3449 (reviewRunId) test lane running behind it.
- Fleet all producing: strike-3431 $9.25 (leak, deep analysis), strike-3422 $8.47 +319/−3 (compaction fix taking shape), MIN-932 $34.50 +2171/−301 (Lane A heavy), MIN-931 $14.53 +1026/−241 (rework strong after the wedge recovery). Server 1510MB at 1h22m BEFORE the reload — much flatter than the earlier 3GB/hr, consistent with load-dependence; measure again at comparable load before concluding.

## RUN-79 tick 46 (2026-08-01 ~22:30Z) — 🟢 MAIN RE-GREEN CONFIRMED; leak load-scaling quantified

- **Main green on `da01905b4d`** — PAN-3448's fix verified end to end. Red-main episode closed (~38 min from strike report to green).
- **PAN-3431 leak: load-dependence QUANTIFIED and it is super-linear** — ~18MB/min at ~20 sessions, ~107MB/min at ~31, **~300MB/min at 42 sessions** (2458MB in 8 min). Growth tracks concurrent session COUNT, not uptime. Appended with a sharpened heap-diff recipe: snapshot, spawn 10 sessions, snapshot, diff retained objects keyed by session/agent id — suspects are per-session watchers/listeners/transcript buffers/terminal-registry entries never released on detach. This turns a vague "leak" into a targeted hunt.
- strike-3422's compaction fix (+319/−3) pushed to its PR branch; its local suite failed on the load flake (expected at 42 sessions). #3449 (reviewRunId) test lane still running.
- MIN-931 rework strong ($16.60, editing planning.py). MIN-932 $38.09 +2250 — ctx 0%/out 0 right after a 1h11m thought block; cost still climbing so it is post-compaction, not wedged. Verify next tick.

## RUN-79 tick 47 (2026-08-01 ~22:50Z) — PAN-3422 round 2 in CI (#3457): the fix is a dedicated eaten-message watcher

- **PAN-3422 round-2 PR opened (#3457)** — round 1's PR was already merged, so the compaction fix needed its own. The diff is exactly the right shape: new `src/lib/agents/eaten-message-watcher.ts` (+92) + `messaging.ts` changes (+44) + 69 lines of tests — i.e. a watcher that detects a delivered-but-eaten message rather than trusting keystroke acceptance. Matches the compaction-boundary hypothesis.
- MIN-932 recovered from its compaction cleanly ($39.61, +2258 — was ctx 0 last tick, now 49% and producing; NOT a wedge). MIN-931 rework strong ($21.24, +1397/−308).
- Server 2306MB at 28min — slower than the 300MB/min burst (fleet settled from 42 sessions). Consistent with per-session-count scaling. #3449 test lane still running.

## RUN-79 tick 48 (2026-08-01 ~23:10Z) — PAN-3422 round 2 LANDED + DEPLOYED: eaten-message watcher is live

- **PAN-3422 round 2 merged (`64cad73d01`), handed off, and DEPLOYED** — the live server now runs the eaten-message watcher, so a delivery swallowed at the compaction boundary is detected and re-driven instead of leaving an agent wedged at the ❯ prompt with visible unsubmitted text. The run's highest-frequency operational failure (5 manual `--fresh` recoveries today) now has a structural answer covering both variants: keystroke acceptance (round 1) AND turn-actually-started (round 2).
- Verification standard for calling this class closed, recorded so I do not repeat today's twice-made error: do NOT declare it dead on one clean delivery. Require either (a) a delivery to an agent at >85% context that lands and processes, or (b) 24h with zero specimens. The reload also resets the leak curve as a side benefit.
- #3449 (reviewRunId) test lane still running — merges on green.

## RUN-79 tick 49 (2026-08-01 ~23:30Z) — PAN-3422 CLOSED OUT (28 total); #3449 was red-main collateral, resynced

- **PAN-3422 closed out** — eaten-message watcher live and verified through the full DoD. 28 issues landed+closed this run.
- **#3449 (PAN-3446) diagnosed, not flaky:** its test lane failed because the branch last merged main at `4c4ff124e9` — BEFORE the red-main fixture fix — so it inherited PAN-3448's failure. Not a defect in its own change. Merged current green main into `strike/pan-3446` and pushed (`ac32151929`); CI re-runs clean. **Generalizable: every PR whose branch synced during a red-main window carries that red forward until resynced — check branch-sync timestamp against the red window before treating a PR failure as its own.**
- Main green on two consecutive heads. Fleet 33 sessions, no wedge specimens since the watcher deployed (~20 min — far short of the 24h/high-context bar for declaring the class closed).

## RUN-79 tick 50 (2026-08-01 ~23:50Z) — PAN-3446 LANDED; red-main collateral sweep found and fixed 1 of 8 PRs

- **PAN-3446 landed** (#3449 squash `7c48949d04`, handed off) — reviewRunId recovery live; convoy dispatch no longer dead-ends when a parent's state loses its run id. Close-out on CI+deploy.
- **Collateral sweep across all 8 open PRs** (the generalization from tick 49): 6 green, 1 in progress, **1 real collateral — #3444 (PAN-3338)**, whose test lane failed at 21:20Z on the exact red-main assertion (`has no live pan beads or bd ready instructions`), squarely inside the red window. Not its own defect. Resynced `feature/pan-3338` onto green main (`73b597fcec`); CI re-runs clean. Diagnosing before re-driving cost one log read and saved a wrong-cause rework cycle on someone else's work agent.
- Fleet steady; no wedge specimens since the watcher deployed (~40 min).

## RUN-79 interstitial (~00:00Z) — PAN-3446 CLOSED OUT (29 total); leak model refined to cost-per-attach

Monitor tripped at 3245MB/50min/44 sessions (no system pressure — 18.6GB avail, PSI 0). Pre-emptive reload ALSO satisfied PAN-3446's deploy gate → **PAN-3446 closed out, 29 issues landed+closed this run.**
**Leak model refined with the 5-point table:** average rate tracks RECENT ATTACHES, not standing session count (42-session/8-min sample burst at ~300MB/min during a fleet ramp; 44-session/50-min sample only ~65MB/min with mostly long-lived sessions). That is cost-per-attach never released — and it explains why a quiet-window measurement looked deceptively clean. Told the strike to instrument attach/detach and diff across a SPAWN BURST, not idle time.

## RUN-79 note (~00:20Z) — PAN-3447 swarm orphan (PAN-3459) already covered by the live build; hands off

Operator conversation reported PAN-3447's swarm silently orphaned after wave 1: global `swarm.mode` off + explicit `pan swarm` never persisted an issue-level opt-in ⇒ every deacon patrol skipped coordination (completed slot branches unmerged, 3 items undispatched). Fixed as **PAN-3459 / `3d5ecd9d70`** — `pan swarm` now stamps `swarm.policy.mode=always` into the issue record before dispatching. **Verified that commit IS in the currently deployed build (`5059cfb2891d`, my 00:00Z reload), so no deploy is pending.** Record stamped manually by the operator; deacon is coordinating again (patrol 45953 on slot-2 merge verify). **NOT double-driving PAN-3447** — no `pan swarm`, no dispatch, no merge from me.
Two facts worth carrying: (1) swarm `verify_commands` run the FULL root suite, so those patrols are long and will retry under host-load flake (today's PAN-3344 pattern hit 6 strikes); (2) "silently orphaned after wave 1" is now a recognizable signature — if a swarm stalls with completed-but-unmerged slot branches, check the issue record's swarm policy before anything else.

## RUN-79 tick 51 (2026-08-02 ~02:28Z) — uat/pan-crow-0802 promoted (PAN-3396 + PAN-3451); both close-outs self-clearing gates

- **Operator promoted uat/pan-crow-0802** carrying PAN-3396 + PAN-3451. Neither closed out yet, both for legitimate self-clearing reasons — no overrides taken:
  - **PAN-3396** — deploy-gated (live build `5059cfb2` predates merge `02447e81`). Attempted a reload; the deploy gate refused with its explicit reason ("post-merge lifecycle is pending", queued 02:24:02Z, fires automatically, do not retry or --force). Respected.
  - **PAN-3451** — its own `verifying_on_main` agent is still running. Closing now would cut off in-flight verification.
- Full read-door sweep: 18 PAN + 20 MIN + TIN-1 in pipeline; 4 typed blind spots unchanged. **Clean UAT batch EMPTY** (candidate null) — nothing review+test passed, so nothing assembled.
- Two gates in one tick both stating their reason and self-clearing is the PAN-3383 observability work compounding — a year ago these would have been silent stalls needing a human.

## RUN-79 note (~02:30Z) — RSS tripwire at 3157MB: deliberately NOT reloading

Monitor tripped (3157MB) but system is healthy: 28.8GB avail, memory PSI 0.00 across all windows. The reload that would reset RSS is the SAME operation the deploy gate has already queued (pending post-merge lifecycle, since 02:24Z); retrying would fight a gate protecting in-flight work. Waiting: when the gate fires it resets RSS **and** unblocks PAN-3396's close-out together. Recorded so this non-action is not mistaken for a missed alert — RSS alone, with zero pressure and a queued deploy, is not an emergency.

## RUN-79 tick 52 (2026-08-02 ~02:45Z) — PAN-3396 + PAN-3451 CLOSED OUT (31 total); deferred-deploy defect found (PAN-3462)

- **Both promoted issues closed out.** 31 issues landed+closed this run.
- **NEW DEFECT — the deploy gate's promise is unkept (PAN-3462, struck).** The gate deferred my reload with "fires automatically as soon as the window clears — do not retry"; I obeyed. ~20 min later `pending-post-merge.json` was GONE (window open per `deploy-window.ts:34-41`) but **no deploy had fired** and `pending-deploy.json` still sat queued with `deferralCount: 2`. A manual reload then worked instantly. Nothing converts a cleared window into an actual deploy — so an orchestrator that follows the instruction waits forever. Second occurrence today (the 22:24Z deferral also needed a manual retry). Fix direction: the patrol owning the marker must re-assess and fire, or the message must stop promising automatic firing; plus age-based escalation using the marker's existing `escalated` field.
- **My own correction:** at 02:30Z I chose to WAIT on the gate rather than reload, reasoning it would self-clear. That was wrong — deferring to a mechanism that does not exist is how work stalls silently. Verify the mechanism, don't trust the message.
- Post-reload the close-outs first failed on a health-check timeout during warm-up; retried after polling `/api/health` — a warm-up race worth remembering, not a defect.
