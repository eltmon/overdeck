# Pipeline reliability review: PAN-3836 and the substrate around it

**Date:** 2026-09-16 (all times UTC)
**Author:** conversation on Fable 5.1, handed off from the session that shepherded PAN-3836
**Subject issue:** [PAN-3836](https://github.com/eltmon/overdeck/issues/3836), PR #3838
**Code read at:** `~/Projects/hoff-pipeline-review` on commit `3d5051040a2` (origin/main at the time of review). File and line references below point at that commit.
**Out of scope:** work-agent quality (the haiku-tier failures). The operator has already retuned the tier table.

---

## Glossary

- **Record.** The per-issue JSON file on the `overdeck-state` branch (`records/pan-3836.json`). It is the durable home of pipeline verdicts and progress.
- **Review-status row.** The SQLite row in `overdeck.db` table `review_status` that mirrors the record's `pipeline` block. Most code reads and writes this row, not the record.
- **Anchor.** A git commit SHA stored beside a verdict: `reviewedAtCommit` (which commit the review approved) and `lastVerifiedCommit` (which commit the verification gate passed).
- **Verification gate.** The typecheck, lint, build, and test commands from `quality_gates` in `projects.yaml`, run by `verification-runner.ts` after `pan done` and before review.
- **Convoy.** One review cycle: four reviewer sessions (security, correctness, performance, requirements) plus one synthesis parent session, all Claude Code sessions in tmux.
- **Deacon.** The background patrol process (`deacon.js`) that runs 78 checks in one sequential pass on a nominal 60-second timer.
- **Patrol.** One of those checks. "Recovery" patrols exist to repair state that a normal transition failed to write.
- **Monitor mail.** The PAN-3015 delivery tier: the sender writes a file into `~/.overdeck/agents/<id>/mail/`, and a `pan monitor` background task inside the agent's own Claude session prints it to stdout. Explained in Appendix B.
- **Placeholder.** A `state.json` written before the real spawn runs, with `model: "pending-work-spawn"` and `status: "starting"`.
- **Parked.** An issue that no autonomous path will advance. `pan parked` lists them by "orbit" (stuck-flag, needs-you, operator-gate, and so on).

---

## 0. Verdict and the three recommendations

**Verdict.** The pipeline's stages are sound. Its substrate is over-built, and the over-building is the direct cause of most of what went wrong on 2026-09-16. Seven review cycles produced correct verdicts; UAT caught a real router bug; verification caught a real red test on main. Every manual intervention was needed because the machinery *between* stages lost or mis-stated a fact: who is alive, which commit was approved, whether a message became a turn, whether a spawn succeeded. Those facts are held in twelve places for one agent and at least ten places for one verdict, and 78 patrols spend every cycle trying to make the copies agree. The patrols are not a safety net over a working transition. For several transitions they *are* the transition: a reviewer exiting normally is recorded as an "orphan recovery" (93 times for this one issue today), and 104 of the 256 issues that ever opened a PR carry the tombstone that says the `pan done` to review hand-off had to be recovered.

A large refactor is warranted, but a narrow one: **consolidate the substrate, keep the stages.** The target is the operator's own end-state design in `docs/API-SURFACE.md` (one write door, database as cache), plus one rule that design does not state and that this incident proves necessary: **every normal completion writes its own terminal state synchronously, in the same write as its evidence, so that patrols become alarms and never actors.** Section 8 gives the concrete shape and what to delete. Section 9 phases it so each step ships alone with a no-loss audit.

About half the faults are ordinary gate and tooling bugs that no state refactor touches (lint ratchet attribution, missing `it.skip` detection, a single overwritten gate-output file, CI trusting a partial test stamp, `pan tell` printing success on failure). Section 10 lists them with effort so they ship regardless of the refactor decision.

**Top three recommendations**

1. **Make delivery a confirmed turn or a loud failure, and remove monitor mail from the automatic path.** `messageAgent` returns `delivered: true` the instant it writes a mail file (`src/lib/agents/messaging.ts:540-546`). Nothing checks that the agent's transcript grew. The UAT feedback at 18:45 was "delivered" this way and the agent never took a turn; its transcript stopped at 18:24 and has no entry after 18:40. Delivery must go through the PTY supervisor and be confirmed against the transcript, the way `resumeAgent` already confirms (`src/lib/agents/resume.ts:608-613`), or fail and say so. The operator has stated that monitor mail was built for a future use case and should not be the everyday path. (Section 4, F12; Appendix B.)
2. **Write verdict, anchor, and cycle in one record write, and never let a patrol reset a passed verdict.** The verdict write door has a "no evidence" branch that lands a `passed` verdict while keeping the previous cycle's `reviewedAtCommit` (`src/lib/cloister/review-verdict-writer.ts:146-153`). The drift patrol then compares that stale anchor against live HEAD and resets the approval (`deacon-post-review-commits.ts:87-91, 152-158, 173`), which is what the 18:29 "Reset review ... (3cab2fdf → fcad7fae)" line was. Worse, a stale anchor that happens to equal `lastVerifiedCommit` auto-passes both the test role and verification in one write (`src/lib/review-status.ts:480-493`). A terminal verdict without an anchor must be refused, not landed. (Section 4, F10 and F11.)
3. **Turn recovery patrols into alarms with a firing budget, and make each normal transition write its own state.** Concretely: reviewer exit writes `stopped`; `pan done` enqueues the review request in the same transaction that writes the completion marker; the record lock becomes per-issue and never spans a git push; `checkOrphanedCompletions` gains the convoy-liveness guard its sibling already has (`deacon-review-status.ts:637-642` versus `deacon.ts:1181-1206`); `reconcileInFlightJournals` stops comparing an enriched read against a raw row (`advancing-selfheal.ts:55-57` versus `review-status-read.ts:80`). Any patrol whose daily firing count exceeds the number of issues it touched is a bug in a transition, not a safety net. (Sections 6 through 9.)

---

## 1. Live items for the operator (as of 19:20 UTC)

- **PAN-3836 carries a stale stuck flag in the database.** `overdeck.db` row `review_status` has `stuck=1, stuck_reason=verification_stuck, stuck_at=18:10:50`, while the record says `verificationStatus: passed` and verification did pass again at 18:53 (`.overdeck/verification-latest.json`, `ranAt: 18:53:42, outcome: passed`). `pan parked` therefore lists PAN-3836 as "stuck-flag: verification exhausted its cycles". Patrols skip stuck issues (`deacon-review-status.ts:393, :512`; `deacon-merge.ts:790`; `deacon.ts:1416`). Once the UAT rework lands, run `pan unstick PAN-3836` or the deacon will not advance it.
- **Two finished sessions hold concurrency slots.** `agent-pan-3836-test` (test passed 18:40) and `strike-pan-3839` (merged as #3840) are `running` in `state.json`, the database, and tmux, with tmux activity equal to session creation. `pan parked` already flags `strike-pan-3839` as a zombie session.
- **The fresh work session started at 18:57 has no context from the first session** (new session id `b1ffc4a2`; the old transcript `ce1915ba` is 26.7 MB and is preserved). The UAT feedback was re-sent by hand at 18:57:50.
- **Local `main` in the primary checkout is one commit ahead of `origin/main`** (`c7e4ba6d78b`, PAN-3834). It was carried into PR #3838 as commit `6b5c5bac33e`. Either push it or expect the same drift on the next `pan start`.

---

## 2. Scope, method, evidence, caveats

**Method.** I read the PAN-3836 agent directory (`spawn.log`, `lifecycle.log`, `state.json`, sidecars), the workspace artifacts (seven `.pan/review/<runId>/` directories with `context.json` and `synthesis.md`, `.pan/test/result.json`, `.overdeck/verification-latest.json`), the record on `overdeck-state`, the `overdeck.db` rows, the deacon log (`~/.overdeck/logs/deacon.log`, 135,502 lines) and dashboard log, the Claude transcript of the first work session, and the code paths for spawn, delivery, review anchoring, patrols, gates, and CI. Four read-only code explorers produced line-cited traces; every citation below was taken from those traces or from my own reads.

**Corpus for recurrence.** All 747 per-issue records under `~/.overdeck/state/panopticon-cli/records/`, the MIN-889 record under `state/mind-your-now/`, `pan parked` output (39 issues in 80 orbits), and review-run directories still on disk in 113 workspaces.

**Caveats you should know before trusting the numbers.**

- The deacon log covers only 2026-09-09 to 09-11 and 09-16 in volume (79,331 lines on 09-09, 39,329 on 09-16); 09-12 through 09-15 have zero lines. "Last 7 days" means those four days.
- Dashboard log lines have no timestamps. I could count verification runs but not time them from that log.
- Review cycles are not recorded durably. `reviewCycleHistory` exists in 1 of 747 records and only counts blocked cycles (`src/lib/review-status-reconcile.ts:123-125, 156-167`). The only trace is the `.pan/review/<runId>/` directories, which close-out deletes. Cycle counts below are therefore for workspaces still on disk.
- Evidence from the 18:45 delivery is gone. The PTY supervisor log for `agent-pan-3836` was truncated at the 18:57 respawn (53 lines, all from the new session), and `mail/read/` holds files only up to 17:17. The mail files the previous session saw at 18:45 to 18:47 no longer exist.

---

## 3. What PAN-3836 cost

| Stage | Count | Notes |
| --- | --- | --- |
| Planning session (Fable 5.1) | 1 | 14:16 to 14:28 |
| Work agent sessions (Haiku 4.5) | 2 | 14:31 (after manual recovery) and 18:57 (after manual recovery) |
| `pan done` | 1 | 16:30, PR #3838 |
| Verification gate runs | 16 | 14 launched by `[durable-review]`, 1 by `[review]`, 1 by `[request-review]`; each 8 to 13 minutes (typecheck 56 s, lint 168 s, build 56 s, test 195 to 435 s) |
| Review cycles | 7 | run ids by head: `99b95766`, `1e4ae61d`, `591e9a2c`, `25d2d8f5`, `3cab2fdf`, `fcad7fae` (approved 18:28), `29c8eff1` (approved, "pure origin/main merge with zero feature-file changes") |
| Reviewer sessions (k3) | 35 | 7 cycles × (4 reviewers + 1 synthesis) |
| Test specialist (Sonnet 5) | 1 | passed 18:40; a second path also wrote the pass from green CI at 18:39:49 |
| UAT agent | 1 | failed 18:45, correctly |
| Strike for a bug the issue did not cause | 1 | PAN-3839, k3, landed as #3840 |
| Operator interventions | 4 | `reset-session` + `start` at 14:31; `strike PAN-3839`; `kill` + `reset-session` + `start` at 18:55 to 18:57; manual re-send of UAT feedback at 18:57:50 |
| Deacon "recovery" actions naming this issue | 120+ | 93 "Recovered orphaned agent" (reviewer exits), 8 `checkOrphanedCompletions`, 8 "Drained stranded verdict fallback", 2 idle nudges, 1 dead-end nudge, 1 review reset, and "Reconciled journaled advancing verdict" on every cycle from 14:36 onward |
| Cost at 18:56 | $37.25 | record `closeOut.usage.costAtCloseOut` |
| Wall clock to first approval | 4 h 12 min | 14:16 to 18:28 |
| State at 19:20 | unmerged | UAT rework in progress in a fresh session |

Most of the sixteen verification runs and five of the seven review cycles were spent on fixes that were either uncommitted when re-review was requested or were flake-masking (`it.skip`) rather than fixes. (Runs cannot be attributed to cycles precisely because the dashboard log carries no timestamps.) That is a work-agent quality problem and out of scope, but the substrate let every one of those cycles cost a full convoy and a full gate run.

---

## 4. Fault-by-fault analysis

Each fault has: what happened (with evidence), root cause (with code), the smallest fix, whether that fix is a patch on a patch, and the guardrail that would make the incident impossible rather than recoverable.

### F1. The planning-to-work auto-handoff died on the record lock (14:29)

**What happened.** `complete-planning` POSTed to `/api/agents`, which wrote a placeholder `state.json` and spawned `pan start PAN-3836 --local --model k3` as a detached child (`agents/agent-pan-3836/lifecycle.log` 14:29:16). The child's `[prep] state-reconcile` step waited on `~/.overdeck/locks/state-git/ba3f….lock`, printed "held by process-134668 ... acquiredAt 14:29:46", and exited 1 at 14:29:49 (`spawn.log`; `lifecycle.log` `agent.work_spawn_process_closed code:1`).

**Root cause.** Four facts compound.

1. The lock is per-project, not per-issue, despite its error text. `stateGitLockPath` hashes the state worktree root (`src/lib/pan-dir/state-git-lock.ts:24-27`), so every record write in `panopticon-cli` serializes on one file.
2. The lock is held across a git commit and push, bounded by a 30-second durability budget (`src/lib/pan-dir/record-update.ts:34, :520-536`).
3. The waiter's backoff ladder sums to 30.7 seconds (`state-git-lock.ts:7-20`) and then throws (`src/lib/pan-dir/fs-lock.ts:82-108`). A 30-second hold against a 30.7-second wait is a coin flip.
4. The holder was the deacon's strike-salvage patrol. It pushed 28 strike branches at 14:29:34, and the state branch then received 23 record commits in 70 seconds (14:29:31 to 14:30:41), 18 of them for issues on that push list, one `chore(records): update PAN-… per-issue record` every 2 to 3 seconds. The spawn's 30-second window fell entirely inside that burst.

Nothing retried above the lock: `state-reconcile` is `fail-fast` (`src/cli/commands/start-prep-progress.ts:92-97, :140-146`) and `start.ts:1268-1270` exits 1. The step only exists because the dashboard always passes `--model`, and persisting that override goes through the record write door (`start-policy-overrides.ts:22, :52`). The spawn did not need a durable record write to proceed.

**Smallest fix.** Persist the model override *after* the session is up, or pass it as spawn input only. Make the lock per-issue and release it before the push. Either change alone removes this failure.

**Patch on a patch?** Yes if you add a retry. The 30-second budget (PAN-2989) was itself a patch on lock starvation; the verdict-fallback file and its sweeper (Section 4, F15) are a second patch on the same lock. A retry would be the third.

**Guardrail.** Spawning an agent must not take the record lock at all. The record write happens after spawn, off the critical path, and a patrol that writes N records in a burst must yield the lock between records.

**Recurrence.** PAN-1641 has been parked with `stuck: planning_auto_handoff_failed` for 33 days (deacon log 09-09, 09-10, 09-16 "re-surfaced").

### F2. The dead spawn left an unrepairable placeholder, and `pan start` refused to replace it

**What happened.** `state.json` stayed `{status: "starting", model: "pending-work-spawn", startedBy: "planning-auto-handoff"}` with no tmux session. The deacon flipped it to `stopped` at 14:31:21 ("Recovered orphaned agent ... starting→stopped"). `pan start PAN-3836` then refused: "has a resumable Claude session". The operator ran `pan reset-session` and `pan start`.

**Root cause.**

- Rollback of the placeholder is conditional on the SQLite row still being that placeholder (`src/dashboard/server/services/agent-projection.ts:248-250`) and on the dashboard route surviving the whole child run (`routes/agents/shared.ts:114-116`).
- The deacon's flip leaves `model: "pending-work-spawn"` in place (`src/lib/cloister/deacon-auto-resume.ts:198-202`), and the two placeholder predicates disagree: the lifecycle model requires `status === 'starting'` (`src/lib/work-agent-lifecycle.ts:112`), the resume path does not (`src/lib/agents/resume.ts:169`). After the flip, the lifecycle no longer sees a placeholder.
- The planner's transcript is adopted as the work agent's session. `cleanupOrphanedPlanningSessions` keeps the planning session because no work agent is running (`deacon-auto-resume.ts:312-317`), so its JSONL is the only file in the workspace's Claude project directory, and the "exactly-one transcript-directory scan" adopts it with no owner or role check (`src/lib/agents/activity.ts:255-258`). With a saved session and a resumable transcript, `requiresSessionResetBeforeFreshStart` is true (`work-agent-lifecycle.ts:130`) and `pan start` throws (`:341-343`).
- `reconcileLiveWorkSpawnPlaceholder` cannot help: it runs only when a tmux session exists (`deacon-auto-resume.ts:171, :183-186`) and needs `launcher.sh` and `session.id`, which the dead child never wrote (`src/lib/agents/pinned-launch.ts:42-46`).

**Smallest fix.** On child exit non-zero, delete the placeholder state unconditionally. Never adopt a transcript by directory listing; require the session id to be one the agent wrote.

**Patch on a patch?** The placeholder, its rollback, and the transcript-scan repair are three layers already. Deleting the placeholder and the scan is a removal, not a patch.

**Guardrail.** Session identity flows one way: the spawner allocates it and writes it before launch (which the real spawn already does, `lifecycle.log` "session identity allocated"). No code path infers identity from what files happen to exist.

### F3. Scope drift flagged five files from an unpushed commit on local `main`

**What happened.** The record's `scopeDrift.outsideDeclaredScope` names `TalkItThrough.tsx`, `command-deck.module.css`, `docs/DASHBOARD-ARCHITECTURE.md`, and two test files, none of which PAN-3836 touched.

**Root cause.** The branch was cut from the primary checkout's local `main` (workspace reflog: `feature/pan-3836@{31}: branch: Created from main` at `c7e4ba6d78b`), which was and still is one commit ahead of `origin/main` (PAN-3834, unpushed). That commit was later rebased into the branch as `6b5c5bac33e` and shipped inside PR #3838. The drift check diffs `origin/main...HEAD` without fetching (`src/cli/commands/done.ts:291-293`), so the foreign commit's files count as this issue's changes.

**Smallest fix.** `pan start` cuts feature branches from `origin/<target>` after a fetch, never from local `main`. The drift check fetches first.

**Patch on a patch?** No. This is a missing invariant.

**Guardrail.** A workspace never inherits commits that are not on the remote target branch. Refuse to create a workspace while local `main` is ahead of `origin/main`, or ignore local `main` entirely.

### F4. Review cycles ran on uncommitted fixes

**What happened.** Cycle 2's synthesis says it outright: "all three cycle-1 blockers still present at committed HEAD (fixes sit uncommitted in the working tree, and the blocker-2 fix as written is ineffective)" (`.pan/review/agent-pan-3836-review-1e4ae61d/synthesis.md`). Cycle 3's fix was likewise still in the working tree.

**Correction to the brief.** Cycle 2 did not review the same HEAD as cycle 1. Its `context.json` records `headSha: 1e4ae61d…` (the CSS-import fix) versus cycle 1's `99b95766…`. The commit was new; the fixes reviewers wanted were not in it.

**Root cause.** Reviewers diff committed HEAD against the merge base (`src/lib/cloister/review-context.ts:134-143, :153`); the working tree is invisible to them, which is correct. But nothing refuses a re-review request when the tree is dirty or when HEAD equals the last reviewed anchor. The one HEAD-change guard in dispatch (`review-agent.ts:363-374`) is skipped whenever `force: true` (`:362`), and the deacon's re-dispatch always passes `force: true` (`deacon-post-review-commits.ts:191-196`).

**Smallest fix.** `pan review request` and the deacon re-dispatch both refuse when `git status --porcelain` is non-empty or HEAD equals `reviewedAtCommit`, and say why. The agent prompt already states "Uncommitted changes = NOT COMPLETE"; make the gate enforce it.

**Patch on a patch?** No. It is a precondition on an existing door.

**Guardrail.** A convoy can only be dispatched for a HEAD that differs from every previously reviewed anchor, on a clean tree. Cost of a violated guardrail today: five sessions and an 8 to 13 minute gate run.

**Recurrence.** Memory note `project_review_thrash_uncommitted_fix.md` records the same shape on PAN-2203 (2026-07-01). MIN-889 has 16 review-run directories on disk; PAN-3668 has 10.

### F5. The Effect-diagnostics ratchet blamed an unchanged file

**What happened.** The lint gate failed 312 versus baseline 308 and listed `routes/settings.ts` under "NEW:", which the branch did not change. The real additions were two `Effect.tryPromise` catches in `routes/projects.ts`.

**Root cause.** The count is per line (308 rows), but the "NEW:" attribution runs `comm` over normalized keys with line and column stripped and `sort -u` applied (`scripts/lint-effect-diagnostics.sh:87-89, :108-113`). Measured on the live baseline: 308 rows collapse to 51 keys; `settings.ts` has 10 rows and 2 keys; `projects.ts` has 6 rows and 2 keys; 75 rows are multi-line diagnostic tails carrying no file name at all. A new finding whose key already exists in the baseline is absorbed into "known:", and "NEW:" shows only rows whose message text drifted, which can be any file.

**Smallest fix.** Compute a per-file, per-rule count delta against the baseline (`uniq -c` on the normalized key, then compare counts) and print files whose count rose.

**Patch on a patch?** No. The attribution was unsound from the start; the note at lines 112-113 admits half of it.

**Guardrail.** A ratchet must name the file whose count increased, or it is not an attribution.

### F6. The deacon nudged a working agent as a dead end (17:11), and idle-nudged it twice mid-item

**What happened.** "Dead-end recovery: nudged agent-pan-3836 (review failed, idle for 8m)" at 17:11:28. The agent's transcript has 61 entries in the 17:11 minute and 26 Bash calls between 17:03 and 17:12. Earlier, "Nudged idle agent-pan-3836 — 4 ready task(s)" at 15:24 fell inside a task claim held from 14:53 to 15:35.

**Root cause.** "Idle for 8m" is the age of the review-status row's `updatedAt`, not any agent signal (`src/lib/cloister/deacon.ts:1998`). The idleness test short-circuits to true whenever the Stop-hook mirror says `idle` (`src/lib/cloister/agent-idle.ts:82`), which it does between the end of one turn and the harness waking the next. The nudge bypasses the whole delivery stack and types raw keystrokes (`deacon.ts:1997` calls `sendKeys` directly).

**Smallest fix.** Define idle as "transcript has not grown for N minutes and the pane shows the prompt", in one function, and route the nudge through `messageAgent`.

**Patch on a patch?** The `getAgentWorkActivityMs` function was written for exactly this false negative (`agent-idle.ts:34-45`, PAN-3677 comment) and this call site does not use it. Wiring it in is finishing a fix, not stacking one.

**Guardrail.** One liveness function, one idle function, both transcript-based, used by every patrol.

### F7. The agent skipped three failing tests and nothing mechanical noticed

**What happened.** Commit `95b735a909c` "skip timeout-prone useProjectCreateIntent tests" passed the gate; a reviewer caught it in cycle 4.

**Root cause.** No detection of `.skip`, `.only`, `xit`, or removed tests exists anywhere: not in `.eslintrc.cjs`, `scripts/`, `.husky/`, the workflows, or the review prompts. The only `.only` guard is vitest's `allowOnly`, which is active only under `CI=true`, and the CI vitest step is the one `skip_vitest=true` bypasses (F9). The test-delta gate counts added lines in test files (`src/lib/work/test-requirement-gate.ts:91`), and `it(` to `it.skip(` adds a line.

**Smallest fix.** A verification gate step that fails if the diff adds `\.(skip|only)\(` or `x(it|describe|test)\(` in test files or reduces the count of `it(`/`test(` calls; set `allowOnly: false` in `vitest.config.ts`.

**Patch on a patch?** No.

**Guardrail.** Mechanical, in the gate, before any reviewer spends a session.

### F8. Every verification run overwrote the previous run's output

**What happened.** The failing output of the 17:29 run existed only until the 17:57 run started. The previous session copied both within seconds to read them.

**Root cause.** `verification-latest.json` is one file, rewritten on every run and on a one-second cadence during a run (`src/lib/cloister/verification-artifact.ts:6-9, :38, :70-73`; `verification-runner.ts:585-593`). Passing gates keep no output (`verification-artifact.ts:64-66`). The feedback message tells the agent to read that same volatile path (`verification-runner.ts:669-670, :688`). Sixteen runs today produced one surviving output.

The same class: the PTY supervisor log is truncated at respawn; the `mail/` directory was reset at respawn; `.pan/review/` directories are deleted at close-out; `continues/` on the state branch has no file for this issue.

**Smallest fix.** Write `.overdeck/verification/<ranAt>-<head8>.json` per run and point `latest` at it. Feedback references the immutable file.

**Patch on a patch?** No.

**Guardrail.** No pipeline artifact is ever named "latest". Every run writes a new immutable file under the issue or agent directory.

### F9. A red test on `main` was invisible to CI and cost PAN-3836 the verification gate

**What happened.** `ModelPicker.test.tsx` expected five experimental harness rows; `HARNESS_OPTIONS` on `origin/main` had six. PAN-3836's diff reached the file, so its scoped test run executed the test and failed on a bug it did not cause. PAN-3839 was struck and landed (#3840) to unblock.

**Root cause.** CI skips vitest when the sha already carries `overdeck/test=success` (`.github/workflows/ci.yml:139-158, :186, :190`). That stamp is written from a `vitest run --changed origin/<target>` subset (`verification-runner.ts:517-522, :918-927`), from the test specialist's self-reported verdict (`routes/workspaces.ts:1621-1622`), and from the merge path after a synthesized pass when CI was already green (`merge-ops.ts:1002-1028, :1087`). The links cite each other and none runs the full suite. Twelve files are quarantined under `OVERDECK_VERIFICATION=1` (`vitest.config.ts:10-13, :51-52`). The stamp binds to `git rev-parse HEAD` at stamp time, not the tested sha (`src/lib/github-app.ts:813-818`). The test role is skipped whenever the two anchors match (`src/lib/review-status.ts:480-493`); 191 of the 290 records with test notes say "Skipped: no code changed since pre-review verification gate".

**Smallest fix.** Delete the `skip_vitest` step from `ci.yml`. CI runs the full suite on every push. Overdeck stamps `overdeck/test` only from a run whose command was the full suite, and binds the stamp to the sha it tested.

**Patch on a patch?** The skip was an optimization layered on a partial gate. Removing it is a removal.

**Guardrail.** Main's health is measured by a scheduled full-suite run on `main` that no PR stamp can satisfy.

### F10. The deacon reset an approved review against the previous cycle's anchor (18:29)

**What happened.** Cycle 6 approved `fcad7fae` at 18:28. At 18:29:52 the deacon logged "Reset review for PAN-3836: new commits after review passed (3cab2fdf → fcad7fae)" and "Re-dispatched review". `3cab2fdf` was cycle 5's head.

**Root cause.** The drift patrol compares the stored `reviewedAtCommit` against a fresh `git rev-parse HEAD` (`deacon-post-review-commits.ts:87-91`; `workspace-anchor-drift.ts:79-81`). The anchor can lag one cycle by three mechanisms: the CLI snapshots HEAD before the door runs its git probes and the locked write (`src/cli/commands/specialists/done.ts:156-164, :236-243`); the door's no-evidence branch lands the verdict without touching the anchor when the snapshot is missing (`review-verdict-writer.ts:146-153`), which happens for any degraded polyrepo resolution (`git-utils.ts:403`); and blocked verdicts write the anchor in a deliberate second write (`done.ts:335-352`). Twelve distinct sites write `reviewedAtCommit`, including the drift patrol itself (`deacon-post-review-commits.ts:99`). The code already documents this family: MIN-901 suffered 425 resets against one anchor (`deacon-post-review-commits.ts:21-25`; `git-utils.ts:399-402`).

**Smallest fix.** The door refuses a terminal verdict that has no evidence anchor. The drift patrol never resets a `passed` verdict; it marks the row "stale, needs a new `pan done`" and stops.

**Patch on a patch?** The `benign` classifier and the PAN-3254 loop breaker are two patches on this already. Refusing anchorless verdicts is a removal of a branch.

**Guardrail.** Verdict and anchor are one value written once. There is no verdict without an anchor.

### F11. A stale anchor can auto-pass the test role and verification in one write

**What happened.** Not hit today (the test specialist ran), but structural and adjacent to F10.

**Root cause.** When a review passes and `reviewedAtCommit === lastVerifiedCommit`, the fan-out writes `testStatus: passed`, `verificationStatus: passed`, and skips the test role (`src/lib/review-status.ts:480-493`). Combined with the no-evidence branch (F10), a `passed` verdict can carry a previous cycle's anchor that coincidentally equals `lastVerifiedCommit`. Memory note `project_test_skip_lies_about_tests.md` records MIN-901 shipping compiled-but-never-run regression tests through this skip on 2026-07-25.

**Smallest fix.** Remove the skip. If the project wants a fast path, it must be an explicit `verification_covers_tests: true` in `projects.yaml`, as that memory note proposed.

**Guardrail.** No verdict is derived from the equality of two strings written by two different producers.

### F12. UAT feedback was "delivered" and the agent never took a turn (18:45)

**What happened.** `lifecycle.log`: "messageAgent delivered via monitor mail (caller: internal)" at 18:45:41 and 18:46:14, and "(caller: pan-tell)" at 18:47:02. The transcript `ce1915ba….jsonl` has its last entries at 18:24 and zero entries after 18:40. The pane showed an idle prompt with the Stop-hook text. The deacon at 18:56:18 recommended "start a work agent ... the UAT-failure relay found no live target".

**Root cause.**

- The monitor tier returns `delivered: true` immediately after `writeFileSync` (`src/lib/agents/messaging.ts:540-546`). Nothing verifies a turn started. The eaten-message watcher runs only on the keystroke path (`:629-635, :656`), after the monitor tier has already returned.
- What turns a claimed mail file into a turn is a `console.log` inside `pan monitor` (`src/cli/commands/monitor.ts:56`), a background task the *model* is instructed to start (`roles/work.md:60-63`). Whether the harness wakes an idle session on background stdout is harness behaviour outside this codebase, and on this evidence it did not.
- The claim-then-emit race is documented and unmitigated: a monitor exit between rename and print loses the wake, and the file is already in `mail/read/` (`messaging.ts:534-539`; `monitor-transport.ts:178-188`).
- After the operator's `pan kill --force` (which is always `cause: 'operator'`, `src/cli/commands/kill.ts:135`), `stoppedByUser` gated `pan tell` ("queued mail without resume: agent was stopped by the operator", `messaging.ts:304`; `agent-state.ts:875`). The PAN-2668 exception requires `owesRework: true`, which the UAT relay passes (`uat-failure-feedback.ts:141`) but `pan tell` does not (`messaging.ts:233-249`; `agent-state.ts:897-900`).
- `pan resume` said "finished and handed off (completion marker on disk), nothing to resume" because `issueOwesReworkSync` checks verification, review, and test failures **but not `uatStatus === 'failed'`** (`src/lib/work-agent-lifecycle.ts:30-40`). A failed UAT does not count as owing rework, so the completion marker wins.
- The sweeper's "no live target" uses a third definition of live (`src/lib/parked/resolver.ts:461`: `tmuxActive && status running|starting`) that differs from the relay's `sessionExists` (`feedback-target.ts:81-83`), which itself accepts a remain-on-exit dead shell (`messaging.ts:294-298`).

**Smallest fix.** Remove the monitor tier from `messageAgent`'s automatic cascade (keep `pan inbox` as a manual tool). Add `uatStatus === 'failed'` to `issueOwesReworkSync`. Make `pan tell` pass `owesRework` when the record shows any failed verdict.

**Patch on a patch?** The monitor tier (PAN-3015, 2026-07-24) was itself a patch on keystroke-injection failures (PAN-1769, PAN-2228, PAN-1988, listed in `docs/MONITOR-TRANSPORT.md`). Removing it and fixing the supervisor path is a removal.

**Guardrail.** `messageAgent` returns success only after the transcript shows a new turn that contains the message, or it fails and the caller escalates. `resumeAgent` already implements this contract (`src/lib/agents/resume.ts:608-613`).

**Recurrence.** Eight issues are parked as "review/test feedback could not be delivered — the work agent is not running and nothing resumed it" for 7 to 34 days (PAN-3679, 3677, 3685, 3689, 3690, 3740, 3810, 3814). PAN-3836 is parked under a different stuck reason (Section 1). PAN-3703 is parked as `uat-failed` with "no work agent is live to rework it" for 26 days, the exact PAN-3836 shape.

### F13. The pipeline committed a merge of `origin/main` into the branch under the bot identity (18:45:42)

**What happened.** Commit `29c8eff1` "Merge remote-tracking branch 'origin/main' into feature/pan-3836", author `panopticon-agent[bot]`, unpushed at the time, later pushed and reviewed as cycle 7.

**Root cause.** `syncMainIntoRepo` runs `git merge origin/<target>` (`src/lib/cloister/merge-agent.ts:1285`) after auto-committing any dirty work (`:106, :140`). Its callers are `start.ts:1034` (existing workspace), `merge-ops.ts:274`, and `sync-main.ts:67`. The bot identity comes from the workspace git config set at creation (`src/lib/github-app.ts:733-734`); no author override exists. Which caller fired at 18:45 is not recoverable because dashboard log lines carry no timestamps.

**Smallest fix.** Log the caller and time of every sync-main; push or discard in the same step, never leave a local-only merge commit on a branch the pipeline will review.

**Guardrail.** Any pipeline-made commit on a feature branch is pushed in the same operation, or not made.

### F14. `pan tell` hung after the message landed, and prints success on failure

**Root cause.** `tell.ts:29-31` prints "Message sent" without inspecting `outcome.delivered`. The CLI exits when the event loop drains, and `messageAgent` starts a floating eaten-message watcher whose `setTimeout` is never `unref`'d, with a 5-minute deadline (`src/lib/agents/eaten-message-watcher.ts:15-17, :37-39, :53-67`; `src/cli/telemetry.ts:104-106`).

**Smallest fix.** `unref()` the watcher timers; exit non-zero and print the reason when `delivered` is false.

**Guardrail.** Every CLI verb's exit code reflects the outcome of the door it called.

### F15. Patrols fired on the happy path and against each other

**Evidence today, this issue only.**

- 93 × "Recovered orphaned agent agent-pan-3836-review-* (running→stopped) — tmux session missing". Each is a reviewer that finished and exited normally. Nothing writes `stopped` when a reviewer exits; the orphan patrol is the completion path (`deacon-auto-resume.ts:147-158, :198-202, :235-241`).
- 8 × "checkOrphanedCompletions: recovered PAN-3836 (PR open but review never dispatched)" at 16:35, 16:43, 16:51, 17:00, 17:19, 17:28, 18:00, 18:25, while a convoy was running each time. The predicate has no convoy-liveness guard (`deacon.ts:1181-1206`); its sibling does (`deacon-review-status.ts:635-662`). Its re-fire brake is a tombstone written in a second record write whose failure is swallowed (`deacon.ts:1207-1221`). Corpus-wide, 104 of 256 PR-bearing records carry that tombstone; the code comment at `src/lib/pan-dir/records.ts:112-115` records "36x on PAN-399".
- 8 × "Drained stranded verdict fallback for PAN-3836", each 2 to 3 seconds after one of the above (16:35:10.606 then 16:35:13.305; 16:43:18.295 then 16:43:20.844; and so on for all eight). A fallback exists only when a verdict write lost the record lock (`deacon-verdict-fallback-sweep.ts:1-9`). The timing says the orphan-completion patrol's own two-write sequence, `setReviewStatusSync` followed by `updateIssueRecord` for the tombstone (`deacon.ts:1207-1213`), contended with itself: the second write took the lock while the first write's journal flush still held it, the verdict fell back to the file, and the sweeper folded it back three seconds later. The patrol manufactures the contention it then repairs.
- "Reconciled journaled advancing verdict for PAN-3836" on every patrol cycle from 14:36 to the end of the log (2,791 such lines on 09-16 across issues; 5,450 on 09-09). It compares a raw DB row against an enriched read that overlays record fields and never writes them back, so the two can never agree (`advancing-selfheal.ts:55-57, :96-105`; `review-status-read.ts:80-83`; `review-status-record-sync.ts:139-151`). Each firing also runs two dispatch hooks.
- Status flaps: `lifecycle.log` shows the work agent cycling `running → stopped → running` about twenty times; `handleAgentStoppedEvent` and `handleAgentHeartbeatDeadEvent` are inverses keyed on the same tmux probe (`deacon-auto-resume.ts:719-727` versus `:200-202`).
- Cadence: 78 patrols run in one sequential pass (`deacon.ts:2611-3168`) on a 60-second timer (`:221`); overlapping ticks are dropped (`:3434-3437`; log 14:29:17 "patrol interval skipped — previous patrol still in flight"). Observed: cycles 11683 to 11738 span 14:29 to 19:11, about 5 minutes per cycle. `checkOrphanedCompletions` alone shells out to `gh pr list` per candidate with a 15-second timeout (`deacon.ts:1196-1199`).

**Smallest fix.** Add the liveness guard to `checkOrphanedCompletions`; make the reviewer launcher write `stopped` on exit (it already runs `pan tell REVIEWER_READY` on exit, `src/lib/launcher-generator.ts:600`); compare like with like in `reconcileInFlightJournals`.

**Patch on a patch?** Yes, all three, and that is the point of Section 7: these are transitions implemented as scavengers.

### F16. A review approval silently un-fails verification, and the stuck flag outlived the condition

**What happened.** Verification hit 3 of 3 cycles at 18:10:50 and marked `verification_stuck` (`verification-runner.ts:139-150`, which also pauses and stops the agent). Cycle 6 approved at 18:28. The record's `verificationNotes` became "Cleared by `pan specialists done review --status passed` override (PAN-1215)".

**Root cause.** `roles/review.md:205` instructs the review parent, an LLM, to run `pan admin specialists done review --status passed`. That command sets `verificationStatus: passed` with the comment "A human passing review assumes responsibility for the gate" (`src/cli/commands/specialists/done.ts:167-171`). The human is not in that loop. Verification did pass on its own at 18:53, so nothing shipped untested here, but the door is open. Separately, the DB `stuck=1` was never cleared (see Section 1).

Also: `docs/PIPELINE-GATES.md` says "After 3 consecutive failures, verification is bypassed to prevent permanent blocking". The code marks the issue stuck and pauses the agent instead. The verification cycle counter is reset to zero on every `pan review request` (`routes/workspaces/review-pipeline.ts:259-265`), so "3" bounds nothing per issue.

**Smallest fix.** The review verdict command never touches `verificationStatus`. A human override is a separate verb with a separate audit line.

**Guardrail.** One actor per verdict. An LLM's verdict can only set the field for the role that LLM played.

### F17. Prompts and docs describe a pipeline that does not exist

- The work prompt says feedback arrives in `.pan/feedback/` (agent initial prompt; `deacon.ts` stuck-flag recommendations say the same). The actual directory is `.overdeck/feedback/` (`src/lib/pan-dir/types.ts:11`; `getWorkspacePanPaths`). The workspace has no `.pan/feedback/`.
- `docs/PIPELINE-GATES.md` says failed-gate feedback "is sent to the agent's tmux session". Today it was written to a mail file.
- `docs/AGENT-STATE-PLANES.md` names tmux as "the liveness oracle". Three oracles are in use: the SQLite `agents` table for the orphan scan (`deacon-auto-resume.ts:266-268`), `state.json` for the lifecycle gate (`work-agent-lifecycle.ts:102`), and `tmuxActive && status` for the sweeper (`parked/resolver.ts:461`).
- `docs/REVIEW-AGENT-ARCHITECTURE.md` says the stall sweeper "is observation-only ... never ... un-parks an issue". That change removed the only autonomous exit from the stuck-flag orbit without replacing it; the result is ten issues parked up to 34 days with a recommendation nobody executes.
- The Claude Code harness memory guard killed two of the previous session's vitest runs while the gate ran; `free` and PSI showed no pressure. This is harness behaviour, not Overdeck code, and is noted for completeness only.

---

## 5. Recurrence across the pipeline

| Fault class | PAN-3836 | Elsewhere (evidence) |
| --- | --- | --- |
| Planning auto-handoff spawn failure | F1, F2 | PAN-1641 parked 33 days with `planning_auto_handoff_failed` |
| Feedback delivered but no turn; issue parks | F12 | 8 issues parked "feedback could not be delivered": PAN-3679, 3677, 3685, 3689, 3690, 3740 (31 to 34 days), PAN-3810, 3814 (7 days); PAN-3703 `uat-failed` 26 days |
| Review cycles without converging on committed code | F4 | MIN-889: 16 run directories; PAN-3668: 10; PAN-2203 (memory note) |
| `pan done` to review hand-off "recovered" by patrol | F15 | 104 of 256 PR-bearing records carry `panDoneRecoveredAt` |
| Verdict writes losing the record lock | F15 | "Drained stranded verdict fallback": PAN-3668 ×2, PAN-3344 ×1 in the log window |
| Test role skipped by anchor equality | F11 | 191 of 290 records with test notes are "Skipped: no code changed since ..." |
| Anchor disagreement between review and verification | F10 | 51 records have `reviewedAtCommit != lastVerifiedCommit` |
| Dead-end recovery firing | F6 | 53 firings on 09-09; PAN-3690, 3740, 3810 hit the 25/25 circuit breaker and are permanently parked |
| Orphan pickup escalations that went silent | — | 82 records with `orphan-proposed-pickup-gate` trips, 98 open trips; 28 issues parked `needs-you` for 45 days |
| Strike-landing patrol writing records in bursts | F1 | 23 record commits in 70 seconds at 14:29 |
| Green pipeline that still does not merge | — | PAN-3668 and MIN-889: review, test, UAT, verification all `passed`, `mergeStatus: pending`, open recovery trips |

The parked population is 39 issues in 80 orbits: operator-gate 28, needs-you 28, stuck-flag 10, merge-failed 7, circuit-breaker 3, zombie-session 1, uat-failed 1, deacon-ignored 1. Only 17 records were created since September 1, so most of the pipeline's current population is residue of these faults rather than live work.

Code churn in the substrate over the last 90 days: 688 commits touched `src/lib/cloister` and 347 of them (50 percent) are `fix:`; 221 touched `src/lib/agents`, 108 `fix:`. The cloister source references 239 distinct PAN issue numbers in comments, most of them incident-driven special cases. `deacon.ts` is 3,576 lines with 27 `deacon-*.ts` siblings; `src/lib/cloister` is 55,501 lines in 211 files, `src/lib/agents` 13,703 lines in 47 files, `routes/agents` 5,383 lines in 11 files.

---

## 6. Step back: moving parts and state holders

**Stages an issue passes through** (each a separate actor with its own liveness): planning session; `complete-planning` promotion; work agent spawn; work agent; `pan done`; verification gate (worker process, up to 3 cycles per request, 2 attempts per test gate); review convoy (5 sessions per cycle); synthesis; test specialist; UAT agent; merge door (GitHub-clean, server rebase, or agent conflict path); post-merge lifecycle; verify-on-main; deploy patrol; close-out. Fifteen stages, roughly ten of which are LLM sessions.

**Where "is this agent alive" is held** (from the spawn trace):

| # | Holder | Written by |
| --- | --- | --- |
| 1 | `agents/<id>/state.json` | `agent-state.ts:368-380, :427` |
| 2 | SQLite `agents` table (`overdeck.db`; a second `agents` table exists in legacy `panopticon.db`) | `agent-projection.ts:113-115` |
| 3 | tmux session (`-L overdeck`) | `spawn.ts:881` |
| 4 | Event store `events` projection (`agent.started` emitted before anything started) | `agent-projection.ts:116-118`; `spawn-helpers.ts:74-86` |
| 5 | `lifecycle.log` bracket lines | `persistent-logger.ts:53-59` |
| 6 | `lifecycle.log` JSON lines (a second format in the same file) | `composer-commands/detached.ts:70-84` |
| 7 | `runtime.json` mirror (idle/suspended/stopped) | `done.ts:143-146` |
| 8 | Agent-plane record on the state branch | `spawn.ts:685`; `agent-state.ts:355-358` |
| 9 | `completed` / `completed.processed` markers | `done.ts:879-888` |
| 10 | Per-issue record `harness`/`model` mirror | `agent-state.ts:384-385` |
| 11 | Session pointers (`session.id`, `sessions.json`) | `session-history.ts:87-106` |
| 12 | `health.json`, `monitor.json`, `ready.json`, `cv.json` sidecars | various |

Three of these are authoritative for three different consumers: #2 for the orphan scan, #1 for the lifecycle gate, #3 for "running". Three different answers are structurally possible, and today they were: `agent-pan-3836-review` was "running" in #1 and #2 while the deacon had "recovered" it to stopped at 18:32.

**Where a verdict is held:** the `review_status` row; the record's `pipeline` block; the record's top-level `scopeDrift` (duplicated inside `pipeline.scopeDrift`); `.overdeck/pipeline-verdict.json` fallback; `status_history` (43 rows for this issue); the `events` table; GitHub commit statuses `overdeck/test` and `overdeck/review`; PR comments; phase labels; `.pan/review/<run>/synthesis.md`; `.pan/test/result.json`; 473 stall-sweeper row files. Twelve sites write `reviewedAtCommit`. Twenty-one sites wrote verdicts when `docs/API-SURFACE.md` counted them.

**Where three recovery mechanisms compete:** review re-dispatch (`checkOrphanedCompletions`, `checkOrphanedReviewStatuses`, `checkPostReviewCommits`, plus `reconcileInFlightJournals`' hooks) all decide whether a convoy should start; agent liveness (`handleAgentStoppedEvent`, `handleAgentHeartbeatDeadEvent`, `reconcileLiveWorkSpawnPlaceholder`, boot reconciliation) all rewrite `status`; feedback delivery (relay resurrection ladder, PAN-2668 exception, stall sweeper recommendation, dead-end nudge, idle nudge, kickoff redelivery) all try to make an agent act.

---

## 7. Is the pipeline over-built?

Yes, in the substrate; no, in the stages. The evidence:

- **Patrols run the happy path.** 93 orphan recoveries for normal reviewer exits and 104 of 256 PRs needing the `pan done` hand-off "recovered" mean two ordinary transitions have no synchronous writer. A patrol that fires on every normal completion is the completion path implemented as a scavenger, with a 5-minute latency and a race against every other patrol.
- **Copies drift by construction.** `reconcileInFlightJournals` cannot ever converge because its two readers apply different transforms. The advancing-verdict line fired thousands of times per day on issues whose state did not change.
- **The lock serializes everything and starves the critical path.** One project-wide lock, held across a network push, taken by patrols in bursts of 23, and required to spawn an agent.
- **Recovery has replaced completion in the docs too.** The DoD table's rule "every row must name a live owner" is right, but for several rows the named owner is a patrol.
- **The churn is incident-driven.** Half of 688 cloister commits in 90 days are fixes; 239 issue numbers are inlined as special cases. The memory notes catalogue a "latch family" (PAN-2725, 2731, 2735, 2743) and an "anchor family" (MIN-901, PAN-3254) that keep recurring because each fix adds a classifier rather than removing a holder.
- **The last simplification held.** `docs/REVIEW-AGENT-ARCHITECTURE.md`'s "Removed layers" table shows the review convoy was simplified (no discovery phase, no fork tree, no selective reruns) and the review stages worked correctly today. That is evidence the stages are the right shape and that removal, not addition, is what has worked.

What the operator's existing end-state design (`docs/API-SURFACE.md`, issues #1919, #1921, #1936, #1922) gets right: one write door, database as cache, sources of truth in git and GitHub. What this incident adds: the write door is necessary but not sufficient. The door must be *called by the actor at the moment of the transition*, synchronously, with the evidence in the same write. Otherwise a patrol still has to guess later, and guessing is where every fault above lives.

---

## 8. The simplest architecture that would have carried PAN-3836

Concrete, with what it deletes. This is the design target; Section 9 phases it.

**8.1 One record, one row, one writer, one lock per issue.**
The record's `pipeline` block is the state machine. The `review_status` row is a projection written in the same transaction by the same function. The lock is per issue (hash the issue id, not the state root) and is released before any git push; the push is a background flush with its own retry, and readers never wait on it.
*Deletes:* `.overdeck/pipeline-verdict.json` and `sweepStrandedVerdictFallbacks`; the top-level `scopeDrift` duplicate; the legacy `panopticon.db` tables; `enrichReviewNotesFromRecordSync`'s read-time overlay (the row is complete, so nothing to overlay).

**8.2 Every transition writes its own terminal state, with its evidence, in one call.**
- Reviewer launcher exit → `stopped` (it already runs a `pan tell` on exit; make it `pan admin agents exited <id>`).
- Synthesis verdict → `{reviewStatus, reviewedAtCommit, cycle, runId}` in one write; the door refuses a verdict without an anchor.
- Verification → `{verificationStatus, lastVerifiedCommit, artifactPath}` in one write, artifact immutable.
- `pan done` → completion marker, PR URL, and `reviewRequestedAt` in one write; no separate "recovery" path.
- Test/UAT verdict → same shape.
*Deletes:* `checkOrphanedCompletions`, the `panDoneRecoveredAt` tombstone, `checkCompletedButUnsignaledReviews`, `checkCompletedButUnsignaledTests`, `reconcileUnappliedReviewVerdicts`, the no-evidence branch of the verdict writer, the second-write anchor in `done.ts:335-352`, and the 12-site fan-out of `reviewedAtCommit` (one site remains).

**8.3 One liveness oracle, one function.**
`isAlive(agentId)` = supervisor pid alive AND tmux pane not dead AND (for idle) transcript last-grew timestamp. The `agents` row and `state.json` are projections of events emitted by the supervisor (start, turn-start, turn-end, exit). Patrols read the function; they never write `status`.
*Deletes:* `handleAgentStoppedEvent`'s `stopped→running` reconcile, the orphan-recovery flip, `reconcileLiveWorkSpawnPlaceholder`, the "exactly-one transcript scan", both placeholder predicates (placeholders go away: the spawn writes state only when the session exists), `health.json`, `runtime.json`, `ready.json`, and the `stoppedByUser` gate's interplay with completion markers (replace with one `operatorHold` field set only by operator verbs and cleared only by operator verbs).

**8.4 Delivery is a confirmed turn.**
`messageAgent` = supervisor inject → wait for transcript to show a new user turn containing the message (bounded, 30 s, two attempts, as `resumeAgent` does) → success, else throw. Callers that cannot deliver escalate with the reason in the record. Nudges, feedback, kickoff, and operator tells all use it.
*Deletes:* the monitor mail tier from the automatic cascade (keep `pan inbox` as a manual read tool), the Channels MCP tier, the tmux paste tier for Claude Code, the eaten-message watcher, the dead-end raw `sendKeys`, `redeliverUndeliveredKickoffs`, `nudgeStalledResumeWorkAgents`, and the PAN-2668 exception (no queue means nothing to except).

**8.5 Gates are honest and immutable.**
Per-run artifact files; the full suite stamps `overdeck/test`, nothing else does; CI never skips; `.skip`/`.only` diff lint in the gate; the review command cannot touch verification; no test-skip-by-anchor-equality.
*Deletes:* `ci.yml` `skip_vitest`, `canSkipTests`, the merge-path `overdeck/test` stamp, the verification cycle reset on review request.

**8.6 Patrols become alarms with budgets.**
Keep: memory/disk pressure, deploy, close-out reaper, main-divergence health, mass-death detection, and a single "invariant checker" that compares record versus row versus liveness and *reports* (never writes) mismatches with a count. Every remaining patrol gets a per-day firing budget in config; exceeding it opens a needs-you with the patrol's name, because a patrol firing repeatedly is a transition bug.
*Deletes:* 37 of the 78 patrols, each only after its transition writes its own state; 5 more are kept but rewired. Appendix C lists every patrol with its `deacon.ts` line, its disposition, and the phase in which it goes, so the deletion can be argued row by row.

**Would this have carried PAN-3836?** Walk the day: the spawn does not take the lock (F1 gone); no placeholder, no adopted transcript (F2 gone); branch cut from `origin/main` (F3 gone); re-review refused on a dirty tree (F4: five cycles become two); ratchet names `projects.ts` (F5); nudges use transcript idle (F6); `it.skip` fails the gate (F7); 16 immutable artifacts (F8); CI would have caught the red main before PAN-3836's diff reached that test (F9); no anchorless verdict, no reset (F10, F11); UAT feedback is a confirmed turn or a loud failure that resurrects the agent (F12); `pan tell` exits with the truth (F14); zero happy-path recoveries (F15); review cannot un-fail verification (F16). The same review, test, and UAT verdicts would have been produced. The four manual interventions would have been zero, and the strike for PAN-3839 would have been unnecessary because main would not have been red.

---

## 9. Phased plan, each phase shippable alone, each with a no-loss audit

The additive-refactor rule applies: enumerate what the old surface provides, then prove the new surface provides it, in a test that blocks the deletion. The trap to avoid is the one the sweeper change fell into: removing an actor without replacing its exit created ten 34-day parks.

**Phase 1: Delivery is a confirmed turn (1 to 2 weeks).**
Build the transcript-confirmed `messageAgent`; route feedback, nudges, kickoff, and `pan tell` through it; make it throw. Then remove the monitor tier from the automatic cascade. Add `uatStatus === 'failed'` to owes-rework. Fix `pan tell` exit code and timers.
*No-loss audit:* a fixture test enumerating every caller of `messageAgent`, `sendKeys`, `queueAgentMail`, and `deliverAgentMessage` (there are about ten) and asserting each now either gets a confirmed turn or a thrown error in a harness that simulates an idle session, a dead pane, a stopped agent, and a paused agent. The stuck-flag orbit's exit becomes "resurrect through the work-resume door and deliver", and the audit asserts the eight currently parked issues would exit.

**Phase 2: Verdict and anchor are one write; verification is honest (1 to 2 weeks).**
Refuse anchorless verdicts; drift patrol marks stale instead of resetting; delete `canSkipTests`; review command stops touching verification; per-run verification artifacts; `.skip`/`.only` lint; CI stops skipping vitest; ratchet per-file counts; branch cut from `origin/main`.
*No-loss audit:* replay the 195 `review_status` rows and the 747 records through the new writer and assert every terminal verdict either has an anchor or is flagged, and count how many current "Skipped" test verdicts would have run (expected: all 191). CI green on `main` must be shown to run vitest on a sha that carries `overdeck/test=success`.

**Phase 3: Transitions write their own state; per-issue lock (2 to 3 weeks).**
Reviewer exit writes stopped; `pan done` single write; per-issue lock released before push; delete `checkOrphanedCompletions`, the tombstone, the fallback file and its sweeper, the unsignaled-* patrols, and the read-time overlay.
*No-loss audit:* for each deleted patrol, a test that constructs the state it used to repair and asserts the new synchronous write makes that state unreachable; plus a 24-hour soak on the live deacon with a counter per deleted-patrol predicate asserting zero would-have-fired events.

**Phase 4: One liveness oracle; no placeholders (2 weeks).**
`isAlive` and `isIdle` as the only functions; supervisor emits lifecycle events; `agents` row and `state.json` become projections; spawn writes state only after the session exists; delete the reconcile flips and the transcript scan; `operatorHold` replaces `stoppedByUser`.
*No-loss audit:* enumerate the twelve holders in Section 6 and, for each field a consumer reads, show its new source; run `pan status`, `pan parked`, the dashboard read model, and the DoD gate against recorded fixtures before and after and diff the outputs to zero.

**Phase 5: Patrol budgets and deletion (1 week, after 3 and 4 have soaked).**
Add per-patrol firing budgets; delete the remaining scavenger patrols; keep alarms.
*No-loss audit:* the invariant checker reports zero mismatches over a week with the scavengers disabled but still counting.

Total: roughly 8 to 10 weeks of one senior engineer, or a supervised pipeline-bypass orchestration per the operator's usual pattern, since this is machinery the flywheel is barred from touching (TENET-10).

---

## 10. Targeted fixes independent of the refactor, in priority order

| # | Fix | Files | Effort | Removes |
| --- | --- | --- | --- | --- |
| 1 | Add `uatStatus === 'failed'` to `issueOwesReworkSync`; make `pan tell` pass `owesRework` when any verdict is failed | `work-agent-lifecycle.ts:30-40`, `tell.ts`, `messaging.ts:233-249` | hours | the "nothing to resume" dead end after UAT failure |
| 2 | `pan tell`: `unref()` watcher timers; exit non-zero when `delivered` is false | `eaten-message-watcher.ts:37-39`, `tell.ts:29-31` | hours | hangs and false green |
| 3 | Delete `skip_vitest` from CI (cost: the full vitest suite runs on every push again, about 7 to 8 minutes of runner time per push based on today's gate durations; that is the trade-off being accepted) | `.github/workflows/ci.yml:139-158, :186, :190` | hours | invisible red main |
| 4 | `.skip`/`.only`/`xit` diff lint in the verification gate; `allowOnly: false` | `projects.yaml` gate, `vitest.config.ts` | half day | skipped tests passing the gate |
| 5 | Per-run verification artifacts | `verification-artifact.ts:38, :70-73`; `verification-runner.ts:669, :688` | half day | lost gate output |
| 6 | Refuse anchorless terminal verdicts; drift patrol marks stale, never resets | `review-verdict-writer.ts:146-153`; `deacon-post-review-commits.ts:152-158` | 1 day | approved-then-reset, MIN-901 family |
| 7 | Delete `canSkipTests` | `review-status.ts:480-493` | half day | "tests passed" for tests that never ran |
| 8 | Convoy-liveness guard in `checkOrphanedCompletions`; reviewer launcher writes stopped on exit | `deacon.ts:1181-1206`; `launcher-generator.ts:600` | 1 day | 8 and 93 daily false recoveries |
| 9 | `pan review request` refuses dirty tree or unchanged HEAD; deacon re-dispatch loses `force: true` | `review-pipeline.ts`; `deacon-post-review-commits.ts:195` | 1 day | wasted convoys |
| 10 | Cut branches from `origin/<target>`; fetch before drift diff | `start.ts`; `done.ts:291-293` | half day | foreign-commit drift |
| 11 | Spawn does not take the record lock; persist `--model` after launch | `start.ts:869-874`; `start-policy-overrides.ts` | half day | F1 |
| 12 | Delete placeholder on non-zero child exit; remove transcript-directory adoption | `spawn.ts:911-935`; `activity.ts:255-258` | 1 day | F2 |
| 13 | Ratchet: per-file count delta | `scripts/lint-effect-diagnostics.sh:87-113` | half day | F5 |
| 14 | Dead-end and idle nudges: transcript-based idle, through `messageAgent` | `deacon.ts:1936, :1997-1998`; `agent-idle.ts:82` | half day | F6 |
| 15 | Review verdict command never writes `verificationStatus` | `specialists/done.ts:167-171` | hours | F16 |
| 16 | Fix the prompt and doc paths (`.pan/feedback` → `.overdeck/feedback`; PIPELINE-GATES bypass text; state-planes oracle text) | `roles/work.md`, `deacon.ts` recommendation strings, docs | hours | F17 |
| 17 | `reconcileInFlightJournals`: compare enriched with enriched, or delete | `advancing-selfheal.ts:96-105` | hours | thousands of daily no-op writes and hook runs |
| 18 | Clear `stuck` when the stuck condition's verdict flips to passed | `verification-runner.ts`; `review-status.ts` | hours | today's latched PAN-3836 |

Items 1 to 5 fit in one day and remove every manual step the operator took after 18:45.

---

## 11. Guardrails that make each incident impossible

| Incident | Guardrail |
| --- | --- |
| Spawn dies on the record lock (F1) | Spawning never takes the record lock; lock is per issue; no lock spans a push |
| Unrepairable placeholder, adopted planner transcript (F2) | State is written only when the session exists; session identity is allocated by the spawner, never inferred |
| Foreign commits in the PR (F3) | Branches are cut from `origin/<target>` only |
| Convoys on uncommitted fixes (F4) | Dispatch refuses a dirty tree or a previously reviewed HEAD |
| Wrong file blamed by the ratchet (F5) | Attribution is a per-file count delta |
| Working agent nudged as dead (F6) | One transcript-based idle function; all nudges through the delivery door |
| `it.skip` passes the gate (F7) | Diff lint in the gate |
| Gate output destroyed (F8) | Immutable per-run artifacts; nothing is named "latest" |
| Red main invisible to CI (F9) | CI never skips; only a full-suite run may stamp; scheduled full-suite run on main |
| Approval reset against a stale anchor (F10) | Verdict and anchor are one write; no anchorless verdict; patrols never reset a passed verdict |
| Stale anchor auto-passes tests (F11) | No verdict derived from string equality of two producers' anchors |
| Feedback "delivered" with no turn (F12) | Delivery returns only after a transcript-confirmed turn, else throws |
| Unpushed bot merge commit (F13) | Pipeline commits are pushed in the same operation or not made |
| `pan tell` false success and hang (F14) | Exit code equals the door's outcome; timers unref'd |
| Patrols firing on the happy path (F15) | Every transition writes its own state; patrols have firing budgets |
| Review approval un-fails verification (F16) | One actor per verdict field |
| Docs and prompts describe a different pipeline (F17) | Doc-drift tests for role prompts (paths, commands), as the DoD table already has |

---

## 12. Corrections to the handoff brief

- Cycle 2 reviewed a different HEAD from cycle 1 (`1e4ae61d` versus `99b95766`). The blockers were unfixed because the fixes were uncommitted, not because HEAD was unchanged.
- The lock in F1 is per project, not per issue; the error message is wrong.
- `messaging.ts:41-46` is imports; the monitor tier is at `:525-546`.
- The 18:45 merge commit's caller cannot be identified from the logs; three callers exist.
- `pan review list` does not exist; the verb is `pan review pending`.

---

## 13. Proposed issues for the operator to pick from

Not filed. Titles are written so a cheaper model can execute from the section cited.

1. Delivery returns only after a transcript-confirmed turn; remove monitor mail from the automatic cascade (Section 8.4, Phase 1).
2. `issueOwesReworkSync` counts failed UAT; `pan tell` passes `owesRework` on any failed verdict (Section 10 #1).
3. `pan tell`: unref watcher timers and honest exit code (Section 10 #2).
4. Delete CI `skip_vitest`; stamp `overdeck/test` only from a full-suite run bound to the tested sha (F9).
5. Verification gate: `.skip`/`.only` diff lint and `allowOnly: false` (F7).
6. Per-run immutable verification artifacts (F8).
7. Verdict write door refuses anchorless terminal verdicts; drift patrol marks stale instead of resetting; delete `canSkipTests` (F10, F11).
8. Reviewer exit writes `stopped`; `checkOrphanedCompletions` gains a convoy-liveness guard or is deleted (F15).
9. Per-issue record lock released before push; spawn never takes the lock (F1).
10. Delete placeholder on failed child spawn; remove transcript-directory adoption (F2).
11. `pan start` cuts from `origin/<target>`; drift check fetches (F3).
12. Re-review refuses dirty tree or unchanged HEAD; deacon re-dispatch without `force` (F4).
13. Ratchet attribution by per-file count delta (F5).
14. Nudges use transcript idle and go through `messageAgent` (F6).
15. Review verdict command stops writing `verificationStatus`; stuck clears when its condition clears (F16, Section 1).
16. Prompt and doc drift: feedback path, gate bypass text, liveness oracle text; add a role-prompt drift test (F17).
17. `reconcileInFlightJournals` compares like with like or is deleted (F15).
18. Epic: substrate consolidation, Phases 3 to 5 (Sections 8 and 9), with the no-loss audits as acceptance criteria.

---

## Appendix A: evidence index

- `~/.overdeck/agents/agent-pan-3836/spawn.log` (lock error), `lifecycle.log` (14:29:16 to 18:58:42), `state.json`, `monitor.json`, `mail/read/`.
- `~/.overdeck/logs/deacon.log` lines 113772 to 135453 for 09-16; notable: 114926 (stuck re-surfaced), 123023 to 123027 (first orphan-completion recovery), 126148 (dead-end nudge), 132159 (Reset review 18:29:52), 134116 (uat-failed recommendation 18:56:18).
- `~/.overdeck/logs/dashboard.log` (no timestamps): `[complete-planning] CALLED for PAN-3836`, 16 "Verification worker N supervising PAN-3836" lines.
- `~/.overdeck/state/panopticon-cli/records/pan-3836.json` and `git log` on that branch for 14:29:38 to 14:30:41.
- `~/Projects/overdeck/workspaces/feature-pan-3836/.pan/review/*/context.json` and `synthesis.md`; `.overdeck/verification-latest.json`; `git reflog show feature/pan-3836`.
- `~/.claude/projects/-home-eltmon-Projects-overdeck-workspaces-feature-pan-3836/ce1915ba-….jsonl` (last entry 18:24).
- `overdeck.db`: `review_status` row for PAN-3836; `agents` rows for the seven PAN-3836 agents.
- Saved gate outputs: `/tmp/claude-1000/-home-eltmon-Projects-overdeck/efc01bcc-8870-4513-9cab-d7b1925b0ca5/scratchpad/verify-1729.json`, `verify-1757.json`.
- Code: cited inline, at commit `3d5051040a2`.

## Appendix B: the monitor-mail delivery mechanism, as implemented

The operator asked for this explanation. It is what delivered the UAT feedback at 18:45.

**Origin.** PAN-3015, commit `88360fc6a27` on 2026-07-24, "pull-based inbox transport for Claude Code", modelled on Traycer's `traycer monitor`. `docs/MONITOR-TRANSPORT.md` states the goal: remove every keystroke-injection failure class by never typing into the agent's composer.

**The pieces.**

1. **The sender.** `messageAgent` in `src/lib/agents/messaging.ts:525-546` takes this tier before the PTY supervisor when three conditions hold: the target harness is `claude-code`, the message has no dedup key, and `isMonitorLive(agentId)` is true. It writes `~/.overdeck/agents/<id>/mail/<timestamp>.md` with a provenance header (source, date, body), logs "delivered via monitor mail", and returns `{delivered: true, queuedToMail: true}`. That return is the entire success criterion.
2. **Presence.** `pan monitor` writes `agents/<id>/monitor.json` with its pid and a heartbeat every 15 seconds. The sender treats the monitor as live when the heartbeat is under 45 seconds old and the pid answers `kill(pid, 0)` (`monitor-transport.ts:23-25, :85-96`). Today's `monitor.json` shows pid 1694876 started 18:11:12 with a heartbeat at 19:18:27, so the monitor was live for the whole 18:45 window.
3. **The consumer.** `pan monitor` is a CLI command (`src/cli/commands/monitor.ts`) that the work agent is told to start as a background Bash task at session start (`roles/work.md:60-63`). It loops: rename each `mail/*.md` into `mail/read/` (claim by rename, so two monitors cannot double-print), then `console.log` a block `[overdeck:agent-message] source: … at: …` followed by the body, truncated at 4,000 characters with a pointer to `pan inbox` for the full text (`monitor-transport.ts:178-188`; `monitor.ts:56`).
4. **The wake.** The design relies on Claude Code surfacing a background task's stdout to the model "at the next turn boundary, and waking an idle session". That step is harness behaviour, not Overdeck code. Nothing in Overdeck checks whether it happened. Today the session was idle at its prompt after 18:24 with the Stop-hook text on screen, the monitor claimed the mail, and no turn followed.

**Why it fails silently.** The success signal is a file write. The eaten-message watcher that guards keystroke delivery does not run for this tier. The claim-then-print race is acknowledged in the code (`messaging.ts:534-539`) and unmitigated: once the file is in `mail/read/`, no later monitor will print it again. Keyed messages already avoid this tier for exactly that reason (PAN-2997), which is why review-verdict feedback with a run id goes through the supervisor while UAT feedback and `pan tell` do not.

**Why it was reached at all.** The tier is taken *before* the PTY supervisor whenever the monitor is live, and the monitor is live whenever a work agent followed its prompt. So for every Claude Code work agent that obeyed `roles/work.md`, this became the default path for operator tells and pipeline feedback, not a fallback. The operator's stated intent was a future use case; the ordering in `messageAgent` made it the everyday one.

**What to do.** Keep `pan inbox` and the mail directory as a manual, durable channel an operator can read. Remove the tier from `messageAgent`'s automatic cascade so every automatic message goes through the PTY supervisor and is confirmed against the transcript (Phase 1). If a future use case needs pull-based delivery, it should be opt-in per message, with its own turn confirmation.

## Appendix C: every deacon patrol, with disposition

All 78 steps run in one sequential pass in `runPatrol()` (`src/lib/cloister/deacon.ts:2611`), scheduled every `patrolIntervalMs` (60,000 ms, `deacon.ts:221`); overlapping ticks are dropped (`deacon.ts:3434-3437`). Observed cadence today was about 5 minutes per pass. Disposition: **Keep** (alarm, resource, or cleanup that owns a real job), **Rewire** (kept, but its input or its side effect changes), **Delete** (a scavenger for a transition that Phase N makes write its own state). Every Delete row is gated by that phase's no-loss audit (Section 9).

| # | Patrol | `deacon.ts` line | Cadence | Disposition | Phase / note |
| --- | --- | --- | --- | --- | --- |
| 1 | `patrolStaleTaskClaims` | 2668 | every pass | Keep | task claims are leases; expiry is a real job |
| 2 | `checkStuckAgentRemediation` | 2669 | every pass | Delete | 4: one liveness oracle |
| 3 | `runStallSweeperPatrol` | 2676 | every pass | Keep | alarm only; gets a firing budget |
| 4 | `reconcileInFlightJournals` | 2685 | every pass | Delete | 3: compares enriched read with raw row (F15) |
| 5 | `retireResolvedFeedbackDeliveryStuckFlags` | 2686 | every pass | Delete | 1: no delivery-stuck flag once delivery confirms |
| 6 | `processPendingLifecycleForPatrol` | 2694 | every pass | Keep | post-merge lifecycle queue |
| 7 | `runScheduledDeployPatrol` | 2699 | every 5 passes | Keep | deploy is a DoD row |
| 8 | `reconcileAgentLiveness` | 2712 | every pass | Delete | 4: supervisor emits lifecycle events |
| 9 | `reconcileOrphanProposedSpecs` | 2716 | every pass | Keep | budgeted; source of the 82 pickup-gate trips |
| 10 | `reconcilePendingPromotions` | 2717 | every pass | Delete | 3: complete-planning becomes one write with its own retry |
| 11 | `reconcileClosedIssueAgents` | 2719 | every pass | Keep | reaper for closed issues |
| 12 | `reapMergedStrikeWorkspaces` | 2726 | every pass | Keep | cleanup |
| 13 | `reconcileIdleWorkspaceStacks` | 2733 | every pass | Keep | resource |
| 14 | `patrolDockerBridgePool` | 2738 | every pass | Keep | resource |
| 15 | `nudgeStalledResumeWorkAgents` | 2742 | every pass | Delete | 1: resume confirms its own turn |
| 16 | `redeliverUndeliveredKickoffs` | 2746 | every pass | Delete | 1: kickoff confirms its own turn |
| 17 | `nudgeIdleWorkAgentsWithOpenBeads` | 2754 | every pass | Rewire | 1: transcript idle, through `messageAgent` |
| 18 | `checkThinkingSignatureCorruption` | 2761 | every pass | Keep | harness-bug detector |
| 19 | `checkAndSuspendIdleAgents` | 2766 | every pass | Keep | resource |
| 20 | workspace-missing `readyForMerge` clear (inline) | 2770-2790 | every pass | Delete | 3: merge door checks the workspace when it acts |
| 21 | `checkMergedWorkSessions` | 2802 | every pass | Keep | post-merge cleanup |
| 22 | `checkMergedAdvancingSessions` | 2806 | every pass | Keep | post-merge cleanup |
| 23 | `refreshClaudeCredentialsForActiveRemoteAgents` | 2817 | every pass | Keep | remote substrate |
| 24 | `refreshHostHeartbeatForEphemeralVms` | 2829 | every pass | Keep | remote substrate |
| 25 | `reapCompletedRemoteAgents` | 2843 | every pass | Keep | remote substrate |
| 26 | `checkAwaitingTestWorkSessions` | 2860 | every pass | Delete | 3: review pass writes the test request |
| 27 | `checkOrphanedReviewStatuses` | 2867 | every pass | Delete | 3: `pan done` writes the review request |
| 28 | `checkInspectAgentTimeouts` | 2872 | every pass | Keep | timeout alarm |
| 29 | `cleanupOrphanedInspectSessions` | 2879 | every pass | Delete | 4: exit writes stopped |
| 30 | `checkPostReviewCommits` | 2885 | every pass | Rewire | 2: marks stale, never resets a passed verdict (F10) |
| 31 | `recoverStalledReviewConvoys` | 2889 | every pass | Delete | 3: reviewer exit writes stopped; synthesis is deterministic |
| 32 | `checkMissingReviewStatuses` | 2895 | every pass | Delete | 3 |
| 33 | `checkOrphanedCompletions` | 2902 | every pass | Delete | 3: `pan done` single write (F15) |
| 34 | `checkCompletedButUnsignaledTests` | 2910 | every pass | Delete | 3: test verdict is one write |
| 35 | `reconcileTestStatusFromGreenCi` | 2917 | every pass | Delete | 2: a second path to "tests passed" (F9) |
| 36 | `checkPendingTestDispatch` | 2922 | every pass | Delete | 3 |
| 37 | `checkStuckReviewing` | 2927 | every pass | Delete | 3 |
| 38 | `checkCompletedButUnsignaledReviews` | 2932 | every pass | Delete | 3 |
| 39 | `reconcileUnappliedReviewVerdicts` | 2937 | every pass | Delete | 3 |
| 40 | `sweepStrandedVerdictFallbacks` | 2946 | every pass | Delete | 3: no fallback file once the lock is per issue (F15) |
| 41 | `checkVerificationReviewContradiction` | 2954 | every pass | Delete | 2: one actor per verdict (F16) |
| 42 | `cleanupOrphanedPlanningSessions` | 2963 | every pass | Delete | 4: handoff stops the planner in the same step |
| 43 | `checkStalledReviewParents` | 2969 | every pass | Delete | 3 |
| 44 | `monitorReviewConvoySignals` | 2973 | every pass | Rewire | 3: deterministic synthesis becomes the only synthesizer (PAN-1864) |
| 45 | `cleanupOrphanedReviewSessions` | 2980 | every pass | Delete | 4 |
| 46 | `checkWorkspaceContainerHealth` | 2985 | every pass | Keep | resource |
| 47 | `checkReadyForMergeStuck` | 2995 | every pass | Delete | 3 |
| 48 | `checkFailedMergeRetry` | 3000 | every pass | Keep | explicit retry policy for the merge door |
| 49 | `patrolStrikeLandings` | 3003 | every pass | Rewire | 3: yields the lock between records (F1) |
| 50 | `swarmJanitorPass` | 3007 | every pass | Keep | swarm |
| 51 | `reconcileStaleMergeStatus` | 3012 | every pass | Delete | 3 |
| 52 | `reconcileStuckMergingStates` | 3013 | every pass | Delete | 3 |
| 53 | `reconcileFalseMerged` | 3019 | every pass | Delete | 3 |
| 54 | `reconcileMergedButReviewing` | 3026 | every pass | Delete | 3 |
| 55 | `autoCloseOut` | 3030 | every pass | Keep | DoD row |
| 56 | `reconcileClosedPrReadyForMerge` | 3037 | every pass | Delete | 3 |
| 57 | `reconcileAutoMergeRows` | 3039 | every pass | Keep | auto-merge policy |
| 58 | `reconcileStaleMergeBlockers` | 3047 | every pass | Delete | 3 |
| 59 | `reconcileStuckReadyForMerge` | 3054 | every pass | Delete | 3 |
| 60 | `checkDeadEndAgents` | 3061 | every pass | Rewire | 1: transcript idle, through `messageAgent` (F6) |
| 61 | `checkFirstCompletionAgents` | 3068 | every pass | Delete | 3 |
| 62 | `reconcileTraefikNetworks` | 3076 | every pass | Keep | network |
| 63 | `checkStuckWorkAgents` | 3088 | every pass | Delete | 4 |
| 64 | `checkApiErrorAgents` | 3092 | every pass | Keep | alarm |
| 65 | `reconcilePipelineLabelsPatrol` | 3095 | every 10 passes | Keep | GitHub label projection |
| 66 | `reapOrphanedDashboardServers` | 3100 | ~10 min | Keep | process hygiene |
| 67 | `reapLeftoverPlaywrightBrowsers` | 3109 | ~10 min | Keep | process hygiene |
| 68 | `reconcileProjectStatePlanes` | 3114 | ~hourly | Keep | state-branch health |
| 69 | `reconcileTerminalIssueResidue` | 3118 | ~hourly | Keep | close-out backstop |
| 70 | `recreatedStateWarnings` | 3119 | every pass | Keep | alarm |
| 71 | `recordMainDivergenceHealth` | 3120 | every pass | Keep | alarm |
| 72 | `cleanupStaleAgentState` | 3123 | every 60 passes | Keep | garbage collection |
| 73 | `sweepTranscriptRetention` | 3129 | every 60 passes | Keep | retention |
| 74 | `pruneTerminalStoppedAgents` | 3136 | every 60 passes | Keep | garbage collection |
| 75 | `cleanupAbandonedFeedback` | 3142 | every 5 passes | Delete | 1: feedback lifetime is tied to its verdict |
| 76 | `cleanupOrphanReviewerSessions` | 3151 | every 60 passes | Delete | 4 |
| 77 | `checkMassDeath` | 3157 | every pass | Keep | alarm |
| 78 | per-project ephemeral specialist patrol | 3168 | every pass | Keep | specialist reaper |
| — | `patrolResourcePressure` | 3479 | separate 15 s timer | Keep | memory governor |

Totals: 36 Keep, 5 Rewire, 37 Delete. The Delete rows by phase: Phase 1 removes 5, Phase 2 removes 2, Phase 3 removes 23, Phase 4 removes 7.
