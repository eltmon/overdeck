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

## System-health domains and state derivation

The V2 system-health snapshot separates evidence into four domains so one kind of signal cannot
silently stand in for another:

- **Host** reports current CPU and memory-pressure evidence from the operating system.
- **Admission** reports whether a new work agent fits inside the configured HTTP spawn reserves.
- **Agent** reports each agent's runtime and session health.
- **Service** reports required and optional Overdeck services; an optional service that is not
  configured is neutral rather than degraded.

Overall health is derived in a fixed order. A critical host, dead agent, or wedged agent makes the
snapshot `critical`. A warning host, warning or stalled agent, or degraded or stopped service makes it
`warning`. Host warmup produces `measuring`; after warmup, unavailable host, agent, or service evidence
produces `unavailable`; otherwise the snapshot is `healthy`. The sampler begins in `measuring`, accepts
state changes only after three consecutive matching assessments, and moves state, reasons, and metrics
together. An invalid later sample retains the last accepted assessment but marks its evidence stale.

Admission is intentionally a separate domain and does not promote overall health by itself. Low memory
headroom can make admission `soft` or `blocked` without claiming that the host is under active pressure.
On Linux, host pressure is raised only when low headroom is paired with current evidence: memory PSI
`some` has a warning threshold of 5 over 10 seconds, PSI `full` has a critical threshold of 1 over 10
seconds, and swap activity warns at 64 MiB/min and becomes critical at 256 MiB/min. On macOS, the native
memory-pressure free percentage warns at 10% or less and becomes critical at 5% or less.

Swap occupancy and virtual memory commitment remain visible diagnostics because they explain historical
or configured memory use, but neither indicates current pressure. Unsupported platforms and collectors
that cannot produce a signal return `unavailable`/`null`; they never fabricate a measured zero.

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
| `hard` | `shedding` | Admission is blocked. Automatic eviction is not wired; the kernel may start killing processes if memory stays exhausted. |

The normal recovery path holds until `MemAvailable` exceeds RECOVERY — a threshold strictly above
SOFT. A second path prevents a transient dip from holding a healthy host indefinitely: when PSI
`full avg10` stays below `governor_psi_calm_readmit_avg10` continuously for
`governor_psi_calm_window_ms`, the governor can re-admit at SOFT. The calm window re-arms after every
early re-admission, so another dip must earn a fresh full window before it can re-admit again.
Without these conditions, a system oscillating around SOFT could resume and re-stop agents on every
patrol. The base transition rule (`nextGovernorMode` in `memory-governor.ts`) is:

```
available >= RECOVERY  -> admitting
available <  HARD       -> shedding
otherwise, if previously admitting and available < SOFT -> holding
otherwise                                                -> hold the current mode (never re-admit early)
```

```
 available RAM
      ^
 RECOVERY ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  <- normal re-admission
      │            ┌─────────────┐
   SOFT ─ ─ ─ ─ ─ ─ │   holding   │ ─ ─ ─ ─ ─ ─ ─
      │  admitting  │  (no admit) │
   HARD ─ ─ ─ ─ ─ ─ └─────────────┘ ─ ─ ─ ─ ─ ─ ─
      │                  shedding
      └──────────────────────────────────────> time
```

The governor's mode, trigger, and calm-window start are module-level state persisted across calls
within the process. The verdict carries the trigger kind, trigger-time reading, threshold, and time.

## Activity-Feed Signals (PAN-3550)

The memory governor's level transitions and kernel OOM kills appear in the dashboard activity feed via a dedicated 15-second deacon timer, independent of the 60-second patrol. The timer emits **transition-only** — one row per level change, never duplicates while the level persists.

Four feed levels:
- **`ok`** — MemAvailable above the watch reserve; Overdeck is admitting work normally.
- **`watch`** — MemAvailable below the watch reserve but still admitting (band is `ok`). Warning that the soft reserve may soon be crossed.
- **`holding`** (band `soft`) — Overdeck has stopped admitting new agents and dispatches. Work queues until normal recovery or PSI-calm early re-admission.
- **`shedding`** (band `hard`) — MemAvailable is below the hard reserve. Overdeck admits nothing; the kernel may OOM-kill. Automatic eviction is not wired.

Top RSS consumers are attributed to Overdeck tmux sessions via `getRuntimeCensus()` (the in-repo runtime census, not the machine-local `.overdeck/logs/memory-census.log`).

Each non-admitting message separates the stored cause from the current reading. For example:

> Overdeck stopped admitting work at 14:22 UTC when available memory dipped to 8.9 GiB, under the 9.4 GiB soft reserve. 12.5 GiB is available now. Admissions resume at the 15.7 GiB recovery reserve, or at the 9.4 GiB soft reserve once memory pressure stalls (PSI full avg10) stay below 0.05 for 10 minutes. Nothing has been stopped or killed.

**OOM Canary** watches the kernel journal for `oom-kill:` lines, parses the victim's pid, command, RSS, and cgroup, and emits one activity entry per kill. The cursor-file pattern ensures no duplicate reporting across patrol ticks or dashboard restarts. On permission error (user not in `adm` group), the canary disables itself gracefully and logs once, never blocking the rest of the patrol.

### Swap runway and PSI

The governor composes three host signals into that single mode:

- `MemAvailable` measures how much memory the kernel can allocate now.
- `SwapFree` measures the remaining runway for an allocation burst. When free swap falls below
  `governor_swap_soft_free_percent`, the governor enters `holding` even if RAM is above RECOVERY.
- Memory Pressure Stall Information (PSI) `full avg10` measures how much time all runnable work spent
  stalled on memory during the last ten seconds. Low swap upgrades from `holding` to `shedding` only
  when `full avg10` reaches `governor_psi_full_shed_avg10`.

Swap uses the same hysteresis latch as RAM. After the governor stops admitting, free swap must reach
`governor_swap_recovery_free_percent` before the swap signal clears on the normal recovery path.
That path requires both `MemAvailable >= RECOVERY` and `SwapFree` at or above the recovery
percentage. PSI-calm early re-admission is the exception: after a fresh full calm window begins in
the non-admitting state, the governor can re-admit at SOFT even while swap remains below its recovery
percentage, because idle swap residency without live stalls is not current pressure.

A machine with `SwapTotal = 0` keeps the RAM-only behavior. If PSI is unavailable, low swap still
holds admissions, but it cannot trigger shedding by itself; only the RAM HARD threshold can do that.

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

### Memory-DRIVEN admission ceiling (PAN-2504)

PAN-2500 shipped the footprint budget as a **brake** — `assessMemoryPressure()` *defers* new
admissions once free RAM drops below the SOFT reserve. But the admission **ceiling** stayed a fixed
count (`max_work_agents`, default 6), so a large box idled far below its RAM: the governor never
*drove utilization up* toward the budget, it only stopped a flood.

PAN-2504 closes that gap. When `concurrency.memory_driven = true`, `workResumeSlotsAvailable()`
returns a **memory-derived** ceiling instead of `max_work_agents - running`:

```
additional_slots = floor((availableBytes − softReserve) / work_footprint_gb)
                   capped by (memory_driven_max_work_agents − running_work)
```

The SOFT reserve is read from the cached memory verdict's `thresholds.warningBytes`, so the
computation is synchronous and needs no import of the governor (avoiding the dependency cycle that
`memory-verdict-cache.ts` exists to break). `availableBytes` already reflects running agents' RSS,
so the result is genuinely *how many more fit*. Every deacon admission path
(`handleAgentStoppedEvent`, `autoResumeStoppedWorkAgents`, `applyBootReconciliationDecision`)
consults `workResumeSlotsAvailable`, so all three become memory-driven at once.

Safety: the upfront slot count *is* the projected budget (footprints that fit under the reserve), so
one patrol admitting up to it cannot exceed the budget even before RSS materializes; the
per-iteration `assessMemoryPressure()` brake is the real-time floor if the footprint estimate was
too low; and `memory_driven_max_work_agents` is a hard upper bound. The mode is **opt-in** (default
`false`) — unset installs keep the fixed count cap. When the governor has not yet published a
verdict, the helper fails safe to the count cap rather than admitting blind.

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

Under the warm-by-default session lifecycle (PAN-2579, see
[ROLES.md](./ROLES.md#session-lifecycle-warm-by-default-pan-2579)), this governor is the **only
sanctioned evictor** of warm role sessions besides a reboot: role sessions — including review
convoy sessions that have already recorded a verdict — persist for fast resume/re-review and are
shed here when memory pressure demands it. Nothing else in the pipeline may kill a warm session as
a side effect of recording a verdict (the PAN-1716 reap-on-verdict behavior was removed under
PAN-2579).

Concretely, `shed()` inserts a step between the stack teardown and the work-agent pauses: while
the band is still `hard`, it kills **warm-idle advancing sessions** (review/test/ship whose phase
verdict is terminal, selected by `selectNonMergedTerminalAdvancingSessions`) one at a time,
re-checking pressure after each. This is the cheapest agent shed — the verdict is durable and the
next dispatch resumes the saved session with its context, so a shed costs re-review latency, not
state. Warm-idle sessions also do not count against the advancing ceiling
(`countWarmIdleAdvancingAgents` in `concurrency.ts`), so keeping them warm never starves dispatch.

## Quality-gate CPU admission

Quality-gate admission is separate from agent admission and memory shedding. `src/lib/cloister/quality-gate-admission.ts` places local and container command gates in a cross-process FIFO, then admits the oldest live waiter only when sampled CPU utilization is below 75% and one-minute load is below 1.0 per core. It rechecks after a 1.5-second settle period, serializes active local gates through one owner lease, and reclaims dead or over-age queue state.

Every retry obtains a fresh lease and releases it in `finally`. Remote commands and HTTP health checks bypass the local CPU slot. This scheduler never stops an agent, pauses a workspace, changes memory-governor mode, or enforces cost policy; it prevents simultaneous builds and test suites from starving the dashboard while the memory governor continues to own RAM admission and shedding.

Detached verification workers persist `phase: queued | running` plus `admittedAt`. Their 65-minute execution timeout starts when the first gate is admitted, rather than when the worker entered the CPU queue.

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

## inotify watch budget (PAN-3063)

`fs.inotify.max_user_watches` is a per-UID kernel budget shared by every process and container
the Overdeck user runs. Exhaustion does not degrade gradually — the next process that tries to
add a watch (typically a Vite dev server in a workspace container) dies with ENOSPC while the
rest of the host looks healthy. The 2026-07-25 MIN-898 incident: six MYN fe-container Vites each
held ~157k watches (an unignored ~144k-file `.pnpm-store/` inside the project root), saturating
the 1,048,576 budget so whichever fe container restarted next lost.

The signal lives in the system-health pipeline, not the memory governor:

- `src/lib/system-health/inotify.ts` scans `/proc/<pid>/fd` for `anon_inode:inotify`
  descriptors and sums `inotify wd:` lines from fdinfo — the kernel exposes no aggregate
  counter. Unprivileged reads only reach same-uid processes, which matches the per-UID scope
  of the budget.
- The Linux collector refreshes that scan on its own 60s cadence (`INOTIFY_REFRESH_MS`) — the
  /proc walk is far heavier than the other 15s reads — and emits
  `inotifyWatchesUsed/Max/UsedPercent` metrics.
- `evaluate.ts` raises `host.linux.inotify_watches.warning|critical` at 80% / 90%
  (`PAN_HEALTH_INOTIFY_WARN_PERCENT` / `PAN_HEALTH_INOTIFY_CRITICAL_PERCENT`), independent of
  memory admission state — the watch budget can run out on an otherwise healthy host.
- Surfaces: the SystemHealthPill degrades, `InotifyPressureBanner` appears in the dashboard's
  system-notices row with a copyable sysctl fix, and `pan doctor` reports usage, top consumers,
  and whether the configured limit survives a reboot (`src/cli/commands/doctor-inotify.ts`).

Raising the limit requires sudo, so remediation is always operator-run — the banner and doctor
print the command; no Overdeck daemon ever escalates. Admission gating on watch headroom
(deferring workspace-stack spawns the way the memory SOFT band does) is the deliberately
deferred phase 2 of PAN-3063.

## Preemptive scheduling (PAN-2507)

The governor sizes the *pool* (how many agents may run); the **preemptive scheduler** schedules
*within* it for maximum pipeline throughput. The problem it solves: when a review/test/merge
("advancing") dispatch cannot reserve capacity, the deacon otherwise defers to the next patrol —
indefinitely, if idle work agents hold the box. The pipeline's *drain* then starves behind its
*fill*. Preemption lets a blocked advancing dispatch **yield** an idle work agent — pause it
(resumable; session killed, state preserved) to free the slot/memory, dispatch the advancing role,
and auto-resume the yielded agent oldest-first once capacity returns.

Priority is fixed; preemption only flows **down** it, never up:

```
merge/ship  >  test  >  review  >  work-rework  >  work-new
```

An advancing dispatch may yield a work agent; new work never preempts anything; advancing roles
never preempt each other. The owner of the mechanic is `src/lib/cloister/preemption.ts`:

- **Victim selection** (`selectYieldVictim`, pure) requires an agent that is role `work`, status
  `running`, idle (`isAgentIdleForNudge`), **not** operator-attached, **not** already paused, and
  **not** inside its post-resume re-yield cooldown. Among the eligible it prefers (a) an agent whose
  own issue is blocked on the pipeline (`reviewStatus` `pending` or `reviewing` — it is waiting
  anyway), then (b) the longest-idle.
- **Yield** (`yieldWorkAgentFor`) reuses the `paused: true` write path plus two attribution fields
  (`yieldedByScheduler`, `yieldedAt`), so **every** existing no-resume gate — deacon skip paths,
  boot reconciliation exclusion, spawn refusal — protects a yielded agent for free. It stops the
  session through the async `stopAgent` Effect.
- **Resume-first** (`resumeYieldedAgents`) runs at the top of `autoResumeStoppedWorkAgents`, ahead of
  any other stopped candidate, oldest-`yieldedAt` first, capped by the free work-slot budget and
  gated on the same per-iteration `assessMemoryPressure()` brake.
- **Anti-thrash**: an agent resumed from a yield may not be re-yielded for `yield_cooldown_secs`
  (tracked via `lastYieldResumeAt`); at most `max_yielded` agents may be yielded at once; and a yield
  only sticks when the reservation retry actually succeeds — otherwise the victim is resumed
  immediately.

An operator `pan unpause` on a yielded agent clears the yield attribution too (it self-heals),
preserving only `lastYieldResumeAt` as the cooldown tracker. Every yield and resume emits a
`logDeaconEventSync` line and a plain-sentence activity-feed entry naming both issues, e.g.
`Yielded agent-pan-1234 (idle 22m) to run review for PAN-5678`.

This is opt-in and **disabled by default** — an unset install keeps the static defer-until-attrition
behavior at every dispatch site (see the config table below). Preemption pauses idle work agents at
slot granularity for throughput; it is the only automatic reclaim path that runs. `shed()` remains in
the module but is wired to no caller (PAN-3550) — nothing evicts docker stacks or pauses agents under
HARD pressure on its own.

Recovery reconcilers do not bypass the governor. `decideAutonomousRedrive()`
first applies the unified resume policy and then reads the cached memory verdict;
under `holding`, stack rebuilds, dead-session respawns, and foreman revivals
remain deferred. A foreman is a work agent and consumes one work-concurrency seat;
the swarm janitor checks that capacity before it attempts a revival. Slot dispatch
uses the separate reserved swarm-slot budget through the explicit dispatch gate.
Role-specific concurrency reservations are acquired only after
that admission decision. When memory returns to the recovery band, the same
durable obligation is re-derived on the next deterministic patrol.

## Config keys and defaults

### Live health and HTTP admission

The health sampler reads the `resources.memory_warn_gb`, `memory_block_gb`, `agent_warn_count`, and
`agent_block_count` settings from `~/.overdeck/config.yaml`; environment variables can override those
values and the sampler-specific settings:

| Environment key | Default | Meaning |
|---|---|---|
| `PAN_HEALTH_POLL_SECONDS` | `15` | Poll interval after the initial three-sample warmup. |
| `PAN_MEMORY_WARN_GB` | `4` | Available-memory reserve below which HTTP spawn admission becomes `soft`. |
| `PAN_MEMORY_BLOCK_GB` | `2` | Available-memory reserve at or below which HTTP spawn admission becomes `blocked`. |
| `PAN_AGENT_WARN_COUNT` | `8` | Agent-count warning context retained by health configuration. |
| `PAN_AGENT_BLOCK_COUNT` | `10` | Agent-count block context retained by health configuration. |
| `PAN_HEALTH_SWAP_WARN_PERCENT` / `PAN_HEALTH_SWAP_CRITICAL_PERCENT` | `20` / `50` | Diagnostic reference bands for swap occupancy; occupancy does not change health state. |
| `PAN_HEALTH_LOAD_WARN_PER_CORE` / `PAN_HEALTH_LOAD_CRITICAL_PER_CORE` | `1` / `1.5` | Diagnostic load-per-core reference bands. |
| `PAN_HEALTH_OVERCOMMIT_WARN_PERCENT` / `PAN_HEALTH_OVERCOMMIT_CRITICAL_PERCENT` | `150` / `200` | Diagnostic reference bands for virtual commitment; commitment does not change health state. |

Normalization accepts finite nonnegative numbers, floors poll seconds and agent counts to integers, and
requires warning/critical pairs to be ordered. Memory reserves are the decreasing pair (`warn >= block`)
because less available memory is more severe; the other pairs are increasing. An invalid value or
reversed pair falls back to its named defaults, and startup emits one consolidated warning listing every
fallback.

These HTTP admission reserves answer a one-shot question: whether one requested spawn has enough
headroom. The autonomous governor reserves below answer a stateful patrol question: whether Deacon
should admit, hold, or shed work over time. They have separate settings and thresholds by design, so a
health admission result must not be substituted for the governor's hysteretic decision.

### Autonomous governor

All governor keys live under `resources:` in `~/.overdeck/config.yaml`. Snake_case in the YAML file;
the normalized in-process config uses the camelCase names shown in parentheses.

| Key | Normalized field | Default | Meaning |
|---|---|---|---|
| `governor_soft_reserve_gb` | `governorSoftReserveGb` | `max(15% of total RAM, 8 GiB)` | Below this, stop admitting. |
| `governor_hard_reserve_gb` | `governorHardReserveGb` | `max(8% of total RAM, 4 GiB)` | Below this, start shedding. |
| `governor_recovery_reserve_gb` | `governorRecoveryReserveGb` | `max(25% of total RAM, 12 GiB)` | Above this, resume admitting. Always normalized to exceed the SOFT reserve, even if misconfigured. |
| `governor_swap_soft_free_percent` | `governorSwapSoftFreePercent` | `25` | Below this percentage of free swap, stop admitting. |
| `governor_swap_recovery_free_percent` | `governorSwapRecoveryFreePercent` | `50` | Free-swap percentage required before re-admission. Always normalized above the swap SOFT percentage, up to 100. |
| `governor_psi_full_shed_avg10` | `governorPsiFullShedAvg10` | `1` | With low swap, PSI `full avg10` at or above this value upgrades the mode to shedding. |
| `governor_psi_calm_readmit_avg10` | `governorPsiCalmReadmitAvg10` | `0.05` | PSI `full avg10` must stay below this value for early re-admission at SOFT. |
| `governor_psi_calm_window_ms` | `governorPsiCalmWindowMs` | `600000` | Continuous calm-PSI time required for early re-admission. The window re-arms after each early re-admission. |
| `governor_footprint_default_work_gb` | `governorFootprintDefaultWorkGb` | `2` | Cold-start footprint estimate for a work agent. |
| `governor_footprint_default_review_gb` | `governorFootprintDefaultReviewGb` | `1` | Cold-start footprint estimate for a review agent. |
| `governor_footprint_default_test_gb` | `governorFootprintDefaultTestGb` | `1` | Cold-start footprint estimate for a test agent. |

The RAM reserve defaults are computed once at process startup from `os.totalmem()`
(`computeGovernorReserveDefaultsGb` in `src/lib/config-yaml/defaults.ts`) — they scale to the host,
not a fixed constant. Every value can be overridden explicitly in `config.yaml`; an unset value
always falls back to the documented default, never a silent inline literal.

The **memory-driven admission ceiling** (PAN-2504) is configured separately, under `[concurrency]`
in `~/.overdeck/cloister.toml` (the cloister config, not `config.yaml`):

| Key | Default | Meaning |
|---|---|---|
| `memory_driven` | `false` | Opt-in. When true, the work-agent ceiling is the live memory budget instead of `max_work_agents`. |
| `memory_driven_max_work_agents` | `24` | Hard safety cap on concurrent work agents when `memory_driven` is on. |
| `work_footprint_gb` | `2` | Per-work-agent RSS estimate used for the budget. Larger ⇒ fewer, more conservative admissions. |

The **preemptive scheduler** (PAN-2507) is also configured under `[concurrency]` in
`~/.overdeck/cloister.toml`:

| Key | Default | Meaning |
|---|---|---|
| `preemption` | `false` | Opt-in. When true, a blocked advancing (review/test/merge) dispatch may yield an idle work agent to free capacity. Unset ⇒ zero behavior change — every dispatch site defers until attrition as before. |
| `max_yielded` | `3` | Anti-thrash: the most work agents that may be in the yielded (scheduler-paused) state at once. |
| `yield_cooldown_secs` | `600` | Anti-thrash: an agent resumed from a yield may not be re-yielded until this many seconds elapse. |

## SystemHealthPill (PAN-3423)

The dashboard System Health Pill popover displays live resource metrics and governor state through a hierarchical interface. Its one-line summary always includes stalled and idle agent counts, memory utilization, spawn headroom, and context-note count; healthy state also names relay status. Degraded states surface a prioritized **attention section** that groups identical failure patterns across multiple agents into count-badged rows such as "4× agents: agent-A, agent-B +2 more".

**Sections:**

1. **Summary line** — a one-sentence answer to "do I need to act now?" Healthy, warning, and critical variants preserve the same operational context: stalled and idle counts, memory utilization, admission headroom, and context-note count.
2. **Chip row** — three status chips show admitted work agents, running containers, and webhook-relay health. The relay is green when running, red when configured but stopped or unavailable, and neutral gray when it is not configured.
3. **Vitals tiles** — a 2×2 grid displays CPU and load/core, total/used/available memory, Overdeck RSS, swap percentage, and virtual commitment. Each tile has a proportional meter bar with threshold colors (green <60%, amber 60–85%, red >85% for host percentages; Overdeck accent blue otherwise).
4. **Attention section** — visible severity-color-coded rows (red dot for critical, amber for warning) grouped by reason code. Identical codes across agents fold into one informational row with agent count and an abbreviated list (first two named, "+N more" if >2); grouped rows have no Open or Kill controls. Singleton agent rows show `<agentId> · <issueId>`, retain the humanized inactivity duration, and may expose Open and Kill actions. Only severity:info context notes are hidden initially inside the collapsed context-note disclosure.
5. **Top consumers** — a memory-ranked list of agents, specialists, and containers sorted by RSS, each with a kind badge and proportional memory bar. Leaked specialists carry an amber "LEAKED" tag, while the section header reports "⚠ N leaked" or "No leaks".

The popover header shows a visible labeled state pill with a red, amber, or green dot and an "Updated Ns ago" timestamp relative to the snapshot's `updatedAt`. A state transition into critical emits one toast notification with an action that opens the popover in leaked-first mode. A "Show all" button switches the top-consumer list from leaked-only to the full list.

**Data flow:** `buildAttentionItems()` in `system-health-attention.ts` groups reasons by code, excludes severity:info from active rows, and sorts critical-first and stalled-before-idle. `summaryLine()` combines issue and affected-agent counts with memory, headroom, relay, and context-note state. `contextNotes()` returns only info reasons for the collapsed disclosure. Each singleton attention target carries its canonical `issueId`; the component passes that value directly to `useDashboardStore().openIssue()` when the operator chooses `Open`.

## Related documents

- [`docs/AGENT-STATE-PLANES.md`](AGENT-STATE-PLANES.md) — the liveness oracle section notes that
  admission through the tmux plane is now memory-governed.
- The project `CLAUDE.md`'s "Agent Auto-Resume Gates" section lists the memory gate alongside the
  existing boot no-resume, manual pause, and troubled gates.
