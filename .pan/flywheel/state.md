# Flywheel state

Durable memory across Flywheel runs: substrate fixes the loop drove and
learnings worth keeping. Append only. No pipeline status, run ids, or counters.

## Substrate fixes

### PAN-4383 review never starts → PAN-4506 (2026-10-04)

- **What broke:** every re-review of PR #4387 launches a fresh Claude Code
  reviewer pane that sits at an empty prompt (0% context, no transcript). The
  kickoff is rejected by Herdr with `invalid_request: unexpected end of hex
  escape at line 1 column 4021`, both delivery attempts fail, and deacon-lite
  logs `review.stalled` then `review.stall-escalated`. It happened on the
  17:24 and 20:40 UTC review requests of 2026-10-03.
- **Evidence:** review pane `wPT:pK` empty prompt; lifecycle log
  `~/.overdeck/agents/agent-pan-4383-review/lifecycle.log` shows transcript
  `734d5f07-…jsonl` never created; `.pan/review/agent-pan-4383-review-4e585623/`
  holds only `context.json`, no report.
- **Fix:** PAN-4506 (kickoff text near char ~4000 serializes to JSON Herdr
  rejects; a non-retryable `invalid_request` must fail the dispatch instead of
  looking like a silent reviewer). Do not `pan review restart` PAN-4383 until
  PAN-4506 lands: the same kickoff fails the same way.

## Open observations (not yet diagnosed to file:line)

### God View sinks issues with active work agents into the doldrums (2026-10-04)

- An operator screenshot at ~03:34 UTC showed PAN-4256, PAN-4260 and
  PAN-4508 as `❄ … 1h idle` (stale orbs), while each issue's work agent
  (`agent-pan-<n>`) had written its transcript within the last minute.
- The ~1h age matches when each issue's planning agent finished. The planning
  agents' `state.json` still says `running` with dead panes, but that is by
  design (`src/lib/overdeck/planning-promotion.ts` comment above
  `projectPlanningAgentStopped`, PAN-3917/PAN-4210), so the label is not the
  fault.
- Frost accrues client-side from `idleMin` in
  `src/dashboard/frontend/src/components/GodView/confluence/RiverCanvas.tsx`
  (stale label at line 567, reset only in `thaw`). Next step: find which
  events reset an orb's `idleMin` and whether a work agent's events reach the
  orb that the planning agent created.

## Learnings

- A review that stalls twice with an empty reviewer pane is a delivery
  failure, not a slow reviewer. Run `grep -a "Kickoff delivery attempt"
  ~/.overdeck/logs/dashboard.log` before re-dispatching (`-a` is required:
  the log holds NUL bytes, so plain grep silently matches nothing).
- To judge whether a work agent is alive, read the transcript path its own
  `lifecycle.log` resolved (`agent-pan-<n>`), not the newest `*.jsonl` in
  the workspace's project dir: the planning session's transcript lives there
  too and can mask an idle work agent, or the reverse.

### God View frozen orbs and river misdraws → PAN-4522, PAN-4523 (2026-10-04)

- Resolves the open observation above. The planning agents were not the
  cause. A dashboard restart boots the read model with an empty
  `agentRuntimeById` (`src/dashboard/server/read-model.ts` boot state), the
  client snapshot reducer replaces its runtime map wholesale
  (`packages/contracts/src/event-reducers.ts` line 337), and God View falls
  back to the spawn-time `state.json` `lastActivity`, so every busy agent
  reads as idle since spawn until its next tool beat → PAN-4522.
- Layout overlap of the shelf and doldrums bands, merged issues held on the
  shelf by the close-out pause, and PLAN/REVIEW counters counting stopped
  agents → PAN-4523 (God View frontend only).
- Learning: right after a `pan reload`, the God View and any other
  `agentRuntimeById` consumer under-report activity. Do not diagnose agent
  idleness from them in the first minutes after a restart.

### Stale verification worker fails a fixed head → PAN-4527 (2026-10-04, needs-handoff)

- PAN-4498's re-review after a fix push joined a verification worker started
  on the previous head, which then failed the new head with the old head's CI
  result ("The CI test job already failed on this head (c9994b06)") although
  CI on the new head had passed. Root cause:
  `src/lib/cloister/verification-worker-supervisor.ts` line 178 treats every
  review-verification worker as `sameHead`, and `verification-runner.ts`
  reads CI for the launch-time `headShort`. Review machinery (TENET-10), so
  filed `needs-handoff`, not started.
- Instance recovery: told the agent the failure was stale and to re-request
  review on its current head. Tell: a `verification.failed` whose gate record
  names a different head than its `head8`, or a test gate at `0ms`, is this bug.

## Run rules (operator decisions)

### Go idle when the pipeline is clear; stuck is not clear (2026-10-04, PAN-4530)

- With auto-pickup off, when nothing is pickable and the pipeline is clear,
  write and push `.pan/flywheel/report.md`, print `phase=idle needs-you=pipeline
  clear — ready for operator close-out`, stop scheduling ticks, and keep the
  conversation open. Only the operator ends the run.
- Clear = every drained issue merged, deployed (`/api/health` `buildCommit`
  contains it) and closed out or waiting only on automatic verify-on-main.
  Not in flight: `needs-handoff` / operator-decision items, parked or vetoed
  issues, other projects' long-paused agents.
- If an in-flight issue cannot move without the operator, keep ticking and
  name the blocker; a stopped loop must always mean clear, never stuck.
- PAN-4530 carries the skill-text change (needs-handoff, TENET-10).

### Overnight restart approval is per-run, never standing (2026-10-04)

- The operator authorized `pan restart approve` for the 2026-10-04 night only,
  after each merge with CI green on the exact `origin/main` tip, then verifying
  `/api/health` `buildCommit` contains the merge. Ask again on every new run.

### Doomed verification holds the single CPU admission slot → PAN-4531 (2026-10-04, needs-handoff)

- Verification runs all local gates (~25 min) before reading the CI test
  verdict, so a head whose CI already failed still holds the machine-wide
  admission slot, blocking every other verification and the agent's own
  isolation test runs (PAN-4259 at 04:37). Root cause:
  `src/lib/cloister/verification-runner.ts` ~line 581 computes `ciTestRed`
  after the gates. Not fixed by hand: killing a worker mid-run risks wedging
  its verification state.
- Learning: overnight throughput is bounded by the serialized gate queue,
  not by agents. Check `~/.overdeck/verification-workers/admission/owner.json`
  before calling a long verification "stuck".

### Restart during verification loses the review dispatch → PAN-4532 (2026-10-04, needs-handoff)

- Verification workers survive a dashboard restart, but the waiter that
  dispatches review after `passed` dies with the old process; the deacon's
  re-request then ignores the finished result
  (`verification-worker-supervisor.ts` line 174 joins only result-less
  workers) and re-runs every gate. PAN-4515 lost a passed verification this
  way after the 04:21 deploy.
- Run rule until PAN-4532 lands: never approve a dashboard restart while any
  `dist/verification-worker.js` process is alive. Deploy in a gap between
  verifications.
- Recovery for a restart-lost dispatch (until PAN-4532 lands): when the
  journal shows `verification.passed` but no reviewer spawned, and the newest
  `.overdeck/verification/*.json` `head8` equals both the workspace HEAD and
  the PR `headRefOid` with a clean tree, run `pan review restart <id>`. It
  dispatches the reviewer without re-verifying. Letting the deacon re-request
  instead re-runs every gate. Used on PAN-4257 (2026-10-04 04:57).
- Collision warning for that recovery: deacon-lite re-requests a lost
  dispatch on its own within minutes ("a dashboard restart during verification
  left the review undispatched"), and that re-request starts a full
  re-verification. On PAN-4498 and PAN-4508 (05:06) the deacon fired within a
  minute of `pan review restart`, giving each a reviewer plus a duplicate
  verification. Run `pan review restart` only right after `verification.passed`
  lands, and check that the journal has no later `review.requested` from
  deacon-lite first. Do not kill a duplicate worker: the supervisor records a
  killed worker as an `error`, which feeds back to the agent and adds a round.

### Deploys blocked by a comment the boot preflight reads as an import → PAN-4541 (2026-10-04, critical)

- Every `pan reload` since `66777e339e4` (PAN-4508) aborts with "Deployment
  cannot resolve custom from …/dist/dashboard/server.js". The preflight's
  regex scanner (`src/lib/bundle-imports.ts` line 16) matches `from "custom"`
  in a JSDoc comment PAN-4508 added to `src/lib/jev/settings-validation.ts`.
  The old dashboard keeps running (the preflight works); nothing ships.
- Learning: a failed reload leaves the gate `idle` and only says why in the
  reload log, so a deploy watcher that only checks `buildCommit` sees
  "not deployed" and nothing else. Read the newest `reload-*.log` after every
  reload attempt.
- Learning: a background deploy loop ran twice (origin unknown), which could
  race two reloads. Guard any deploy script with `flock`.

### Run end 2026-10-04 ~10:45 UTC: pipeline clear, loop idle

- 19 PRs merged, deployed and closed overnight. Close-out is NOT automatic
  here (`close_out.auto` unset): merged and deployed issues stay
  `verifying-on-main` until `pan close <id> --force` runs (no `--accept-*`).
  PAN-4543 removed the two flaky refusals (deploy probe vs the event-loop
  stall from sync cost reads; stale `running` verification artifacts).
- Throughput lesson: the night's bottleneck was the serialized gate queue
  plus the verification/merge bugs PAN-4527/4531/4532/4534/4540, not agents.

### Operator decisions after the 2026-10-04 run

- Release v0.65.0 (cut 2026-10-04).
- SHOULD-level review findings (CodeRabbit's included) that merge unaddressed
  are listed in every run report under "Unaddressed SHOULD-level review
  findings". The operator picks which become issues; none are auto-filed.
- Verification/auto-merge bugs PAN-4527/4532/4531/4540/4534 go through one
  supervised handoff (conversation 3230, held until the operator sends it).
- Two concurrent quality gates with a pressure fallback → PAN-4546
  (needs-handoff). Automatic close-out restored → PAN-4547 (needs-handoff;
  until it lands, the Flywheel closes deployed issues itself with
  `pan close <id> --force`, never with an override).
