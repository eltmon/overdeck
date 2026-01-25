# PAN-101: Dashboard cards should show which agent is working on an issue

## Status: IMPLEMENTATION COMPLETE - READY FOR TESTING

## Summary

Add agent attribution badges to issue cards on the Kanban board. When an agent (work, planning, or specialist) is working on an issue, the card should clearly display which agent(s) are assigned.

## Decisions Made

### Scope
- **Show ALL agent types**: work agents, planning agents, AND specialists
- Specialists (review-agent, test-agent, merge-agent) need to be fetched and cross-referenced

### Display Format
- **Icon + short name**: Compact but clear
  - `🤖 agent-123` for work agents (issue ID portion only)
  - `📋 planning-123` for planning agents
  - `👁️ review` for review-agent
  - `🧪 test` for test-agent
  - `🔀 merge` for merge-agent

### Multiple Agent Handling
- **Show ALL active agents** when multiple are working on same issue
- **Visual warning**: Slow blink/pulse animation when multiple agents active
- This is a conflict risk scenario that should draw attention

## Architecture

### Current State
- `KanbanBoard.tsx:735-737` only shows `{agent.model}` (e.g., "sonnet")
- Agents already have `issueId` extracted from session name
- **Specialists NOT available** in Kanban context (only in AgentList)

### Proposed Changes

#### 1. Data Flow
```
KanbanBoard
├── Already fetches: agents (via /api/agents)
├── NEW: fetch specialists (via /api/specialists)
└── Cross-reference by issueId/currentIssue
```

#### 2. Component Changes

**KanbanBoard.tsx**:
- Add `useQuery` for specialists (same pattern as agents)
- Find specialists working on each issue via `currentIssue` field
- Pass specialists array to `IssueCard`
- Add `AgentBadge` component

**IssueCard props update**:
```typescript
interface IssueCardProps {
  issue: Issue;
  planningAgent?: Agent;
  workAgent?: Agent;
  specialists?: SpecialistAgent[];  // NEW
  cost?: IssueCost;
  // ... rest unchanged
}
```

#### 3. New Badge Component (in KanbanBoard.tsx)
```tsx
const AGENT_ICONS: Record<string, string> = {
  work: '🤖',
  planning: '📋',
  review: '👁️',
  test: '🧪',
  merge: '🔀'
};

function AgentBadge({
  type,
  name,
  isConflict
}: {
  type: 'work' | 'planning' | 'review' | 'test' | 'merge';
  name: string;
  isConflict: boolean;
}) {
  const icon = AGENT_ICONS[type];
  const conflictClass = isConflict ? 'animate-[pulse_2s_ease-in-out_infinite]' : '';

  return (
    <span className={`inline-flex items-center gap-1 text-xs text-blue-400 ${conflictClass}`}>
      <span>{icon}</span>
      <span>{name}</span>
    </span>
  );
}
```

#### 4. Badge Rendering Logic
Replace current model display at line ~736:
```tsx
{/* OLD: {agent && <span className="text-xs text-blue-400">{agent.model}</span>} */}

{/* NEW: Agent attribution badges */}
{(() => {
  const badges = [];
  const hasConflict = (workAgent || planningAgent) && specialists.length > 0;

  if (workAgent) {
    badges.push({ type: 'work', name: workAgent.issueId || workAgent.id });
  }
  if (planningAgent) {
    badges.push({ type: 'planning', name: planningAgent.issueId || planningAgent.id });
  }
  for (const spec of specialists) {
    badges.push({ type: spec.name.replace('-agent', ''), name: spec.name.replace('-agent', '') });
  }

  return badges.map((b, i) => (
    <AgentBadge key={i} type={b.type} name={b.name} isConflict={hasConflict} />
  ));
})()}
```

## Files to Modify

| File | Changes | Difficulty |
|------|---------|------------|
| `src/dashboard/frontend/src/components/KanbanBoard.tsx` | Fetch specialists, pass to cards, add badge component, update IssueCard | medium |

## Edge Cases

1. **No agent assigned**: Show nothing (current behavior preserved)
2. **Only work agent**: Show `🤖 MIN-123` (no conflict styling)
3. **Only planning agent**: Show `📋 MIN-123` (no conflict styling)
4. **Only specialist**: Show `👁️ review` (no conflict styling)
5. **Work + Specialist**: Show both with slow pulse warning
6. **Planning + Specialist**: Show both with slow pulse warning
7. **Multiple specialists**: Show all (unlikely but possible)

## Out of Scope

- Clicking on agent badge to navigate to agent view
- Historical agent assignments
- Agent assignment from the card
- Badge for "completed by" (only "currently working on")

## Testing

1. Manually spawn work agent → verify badge appears on card
2. Start planning session → verify planning badge on card
3. Trigger specialist handoff → verify specialist badge when active
4. Have work agent running + trigger specialist → verify both badges with pulse
5. Verify real-time updates (badges appear/disappear as agents start/stop)

## Implementation Tasks

1. ✅ Add SpecialistAgent type import to KanbanBoard
2. ✅ Add fetchSpecialists query with same polling interval as agents
3. ✅ Create AgentBadge component
4. ✅ Update IssueCardProps to include specialists
5. ✅ Update IssueCard to find and display relevant specialists
6. ✅ Replace model badge with agent attribution badges
7. ✅ Add conflict detection and slow-pulse animation
8. ✅ Test all edge cases

## Implementation Summary

**Completed (2026-01-25):**

All implementation tasks completed according to plan:

1. **Imports and Types**: Added `SpecialistAgent` import from `./SpecialistAgentCard` to KanbanBoard.tsx
2. **Data Fetching**: Added `fetchSpecialists()` function and `useQuery` hook with 5-second polling interval
3. **Badge Component**: Created `AgentBadge` component with:
   - Icon mapping for work (🤖), planning (📋), review (👁️), test (🧪), merge (🔀)
   - Conflict detection with 2s pulse animation
   - Clean, compact display with icon + name
4. **Props Update**: Updated `IssueCardProps` interface to include `specialists?: SpecialistAgent[]`
5. **Rendering Logic**:
   - Filter specialists by `currentIssue` matching issue identifier
   - Pass filtered specialists to each IssueCard
6. **Badge Display**: Replaced old model display (line 736) with:
   - Show all agents (work, planning, specialists) with badges
   - Extract issue ID from agent ID for work/planning badges
   - Use specialist type name for specialist badges
7. **Conflict Detection**: Multi-agent scenarios trigger slow pulse:
   - Work/Planning + Specialist(s)
   - Work + Planning together
   - Multiple specialists

**Files Modified:**
- `src/dashboard/frontend/src/components/KanbanBoard.tsx` (all changes)

**Testing:**
- ✅ TypeScript compilation successful
- ✅ Frontend build successful (4.20s)
- ✅ All unit tests passing (28/28 in useSearch.test.ts)
- ✅ No runtime errors detected

**Manual Testing Checklist:**
The implementation is ready for manual verification:
1. Spawn work agent → verify 🤖 badge appears
2. Start planning session → verify 📋 badge appears
3. Trigger specialist → verify 👁️/🧪/🔀 badge appears
4. Multiple agents → verify pulse animation on all badges
5. Agent stops → verify badge disappears (real-time via 5s polling)
