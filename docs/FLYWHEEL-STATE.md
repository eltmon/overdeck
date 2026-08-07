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

Agent reported a convoy launch failing to start reviewers. Verified on disk: parent `state.json` has `reviewRunId: null` (status `starting`) while the run dir `.pan/review/agent-pan-3338-review-6130a234/` EXISTS. **Two defects: (1) reviewRunId was never durably persisted at launch — plausibly erased by one of today's restarts; (2) dispatch (`project-routes.ts:665`) 409s instead of deriving the run id from the artifact sitting in the workspace.** Filed **PAN-3446** with both, + the derivation-with-repair fix and its ambiguity guard; **struck**. PAN-3338 unblocked via abort + request (fresh verification → convoy). The agent correctly refused to mutate state — right call, that's how the defect stayed diagnosable.

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

## RUN-79 tick 53 (2026-08-02 ~03:05Z) — first auto-merge SCHEDULED under the UAT-off config (PAN-3450)

- **First use of the run's `require_uat_before_merge=false` config**: ready set produced PAN-3450 (review=passed test=passed, PR #3461) → scheduled via `POST /api/flywheel/auto-merge/schedule` (id 49, merges 03:10:27Z). API note for next time: the endpoint needs an `Origin` header and takes **`issueId`** (singular string), not `issueIds` — both errors were typed and clear.
- #3444 (PAN-3338) and #3402 (PAN-3362) are now BOTH green but not yet in the ready set — their review/test verdicts haven't flipped; pipeline-owned, not mine to merge.
- **MIN-931 handed off** (stopped 23:31Z after completion; review + test sessions live) — Lane B tail MIN-934 waits for it to reach terminal, correctly. MIN-932 at **$102.33 (+4943/−897)** — the run's biggest single spender, still producing.
- strike-3462 (deferred deploys) +75/−30, strike-3431 (leak) $15.09 still hunting.

## RUN-79 tick 54 (2026-08-02 ~03:25Z) — auto-merge waiting correctly (not a PAN-3462 repeat); state push landed

- **PAN-3450's auto-merge has NOT fired and that is CORRECT** — scheduled for 03:10Z but PR #3461's `test` lane is still IN_PROGRESS; the queue is waiting on checks, exactly as designed, and `/auto-merge/problems` is empty. **Deliberately did NOT treat this as another "scheduled thing never fires" defect** — checked the mechanism's actual blocking input before concluding, which is the correction I owed after the PAN-3462 sequence (where I first over-trusted a promise, then risked over-generalizing the distrust).
- Tick-53 state commit reached origin (rode along when the other session pushed — no bypass). Two fresh unpushed commits from them now sit ahead; same PAN-3062 pattern, harmless as long as I keep committing only my allowlisted path and never force.
- strike-3462 + strike-3431 still working; campaign MIN-932 in flight; MIN-931 in review/test; #3444/#3402 green but verdicts not yet flipped to ready.

## RUN-79 tick 55 (2026-08-02 ~03:45Z) — 🏁 MIN-931 SHIPPED + CLOSED; Lane B tail MIN-934 dispatched (32 total)

- **Operator promoted uat/min-crow-0801 carrying MIN-931** (Hermes campaign Lane B head, 27 items) — closed out clean, no gates, no overrides. **32 issues landed+closed this run.**
- **Campaign advanced on its dependency chain:** MIN-931 terminal ⇒ MIN-934's hard dep (its `guarded_write`, same files) satisfied ⇒ **MIN-934 started** (auto-planning → work). Campaign now: Lane A = MIN-930 ✅ → MIN-932 working → MIN-933 queued; Lane B = MIN-931 ✅ → MIN-934 planning. **2 of 5 terminal**, both lanes live, serial discipline held throughout (never started a tail before its head reached terminal).
- Read-door sweep: 17 PAN + 14 MIN + TIN-1 in pipeline (MIN list shrank as zombies/closed rows drained). 4 typed blind spots unchanged. Clean UAT batch EMPTY (candidate null).
- Schema note: `emit-status` rejected the snapshot for a missing `system.mainHead` — typed error, fixed by reading `origin/main`. Worth remembering the field is required.

## RUN-79 tick 56 (2026-08-02 ~04:00Z) — OPERATOR EXPEDITE: PAN-3467 + PAN-3468 struck (PAN-3447 unblockers)

- **Operator expedite request — both struck immediately.** PAN-3447 (God View Confluence) is the operator's own pipeline-observability tool and is doomed by two fresh substrate bugs:
  - **PAN-3468** (higher leverage): the auto-planner writes readiness as *dispatchable-now* instead of *parallel-safe*, so after wave 1 the coordinator goes endgame with 11 pending items — swarm stalls permanently, **no work-agent handoff and no needs-you**. Operator's read: this likely slows EVERY swarmed issue and matches the general slow-pipeline complaint. Prioritized first.
  - **PAN-3467**: `pan plan finalize` silently discards the workspace `.pan/spec.vbrief.json` and re-promotes the stored server draft — the operator's swarm-shaped plan never became canonical. Silent-discard-of-operator-intent is the same never-surface-the-loss family as today's other findings.
- **Verified the recovery input survives**: `workspaces/feature-pan-3447/.pan/spec.vbrief.json` is intact (35,864 bytes, 16 items, untouched since 18:16). **Unstick sequence once PAN-3467 lands + deploys:** `pan plan finalize` from that workspace, then `pan swarm PAN-3447` — the wide wave (river-canvas, hook-bus, bottom-strip, topbar) dispatches as deps merge. Operator is monitoring live slots and will drive a fallback serial work agent if the swarm endgames before the fixes land, so I do NOT double-drive.
- Also this tick: deployed `50f9d451a580` (3 swarm fixes verified in-build) and ran `pan swarm PAN-3447` — policy `{"mode":"always"}` confirmed persisted in the record. PR #3461 (PAN-3450) test lane FAILED on `system-health-no-loss.test.ts` — real audit feedback, not flake; auto-merge correctly did not fire; drive rework.

## RUN-79 tick 57 (2026-08-02 ~04:15Z) — both expedite fixes in CI (#3470, #3471) within ~15 min of the request

- **PAN-3467 → PR #3470** (`0009c93707 fix(plan): prefer authored workspace spec`) and **PAN-3468 → PR #3471** (`11eaa2cb38 fix(planning): separate readiness from DAG position`). Both committed with exactly the right framing — 3468's commit message names the actual conceptual error (readiness conflated with DAG position), which is why the coordinator endgamed with pending items.
- Watch armed on #3470's test lane (PAN-3467 is the one that must DEPLOY before the PAN-3447 unstick). Sequence on green: merge → `pan done --strike` → **`pan reload`** → `pan plan finalize` from `workspaces/feature-pan-3447` → `pan swarm PAN-3447`.
- Operator drives PAN-3447's live slots and any fallback serial agent; I only supply the deployed fix + the two unstick commands.

## RUN-79 interstitial (~04:28Z) — strike-3462 landed via CI (#3472); PAN-3344 tally now NINE strikes

strike-3462 (deferred-deploy fix, `cadc19d9e9 keep queued blocker current`) reported the load flake with a **failure-count gradient: 21 → 39 → 65 timeouts across three back-to-back runs on unchanged code**, 13k+ passing each time. That gradient is the cleanest proof yet that it is contention, not the change — same commit, same suite, monotonically worse as the host loaded. Pushed + **PR #3472**, CI arbitrates.
**PAN-3344 tally: 9 strikes today could not use local verification.** Appended the gradient plus the blunt framing: the project has effectively lost pre-push verification on the machine where agents work. This is now the run's most expensive systemic tax — every instance costs an orchestrator round-trip and a landing decision.

## RUN-79 tick 58 (2026-08-02 ~04:30Z) — 🔴 RED MAIN #2 (PAN-3473) blocks BOTH expedite strikes; struck

- **RED MAIN on `50f9d451a5`**: `system-health-no-loss.test.ts` fails — `metrics.virtualCommitmentPercent` missing from `SystemHealthPill.tsx` after the PAN-3423 popover redesign (data still present upstream; a surface/no-loss gap, not a data gap). Prior commits green, so it entered with that work. Filed **PAN-3473** (blocks-main) + struck.
- **SELF-CORRECTION:** at tick 56 I called PR #3461's failure on this exact test "real audit feedback, not flake" and queued PAN-3450 for rework. **Wrong — it was red-main collateral.** Two independent strikes then hit the same wall and diagnosed it precisely (strike-3467 named `SystemHealthPill.tsx`). Lesson repeated from the earlier episode: when a PR fails, check main's own CI on that test BEFORE attributing the failure to the PR. I had that exact rule from tick 49 and did not apply it here.
- **Both operator-expedited strikes are blocked purely on this** — PAN-3467 (#3470) and PAN-3468 (#3471) each have their fix committed and pushed, refusing correctly to fix-forward someone else's regression. Landing PAN-3473 releases three PRs at once (plus #3461).
- Neither expedite strike knows its branch is already pushed with a PR open (PAN-3417 merged-awareness gap, 4th+ specimen) — flywheel cannot `pan tell`, so they idle harmlessly until I merge.

## RUN-79 tick 59 (2026-08-02 ~04:45Z) — red-main fix in CI (#3474); 4 PRs queued behind it

- **strike-3473 fix pushed → PR #3474** (`5e78dab785 restore commitment diagnostic`, **+12/−0** — exactly the surgical restore the diagnosis called for; the metric existed upstream, only the pill surface had dropped it). Watch armed.
- **One merge releases four blocked PRs**, all failing on inherited red rather than their own changes: #3470 (PAN-3467) + #3471 (PAN-3468) — both operator-expedited PAN-3447 unblockers — plus #3461 (PAN-3450) and #3472 (PAN-3462). Red-main episode #2 of the run; both were caught by no-loss/beads guards doing exactly their job, and both were reported first by strike agents refusing to fix-forward.
- Sequence on green: merge #3474 → verify main greens → merge #3470 + #3471 → `pan reload` → `pan plan finalize` from `workspaces/feature-pan-3447` → `pan swarm PAN-3447`.

## RUN-79 tick 60 (2026-08-02 ~04:55Z) — near-miss: almost `--fresh`ed a WORKING agent; leak root cause found

- **Near-miss worth recording.** strike-3431's cost was byte-identical across FOUR ticks ($15.0908, +42/−92) — my wedge heuristic. Before intervening I read the pane properly: **"1 shell still running"** and an active spinner. Cost does not advance while an agent blocks on a long shell (the full suite runs 12+ min under load), so **frozen cost alone cannot distinguish wedged from waiting-on-a-shell**. A `--fresh` would have destroyed an in-progress verification AND its uncommitted context. NEW RULE: before any wedge call, check for a running-shell indicator and for real commits — not just the cost delta.
- **And it has the leak fix**: three commits — `bound conversation watcher memory`, **`use native recursive conversation watcher`**, **`externalize parcel watcher`**. The parcel watcher is the cost-per-attach culprit, matching the 5-point curve diagnosis exactly (per-attach structures never released). Round 1 bounded the symptom; round 2 removes the watcher that caused it. Leaving it to finish its gates rather than pushing early.
- #3474 (red main) test lane still running; four PRs queued behind it. MIN-932 $124.71 ctx 81% (near compaction), MIN-934 $17.04 +653. Server healthy at 1330MB/54min, 21GB free.

## RUN-79 tick 61 (2026-08-02 ~05:00Z) — 🟢 RED MAIN #2 FIXED (#3474 → 66f67f0ac0); expedite PRs resynced

- **PAN-3473 merged and handed off** — commitment diagnostic restored to `SystemHealthPill.tsx`; red-main episode #2 closed (~30 min from strike report to merge).
- **Both operator-expedited PRs resynced onto the fixed main** (`28951731e73` for PAN-3467, `7a50dd163d7` for PAN-3468) — their prior failures were stale red-window results, so a merge-of-main triggers fresh CI rather than leaving them looking broken. Same pattern as tick 50's collateral sweep, now applied proactively.
- Watch armed on #3470 (PAN-3467) — it is the gating one, since its fix must DEPLOY before `pan plan finalize` can promote the operator's spec. Sequence on green: merge both → `pan done --strike` ×2 → `pan reload` → finalize → `pan swarm PAN-3447`.
- #3461 (PAN-3450) and #3472 (PAN-3462) also released by this merge; re-run their lanes next tick if still stale.

## RUN-79 tick 62 (2026-08-02 ~05:10Z) — leak ROOT CAUSE fix in CI (#3476); all red-window collateral resynced

- **strike-3431 signaled ready → PR #3476** — the parcel watcher removal, i.e. the actual cost-per-attach root cause. The 5-point RSS curve (attach-rate scaling, not uptime) is what pointed here; round 1 had only bounded the symptom. Two emergency restarts and ~hourly pre-emptive reloads today trace to this one structure.
- **All four red-window collateral PRs resynced onto green main**: #3470/#3471 (expedites, earlier this tick), plus #3461 (PAN-3450) and #3472 (PAN-3462) now — each was showing a stale failure from CI runs taken while main was red. Resyncing beats re-driving: no agent gets sent to chase a cause that was never theirs.
- Main CI running on `66f67f0ac0` (the red-main fix). MIN-932 at ctx 86% (compaction imminent, $126.39), MIN-934 $19.01 +846.

## RUN-79 interstitial (~05:20Z) — merged swarm slot auto-resumed forever: reaped + filed (PAN-3477)

Operator reported PAN-3447 slot-3 `merged ... session alive`, repeatedly auto-resumed, eating swarm capacity. **Verified the merge before touching anything** (`78098fa908` is an ancestor of `feature/pan-3447` HEAD via `cf353434e79`, and its own branch is pushed) — so reaping risked no work. Reaped the session; doctrine sanctions this ("merged/verdict-recorded zombies can be reaped directly").
**Three compounding gaps, verified in code, filed as PAN-3477 + struck:** (1) nothing reaps a slot session when its item merges; (2) `deacon-auto-resume.ts` has NO swarm-slot awareness whatsoever, so a stopped merged slot is revived like any work agent — `lastYieldResumeAt` is that loop's fingerprint; (3) `countRunningSwarmSlotsForIssue` (`concurrency.ts:118-130`) charges tmux-alive slots against the budget with no merge check, so the zombie starves the wide wave PAN-3447 is waiting for. Together: a merged slot holds capacity permanently and resists being stopped.
Note this is the THIRD swarm-substrate defect on PAN-3447 alone (3459 policy persistence, 3468 readiness contract, now 3477 slot reaping) — the swarm path is the least-exercised part of the pipeline and it shows.

## RUN-79 tick 63 (2026-08-02 ~05:30Z) — 🎯 EXPEDITE LANDED: PAN-3467 + PAN-3468 merged, deployed, spec promoted

- **Both operator-expedited fixes merged, handed off, and DEPLOYED** (`93b30aa7d7` PAN-3467, `b0e7dd41a9` PAN-3468; verified both are ancestors of the live build). Caught a trap on the way: an in-flight reload (pid 887017) had completed on `66f67f0ac0` — PRE-merge — so the "already deployed" appearance was false. Verified with `merge-base --is-ancestor` before running finalize; running it against the old CLI would have discarded the operator's spec exactly as PAN-3467 describes. **Never infer deployment from a recent reload; verify the commit.**
- **`pan plan finalize` from the PAN-3447 workspace SUCCEEDED — 16 checklist items, canonical spec `status: proposed`, dependency edges intact** (river-canvas + topbar-enrichment file_overlap on confluence.css). PAN-3467's fix is proven in production: the operator's authored spec became canonical instead of being silently replaced by the server draft.
- **Blocked at the last step**: promotion deferred, and `pan plan done` fails with a bare `xBRIEF quality lint failed` — **no issue list, no rule names, from either command**. Filed **PAN-3478** + struck (a gate that cannot enumerate its own failures can only be satisfied by bypass — same definitive-negative-without-evidence family as 3373/3462/3468). The `--no-quality-lint` bypass is an OVERRIDE and therefore the operator's call, not mine.
- Swarm remains held from the reset (deliberate) — resuming would dispatch against the old readiness contract. Sequence once the lint clears: `pan swarm resume PAN-3447` → `pan swarm PAN-3447`.

## RUN-79 tick 64 (2026-08-02 ~05:40Z) — 🎉 LEAK ROOT CAUSE LIVE; deferred-deploy fix landed too

- **PAN-3431 (parcel-watcher removal) merged, handed off, and DEPLOYED** (`3d0762120e`, verified live in build `552f6d412a09`). The cost-per-attach leak that forced two emergency restarts and ~hourly pre-emptive reloads today is now structurally fixed. **Verification standard for calling it closed** (per the twice-learned lesson): watch RSS across a fleet ramp at comparable load — the old signature was ~300MB/min during a 42-session ramp; a flat curve through a similar ramp is the proof, not a quiet-window reading.
- **PAN-3462 (deferred deploys never fire) merged + handed off** (`552f6d412a`) — deploys deferred by the gate now actually fire when the window clears, closing the trap that cost two manual reloads and blocked close-outs earlier tonight.
- PAN-3450's auto-merge schedule was refused: `review status is not readyForMerge` — its review verdict has not re-flipped since the red-window rerun. Correct refusal (the queue guards on canonical state, not on my say-so); it re-enters when the verdict lands.
- Run tally: **35 issues landed+closed**, plus PAN-3467/3468/3473/3431/3462 now at verifying-on-main.

## RUN-79 tick 65 (2026-08-02 ~05:50Z) — FIVE close-outs drained (36 total); leak fix shows a first positive signal

- **PAN-3467, PAN-3468, PAN-3473, PAN-3431, PAN-3462 all closed out** in one pass (main green past both merge commits; 8-row DoD each, no overrides). **36 issues landed+closed this run.** That drains the entire expedite + red-main + leak + deferred-deploy cluster.
- **Leak fix first data point at comparable load**: 1426MB @ 18min with **37** sessions, versus the pre-fix 1936MB @ 18min with **31** sessions — more sessions, ~510MB less, inverting the old scaling. Posted to PAN-3431 **explicitly as an early indicator, not closure**: the old signature peaked during a fast attach RAMP (~300MB/min at 42 sessions), and this is steady state. Proof requires a comparable ramp with a flat curve. (Third time today I have had to resist declaring a class closed on one favorable reading — the discipline is holding now.)
- PAN-3447 still blocked only on the silent quality-lint gate (PAN-3478 struck); swarm intentionally held; `--no-quality-lint` remains the operator's override to authorize.

## RUN-79 note (~06:05Z) — deployed PAN-3479 (tombstone session_id) immediately, not at next tick

Operator reported PAN-3479 on main: agent tombstones were NULLING `session_id`, blanking the dashboard session view ("No conversation data available") for every retired agent — observed on the PAN-3447 slots. Deployed at once rather than waiting for the tick, because the bug accrues damage per newly-retired agent. Verified live: build `866f5608e83b` contains both `866f5608e83` (PAN-3479) and `50f9d451a5` (PAN-3465, which turned out to be already live from an earlier reload — the operator's "still pending" was stale). Operator hand-backfilled the three slot rows' session ids; those hold.
**Pattern worth carrying:** PAN-3479 is another instance of a safety mechanism destroying information it never needed to destroy — resume-safety was achieved by nulling the transcript linkage. The fix separates the two (explicit retained-transcripts phase gate in `deacon-auto-resume`, session_id preserved). Same shape as the stuck-flag and needs-you families: the guard was right, its collateral was not.

## RUN-79 tick 66 (2026-08-02 ~06:10Z) — ⚠️ LEAK NOT FIXED: measured 185MB/min post-fix; re-struck

- **The verification discipline earned its keep.** Direct 180s delta sampling on the post-fix build: **RSS 1647→2203MB = 185MB/min at 36 sessions**. Normalized: ~5.1MB/min/session vs the pre-fix ~7.1 — a real ~28% improvement, but nowhere near fixed. The parcel watcher was *a* per-attach retainer, not *the* one. **Re-struck PAN-3431 (round 3).**
- **Methodological lesson, recorded because it nearly fooled me twice:** my tick-65 "encouraging" reading compared two STEADY-STATE snapshots (1426MB@18min/37 vs 1936MB@18min/31). Steady-state snapshots hide the slope entirely — only a live delta on a single process reveals the rate. Had I closed this on the tick-65 reading (as I was tempted to, and as I did wrongly twice earlier tonight with the composer wedge and the first leak round), the fleet would have kept needing hourly reloads with the issue marked done.
- Sharpened the hunt on the issue: heap-diff across a deliberate 10-session attach burst, parcel watcher now excluded; remaining candidates are per-session event-store subscriptions, terminal/PTY registry entries, transcript buffers.
- strike-3477 (merged-slot reaping) $11.63 +246/−43 at ctx 82%; strike-3478 (silent lint gate — PAN-3447's last blocker) $3.86 +114/−3.

## RUN-79 tick 67 (2026-08-02 ~13:25Z) — 🏁 PAN-3447 (God View Confluence) PROMOTED — the four-bug blockade is broken

- **Operator promoted uat/pan-crow-0802 carrying PAN-3447** — the operator's own pipeline-observability feature, which four distinct swarm-substrate defects had been dooming: PAN-3459 (policy persistence), PAN-3467 (finalize discarding the authored spec), PAN-3468 (readiness/DAG conflation endgaming the swarm silently), PAN-3477 (merged slots never reaped). All four found and four of five fixed today; the feature shipped through the gap.
- **Close-out used two doors that did not exist this morning**: `pan unstick PAN-3447` cleared a `verification_stuck` gate (PAN-3393/PAN-3321, landed ~09:00Z today) and a `pan pause` with attribution cleared a stale registry row alive with zero tmux sessions. Close-out itself now waits only on main CI for the promote commit — **no overrides taken**. Satisfying proof of the metabolism: this morning's substrate fixes are what made this evening's close-out mechanical.
- Read-door sweep: 18 PAN + 14 MIN + TIN-1 in pipeline; 4 typed blind spots unchanged. Clean UAT batch EMPTY (candidate null).
- Fleet: 3 strikes (3431 leak round 3, 3477 slot reaping, 3478 silent lint gate) + both campaign lanes (MIN-932, MIN-934) live.

## RUN-79 tick 68 (2026-08-02 ~13:45Z) — 🎉 PAN-3447 CLOSED OUT (37 total); leak improving but still live

- **PAN-3447 closed out** — God View Confluence is fully done: merged, promoted, deployed, **bundle-verified** (`index-uzPEFQC1.js` contains `confluence`, up from zero occurrences pre-deploy), and closed with clean gates and no overrides. **37 issues landed+closed this run.** The operator caught the deploy gap by curl+grep on the served bundle — a hard-fail check worth stealing: verify the ARTIFACT, not just the build commit.
- **Leak third live-delta sample: 94MB/min at 38 sessions (~2.5MB/min/session)** vs 185 (~5.1) and pre-fix ~300 (~7.1). Direction right, ~65% per-session reduction across two fixes, still ~40min between required reloads. **Recorded the confound honestly:** samples were taken at different process ages (18min vs 5min uptime) and the leak is front-loaded, so part of the apparent gain is measurement position, not code. Prescribed a fixed-uptime sampling protocol (15-20min in) so the next comparison is clean.
- Investigated the operator's reported "orphan" `dist/dashboard/server.js` (pid 896079): **NOT an orphan** — cgroup `docker-d46bd5e0…`, cwd `/workspaces/overdeck` (container-internal), uptime 15h35m (not 09:21 as reported). It is a workspace devcontainer peer; not binding `:3011` is correct per the single-Deacon invariant. Declined to kill it and offered the correct lever (stop that workspace's Docker stack) instead.

## RUN-79 tick 69 (2026-08-02 ~13:55Z) — god-view fixes deployed; typecheck regression located + struck (PAN-3482)

- **Deployed `55fbe7a5f615`** (verified live): orb membership excludes dead-agent residue + closed issues (the 96-frozen doldrums wall), session-feed dock no longer reserves 320px, hook LEDs from PostToolUse heartbeat, satellites spawn settled, canvas text truncates.
- **Typecheck regression confirmed and located.** Operator reported `tiered-inspect-escalation.ts(61,5) TS2353 taskId`. It did NOT reproduce under `npm run typecheck` (exit 0) — because that script TOLERATES dashboard-server errors against a shrink-only ratchet. `scripts/lint-dashboard-types.sh` is the real gate and reports **60 errors vs baseline 57**, naming a second site too (`tiered-callouts.ts:160`). Filed **PAN-3482** + struck. Root cause is a rename miss: the xbrief refactor (`35bb5da2d9f`) moved the domain task→item, the receiving types want `itemId`, two call sites still pass `taskId`.
- **LESSON (new, generalizable): a green `npm run typecheck` does NOT prove the dashboard half is clean** — the ratchet script does. Any "typecheck passes" claim about dashboard code must cite `lint-dashboard-types.sh`/`lint-frontend-types.sh`, not the root script. This is why the operator saw red where my first check saw green.
- Also noted during deploy: a `PID 558752 survived SIGKILL; ports are free, continuing restart` line — exactly the false-abort path PAN-3370 fixed, now correctly CONTINUING instead of aborting. Fix working in production.

## RUN-79 interstitial (~14:00Z) — PAN-3482 landed via merge-sync (#3483); PAN-3440 scope sharpened

strike-3482 committed the fix (`4711669cca7 pass xbrief item ids to tiered handlers`) but stalled: launcher-git-guard blocks `git rebase`, and **the prescribed `pan sync-main` two-door endpoint is a NO-OP STUB** — a sharper fact than PAN-3440 had recorded. Correct double refusal by the agent (no bypass, no unrebased push). **A rebase was never required**: merged `origin/main` into the branch (history-preserving, sanctioned), pushed, **PR #3483**. Fourth time today this workaround unblocked a stalled strike.
Appended to PAN-3440: its scope is not just "register strike workspaces" but "implement the path the guard's own error message points agents toward" — a guard whose prescribed alternative is a stub is a dead end by construction, and that is why strikes keep stalling here instead of self-serving. Recommended documenting merge-sync in the strike role prompt.

## RUN-79 tick 70 (2026-08-02 ~14:10Z) — silent-lint fix landed (#3484); guard-stall now a recognized pattern

- **strike-3478's fix pushed → PR #3484** (`9390359b75b surface quality lint issues`) — this is the one that unblocks PAN-3447 follow-on planning, which stalled precisely on the gate's silence. Same guard-stall as PAN-3482: agent committed, refused to bypass, waited. Merge-synced and landed. **Fifth guard-stall unblocked this way today.**
- **The pattern is now unmistakable and worth acting on**: every strike that touches a behind-main branch stalls at the same wall, each burning an orchestrator round-trip, because the guard's prescribed alternative (`pan sync-main`) is a no-op stub (PAN-3440). Until 3440 lands, merge-sync-and-PR is the standing orchestrator response — do not wait for the agent to self-serve.
- **strike-3477 vanished with no commits** (session gone, empty branch) — re-struck. Cause unknown; if it vanishes again with nothing committed, that is a spawn/crash class worth its own filing rather than a third re-dispatch.
- strike-3431 leak round 3 progressing with real work ($21.05, +388/−164 — much larger than round 2's diff, consistent with hunting a second retainer).

## RUN-79 tick 71 (2026-08-02 ~14:15Z) — MIN-932 shipped + closed; Lane A tail MIN-933 dispatched (38 total)

- **Operator promoted uat/min-sable-0802 carrying MIN-932** (Hermes Lane A item 2) — closed out after clearing a leftover running work agent with an attributed pause. **38 issues landed+closed this run.**
- **Campaign advanced serially again**: MIN-932 terminal ⇒ **MIN-933 started** (auto-planning → work). Campaign state: Lane A = MIN-930 ✅ → MIN-932 ✅ → MIN-933 planning; Lane B = MIN-931 ✅ → MIN-934 working. **3 of 5 terminal, both lanes live**, serial discipline unbroken across the whole campaign — no tail ever started before its head reached terminal.
- **The postMergeLifecycle leftover-agent gap now has 4 specimens** (MIN-929, PAN-3406, PAN-3447, MIN-932): every promote leaves the work agent running, blocking close-out until an attributed pause clears it. It has recurred on every single promote today. Worth filing on the next occurrence rather than absorbing it a fifth time — the pause is a backstop standing in for a missing lifecycle step.
- Read-door sweep: 17 PAN + 14 MIN + TIN-1; 4 typed blind spots unchanged. Clean UAT batch EMPTY.

## RUN-79 tick 72 (2026-08-02 ~14:35Z) — PAN-3482 + PAN-3478 LANDED; verification storm root-caused (PAN-3492)

- **PAN-3482 landed** (#3483 `547e675b5a`) — dashboard typecheck ratchet restored. **PAN-3478 landed** (#3484 `cf2538207c`) — the quality lint now names its issues, unblocking PAN-3447 follow-on planning. Both were ALREADY GREEN in CI while their strikes were still fighting the local gate: the merged-awareness gap (PAN-3417) again, costing real time.
- **Root-caused the verification storm the strike reported → PAN-3492.** The respawning vitest workers for feature-pan-3419 are parented by the DASHBOARD SERVER, not the work agent — they are server-driven verification retries. The loop is self-amplifying: load → 5s fixture timeout (PAN-3344) → "failure" → immediate retry → more load. One issue's verification can starve every other agent's gate run; the reporting strike's 31 timeouts were collateral.
- **My first intervention was WRONG and is recorded as such**: I paused `agent-pan-3419` with governor attribution, and fresh vitest generations kept spawning after the pause (17-18s elapsed on post-pause processes) because the server owns them. **Agent pause is not a load-shedding tool for server-driven verification.** The effective lever was `pan review abort PAN-3419`; unpaused the agent afterward since it was never the culprit.
- This closes the loop on today's biggest systemic tax: PAN-3344 (fixture timeout) + PAN-3429 (governor won't shed) + PAN-3492 (retries amplify) are three faces of one problem — nothing admission-controls heavy test runs.

## RUN-79 tick 73 (2026-08-02 ~14:40Z) — Hermes Lane B COMPLETE; PAN-3477 recovered from a vanished session (#3493)

- **MIN-934 handed off — Hermes Lane B is DONE end to end** (MIN-931 ✅ → MIN-934 handed off). Campaign: **4 of 5 items terminal or handed off**, Lane A finishing on MIN-933. Serial discipline held for the entire campaign.
- **strike-3477 vanished a SECOND time without signalling — but its fix was committed** (`b66dc5fd7d4 reap merged slot sessions`). Recovered it straight from the branch, merge-synced, **PR #3493**. Lesson: a vanished strike session is not a lost strike — ALWAYS check the branch for commits before re-dispatching. I nearly re-struck it a third time, which would have discarded finished work.
- strike-3431 (leak round 3) verified genuinely working, not wedged: `1 shell still running` after a 3h8m churn. The frozen-cost-≠-wedge rule from tick 60 is now load-bearing twice.
- Load down to 11.4 after the PAN-3492 storm abort. Close-outs for PAN-3482/3478 wait on main CI (in progress on both merges).

## RUN-79 tick 74 (2026-08-02 ~14:55Z) — PAN-3477 landed+deployed; PAN-3482 + PAN-3478 closed out (40 total)

- **PAN-3477 merged (`4be15e7626`), handed off, and DEPLOYED** — merged swarm slots are now reaped, auto-resume is swarm-aware, and zombies no longer charge against slot capacity. The PAN-3447 slot-3 loop is structurally dead.
- **PAN-3482 + PAN-3478 closed out. 40 issues landed+closed this run.** The dashboard typecheck ratchet is restored and the quality lint now names its issues.
- **My own miss, caught by the gate:** PAN-3478's close-out failed on `reviewStatus: pending` because I merged its PR at tick 72 but never ran `pan done --strike`. The DoD gate caught the skipped step exactly as designed — I had merged and moved on. Ran the handoff, then close-out passed clean. **Rule: merging a strike PR is only half the landing; the handoff is what records the verdict.** Worth noting the gate is what made this recoverable rather than a silently half-landed issue.

## RUN-79 tick 75 (2026-08-02 ~15:15Z) — PAN-3477 closed out (41 total); leak curve REVERSED

- **PAN-3477 closed out. 41 issues landed+closed this run.**
- **Leak: first negative sample.** Fixed-uptime protocol (20m41s, the discipline prescribed two ticks ago): **RSS 1357→907MB = −150MB/min at 33 sessions**. The process is reclaiming, not growing; pre-fix at comparable uptime was ~1936MB and climbing, post-round-2 was +94MB/min. Absolute RSS (907MB at 20min) is the more meaningful signal than the negative slope.
- **Did NOT declare it fixed** — wrote explicit closure criteria onto the issue instead: two consecutive non-positive fixed-uptime samples PLUS one sample through a deliberate 10-session attach burst, since the leak's worst behaviour was always attach-scoped and 33 steady-state sessions is not a ramp. After three premature "fixed" calls this run (composer wedge, leak round 1, leak round 2), the standard is now written down rather than remembered.
- Campaign: 4 of 5 (Lane B complete, MIN-933 finishing Lane A). strike-3431 still working its 3h+ shell.

## RUN-79 tick 76 (2026-08-02 ~15:40Z) — leak: 2 consecutive non-positive samples; closure HELD on the ramp criterion

- **Sample 2 @ 41m26s: RSS 1031→751MB = −93MB/min at 32 sessions**, following sample 1's −150MB/min @ 20m41s. Two consecutive non-positive fixed-uptime samples ⇒ criteria 1 and 2 of the closure standard are met. **The absolute number is the real evidence: 751MB at 41min uptime, where the pre-fix process was 2.4-3.4GB by that age and needed a reload.**
- **Held closure anyway** — criterion 3 (a sample through a ~10-session attach burst) is unobserved, and that criterion exists precisely because every earlier measurement showed the leak was ATTACH-SCOPED: acceptable in steady state, explosive during ramps. Two calm-water samples cannot rule out an attach-only retainer. Left the issue open with the standard restated for whoever catches the next natural ramp.
- This is the discipline the run kept relearning, now applied without prompting: three premature "fixed" calls earlier (composer wedge, leak rounds 1 and 2) each cost real time; the cost of holding an issue open one extra tick is nearly zero by comparison.

## RUN-79 tick 77 (2026-08-02 ~16:00Z) — ⚠️ SELF-CORRECTION: the two "reclaiming" leak samples were GC-phase artifacts

- **Long-interval tracking contradicts both short samples**: 751MB @41min → **1849MB @64min = +48MB/min** over 23 minutes. The −150 and −93MB/min readings were taken inside GC collection phases. The heap is a sawtooth; a 180s window reports whichever phase it lands in **as if it were the trend**, and twice in a row it reported the exact opposite of the truth.
- **Methodological rule established (posted to the issue): the sampling window must exceed the GC period.** Short live-delta windows are worse than useless for a sawtooth heap. Valid comparisons are only (a) RSS at the SAME uptime across builds, (b) average slope over ≥20 minutes. Closure criteria rewritten accordingly; the short-window method is discarded outright.
- Honest scoreboard on this issue: the two landed fixes DID help materially (same-uptime RSS roughly halved, reload interval stretched from ~40min to none-yet-needed at 64min), but a retainer is still live. Round 3 continues.
- **Four times this run I have nearly closed something on favorable-but-invalid evidence.** The failure mode is never "no data" — it is *data collected by a method that cannot answer the question*. Worth carrying: choose the measurement to match the phenomenon's timescale BEFORE trusting any reading.

## RUN-79 tick 78 (2026-08-02 ~16:30Z) — leak criterion 3 ANSWERED: attach-scoped retainer confirmed live

- **Caught the attach ramp** (server restart re-attaching 32 sessions) — the exact sample criterion 3 required. Result: **2191MB at 3m09s uptime** (≈1.8GB over baseline for 32 attaches), then **+8MB/min once settled**. Same-uptime comparison vs pre-fix (2458MB @8min/42 sessions) shows the ramp cost is proportionally unchanged.
- **Verdict: the leak is now precisely characterized rather than merely "still present" — a large one-time per-attach cost that is never released, with the ongoing drip largely fixed.** That reframes round 3 from "find the leak" to "find state allocated during attach/session-registration and never freed on detach". Also explains why reload intervals tracked fleet churn rather than clock time: RSS is driven by CUMULATIVE ATTACH COUNT over a process's life.
- Kept the issue open; criteria 1-2 stand as evidence the steady-state half is genuinely fixed, criterion 3 answered negatively. This is the payoff of holding closure through four temptations: the issue now carries a specific, testable hypothesis instead of a false "fixed".
- Campaign: MIN-934 restored and working (+1031/−184); MIN-933 in review. 4 of 5.

## RUN-79 tick 79 (2026-08-02 ~16:50Z) — leak round 3 in CI (#3494): the fix matches the measured shape

- **strike-3431 round 3 committed and landed to CI**: `c4764c6f12b stream cost event log reads` + `ffc6d61387a preserve cost reader pagination` → **PR #3494**. The diagnosis and the fix line up: loading the FULL cost event log per read is precisely a large allocation on a path every session attach touches — exactly the "one-time per-attach cost never released" shape that criterion 3's ramp sample revealed. Measurement drove the fix rather than guesswork.
- Wrote the verification protocol INTO the PR body (same-uptime or ≥20min slope; never 180s windows) so whoever validates it does not repeat the GC-phase error that twice reported the opposite of the truth on this issue.
- Emitted a status snapshot this tick, per the rule added after the stale-snapshot false idle escalation.

## RUN-79 tick 80 (2026-08-02 ~17:15Z) — 26 acknowledged parked issues evaluated; dispositions recorded

Operator batch-acknowledged 26 needs-you parked issues (acknowledged trips re-fire if left undecided). **Full disposition:**

**18 of 26 need NO parked decision — they are already in-pipeline and moving**: PAN-1577, PAN-3338, PAN-3362, PAN-3410, PAN-3411, PAN-3418, PAN-3419, PAN-3420, PAN-3423, PAN-3426, PAN-3427, PAN-3450, MIN-839, MIN-923, MIN-924, MIN-933, MIN-934, TIN-1. Their trips were stale-state artifacts, not real decisions owed.

**8 genuinely parked, evaluated against evidence THIS RUN produced:**
- **PAN-1824 (CI flake: fake timers / @slow) — PRIORITIZE.** The run's single biggest tax: 9 strikes lost local verification; one measured a 21→39→65 timeout gradient on unchanged code. Evidence posted.
- **PAN-1711 (event-loop stalls under load) — PRIORITIZE.** Spawned three filings this run (PAN-3492 retry amplification, PAN-3429 governor won't shed, PAN-3431 RSS). Evidence posted.
- **PAN-1767 (merged-but-not-closed-out count) — PRIORITIZE.** The operator asked "why haven't these closed out?" three times this run; this issue answers it in `pan status`. Evidence posted.
- **PAN-1416 (workspace dashboards must not claim canonical)** — still-valid invariant; today's "orphan server" report was exactly this hazard (verified benign container peer). Keep open, no book.
- **PAN-1776 (hot-updatable delivery)** — relevant: PAN-3422's 5-specimen composer wedge needed a deploy to fix. Keep, medium.
- **PAN-1868 (cost-bleed circuit breaker)** — relevant: $236/$200/$124 single-issue spends this run; progress-aware breaking differs from the warn-only cost policy. Keep, medium.
- **PAN-1164 (live diff summaries), PAN-1951 (warm inspector session)** — no pain observed this run. Keep parked, low.

**Recommendation to operator:** PAN-1824 + PAN-1711 + PAN-3344 + PAN-3429 + PAN-3492 are five faces of ONE problem — nothing admission-controls heavy work on this host. They belong in a single order book, not five separate strikes.

Also noted: memory-governor runway is now PSI-evidenced (operator-approved), so admission deferrals from idle swap are over — that removes the false-pressure deferrals seen earlier in the run.

## RUN-79 tick 81 (2026-08-02 ~17:25Z) — quiet tick: round-3 leak PR in CI, campaign in review

- #3494 (PAN-3431 round 3) still in CI (lint + test lanes). Nothing to merge; no ready set. MIN-934 working, MIN-933 in review — campaign holds at 4 of 5 with Lane B complete.
- Status emitted this tick (rule holding). Surfaced the load-control order-book recommendation into `openQuestions` so it reaches the operator through the snapshot rather than only through chat.

## RUN-79 tick 82 (2026-08-02 ~17:45Z) — #3494 diagnosed as baseline desync, resynced (not its own defect)

- **#3494 (leak round 3) failed lint + test — diagnosed before re-driving.** Lint output was self-contradictory: `stale baseline: 1 errors but baselined at 2` AND `refusing to raise the baseline: 2 errors vs baseline 1`. That is a **frontend-types ratchet desync**, not a defect in streaming cost-log reads: the branch predates PAN-3482's baseline work, so it carries an older baseline file than main now expects. Test showed 1 failed file of 1378 — consistent with the same staleness rather than a real regression.
- **Resynced onto current main** (`49a0a59e378`) so CI re-runs against the correct baseline. Same collateral pattern as the red-main window earlier: check whether the failure belongs to the branch or to the base before sending anyone to fix it.
- Leak trajectory noted for the eventual verification: 2428MB @12m24s with 30 sessions on the CURRENT (pre-round-3) build — consistent with the attach-cost characterization, and the reference point round 3 must beat.

## RUN-79 tick 82 (2026-08-02 ~17:45Z) — #3494 diagnosed as baseline desync, resynced (not its own defect)

- **#3494 (leak round 3) failed lint + test — diagnosed before re-driving.** Lint output was self-contradictory: `stale baseline: 1 errors but baselined at 2` AND `refusing to raise the baseline: 2 errors vs baseline 1`. That is a **frontend-types ratchet desync**, not a defect in streaming cost-log reads: the branch predates PAN-3482's baseline work, so it carries an older baseline than main now expects. Test showed 1 failed file of 1378 — consistent with the same staleness.
- **Resynced onto current main** (`49a0a59e378`) so CI re-runs against the correct baseline. Same discipline as the red-main collateral sweep: establish whether a failure belongs to the branch or to the base before sending anyone to fix it.
- Leak reference for eventual verification: **2428MB @12m24s with 30 sessions** on the current (pre-round-3) build — consistent with the attach-cost characterization and the number round 3 must beat.

### RUN-79 tick 83 — 2026-08-02T19:30Z — RED MAIN on three gates; uat/pan-crow-0802 swept

**Promote sweep (uat/pan-crow-0802 → main 7ac5339817d).** Fresh read-door sweep across all 12
registered projects. Four typed blind spots unchanged (papers-please, puzzdom: tracker_unconfigured;
lexerra, krux: forge_unavailable/404) — never reconstructed from tracker/agent/tmux state.
PAN-3338 closed out clean: 8/8 DoD rows, zero overrides.

**RED MAIN — five consecutive commits, three independent gates.** Found by reading #3494's CI
rather than trusting the "resync fixed it" story from tick 82:

1. `src/cli/commands/parked.ts:100` calls `project.projectPath`; `getProjectSync` returns the
   `ProjectConfig` at `src/lib/projects.ts:307`, whose field is `path`. (A second unrelated
   `ProjectConfig` exists at `src/lib/workspace-config.ts:245` — importing that to silence the
   error would be the wrong fix.) → PAN-3503, struck.
2. Composer manifest never regenerated for `pan parked` / `pan parked ack`. → same strike.
3. Unbaselined cycle `deacon.ts > stall-sweeper.ts > service.ts`, introduced by my own PAN-3485
   stall-sweeper landing. Fails `lint:circular` on main itself, so it blocks the verification gate
   for every branch that syncs main. → PAN-3501, struck.

**Lesson — a red PR is not evidence about the PR.** Tick 82 diagnosed #3494 as a frontend-types
baseline desync and resynced it. The resync was correct but insufficient: the branch inherited
main's breakage. #3494's build/lint/test failures are RED-MAIN collateral, not the streaming
change. This is the second time this run I nearly re-drove a strike over its base's breakage.
**Check the base's CI before attributing a branch failure to the branch.**

**Leak reference point updated.** Pre-reload server: 2540MB @78min with 28 sessions, against the
prior 2428MB @12min with 30 sessions — about +1.7MB/min of steady drip. The ongoing drip is
largely solved; the residual is the one-time per-attach cost. Post-reload the fresh server sat at
1326MB at 53s uptime with the same 28 sessions, which is that front-loaded cost, visible in
isolation. Memory system-wide is healthy (31GB available, PSI ~0) — the 10s `/api/health`
responses before the reload were event-loop blocking, not memory pressure.

**Deploy.** `pan reload` reported a health-check failure at 30s but had actually succeeded — the
server was still booting. Verified after: `buildCommit` 7ac5339817d, matching main. The 30s
health timeout is too tight for a boot that attaches 28 sessions.

**PAN-3426.** Nine uncommitted files in the workspace fix all four PR #3495 CI failures; the test
role verified them locally and correctly refused to commit (outside its boundary). Resumed the
work agent — it had already picked up the same work on its own.


### RUN-82 tick 1 — 2026-08-06T19:35Z — GitHub App budget was the hidden bottleneck; 5 substrate bugs filed, 4 struck

**Main is green** (CI 31113577812 `success` on `e18aa3f16a`), live server matches (`buildCommit e18aa3f16a`), and the merge train assembled `uat/pan-flint-0806` on its own with PAN-3567 + PAN-3568 — both review+test passed, `ready_for_merge=1`, awaiting operator ship.

**The tick's real finding: the GitHub App installation bucket (144090266) is exhausted, and it is not cosmetic.** It blinded the pipeline-membership read door for lexerra and krux (`forge_unavailable`), crashed `pan review pending --ready` outright, made `pan done PAN-3559 --strike` refuse its post-merge lifecycle, and degraded DoD row 4 evidence during close-out to "forge metadata unavailable". Root cause is file:line-grade: `reconcileProjectStatePlanes` at `deacon.ts:3113` runs unconditionally every patrol and `state-plane-patrol.ts:53-61` loops **all 481 closed-out records** calling the deliberately-uncached `readLiveTrackerIssueState` (`issue-closed.ts:37-45`) — ~475-487 per-issue GETs per cycle, ~4,300-4,800/hr, the entire budget. `getInstallationAccessToken` (`github-app.ts:323-330`) also mints a token per call with no memoization, and `githubApiWithToken` (`:332-356`) sends no ETag and reads no `x-ratelimit-remaining`. The one rate-limit cooldown that exists is checked only in the branch where the App is *not* configured (`webhook-handlers.ts:246`), so **configuring the GitHub App deleted the only rate-limit-aware path**. → PAN-3582, struck.

**Lesson worth carrying: the budget was being spent proving that already-terminal issues are still terminal.** 481 closed-out records re-queried forever, every patrol, because the strict path refuses to cache. A correctness rule ("never inherit a stale close-out decision") became a quota bug the moment the record set grew. Any "always read live" rule needs a cost model attached the day it is written.

**Filed and struck this tick:**

- **PAN-3582** (struck) — the rate-limit root cause above. `blocks-main`.
- **PAN-3583** (struck) — `pan start --fresh` cannot clear a resumable session: `canStartFresh` at `work-agent-lifecycle.ts:192` is false *precisely when* `--fresh` is needed. Then `pan reset-session PAN-3512` succeeded, cleared `session.id`/`sessions.json` on disk, and `pan start` **still** refused — so all three doors refuse while the message recommends two of them. The comment at `work-agent-lifecycle.ts:124-129` already documents this exact trap; PAN-3543 fixed it only for the `handedOff` branch via `&& !handedOff`, and PAN-3512 (stopped after a `blocked` verdict) falls straight back in. A cohort exemption papered over the contradiction instead of resolving it. `blocks-main`.
- **PAN-3580** (struck) — UAT-failure relay has no convergence cap: **65 identical 161-byte rework files** in `feature-pan-3537/.overdeck/feedback/`, one every ~7 min for 12 hours, each saying "UAT failed — see the UAT panel for details" while `uat_notes` is NULL. Dedup is a process-local `Map` (`uat-failure-feedback.ts:80`). Review has PAN-3151's convergence gate; UAT has nothing.
- **PAN-3581** (struck) — DoD row 3 permanently blocks close-out for out-of-band-merged issues. PAN-3422 and PAN-3477 both fail *only* row 3 while row 6 proves 9 green check-runs on the merge commit and row 8 proves the deployed build contains it. `recordCiGreenVerificationVerdict` (`merge-strike.ts:42`) only runs inside the merge-ops door (`merge-ops.ts:1075`), and PR #3457 was merged out-of-band by gh-API. The evidence exists one row down; the gate should accept it rather than needing an operator override.
- **PAN-3584** (filed) — doctrine drift, two faces: `POST /api/flywheel/assemble-uat` 404s (the real route is `/api/merge-train/assemble`, `merge-train.ts:344`, and the train self-assembles anyway), and the brief's "the flywheel owns strike merges, land via gh-API then `pan done --strike`" directly contradicts the strike agent's own prompt ("The Deacon owns landing … Do NOT call `pan done <id> --strike`").

**PAN-3559 / PAN-3562 unstuck after ~34 hours.** Both strike fixes were merged into `main` on 2026-08-05 by a prior orchestrator following the brief (`Merge branch 'strike/pan-3559' into main` + local push), but `review_status` stayed `pending` with `strike_ready_head` and `strike_landing_state` NULL — and the Deacon's landing door refuses when `readyForMerge` is false, so nothing could ever pick them up. Ran `pan done --strike` on both, then closed out clean. This is the observable cost of the PAN-3584 ownership contradiction, not a one-off.

**Also landed:** MIN-918 closed out (Linear label step degraded non-fatally on Linear's own 2500/hr limit — that path *does* have a circuit breaker, `close-issue.ts:315-362`, which is exactly the pattern GitHub lacks). PAN-3572 closed as not-planned: `strike-pan-3572` self-aborted having found no regression, `strike/pan-3572` carries 0 unique commits, and main CI green on `e18aa3f16a` independently confirms the typecheck ratchet is intact.

**Open for the operator (non-blocking):** an unpushed commit sits on local `main` — `e9265ceeed fix(dashboard): send CSRF header on project rename` by `panopticon-agent[bot]`, authored 2026-08-06 15:13 EDT. It is not on `origin/main`, not in CI, and not in the deployed build, so the fix is inert and loss-prone. Not mine to push. Separately, mind-your-now carries **7 `zombie_pr` rows** (MIN-172, 572, 576, 596, 620, 622, 632 — closed issues with still-open PRs) that need a residue disposition, which is an operator-only flag.

**Fleet:** 4 strikes running (3580, 3581, 3582, 3583) + 2 work agents (3567, 3568) finishing at merge-ready. Six agents against a ceiling of 20, min 2 — saturated above target. `auto_pickup_backlog` is OFF and `pan backlog forecast` reports 0 ready / 0 released / 0 needsPlanning, so the Planning floor has nothing to plan; the awaiting-release queue is empty by the operator's own gate, not by neglect.

### RUN-82 tick 2 — 2026-08-06T20:10Z — CI has been dead repo-wide for two hours and nothing noticed

**The headline finding: GitHub Actions stopped creating workflow runs for eltmon/overdeck at 2026-08-06T17:56:39Z.** Not the CI workflow — *every* workflow, on *every* event type. `gh api repos/eltmon/overdeck/actions/runs` shows nothing newer, and `?status=queued` / `?status=waiting` both return 0. In the two hours since, PRs #3577 and #3578 merged, a UAT batch was promoted to `main`, three commits landed there, and strike PR #3585 was opened — none produced a run, none is queued. Ruled out by direct query: workflow disabled (`state: active`), Actions disabled (`{"enabled":true}`), trigger filters (`ci.yml:3-7` is unfiltered, and two other workflows with different triggers are equally silent), and a promote-path credential quirk (it affects `pull_request` events too). The remaining candidate that matches "runs stop being created at all, silently, repo-wide, nothing queued" is an **Actions spending limit** — confirming it needs a `user`-scoped token this session doesn't have, and fixing it is an operator billing action. → PAN-3586, struck, and surfaced to the operator.

**How I found it, and why that is the real lesson.** I did not find it by a monitor firing. I found it by hand-comparing check-runs across `main` commits while auditing why close-out reported `no merge commit resolvable`. **Nothing in Overdeck noticed a two-hour, repo-wide CI outage** — and worse, the one gate designed to catch exactly this actively certified against it: **DoD row 6 accepts *any* successful check-run**, so PAN-3567 and PAN-3568 both closed out today reporting `1 check-runs concluded successfully` where that one run was the *Mintlify docs deploy*. A commit with zero CI reads identical to a commit with 9/9 green. That is the most dangerous shape a gate can take — it is most confident precisely when it is most wrong. Filed as a comment on PAN-3586 with the required-checks fix.

**Carry this: a health check that counts is not a health check.** Row 6 asked "are there successful check-runs?" instead of "did the required checks run and pass?" The absent-vs-passing distinction is the entire content of the assertion, and counting erases it.

**PAN-3582 escalated with logged proof of second-order damage.** The deacon patrol is now emitting `startDeacon: patrol interval skipped — previous patrol still in flight` on **every single 60-second tick, continuously**. The 481 sequential per-issue GETs stretch one patrol past its own interval, so `reconcileAgentLiveness` and every other patrol-borne duty runs at ~7–8 minute spacing against a 60-second design — an 8x mean-time-to-detect regression across the whole deacon. This also reframes the fix: a rate-limit circuit breaker would protect the quota and leave the patrol just as slow, so batching or caching `state-plane-patrol.ts:53-61` is the only fix that repairs both.

**Filed this tick:** PAN-3586 (CI outage + row-6 counting bug, `blocks-main`, struck) and PAN-3587 (`agent-pan-3568` sits `running` in the registry with zero tmux sessions through five `reconcileAgentLiveness` passes; `orphanCandidates` at `deacon-auto-resume.ts:955` selects it and `handleAgentHeartbeatDeadEvent` declines to act, blocking PAN-3568's close-out on DoD row 5 and holding a concurrency slot — the briefing reported 8 running agents against 5 real tmux sessions).

**Strike outcomes.** PAN-3581 landed its fix cleanly: full typecheck + lint + test passed, `strike/pan-3581` pushed, `strike-ready` recorded, PR #3585 open and MERGEABLE, and the Deacon claimed it at 19:57:57Z. **PAN-3580's strike aborted, correctly** — it judged the UAT convergence gate broader than a precision fix (durable UAT-cycle state model, schema migration, convergence evaluation in status reconciliation, persistent delivery identity across the write/recovery doors) and recorded that rationale on the issue without touching code. That is the strike contract working as designed; push-back is input, not a stop, so I routed it to `pan plan PAN-3580 --auto`. PAN-3582, PAN-3583 and PAN-3586 still working.

**PAN-3567 closed out clean** (though its row 6 was certified by the docs deploy — see above). **PAN-3568's close-out is blocked** on the stale `running` row, and I left `--accept-post-merge` alone: the override is the operator's lever and PAN-3587 is the machinery fix.

**Resolved from tick 1:** the "unpushed commit on main" (`e9265ceeed`) is no longer stranded — the UAT promotion carried it to `origin/main` at 19:19Z. Worth noting it reached `main` without ever being CI-verified, like everything else since 17:56Z.

### RUN-82 tick 3 — 2026-08-06T20:35Z — the file→strike→land→deploy→unstick loop closed in 60 minutes; CI still dark

**PAN-3581 went from "filed" to "cleared two stuck issues" inside one hour.** Filed 19:35 → struck → strike passed full gates and pushed → Deacon landed it as `d20c97c49c fix(lifecycle): accept main CI for missing verification (#3585)` at 20:06 → I deployed main with `pan reload --health-timeout 180000` (build `d20c97c49c97`, healthy, pid 1508279 on :3011) → **PAN-3422 and PAN-3477 both closed out clean with zero operator overrides.** Row 3 now reads `verificationStatus: missing; verification satisfied by green main CI after landing` → PASS. Both had been un-closable for five days. This is the doctrine's "the machinery fix that dissolves the override is YOURS" working end to end, and it is worth noting the deploy was the load-bearing step: the fix sat inert on `main` for 20 minutes and only cleared anything once the running server was rebuilt onto it.

**Also closed out: PAN-3581 itself, and PAN-3568** — the latter had been blocked on the stale `running` registry row, which the `pan reload` restart cleared as a side effect. That sharpened PAN-3587 considerably: **boot reconciliation transitions the row correctly while `reconcileAgentLiveness` declined to touch it across five passes over ~30 minutes.** Same table, same tmux socket, so the divergence is inside `handleAgentHeartbeatDeadEvent`, not in the data. Posted to the issue, with the note that the bug is invisible until a restart and a restart is what makes it vanish — so it will never reproduce for anyone who reaches for a restart first.

**CI is still dark — now ~2.5 hours.** No workflow run of any kind since 2026-08-06T17:56:39Z, nothing queued, nothing in progress. Unchanged from tick 2, and still the operator's to fix.

**The row-6 counting bug got its third and most damning data point, and its own issue.** PAN-3581's close-out passed row 6 with `1 check-runs concluded successfully on d20c97c49c97…` — and `d20c97c49c` is `main`'s current tip, whose only check-run is `Mintlify Deployment`. So the gate certified "merged commit verified on main" for a commit that provably never ran CI, on the very issue whose subject was verification evidence. Split out as PAN-3589 and struck, with the decisive regression test named: *a commit carrying only `Mintlify Deployment` must produce MISS*. PAN-3586 stays as the CI-outage tracker (operator billing + `workflow_dispatch`).

**Carry this: when a gate can't tell absence from success, its failure mode is silent certification, not a red light.** Three close-outs today were certified by a docs deploy. Nothing looked wrong — the message even reads plausibly ("1 check-runs concluded successfully"). A count is not a check.

**Strike outcomes this tick.** PAN-3586's strike self-aborted at 20:00:59Z — *before* my 20:04 correction landed — on the original promote-path hypothesis, correctly judging credential-identity archaeology too broad for a precision fix. Since the corrected diagnosis makes the tractable half small and unambiguous, I split it rather than re-striking a mixed issue. PAN-3582's landing **failed on a stale strike signal**: recorded head `c83f7c99` vs `origin/strike/pan-3582` at `86ac1506`, so the agent pushed after recording readiness. It is in the recovery ladder at 1/3 and self-heals by design — no intervention. PAN-3583 sits `strike_landing_state: ready` awaiting the Deacon, which is running on ~8-minute starved cycles (PAN-3582) and was just restarted.

**Fleet:** strikes on 3582 (recovering), 3583 (ready to land), 3589 (new), plus planning on 3580. Six sessions, ceiling 20.

### RUN-82 tick 4 — 2026-08-06T20:55Z — I was wrong about the CI outage; retracted the billing escalation

**Correction first, because I sent the operator down a wrong path.** Ticks 2 and 3 reported "GitHub Actions stopped creating runs repo-wide" and escalated a billing check. That was wrong. At 20:36Z `pull_request` runs appeared and **ran to completion** — a spending limit would suppress both event types. The real signal is narrower and I could have found it in tick 2 by querying `?event=push` instead of the unfiltered run list: **zero `push`-event runs since 2026-08-06T14:58:51Z**, across all three push-triggered workflows, while `pull_request` works fine. Five commits have landed on `main` in that window (`e9265ceeed`, `2ad258fb7f`, `e3983d9248`, `d20c97c49c`, `8a9ad3e7b7`), every one of them via the Deacon merge door or the UAT promote worktree, and none produced a run.

**The methodological failure is the lesson: I sampled the unfiltered run list, saw silence, and generalized to "all events".** The window simply contained no PR activity. A filtered query would have separated the two populations immediately and pointed straight at the pusher identity. When a signal is "nothing is happening", the first move is to check whether the sample could show the thing at all — absence in an unfiltered list is not absence in every subset. Retracted on the issue, title re-scoped to the push path, and the credential comparison named as the next step (`overdeck-agent[bot]` performed the last triggering push; every silent one came from the merge/promote doors).

**PAN-3583 landed, deployed, and immediately unstuck PAN-3512 — the second fix this run to close that loop.** `8a9ad3e7b7 fix(agents): honor fresh session reset intent (PAN-3583) (#3590)` merged, `pan reload` deployed it (build `8a9ad3e7b76f`, healthy, pid 1733976), and `pan start PAN-3512 --fresh` sailed past the resumable-session refusal that had made the issue unrecoverable. Closed out clean.

**But PAN-3512 then hit a second, sharper deadlock — filed as PAN-3591.** Its workspace Docker stack is unhealthy because `init` exits 1, and `docker logs` shows why: `[PARSE_ERROR] await is only allowed within async functions — routes/specialists/legacy-routes.ts:259:30`. That parse error **is** blocking review finding #2 on PAN-3512. So the spawn gate refuses to start the only agent that can repair the compile error, because the branch does not compile — and burns a 1/3 rebuild ladder (~20 minutes of container churn) that cannot possibly succeed before refusing. The gate is strictest exactly when the branch is most broken, which is exactly when the agent is most needed. `--host --yes` unblocked it (note the refusal advises `--host` alone, which fails for a non-interactive caller — its own guidance is not executable as printed). Agent restarted with 12 checklist items.

**Filed PAN-3593 — two paths that equate "process alive" with "agent able to act".** PAN-3582's strike-landing recovery was delivered to *monitor mail* for a live idle session (`messageAgent delivered via monitor mail (caller: deacon-strike-landing)` at 20:14:15Z); monitor mail replays at respawn, so an agent that never respawns never reads it. The ladder recorded `strikeLandingState: recovering` against a message nobody received — worse than a failed delivery, because it suppresses escalation — and the agent sat frozen for 40 minutes (`cost $3.4278`, `ctx 41%`, identical across two ticks). Separately, `pan strike PAN-3586` refuses with "already running" for a strike that self-aborted at 20:00:59Z and returned to its prompt: PAN-3150 handled the strike that *exited*, not the strike that *aborted and stayed alive*, and `pan tell` is closed to me, so a ready-to-work issue was stranded. `pan recover PAN-3582` is the sanctioned door and cleared the first one.

**Also this tick:** PAN-3589 struck (row-6 required-checks), and its evidence grew a fourth instance — PAN-3583's own close-out passed row 6 on `1 check-runs` where that run is the Mintlify deploy. PAN-3580's planning **completed**: a 47KB xBRIEF is on the state branch and it now waits on operator release, which is `auto_pickup_backlog: false` working as designed rather than a stall.

**Scoreboard:** PAN-3581 and PAN-3583 landed, deployed, and closed out; PAN-3422, PAN-3477, PAN-3567, PAN-3568 closed out behind them. Six close-outs this run, zero operator overrides used.

### RUN-82 tick 5 — 2026-08-06T21:20Z — third fix landed; PAN-3582's hour-long stall traced to a rebase-after-signal

**PAN-3589 landed and deployed** — `d921b8cec5 fix(lifecycle): require named main CI checks (#3592)`, live as build `d921b8cec556`. Third substrate fix this run to go file → strike → land → deploy. Closed out.

**Immediately instructive: the new row-6 gate could not exercise itself, because PAN-3582 is still unlanded.** PAN-3589's own close-out reported row 4 as `forge metadata unavailable: GitHub App PR lookup failed … 403` and row 6 as `no merge commit resolvable` → SKIP. The App rate-limit exhaustion prevents resolving the merge commit at all, so the hardened required-checks check degrades to a skip rather than a MISS. **PAN-3582 is the keystone: until it lands, it degrades the membership read door, DoD rows 4 and 6, and the deacon's whole patrol cadence.**

**Traced PAN-3582's hour-long stall to an exact sequence, and it changes the recommended fix.** `origin/strike/pan-3582` is `86ac15064f`, sitting directly on `d20c97c49c` (PAN-3581's merge, 20:06Z). The recorded signal was `c83f7c9986`, and `git merge-base --is-ancestor c83f7c9986 origin/strike/pan-3582` says **not an ancestor** — the branch was rebased onto the newer main and force-pushed *after* readiness was signalled. `strike-ready.ts:65-70` is blameless: it fetches, refuses when local and remote heads differ, and records the remote head, so it recorded the truth at the moment it ran. The signal went stale underneath itself.

Everything after that is the real defect. The landing door correctly rejected the stale signal; the recovery message went to monitor mail for a live idle agent; the agent had already reported `pan strike-ready succeeded` and believed itself done; and **`pan recover PAN-3582` respawned the session without the agent acting on the queued instruction** — pane counters frozen at `cost $3.4278`, `ctx 41%` across three ticks spanning an hour. Three independent delivery mechanisms all failed to reach an agent that was sitting right there at its prompt.

**What cleared it: running `pan strike-ready PAN-3582` from the strike worktree myself**, which re-derived the head (`ready at 86ac15064f`) and reset `strikeLandingState: ready`, `strikeRecoveryCount: 0`. Posted to PAN-3593 with the recommendation that follows from it: **when a landing rejects on a stale signal, re-derive readiness from the branch rather than asking the agent to re-signal.** Every input is already on disk — branch pushed, gates passed, CI run — so routing it through an agent who has declared itself finished adds a hop that can only fail. A rebase-after-signal is also not an edge case: it is exactly what `pan sync-main` produces whenever main moves between signalling and the next patrol, and the patrol is on ~8-minute cycles because of PAN-3582 itself.

**Carry this: when three delivery paths fail to move an agent, stop improving delivery.** The queued-mail fix, the recover command, and the retry ladder are all attempts to push information *into* an agent that has no reason to act on it. The state the system needed was sitting in git the whole time.

**PAN-3512 is genuinely reworking** — 23m30s of work, 52.1k tokens, `+619/-30`, cost $16.02 on PR #3514. The fresh restart (enabled by PAN-3583) plus the `--host --yes` stack override (PAN-3591) put it back to productive work after three days stalled.

**Push-event CI still absent** — last push run remains 14:58:51Z. Unchanged; PAN-3586 still needs its credential comparison and is stranded behind the un-redispatchable idle strike (PAN-3593 manifestation 2).

### RUN-82 tick 6 — 2026-08-06T21:45Z — the keystone landed, and the gate I hardened three ticks ago caught its first real failure

**PAN-3582 landed and deployed** — `cc366a3a97 fix(deacon): throttle state-plane reconciliation (#3588)`, live as build `cc366a3a97fa`. The closed-out-record reconciliation now runs at most hourly instead of every patrol, with the cadence regression-tested. Fourth substrate fix this run through file → strike → land → deploy.

**The deploy gate refused me once, correctly, and I did not force it.** `pan reload` returned *"Deployment deferred because the post-merge lifecycle is pending"* — `~/.overdeck/pending-post-merge.json` existed for PAN-3582 (`deploy-window.ts:59-61`). The message explicitly says not to retry or `--force`. I waited, confirmed the claim file was picked up (`.claimed-2054952-…`) and then gone, and deployed cleanly on the next attempt. Worth recording as the counter-example to the "I am the deployer" authority: standing authority is not permission to override a gate that is actively protecting an operation.

**PAN-3589's row-6 hardening proved itself on its first real case — and the result is that close-out is now blocked.** PAN-3582's close-out:

```
6  main-verify  missing required checks on cc366a3a97…: test, lint, build (22), guard;
                no later default-branch commit contains the merge          MISS
```

Three ticks ago that same commit would have read `1 check-runs concluded successfully` and passed, certified by the Mintlify docs deploy. The gate is now correct, and correctness means **every close-out is blocked until push-event CI runs on `main` again**. PAN-3582 is merged, deployed, working, and un-closable. I deliberately did not reach for `--accept-main-verify`: the gate is right, the evidence genuinely does not exist, and an override would record a verification that never happened.

That moves PAN-3586 from "verification hygiene" to "the close-out gate is stopped", and it is stranded behind the un-redispatchable idle strike (PAN-3593), so I routed it to `pan plan --auto` for the normal pipeline. Push-event runs remain absent since 14:58:51Z; six commits now sit on `main` with no CI.

**Carry this: hardening a gate converts silent wrongness into visible blockage, and that is the point.** For three ticks the pipeline was certifying unverified commits and everything looked fine. Now nothing closes out and the reason is named on screen. The blockage is not a regression from the fix — it is the outage finally becoming legible.

**Filed PAN-3594 — 84,574 false ERROR lines.** The deacon logs `Migrated checkout has recreated state paths (stray writer)` for four projects on every patrol, forever. Every path it names is stale: lexerra's and tindra's `.pan/{records,continues,specs}` are **completely empty**, and the only two real files (`overdeck/.pan/records/pan-714.json`, `myn/.pan/drafts/min-879.md`) date to 2026-07-14 and 2026-07-18. There is no stray writer. The detector asks "does this path exist?" while claiming "something is writing here", and after migration the leftovers are guaranteed to exist. The cost is not the noise itself: **it is the loudest thing in the deacon log and it is false**, which teaches every reader that deacon errors are background — precisely the wrong lesson in a run where two real defects surfaced as a single quiet log line each.

**PAN-3512 is genuinely productive** — committed `82a90d8518`, pushed to `feature/pan-3512`, all xBRIEF items complete, now fixing a stale manifest entry in `head-anchor-write-sites.test.ts` surfaced by the full suite. The long "Roosting" turn was a full test run, not a stall — worth checking before calling a quiet agent stuck.

**Also noted, not yet acted on:** local `main` is ahead 5 / behind 4 of origin. The 5 are my own FLYWHEEL-STATE commits, which the agent main-push guard correctly refuses to let me push (only `conv-` identities are exempt). They are committed and safe, just local.

### RUN-82 tick 7 — 2026-08-06T22:00Z — PAN-3582 verified live, and it revealed that two "blind spots" were never blind spots

**Verified the keystone fix by measurement, not by assumption.** Build `cc366a3a97fa` deployed at 21:37Z; measured 20 minutes later:

- **Rate-limit exhaustion is over.** The last `API rate limit exceeded for installation ID 144090266` in the deacon log is **21:22:06Z — before the deploy**, nothing since. `pan review pending --ready`, which had been crashing with `Pipeline membership lens gather failed for all projects`, now runs clean.
- **Patrol cadence roughly doubled**: `reconcileAgentLiveness` passes at 21:43:49 → 21:47:09 → 21:50:26 → 21:53:06 → 21:56:32, ~3.3 minutes apart against 7–8 before. Still short of the 60-second design and `patrol interval skipped` still fires, so a secondary term remains — the GitHub-heavy `reconcileFalseMerged` and `reconcileClosedPrReadyForMerge` reconcilers are the obvious next candidates. The dominant term is gone.

**The real payoff was an error I had been repeating for six ticks.** With the budget restored, lexerra and krux stopped returning 403 and started returning the truth: `404 Not Found — GitHub App not configured for this repository or repository inaccessible`. The App is simply **not installed on `eltmon/lexerra` or `eltmon/krux`**. Their membership has been unavailable for a configuration reason the whole time, and the rate-limit 403 was masking it. I reported both as rate-limit casualties in every status snapshot from tick 1 onward.

**Carry this: a loud failure upstream can impersonate every failure downstream.** Once the App was exhausted, *every* GitHub read returned 403, so every project looked like the same problem. The rule is that a blanket failure mode should lower confidence in any per-target diagnosis made while it is active — I should have marked those two "unknown behind the rate limit" rather than "rate-limit blind spot". Fixing the loud thing is also the cheapest way to find out what it was hiding.

**PAN-3512 reached review.** It handed off and `agent-pan-3512-review` spawned at 21:30Z — an issue that was dead for three days is now in the review convoy, having gone through PAN-3583's `--fresh` fix and PAN-3591's `--host --yes` stack override to get there. Final work state: `+658/-37`, cost $20.33.

**PAN-3586 planning completed** — a 35KB xBRIEF is on the state branch alongside its draft. It now waits on operator release like PAN-3580, which is `auto_pickup_backlog=false` behaving as designed. Both planned issues in the awaiting-release queue are substrate fixes that unblock other work, which is the Planning floor doing exactly its job.

**Unchanged:** push-event CI still silent since 14:58:51Z, so PAN-3582's own close-out remains blocked on DoD row 6 with `missing required checks … test, lint, build (22), guard`. Still not overriding it.

### RUN-82 tick 8 — 2026-08-06T22:20Z — push CI returned, PAN-3582 closed out, PAN-3512 converging 12 → 1

**Push-event CI resumed at 22:00:44Z after 7 hours dark.** All nine checks green on `cc366a3a97` (main's tip): test, lint, build (22), guard, reject-planning-paths, smoke test, trailer gate, flake lane. Main is genuinely verified again for the first time since 14:58Z.

**PAN-3582 closed out clean, and the row-6 gate certified it on real evidence this time:**

```
6  main-verify  required checks concluded successfully on cc366a3a97…: test, lint, build (22), guard   PASS
```

Two ticks ago the same row read `missing required checks … test, lint, build (22), guard` and blocked. The gate said MISS while evidence was absent and PASS once it existed — which is the whole point of PAN-3589, demonstrated end to end on the same commit. Full loop closed on the keystone: filed 19:35 → struck → landed → deployed → verified by measurement → closed out.

**Kept PAN-3586 open despite the symptom clearing, and the timing is why.** `cc366a3a` was pushed at **21:30:43Z** and produced no run; the run appeared on that same SHA at **22:00:44Z**, thirty minutes later. A push event does not arrive half an hour late, so something *re-triggered* it — a manual re-run, a backlog drain, a credential change — and none of that is visible from here. I have already been wrong about this issue twice (first the promote path, then a billing escalation drawn from an unfiltered sample); a third reading based on "it works now" would be the same error wearing friendlier clothes.

**Carry this: "the symptom stopped" is the weakest possible evidence that a fault is fixed, and it is most tempting exactly when you are tired of the issue.** The remaining xBRIEF work stands on its own merits regardless of cause — identify the push credential, add `workflow_dispatch`, and raise a needs-you when a merge to `main` produces no CI run. That last item is what turns a 7-hour invisible outage into a 5-minute one.

**PAN-3512 is converging hard: 12 blocking findings at cycle 2, 1 at cycle 4.** Latest verdict is CHANGES REQUESTED on a single correctness finding — historical test status bypasses re-gating when the current row is pending, `review-verdict-writer.ts:230`. The agent is actively reworking (cost $20.33 → $27.08, diff +658/-37 → +699/-39). The PAN-3151 convergence gate correctly leaves it alone: the series is monotonically decreasing, so this is a healthy rework loop, not a stall. Stating it the way the doctrine requires: **blocked, 1 finding, converging.**

**Both planned substrate fixes remain unreleased** — PAN-3580 and PAN-3586 carry `planned` but not `released`. The awaiting-release queue is doing its job; the operator's gate is the only thing between them and work.

### RUN-82 tick 9 — 2026-08-06T22:40Z — PAN-3512 converged to merge-ready; found that my own Planning floor has been dead all run

**PAN-3512 passed review and test — `ready_for_merge: 1`.** The convergence series is 12 blocking findings (cycle 2) → 1 (cycle 4) → 0 (cycle 5). An issue that was dead for three days, unrecoverable by any CLI door, is merge-ready. It got there through two fixes this run found and landed — PAN-3583's `--fresh` gate and PAN-3591's `--host --yes` stack override — which is the compounding the metabolism is supposed to produce. The merge train assembled it into `uat/pan-flint-0806` (status `ready`) on its own; it awaits the operator's ship.

**Then I checked something I should have checked at tick 1.** `pan backlog forecast` reports `total: 656`, `planned: 29`, and **zero for every label-derived counter** — `ready`, `released`, `parked`, `vetoed`, `objection`, `blocksMain`, `needsRelease`, `needsPlanning`, `inFlight`, all 0. Every one of those zeros is falsifiable from this tick's own data: PAN-3586 carries `blocks-main`; PAN-3586 and PAN-3580 are both `planned` without `released`; PAN-3512 is in-flight and queued for merge.

The mechanism is **documented in a code comment that names the bug** — `src/lib/backlog/lookups.ts:19-22` warns that a CLI caller which does not pass `opts.labels` "would silently classify every issue as label-less, making ready/released/parked/objection/vetoed/blocksMain all false (the `pan backlog forecast` undercount bug)". The CLI path doesn't pass them, the dashboard-singleton `require` at `:27` throws in a CLI process, and `catch { /* issue service not ready — treat as no labels */ }` at `:37` swallows it. `planned: 29` survives because it comes from spec files on disk, which is precisely why the output reads plausible rather than broken. Filed as PAN-3595 and struck.

**The damning part is what it cost me.** The Planning floor exists so the awaiting-release queue stays deep; it reads `needsPlanning[]` from this command every tick. With that array permanently empty I planned nothing from the backlog for **eight consecutive ticks** and recorded "the Planning floor has nothing to plan, the queue is empty by the operator's gate, not by neglect" in the tick-1 state entry. That was wrong, and the tool told me so in a shape I accepted.

**Carry this — the doctrine already had the rule and I applied it to the wrong things.** `roles/flywheel.md` says an errored or timed-out query is *unknown*, not zero. I applied that rigorously to `pan task next` and to the membership read door's typed blind spots, and then took an all-zeros forecast at face value for eight ticks because it *returned successfully*. A swallowed exception is the more dangerous case exactly because there is no error to notice: the rule needs extending from "errors are unknown" to "a successful result whose shape is suspicious is also unknown". `total: 656` with `blocksMain: 0` is arithmetically possible and practically absurd, and that contradiction was on screen every tick.

Two things follow. Any all-zeros classification beside a non-zero total should be unprintable — the tool must say `labels: unavailable` or exit non-zero. And I should treat the Planning floor as unverified until PAN-3595 lands, rather than assuming the queue is genuinely empty.

**Unchanged:** PAN-3580 and PAN-3586 still carry `planned` without `released`. Main is green on `cc366a3a97` with all nine checks.

### RUN-82 tick 10 — 2026-08-06T22:58Z — quiet tick spent on the measurement gap that hid PAN-3582

Nothing landed this tick. PAN-3595's strike is at "verify and hand off" (+100/-83, cost $3.74), PAN-3512 sits in `uat/pan-flint-0806` awaiting the operator's ship, and PAN-3580 and PAN-3586 still carry `planned` without `released`. Main is green on `cc366a3a97`.

**Used the quiet to close a gap this run kept paying for: the deacon patrol has no per-step timing.** Filed PAN-3596. The patrol is the system's central scheduler — liveness reconciliation, auto-resume, merge-blocker reconciliation and Docker teardown all ride inside it — and when it overruns, the only signal is one unattributed line: `patrol interval skipped — previous patrol still in flight`.

That cost this run twice. **Finding PAN-3582 took source reading, not telemetry** — I read `deacon.ts` and `state-plane-patrol.ts` and counted 403s in a log; the 481-GET loop had emitted 58,708 rate-limit errors before anything surfaced it, and what finally did was an unrelated symptom (a crashing `pan review pending`). **Verifying the fix is now only half-possible**: cycle starts went from 5–8 minutes apart to 3–4 (49755 at 22:44:48 → 49758 at 22:54:48), which is real improvement and still 3–4× the 60-second design. I can state a residual exists and cannot say what it is. The candidates from the earlier audit — `reconcileFalseMerged`, `reconcileClosedPrReadyForMerge`, `reconcileTestStatusFromGreenCi`, `reconcileAndCheckIfMerged` — are all plausible, and picking between them would be guessing, which the doctrine rightly forbids as a basis for a strike.

**Carry this: a scheduler whose own latency is unobservable will keep acquiring slow steps, because adding one has no visible cost until something else breaks loudly.** Every patrol-borne duty degrades in proportion to the overrun, and the dashboard shows a healthy deacon either way. The filing is deliberately observability-only — time each step, warn when one exceeds a fraction of the interval, and put the top three durations into the skip line so the message diagnoses itself. The next `reconcileProjectStatePlanes` should be found in one cycle by a log line rather than in months by a rate-limit outage.

This is the same shape as PAN-3595 from last tick and PAN-3594 two ticks before: **three of the last four filings are about the system's ability to see itself**, not about behaviour. A false ERROR that drowns the log, a query that reports failure as zero, and a scheduler with no timings — none of them break anything directly, and all three actively hid real defects from me during this run.

### RUN-82 tick 11 — 2026-08-06T23:20Z — PAN-3595 landed; I corrected my own overstatement; push CI recurred

**PAN-3595 landed and deployed** — `947a58f060 fix(backlog): require CLI label retrieval (#3597)`, live as build `947a58f060cc`. Fifth substrate fix this run through file → strike → land → deploy.

**Verified it, and the verification corrected me.** `parked` went **0 → 8**, positive proof the CLI label path is genuinely fixed. But `needsPlanning` and `needsRelease` stayed 0 — and reading the counter conditions at `pickup.ts:306-308`, both require the `ready` label, and `gh issue list --state open --label ready` returns **zero issues**. So those zeros were correct before the fix and are correct after it: the Planning floor is empty because the operator's Definition-of-Ready gate is empty, which is the gate working.

**My tick-9 claim that this bug "silently disabled the Planning floor for eight ticks" was wrong**, and I posted the correction to the issue rather than leaving it in the record. The label bug was real; the consequence I attached to it was not. Even with labels loading perfectly, the floor would have had nothing to plan.

**Carry this, because it is the second time this run: I inferred a downstream consequence from an upstream defect without checking whether the downstream thing was independently gated.** First with the CI outage — I found no runs in an unfiltered sample and escalated a billing check, when `pull_request` runs were fine and the fault was push-specific. Now with the forecast — I found broken labels and blamed the empty Planning floor, when the floor was empty for an unrelated operator reason. Both times the upstream defect was real and my impact claim was invented. The discipline: **after establishing that X is broken, separately establish that Y actually depended on X**, rather than reasoning that it must have.

**Push-event CI recurred, which settles tick 8's open question.** `947a58f060` merged at 23:04:09Z and produced **no push run** — the 22:00:44Z run on `cc366a3a` remains the only one since 14:58Z. So the fault is intermittent, not resolved: one run appeared, then silence again for the very next merge an hour later. Declining to close PAN-3586 on "it started working again" was right.

**The encouraging half: PAN-3589's hardened row 6 caught the recurrence within minutes**, blocking PAN-3595's close-out with `missing required checks on 947a58f060cc…: test, lint, build (22), guard`. Before that fix this would have been invisible — the commit carries a Mintlify check and the old counting logic would have passed it as verified. What remains missing is the proactive half: nothing raises a needs-you when a merge lands without CI, so you only discover it when someone tries to close out.

**Two fixes now sit merged, deployed, working and un-closable** behind PAN-3586 — PAN-3595 and, earlier, the pattern that PAN-3582 escaped only because CI happened to fire once at 22:00. Still not using `--accept-main-verify`.

### RUN-82 tick 12 — 2026-08-06T23:38Z — push CI is not absent, it is ~25 minutes late, and that explains the "7-hour outage"

**A push run did fire for `947a58f060` — I called it absent last tick because I checked too early.**

| commit | pushed to main | push run created | delay |
| --- | --- | --- | --- |
| `cc366a3a` | 21:30:43Z | 22:00:44Z | 30 min |
| `947a58f060` | 23:04:09Z | 23:27:43Z | 23.5 min |

**This reframes the whole issue and explains the outage I reported at tick 2.** Between 19:13Z and 21:30Z five commits landed on `main` in rapid succession (`e9265ceeed`, `2ad258fb7f`, `e3983d9248`, `d20c97c49c`, `8a9ad3e7b7`). Each was superseded by the next well inside the ~25-minute window, so none ever got a run — only `cc366a3a`, which sat as the tip long enough. What looked like a total outage was **a burst of merges outpacing a slow run-creation path**.

**That is three wrong readings of the same issue: the promote path, then a billing limit, now "intermittent absence".** Every one came from a snapshot too small for the timescale involved. Tick 2 sampled an unfiltered run list containing no PR activity; tick 11 checked for a push run minutes after a merge whose run takes half an hour. The rule I keep rediscovering the hard way: **size the observation window to the phenomenon before drawing a conclusion, and when the answer is "nothing is there", first ask whether the sample could have shown it.** RUN-79 learned this same lesson about a GC sawtooth and wrote it down; I did not carry it across.

The corrected picture changes the fix, and I posted all three points to the issue. Proactive detection must wait out a configured window (~45 min) and report "no run yet after N minutes" rather than "no run", or it false-positives on every merge. The **superseded-commit case is the real defect** and is worse than the delay: in a busy merge window `main` accumulates commits that will never be verified individually. And `workflow_dispatch` becomes *more* valuable, since it is the only way to verify a commit that lost its window.

**CI on `947a58f060` is nearly green** — lint, build (22), guard, smoke test, trailer gate and flake lane all success, `test` still running. PAN-3595's close-out should clear row 6 next tick without an override.

**Unchanged:** PAN-3580 and PAN-3586 still carry `planned` without `released`; PAN-3512 waits in `uat/pan-flint-0806` for the operator's ship.

### RUN-82 tick 13 — 2026-08-06T23:50Z — PAN-3595 closed out with no override; re-saturated the idle fleet

**PAN-3595 closed out clean.** Row 6 passed on real evidence:

```
6  main-verify  required checks concluded successfully on 947a58f060cc…: test, lint, build (22), guard   PASS
```

That is the delayed-CI model from tick 12 confirmed end to end: the block was **transient and resolved by waiting**, not by an override. Two ticks ago the same row read MISS on the same commit. Holding out against `--accept-main-verify` cost one tick of patience and preserved a real verification record — worth remembering next time a gate blocks something I am confident about, because "I know this is fine" is exactly the feeling that makes an override tempting.

**Sixth substrate fix landed, deployed and closed out this run** (PAN-3581, PAN-3583, PAN-3589, PAN-3582, PAN-3595, plus PAN-3512 carried to merge-ready).

**Re-saturated an idle fleet.** With PAN-3512 awaiting the operator's UAT ship and both planned issues awaiting release, no work agent was running against a `minAgents` target of 2 — and a tick that only ranks suggestions is a failed tick. Struck the two highest-value filings from the backlog of my own findings:

- **PAN-3593** — the idle-at-prompt agent problem. Chosen first because it is not merely filed, it is *actively blocking*: the self-aborted PAN-3586 strike still occupies its slot, which is why that issue had to be routed through planning instead of re-struck. A pipeline blocker in the live sense, not the label sense.
- **PAN-3594** — the 84,574 false `stray writer` ERRORs. Cheap to fix, and the payoff is that deacon errors become meaningful again. This run found two real defects whose entire visible signal was one quiet log line each, while the loudest thing in that log was false.

**Carry this: when the fleet idles behind operator gates, the right move is to work the substrate backlog I generated, not to report an empty queue.** Eleven issues filed this run and six landed; the remaining five are all real, diagnosed to `file:line`, and none needs an operator decision to start. An idle fleet with a full findings list is a scheduling failure, not a quiet period.

**Unchanged:** PAN-3580 and PAN-3586 still carry `planned` without `released`; PAN-3512 still waits in `uat/pan-flint-0806`.

### RUN-82 tick 14 — 2026-08-07T00:20Z — quiet tick; three strikes in flight, fleet above target

Nothing landed. PAN-3593 reached `strike_landing_state: ready` (+50/-11) and awaits the Deacon; PAN-3594 is still working (+287/-61). Main unchanged at `947a58f060`, green. PAN-3580 and PAN-3586 still carry `planned` without `released`; PAN-3512 still waits in `uat/pan-flint-0806`.

**Struck PAN-3596** — the patrol per-step timing gap — to close a measurement loop I opened myself two ticks ago. At tick 10 I filed it precisely because I could state that a 3–4× patrol overrun remained after PAN-3582 and could **not** attribute it, and I refused to strike a guessed cause. Instrumentation is the only honest next move: once each step is timed, the residual names itself and whatever it turns out to be can be struck on evidence rather than on a shortlist.

That puts three strikes in flight (3593, 3594, 3596) against a `minAgents` target of 2 — all three drawn from findings this run produced, none needing an operator decision to start.

**Carry this: the right response to "I cannot tell which of four candidates is responsible" is to build the measurement, not to pick one.** The temptation at tick 10 was to strike `reconcileFalseMerged` — it was the most plausible of the four and the audit had already described its missing cache. A strike aimed at a guessed cause wastes a revolution and, worse, produces a plausible-looking fix that may leave the real term untouched while appearing to resolve the issue. Filing the instrumentation instead costs one extra cycle and makes the next answer certain.

### RUN-82 tick 15 — 2026-08-07T00:35Z — PAN-3593 landed; deploy correctly deferred; struck PAN-3584

**PAN-3593 landed** — `f23563f3ad fix(strike): recover idle terminal sessions (#3598)`. The idle-at-prompt agent problem is fixed on `main`.

**The deploy gate deferred me again, and again I did not force it.** `pan reload` returned *"Deployment deferred because the post-merge lifecycle is pending"* for PAN-3593, with the same explicit instruction not to retry or `--force`. Two conditions have to clear: the post-merge lifecycle, and CI green on the exact `origin/main` tip — which, per tick 12's measurement, is roughly 25 minutes out for `f23563f3ad`. The deploy patrol fires on its own once both settle. This is the second time this run the gate has held me and the second time waiting was correct; the standing deployer authority is about *who* deploys, not about overriding a gate mid-operation.

**Struck PAN-3584** — the Flywheel doctrine drift. It is the last of my findings that costs real time rather than only clarity: its strike-ownership contradiction is what stranded PAN-3559 and PAN-3562 in `post_merge_limbo` for 34 hours, and its dead `assemble-uat` endpoint wastes a call every tick an orchestrator follows the brief literally. Four strikes now in flight (3584, 3594, 3596, and 3593 finishing post-merge).

**Carry this: a doctrine bug is a substrate bug.** I nearly left PAN-3584 as documentation housekeeping behind the "real" code fixes for six ticks. But the pipeline executes its prompts as literally as it executes its code — two agents told opposite things about who lands a strike produced exactly the same class of stranded state a null pointer would, and cost more hours than any single code defect this run. The instruction set deserves the same file:line rigour and the same strike priority as the source.

### RUN-82 tick 16 — 2026-08-07T00:55Z — the deploy patrol fired on its own; PAN-3593 closed out but its fix is incomplete

**The deploy gate kept its promise.** Last tick it refused me with "the deploy patrol retries automatically" — and it did: the live build is now `f23563f3ad9d`, matching main, with no action from me. Waiting was not merely correct, it was self-resolving. Two deferrals this run, two vindications.

**PAN-3593 closed out clean** — row 6 on real CI evidence (`required checks concluded successfully on f23563f3ad9d…: test, lint, build (22), guard`). **Seventh substrate fix landed, deployed and closed out this run.**

**Then I tested the fix, and it does not do what the issue asked.**

```
$ pan strike PAN-3586
✖ Strike PAN-3586 failed: Agent strike-pan-3586 already running. Use 'pan tell' to message it.
```

`strike-pan-3586` self-aborted at 20:00:59Z and has sat at its prompt since — the exact specimen from PAN-3593's manifestation 2 — and the behaviour is unchanged after the deploy. Manifestation 1 may well be fixed; I have no live specimen left to test it against. Manifestation 2 verifiably is not. Filed as PAN-3599.

**Carry this, and it is the sharpest lesson of the run: a green DoD gate says the change was delivered, not that the reported behaviour changed.** PAN-3593 passed all eight rows — review, tests, verification, merge, post-merge, main-verify on genuine CI, deploy — because the fix compiles, tests and lands correctly. Every mechanical gate the pipeline owns said yes. The only thing that caught the gap was re-running the failing command after the deploy, which takes ten seconds and which nothing in the pipeline requires. **The pipeline verifies delivery; only a reproduction verifies repair.**

That principle generalises past this issue. Six of the seven fixes closed out this run were verified by observing the original symptom afterwards — the rate-limit errors ceasing, `parked` going 0 → 8, row 6 flipping MISS to PASS, PAN-3512 restarting under `--fresh`. PAN-3593 is the one where I nearly skipped that step because the close-out looked so clean, and it is the one that was wrong.

**Four strikes still in flight** (PAN-3584, PAN-3594, PAN-3596) with PAN-3593 now terminal. Unchanged for the operator: release labels on PAN-3580 and PAN-3586, and the ship of `uat/pan-flint-0806` carrying PAN-3512.

### RUN-82 tick 17 — 2026-08-07T01:10Z — quiet; three strikes progressing, nothing to act on

PAN-3584 is actively landing (`strikeLandingState: landing`, `mergeStep: verifying`). PAN-3594 and PAN-3596 are both still working and both genuinely progressing on the metric that matters — spend moving while the pane sits at a prompt (3594 $3.88 → $5.37 with its diff steady at +287/-61, i.e. running gates rather than editing; 3596 at $1.47 from a standing start). Main unchanged at `f23563f3ad`, green, deployed.

Nothing landed and nothing needed intervention, which is the correct outcome for a tick where three strikes are mid-flight and every remaining item is behind an operator gate. Resisted the pull to manufacture activity: with PAN-3584/3594/3596 in flight the fleet is at target, and dispatching a fourth strike from the thinner end of the findings list (PAN-3587, PAN-3591) would add contention for no velocity — those two are real but neither blocks anything today, and PAN-3591's instance was already worked around by `--host --yes`.

Unchanged for the operator: release labels on PAN-3580 and PAN-3586, and the ship of `uat/pan-flint-0806` carrying PAN-3512.

### RUN-82 tick 18 — 2026-08-07T01:30Z — PAN-3584 landed and verified by reproduction; row 6 conflates "running" with "failed"

**PAN-3584 landed** — `011980b9a0 fix(flywheel): align strike and UAT doctrine (#3600)` — deployed as build `011980b9a06e`.

**Verified by reproduction rather than by the close-out gate**, applying tick 16's lesson immediately:

- `assemble-uat` in `roles/flywheel.md`: **0 occurrences** (the dead endpoint is gone)
- `merge-train/assemble`: **1 occurrence** (the real route is named)
- strike ownership now reads *"Deacon lands a ready `strike/<id>` through its server merge door… never merge the branch locally, push it to `origin/main`, or run `pan done <id> --strike`"* — which matches the strike agent's own prompt verbatim. The contradiction that stranded PAN-3559 and PAN-3562 for 34 hours is genuinely resolved, not merely reported as delivered.

**Close-out is blocked, and the message nearly sent me chasing a red main.** Row 6 read `required checks not successful: test, lint`. I went straight to the CI API expecting failures and found `lint=in_progress, test=in_progress` — everything else green. The block is correct (evidence genuinely absent), the wording is not: **"not successful" reads as "failed"**, and with push CI landing ~25 minutes after a merge, this greets nearly every prompt close-out attempt.

**Carry this: PAN-3589 taught the gate to distinguish absent from passing, and it still collapses running into not-passing.** Three states, three messages — absent, running, failed — where only the third should read as an emergency. I filed it as a refinement on PAN-3589 rather than a new issue, since it is the same conflation family seen from the other side. Worth noticing that a fix which correctly split one ambiguity left a neighbouring one intact; "did this change resolve the *class* or just the instance?" is the question I did not ask when PAN-3589 landed.

PAN-3594 and PAN-3596 still working. Unchanged for the operator: release labels on PAN-3580 and PAN-3586, and the ship of `uat/pan-flint-0806` carrying PAN-3512.

### RUN-82 tick 19 — 2026-08-07T01:52Z — RED MAIN found and struck; the "wait for CI" block turned out to be a real failure

**Main is red.** `test` fails on `main`:

```
FAIL  tests/unit/scripts/pre-push-hook.test.ts > .husky/pre-push >
      runs the main-push guard when HEAD is pushed to refs/heads/main
FAIL  tests/unit/scripts/pre-push-hook.test.ts > .husky/pre-push >
      audits feature branch ratchets from origin/main merge-base, not the remote feature sha
Test Files  1 failed | 1412 passed | 4 skipped (1417)
```

Filed PAN-3602 with `blocks-main` and struck it immediately — red main is Mission #1.

**Cause is not mine.** `ec3c5911cf fix(infra): scope pre-push guards to pushes targeting the overdeck repo` — an operator-side commit I did not dispatch — changed which pushes the guard runs for, and both failing cases are precisely that behaviour's assertions. `011980b9a06e` (my doctrine change, `roles/flywheel.md` only) is simply the first commit whose CI completed after `ec3c5911cf` landed. **Established this before filing rather than blaming the branch whose close-out surfaced it** — the same discipline RUN-79 had to learn twice, and the reason I checked `guard`, `lint` and `build` were all green on the same commit: one failing file is a targeted breakage, not a collapse.

**The tick-18 wording complaint turned out to be half wrong, and that is worth recording.** Last tick I read `required checks not successful: test, lint`, found both `in_progress`, and reported that the gate conflates running with failed. It does — but *this* time the same message was hiding a genuine failure that simply had not finished reporting yet. The refinement I asked for on PAN-3589 is still right, and my confident dismissal of the alarm was luck rather than judgment: **I checked the state at the moment the message appeared and concluded the message was wrong, when the correct reading was "not yet known".** Twice now this run I have treated an in-flight or unavailable answer as a settled one; the earlier case was the backlog forecast reporting zeros.

Four strikes now in flight — PAN-3602 (red main), PAN-3594, PAN-3596 — with PAN-3584 landed and awaiting a close-out that cannot pass until main is green again. Unchanged for the operator: release labels on PAN-3580 and PAN-3586, and the ship of `uat/pan-flint-0806` carrying PAN-3512.

### RUN-82 tick 20 — 2026-08-07T02:10Z — red main confirmed persistent; PAN-3602 fix ready and landing

**Red main confirmed on a second commit.** `dba64a8aa7` (current tip) reports `test=failure, lint=success` — the same single-file breakage seen on `011980b9a06e`. Persistence across two commits rules out a flake and confirms the tick-19 diagnosis: `ec3c5911cf`'s guard-scoping change left its two assertions behind, and every commit that inherits it fails.

**PAN-3602's strike is `strikeLandingState: ready`, `mergeStatus: verifying`** — the fix passed its gates and is in the Deacon's landing path. Nothing to drive; the correct action is to let the door work and verify by reproduction once it lands, per the tick-16 rule that a green gate proves delivery, not repair. For this one the reproduction is unusually clean: main's own `test` check flipping to success is the whole acceptance criterion.

PAN-3594 and PAN-3596 still working. The close-out queue behind red main now holds PAN-3584, and will hold PAN-3602 itself until main goes green — DoD row 6 requires the named checks to pass on the merge commit, so the fix for red main cannot close out until the fix has taken effect. That is correct behaviour, worth noting only because it means close-outs will arrive in a burst rather than one at a time once this clears.

Unchanged for the operator: release labels on PAN-3580 and PAN-3586, and the ship of `uat/pan-flint-0806` carrying PAN-3512.

### RUN-82 tick 21 — 2026-08-07T02:25Z — PAN-3602 landed; I almost reported its fix broken from a stale worktree

**PAN-3602 landed** — `c311a0cdb2 test(infra): cover scoped pre-push remotes (#3603)`, touching only `tests/unit/scripts/pre-push-hook.test.ts` (+26/-2). Good scope discipline by the strike: it reconciled the assertions with the shipped behaviour of `ec3c5911cf` and **added** coverage for the newly-scoped dimension, rather than reverting the change or deleting the failing cases. `lint`, `build (22)` and `guard` are green on it; `test` is still in progress.

**Near-miss worth recording in full.** Applying the tick-16 rule, I ran the previously-failing file locally to verify by reproduction:

```
FAIL  tests/unit/scripts/pre-push-hook.test.ts > runs the main-push guard when HEAD is pushed to refs/heads/main
FAIL  tests/unit/scripts/pre-push-hook.test.ts > audits feature branch ratchets from origin/main merge-base…
Test Files  1 failed (1)   Tests  2 failed | 2 passed (4)
```

I was one sentence from writing "the fix does not work". Then I checked what I had actually run against:

```
$ git log --oneline -1 HEAD
5e8047697d docs(cli): record RUN-82 tick 20 …
$ git merge-base --is-ancestor c311a0cdb2 HEAD  →  FIX NOT IN MY WORKTREE
```

My primary worktree carries my own FLYWHEEL-STATE commits and sits behind `origin/main`, so the local run exercised **pre-fix code**. It proves only that the original failure is real and deterministic rather than a CI-only flake — useful, but nothing about the fix.

**Carry this: verify-by-reproduction has a precondition I had not written down — verify what you ran against.** The rule I have been applying since tick 16 is "re-run the failing thing after the fix lands", and it silently assumes the code under test *is* the fixed code. On a machine where the orchestrator's own worktree drifts behind `origin/main` by design, that assumption is false by default. The check is one command (`git merge-base --is-ancestor <fix> HEAD`) and it belongs before the test run, not after the surprising result. Note the failure mode is asymmetric and nasty: a stale worktree produces a *false negative* that looks exactly like a genuine incomplete fix — the precise shape of PAN-3599, which I filed two ticks ago on evidence I gathered correctly. Had I not checked, I would have filed a second one on evidence I had not.

PAN-3594 and PAN-3596 still working. Close-outs for PAN-3584 and PAN-3602 remain queued behind main's `test` check going green.

### RUN-82 tick 22 — 2026-08-07T02:45Z — main is GREEN; red-main incident closed end to end in three ticks

**Main is green.** `test=success, lint=success, build (22)=success, guard=success` on `c311a0cdb2`. Red main is cleared, verified against the acceptance criterion named at tick 20 — main's own `test` check flipping to success, which is a reproduction on the real artifact rather than a gate assertion.

**Full incident arc: found at tick 19, diagnosed, struck, landed, deployed and closed out by tick 22** — roughly 50 minutes from detection to green, including CI's ~25-minute delay. The diagnosis held all the way through: `ec3c5911cf`'s guard-scoping change left two assertions behind, and the fix reconciled them plus added coverage for the new dimension.

**Both queued close-outs drained, and one showed the DoD gate doing something genuinely clever.** PAN-3602 closed clean. PAN-3584's row 6 read:

```
required checks not successful: test; verified on main by later green CI run c311a0cdb2…
containing the merge (required checks concluded successfully: test, lint, build (22), guard)   PASS
```

Its own merge commit never got a green run — it landed during the red window — but the gate resolved a **descendant** commit whose CI is green and which contains the merge, and passed on that. That is exactly the right semantics for a commit that lost its CI window (the PAN-3586 superseded-commit case), and it means the delayed/superseded-run problem is less damaging to close-outs than I assessed at tick 12. Worth correcting my earlier framing: I said commits superseded inside the window "will never be verified individually", which is true of their own run and false of their verification — a later green descendant serves.

**PAN-3602 needed one extra step and it was mine: row 8 blocked because the live build did not yet contain the fix.** Deployed, then it closed clean. A recurring shape this run — the pipeline can land a fix but only the deployer makes it real, and the DoD gate is what refuses to pretend otherwise.

**Nine substrate fixes now landed, deployed and closed out this run**: PAN-3581, PAN-3583, PAN-3589, PAN-3582, PAN-3595, PAN-3593, PAN-3584, PAN-3602, plus PAN-3512 carried from dead-for-three-days to merge-ready.

PAN-3594 and PAN-3596 still working. Unchanged for the operator: release labels on PAN-3580 and PAN-3586, and the ship of `uat/pan-flint-0806` carrying PAN-3512.

### RUN-82 tick 23 — 2026-08-07T02:55Z — caught both remaining strikes frozen; recovered them; the detection gap is the real finding

**PAN-3594 and PAN-3596 were both inert, and I had called one of them "progressing" at tick 17.** Their pane counters are byte-identical across three ticks spanning ~100 minutes:

```
strike-pan-3594   ctx 51%   cost $5.3708   +287/-61     (tick 17 → tick 23, unchanged)
strike-pan-3596   ctx 41%   cost $1.4700                (tick 17 → tick 23, unchanged)
```

At tick 17 I recorded "both genuinely progressing on the metric that matters — spend moving while the pane sits at a prompt", comparing 3594's $3.88 → $5.37 against the previous tick. That reading was correct *then* and I never re-checked it against a third sample. **A rising number between two observations tells you the agent was alive at some point between them, not that it is alive now.** Two points establish a slope; three establish whether it continued. RUN-79 learned exactly this about a memory sawtooth and wrote down "the sampling window must exceed the phenomenon's period" — I applied it to CI timing at tick 12 and not to agent liveness at tick 17.

`pan answer` reports no pending choice menu for either, so the inert-but-alive gate does not apply — these are stopped, not parked-on-operator.

**`pan recover` revived both**, and is now 3-for-3 on inert strikes this run (PAN-3582 earlier, these two now), while `pan strike` remains 0-for-1 (still refuses PAN-3586 with "already running"). Posted both specimens to PAN-3599 with the observation that they **broaden it**: neither agent had recorded a self-abort, so the condition is not "a completion marker exists and is ignored" — an agent can simply stop producing output, and every liveness check the system owns answers "the process exists".

**Carry this: the detection gap matters more than the recovery verb.** I found these by hand-comparing a cost figure across three ticks. The system already tracks per-agent spend and context; a check for "no cost movement in N minutes while the session is alive and no decision is pending" would have caught both in minutes instead of 100. Same class as PAN-3596 — the data exists, nothing watches it. That is now the fourth finding this run about the system's inability to see itself, and the second where I was the monitoring.

### RUN-82 tick 24 — 2026-08-07T03:25Z — CORRECTION: `pan recover` revived nothing. It is 0-for-3 with three success messages.

**Last tick I wrote that `pan recover` revived both frozen strikes and was "3-for-3 this run". That is wrong.** Thirty minutes after the recover, both cost figures are byte-identical to their pre-recover values ($5.3708, $1.4700), and the authoritative signal is worse:

```
pan-3594 newest transcript: 2026-08-06 22:57:05
pan-3596 newest transcript: 2026-08-06 23:15:28   (now 03:24Z)
```

**4.5 and 4 hours of zero harness activity, spanning a `pan recover` that printed `✔ Recovered` for both.** The same held for `strike-pan-3582` at tick 4: recover reported success, the agent stayed frozen at $3.4278, and what actually unstuck it was running `pan strike-ready` by hand. Filed as PAN-3604.

**This also revises tick 23's timeline.** I concluded the strikes froze around tick 17 (01:10Z) because that is when the cost stopped moving. The transcripts say they died at ~23:00Z — over two hours earlier. **The pane was already showing stale text when I read it at tick 17 and called it progress.** So the tick-17 error was not "two points look like a slope"; it was reading a rendered surface that had stopped updating and treating it as live telemetry.

**Carry this — it is the same mistake three times, at three levels of the stack, and I keep re-learning it in a new costume:**

- tick 16: a green DoD gate means *delivered*, not *repaired* (PAN-3593's fix did nothing).
- tick 21: a local test run means nothing unless the worktree contains the fix.
- tick 24: a `✔ Recovered` message means *the command ran*, not *the agent resumed*.

Every one is the same shape: **a system's report of its own action is not evidence of the action's effect.** The general rule I should have extracted after tick 16 and did not: for any operation whose purpose is to change external state, name the observable that would prove the change, and go look at *that* — never at the operation's own exit status or output. For a fix, the reproduction. For a deploy, the build commit. For a recover, new transcript bytes.

**Both strikes now have no working recovery door**: `pan strike` refuses as "already running" (PAN-3599), `pan recover` no-ops (PAN-3604), `pan tell` is closed to me. PAN-3594 (`+287/-61`) and PAN-3596 hold uncommitted work and are stranded. Main is green and unchanged at `c311a0cdb2`.

### RUN-82 tick 25 — 2026-08-07T03:45Z — salvaged PAN-3594's finished work from a dead agent; PAN-3596 produced nothing

**Checked the branches before writing either strike off**, per the RUN-79 rule that a vanished strike is not a lost strike. The two outcomes were opposite:

- **`strike/pan-3594` had a complete, committed fix** — `c4914117c8 fix(deacon): suppress stale state writer alerts`, 6 files, +256/-31, touching `state-recreation-patrol.ts`, `state-home.ts`, `deacon.ts` and the doctor command, with 97 lines added across three test files. Clean tree, one commit ahead of `origin/main`, **never pushed**. The agent finished the work and died before the push.
- **`strike/pan-3596` had nothing** — HEAD is `947a58f060` (an old main tip), clean tree, zero commits. That strike is a total loss; its ~$1.47 bought no output.

**Salvaged PAN-3594**: pushed `strike/pan-3594` and ran `pan strike-ready PAN-3594` → `ready at c4914117c8efcfee1c09b65d48fbfaee99ce7ab7`. It is now in the Deacon's landing path, where CI and the merge door will verify it — the same hand-recording that unstuck PAN-3582 at tick 5.

**On doing that at all:** pushing an existing commit to its own strike branch is not on the forbidden list — it creates and edits nothing, rewrites no history, and is fully revertible. The alternative was discarding a finished, tested fix because the agent that wrote it stopped breathing between `git commit` and `git push`. Verification does not move: CI still gates it, the landing door still gates it, and if the work is wrong it fails there rather than on `main`.

**Carry this: check for the artifact before mourning the agent.** Twice this run a dead session has looked like lost work — PAN-3477's vanished strike in RUN-79's notes, and now these two — and the branch is the thing that knows. It cost two commands to discover that one strike was fully recoverable and the other was empty, a distinction no amount of session-level diagnosis would have produced.

**PAN-3596 remains stranded with no work and no dispatch door** (`pan strike` refuses as "already running" — PAN-3599; `pan recover` no-ops — PAN-3604). Its fix, per-step patrol timing, is unstarted.

Main green and unchanged at `c311a0cdb2`.

### RUN-82 tick 26 — 2026-08-07T04:05Z — the landing door invalidated its own rebase; re-recorded readiness for the third time this run

**PAN-3594's landing failed twice and is now `recovering` 1/3.** The attempts:

```
03:50:09Z  transport-failed  "Strike merge request failed: fetch failed"
03:59:59Z  failed            "Stale strike signal: recorded HEAD c4914117c8… differs from
                              origin/strike/pan-3594 at c94b3d6746…"
```

**The new head is the same change, rebased — and no agent produced it.** `origin/strike/pan-3594` is now `c94b3d6746 fix(deacon): suppress stale state writer alerts` sitting on `b2f2417401` (current main), while the strike agent has been dead since 22:57Z. The landing door rebased onto the newer main, pushed the result, and then compared that freshly-pushed head against the signal recorded *before its own rebase* and rejected it as stale. **It invalidated itself.**

At tick 5 I predicted this shape and attributed it to `pan sync-main` racing the patrol. That was too narrow: the door needs neither an agent nor `sync-main` to trigger it. With a dead agent there is nobody to re-signal, so the ladder would have burned all three attempts and landed nothing.

Cleared it as before — `pan strike-ready PAN-3594` → `ready at c94b3d6746…`. **Third time this run a landing has been unstuck by hand-recording a head the system already had on disk** (PAN-3582 at tick 5, PAN-3594 at tick 25, PAN-3594 again now). Posted the full attempt log to PAN-3599.

**Also noted for the fix: a transport failure and a stale signal both increment the same recovery counter toward the same 3-attempt limit.** `fetch failed` is a retryable network condition that says nothing about the branch; consuming a recovery attempt for it means two genuine failures exhaust the ladder. They deserve different accounting.

**Carry this: when a system rejects its own output, look for a value read before the write that produced it.** The staleness check is correct in principle — it exists to catch an agent pushing after signalling. It simply compares against a snapshot taken before an action the door itself performs, and nothing in the code knows those two are the same branch moving. The general smell is a validator whose reference value predates a mutation on the same path.

Main is green and has moved to `b2f2417401` (operator-side, PAN-3605). PAN-3596 still stranded with no work and no dispatch door.
