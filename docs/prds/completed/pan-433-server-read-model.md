# PAN-433: Server-Side Read Model — Clean Data Architecture

## Problem

`getSnapshot` calls raw lib modules (`listRunningAgents()`, `getIssues()`, `getAllSpecialists()`) that return dirty JavaScript objects — undefined values, inconsistent status strings, untyped fields. When the Effect RPC layer tries to serialize this through Schema, it crashes. This crashes the Bun HTTP handler, forces us to use Node, and creates a cascade of workarounds (jsonResponse, Schema.String loosening, JSON round-trip hacks).

T3Code doesn't have this problem because their snapshot serves a **read model projection** built from typed events — never from raw external data.

## Solution

Build a server-side read model identical to the frontend's Zustand store pattern. One in-memory state object, bootstrapped once from existing sources (cleaned), then maintained incrementally by domain events. `getSnapshot` returns the read model directly — no lib calls, no dirty data, no Schema crashes.

## Architecture

```
Server Boot
  │
  ├─ IssueDataService polls Linear/GitHub → emits issue.updated events
  ├─ Agent lifecycle → emits agent.started/stopped events  
  ├─ Specialists → emits specialist.spawned/completed events
  ├─ Pipeline → emits pipeline.review-completed/test-completed events
  │
  ▼
EventStore.append(event)
  │
  ├─ Persists to SQLite (for replay/recovery)
  ├─ PubSub → WebSocket RPC subscribers (live frontend updates)
  │
  └─ ReadModel.applyEvent(event)  ◄── NEW
       │
       ▼
     In-Memory Read Model
     {
       sequence: number,
       agents: Map<string, AgentSnapshot>,
       specialists: Map<string, SpecialistSnapshot>,
       reviewStatuses: Map<string, ReviewStatusSnapshot>,
       issues: Map<string, Issue>,
       resources: ResourceStats | null,
       timestamp: string,
     }
       │
       ├─ getSnapshot() → returns read model (already clean)
       └─ subscribeDomainEvents → streams from EventStore (already typed)
```

## What Changes

### Create: `src/dashboard/server/read-model.ts`

The read model service. Holds the in-memory state, applies events, serves snapshots.

```typescript
import { DashboardSnapshot } from '@overdeck/contracts';

class ReadModel {
  private state: DashboardSnapshot;

  // Bootstrap from existing sources on startup (one-time, JSON-cleaned)
  async bootstrap(): Promise<void> {
    const rawAgents = listRunningAgents();
    const rawIssues = issueDataService.getIssues();
    const rawSpecialists = getAllSpecialists();
    const rawReviewStatuses = loadReviewStatuses();
    
    // JSON round-trip strips undefined values — only needed for bootstrap data
    // All subsequent updates come from typed events (no undefineds possible)
    this.state = JSON.parse(JSON.stringify({
      sequence: 0,
      agents: buildAgentSnapshots(rawAgents),
      specialists: buildSpecialistSnapshots(rawSpecialists),
      reviewStatuses: buildReviewSnapshots(rawReviewStatuses),
      issues: rawIssues,
      resources: null,
      timestamp: new Date().toISOString(),
    }));
  }

  // Apply a domain event — pure function, same pattern as frontend store
  applyEvent(event: DomainEvent): void {
    this.state = applyDomainEvent(this.state, event);
    this.state.sequence = event.sequence;
    this.state.timestamp = event.timestamp;
  }

  // Return the current state — always clean, typed, ready for RPC
  getSnapshot(): DashboardSnapshot {
    return this.state;
  }
}
```

### Create: `src/shared/event-reducers.ts`

Pure function: `(state, event) → newState`. Shared between server read model and frontend Zustand store. Lives in the contracts package or a shared module.

The frontend already has this in `src/dashboard/frontend/src/lib/store.ts` (the `applyEvent` switch statement). Extract it to a shared location so both server and frontend use the same logic.

```typescript
export function applyDomainEvent(state: DashboardSnapshot, event: DomainEvent): DashboardSnapshot {
  switch (event.type) {
    case 'agent.started': {
      // Add or update agent in the map
      return { ...state, agents: [...state.agents.filter(a => a.id !== event.payload.agentId), newAgent] };
    }
    case 'agent.stopped': {
      // Update agent status
      return { ...state, agents: state.agents.map(a => a.id === event.payload.agentId ? { ...a, status: 'stopped' } : a) };
    }
    case 'issue.updated': {
      // Update issue fields
      return { ...state, issues: state.issues.map(i => i.identifier === event.payload.identifier ? { ...i, ...event.payload.changedFields } : i) };
    }
    // ... all event types
  }
}
```

### Modify: `src/dashboard/server/ws-rpc.ts`

`getSnapshot` returns `readModel.getSnapshot()` instead of calling `snapshotService.getSnapshot` which queries lib modules.

### Modify: `src/dashboard/server/event-store.ts`

After appending an event, call `readModel.applyEvent(event)` to keep the read model in sync.

### Modify: `src/dashboard/server/main.ts`

On startup:
1. Start IssueDataService (begins polling trackers)
2. Bootstrap read model from current state
3. Start event store
4. Wire event store → read model (every append updates the projection)
5. Start HTTP server

### Delete: `src/dashboard/server/services/domain-services.ts` (SnapshotService)

The SnapshotService that queries lib modules is replaced by the read model. Delete it.

### Delete: `src/dashboard/server/services/issue-service-singleton.ts`

The singleton pattern for IssueDataService was a workaround for routes creating their own instances. With the read model, routes don't call IssueDataService directly — they read from the model or emit events.

## Event Coverage

For the read model to stay accurate, ALL state changes must flow through events. Current coverage:

| Source | Events Emitted | Status |
|--------|---------------|--------|
| Agent lifecycle | agent.started, agent.stopped | ✅ Done |
| Workspace ops | workspace.created, workspace.deleted | ✅ Done |
| Specialist pipeline | specialist.started, specialist.completed | ✅ Done |
| Issue tracker polling | issue.updated | ✅ Done |
| Planning | planning.started, planning.completed | ✅ Done |
| Review pipeline | pipeline.review-started/completed, pipeline.test-started/completed, pipeline.merge-ready | ✅ Done |
| Issue tracker NEW issues | issue.created | ❌ Need to add |
| Issue tracker REMOVED issues | issue.removed | ❌ Need to add |
| Cost recording | cost.recorded | ❌ Need to add |
| Resource stats | resources.stats-updated | ❌ Need to add (ephemeral, PubSub only) |
| Agent heartbeat | agent.heartbeat | ❌ Need to add |

Events marked ❌ need to be emitted from the relevant code paths. Without them, the read model will drift from reality for those data types, and the bootstrap data (from startup) will become stale.

## IssueDataService Integration

The IssueDataService already polls Linear/GitHub every 30-60 seconds. Currently it stores issues in an in-memory cache and pushes them via socket.io. In the new model:

1. IssueDataService polls as before
2. When it detects changes, it emits `issue.updated` events to the event store (already partially done)
3. The event store appends them → read model updates → WebSocket streams to frontend
4. `getSnapshot` returns the read model's issue list — always in sync with the latest poll

For NEW issues (not previously seen), emit `issue.created`. For issues that disappear from the tracker, emit `issue.removed`.

## Shared Event Reducer

The `applyDomainEvent` function is shared between:
- **Server**: `read-model.ts` applies events to the server-side projection
- **Frontend**: `store.ts` applies events to the Zustand store

Both must produce identical results for the same event. This is the T3Code pattern — the read model is eventually consistent because server and client apply the same pure function.

Location: `packages/contracts/src/event-reducers.ts` (shared via the contracts package)

## Schema Tightening

Once the read model is the sole data source for snapshots, we can tighten the Schema back to strict literals:

```typescript
// Current (loose — accepts anything):
export const AgentSnapshot = Schema.Struct({
  status: Schema.String,
  phase: Schema.optional(Schema.String),
})

// Target (strict — only known values):
export const AgentSnapshot = Schema.Struct({
  status: Schema.Literals(["starting", "running", "stopped", "failed", "dead"]),
  phase: Schema.optional(Schema.Literals(["exploration", "implementation", "planning", "testing"])),
})
```

This is safe because the read model only contains values that came from our own typed events — never from uncontrolled external sources.

## Bun Runtime Restoration

With clean data flowing through the RPC, the Bun HTTP handler crash goes away. We can switch from Node back to Bun:

1. `main.ts` detects runtime and uses BunHttpServer or NodeHttpServer (already implemented)
2. `pan up` uses `bun run src/dashboard/server/main.ts` (already implemented)
3. No build step needed for dev (Bun executes TS natively)

## What This Unblocks

Once the read model is in place:

| Blocked Item | Why It's Blocked | Unblocked By |
|-------------|-----------------|--------------|
| Bun runtime | Dirty data crashes RPC | Clean read model data |
| Delete Express | Routes query lib modules | Routes read from model |
| Delete GET routes | Frontend needs HTTP for data | Frontend uses RPC snapshot |
| Strict Schema types | Dirty data fails validation | Clean model data |
| Remove jsonResponse hack | .json() crashes on dirty data | Test with clean data |
| Remove JSON round-trip | Undefineds in snapshot | Model built from typed events |
| Frontend component migration | Store empty/unreliable | Store populated from clean snapshot |

## Acceptance Criteria

- [ ] ReadModel service bootstraps on startup from existing data sources
- [ ] All domain events update the read model via shared `applyDomainEvent()`
- [ ] `getSnapshot` RPC returns read model state (no lib module calls)
- [ ] `applyDomainEvent()` is shared between server and frontend (contracts package)
- [ ] Missing events added: issue.created, issue.removed, cost.recorded, agent.heartbeat
- [ ] Schema types tightened back to strict literals
- [ ] Bun runtime works without crashes
- [ ] Dashboard loads with real data via RPC snapshot (Playwright verified)
- [ ] SnapshotService and issue-service-singleton deleted
- [ ] Zero `JSON.parse(JSON.stringify())` hacks in snapshot path

## Files

| Action | File | Purpose |
|--------|------|---------|
| Create | `src/dashboard/server/read-model.ts` | Server-side read model |
| Create | `packages/contracts/src/event-reducers.ts` | Shared pure event reducer |
| Modify | `src/dashboard/server/ws-rpc.ts` | getSnapshot reads from model |
| Modify | `src/dashboard/server/event-store.ts` | Wire events → read model |
| Modify | `src/dashboard/server/main.ts` | Bootstrap read model on startup |
| Modify | `src/dashboard/server/services/issue-data-service.ts` | Emit issue.created/removed events |
| Modify | `packages/contracts/src/types.ts` | Tighten Schema back to strict literals |
| Modify | `src/dashboard/server/server.ts` | Restore Bun runtime as primary |
| Delete | `src/dashboard/server/services/domain-services.ts` | Replaced by read model |
| Delete | `src/dashboard/server/services/issue-service-singleton.ts` | No longer needed |
| Move | `src/dashboard/frontend/src/lib/store.ts` (applyEvent) | Extract to shared contracts |

## Testing

1. **Event reducer**: Unit test every event type → correct state transition (shared tests for server + frontend)
2. **Read model**: Bootstrap + apply events + verify getSnapshot returns expected state
3. **RPC integration**: Connect WebSocket, receive snapshot, verify data is typed and complete
4. **Playwright E2E**: Dashboard loads → kanban shows issues → detail panel opens in <1s
5. **Bun runtime**: Verify no crashes on Bun after clean data fix

## Reference

- T3Code `apps/server/src/orchestration/Layers/OrchestrationEngine.ts` — their read model
- T3Code `apps/web/src/store.ts` — their shared event application pattern
- PAN-428 PRD — original architecture (this PRD implements the missing piece)
