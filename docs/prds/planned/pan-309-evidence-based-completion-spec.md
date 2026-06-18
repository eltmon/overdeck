# PAN-309: Evidence-Based Completion Detection & Lifecycle Badges

## Problem Statement

When a work agent finishes implementation but doesn't call `pan done`, the system has no reliable fallback. The current `work-agent-stop-hook` asks Haiku to classify 80 lines of terminal output, which is inherently unreliable.

**Incident**: MIN-758 completed a full rebrand across the entire stack (backend, frontend, skills, plugin). STATE.md said COMPLETE. Branch was pushed with commits. The stop-hook classified it as UNCLEAR 3 times. Linear stayed at "In Planning". The review pipeline never triggered. The work sat idle until a human noticed.

### Root Cause

The system relies on agents to self-report completion via `pan done`, with no evidence-based fallback when they don't.

### Additional Gaps

1. **Deacon only monitors specialists** (review/test/merge), not work agents
2. **No lifecycle badge on Kanban cards** — health (green/orange/red) shows activity time, but not whether an agent is blocked, done, or stuck
3. **UNCLEAR is a dead end** — no escalation, no badge, no retry
4. **INPUT badge only triggers on AskUserQuestion**, not on stop-hook's STOPPED_FOR_INPUT classification

## Solution

### Phase 1: Evidence-Based Completion Detection (stop-hook)

**File**: `scripts/work-agent-stop-hook`

Before calling the LLM, check hard evidence:

1. **STATE.md check**: Read `$WORKSPACE/.planning/STATE.md`. If it contains "COMPLETE", "DONE", "FINISHED", or similar markers → strong completion signal.
2. **Git check**: Does the feature branch have commits pushed to remote? (`git log origin/$branch..HEAD` is empty = all pushed)
3. **Beads check**: If `.planning/beads/` exists, are all beads closed? (`bd list --status open` returns empty)
4. **Idle check**: Is the agent at an idle prompt? (already checked by existing heuristic)

**Decision matrix**:

| STATE.md says complete | Branch pushed | Beads closed | Classification |
|---|---|---|---|
| Yes | Yes | Yes (or N/A) | `FORGOT_COMPLETION` — auto-nudge |
| Yes | No | — | `STILL_WORKING` — may still be pushing |
| No | Yes | Yes | Fall through to LLM |
| No | No | — | Fall through to LLM |

When classified as `FORGOT_COMPLETION`:
- Send nudge: "Your STATE.md indicates work is complete. Please run `pan done <ISSUE>`"
- Write `resolution: done` to `runtime.json`

When LLM returns `UNCLEAR` and this is the 2nd+ time:
- Write `resolution: stuck` to `runtime.json`

When LLM returns `STOPPED_FOR_INPUT`:
- Write `resolution: needs_input` to `runtime.json`

### Phase 2: Lifecycle Resolution Field

**Files**: Agent `runtime.json` schema, stop-hook

Add `resolution` field to `~/.overdeck/agents/<id>/runtime.json`:

```json
{
  "state": "idle",
  "lastActivity": "2026-03-14T01:00:00Z",
  "resolution": "stuck",
  "resolutionCount": 3,
  "resolutionUpdatedAt": "2026-03-14T01:41:39Z"
}
```

**Resolution values**:

| Resolution | Meaning | Written by |
|---|---|---|
| `working` | Normal operation (default) | Agent start |
| `done` | Evidence says complete, nudging agent | Stop-hook (evidence check) |
| `needs_input` | Agent hit a blocker, needs human | Stop-hook (LLM or evidence) |
| `stuck` | UNCLEAR 2+ times, no progress evidence | Stop-hook (escalation) |
| `completed` | Agent called `pan done` | CLI done command |

`resolutionCount` tracks how many times the same resolution was set (for escalation logic).

### Phase 3: Kanban Lifecycle Badges

**File**: `src/dashboard/frontend/src/components/KanbanBoard.tsx`

Add lifecycle badge next to existing health dot and INPUT badge:

| Resolution | Badge Text | Color | Icon |
|---|---|---|---|
| `done` | DONE | green | CheckCircle |
| `needs_input` | BLOCKED | amber | AlertCircle |
| `stuck` | STUCK | red | XCircle |
| `working` | (no badge) | — | — |
| `completed` | (hidden — agent filtered from view) | — | — |

The badge reads from `runtime.json` via the existing `/api/agents` endpoint, which already returns agent state. Add `resolution` to the response.

**Replace current INPUT badge logic**: Currently `hasPendingQuestion` (AskUserQuestion only). Merge with lifecycle resolution — if `resolution === 'needs_input'` OR `hasPendingQuestion`, show BLOCKED badge (the amber one). This unifies the two signals.

### Phase 4: Deacon Expansion — Work Agent Patrol

**File**: `src/lib/cloister/deacon.ts`

Extend Deacon's patrol loop (currently 60s for specialists) to also check work agents:

```
For each running work agent:
  1. Read runtime.json → check resolution
  2. If resolution === 'done' and resolutionCount >= 2:
     → Auto-complete: run `pan done <ISSUE>` programmatically
     → Log: "Deacon auto-completed <ISSUE> after 2 failed nudges"
  3. If resolution === 'stuck' and resolutionCount >= 3:
     → Auto-poke: send message to agent via tmux
     → Log: "Deacon poked stuck agent <ISSUE>"
  4. Surface counts in CloisterStatusBar socket events
```

**CloisterStatusBar** already has UI for stuck counts — just wire work agent stuck counts into the existing `status.summary.stuck` field.

### Phase 5: Dashboard API Changes

**File**: `src/dashboard/server/index.ts` (or wherever `/api/agents` is)

The `/api/agents` response already includes agent state. Add:

```typescript
{
  // existing fields...
  resolution: 'working' | 'done' | 'needs_input' | 'stuck' | 'completed',
  resolutionCount: number,
}
```

Read from `runtime.json` in the agent directory.

## Files to Change

| File | Change |
|---|---|
| `scripts/work-agent-stop-hook` | Evidence checks before LLM, write resolution to runtime.json |
| `src/lib/cloister/deacon.ts` | Patrol work agents, auto-complete escalation |
| `src/dashboard/frontend/src/components/KanbanBoard.tsx` | Lifecycle badges (DONE/BLOCKED/STUCK) |
| `src/dashboard/frontend/src/types.ts` | Add resolution to agent type |
| `src/dashboard/server/index.ts` | Include resolution in /api/agents response |
| `src/dashboard/frontend/src/components/CloisterStatusBar.tsx` | Wire work agent stuck counts |

## What This Would Have Done for MIN-758

1. Agent finishes, goes idle
2. Stop-hook fires, checks STATE.md → says COMPLETE, branch pushed → `FORGOT_COMPLETION`
3. Writes `resolution: done` to runtime.json
4. Kanban shows green DONE badge
5. Auto-nudge: "run `pan done MIN-758`"
6. If nudge fails, Deacon sees `resolution: done` + `resolutionCount: 2` on next patrol
7. Deacon auto-runs `pan done MIN-758`
8. Linear moves to "In Review", review-agent picks it up
9. Total delay: ~2 minutes instead of infinite

## Non-Goals

- No changes to the specialist pipeline itself (review/test/merge already work)
- No changes to `pan done` command (it already handles Linear + completion markers)
- No auto-restart of stuck agents (just poke + badge — human decides whether to restart)
- No changes to health thresholds (time-based health and lifecycle resolution are orthogonal)
