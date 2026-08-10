# Pipeline Gates: Verification, Verdict Routing, Convergence, Auto-Resume

> Moved from CLAUDE.md (2026-08-07).

## Verification Gate (PAN-174)

After a work agent signals completion, Cloister runs quality gates from `projects.yaml`
before advancing to the review role. If typecheck/lint/test fail, feedback is sent to the
agent's tmux session and the issue does not advance, so the agent can fix and retry.
After 3 consecutive failures, verification is bypassed to prevent permanent blocking.

## Verdict feedback routing

Review `blocked`/`failed`, test `failed`, and UAT `failed` verdicts all return work to
the work agent through the same feedback doors: `writeFeedbackFile()` persists the
feedback, `resolveIssueFeedbackTarget()` finds or resurrects the work target, and
`surfaceIssueFeedbackNeedsYou()` creates a durable escalation when no target resolves.
The UAT relay is `src/lib/cloister/uat-failure-feedback.ts`.

## Review Convergence Gate (PAN-3151)

When a change enters the `blocked` review state, the blocking-finding count is recorded into a `reviewCycleHistory` series. When ≥3 cycles are recorded and the series shows a reversal (latest count > previous) or stall (two consecutive non-decreases), the issue is marked `stuck` with `stuckReason: 'review-not-converging'`. Automatic rework re-drive is suppressed; feedback file is written and PR comment posted, but the work agent is not messaged. A needs-you escalation surfaces with the cycle count series and guidance to decompose the change into sibling issues or run `pan unstick <issueId>` to clear the gate and attempt rework. Distinguish from the prompt-level convergence gate (`roles/review.md` — "Convergence gate (cycle ≥ 3)", currently around line 148), which governs single-reviewer filtering within one cycle.

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

