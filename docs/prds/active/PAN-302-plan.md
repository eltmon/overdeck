# PAN-302: Close dialog after confirming, show INPUT when ready; optional watch checkbox

## Summary

After the user submits the planning dialog, close it immediately (default) instead of showing the terminal. The planning agent continues in the background. When it needs INPUT, surface it via the existing badge on the kanban card plus a toast notification. Add a "Stay and watch planning" checkbox to preserve the current behavior for power users. Also show planning status (badge + pulse) on the kanban card.

## Decisions

1. **Dialog closes immediately after confirm (default)** — After `startPlanningMutation` succeeds, close the dialog instead of transitioning to the `planning` step. Background execution continues as normal.

2. **"Stay and watch planning" checkbox** — Add to the `ready` step form, unchecked by default. Stored in localStorage. When checked, current behavior is preserved (dialog transitions to `planning` step with live terminal).

3. **Planning badge + pulse on kanban card** — Show a purple "Planning" badge with pulsing dots on the issue card when a planning agent is active. Distinct from the blue work agent indicators.

4. **Add `agentPhase` field to API response** — Backend adds `agentPhase: 'planning' | 'work'` to the agent object returned by `/api/agents`. Frontend uses this to distinguish planning agents from work agents (no ID-prefix parsing).

5. **INPUT notification** — When a planning agent has `hasPendingQuestion: true`, show:
   - The existing amber "Input" badge on the kanban card (already works — planning agents are in the agent list)
   - A toast notification (auto-dismiss after 10s) when the badge first appears
   - Clicking the badge opens the PlanDialog for that issue

6. **Toast system** — Use/extend existing toast infrastructure (if any) or add a minimal one. Auto-dismiss after 10s. Shows "Planning agent needs input for PAN-XXX".

## Architecture

### Backend Changes

**File: `src/dashboard/server/index.ts`**
- In `/api/agents` endpoint (line ~1715-1732): Add `agentPhase` field to the returned agent object. Set to `'planning'` when `isPlanning` is true, `'work'` otherwise.
- Same for remote agents and stopped agents sections.

### Frontend Changes

**File: `src/dashboard/frontend/src/types.ts`**
- Add `agentPhase?: 'planning' | 'work'` to the `Agent` interface.

**File: `src/dashboard/frontend/src/components/PlanDialog.tsx`**
- Add `watchPlanning` state (boolean, default false, persisted to localStorage key `overdeck.planning.watchPlanning`).
- Add checkbox in the `ready` step form: "Stay and watch planning".
- In `startPlanningMutation.onSuccess`: if `!watchPlanning`, call `onClose()` instead of transitioning to `planning` step.
- When dialog is reopened (e.g., from INPUT badge click), check for active planning session and reconnect to terminal as today.

**File: `src/dashboard/frontend/src/components/KanbanBoard.tsx`**
- In `renderIssueCard`: find planning agent separately: `agents.find(a => a.issueId === issueIdLower && a.agentPhase === 'planning')`.
- Pass `planningAgent` as a new prop to `IssueCard`.
- In `IssueCard`: when `planningAgent` exists and is running, show purple pulsing dots + "Planning" badge.
- When planning agent has `hasPendingQuestion`, the existing amber "Input" badge already renders. Make clicking it call `onPlan()` (opens PlanDialog) instead of `onSelect()` (opens terminal viewer) when the source is a planning agent.

**File: `src/dashboard/frontend/src/components/KanbanBoard.tsx` (or new toast component)**
- Add toast notification when a planning agent's `hasPendingQuestion` transitions from false to true.
- Track previous question state to detect transitions (useRef or similar).
- Auto-dismiss after 10s.

### Data Flow

```
Backend /api/agents → includes planning-* agents with agentPhase: 'planning'
  ↓
Frontend useQuery(['agents']) → agent list includes planning agents
  ↓
KanbanBoard renderIssueCard → finds planningAgent by issueId + agentPhase
  ↓
IssueCard → shows Planning badge + pulse when planningAgent active
          → shows Input badge when planningAgent.hasPendingQuestion
          → clicking Input badge opens PlanDialog
  ↓
Toast system → fires when hasPendingQuestion transitions to true
```

## Files to Modify

| File | Change | Difficulty |
|------|--------|------------|
| `src/dashboard/server/index.ts` | Add `agentPhase` field to agent API response | trivial |
| `src/dashboard/frontend/src/types.ts` | Add `agentPhase` to Agent interface | trivial |
| `src/dashboard/frontend/src/components/PlanDialog.tsx` | Add watch checkbox, close-on-confirm behavior | medium |
| `src/dashboard/frontend/src/components/KanbanBoard.tsx` | Planning badge, planning agent prop, INPUT click → PlanDialog, toast | medium |

## Edge Cases

- **Dialog reopened while planning active**: Already handled — `checking` step detects active session and transitions to `planning`.
- **Planning agent finishes without INPUT**: Card stops showing Planning badge when agent disappears from agent list. No INPUT badge shown.
- **Work agent AND planning agent on same issue**: Shouldn't happen (planning completes before work starts), but if it does, show both badges.
- **Multiple toasts**: Debounce — only fire toast once per INPUT transition, not on every poll cycle. Track with a ref keyed by agent ID.

## Out of Scope

- Changing the planning agent's behavior or prompt
- Modifying how INPUT/AskUserQuestion works internally
- Adding sound notifications
- Changing the planning completion flow (Done button, etc.)
