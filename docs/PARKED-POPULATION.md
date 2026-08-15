# The Parked Population and the Stall Sweeper

Canonical reference for the parked-issue taxonomy, the read door, the sweeper's
action table, and the guard-exit invariant. Filed as [PAN-3485](https://github.com/eltmon/overdeck/issues/3485);
implemented by [PAN-3486](https://github.com/eltmon/overdeck/issues/3486) (resolver), [PAN-3487](https://github.com/eltmon/overdeck/issues/3487) (sweeper),
[PAN-3488](https://github.com/eltmon/overdeck/issues/3488) (guard), [PAN-3489](https://github.com/eltmon/overdeck/issues/3489) (event stream),
[PAN-3490](https://github.com/eltmon/overdeck/issues/3490) (God View), [PAN-3491](https://github.com/eltmon/overdeck/issues/3491) (velocity).

## Why this exists

Every failure path in the pipeline parks the issue somewhere autonomous motion
stops. Each park was added as a post-incident safety valve, and each one fired
its escalation once and went silent forever — the operator was the only
un-parker, and the flywheel parks structural blockers by design. The measured
steady state (2026-08-02): of ~18 post-work in-flight rows, 12+ were parked in
terminal orbits, and pipeline velocity tracked one conversation's aliveness
1:1. The Stall Sweeper makes the release path visible: one resolver answers
"what is stalled, why, and what releases it," and one patrol records the
recommended release without acting on it.

## Glossary

- **Parked orbit** — a state an issue can sit in where no autonomous actor
  will advance it within 24h without operator or flywheel intervention.
- **Sweep** — a stall detection pass; today the sweeper only *recommends* (it
  never acts — see the observability-only law below).
- **Guard-exit invariant** — every code path that parks an issue must also
  document the condition that releases it (and stuck flavors must carry
  operator copy — enforced in CI).
- **Terminal residue** — a closed issue's leftover rows. Never parked; the
  only row a closed issue can produce is `zombie-session`. Terminality
  evidence is record-first (`pipeline.closedOut`, or `mergeStatus='merged'`
  with no `reopenedAt`), checked BEFORE any tracker call — a tracker blip
  cannot resurrect a record-terminal issue into the parked population
  (PAN-3727). Close-out also acknowledges open recovery trips and clears
  operator-gate flags on the issue's stopped agent rows, so a terminal
  issue's rows stop escalating even before the tracker check would settle it.

## The nine orbits

| # | Orbit | Detection (read doors only) | Recommended release |
| --- | --- | --- | --- |
| 1 | `stuck-flag` | `review_status.stuck` (any `stuck_reason`) | recommendation: consult active-run artifact evidence first (PAN-3511), then `pan unstick` + rework resume / `pan review restart` by flavor |
| 2 | `needs-you` | open recovery trip in the per-issue permanent record | operator answers; sweeper re-surfaces on TTL |
| 3 | `deacon-ignored` | `review_status.deaconIgnored` | operator clears the flag; sweeper re-surfaces on TTL |
| 4 | `operator-gate` | agent `paused` (not yield) / `troubled` / `stoppedByUser` | `pan unpause` / `pan untroubled` / `pan start` — operator-only; re-surfaced on TTL |
| 5 | `uat-failed` | `uatStatus=failed`, merge pending, and no live work agent | recommendation: `pan start <id>` |
| 6 | `merge-failed` | `mergeStatus=failed`, no retry in flight | recommendation: `pan review resync` for merge re-evaluation |
| 7 | `zombie-session` | live agent + merged/closed issue | recommendation: close-out owns teardown (`pan close`); the reaper is the backstop |
| 8 | `idle-running` | live agent, no pipeline owner, idle ≥ 6h | recommendation: `pan tell` nudge, then `pan kill` / resume if nothing moves |
| 9 | `circuit-breaker` | `autoRequeueCount >= 25` | operator decision; re-surfaced on TTL |

A failed UAT verdict reaches the work agent through the `setReviewStatus()`
write door and `src/lib/cloister/uat-failure-feedback.ts`. The relay writes the
feedback file with `writeFeedbackFile()` and resolves delivery with
`resolveIssueFeedbackTarget()`, so a `uat-failed` row means the relay found no
delivery target after its resurrection attempt.

The `stuck-flag` orbit consults the **verdict of record** from the
host-recorded active review run before making a recommendation. The sweeper is
observability-only: it never restores a verdict, clears a stuck flag, or
re-drives an agent. A fresh artifact changes its recommendation to preserve the
review evidence and await the canonical `pan admin specialists done review`
signal; with no artifact, it emits the existing flavor-specific recommendation.
See "Verdict of record" in `docs/REVIEW-AGENT-ARCHITECTURE.md`.

A **scheduler yield** (`yieldedByScheduler`) is NOT a park — it is
self-clearing. **Warm-idle on a pipeline-owned issue** (PAN-2579) is NOT a
park — review/test/merge owns the next move and the agent is supposed to wait.
`idle-running` only fires when no other orbit explains the stall.

## The read door

`resolveParkedPopulation()` in `src/lib/parked/resolver.ts` is the ONLY way any
surface answers "what is parked." It gathers through existing doors
(review-status door, agents table, tmux liveness, the record door for recovery
trips, tracker-closed via `isIssueClosed`), never a store directly, and runs a
two-pass closedness filter so terminal residue never renders as parked. Before
any of that, it checks record-level terminality first (`isRecordPipelineTerminal`,
shared with the residue patrol below): a live tracker call is fail-open toward
"open" and negative-caches its result for minutes, so one Linear/GitHub blip
must never resurrect an issue the record already knows is closed and merged
(PAN-3727). The reaper's own fail-closed posture (`isLinearIssueClosed` /
`isTrackerIssueClosed`) is deliberately unchanged — record-first terminality is
additive evidence for the resolver, not a relaxation of the reaper's guard.
Surfaces:

- `pan parked [--json]` — CLI, oldest-first with why + release sentences.
- `GET /api/parked` — `{rows, summary}` for the dashboard.
- `GET /api/velocity` — transitions/hour plus the parked census.

## The residue patrol (deacon patrol) — cleans up terminal-issue leftovers

`reconcileTerminalIssueResidue()` in `src/lib/cloister/parked-residue.ts` runs
on the deacon's state-plane cadence (~hourly), sweeping every project's
record-terminal issues (via the shared `isRecordPipelineTerminal` predicate)
for leftover open recovery trips and operator-gate flags (`stoppedByUser` /
`paused` / `troubled`) on stopped agent rows. Unlike the sweeper below, this
patrol DOES act: it acknowledges trips and clears gates through the existing
doors (`acknowledgeAllOpenRecoveryTrips`, `clearAgentOperatorGatesForIssueSync`)
so a terminal issue's residue stops re-surfacing as a ghost `needs-you` /
`operator-gate` escalation. Close-out (`pan close`) runs the same ack step at
merge time; this patrol is the backstop that catches residue predating that
fix and any future leak path, one issue at a time — a door failure for one
issue never blocks the rest (PAN-3727).

## The sweeper (deacon patrol) — OBSERVABILITY ONLY

`runStallSweeperPatrol()` in `src/lib/cloister/stall-sweeper.ts` runs every
deacon patrol, walking rows in severity order. **It detects and recommends; it
never acts** (operator directive 2026-08-05 — see the law in the module header
of `stall-sweeper.ts`). The earlier kill-and-re-drive incarnation acted on
drifted state (it killed a completed review parent on a lost verdict and
re-dispatched on phantom stuck flags), so the action surface was removed
entirely: the module holds no door to spawn, stop, message, dispatch, clear,
or reset anything. Do not reintroduce one.

What a patrol produces per row: a `sweep.recommendation` domain event and an
activity-feed entry naming the evidence and the canonical remedy (the same
doors the deacon/operator uses — `pan resume/start/tell/unstick/review
restart/sync-main/done/close`), plus an "Observability-only: no action taken"
trailer. Guardrails:

- **One recommendation per row per cooldown** (15m zombie, 2h most orbits, 30m idle).
- **8 recommendations per park episode**, then escalate-only.
- **4 recommendations per scan** — a graveyard census surfaces over cycles,
  never in one burst.
- **Operator gates are never overridden.** `operator-gate`, `deacon-ignored`,
  `needs-you`, and `circuit-breaker` rows are only re-surfaced to the operator
  on a 24h TTL — the anti-silence property.
- **Idempotent reporting**: recommendation and escalation state flows through
  the sweeper-state writer so the feed is not flooded.
- **Recurring stalls flag substrate.** A stall that recurs across an episode
  appends a substrate-bug note so the flywheel's intake files *why* the issue
  keeps parking, instead of the symptom being swept forever.

## Events and surfaces

- `sweep.scan` — the parked population changed (compact rows; emitted on
  change only, never on a no-op scan).
- `sweep.recommendation` — a recommended remedy with evidence (never an action).
- `sweep.escalated` — a row was (re-)surfaced to the operator.

All three are registered in `packages/contracts/src/events.ts` and flow over
`/ws/rpc` like any domain event. The God View consumes them (see
`docs/GOD-VIEW.md` — the sweeper beam, thaw, and flare); the activity feed
renders full-sentence sweep entries.

## Velocity metric

`GET /api/velocity` counts REAL stage transitions in the trailing hour:
`issue.transitioned`/`issue.statusChanged` buckets plan/work, and
`review.status_changed` is walked per issue so only actual verdict-tuple
changes count — unchanged writes (the PAN-3447 shape: 88 writes, ~6
transitions) count for nothing. The God View top bar shows `VEL/h` with a
per-stage tooltip; the sidebar shows FLOW/HOUR with per-stage counts.

## Guard-exit invariant (CI)

`scripts/guard-park-exits.sh` (wired into `npm run lint` as `lint:park-exits`)
fails the build when a stuck flavor is parked without operator copy in
`STUCK_REASON_COPY`. The fixture meta-test in
`src/lib/parked/__tests__/resolver.test.ts` proves all nine orbits classify
with non-empty `parkReason` + `unparkCondition`. Adding an orbit or a stuck
flavor without its exit documentation is unmergeable.
