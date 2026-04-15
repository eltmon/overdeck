# Deacon Health Monitoring & Stuck Detection

The Deacon is Panopticon's health monitor, running as part of the dashboard server. It patrols every 60 seconds, checking agent and specialist health, detecting stuck states, and taking recovery actions.

## Detection Summary

| Detection | What it catches | Threshold | Action | Max attempts |
|-----------|----------------|-----------|--------|-------------|
| **Extended Thinking** | Agent stuck in Claude's thinking loop | 10 min | Esc → Ctrl+C → Kill+Respawn | 3 then kill |
| **Dead-End Agent** | Review blocked or tests failed, agent idle | 5 min idle | Nudge with feedback + requeue | 7 requeues |
| **First-Completion** | Agent idle with commits but never called `pan done` | 10 min idle | Nudge to call done | Every 15 min |
| **Resolution Patrol** | Agent evidence shows done/stuck (from enrichment) | 2+ nudges (done) or 3+ (stuck) | Auto-complete or poke | Per resolution |
| **Orphaned Agents** | status=running but no tmux session | Immediate | Reset to stopped | N/A |
| **Dead Planning Sessions** | Planning tmux with remain-on-exit, process dead | Immediate | Kill session + reset | N/A |
| **Specialist Timeout** | Specialist active >15 min without completing | 15 min | Force-kill | N/A |
| **Merge-Ready Reminder** | Issue readyForMerge for >1 hour, human hasn't clicked MERGE | 1 hour | Dashboard notification | 3 reminders |
| **Deleted Workspaces** | readyForMerge=true but workspace directory gone | Immediate | Clear readyForMerge | N/A |
| **Pending Post-Merge** | pending-post-merge.json not consumed on startup | Immediate | Process lifecycle in-process | N/A |

## Detection Details

### Extended Thinking (`checkStuckWorkAgents`)
- **File:** `src/lib/cloister/deacon.ts:946-1051`
- **How:** Parses tmux output for `Thinking… (Xm Ys)` pattern
- **Escalation:**
  1. Send Escape key to cancel thinking
  2. Send Ctrl+C to interrupt
  3. Kill tmux session and respawn via `launcher.sh`
- **Cooldown:** 5 minutes between recovery attempts

### Dead-End Agent (`checkDeadEndAgents`)
- **File:** `src/lib/cloister/deacon.ts:1652-1744`
- **Criteria:** Review status is `blocked` or test status is `failed`, AND agent has been idle for 5+ minutes
- **Action:** Send nudge message with feedback file path and resubmit instructions
- **Cooldown:** 10 minutes per issue
- **Circuit breaker:** 7 auto-requeues maximum

### First-Completion Gap (`checkFirstCompletionAgents`)
- **File:** `src/lib/cloister/deacon.ts:1762-1902`
- **Criteria:** Agent idle 10+ min, has git commits on feature branch, but no completion marker
- **Hard gates:** Must NOT have review-status entry, must NOT have feedback files
- **Action:** Nudge: "run `pan done <issue>`"
- **Cooldown:** 15 minutes

### Resolution-Based Patrol (`patrolWorkAgentResolutions`)
- **File:** `src/lib/cloister/deacon.ts:1911-1978`
- **Source:** `resolution` field in `runtime.json`, computed by the Agent Enrichment Service
- **States:**
  - `done` with count ≥ 2 → auto-complete via `pan done`
  - `stuck` with count ≥ 3 → send poke message
  - `working`, `completed`, `needs_input`, `unclear` → skip

### Orphaned Agents (`recoverOrphanedAgents`)
- **File:** `src/lib/cloister/deacon.ts:2362-2395`
- **Runs:** Every patrol cycle + on startup
- **Criteria:** `state.json` says running/starting, but tmux session doesn't exist
- **Special handling:** Planning sessions check `pane_dead` flag (remain-on-exit)
- **Action:** Reset to stopped, emit `agent.stopped` domain event
- **Lifecycle invariant:** When an agent later resumes or recovers, the running transition must clear any prior `stoppedAt` tombstone in `state.json`. A state file that says both `status: "running"` and `stoppedAt: ...` is invalid and will confuse health/read-model consumers.

### Merge-Ready Reminder (`checkReadyForMergeStuck`)
- **File:** `src/lib/cloister/deacon.ts:1558-1631`
- **NOT a stuck detection** — just a courtesy reminder that a merge is waiting for human action
- **Threshold:** 1 hour before first reminder
- **Cooldown:** 1 hour between reminders
- **Maximum:** 3 reminders per issue per server lifetime
- **Action:** Notify dashboard (no auto-merge — humans click MERGE per PAN-354)

## Health Status Levels

Computed from `lastActivity` timestamp:

| Level | Threshold | Meaning |
|-------|-----------|---------|
| `healthy` | < 15 min | Agent actively working |
| `warning` | 15-30 min | Agent may be idle or slow |
| `stuck` | > 30 min | Agent hasn't done anything — needs attention |
| `dead` | No tmux session | Crashed or cleaned up |

**Source:** `src/dashboard/lib/health-filtering.ts:41-124`

## Agent Enrichment Service

Computes enrichment fields every ~3 seconds by analyzing the agent's JSONL session:
- `agentPhase` — planning, implementation, testing, exploration
- `hasPendingQuestion` — agent is waiting for user input
- `pendingQuestionCount`
- `resolution` — working, done, needs_input, stuck, completed, unclear
- `resolutionCount` — how many times this resolution has been seen

**Source:** `src/dashboard/server/services/agent-enrichment-service.ts`

## TMux Session Health

The deacon checks tmux sessions via:
- `tmux has-session -t <name>` — does the session exist?
- `isAgentActiveInTmux()` — parse last 5 lines of tmux output for activity patterns
- `checkHeartbeat()` — read heartbeat file, check staleness (30s threshold)

**Known gap:** If Claude Code crashes but tmux has `remain-on-exit on`, the session persists. The deacon sees it as "alive" but the process is dead. The planning session fix checks `pane_dead` flag, but work agents don't have this check yet.

## Configuration

Health thresholds are configurable in `~/.panopticon/config.yaml`:

```yaml
cloister:
  health:
    stale: 5        # minutes — agent considered stale
    warning: 15     # minutes — warning level
    stuck: 30       # minutes — stuck, needs attention
  patrol:
    interval: 60    # seconds between patrol cycles
```
