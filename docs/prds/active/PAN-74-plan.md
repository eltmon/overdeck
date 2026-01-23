# PAN-74: Specialists Task Queue Integration

## Problem Statement

When a specialist is handed a task while already busy, the task is lost. The existing queue infrastructure (`submitToSpecialistQueue`, etc.) exists but isn't wired into the handoff flow or deacon patrol loop.

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Busy notification | Silent queue only | Don't disturb busy specialists |
| Queue ordering | Priority-based | Use existing priority field (urgent > high > normal > low) |
| Stale task handling | Process anyway | Let specialist discover issue state - keeps logic simple |
| Queue size limit | No limit | Rely on priority and manual cleanup |
| Queue check frequency | On idle detection | Check queue when `isIdleAtPrompt()` returns true |
| Queue persistence | Hooks system (JSON files) | Already persistent at `~/.panopticon/agents/{specialist}/hook.json` |
| Dashboard UI depth | Count + expandable list | Badge with count, expand to see queued issue IDs |
| Queue management | Full control | View, remove, and reorder from dashboard |

## Technical Approach

### 1. Integrate Queue into Handoff Flow

Modify the handoff/wake flow to check if specialist is busy:

```typescript
// In the handoff/wake call path
const running = await isRunning(name);
const idle = running ? await isIdleAtPrompt(name) : false;

if (running && !idle) {
  // Specialist is busy - queue the task
  submitToSpecialistQueue(name, {
    priority: options.priority || 'normal',
    source: options.source || 'handoff',
    issueId: task.issueId,
    workspace: task.workspace,
    branch: task.branch,
    prUrl: task.prUrl,
    context: task.context,
  });
  console.log(`[handoff] ${name} busy, queued task for ${task.issueId}`);
  return { success: true, queued: true, message: `Task queued for ${name}` };
}

// Otherwise proceed with normal wake
return wakeSpecialist(name, taskPrompt, options);
```

### 2. Process Queue in Deacon Patrol

Extend `runPatrol()` in deacon.ts:

```typescript
// After health check for each specialist
if (result.wasRunning && await isIdleAtPrompt(specialist.name)) {
  const queue = checkSpecialistQueue(specialist.name);
  if (queue.hasWork) {
    const nextTask = getNextSpecialistTask(specialist.name);
    if (nextTask) {
      console.log(`[deacon] ${specialist.name} idle with queued work, waking for ${nextTask.payload.issueId}`);
      const wakeResult = await wakeSpecialistWithTask(specialist.name, nextTask.payload);
      if (wakeResult.success) {
        completeSpecialistTask(specialist.name, nextTask.id);
        actions.push(`Processed queued task for ${specialist.name}: ${nextTask.payload.issueId}`);
      }
    }
  }
}
```

### 3. API Endpoints

Add new endpoints to dashboard server:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/specialists/queues` | GET | Get all specialist queues with counts and items |
| `/api/specialists/:name/queue` | GET | Get specific specialist's queue |
| `/api/specialists/:name/queue/:itemId` | DELETE | Remove item from queue |
| `/api/specialists/:name/queue/reorder` | PUT | Reorder queue items (body: `{ itemIds: string[] }`) |

### 4. Dashboard UI

Update `SpecialistAgentCard.tsx`:
- Add queue count badge next to specialist state (e.g., "(2)" for 2 queued items)
- Add expandable section showing queued issue IDs
- Add trash icon to remove items from queue
- Add drag-and-drop or up/down arrows for reordering

```
┌─────────────────────────────────────────┐
│ Specialists                              │
├─────────────────────────────────────────┤
│ 🟢 review-agent    [idle]               │
│ 🟡 test-agent      [busy: PAN-70] (2)   │  ← "(2)" = 2 queued
│    └─ Queue:                             │
│       1. PAN-72 [urgent] ⬆️ ⬇️ 🗑️        │
│       2. PAN-33 [normal] ⬆️ ⬇️ 🗑️        │
│ 🟢 merge-agent     [idle]               │
└─────────────────────────────────────────┘
```

## Files to Modify

| File | Changes |
|------|---------|
| `src/lib/cloister/deacon.ts` | Add queue processing to patrol loop, import queue helpers |
| `src/lib/cloister/specialists.ts` | Add helper function `wakeSpecialistOrQueue()` |
| `src/lib/cloister/handoff.ts` | Use `wakeSpecialistOrQueue()` in performHandoff() |
| `src/dashboard/server/index.ts` | Add 4 queue API endpoints |
| `src/dashboard/frontend/src/components/SpecialistAgentCard.tsx` | Add queue UI with count badge, expandable list, controls |
| `src/lib/hooks.ts` | Add `reorderHookItems()` function for queue reordering |

## Out of Scope

- Queue expiration/TTL
- Cross-specialist queue balancing
- Queue metrics/analytics
- Notification system for queue events
- Maximum queue size limits

## Acceptance Criteria

- [ ] Tasks queued when specialist is busy (not dropped)
- [ ] Queued tasks processed when specialist becomes idle
- [ ] Queue persists across dashboard restarts (using hooks system)
- [ ] API endpoint to view all specialist queues
- [ ] API endpoint to remove items from queue
- [ ] API endpoint to reorder queue items
- [ ] Dashboard shows queue count per specialist
- [ ] Dashboard allows viewing queued issues
- [ ] Dashboard allows removing queued items
- [ ] Dashboard allows reordering queued items

## Implementation Order

1. **Backend: hooks.ts** - Add `reorderHookItems()` function
2. **Backend: specialists.ts** - Add `wakeSpecialistOrQueue()` wrapper
3. **Backend: deacon.ts** - Add queue processing to patrol loop
4. **Backend: handoff.ts** - Update performHandoff() to use queue wrapper
5. **Backend: server/index.ts** - Add 4 queue API endpoints
6. **Frontend: SpecialistAgentCard.tsx** - Add queue UI

## Testing Notes

- Test with mock busy specialist (send task while specialist is working)
- Test queue persistence by restarting dashboard
- Test priority ordering (urgent tasks should be processed first)
- Test removal operation from dashboard
- Test reorder operation from dashboard
- Verify deacon patrol picks up queued tasks when specialist becomes idle
