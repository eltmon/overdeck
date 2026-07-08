# Resource Governor

The resource governor is Cloister's admission and recovery policy for agent
processes. It keeps autonomous resume and dispatch paths from admitting more
work when the host is already short on memory, and it reclaims low-value
resources before the kernel is forced to choose a victim.

## One Door

Before PAN-2500, Overdeck had two separate gates:

- the HTTP spawn guardrail, used when an operator starts work through the
  dashboard or API;
- the deacon auto-resume and dispatch paths, used when Cloister restarts,
  recovers stopped work agents, or advances review/test/merge roles.

Those paths now share one memory-pressure predicate. Operator-facing spawn
requests still report the existing warning and block states, but autonomous
deacon work uses the same pressure signal plus the governor's reserve and
footprint checks before admitting a process.

Count and load limits still apply. Memory is an additional admission door, not
a replacement for the work-agent count governor or the load-average guard.

## Bands

The deacon memory governor has three bands:

```text
MemAvailable >= RECOVERY        -> OK, admit new work
SOFT <= MemAvailable < RECOVERY -> hold if already holding/shedding
HARD <= MemAvailable < SOFT     -> SOFT pressure, admit nothing new
MemAvailable < HARD             -> HARD pressure, shed resources
```

The important invariant is `RECOVERY > SOFT`. Once the governor leaves OK, it
does not re-admit merely because memory rises above SOFT. It waits until
MemAvailable reaches RECOVERY. That hysteresis prevents rapid admit/hold
oscillation around the SOFT threshold.

The HTTP spawn guardrail still uses the legacy `memory_warn_gb` and
`memory_block_gb` thresholds. The deacon governor uses the dedicated
`governor_*_reserve_gb` thresholds.

## Footprint

Admission is budgeted in GiB, not only by agent count. Before admitting a
candidate, Cloister estimates the memory footprint for the candidate's role and
project:

```text
estimated footprint =
  agent process RSS
+ launcher/supervisor overhead
+ project docker-stack RSS
+ expected tool/build spike reserve
```

The current implementation derives the learned portion from live docker stack
RSS: it averages `memoryBytes` across currently running stacks for the same
project. If no live stack exists for that project, it falls back to the
configured cold-start default for the role.

A candidate is admitted only when:

```text
estimated footprint <= MemAvailable - SOFT reserve
```

Boot reconciliation uses the same check between candidates. After a successful
resume it waits a short settle window, re-reads memory, re-estimates the next
candidate's footprint, and defers the remaining candidates if the next one no
longer fits.

## Eviction Ladder

Under HARD pressure, Cloister sheds in this order:

1. Stop merged or closed docker stacks whose issue has no live agent session.
2. Re-check memory pressure.
3. Pause one idle work agent that was started by the flywheel and is not
   operator-attached.
4. Re-check memory pressure and repeat step 3 while pressure remains HARD.

The governor does not use `docker pause` for memory recovery because paused
containers retain RSS. It stops reclaimable containers instead. Operator-started
work agents are exempt from automatic pause by default.

The tmux server itself is a safety-net exception: Overdeck starts the managed
`tmux-server` systemd user unit with `ManagedOOMPreference=avoid`. If the
governor misses, systemd-oomd should avoid killing the shared tmux server before
less central agent processes.

## Configuration

Resource governor settings live under `resources` in config YAML.

| Key | Default | Meaning |
| --- | --- | --- |
| `memory_warn_gb` | `4` | HTTP spawn warning threshold. This is not the deacon governor SOFT reserve. |
| `memory_block_gb` | `2` | HTTP spawn blocking threshold. This is not the deacon governor HARD reserve. |
| `agent_warn_count` | `8` | Work-agent count warning threshold for operator-facing spawn guardrails. |
| `agent_block_count` | `10` | Work-agent count blocking threshold for operator-facing spawn guardrails. |
| `governor_soft_reserve_gb` | `max(15% total RAM, 8 GiB)` | Deacon SOFT reserve. Below this, autonomous admission holds. |
| `governor_hard_reserve_gb` | `max(8% total RAM, 4 GiB)` | Deacon HARD reserve. Below this, the eviction ladder runs. |
| `governor_recovery_reserve_gb` | `max(25% total RAM, 12 GiB)` | Deacon RECOVERY reserve. Must exceed SOFT; config normalization raises it to `SOFT + 1` if needed. |
| `governor_footprint_default_work_gb` | `2` | Cold-start footprint for a work agent when no live project stack exists. |
| `governor_footprint_default_review_gb` | `1` | Cold-start footprint for a review agent. |
| `governor_footprint_default_test_gb` | `1` | Cold-start footprint for a test agent. |

