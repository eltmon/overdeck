# Pipeline Gates: Verification, Verdict Routing, Convergence, Auto-Resume

## Verification Gate (PAN-174)

`pan done` runs quality gates (typecheck, lint, test) from `projects.yaml`
before opening or updating the PR and requesting review. If a gate fails,
feedback goes to the agent's session and the command refuses to proceed, so
the agent can fix and retry. There is no separate stuck counter stored on a
record — a run that keeps failing is visible directly in the PR's check
history.

### One full-suite run per push, on CI (PAN-3965)

For a project with CI, the verification gate runs **typecheck and lint only**
on the host (plus any other non-`test` gate the project declares, and the
local test-skip diff check below). The quality gate named `test` is not run;
the **CI test job on the PR head is the test gate**:

- Merge readiness already requires the PR's checks green (`pr-facts.ts`
  `evaluateMergeReadiness`); `PrFacts.testChecks` is the verdict over just the
  test job (a check named `test`/`tests`, with or without a matrix suffix such
  as `test (22)`).
- A red CI test job reaches the work agent through
  `src/lib/cloister/ci-failure-feedback.ts` (fired by the `check_run`,
  `check_suite` and `status` webhooks). For a CI-mode project the relay reads
  the PR's checks, and when the test job is red on the head the webhook
  reported, it records the failure once per head as a per-run verification
  artifact (`via: 'ci'`), appends
  `verification.failed { failedCheck: 'test', cycleCount, via: 'ci' }` to the
  pipeline journal, and delivers `VERIFICATION FAILED … Failed check: test`
  through the same feedback door as the local gate
  (`cloister/verification-escalation.ts`: rework owed, slot resolution,
  resurrection, needs-you when nothing is reachable).
- **Attempt budget.** A CI test failure counts against the local gate's budget
  (`VERIFICATION_MAX_CYCLES` = 3, `cloister/verification-cycles.ts`), read
  from the same per-run artifacts. The local count is per head — every commit
  resets it — and CI runs once per head, so CI failures are also counted
  across heads: `readCiTestFailureStreak` counts consecutive heads whose CI
  test job failed, back to the last head whose test job passed. The attempt
  number is the larger of the two. The stuck pause
  (`escalateVerificationStuck`) fires on the third consecutive red head, or
  by the local rule on the per-head count (a second failure of the same check
  at one head). A green CI test job (`check_run` success for the test job,
  confirmed against the PR checks) records a passed CI artifact — the reset.
  What is not counted (review of #3993): a red test job on a `strike/` or
  `bypass/` PR (it is not the work agent's branch; the relay falls back to the
  plain CI FAILED message, which reaches only a live work agent); a test job
  whose failing checks all ended `CANCELLED`, `TIMED_OUT`, `STARTUP_FAILURE`,
  `STALE` or `ACTION_REQUIRED` (only `FAILURE`/`ERROR` are verdicts on the
  code); a test job whose failing checks are all failing on the default
  branch too (inherited from a red `main`); and a failure while the default
  branch's test verdict is unknown. The default branch's verdict is its newest
  commit (of the last 10) whose test checks all finished decisively: main's CI
  is often still running on HEAD, and a cancelled run says nothing
  (`cloister/ci-default-branch-tests.ts`). When no such commit exists, or the
  forge cannot be read, the failure is not counted; the plain CI FAILED
  message still reaches a live work agent. Relays for one issue
  run one at a time, so concurrent webhooks for one red head (the shards of a
  matrix, the aggregate job, `check_suite`) count it once. A report for a head
  already recorded (a duplicate webhook, a replay after a restart) is never
  re-delivered: the per-run record is the idempotency key, so a replay cannot
  re-open rework past the budget or lift a stuck pause. The record is written
  only once the feedback file exists (review of #4017): if that write fails,
  the head stays unrecorded (the next report retries it) and a needs-you row
  says so; a delivery door that throws after the record also surfaces
  needs-you. CI results are per-run
  records only; `verification-latest.json` stays the local gate run's record.
  Re-requesting review on a head whose CI test job is already red fails the
  `test` gate again instead of passing on typecheck+lint alone.
- The verification artifact lists only the gates that ran on the host and
  names the handed-off gate in `deferredToCi: ["test"]`. The `overdeck/test`
  status still posts (branch protection requires the context) with the
  description "typecheck+lint; tests run on CI".

`projects.yaml` chooses per project:

```yaml
verification:
  tests: ci      # or: local
```

Unset, the mode is `ci` only when the project has a `github_repo` and a
GitHub Actions workflow (in the project root or a polyrepo member) that runs on
`pull_request`/`pull_request_target` (or on `push` for feature branches) and
defines a job whose check name the test matcher recognizes (`test`, `tests`,
`test-*`, `test (…)`, or a reusable workflow's `test / <inner job>`: its
`name:`, else its id). A `pull_request` `branches`/`branches-ignore` filter is
read against the project's PR base branch (`pr_target`, else
`default_branch`, else `main`), and a job whose `if:` plainly cannot run on a
PR (it tests `github.event_name` without `pull_request`, or pins `github.ref`)
is skipped. `paths` filters, other `if:` expressions and the inside of a
reusable workflow are not evaluated. Otherwise the mode is `local`:
release-only, docs, schedule or dispatch workflows, or a test job named
something the matcher misses, would otherwise drop the local test gate for a
CI job that never runs. `local` keeps the `test` gate on the host exactly as
before. The runner logs the mode with its reason and records both in the
artifact's `testsMode` field. The CI-failure relay is GitHub-webhook-driven, so a GitLab
project that sets `tests: ci` gets the merge gate (a green pipeline) but no
automatic agent feedback for a red test job.

Work agents run only the tests they touched (the work prompt names
`npx vitest run <files>` only in a vitest project, and says "the suite runs on
CI" only in a CI-mode project); reviewers never run the suite — they read the
CI result on the head (`gh pr checks <pr>`) where tests run on CI.

## Verification artifacts (FR-8)

Each verification run writes an immutable artifact named by run time and
workspace head: `<workspace>/.overdeck/verification/<ranAt>-<head8>.json`.
The runner also copies it to `.overdeck/verification-latest.json`, the
dashboard's read path, and reports the same result as a GitHub check run
where the App is installed. Failure feedback references the per-run file,
so the evidence a later run cannot overwrite is what the agent reads.
Per-run files older than 30 days are pruned by host-hygiene's scheduled
sweep. No `verificationStatus` field is written anywhere — the artifact and
the check run are the whole answer.

## Test-skip gate (PAN-3847, PAN-3906)

Before the quality gates run, the verification runner diffs the workspace
against `origin/<target>` and fails a required `test-skip` gate on two
independent rules.

**Added `.skip`/`.only`/`xit`/`xdescribe`/`xtest` in a test file** is always a
violation, one per line. Disabling a test is never balanced by writing another
one, and it is never waivable. `allowOnly: false` in both vitest configs makes
`.only` fail every gate run outright.

**Removed `it(`/`test(` calls are balanced across the whole diff**, not per
file (PAN-3906). The gate sums removed and added test calls over every test
file in the diff and fails only when the total removed exceeds the total
added. Per-file lines are still emitted as gate evidence, marked
`(evidence only — not a gate failure)` when the total absorbs them.

Two escapes exist for a genuine net removal:

- **Deleted-subject exemption (structural).** A test file deleted whole
  (`deleted file mode` in the diff) whose subject module is deleted in the
  same diff is not a violation, and its counts stay out of the whole-diff
  total. The subject is resolved by stripping a `__tests__/` segment and the
  `.test`/`.spec` infix, then matching `.ts`/`.tsx`/`.js`/`.jsx` among the
  diff's deleted files.
- **Operator waiver (judgment).** `pan verify waive-test-removal <id> --reason "…"`
  records the waiver (sha, reason, timestamp, operator) as a workspace
  verification artifact, not a pipeline record. The gate demotes
  `removed-test` to evidence only when the waiver's anchored sha equals the
  head under verification, and prints the waiver as gate evidence. It
  expires the moment the branch head moves, it never waives an added
  `.skip`/`.only`, and it is operator-conversation-only — a pipeline agent
  cannot waive the coverage loss it just produced.

The test-skip gate stays local in both modes: it is a diff check, not a test
run. CI runs vitest on every push; the `overdeck/test` commit status records
only that the verification gate passed for the tested sha (changed-file scope
in `local` mode, typecheck+lint in `ci` mode).

## Verdict feedback routing

A review `request changes` or a failing test/UAT run returns work to the work
agent as PR review comments and/or a `pan tell` nudge. Delivery is confirmed
against the agent's transcript; an unconfirmed delivery surfaces a
needs-you escalation instead of reporting success (PAN-3846). There is no
separate feedback record — the PR thread and the transcript are the
evidence.

A failed browser UAT is observed where the test agent records it:
`pan admin specialists done test <id> --uat-status failed` (or the `uat`
role). After posting the verdict comment, that command relays the UAT notes
through `relayUatFailureFeedbackPromise` (`cloister/uat-failure-feedback.ts`)
to the work agent, or to a needs-you when no agent can be reached. Delivery
carries a key derived from the tested commit (`--tested-sha`, else the PR
head), which the tmux/PTY-supervisor tiers
enforce across processes (Herdr-prompted agents bypass the keyed cascade, as
review feedback does); a passing UAT clears the anchor (PAN-4030).

## Review Convergence Gate (PAN-3151)

When a review round comes back with blocking findings, the finding count is
tracked across rounds from the round artifacts on disk. When ≥3 rounds are
recorded and the series shows a reversal (latest count > previous) or a
stall (two consecutive non-decreases), automatic rework re-drive is
suppressed — feedback is still written and posted, but the work agent is not
re-messaged automatically — and a needs-you escalation surfaces with the
round history and guidance to decompose the change into sibling issues.
This mechanical gate is separate from reviewer judgment: `roles/review.md`
requires checking prior fixes first and explaining newly discovered
blockers. It never suppresses a confirmed blocker solely because a previous
round missed it.

## Agent Auto-Resume Gates

Auto-resume is intentionally suppressible:

- **Boot no-resume:** `OVERDECK_NO_RESUME=1`, `pan dev --no-resume`, or
  `pan up --no-resume` disables orphan recovery and stopped-agent
  auto-resume for that dashboard boot only.
- **Manual pause:** `pan pause <id> [--reason <text>]` persists `paused`
  fields in `~/.overdeck/agents/<agent-id>/state.json` and stops the agent
  if it is running. `pan unpause <id>` clears the gate without spawning.
  `pan start <id>` refuses paused agents unless `--force` is passed.
- **Operator-stop gate:** `stoppedByUser` blocks autonomous re-drive when no
  completed handoff exists and emits one durable needs-you trip. Only an
  operator-initiated stop sets the flag (PAN-3324) — `pan kill`, `pan
  pause`, and the dashboard stop/pause actions pass it explicitly; every
  machinery-initiated stop (memory shedding, health force-kills, close-out)
  leaves it unset so autonomous recovery stays eligible. Recording an OOM
  kill as an operator stop is what once turned a transient resource event
  into a permanent stall.
- **Memory gate (PAN-2500):** the resource governor gates every autonomous
  resume/dispatch path — boot recovery, deacon-lite's own nudges, and
  review/test dispatch — on live memory pressure, not just agent count and
  CPU load. Below the SOFT reserve it defers new admissions; below HARD it
  sheds (stops merged/closed Docker stacks, then pauses idle work agents);
  it never re-admits until memory clears RECOVERY. This is separate from
  `--no-resume`, which suppresses resume outright regardless of memory.
- **Preemptive scheduler** (opt-in via `[concurrency] preemption = true`,
  PAN-2507) may **yield** an idle work agent — pause it to free capacity for
  a blocked review/test dispatch. A yield reuses the same `paused: true`
  gate, tagged `yieldedByScheduler`/`yieldedAt`, and is self-clearing:
  yielded agents resume oldest-first once a slot and the memory gate allow,
  and `pan unpause` on a yielded agent clears the yield attribution too.

These gates are orthogonal to deacon-lite's own start/stop toggle
(`pan admin cloister start|stop`).

## The pipeline journal (post-Cut follow-up to PAN-3917)

PAN-3917 deleted the stored per-issue pipeline record. That was right — state
is what git, the tracker, the PR and the terminal backend say — but it left a
hole: between "PR opened" and "review posted" nothing on disk said what
Overdeck was *doing*. `pan show` could only answer `in-review`, a work agent
told to "confirm the pipeline state change" had nothing to confirm it with and
polled for ten minutes (PAN-3705), and a dashboard restart mid-convoy lost the
convoy with nothing left to re-dispatch from.

One piece of stored pipeline state came back, and it is not a status.

**The contract** (`src/lib/cloister/pipeline-journal.ts`):

- **Append-only.** The server writes one entry at the moment it performs an
  action and never rewrites it. There is no update, no delete, no repair
  routine, and no API that exports one.
- **Not authority.** Readers take the last entry plus the PR. If the two
  disagree, the PR wins and the journal is merely stale. Nothing reconciles it.
- **Event-based, never polled.** Appending fires `pipeline.entry` on the
  existing pipeline-notifier. The dashboard projects it as a `pipeline.journal`
  domain event; a CLI-process append forwards over
  `POST /api/internal/pipeline/notify`.
- **Disposable.** It lives at `<workspace>/.overdeck/pipeline.jsonl`, beside
  `verification-latest.json`, and dies with the workspace. It is never written
  into a workspace that no longer exists.
- **Never fatal.** A write failure is logged and swallowed: an unwritable
  journal must not break the action that produced it.

**Entry types and who writes them**

| Type | Written by |
| --- | --- |
| `verification.started` / `.passed` / `.failed` | `cloister/verification-runner.ts`, at the start and at every outcome return |
| `verification.failed` (`failedCheck: 'test'`, `cycleCount`, `via: 'ci'`) | `cloister/ci-failure-feedback.ts`, when a `verification.tests: ci` project's CI test job is red on the PR head (once per head) |
| `review.requested` | `startRequestReviewPipeline` — the one door the HTTP route, `pan review request`, `pan done` and the PR webhook all pass through |
| `review.dispatched` | `cloister/review-convoy.ts` `launchConvoyReviewersPromise`, once reviewers exist |
| `review.redispatched` | deacon-lite's `recoverStalledReviews` |
| `review.verdict` | `pan admin specialists done review`, once the verdict reaches the forge |
| `merge.attempted` | the MERGE door in `routes/workspaces/merge-ops.ts`, once the merge holds the project's merge slot |
| `merge.failed` | merge-ops' own `setStatus`, the single funnel every failing exit of `triggerMerge` passes through |
| `merge.completed` | `cloister/merge-agent.ts` `postMergeLifecycle`, right after the forge answers "merged" |

`pan show <id>` prints the last six entries under the derived state; `--json`
carries the whole journal.

## Deacon-lite: five routines

`runDeaconLite()` runs on a 60s tick and holds five routines, all of which only
observe and nudge — none reconciles a stored copy of anything:

1. `checkStuckWorkAgents` — one nudge per hour to an idle work agent with
   unpushed commits.
2. `checkApiErrorAgents` — nudges an agent wedged on an API error.
3. `reconcileAgentLiveness` — corrects the dashboard's in-memory cache against
   the selected backend's inventory.
4. `reapClosedIssueAgents` — reaps agents for issues the tracker has closed.
5. `recoverStalledReviews` — the one recovery routine, and the only timer added
   by the journal work.

`recoverStalledReviews` reads the journal and nothing else — no GitHub call, no
tracker call. It acts only when an issue's **last** entry is `review.dispatched`,
`review.redispatched`, or `review.requested`, is at least 15 minutes old, and no
pane whose id starts with `agent-<issue>-review-` is live. The last-entry rule is
load-bearing: a `verification.failed` written *after* `review.requested` means
the work agent owes rework, and re-dispatching there would re-run verification
every hour forever. Only sub-reviewers count as "live" — the synthesis parent's
id is exactly `agent-<issue>-review`, and letting it mask four dead lanes is the
PAN-3939 wedge this routine exists to clear.

It then relaunches the missing lanes against the existing run
(`recoverMissingConvoyReviewers`), which reuses the parent's own `state.json` and
so re-verifies nothing; only a parent with no run state at all falls back to the
full review door. At most one re-dispatch per issue per hour.

**Accepted v1 gaps** (stated in the module, deliberately not built): a convoy
where some reviewers posted a verdict and one died is not recovered, because the
last entry is then `review.verdict` — `review.dispatched.data.reviewers` carries
enough to count verdicts later. A quick-mode review writes no `review.dispatched`
entry, so a dead quick reviewer is not recovered either. And a server death
between `verification.started` and its outcome leaves `verification.*` last,
which the rule above deliberately skips.
