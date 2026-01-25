# PAN-83: Update Handoffs Tab and Metrics for Queue System

## Status: ✅ IMPLEMENTATION COMPLETE

## Summary

Update the dashboard's Handoffs tab and metrics to reflect the new queue-based specialist system while preserving existing model handoff tracking.

## Implementation Completed

All planned components have been successfully implemented:

1. ✅ **specialist-handoff-logger.ts** - Core logging infrastructure created
2. ✅ **API endpoints** - Added `/api/specialist-handoffs` and `/api/specialist-handoffs/stats`
3. ✅ **MetricsSummary.tsx** - Updated with three new metrics:
   - Specialist Handoffs (today's count)
   - Cost Escalations (model handoff count)
   - Queue Depth (pending items)
4. ✅ **HandoffsPage.tsx** - Added new "Specialist Handoffs" section with:
   - Stats cards (Today's Handoffs, Queue Depth, Success Rate, Most Active)
   - Table showing recent handoffs with issue, transition, priority, status
5. ✅ **Integration** - Hooked logging into `submitToSpecialistQueue()` in specialists.ts

## Tests

- Build: ✅ Success
- Frontend Unit Tests: ✅ 28/28 passed (useSearch hook)
- Backend Unit Tests: ✅ 27/27 passed (specialist-handoff-logger)
  - All 6 exported functions tested
  - Coverage: writing/reading events, filtering, statistics, edge cases
  - Edge cases: empty log, corrupted JSON, midnight boundary
- E2E Tests: ✅ 22/22 passed (agent-lifecycle, 1 skipped)
  - Fixed pre-existing test timeout bug in resumeAgent test

---

## Decisions

### 1. Tab Structure
**Decision:** Add a new "Specialist Handoffs" section below the existing "Model Handoffs" section.

**Rationale:** The existing model handoff data (cost escalations) is still valuable for understanding when agents need more capable models. The specialist handoffs (work passing between agents) is a different concept that deserves its own section.

### 2. Handoff Tracking
**Decision:** Create a new log file `~/.panopticon/specialist-handoffs.json` to persist specialist handoff events.

**Rationale:** Queue items are cleared after completion, but we need historical data for the handoffs display. Creating a dedicated log (similar to `handoff-logger.ts` for model escalations) provides clean separation and query capabilities.

### 3. Metrics Summary Updates
**Decision:** Add/update metrics in the summary bar:
- **"Specialist Handoffs"** - Count of queue handoffs today
- **"Cost Escalations"** - Count of model escalations today (replaces the placeholder "Handoffs Today")
- **"Queue Depth"** - Total items waiting across all specialist queues

### 4. Specialist Handoff Display
**Decision:** Each handoff row shows:
- Issue ID (linked to issue)
- From → To (specialist badges, e.g., "review-agent → test-agent")
- Status (queued, processing, completed, failed)
- Timestamp

---

## Architecture

### New Files
```
src/lib/cloister/specialist-handoff-logger.ts  # Log and read specialist handoffs
```

### Modified Files
```
src/dashboard/frontend/src/components/HandoffsPage.tsx      # Add specialist section
src/dashboard/frontend/src/components/MetricsSummary.tsx    # Add 3 new metrics
src/dashboard/server/index.ts                               # API endpoints for specialist handoffs
src/lib/cloister/specialists.ts                             # Log handoffs when queueing
```

### Data Structures

**SpecialistHandoff event:**
```typescript
interface SpecialistHandoff {
  id: string;
  timestamp: string;           // ISO 8601
  issueId: string;
  fromSpecialist: string;      // e.g., "review-agent"
  toSpecialist: string;        // e.g., "test-agent"
  status: 'queued' | 'processing' | 'completed' | 'failed';
  priority: 'urgent' | 'high' | 'normal' | 'low';
  completedAt?: string;
  result?: 'success' | 'failure';
}
```

**API Endpoints:**
- `GET /api/specialist-handoffs` - List recent handoffs (limit param, default 50)
- `GET /api/specialist-handoffs/stats` - Today's count, success rate, by specialist

### Integration Points

When `submitToSpecialistQueue()` or `wakeSpecialistOrQueue()` is called:
1. Log a new `SpecialistHandoff` event with status `queued`
2. Update status to `processing` when specialist starts work
3. Update status to `completed` when specialist reports completion via review-status

---

## Scope

### In Scope
- New specialist handoffs section in Handoffs tab
- Specialist handoff logging infrastructure
- Three new/updated metric cards in summary
- API endpoints for handoff data
- Hooking into existing queue functions to log events

### Out of Scope
- Modifying the existing model handoff tracking (keep as-is)
- Changes to the queue management UI (already in SpecialistAgentCard)
- Changes to how specialists process work
- Real-time websocket updates (use polling like existing tabs)

---

## Implementation Order

1. **specialist-handoff-logger.ts** - Core logging infrastructure (logHandoff, readHandoffs, getStats)
2. **API endpoints** - Add routes to server/index.ts for handoff data
3. **MetricsSummary.tsx** - Update the three metric cards
4. **HandoffsPage.tsx** - Add specialist handoffs section with table
5. **Integration** - Hook logging into specialists.ts queue functions

---

## Testing Strategy

- Unit tests for specialist-handoff-logger.ts
- API tests for new endpoints
- Manual verification of metrics updating correctly
- Manual verification of handoff display in tab

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/lib/cloister/handoff-logger.ts` | Existing model handoff logger (pattern to follow) |
| `src/lib/cloister/specialists.ts` | Queue functions to hook into |
| `src/dashboard/frontend/src/components/HandoffsPage.tsx` | UI to modify |
| `src/dashboard/frontend/src/components/MetricsSummary.tsx` | Metrics to update |
| `src/dashboard/server/index.ts` | API routes |
