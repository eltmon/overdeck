# Resource Governor (PAN-2500)

The deacon's autonomous resume/dispatch paths — boot orphan recovery, patrol auto-resume, reactive
resume-on-stop, and review/test/ship dispatch — now consult live memory pressure before admitting
an agent. Before this, they gated only on agent count and CPU load; nothing checked RAM, so the
deacon could resume dozens of stopped agents into a box that was already out of memory. `src/lib/cloister/memory-governor.ts` is the single module that closes that gap.

## Why this exists

The HTTP spawn path (an operator clicking "Start", or `pan start`) has always been memory-aware:
`evaluateSpawnGuardrails()` blocks a spawn with 429 when available RAM is critical. The deacon's own
autonomous paths never called it. Boot-reconciliation resuming a large stopped-agent backlog under
memory pressure caused a real out-of-memory incident that required a hard reboot — see
[GitHub issue #2390](https://github.com/eltmon/overdeck/issues/2390).

## The two-gates-now-one-door model

Two admission checks exist. They are deliberately separate and must stay that way:

- **`classifyMemoryPressure(availableBytes, thresholds)`** — the stateless predicate behind
  `evaluateSpawnGuardrails`. It compares against `resources.memoryWarnGb` / `resources.memoryBlockGb`
  (the dashboard's own regex-parsed config cache, `getResourceConfig()` in
  `system-health-service.ts`). Never touched by this work — the HTTP path's behavior is
  behavior-preserving.
- **`assessMemoryPressure()`** — the governor's own stateful check, described below. It reads
  `resources.governorSoftReserveGb` / `governorHardReserveGb` / `governorRecoveryReserveGb` through
  the real config-yaml loader (`loadConfigSync()`), a different config surface with different
  thresholds, tuned for the deacon's slower, patrol-cadence decisions rather than the HTTP path's
  one-shot verdict.

Every deacon call site that admits an agent — `autoResumeStoppedWorkAgents`,
`applyBootReconciliationDecision`, `handleAgentStoppedEvent`'s global gates, and
`canDispatchAdvancing` / `tryReserveAdvancingSlot` in `concurrency.ts` — now consults
`assessMemoryPressure()` (or its cached verdict) before admitting. That is the "one door": every
autonomous admission decision in the deacon runs through the same module.

## The three bands and hysteresis

`assessMemoryPressure()` classifies live `MemAvailable` into one of three bands, each mapped to a
governor mode:

| Band | Mode | Meaning |
|---|---|---|
| `ok` | `admitting` | Behavior unchanged from before PAN-2500 — count and load gates still apply. |
| `soft` | `holding` | Stop admitting new resumes and new advancing dispatches. Nothing is killed. |
| `hard` | `shedding` | Actively reclaim memory (see the eviction ladder below). |

The governor never re-admits the moment it clears SOFT. It holds until `MemAvailable` exceeds
RECOVERY — a threshold strictly above SOFT. Without that gap, a system oscillating around SOFT would
flip between admitting and holding on every patrol, resuming and re-stopping agents in a loop. The
transition rule (`nextGovernorMode` in `memory-governor.ts`) is:

```
available >= RECOVERY  -> admitting
available <  HARD       -> shedding
otherwise, if previously admitting and available < SOFT -> holding
otherwise                                                -> hold the current mode (never re-admit early)
```

```
 available RAM
      ^
 RECOVERY ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  <- only line that re-admits
      │            ┌─────────────┐
   SOFT ─ ─ ─ ─ ─ ─ │   holding   │ ─ ─ ─ ─ ─ ─ ─
      │  admitting  │  (no admit) │
   HARD ─ ─ ─ ─ ─ ─ └─────────────┘ ─ ─ ─ ─ ─ ─ ─
      │                  shedding
      └──────────────────────────────────────> time
```

The governor's mode is module-level state, persisted across calls within the process — it is not
recomputed from scratch each time, which is what makes the hold behavior possible.

## Footprint budget

Count-based caps (`max_work_agents`) don't bound gigabytes: the dominant RAM consumer for a work
agent is usually its docker workspace stack, not the `claude`/`codex` process itself. `estimateFootprint(role, projectKey)` predicts the footprint an about-to-be-admitted agent will hold:

- **Learned value** — the average live `docker stats` RSS across the project's currently running
  stacks (reused via `getResourceStacks`, the same attribution the Machine Room `/resources` page
  uses — [issue #2464](https://github.com/eltmon/overdeck/issues/2464)), when any exist.
- **Cold-start default** — a configured per-role fallback when no stack for that project is running
  yet (see config keys below).

`canAdmit(footprintBytes, availableBytes)` is the pinned admission predicate every caller shares:
`footprint <= availableBytes - softReserve`. An agent is deferred if admitting it would eat into the
SOFT reserve, even when a count slot is free.

The full per-agent footprint an operator would picture (claude/codex RSS + PTY supervisor + docker
stack RSS + a small reserve for tool spikes like Playwright/vitest) is not measured directly — the
docker-stack component dominates and is what `estimateFootprint` measures; the process/tool-spike
component is covered by the SOFT reserve's margin rather than tracked per-agent.

## Eviction ladder

`shed()` runs only when the band is `hard`. It reclaims cheapest-value-first:

1. **Stop merged/closed docker stacks**, unconditionally, before checking memory again. This is
   pure reclaim — the issue is done, nothing running is lost. The safety predicate
   (`stack.phase === 'merged'` plus excluding any issue with a live agent session) mirrors
   `isClosedStack` in `src/dashboard/server/routes/resources/reclaim.ts` exactly, inlined rather than
   imported — see the note in the `memory-governor.ts` source and
   [issue #2501](https://github.com/eltmon/overdeck/issues/2501) for why.
2. **If still `hard` after the stacks**, pause idle work agents one at a time — never running ones —
   re-checking memory pressure after each pause, stopping once the band clears `hard` or no eligible
   idle agent remains. Pausing stops the `claude` process (freeing its RSS) but preserves the tmux
   session and workspace; the agent resumes normally via `--resume` once the governor re-admits.
   The pause is tagged with the `[governor-slot]` reason prefix so `pan unpause` and the dashboard
   surface it distinctly from a manual pause.
3. **Never** an operator-attached agent (one with no `flywheelRunId` — the same exemption
   `emergencyBrake` in `concurrency.ts` uses) or a core service (dashboard, deacon, cliproxy,
   traefik). Core-service containers have no `issueId`, so step 1's stack filter excludes them by
   construction.
4. **Never** `docker pause` to reclaim RAM — a paused container keeps its memory resident; only
   `docker stop` actually frees it.

## Kernel safety net

Even a correct governor can be too slow, or wrong about what's safe to shed. `src/lib/tmux.ts`'s
`systemd-run` founding args for the managed tmux server unit
(`overdeck-tmux-server.service`) now include `--property=ManagedOOMPreference=avoid`, so
`systemd-oomd` deprioritizes that unit under system-wide memory pressure. See
[issue #2390](https://github.com/eltmon/overdeck/issues/2390) — the incident this defends against
was `systemd-oomd` picking the tmux server and killing all 55 agent processes at once. Verify a live
host with:

```bash
systemctl show overdeck-tmux-server.service -p ManagedOOMPreference
```

## Config keys and defaults

All keys live under `resources:` in `~/.overdeck/config.yaml`. Snake_case in the YAML file; the
normalized in-process config uses the camelCase names shown in parentheses.

| Key | Normalized field | Default | Meaning |
|---|---|---|---|
| `governor_soft_reserve_gb` | `governorSoftReserveGb` | `max(15% of total RAM, 8 GiB)` | Below this, stop admitting. |
| `governor_hard_reserve_gb` | `governorHardReserveGb` | `max(8% of total RAM, 4 GiB)` | Below this, start shedding. |
| `governor_recovery_reserve_gb` | `governorRecoveryReserveGb` | `max(25% of total RAM, 12 GiB)` | Above this, resume admitting. Always normalized to exceed the SOFT reserve, even if misconfigured. |
| `governor_footprint_default_work_gb` | `governorFootprintDefaultWorkGb` | `2` | Cold-start footprint estimate for a work agent. |
| `governor_footprint_default_review_gb` | `governorFootprintDefaultReviewGb` | `1` | Cold-start footprint estimate for a review agent. |
| `governor_footprint_default_test_gb` | `governorFootprintDefaultTestGb` | `1` | Cold-start footprint estimate for a test agent. |

Percentage defaults are computed once at process startup from `os.totalmem()`
(`computeGovernorReserveDefaultsGb` in `src/lib/config-yaml/defaults.ts`) — they scale to the host,
not a fixed constant. Every value can be overridden explicitly in `config.yaml`; an unset value
always falls back to the documented default, never a silent inline literal.

## Related documents

- [`docs/AGENT-STATE-PLANES.md`](AGENT-STATE-PLANES.md) — the liveness oracle section notes that
  admission through the tmux plane is now memory-governed.
- The project `CLAUDE.md`'s "Agent Auto-Resume Gates" section lists the memory gate alongside the
  existing boot no-resume, manual pause, and troubled gates.
