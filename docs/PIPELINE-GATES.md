# Pipeline Gates: Verification, Verdict Routing, Convergence, Auto-Resume

## Verification Gate (PAN-174)

`pan done` runs quality gates (typecheck, lint, test) from `projects.yaml`
before opening or updating the PR and requesting review. If a gate fails,
feedback goes to the agent's session and the command refuses to proceed, so
the agent can fix and retry. There is no separate stuck counter stored on a
record — a run that keeps failing is visible directly in the PR's check
history.

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

CI runs vitest on every push; the `overdeck/test` commit status records only
that the changed-file-scoped verification gate passed for the tested sha.

## Verdict feedback routing

A review `request changes` or a failing test/UAT run returns work to the work
agent as PR review comments and/or a `pan tell` nudge. Delivery is confirmed
against the agent's transcript; an unconfirmed delivery surfaces a
needs-you escalation instead of reporting success (PAN-3846). There is no
separate feedback record — the PR thread and the transcript are the
evidence.

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
