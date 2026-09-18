# Pipeline Gates: Verification, Verdict Routing, Convergence, Auto-Resume

> Moved from CLAUDE.md (2026-08-07).

## Verification Gate (PAN-174)

After a work agent signals completion, Cloister runs quality gates from `projects.yaml`
before advancing to the review role. If typecheck/lint/test fail, feedback is sent to the
agent's tmux session and the issue does not advance, so the agent can fix and retry.
After 3 failed cycles the issue is marked `verification_stuck`, the work agent is paused,
and a needs-you escalation fires; the counter is per issue and is reset only by
`pan review reset` (PAN-3847). A verification pass clears the `verification_stuck` flag
and lifts that pause.

## Immutable run artifacts (PAN-3847)

Each verification run writes an immutable artifact named by run time and workspace head:
`<workspace>/.overdeck/verification/<ranAt>-<head8>.json`. The runner also copies it to
`.overdeck/verification-latest.json`, which remains the dashboard's read path. Failure
feedback references the per-run file, so the evidence a later run cannot overwrite is
what the agent reads. Per-run files older than 30 days are pruned by the idle-stack
patrol.

## Test-skip gate (PAN-3847, PAN-3906)

Before the quality gates run, the verification runner diffs the workspace against
`origin/<target>` and fails a required `test-skip` gate on two independent rules.

**Added `.skip`/`.only`/`xit`/`xdescribe`/`xtest` in a test file** is always a
violation, one per line. Disabling a test is never balanced by writing another one,
and it is never waivable. `allowOnly: false` in both vitest configs makes `.only` fail
every gate run outright.

**Removed `it(`/`test(` calls are balanced across the whole diff**, not per file
(PAN-3906). The gate sums removed and added test calls over every test file in the
diff and fails only when the total removed exceeds the total added. Per-file lines are
still emitted as gate evidence, marked `(evidence only — not a gate failure)` when the
total absorbs them. Per-file failure made any component deletion unmergeable: deleting
a component together with its test file always read as a removal, however many tests
the same refactor added elsewhere.

Two escapes exist for a genuine net removal:

- **Deleted-subject exemption (structural).** A test file deleted whole
  (`deleted file mode` in the diff) whose subject module is deleted in the same diff is
  not a violation, and its counts stay out of the whole-diff total. The subject is
  resolved by stripping a `__tests__/` segment and the `.test`/`.spec` infix, then
  matching `.ts`/`.tsx`/`.js`/`.jsx` among the diff's deleted files — so
  `components/__tests__/Foo.test.tsx` is exempt when `components/Foo.tsx` is deleted.
- **Operator waiver (judgment).** `pan verify waive-test-removal <id> --reason "…"`
  records `pipeline.testSkipWaiver = { sha, reason, at, by }` through the record write
  door. The gate demotes `removed-test` to evidence when the waiver's head anchor
  equals the head under verification, and prints the waiver as gate evidence in the
  verification artifact. It expires the moment the branch head moves, it never waives
  an added `.skip`/`.only`, and it is operator-conversation-only (`conv-*`) — a
  pipeline agent cannot waive the coverage loss it just produced.

Related: the anchor-equality test skip is gone — a review whose
`reviewedAtCommit` equals `lastVerifiedCommit` no longer auto-passes the test role;
`review.approved` always dispatches it. CI runs vitest on every push and never reads
the `overdeck/test` commit status; that stamp now records only that the changed-file-
scoped verification gate passed, bound to the tested sha.

## Verdict feedback routing

Review `blocked`/`failed`, test `failed`, and UAT `failed` verdicts all return work to
the work agent through the same feedback doors: `writeFeedbackFile()` persists the
feedback, `resolveIssueFeedbackTarget()` finds or resurrects the work target, and
`surfaceIssueFeedbackNeedsYou()` creates a durable escalation when no target resolves.
The UAT relay is `src/lib/cloister/uat-failure-feedback.ts`. Delivery is confirmed
against the agent's transcript; an unconfirmed delivery surfaces a needs-you
escalation instead of reporting success (PAN-3846).

## Review Convergence Gate (PAN-3151)

When a change enters the `blocked` review state, the blocking-finding count is recorded into a `reviewCycleHistory` series. When ≥3 cycles are recorded and the series shows a reversal (latest count > previous) or stall (two consecutive non-decreases), the issue is marked `stuck` with `stuckReason: 'review-not-converging'`. Automatic rework re-drive is suppressed; feedback file is written and PR comment posted, but the work agent is not messaged. A needs-you escalation surfaces with the cycle count series and guidance to decompose the change into sibling issues or run `pan unstick <issueId>` to clear the gate and attempt rework. This mechanical gate is separate from reviewer judgment: `roles/review.md` requires checking prior fixes first and explaining newly discovered blockers. It never suppresses a confirmed blocker solely because a previous review missed it.

## Agent Auto-Resume Gates

Deacon auto-resume is intentionally suppressible through the unified
`getAgentResumeGateBlockReason` classifier and `decideResumeGate` intent policy:

- **Boot no-resume:** `OVERDECK_NO_RESUME=1`, `pan dev --no-resume`, or
  `pan up --no-resume` disables orphan recovery and stopped-agent auto-resume for
  that dashboard boot only. Restart without `--no-resume` to restore patrols.
- **Manual pause:** `pan pause <id> [--reason <text>]` persists `paused` fields in
  `~/.overdeck/agents/<agent-id>/state.json` and stops the agent if it is running.
  `pan unpause <id>` clears the gate without spawning. `pan start <id>` refuses
  paused agents unless `--force` is passed; `--force` clears the pause gate first.
- **Troubled gate:** repeated resume/crash failures mark an agent `troubled` and
  preserve failure counters/backoff state in `state.json`. `pan untroubled <id>`
  clears the troubled gate and failure fields after the underlying crash cause has
  been investigated. It does not spawn the agent.
- **Operator-stop gate:** `stoppedByUser` blocks autonomous re-drive when no
  completed handoff exists and emits one durable needs-you trip. A completed
  handoff that owes review/test/verification rework may clear the historical
  flag and re-drive. Explicit operator start clears only `stoppedByUser`; it does
  not silently clear paused or troubled state.
  Only an operator-initiated stop may set the flag (PAN-3324). `stopAgent`,
  `stopAgentSync`, and `markAgentStoppedState` take an `AgentStopCause` that
  defaults to `'system'`; `'operator'` is passed by `pan kill`, `pan pause`, the
  dashboard stop/pause actions, and the flywheel stop/pause/abort commands, and
  nowhere else. Every machinery-initiated stop — memory shedding, health
  force-kills, stalled-review-parent reaping, close-out, reconciling a process
  the OOM killer already took — leaves the flag unset so autonomous recovery
  stays eligible. Recording an OOM kill as an operator stop is what turned a
  transient resource event into a permanent stall.
- **Memory gate (PAN-2500):** `assessMemoryPressure()` in `src/lib/cloister/memory-governor.ts`
  gates every autonomous resume/dispatch path — boot recovery, patrol auto-resume,
  reactive resume-on-stop, and review/test/ship dispatch — on live memory pressure,
  not just agent count and CPU load. Below the SOFT reserve it defers new admissions;
  below HARD it sheds (stops merged/closed docker stacks, then pauses idle work
  agents); it never re-admits until memory clears RECOVERY. See
  [`docs/RESOURCE-GOVERNOR.md`](docs/RESOURCE-GOVERNOR.md) for the full model. This
  is separate from `--no-resume`, which suppresses resume outright regardless of memory.

Separately, the **preemptive scheduler** (PAN-2507, opt-in via `[concurrency]
preemption = true`) may **yield** an idle work agent — pause it to free capacity
for a blocked review/test/merge dispatch. A yield reuses the same `paused: true`
gate (so all four suppression gates above protect it), tagged with
`yieldedByScheduler`/`yieldedAt`. Unlike an operator pause it is **self-clearing**:
`autoResumeStoppedWorkAgents` resumes yielded agents oldest-first, ahead of any
other stopped candidate, once a slot and the memory gate allow — and `pan
unpause` on a yielded agent clears the yield attribution too. See
[`docs/RESOURCE-GOVERNOR.md`](docs/RESOURCE-GOVERNOR.md) → "Preemptive scheduling".

These gates are orthogonal to the global Deacon freeze in SQLite
(`deacon.globally_paused`) and the per-issue Deacon ignore flag in review status.


## Patrol budgets (PAN-3850)

Every deacon patrol is an alarm with a budget, not an actor with unlimited
ammunition. Each patrol registered in `runPatrol` runs inside
`runBudgetedPatrol()` (`src/lib/cloister/patrol-budget.ts`), which tallies the
actions the patrol reports against a per-UTC-day budget in
`~/.overdeck/deacon/patrol-budget.json` (default 50 actions/day). When a
patrol's tally crosses its budget it is suspended until the next UTC day and
the operator gets exactly one needs-you (idempotency key
`patrol-budget-exceeded:<name>:<day>`) — a runaway patrol degrades to a single
actionable signal instead of an action storm. The tally resets at UTC midnight;
a suspended patrol runs again the next day.

Five patrols are exempt alarms — `runStallSweeperPatrol`, `checkApiErrorAgents`,
`recreatedStateWarnings`, `recordMainDivergenceHealth`, `checkMassDeath` —
wired directly in `runPatrol`, never budgeted: they exist precisely to fire
when everything else is wrong. Budgets are configuration
(`cloister.patrolBudgets` in `~/.overdeck/config.yaml`: `default`, `exempt`,
per-patrol `overrides`); `pan doctor` prints today's tally per patrol with
suspended patrols named in red.

The same phase adds the report-only **invariant checker**
(`src/lib/cloister/invariant-checker.ts`, every 10 passes, budgeted like every
other patrol): for each non-merged issue it compares the record `pipeline`
block against the review-status row field by field, and each agent row's
status against tmux liveness. It emits one activity entry per mismatching
entity per day plus a per-run summary count, persists
`~/.overdeck/deacon/invariant-report.json` for `pan doctor` and the parked
resolver's `invariant-mismatch` orbit — and writes no store it reads. Repairs
go through the owning doors: `pan review resync <id>` for verdict drift,
`pan admin agents exited <id>` for liveness drift.

## The in-flight owner (PAN-3903)

Budgets cap how often a patrol can be wrong. The in-flight owner stops one
whole class of being wrong: acting on a transition another actor already owns.

Every pipeline read under `src/lib/cloister/` goes through the read door,
`src/lib/overdeck/pipeline-view.ts` (see
[API-SURFACE.md](API-SURFACE.md#the-pipeline-read-door-pan-3903)). Alongside the
canonical state it returns `inFlightOwner`: `{ actor, since, transition }` or
`null`. It is derived from durable transition writes **only** — never tmux,
never a live pane, never agent liveness — so a dead actor's claim stays visible
to the patrols whose job is to revive it.

Precedence runs latest-stage first, because an issue that reached the merge
queue is no longer the reviewer's:

| Owner | Derived from |
|---|---|
| `merge` | `mergeStatus` is `queued`, `merging` or `verifying` |
| `strike` | `strikeLandingState` is `landing`, `recovering` or `needs_you` (`ready` is unclaimed, `landed` terminal) |
| `verification` | `verificationStatus` is `running` |
| `uat` / `test` | `uatStatus` / `testStatus` is `testing` |
| `review` | `reviewStatus` is `reviewing`, or `reviewSpawnedAt` is set with no terminal verdict |
| `conflict-resolution` | `conflictResolutionDispatchedAt` set, review non-terminal |
| `work` | `reviewStaleSince` set (PAN-3847); or a `failed` review/test/verification/uat verdict routed back; or `needsReviewDispatch` — `pan done`'s request awaiting dispatch |

A merged or retired issue has no owner.

**Which patrols consult it.** The line is what the patrol's action *is*:

- A patrol that **initiates** a transition must skip an owned issue and log one
  line naming the owner — `checkOrphanedCompletions`,
  `salvageStrandedStrikeBranches`.
- A patrol that **recovers a stalled** transition must NOT skip: `checkStuckReviewing`,
  auto-resume, stuck-merging and the crash handlers exist to revive a dead
  owner, so an owner check there would deadlock the issue instead of healing it.
- Resource governors (`memory-governor`, `preemption`) classify agents, not
  transitions, and the invariant checker is report-only. Neither consults it.

**Why it exists.** PAN-3842, 2026-09-18. Review passed at `ff31b427`; the work
agent pushed more commits; the post-review-commit patrol marked the row stale at
07:30 — `reviewStaleSince` set, "no automatic re-dispatch" by design, because
only `pan done` or `pan review request` may clear staleness. That row satisfied
every condition `checkOrphanedCompletions` checked, so it "recovered" the issue
nine times between 07:36 and 08:17, stacking a review convoy on top of the work
agent's own re-review. No individual patrol was buggy: none of them could see
that someone else was already handling it. Locked by
`tests/unit/lib/cloister/check-orphaned-completions-inflight-owner.test.ts`.
