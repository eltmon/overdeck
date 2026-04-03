# PAN-428: Dashboard Data Layer — Effect.js Event-Driven Architecture

## Problem

The Panopticon dashboard takes 5-20+ seconds to open a workspace detail panel. Root cause: **80+ HTTP requests/minute** from aggressive, duplicated polling saturates the browser's 6-connection HTTP/1.1 limit through Traefik. Foreground requests queue behind background polls.

### Current State (Broken)

- **3 independent `/api/issues` queries** (App.tsx, KanbanBoard, SearchModal) with different React Query keys
- **3 independent `/api/agents` queries** (App.tsx 5s, KanbanBoard 5s, AgentList 3s)
- **42+ polling queries** across components, many at 2-5 second intervals
- Socket.io exists but is underutilized — KanbanBoard/SearchModal ignore the socket cache
- `/api/issues` returns **1.3MB** of JSON every 5 seconds from two components
- No event ordering, no deduplication, no incremental updates

## Reference Architecture: T3Code

T3Code (by Theo) solves this exact problem with zero HTTP polling for application state:

- **Single WebSocket** with Effect.js RPC — all 40+ methods multiplexed over one connection
- **Event sourcing** with monotonic sequence numbers — client tracks last applied sequence
- **Snapshot + stream** — cold start gets full state, then incremental events
- **Zustand store** as single source of truth — derived views via selectors
- **Recovery coordinator** — replays missed events on reconnect, detects sequence gaps
- **Event coalescing** — batches rapid events via `queueMicrotask` before store update

Reference source at `/home/eltmon/Projects/t3code`. Key files:
- `apps/server/src/ws.ts` — RPC server with streaming subscriptions
- `apps/web/src/wsTransport.ts` — auto-reconnecting WebSocket client
- `apps/web/src/store.ts` — Zustand store with pure event application
- `apps/web/src/routes/__root.tsx` — recovery coordinator + event subscription
- `packages/contracts/src/rpc.ts` — shared RPC method definitions

## Architecture

### Overview

```
┌──────────────────────────────────────────────────────────┐
│                    Dashboard Server                       │
│                                                          │
│  IssueDataService ──► EventStore ──► PubSub ─────────┐  │
│  AgentManager ─────►    (SQLite)       │              │  │
│  Cloister ─────────►                   │              │  │
│  Deacon ───────────►                   │              │  │
│                                        │              │  │
│  Effect.js RPC Server ◄───────────────-┘              │  │
│    │                                                  │  │
│    ├─ getSnapshot()          → full state             │  │
│    ├─ replayEvents(fromSeq)  → missed events          │  │
│    ├─ subscribeDomainEvents  → live event stream      │  │
│    ├─ subscribeTerminal(id)  → terminal output stream │  │
│    ├─ getWorkspaceDetail(id) → workspace info (unary) │  │
│    └─ dispatchCommand(cmd)   → mutations              │  │
│                                                       │  │
└───────────────────────┬──────────────────────────────-┘  │
                        │ Single WebSocket                  │
┌───────────────────────┴──────────────────────────────────┐
│                    Dashboard Frontend                     │
│                                                          │
│  WsTransport (Effect.js RPC client)                      │
│    │                                                     │
│    ├─ subscribeDomainEvents ──► RecoveryCoordinator      │
│    │                              │                      │
│    │                              ▼                      │
│    │                           Zustand Store             │
│    │                           (single source of truth)  │
│    │                              │                      │
│    │                    ┌─────────┼──────────┐           │
│    │                    ▼         ▼          ▼           │
│    │              KanbanBoard  DetailPanel  SearchModal   │
│    │              (selector)   (selector)   (selector)   │
│    │                                                     │
│    ├─ subscribeTerminal(id) ──► TerminalPanel (direct)   │
│    │                                                     │
│    └─ React Query (git status, external data only, 30s+) │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Domain Events

All state changes flow through typed events with monotonic sequence numbers:

```typescript
// src/shared/contracts/events.ts
import { Schema } from "effect";

export const IssueUpdated = Schema.Struct({
  type: Schema.Literal("issue.updated"),
  sequence: Schema.Number,
  timestamp: Schema.String,
  payload: Schema.Struct({
    identifier: Schema.String,
    fields: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  }),
});

export const AgentStatusChanged = Schema.Struct({
  type: Schema.Literal("agent.status-changed"),
  sequence: Schema.Number,
  timestamp: Schema.String,
  payload: Schema.Struct({
    agentId: Schema.String,
    issueId: Schema.String,
    status: Schema.String,
    previousStatus: Schema.String,
  }),
});

export const DomainEvent = Schema.Union([
  IssueUpdated, AgentStatusChanged, PipelineStageCompleted,
  SpecialistSpawned, WorkspaceCreated, PlanningCompleted,
  BeadStatusChanged, CostRecorded, /* ... */
]);
```

### RPC Contract

```typescript
// src/shared/contracts/rpc.ts
import { Rpc, RpcGroup, Schema } from "effect";

export const GetSnapshotRpc = Rpc.make("pan.getSnapshot", {
  payload: Schema.Struct({}),
  success: DashboardSnapshot,
});

export const ReplayEventsRpc = Rpc.make("pan.replayEvents", {
  payload: Schema.Struct({ fromSequence: Schema.Number }),
  success: Schema.Array(DomainEvent),
});

export const SubscribeDomainEventsRpc = Rpc.make("pan.subscribeDomainEvents", {
  payload: Schema.Struct({}),
  success: DomainEvent,
  stream: true,
});

export const SubscribeTerminalRpc = Rpc.make("pan.subscribeTerminal", {
  payload: Schema.Struct({ sessionName: Schema.String }),
  success: TerminalChunk,
  stream: true,
});

export const PanRpcGroup = RpcGroup.make(
  GetSnapshotRpc, ReplayEventsRpc,
  SubscribeDomainEventsRpc, SubscribeTerminalRpc,
  GetWorkspaceDetailRpc, DispatchCommandRpc,
);
```

### Server: Event Store + Streaming RPC

```typescript
// src/dashboard/server/event-store.ts
// Append-only event store backed by SQLite (same DB as beads/costs)
export class EventStore {
  private sequence = 0;
  private pubSub: PubSub<DomainEvent>;

  async append(event: Omit<DomainEvent, 'sequence'>): Promise<DomainEvent> {
    const sequenced = { ...event, sequence: ++this.sequence };
    await this.db.insert(sequenced);
    await PubSub.publish(this.pubSub, sequenced);
    return sequenced;
  }

  readFrom(fromSequenceExclusive: number): Stream<DomainEvent> {
    return Stream.fromIterable(this.db.query(fromSequenceExclusive));
  }

  get liveStream(): Stream<DomainEvent> {
    return Stream.fromPubSub(this.pubSub);
  }
}
```

The RPC handler for `subscribeDomainEvents` follows T3Code's pattern — snapshot sequence + replay + live merge with sequence-ordered deduplication:

```typescript
// src/dashboard/server/ws-rpc.ts
subscribeDomainEvents: (_input) =>
  Stream.unwrap(Effect.gen(function* () {
    const snapshot = yield* getSnapshot();
    const fromSeq = snapshot.snapshotSequence;
    const replay = yield* Stream.runCollect(eventStore.readFrom(fromSeq));
    const source = Stream.merge(
      Stream.fromIterable(replay),
      eventStore.liveStream
    );

    // Sequence-ordered deduplication (same pattern as T3Code ws.ts:151-184)
    const state = yield* Ref.make({ nextSequence: fromSeq + 1, pending: new Map() });
    return source.pipe(
      Stream.mapEffect((event) => Ref.modify(state, sequenceOrder(event))),
      Stream.flatMap(Stream.fromIterable),
    );
  })),
```

Existing `IssueDataService`, `AgentManager`, `Cloister`, and `Deacon` emit events to the store. This is additive — existing Express API + socket.io continue working during migration.

### Client: Zustand Store + Recovery Coordinator

```typescript
// src/dashboard/frontend/src/store.ts
interface DashboardState {
  issues: Map<string, Issue>;
  agents: Map<string, Agent>;
  specialists: Map<string, Specialist>;
  costs: Map<string, IssueCost>;
  latestSequence: number;
  bootstrapComplete: boolean;
}

// Pure function: one event → new state
function applyDomainEvent(state: DashboardState, event: DomainEvent): DashboardState {
  switch (event.type) {
    case "issue.updated": {
      const existing = state.issues.get(event.payload.identifier);
      if (!existing) return state;
      return { ...state, issues: new Map(state.issues).set(
        event.payload.identifier, { ...existing, ...event.payload.fields }
      )};
    }
    case "agent.status-changed": { /* ... */ }
  }
}

// Selectors — derived views, zero extra fetches
export const selectIssuesByCycle = (cycle: string) => (s: DashboardState) =>
  [...s.issues.values()].filter(i => matchesCycle(i, cycle));
export const selectIssueByIdentifier = (id: string) => (s: DashboardState) =>
  s.issues.get(id);
export const selectAgentForIssue = (issueId: string) => (s: DashboardState) =>
  [...s.agents.values()].find(a => a.issueId === issueId);
```

Recovery coordinator (adapted from T3Code's `orchestrationRecovery.ts`):

```typescript
// src/dashboard/frontend/src/recovery.ts
// Handles: bootstrap snapshot, sequence gap detection, replay, reconnection
// State machine: bootstrap → streaming → (gap detected) → replay → streaming
// See T3Code: apps/web/src/orchestrationRecovery.ts for full implementation
```

### Migration Path

Effect.js RPC runs **alongside** existing Express API. Components migrate one at a time:

1. **Server**: Add WebSocket RPC at `/ws/rpc` alongside existing Express routes
2. **Event store**: Wrap `IssueDataService` polling → event emission on change
3. **Frontend**: Add `WsTransport` + `Zustand store` + `RecoveryCoordinator`
4. **Migrate**: KanbanBoard first (biggest win), then other components
5. **Deprecate**: Remove React Query polling for issues/agents once all migrated

No big-bang rewrite. Express API stays for non-real-time endpoints (workspace creation, file downloads, etc.).

## Phases

### Phase 1: Foundation (Effect.js RPC + Event Store)

**Server:**
- [ ] Add `effect`, `@effect/platform-node` dependencies
- [ ] Create `src/shared/contracts/` — event schemas + RPC definitions
- [ ] Create `src/dashboard/server/event-store.ts` — SQLite append-only store
- [ ] Create `src/dashboard/server/ws-rpc.ts` — Effect.js RPC server layer
- [ ] Implement `getSnapshot`, `replayEvents`, `subscribeDomainEvents`
- [ ] Wire `IssueDataService` changes → `EventStore.append()`
- [ ] Wire agent lifecycle → `EventStore.append()`
- [ ] Mount WebSocket RPC at `/ws/rpc`

**Frontend:**
- [ ] Add `effect`, `zustand` dependencies
- [ ] Create `src/dashboard/frontend/src/wsTransport.ts` — RPC client + auto-reconnect
- [ ] Create `src/dashboard/frontend/src/store.ts` — Zustand store + `applyDomainEvent`
- [ ] Create `src/dashboard/frontend/src/recovery.ts` — sequence-based recovery
- [ ] Create `EventRouter` component — subscribes to events, manages recovery

### Phase 2: Migrate KanbanBoard (Biggest Win)

- [ ] KanbanBoard reads from Zustand store selectors
- [ ] Remove `fetchIssues` and `fetchAgents` from KanbanBoard.tsx
- [ ] Remove all `/api/issues` and `/api/agents` polling
- [ ] Detail panel opens in <1 second (Playwright verified)
- [ ] HTTP requests from kanban board: <5/minute (down from 80+)

### Phase 3: Migrate Remaining Components

- [ ] App.tsx, SearchModal, AgentList, CloisterStatusBar, InspectorPanel, MetricsSummaryRow
- [ ] Add socket events for specialists, cloister status, workspace updates
- [ ] Components on non-active tabs: `enabled: false`

### Phase 4: Terminal Streaming

- [ ] `subscribeTerminal` streaming RPC
- [ ] Replace HTTP output polling with WebSocket stream
- [ ] Live terminal rendering from stream

### Phase 5: Cleanup

- [ ] Remove unused Express polling endpoints
- [ ] Remove React Query for application state (keep for external data only)
- [ ] Remove old socket.io event handlers replaced by RPC
- [ ] Performance audit: <500ms detail panel, <5 HTTP req/min

## Acceptance Criteria

| Phase | Metric | Target |
|-------|--------|--------|
| 1 | RPC server running, events flowing | Functional |
| 2 | Detail panel open time | <1 second |
| 2 | HTTP requests/minute (kanban) | <5 (from 80+) |
| 5 | HTTP polling for app state | Zero |
| 5 | WebSocket connections | 1 (multiplexed) |
| 5 | React Query usage | External data only |

## Dependencies

- `effect` ^4.x (runtime, Schema, Stream, PubSub, Queue, Ref)
- `@effect/platform-node` ^4.x (WebSocket server, RPC serialization)
- `zustand` ^5.x (client-side store)

## Non-Goals

- Replacing Express entirely (keep for non-real-time endpoints + mutations initially)
- Full CQRS (no separate write model — mutations still go through Express)
- Event sourcing the entire application (just the dashboard read model)

## Risk

| Risk | Impact | Mitigation |
|------|--------|------------|
| Effect.js learning curve | Medium | T3Code as reference, phased migration |
| Missed socket events | Low | 60s safety-net poll + recovery coordinator |
| Event schema evolution | Low | Effect Schema validation, versioning |
| Coexistence period | Medium | Components migrate fully, no half-and-half |

## References

- T3Code: `/home/eltmon/Projects/t3code` — production Effect.js RPC + event sourcing
- PAN-70: execSync blocking (previous connection bottleneck)
- PAN-398: Headroom integration (complementary — LLM token costs, not HTTP costs)
- PAN-400: TRON encoding (superseded by Headroom, now further superseded by this)
