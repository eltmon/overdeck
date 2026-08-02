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
1:1. The Stall Sweeper makes un-parking mechanical: one resolver answers
"what is stalled, why, and what releases it," and one patrol executes the
release.

## Glossary

- **Parked orbit** — a state an issue can sit in where no autonomous actor
  will advance it within 24h without operator or flywheel intervention.
- **Sweep** — one autonomous un-park action taken by the sweeper.
- **Guard-exit invariant** — every code path that parks an issue must also
  document the condition that releases it (and stuck flavors must carry
  operator copy — enforced in CI).
- **Terminal residue** — a closed issue's leftover rows. Never parked; the
  only row a closed issue can produce is `zombie-session`.

## The ten orbits

| # | Orbit | Detection (read doors only) | Release |
| --- | --- | --- | --- |
| 1 | `stuck-flag` | `review_status.stuck` (any `stuck_reason`) | sweeper: resume-with-feedback or review re-dispatch (flavor-dependent) |
| 2 | `needs-you` | open recovery trip in the per-issue permanent record | operator answers; sweeper re-surfaces on TTL |
| 3 | `deacon-ignored` | `review_status.deaconIgnored` | operator clears the flag; sweeper re-surfaces on TTL |
| 4 | `operator-gate` | agent `paused` (not yield) / `troubled` / `stoppedByUser` | `pan unpause` / `pan untroubled` / `pan start` — operator-only; re-surfaced on TTL |
| 5 | `uat-failed` | `uatStatus=failed` with merge pending | sweeper: UAT notes → fresh work-agent kickoff |
| 6 | `merge-failed` | `mergeStatus=failed`, no retry in flight | sweeper: reset for merge re-evaluation |
| 7 | `conflicts` | `conflictsSince` branch-invalidation mark | sweeper: resume work agent with conflict-resolution kickoff |
| 8 | `zombie-session` | live agent + merged/closed issue | sweeper: doctrine-sanctioned reap |
| 9 | `idle-running` | live agent, no pipeline owner, idle ≥ 6h | sweeper: nudge → stop if nothing moves in 90m |
| 10 | `circuit-breaker` | `autoRequeueCount >= 25` | operator decision; re-surfaced on TTL |

A **scheduler yield** (`yieldedByScheduler`) is NOT a park — it is
self-clearing. **Warm-idle on a pipeline-owned issue** (PAN-2579) is NOT a
park — review/test/merge owns the next move and the agent is supposed to wait.
`idle-running` only fires when no other orbit explains the stall.

## The read door

`resolveParkedPopulation()` in `src/lib/parked/resolver.ts` is the ONLY way any
surface answers "what is parked." It gathers through existing doors
(review-status door, agents table, tmux liveness, the record door for recovery
trips, tracker-closed via `isIssueClosed`), never a store directly, and runs a
two-pass closedness filter so terminal residue never renders as parked.
Surfaces:

- `pan parked [--json]` — CLI, oldest-first with why + release sentences.
- `GET /api/parked` — `{rows, summary}` for the dashboard.
- `GET /api/velocity` — transitions/hour plus the parked census.

## The sweeper (deacon patrol)

`runStallSweeperPatrol()` in `src/lib/cloister/stall-sweeper.ts` runs every
deacon patrol, walking rows in severity order (mechanical reaps and fresh
retries first, operator-gated last). Guardrails:

- **One action per row per cooldown** (15m zombie, 2h most orbits, 30m idle).
- **8 actions per park episode**, then escalate-only.
- **4 mutating actions per scan** — a graveyard census drains over cycles,
  never in one burst.
- **Resumes ask**: `decideAutonomousRedrive` consults the resume gates and the
  cached memory verdict; a defer is honored, not forced.
- **Operator gates are never overridden.** `operator-gate`, `deacon-ignored`,
  `needs-you`, and `circuit-breaker` rows are only re-surfaced to the operator
  on a 24h TTL — the anti-silence property.
- **Idempotent**: every action flows through existing write doors
  (review-status write door, `/api/agents` spawn, feedback writer, `stopAgent`).

## Events and surfaces

- `sweep.scan` — the parked population changed (compact rows; emitted on
  change only, never on a no-op scan).
- `sweep.action` — an autonomous action ran (nudge, merge reset, re-drive).
- `sweep.unparked` — a row was released; the issue re-enters the pipeline.
- `sweep.escalated` — a row was (re-)surfaced to the operator.

All four are registered in `packages/contracts/src/events.ts` and flow over
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
`src/lib/parked/__tests__/resolver.test.ts` proves all ten orbits classify
with non-empty `parkReason` + `unparkCondition`. Adding an orbit or a stuck
flavor without its exit documentation is unmergeable.
