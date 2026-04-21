# Deacon Health Monitoring & Stuck Detection

The Deacon is Panopticon's health monitor, running as part of the dashboard server. It patrols every 60 seconds, checking agent and specialist health, detecting stuck states, and taking recovery actions.

## Detection Summary

| Detection | What it catches | Threshold | Action | Max attempts |
|-----------|----------------|-----------|--------|-------------|
| **Extended Thinking** | Agent stuck in Claude's thinking loop | 10 min | Esc → Ctrl+C → Kill+Respawn | 3 then kill |
| **Dead-End Agent** | Review blocked or tests failed, agent idle | 5 min idle | Nudge with feedback + requeue | 7 requeues |
| **First-Completion** | Agent idle with commits but never called `pan done` | 10 min idle | Nudge to call done | Every 15 min |
| **Resolution Patrol** | Agent evidence shows done/stuck (from enrichment) | 2+ nudges (done) or 3+ (stuck) | Auto-complete or poke | Per resolution |
| **Parallel Review Re-dispatch** | Review got stuck in `reviewing`/`testing` after dispatch | `recoveryStartedAt` cutoff | Re-dispatch parallel-review specialists | 3 before breaker trips (PAN-794) |
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
- **Lifecycle invariant:** When an agent later resumes or recovers, the running transition must clear any prior `stoppedAt` tombstone in `state.json`. `saveAgentState()` now enforces that invariant for all running/starting writes, so a state file that says both `status: "running"` and `stoppedAt: ...` is invalid and should be treated as a bug.

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

## Parallel Review Recovery & Circuit Breaker (PAN-794)

When parallel-review dispatch leaves an issue in `reviewing`/`testing` without a
specialist following through, Deacon re-dispatches the review/test pair. Left
unbounded this became an infinite loop when the dispatcher's `.catch` reset the
status to `pending`, so PAN-794 added a scoped cycle with a hard cap.

### How it works

- **Recovery cycle boundary — `recoveryStartedAt`.** When Deacon first detects a
  stuck parallel review, it stamps `recoveryStartedAt` with an ISO timestamp.
  Breaker counts and history lookups are scoped to entries *after* this cutoff —
  earlier passes don't count against the current budget.
- **Retry counter — `reviewRetryCount`.** Every re-dispatch increments this
  counter. When `reviewRetryCount >= REVIEW_INFRA_BREAKER_THRESHOLD` (3), the
  breaker trips.
- **Breaker-trip action.** On trip, Deacon calls
  `markWorkspaceStuck(issueId, 'review_infrastructure_failure', { retryCount })`.
  This is a **review-infra** stuck reason — distinct from `main_diverged` — and
  the unstick route explicitly skips the git safe-state check for it
  (`workspaces.ts:3148`).
- **Terminal failure on dispatch reject.** `review-agent.ts` `dispatchParallelReview`'s
  `.catch` now writes `reviewStatus: 'failed'` (was `'pending'` — the source of
  PAN-569's loop). The breaker is belt-and-suspenders against future regressions.
- **Counter reset.** `checkPostReviewCommits` and the approve flow clear
  `reviewRetryCount: 0, recoveryStartedAt: undefined` on clean terminal. Unstick
  also resets them so a manual retry opens a fresh budget.

### UI surface

- `isReviewInfraStuck()` in `pipeline-state.ts` reports the breaker-tripped state.
- `ReviewInfraStuckBadge` (KanbanBoard) — amber badge + "Retry" button that POSTs
  to `/api/workspaces/:issueId/unstick`. Copy and flow are distinct from
  `DivergedBadge` (which covers `main_diverged`).

### Relevant code

- `src/lib/cloister/deacon.ts` — patrol, breaker trip, stuck guard
- `src/lib/cloister/review-agent.ts` — `.then`/`.catch` contract
- `src/lib/database/review-status-db.ts` — `review_retry_count`, `recovery_started_at`
- `src/lib/database/schema.ts` — migration v24 → v25
- `packages/contracts/src/types.ts` — `ReviewStatusSnapshot` fields

## Operator Freeze: Global Deacon Pause

**What:** A dashboard-wide "Freeze Deacon" toggle that short-circuits **every**
patrol cycle. Distinct from the per-issue `deaconIgnored` flag — freeze is all
or nothing, a "stop the world" switch for maintenance, testing, or cutover.

**Where to find it:**
- Icon in the sidebar footer (expanded: "Freeze Deacon" button; collapsed: Snowflake icon in the bottom-left toolbar column).
- A top-of-app banner appears whenever the flag is set, with a one-click "Resume Deacon" action.

**How it works:**
- Persisted in the `app_settings` SQLite table (`key = 'deacon.globally_paused'`). Survives dashboard restarts.
- Schema v26 → v27 migration seeds the flag to `true` on first install so the dashboard comes up with Deacon frozen during the PAN-794 cutover window.
- `runPatrol()` checks `isDeaconGloballyPaused()` at the top of every cycle and returns immediately with `actionsToken: ['skipped: globally_paused']` when set. No per-issue work runs, no tmux sessions are poked, no specialists are re-dispatched.
- Toggle endpoints: `GET /api/deacon/pause`, `POST /api/deacon/pause` body `{ paused: boolean }`. Frontend uses react-query with a 30-second refetch interval plus refetch on window focus.

**Default behavior after cutover:** flip the seed default to `false` in `schema.ts` (migration v27 is idempotent — existing installs keep whatever the operator last set). For now the default is `true` to gate PAN-794 rollout.

**Relevant code:**
- Data: `src/lib/database/app-settings.ts` (`DEACON_GLOBAL_PAUSE_KEY`, `isDeaconGloballyPaused`, `setDeaconGloballyPaused`)
- Schema: `src/lib/database/schema.ts` (v27 migration creates `app_settings` and seeds the flag)
- Patrol guard: `src/lib/cloister/deacon.ts` top of `runPatrol()`
- Routes: `src/dashboard/server/routes/misc.ts` (`getDeaconPauseRoute`, `postDeaconPauseRoute`)
- Frontend: `src/dashboard/frontend/src/components/DeaconPauseToggle.tsx`, mounted in `Sidebar.tsx` and `App.tsx` (banner)

## Operator Pause: Per-Issue Deacon Ignore

**What:** A per-issue "Pause Deacon" toggle on every kanban card. When set,
Deacon patrol skips that issue on every cycle until the operator resumes it.

**Why it exists:** `stuck` is a system-set failure marker — it's the wrong tool
when the operator is doing something intentional (manual investigation, waiting
on an external dependency, parking an issue while preparing a batch change) and
doesn't want re-dispatch / pokes / auto-completion firing under their feet.
`deaconIgnored` is the explicit human opt-out — orthogonal to `stuck`, can be
set while also stuck or healthy.

### Data model

`ReviewStatus` (and the `review_status` SQLite table via migration v25 → v26):

- `deaconIgnored: boolean`
- `deaconIgnoredAt: string` (ISO timestamp)
- `deaconIgnoredReason?: string` (optional free-form)

`ReviewStatusSnapshot` mirrors the three fields for the dashboard contract.

### Where the skip fires

Every patrol path that already respected `status.stuck` now also short-circuits
on `status.deaconIgnored`:

- `checkStuckWorkAgents` — skip extended-thinking recovery
- Orphaned review re-dispatch loop in `patrolOrphanedReviews` — `if (status.deaconIgnored) continue;`
- `patrolWorkAgentResolutions` — skip auto-complete / poke

### API

`POST /api/workspaces/:issueId/deacon-ignore`
Body: `{ "ignored": boolean, "reason"?: string }`
Response: `{ success, issueId, deaconIgnored, deaconIgnoredAt, deaconIgnoredReason }`

Idempotent. Setting `ignored: true` on an already-paused issue refreshes the
timestamp and optionally the reason; setting `ignored: false` clears all three.

### UI

`DeaconIgnoreButton` (KanbanBoard) renders on every IssueCard:

- **Inactive state:** muted "Pause Deacon" button with the Pause icon.
- **Active state:** purple "Deacon Paused" pill with an inline "Resume" link.
  Tooltip surfaces `deaconIgnoredReason` when set.

Frontend updates the Zustand `reviewStatusByIssueId` optimistically; the domain
event from `notifyPipeline({ type: 'status_changed' })` reconciles on WebSocket.

### Bulk apply

`scripts/deacon-ignore-bulk.ts` — pauses every issue matching a prefix + state
filter via the dashboard API (no direct DB access, same write path as the
button). Example:

```bash
tsx scripts/deacon-ignore-bulk.ts --prefix MIN --states "in progress,in review"
tsx scripts/deacon-ignore-bulk.ts --prefix MIN --states "in progress,in review" --unignore
```

### Relevant code

- Data: `src/lib/review-status.ts`, `src/lib/database/review-status-db.ts`
- Schema: `src/lib/database/schema.ts` (v26 migration)
- Deacon guards: `src/lib/cloister/deacon.ts`
- Route: `src/dashboard/server/routes/workspaces.ts` (`postWorkspaceDeaconIgnoreRoute`)
- Contract: `packages/contracts/src/types.ts`
- Frontend: `src/dashboard/frontend/src/components/KanbanBoard.tsx`, `src/dashboard/frontend/src/lib/pipeline-state.ts` (`isDeaconIgnored`)
- Bulk tool: `scripts/deacon-ignore-bulk.ts`
