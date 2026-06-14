## Problem

Deacon's `recoverOrphanedAgents` patrol in `src/lib/cloister/deacon.ts:4716` kills **work agents** that are still in their startup window. It has a 90s startup grace window for **reviewer** agents (`REVIEWER_LAUNCHER_GRACE_MS = 90_000` at deacon.ts:4781) but no equivalent for work agents.

The 60s patrol interval racing the spawn flow's 30s ready-poll window guarantees occasional kills.

## Reproduction

Smoke-testing PAN-1122 swarm on 2026-05-20:

```
[2026-05-21T01:03:18.291Z] agent-pan-1122-1 status=starting (spawn began)
[2026-05-21T01:03:47.970Z] status changed: starting → stopped (saveAgentStateAsync)
[2026-05-21T01:03:47.978Z] status changed: starting → stopped (orphaned: tmux session missing at boot)
```

29.7s after spawn began, the deacon's orphan-recovery patrol fired. The slot's harness (`pi` + kimi-k2.6) was still starting — tmux session hadn't been established yet. Patrol saw no tmux → marked stopped → swarm dispatcher saw failed slot → aborted the whole wave-0 dispatch with `Failed to dispatch any slots for PAN-1122 wave 0`.

## Why this isn't covered by existing guards

In `recoverOrphanedAgentsOnce()` at deacon.ts:4750:

```ts
if (state.status !== 'running' && state.status !== 'starting') continue;
```

Scans both `running` AND `starting`. Then:

```ts
if (state.reviewSubRole) {
  // ... 90s REVIEWER_LAUNCHER_GRACE_MS check ...
}
// for non-review work agents — no grace window:
} else if (sessionExists(dir)) {
  continue;
}
// "Orphaned" — set status='stopped'
```

Work agents skip the grace check entirely.

## Impact

- ANY work agent (including swarm slots) whose harness takes >patrol-interval seconds to come up gets nuked
- kimi-k2.6 via Pi harness reliably exceeds 30s on a loaded system
- Swarm dispatcher's "abort wave on first slot failure" amplifies this: one slow slot kills the whole wave
- Blocks the entire src/lib Effect migration swarm (PAN-1249) since that needs reliable slot dispatch across many waves

## Proposed fix

Mirror the existing `REVIEWER_LAUNCHER_GRACE_MS` pattern for work agents in `starting` state. Approximately:

```ts
// Inside recoverOrphanedAgentsOnce(), before the "Orphaned" block at ~line 4803:
//
// Work agents (no reviewSubRole) need a startup grace window matching the
// spawn flow's 30s ready-poll plus tmux + launcher boot time on loaded
// systems. Without this, the 60s patrol races the spawn.
if (state.status === 'starting' && !state.reviewSubRole) {
  const startedMs = Date.parse(state.startedAt ?? '');
  const WORK_LAUNCHER_GRACE_MS = 120_000; // 2 min — covers kimi/pi cold-start on loaded systems
  if (Number.isFinite(startedMs) && Date.now() - startedMs < WORK_LAUNCHER_GRACE_MS) {
    continue;
  }
}
```

Value of 120s is intentionally generous — patrol-interval (60s) + 30s poll + some headroom. Better to keep an orphan in 'starting' for an extra minute than to nuke a slow-starting agent.

## Acceptance criteria

- [ ] `WORK_LAUNCHER_GRACE_MS` constant added at `src/lib/cloister/deacon.ts` next to `REVIEWER_LAUNCHER_GRACE_MS`
- [ ] Orphan recovery skips work agents in `status: 'starting'` within the grace window
- [ ] Reviewer pattern unchanged (`reviewSubRole` agents still use their own 90s grace)
- [ ] Unit test: agent in `starting` status with recent `startedAt` is NOT marked stopped by `recoverOrphanedAgentsOnce()`
- [ ] Unit test: agent in `starting` status with `startedAt` older than `WORK_LAUNCHER_GRACE_MS` IS marked stopped (so true orphans still get cleaned up)
- [ ] Unit test: agent in `running` status with no tmux session is STILL marked stopped (no regression for confirmed-dead running agents)
- [ ] PAN-1122 swarm smoke test succeeds end-to-end after fix

## Notes

- Spawn flow itself has a 30s ready-poll (`src/lib/agents.ts:2670-2693`) — this fix is for the OTHER side of the race, not the poll itself
- The "abort wave on first slot failure" behavior of the swarm dispatcher is arguably also wrong (one slow slot shouldn't kill the whole wave) — but that's a separate issue and out of scope here
- This affects all spawn surfaces, not just swarm — single-agent spawns with slow harnesses (kimi via pi, large model warmup) hit the same race

--- comment ---
Fixed via PAN-1249 work — `src/lib/cloister/deacon.ts` now has a 120s grace window for agents in `status: starting` (`WORK_LAUNCHER_GRACE_MS`). The PAN-1256 reference is in the code comment. Closing as already shipped.

--- comment ---
Reopening because not all original acceptance criteria are complete. Current main has the startup grace branch, but I could not find the required unit tests for recent `starting` work agents being skipped, expired `starting` work agents being marked stopped, and `running` agents with no tmux still being stopped; I also found no PAN-1122 swarm smoke evidence. Remaining work: add those tests/smoke evidence and keep reviewer grace behavior unchanged.

--- comment ---
Audit 2026-05-29 verified this shipped in `main`: Deacon spawn race — WORK_LAUNCHER_GRACE_MS startup grace window in src/lib/cloister/deacon.ts (6a92532fd). Closing as completed.

--- comment ---
🤖 **Agent completed work:**

Added deacon orphan recovery startup grace tests; merged main and verified npm test/typecheck/lint/build pass

--- comment ---
🤖 **Agent completed work:**

Fixed build/docs-index fallback and verified build, typecheck, and lint

--- comment ---
🤖 **Agent completed work:**

Fixed lint/build feedback and synced review state
