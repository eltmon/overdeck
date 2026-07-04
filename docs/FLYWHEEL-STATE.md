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
- ~~**Hands-off PAN-1791**~~ — RESOLVED (RUN-55 t1): PAN-1791 is CLOSED + merged + closed-out. Follow-up work continues as PAN-2283 ("Tiered execution ignition"), a normal in-flight work agent.
- ~~**Hands-off PAN-2214**~~ — RESOLVED (RUN-55 t1): PAN-2214 is CLOSED + merged + closed-out. The hold that gated PAN-1791 is moot; both landed.

## RUN-55 tick 5-6 (2026-07-03) — RED MAIN RESOLVED (green); both strikes merged+closed; PAN-2181 → UAT bundle; strike-path bugs filed (PAN-2300)

- **Main GREEN** (362d7793, CI success on both the fix 27a9a0f129 and HEAD). Red-main lifetime ~40 min, mostly the strike over-verifying (18m full `npm test` under codex git-EPERM sandbox for a 1-line baseline change — scope strike verification to the affected gate, not the whole suite).
- **CORRECTION to t3:** `strike-pan-2296` did NOT hold the line — it ultimately **pushed the fix DIRECTLY to origin/main** (fast-forward, commit 27a9a0f129) despite flagging the roles/strike.md contradiction itself. Correct fix + verified, so not reverted, but it's the PAN-2204 direct-to-main hazard. PAN-2296 landed → closed-out.
- **PAN-2289 (#2291) merged + closed.** All CI green (test 7m56s pass — confirms the strike's "broadly red locally" was purely the workspace sandbox). Squash-merged as strike owner. **`pan done --strike` REFUSED** (`git merge-base --is-ancestor strike/pan-2289 origin/main` — squash makes the branch non-ancestor AND --delete-branch removed it). **`pan close --force` completed it** ("Branch already cleaned up (squash-merged)"). REUSABLE: after a squash-merge, finish a strike with `pan close --force`, NOT `pan done --strike`.
- **Filed PAN-2300** consolidating both strike-completion defects (squash-ancestry failure + kickoff-says-merge-to-main).
- **PAN-2181 merge-ready → assembled** into UAT bundle uat/pan-cobalt-0703 (operator ships; require_uat_before_merge=ON). Re-confirmed: assemble only works after emitting a snapshot with the issue as verb `shipping`.
- **PAN-2297 pipelined** (`planning-pan-2297`) — strike-filed root cause: auto-lower file-size baselines on the UAT-batch merge path.
- **Idle work agents (surface / next-tick):** **PAN-1456 WEDGED** on an approval gate — needs explicit approval to send GitHub context to GPT-5.5 via CLIProxy; nothing approves it in an autonomous run, auto-approve hook (agent-*/planning-*) didn't cover it; flywheel has no legal lever → operator-surface. **PAN-2148 / PAN-2283** idle with clean pushed branches but NOT in the active review list — possible "finished but never entered review / ran pan done" gap; verify next tick.

## RUN-55 tick 3 (2026-07-03) — RED MAIN: operator-merged UAT batch tripped a stale-HIGH file-size baseline (new class); struck; 3 operator-directed issues filed+pipelined

- **RED MAIN (P0) — new file-size class: a SHRINK left the baseline stale-high.** The operator merged UAT batch `uat/pan-cobalt-0703` (PAN-2254+2257+2260, commit `219b64b902`); CI failed on `lint:file-size`: `src/dashboard/server/routes/workspaces/merge-ops.ts is 1924 lines but baselined at 1925`. A merged PR *shrank* the file by 1 line and the baseline (`scripts/file-size-baseline.txt:17`) wasn't lowered; `lint:file-size` rejects a stale-high baseline. This is the inverse of the usual "file grew past guard" red-main — worth remembering: file-size red-main can be a SHRINK, fixed by `bash scripts/lint-file-size.sh --update` (baseline-only). Filed **PAN-2296** (blocks-main) + struck (`strike-pan-2296`). **Root-cause gap:** PAN-2227 ("auto-lowering baselines at write point") merged + closed-out this run, yet the auto-lower did NOT fire on the UAT-batch merge path — the batch merge bypasses the pre-push guard. Follow-up noted in PAN-2296 body.
- **A UAT batch that passed members individually still reddened main on the combined merge.** require_uat_before_merge did not catch it — the lint failure only manifests on the post-merge combined tree (baseline drift from the merge), not on any individual branch. Reinforces: assembling a green batch ≠ a green post-merge main.
- **REUSABLE — codex strike runs in a network sandbox (bwrap).** `strike-pan-2296` (codex/gpt-5.5) boots fine (NOT token_revoked — codex auth is functional; only the older PAN-1917 slots have stale tokens), but its `gh` calls hit "error connecting to api.github.com" and need per-call approval/retry. It also correctly refused the kickoff's "merge to main" per roles/strike.md (strike never pushes main) — the strike owner (flywheel) owns the merge.
- **GraphQL quota exhaustion persisted all window** (`graphql:0`, blocks `gh pr checks`/`gh pr view`/`gh issue create`). Worked around via REST (`gh api repos/.../issues` for issue creation, `gh run view` for CI logs, local git for diffs). Resets hourly (~90s from red-main triage). **Pipelined the durable fix: PAN-2265** (see below).
- **PAN-2289 strike merge (#2291) BLOCKED on red main** — CI-green review done, but never admin/squash-merge onto red main. Drains after PAN-2296 greens main.
- **Three operator-directed issues filed + pipelined this window:** (1) **PAN-2294** notify-flywheel-on-UAT-promote (no prior issue existed; created + plan-started `planning-pan-2294`) — the durable fix for the not-ready-train-pops-up-after-merge churn (promote moves main → re-review flips a member to pending → promote gate blocks the rebuilt batch). (2) **PAN-2295** built-in browser surface + native Agentation integration (created, labeled `needs-design`, NOT auto-started — design-heavy). (3) GraphQL overuse: FOUND existing **PAN-2265** ("top burners + remediation plan"; operator partially remediated it 03:28 — webhook/App backend provisioned, refreshMergeStateFromGitHub routed to App REST — but quota still hits 0) + symptom **PAN-2259**; not in-flight, so plan-started `planning-pan-2265`. REUSABLE: `gh issue create` uses GraphQL (label validation) so it fails under GraphQL exhaustion — use `gh api repos/OWNER/REPO/issues -X POST -f title=.. -F body=@file -f 'labels[]=..'` (REST core quota).

## RUN-55 tick 2 (2026-07-03) — pipeline advancing healthily; PAN-1917 dead-auth+held (surfaced); UAT candidate must be re-emitted every tick

- **CONFIRMS t1 lesson — re-emit shipping verbs + re-assemble EVERY tick.** Between t1 and t2 the UAT generation `uat/pan-cobalt-0703` stayed `status:ready` in `/api/flywheel/uat-generations`, but `GET /api/flywheel/uat-candidate` reverted to `null`. `getUatCandidatePayload()` returns null when the *current emitted snapshot's* ready set is empty — so the candidate surfaces only while the live snapshot lists the merge-ready issues as `shipping`. Re-emitting the t2 snapshot + re-POSTing assemble-uat restored the candidate. Bake this into every tick.
- **Pipeline advancing under its own steam:** PAN-2181 work→review+test (pushed fix, review passed, #2183 test running), PAN-2283 work→review (CI running), PAN-2284 planning→work (slot-1), PAN-2148 working 37m + inspection running, PAN-1456 auto-picked-up (auto_pickup_backlog=ON) and verifying. 5/7 gpt-5.5 agents healthy and progressing (two-snapshot lastActivity diff: 2181 10:52→11:22, 2283 10:53→11:18 advanced).
- **codex-auth paradox recurred (do NOT hold gpt-5.5 pickup on it):** `pan pi-auth status` → "openai-codex: not logged in", yet 5 live gpt-5.5 agents work fine. Ground truth = live sessions, not the status command (RUN-53 t4 lesson holds). Operator `pan ohmypi-auth login` is the clean fix but not fleet-urgent while agents run.
- **PAN-1917 genuinely stuck — surfaced, not churned.** `pan swarm status PAN-1917`: Hold=`stuck (feedback_delivery_needs_you)`, both slots reported `session alive` but the panes show `token_revoked` (401, dead at kickoff idle prompt) — the classic "session-alive ≠ making-progress" trap, now compounded by the reconciler counting dead-auth slots as alive. Recovering slots under a stuck-hold only churns (deacon skips coordination); root cause is operator-gated (codex re-auth + clear the needs-you feedback). Left held; surfaced in suggestions/openQuestions. REUSABLE: `pan swarm status <id>` reconciled view is the right lens, but cross-check slot panes for token_revoked — "session alive" there means tmux-exists, not agent-working.
- **Closed out PAN-2192** (missed in t1's sweep) — was `verifying-on-main`+`merged` with a stale `blocks-main` label; close-out verify-merged passed, clearing the last stale `blocks-main`. No live red-main emergency exists (main GREEN 4be4bd41c9). `pickable:0`/`needsPlanning:0` — nothing to start or plan; cohort saturated at 7/20.

## RUN-55 tick 1 (2026-07-03) — UAT bundle assembled (was blind on a fresh run); verifying-on-main tail drained (10 close-outs)

- **DURABLE LESSON — the UAT/merge machinery is blind until the orchestrator emits a populated `activePipeline`.** `assemble-uat` returned `{"action":"idle"}` and `GET /api/flywheel/uat-candidate` returned `null` even though `pan review pending --ready` showed 3 merge-ready PRs (PAN-2254/2257/2260, all OPEN+MERGEABLE+CLEAN). Root cause: the UAT reconciler's ready set comes from `getReadySet()` → `computeMergeQueue(status.activePipeline)` in `src/dashboard/server/services/uat-train.ts:63`, where `status` = the **last-emitted flywheel snapshot** (`readCurrentFlywheelStatusForDashboard`). On a fresh run the launch auto-emits an EMPTY `activePipeline`, so the merge queue is empty → idle. With `assemble-uat` forcing `force:true`, the ONLY path to `idle` is `readySet.length===0` (uat-reconciler.ts:205). **Fix each tick: emit a status snapshot with the merge-ready issues carrying verb `shipping` (or `merging`) + their `pr` number, THEN POST `/api/flywheel/assemble-uat`.** This is the documented contract (packages/contracts/src/flywheel.ts:41-53 — "Emitting any OTHER verb for a ready_for_merge issue silently drops it from the merge queue and UAT batch assembly") but trivially forgotten because the two ready-derivations (SQLite vs emitted snapshot) disagree silently. After emitting the shipping verbs, assemble-uat produced `uat/pan-cobalt-0703` (2254+2257+2260, baseSha 4be4bd41c9, status ready, no heldOut/conflicts). Operator UAT-gated from here (require_uat_before_merge=ON).
- **REUSABLE — emit mechanics:** internal-token bypasses the CSRF/origin mutation guard. `TOKEN=$(cat ~/.overdeck/internal-token)` then `curl -X POST .../assemble-uat -H "Content-Type: application/json" -H "x-overdeck-internal-token: $TOKEN" -d '{}'`. Read-only candidate: `GET /api/flywheel/uat-candidate`. `GET /api/flywheel/status` returns the SPA HTML (catch-all) — use `/api/flywheel/current` for the live snapshot JSON. Dashboard localhost:3011 was reachable this run (harness NOT sandboxed) — HTTP UAT endpoints usable directly.
- **Verifying-on-main tail drained: 10 close-outs** (PAN-2172/2227/2224/2157/2156/2151/2081/1894/1718/2208), all `pan close --force --json` success with verify-merged gate passing ("Merge specialist confirmed merge completed"). My hypothesis that the PAN-2260 squash-merge verify-gate bug was blocking them was WRONG — the merge specialist confirmed every merge. PAN-2208 had no same-titled PR (`gh pr list --search "2208 in:title"` empty) but still closed clean (merged via a differently-titled path; the `merged` label was legit). LESSON: don't infer "not merged" from a title-search miss — the close-out verify gate is authoritative.
- **State snapshot:** main GREEN (origin 4be4bd41c9; local main ahead on deacon state-sync commits — expected). No live blocks-main emergency (PAN-2192 carries a stale `blocks-main` label on already-merged+verifying work). Objection PAN-806 = epic (correctly gated). `pickable:0`/`needsPlanning:0` — nothing to auto-start or plan (cohort saturated relative to ready backlog). 5 live gpt-5.5 work agents (PAN-1917 swarm ×2, 2148, 2181, 2283) + planning-2284, all young (fresh ~11:04Z boot) — two-snapshot progress diff deferred to t2. gpt-5.5 is the preferred/working work model — no re-route.



- **Root filesystem hit 100% (238MB free of 832GB).** /tmp is on the root disk (NOT tmpfs) — so: bash output capture died (ENOSPC in the harness tasks dir), PAN-2257's docker init failed, PAN-2261's spec promotion stranded, and the "swap full" alarm was a co-symptom of general pressure. **Applied the documented PAN-1674 remedy: `rm -rf workspaces/*/.venv` (regenerable TLDR caches, 7.5GB × ~14 workspaces) → freed 104GB, disk at 87%.** REUSABLE triage: when bash output capture starts failing with ENOSPC, check `df -h /` FIRST — it's disk, not tmpfs; also docker had 12GB reclaimable containers + 9.5GB images (left for operator).
- **PAN-2255 planned** (spec on main). **PAN-2261 planning done but spec promotion stranded** ("completion already in progress" — the in-flight completion died with the disk; bead workspace-5d14n exists); re-ran `pan plan done`, needs verification, else re-run now that disk is fixed.
- PAN-2257 + PAN-2255 starts queued in a background retry loop (bd busy but cycling — verified holders live). Swap still pegged 8191/8191 (operator drain suggested). Main GREEN (9dbf84d47c).

## RUN-53 tick 12 (2026-07-03) — finalizes slow-but-live (verified holder); swap COMPLETELY full

- **Dual finalize (2261/2255) still grinding ~45 min** — diagnosed the lock properly before acting: holder is a LIVE `pan plan finalize` pid (lock file `~/.overdeck/locks/bd-*.lock` carries {pid, ts, caller}; ts advancing, process 3m old) → slow serialization, NOT the frozen-ts hang; no SIGTERM. PAN-2257 start stays deferred. REUSABLE: read the lock file JSON + `ps -o etime` on its pid to distinguish live-holder from hung-holder before intervening.
- **Swap 8180/8191 MB — completely full**, RAM climbing (34/64 GB). Escalated to operator as imminent-OOM.
- PAN-2260 verdicts still pending. UAT bundle unchanged (PAN-2254 #2272 + MIN-831 + MIN-846). Main GREEN (5681f0c3e4).

## RUN-53 tick 11 (2026-07-03) — PAN-2257 planned; dual finalize saturates the bd lock (start deferred)

- **PAN-2257 finalized** (spec promoted to .pan/specs/, beads created; the planner itself hit a bd-lock timeout on auto-promotion and self-recovered via `pan plan done`). PAN-2261 mid-finalize (bead 1/5, slow under lock contention — it is planning the fix for the very lock it's fighting). PAN-2255 mid-finalize with self-raised `OVERDECK_BD_TIMEOUT_MS=180000` (useful knob — REUSABLE for lock-heavy windows).
- **`pan start PAN-2257` hung >5 min** waiting on the bd lock held by the dual finalizes → killed by my command timeout, no partial state (no session/workspace created beyond the existing planning one). Deferred to next tick after finalizes drain. LESSON: never dispatch starts during active finalizes; sequence them.
- PAN-2260 verdicts pending. UAT bundle unchanged (PAN-2254 #2272 + MIN-831 + MIN-846). Main GREEN (77539c2a96). Swap ~7.7/8.2 GB.

## RUN-53 tick 10 (2026-07-03) — planning FULLY restored (PAN-2275 fixed+deployed); codex plan path now works end-to-end

- **PAN-2275 fixed + closed:** 35c9903c89 "fix: deliver codex planning kickoff" (spawn-planning-session.ts again). Deploy chain repeated as documented: pull → npm run build → `OVERDECK_NO_RESUME=1 pan restart --health-timeout 120000` (ms!) → re-kick all three plans → **verified prompts landed** (all three sessions actively Working, not just booted). The codex plan path took TWO stacked fixes: PAN-2274 (flag crash) then PAN-2275 (missing kickoff delivery) — when fixing a spawn path, verify the WHOLE lifecycle (boot AND kickoff AND first activity), not just the first failure mode.
- PAN-2260 review+test convoys live. UAT bundle: PAN-2254 (#2272) + MIN-831 + MIN-846. PAN-2258 remains operator-owned (retries stopped). PAN-2224 ready=false standing. Main GREEN (35c9903c89 success; 362326972b in progress at tick time). Swap still FULL.

## RUN-53 tick 9 (2026-07-03) — codex plannings are ZOMBIES (PAN-2275, 2nd gap in same path); PAN-2254 in UAT bundle; 2258 retries stopped

- **PAN-2275 filed + struck:** after the PAN-2274 flag fix, codex plan sessions boot a clean TUI but the planning kickoff prompt is NEVER delivered — idle welcome banner ~20 min, zero activity. Claude plan path injects the task at spawn; codex path lacks the equivalent ([PROMPT] positional or post-boot delivery). PAN-2257/2261/2255 stalled a second time; re-kick all three after the strike lands. LESSON: a booted TUI ≠ a working agent — verify the kickoff prompt landed (scrollback shows actual task text, not just the banner) before counting a plan/work session as dispatched.
- **PAN-2258 review convoy vanished a 4th time; retries STOPPED** per plan. PR #2269 (green) needs an operator review decision or the PAN-2270 fix first. Surfaced.
- **PAN-2254 review+test PASSED → UAT bundle** (PR #2272; bundle = 2254 + MIN-831 + MIN-846). ~70 min issue→ready. PAN-2260 still in review. PAN-2224 still ready=false despite passed/passed + merge pending (derivation gate question open).
- Main GREEN (86b8c55ffa). Swap still FULL (8.1/8.2 GB, urgent standing). Context ~88% — continuing on harness compaction (proven earlier this run) rather than handoff.

## RUN-53 tick 8 (2026-07-03) — PAN-2274 fixed end-to-end (needed rebuild + restart); swap FULL; 2258 convoy reaped 3rd time

- **PAN-2274 deploy chain (REUSABLE):** strike landed a43fb24c85 (green) but re-plan STILL crashed — the fix is in `src/lib/planning/spawn-planning-session.ts`, generated by the RUNNING dashboard server. `npm run build` alone did NOT fix it (server keeps old code in memory). Fix required: rebuild + `OVERDECK_NO_RESUME=1 pan restart` (preserving the operator's resume posture rather than silently changing it from my shell env). After restart, all 3 re-plans (2257/2261/2255) boot into live codex TUIs. **`--health-timeout` is in MILLISECONDS** (default 15000) — passing `120` means 120ms and false-fails the restart while the server actually comes up fine; verify with curl before reacting.
- **PAN-2258 review convoy vanished a THIRD time** without verdict (live at 00:33, gone by 00:53; no deacon.log kill entries). Hypothesis escalated on PAN-2270: the manually-materialized workspace has no runtime registration, so patrols orphan-reap attached convoys — strike-origin PRs need first-class support. 4th restart issued under the new server; if it dies again, PR #2269 needs an operator review path.
- **PAN-2153 + PAN-2154 MERGED** (deacon checkMergedWorkSessions reaped their sessions per PAN-1726 — that patrol works). PAN-2254 work→review+test in ~50 min; PAN-2260 in review. PAN-2224 held at ready=false despite review+test passed + merge pending — derivation gate question open.
- **SWAP FULL (8.1/8.2 GB)** — surfaced urgent; OOM killer risk with 25+ live sessions.
- Orchestrator context ~85% — next tick may require `pan handoff` continuity.

## RUN-53 tick 7 (2026-07-03) — planning DOWN for codex-routed agents (PAN-2274); PAN-2258 convoy vanished twice

- **All 3 routed planning sessions (2257/2261/2255) crashed at spawn:** `error: unexpected argument '--append-system-prompt-file'` from the **codex** binary. Root cause: `roleSystemPromptInjectionSync()` (src/lib/agents/runtime-command.ts:604, the PAN-2087 --agent replacement) builds claude-code-only flags harness-blind; the plan spawn splices them into the codex command line. Filed **PAN-2274** + struck. After it lands, re-run `pan plan --auto` for all three. REUSABLE: a planning pane showing "Usage: codex ... try '--help'" + instant exit = this bug, zero planning happened despite the session existing.
- **PAN-2258's entire convoy (strike/review/test sessions) vanished without verdicts** — record still pending/pending. Cause unknown (deacon reap vs crash vs operator); re-issued `pan review restart` (one dashboard "fetch failed" hiccup mid-tick, recovered). If it vanishes again, check deacon.log — possibly the PAN-2270 workspace-origin mismatch family.
- **NO_RESUME survives restarts:** dashboard has a NEW pid (1675489) since tick 2 but still OVERDECK_NO_RESUME=1 with OVERDECK_RESUME_GATE_SOURCE=default — the env is inherited from the restarting parent (watchdog env trap, known from memory). A plain restart does NOT clear it; needs OVERDECK_RESUME=1 or a clean shell. Surfaced with mechanism.
- PAN-2254/2260 work agents live and progressing (2254 finished a 17m turn; 2260 mid-turn). PAN-2224 record shows review+test PASSED but readyForMerge=false — some gate holding it, watch. PAN-2181 test idle, verdict unconfirmed. Main GREEN (e5031ed09a). UAT bundle unchanged (MIN-831/846).

## RUN-53 tick 6 (2026-07-03) — operator routing sweep: holds lifted, 5 issues routed, 2 review-queue unsticks

- **Operator lifted all holds** and handed a routing list: PAN-2254/2257/2260/2261 (bugs/features), PAN-2255 (needs planning), PAN-2265 RESERVED (operator GLM-5.2 strike — untouched), PAN-2258 + PAN-1917 done-pending-review.
- **PAN-2258 review-strand unstuck + gap filed (PAN-2270):** strike worked in `feature-pan-2258-strike`, `pan done` created PR #2269 but auto-review warned "Workspace does not exist" and BOTH `pan review restart` and `pan review request` hard-fail on the missing standard workspace. Unblock recipe: `pan workspace create <id>` (materializes worktree on the existing PR branch) → `pan review restart <id>`. Review+test agents now live. REUSABLE: any PR submitted from a non-standard worktree is silently unreviewable until the standard workspace exists.
- **PAN-1917 is NOT actually done:** agent closed all beads (2 local commits) but never ran `pan done` — no push, no PR, idle at prompt, status=running. No legal flywheel lever (RUN-39 tick-7 gap again). Surfaced to operator.
- **PAN-2261 (bd lock contention) reproduced live during its own routing:** `pan start --auto` for PAN-2254 timed out 30s on bead creation (workspace rolled back), retried after bd went quiet, lost AGAIN to new fleet bd traffic. Mitigation: background retry loop with 20–40s jittered backoff. Plan sessions (2257/2261/2255) dispatched fine — plan kickoff doesn't touch bd until finalize; only start-with-bead-creation contends.
- **PAN-2154 (PR #2236) merged.** UAT bundle back to MIN-831 + MIN-846. Main GREEN (0c225880e1).
- Observed strike-doctrine hardening beads landing (roles/strike.md, roles/flywheel.md, roles/work.md): strike spawner owns the merge via gh-API squash-merge; work agents prohibited from pushing to origin/main — the PAN-2204 family fix in motion.
- PAN-2234 second strike reported NO-OP between ticks — verified independently (1e82badc32 ancestor of main, record merged/passed/passed) and removed the stale needs-handoff label. LESSON: something re-struck an already-merged issue (PAN-2054 stale-ready class); verify merged-state before dispatching any strike.

## RUN-53 tick 5 (2026-07-02) — MAIN GREEN (red #3 fixed in one strike cycle); backlog exhausted of safe candidates

- **PAN-2238 fixed + closed:** strike extracted the ohmypi cost lines, `e76506bf3b` green on main incl. lint; `pan done --strike` handoff clean. Red-main #3 lifetime: ~35 min file→fix-landed.
- **PAN-2181 review PASSED** (artifact + specialists-done signal) and **the test agent spawned server-side (agent-pan-2181-test)** — phase advancement works even under the NO_RESUME boot; NO_RESUME only kills crash-recovery/redispatch, not the specialists-done → next-phase spawn path. Useful distinction for future triage. (Git-mirrored record still shows pending — SQLite is the runtime truth; the .pan/records mirror lags.)
- **PAN-2153 objection filed (TENET-10):** routes/specialists.ts IS the merge-handoff route (11 hits for firePostMergeLifecycle/postMergeLifecycle/spawnRun). Labeled needs-handoff; its live planning session may finish (planning is safe), work pickup is not.
- **Backlog now has ZERO safe autonomous candidates** — everything planned+ready is TENET-10 machinery (PAN-2153/2234/2145/2147/2148/2149). Run will drain as in-flight lands; progress on the parked set requires operator-supervised handoffs. Surfaced.
- Cohort healthy: 2181 test, 2154 in UAT bundle (review+test passed, PR #2236 — bundle now 2154+MIN-831+MIN-846), 2151 work active (long turn, real progress on extraction seams), 2156 test, 2224 spawned swarm slots, 2214 hands-off.
- Swap still 7.6/8 GB (urgent, surfaced). codex-auth paradox persists (status says logged out; sessions run fine).

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

## RUN-55 post-reboot resume (2026-07-04 ~14:15Z) — substrate healthy, drain flowing, PAN-2311 driven

- **Reboot was Jul 3 22:31** (systemd --user + /sbin/init stamped 22:31; uptime 11.5h reconciles). Flywheel had been operator-paused ~12h (last tick 02:04Z).
- **Substrate healthy.** Live host server = pid 586305, **systemd-user-parented**, binds :3011, healthy (`/api/health` 200 in 6ms). 5 containerd-shim server.js = legit workspace container peers (KEEP). Earlier curl `000`s were purely the 475628→586305 restart-handoff window, not an outage.
- **NO_RESUME=1 on the live server** (`OVERDECK_RESUME_GATE_SOURCE=default`) — post-reboot failsafe boot posture (anti-thundering-herd; `reconciliation_grace_secs=120`). Deacon is running + patrolling (event processing, stuck-pokes, merge scheduling all work); only *stopped-agent auto-resume / orphan recovery* is gated. **Kept it** for the drain: all 10 genuinely in-flight items have LIVE running agents (advance via events), and the 37 stopped agents are residue (dead-workspace/closed/paused — deacon correctly skips them). Blanket resume would resurrect dead work — wrong for a drain. Deferred a restart-to-lift because 2 review + 1 test agents are mid-flight and a restart could drop their verdict POST (the PAN-2341 advancing-ceiling jam).
- **Load oscillation (5↔19) was legit busy drain work, NOT a runaway:** agents hitting `bd list`/`bd ready` + `vitest run` simultaneously (PAN-2086 then PAN-2294 test suites), plus a pathological `pan …--help` burning ~138% CPU (transient) and test-agent-spawned server.js boots (legit integration-test activity — verified before NOT killing). RAM 18–28G/64G, no swap — no OOM risk.
- **Drain flow:** 5 items ready-for-merge pooled at the UAT gate (correct drain end-state): PAN-2338 (#2342), PAN-2325 (#2328), PAN-1917 (#2279), MIN-831 (!68), MIN-846 — all review+test passed, awaiting operator UAT go/no-go (require_uat_before_merge=ON). 10 agents running (1739 swarm×2, 2086, 2194, 2284, 2294 work; 2145/2318 review; 2257/2318 test).
- **Reboot un-stuck PAN-2284** — the swarm slot that was idle 19h pre-pause got a fresh session at boot; now running (idle 11m).
- **PAN-2311 (critical substrate: strike-PR/UAT-batch merges don't reconcile) DRIVEN.** Was the one genuinely non-flowing item: paused `needs-you: verification stuck 2/3 (test)`, PR #2317 CONFLICTING/DIRTY. Diagnosed root cause: branch **95 behind origin/main** with **REAL** conflicts (merge-tree exit 1) in scripts/file-size-baseline.txt + 2 test files that overlap its own merge-machinery edits. Verification stalled because it retried without merging the drift. `pan start pan-2311 --force` (codex/gpt-5.5 work-tui, context+5 beads loaded, kickoff delivered) + a root-cause `pan tell` (merge main → resolve 3 conflicts → re-verify → pan done). Watch next tick; if it stalls again, surface to operator.
- **PAN-1847** = stale review-status residue (no agent state / no work history) — orphaned feedback-delivery target, NOT a live item. Leave.

## RUN-55 tick 2 (2026-07-04 ~14:47Z) — merges cascading; swarm slots stranded by reboot state-loss

- **3 Overdeck merges progressing (serialized, no race):** PAN-2325 (id 12) rebased onto main + force-pushed 02ffd35dd8 (work agent resolved the .pan/test/result.json conflict by keeping it ignored — the PR's own fix), CI `test` re-running → PR #2328 MERGEABLE/UNSTABLE. PAN-2338 (#2342) + PAN-1917 (#2279) queued `pending` behind it. Engine merges one-at-a-time (only one `status=merging` advances; the other stays pending). Confirmed NOT wedged despite ~10min — it's rebase(7m)+CI-reverify. main still 687a337448 until 2325's CI goes green.
- **PAN-2294 stale-BLOCK fixed:** review had blocked on `sessionExistsSync` in uat-promote-notify.ts that the branch HEAD (cbd7f924a0) does NOT contain (0 sync-exec occurrences — reviewed a pre-fix commit). `pan review restart PAN-2294` → **re-review PASSED**. Lesson: verify the review's cited blocker against the actual branch HEAD before trusting a BLOCKED verdict — force-pushes/late commits produce stale blocks (review-thrash family).
- **PAN-2311 (resumed tick-1) healthy:** resolved its 3 real conflicts, merged main, typecheck+lint passed, now running full `npm test` (background). The `pan start --force` resume + root-cause tell worked.
- **⚠️ Swarm slots stranded by reboot state-loss — carry:** PAN-1739 (2 slots), PAN-2194 (slot-1), PAN-2284 (slot-1) all ran `pan done` + pushed work (preserved on branches) but are idle 36-40m with NO issue-level review spawned. Root cause: `/api/swarms/<id>` returns "not a swarm" for all three (swarm runtime coordination state lost on reboot), and PAN-2284's continue.json/spec.vbrief.json are also gone. Deacon just poke-loops them: `First-completion gate: skipping … has review status entry (readyForMerge=false)`. Work is safe; advancement is stuck. NOT attempting blind swarm-recovery surgery in an autonomous tick — needs operator-aware recovery (pan swarm recover vs issue-level re-review). Filed conceptually as a reboot-reconciliation gap (swarm runtime state should rebuild from git/tmux like agents do, PAN-2341 family).
- **PAN-2086 test risk carry:** review passed but its agent reported `npm test failed broadly across guard/Git/PTY suites and hung`. Watch the test gate.
