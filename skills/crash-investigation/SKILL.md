---
name: crash-investigation
description: >
  Investigate system crashes, OOM kills, and unresponsive episodes. Analyzes
  previous boot logs, identifies memory hogs, tallies per-process-group consumption,
  checks agent and workspace state, and produces a recovery summary. Use after a
  hard reset, freeze, or reboot caused by resource exhaustion.
triggers:
  - crash investigation
  - investigate crash
  - why did my system crash
  - OOM investigation
  - system froze
  - out of memory
  - system was unresponsive
  - what happened to my system
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
---

# Crash Investigation

Post-crash forensic analysis for developer workstations running AI agents, containers, and k8s workloads.

## When to Use

- System was unresponsive and required a hard reset
- OOM killer was active (processes were killed unexpectedly)
- CPU was pegged at 100% for an extended period
- System rebooted unexpectedly
- Agents were running overnight and the machine froze

## Investigation Workflow

Work through each phase in order. Collect all evidence before drawing conclusions.

---

### Phase 1: Establish Timeline

Determine when the crash happened and how long the previous session ran.

```bash
# List recent boots — the previous boot (-1) is the crashed session
journalctl --list-boots | tail -5

# Check reboot history
last -x reboot shutdown | head -10
```

Record:
- **Previous boot start**: when the session began
- **Previous boot end**: when the crash/reset occurred
- **Duration**: how long it ran before crashing

---

### Phase 2: Check for OOM Kills

OOM (Out of Memory) kills are the most common cause of system freezes on dev machines.

```bash
# All OOM events from the crashed boot
journalctl -b -1 --no-pager | grep -E "oom-kill|Out of memory|Killed process" | head -30

# Memory pressure and related failures
journalctl -b -1 --since "<LAST_FEW_HOURS>" --no-pager | \
  grep -iE "oom|out.of.memory|killed process|enomem|cannot allocate|memory pressure" | tail -50
```

If OOM kills are found, note:
- **First OOM kill timestamp** — this is when trouble started
- **Which processes were killed** and in what order
- **Whether the right processes were killed** (OOM killer picks by `oom_score_adj`, not by actual memory usage)

---

### Phase 3: Identify Memory Hogs

When the OOM killer fires, the kernel dumps a full process table. This is the most valuable evidence.

```bash
# Find the process table dump from the first OOM event
# Look for lines with [pid] format — these are the process listings
journalctl -b -1 --since "<FIRST_OOM_TIME>" --until "<FIRST_OOM_TIME + 1min>" --no-pager | \
  grep "kernel:" | grep -P "\[\s*\d+\]" | head -80
```

#### Tally Memory by Process Group

For each major process type, sum the RSS (resident memory) column. The OOM dump format is:

```
[  pid  ]   uid  tgid total_vm      rss rss_anon rss_file rss_shmem pgtables_bytes swapents oom_score_adj name
```

RSS is field `$11` when parsed with awk from the full journalctl line. Values are in **pages** (4 KB each).

```bash
# Tally for a specific process name (replace PROCNAME)
journalctl -b -1 --since "<OOM_TIME>" --until "<OOM_TIME + 1min>" --no-pager | \
  grep "kernel:" | grep -P "\bPROCNAME\b" | \
  awk '{rss=$11; total+=rss} END {printf "%s: %d processes, RSS: %.1f GB\n", "PROCNAME", NR, total*4/1024/1024}'
```

Common process groups to check:
- `claude` — Claude Code CLI processes
- `node` — Node.js (includes vitest workers, MCP servers, dev servers)
- `vitest` — Test runner workers (often named "node (vitest N)")
- `java` — JVMs (Spring Boot, Minecraft, Solr, k3s pods)
- `python` — Python services
- `beam.smp` — Erlang/RabbitMQ
- `grafana`, `prometheus` — Monitoring stack
- `postgres` — Database

Compare the total against system RAM:
```bash
# System RAM
free -h

# CPU count (vitest/jest default to this many workers)
nproc
```

---

### Phase 4: Analyze the Death Spiral

Check the final minutes/hours of the crashed boot for cascading failures.

```bash
# Last 100 log entries before the crash
journalctl -b -1 --since "<LAST_10_MINUTES>" --no-pager | tail -100
```

Look for these indicators:
- **"Under memory pressure, flushing caches"** — system is thrashing
- **"SYN_DROPPED event"** on input devices — kernel dropping mouse/keyboard events (explains unresponsiveness)
- **"Can't keep up!"** from game servers or other real-time processes
- **"Watchdog timeout"** on systemd services — services frozen
- **Services crash-looping** (e.g., fwupd, journald restarting repeatedly)
- **DNS timeouts** — networking breaking down under load

---

### Phase 5: Check Agent and Workspace State

After understanding what caused the crash, assess what work was in progress.

#### Agent States
```bash
# List all agents and their last state
for agent_dir in ~/.panopticon/agents/*/; do
  agent=$(basename "$agent_dir")
  state=$(cat "$agent_dir/state.json" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'{d.get(\"state\",\"unknown\")} @ {d.get(\"lastActivity\",\"?\")}')" 2>/dev/null || echo "no state")
  echo "$agent: $state"
done
```

#### Workspace Git Status
```bash
# For each workspace, check for uncommitted work and branch status
for ws in /path/to/project/workspaces/*/; do
  echo "=== $(basename $ws) ==="
  for repo in "$ws"*/; do
    if [ -d "$repo/.git" ]; then
      echo "  $(basename $repo):"
      echo "    Branch: $(git -C "$repo" branch --show-current 2>/dev/null)"
      echo "    Uncommitted: $(git -C "$repo" status --short 2>/dev/null | wc -l) files"
      echo "    Ahead of main: $(git -C "$repo" log --oneline origin/main..HEAD 2>/dev/null | wc -l) commits"
    fi
  done
done
```

#### Planning State
```bash
# Check .pan/continue.json for each workspace
for ws in /path/to/project/workspaces/*/; do
  continue_file="$ws/.pan/continue.json"
  if [ -f "$continue_file" ]; then
    echo "=== $(basename $ws) ==="
    head -20 "$continue_file"
    echo
  fi
done
```

---

### Phase 6: Check Current System Health

Verify the system is stable after reboot before resuming work.

```bash
# Current memory usage
free -h

# Top memory consumers right now
ps aux --sort=-%mem | head -15

# Any leftover problematic processes
ps aux | grep -c '[c]laude'
ps aux | grep -c '[v]itest'
ps aux | grep -c '[n]ode'

# Disk space (OOM can also be triggered by full /tmp or swap partition)
df -h / /tmp /home
```

---

### Phase 7: Produce Recovery Summary

Compile findings into a structured summary. This format is designed to be handed to another AI agent to resume work.

```markdown
## Crash Summary

**Crash time**: [timestamp]
**Cause**: [OOM / CPU exhaustion / disk full / other]
**Duration of instability**: [how long before reset]

### Root Cause
[1-2 sentences: what process(es) consumed what resource]

### Memory Breakdown at Time of Crash
| Process Group | Count | RSS | Notes |
|---|---|---|---|
| ... | ... | ... | ... |

### OOM Kill Sequence
1. [timestamp] - [process] killed ([size])
2. ...

### Agent States
| Agent | State | Last Activity | What it was doing |
|---|---|---|---|
| ... | ... | ... | ... |

### Workspace Status
| Workspace | Status | Uncommitted Changes | Commits Ahead | Notes |
|---|---|---|---|---|
| ... | ... | ... | ... | ... |

### What Was In-Flight
- [list of tasks that were actively being worked on]

### What Needs to Happen Now
1. [ordered recovery steps]
```

---

## Common Root Causes

### Vitest/Jest Worker Explosion
**Symptom**: Many `node (vitest N)` processes each using 1-3 GB.
**Cause**: No `maxForks`/`maxThreads` configured; defaults to CPU count.
**Fix**: Add to `vitest.config.ts`:
```typescript
pool: 'forks',
poolOptions: {
  forks: { maxForks: 4 },
},
```

### Multiple Claude Code Agents
**Symptom**: 10+ `claude` processes, each 200-800 MB RSS plus swap.
**Cause**: Panopticon agents + specialist agents + sub-agents all running simultaneously.
**Fix**: Limit concurrent agents in Panopticon config; ensure agents exit cleanly.

### K8s Pod Memory Limits Not Set
**Symptom**: Java/Go processes in k8s pods growing unbounded.
**Cause**: No resource limits in pod specs; pods consume all available memory.
**Fix**: Set `resources.limits.memory` in pod specs.

### Swap Thrashing
**Symptom**: System responsive but extremely slow; disk I/O at 100%.
**Cause**: Total memory demand exceeds RAM but not RAM+swap, causing constant page faults.
**Fix**: Either add RAM, reduce workload, or set `vm.swappiness=10` to prefer OOM-killing over thrashing.

---

## Prevention

1. **Limit test parallelism** — Always set `maxForks`/`maxThreads` in vitest/jest configs
2. **Set agent concurrency limits** — Don't run more than 3-4 agents simultaneously on 64 GB
3. **Configure k8s resource limits** — Every pod should have memory limits
4. **Monitor proactively** — Use `watch -n 5 free -h` or a Grafana dashboard
5. **Set up earlyoom** — `sudo apt install earlyoom` kills the largest process before the system freezes

## Related Skills

- `/pan:rescue` — Recover uncommitted work from crashed agents
- `/pan:session-health` — Clean up stuck Claude Code sessions
- `/incident-response` — Structured approach to production incidents
- `/pan:status` — Check current agent and system status
