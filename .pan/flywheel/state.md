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
