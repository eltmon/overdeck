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
