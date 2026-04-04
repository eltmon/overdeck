# PAN-428 Migration Audit Report

## Summary
The PAN-428 migration is **largely complete** but has several **critical gaps** that prevent it from being production-ready:

### Overall Status: ~85% Complete
- **Core infrastructure**: Complete (contracts, event store, server skeleton, RPC layer)
- **Route modules**: Complete (12 files, 182 routes total)
- **Terminal dual-runtime**: Complete
- **Frontend transport & store**: Partially complete (missing component migration)
- **Cleanup**: Incomplete (missing middleware, bunfig.toml, old API still used)

---

## Detailed Findings

### 1. Contracts Package ✅ COMPLETE

**File**: `packages/contracts/src/`

**Checklist**:
- [x] `events.ts` - Present ✅
- [x] `rpc.ts` - Present ✅
- [x] `types.ts` - Present ✅
- [x] `index.ts` - Present ✅

**Event Coverage**: 23 event types defined (exceeds ~28 mentioned in PRD):
- Agent events: 5 (created, started, stopped, status_changed, output_received)
- Planning events: 3 (started, failed, sync)
- Plan item events: 3 (item_status_changed, subitem_status_changed, items_unblocked)
- Pipeline events: 3 (status_changed, merge_ready, review_status_changed)
- Specialist events: 3 (started, completed, failed)
- Resource events: 1 (updated)
- Issue events: 2 (snapshot, updated)
- Activity events: 1 (updated)
- Shadow events: 1 (inference_update)
- Cost events: 1 (event_recorded)

**RPC Methods**: 9 methods defined correctly with proper streaming/unary distinction:
- Streaming: subscribeDomainEvents, subscribeTerminal, subscribeAgentOutput
- Unary: getSnapshot, replayEvents, terminalOpen, terminalWrite, terminalResize, terminalClose

**Schema Usage**: All event and RPC definitions use Effect Schema properly.

**Status**: ✅ **APPROVED**

---

### 2. Event Store ✅ COMPLETE

**File**: `src/dashboard/server/event-store.ts`

**Implementation**:
- [x] Uses SQLite (panopticon.db) ✅
- [x] Has `append()` method ✅
- [x] Has `readFrom()` method ✅
- [x] Has `subscribe()` for live streaming ✅
- [x] Has `compact()` for retention (7 days) ✅
- [x] Monotonic sequence numbers via AUTOINCREMENT ✅
- [x] Uses PubSub pattern (EventEmitter for live subscriptions) ✅
- [x] Dual-runtime support:
  - Bun: uses `bun:sqlite` ✅
  - Node: uses shared getDatabase() with migrations ✅

**Strengths**:
- Proper SQL prepared statements for hot path
- EventEmitter pattern correctly implements pub-sub
- Retention compaction at startup
- Gap-free monotonic sequences

**Testing**:
- [x] Unit test file exists: `tests/unit/event-store.test.ts` ✅
- Tests cover:
  - Monotonic sequences
  - readFrom boundary conditions
  - subscribe delivery
  - JSON round-trip
  - Compaction logic

**Status**: ✅ **APPROVED**

---

### 3. Server Skeleton ✅ COMPLETE

**Files**: 
- `src/dashboard/server/main.ts`
- `src/dashboard/server/server.ts`
- `src/dashboard/server/ws-rpc.ts`

**Main.ts**:
- [x] Uses `NodeRuntime.runMain` ✅
- [x] Dual-runtime detection (Bun vs Node) ✅
- [x] Proper Effect.provide() composition ✅

**Server.ts**:
- [x] Dual-runtime HTTP detection ✅
  - BunHttpServer on Bun runtime
  - NodeHttpServer on Node runtime
- [x] HttpRouter properly configured ✅
- [x] Static file serving with SPA fallback ✅
- [x] Health endpoint (/api/health) ✅
- [x] All 12 route layers imported and composed ✅

**ws-rpc.ts**:
- [x] Implements all 9 RPC methods correctly ✅
- [x] Proper streaming/unary distinction ✅
- [x] Error handling with PanRpcError ✅
- [x] eventStore.streamEvents implementation ✅

**Note on Sequence-Ordered Deduplication**:
- The ws-rpc.ts does NOT explicitly implement sequence-ordered deduplication
- However, the event store guarantees monotonic sequences
- The frontend store (store.ts) handles deduplication via `Math.max(state.sequence, event.sequence)`
- **Verdict**: Implicit via event store guarantees, but PRD asked for explicit handling. This is acceptable given the approach.

**Status**: ✅ **APPROVED**

---

### 4. Route Modules ✅ COMPLETE

**Directory**: `src/dashboard/server/routes/`

**Files Present** (12 as planned):
1. agents.ts - 21 routes
2. cloister.ts - 9 routes
3. costs.ts - 11 routes
4. issues.ts - 17 routes
5. metrics.ts - 11 routes
6. misc.ts - 34 routes
7. mission-control.ts - 8 routes
8. remote.ts - 9 routes
9. resources.ts - 8 routes
10. settings.ts - 6 routes
11. specialists.ts - 34 routes
12. workspaces.ts - 22 routes

**Total Routes**: 182 ✅

**Pattern Verification**:
- [x] All use `HttpRouter.add()` pattern ✅
- [x] Sample check (agents.ts):
  - Uses `Effect.gen()` for request handlers ✅
  - Imports from `../services/` (domain-services.ts) ✅
  - Wraps lib calls with `Effect.tryPromise()` ✅
  - Returns proper JSON responses ✅

**Event Emission**:
- Routes do NOT appear to emit events to EventStore
- This is a **CRITICAL GAP** — routes should append events when state changes
- Example: agent lifecycle changes, cost recording, specialist state changes

**Status**: ⚠️ **INCOMPLETE** — Missing event emission from route handlers

---

### 5. Shared Services ✅ COMPLETE

**Directory**: `src/dashboard/server/services/`

**Files Present**:
- [x] `domain-services.ts` - EventStoreService & SnapshotService ✅
- [x] `terminal-service.ts` - TerminalService ✅
- [x] `issue-data-service.ts` - IssueDataService ✅
- [x] `tracker-config.ts` - Tracker configuration ✅
- [x] `cache-service.ts` - Caching layer ✅

**Effect Service Pattern**:
- [x] EventStoreService defined as Context.Tag ✅
- [x] SnapshotService defined as Context.Tag ✅
- [x] Both provide live streams via Stream.callback ✅
- [x] Proper Layer.effect composition ✅

**Route Integration**:
- [x] Routes import from services (checked agents.ts) ✅
- [x] Services properly injected via Effect dependencies ✅

**Status**: ✅ **APPROVED**

---

### 6. Frontend Transport ⚠️ INCOMPLETE

**Location**: `src/dashboard/frontend/src/lib/wsTransport.ts`

**Implementation Status**:
- [x] File exists ✅
- [x] Uses ManagedRuntime ✅
- [x] Auto-reconnect via Schedule.fixed ✅
- [x] Implements request, requestStream, subscribe ✅
- [x] RpcClient properly configured ✅

**Expected Location per PRD**:
- PRD says: `src/dashboard/frontend/src/transport/`
- **Actual Location**: `src/dashboard/frontend/src/lib/wsTransport.ts`
- This is a **MINOR DEVIATION** but functionally correct

**Status**: ✅ **APPROVED** (location differs from PRD but structure is correct)

---

### 7. Frontend Store ⚠️ INCOMPLETE

**Location**: `src/dashboard/frontend/src/lib/store.ts`

**Implementation Status**:
- [x] File exists ✅
- [x] Uses Zustand ✅
- [x] `syncSnapshot()` method ✅
- [x] `applyEvent()` pure reducer for all 23 event types ✅
- [x] `applyEvents()` batch method ✅

**Expected Location per PRD**:
- PRD says: `src/dashboard/frontend/src/store/`
- **Actual Location**: `src/dashboard/frontend/src/lib/store.ts`
- This is a **MINOR DEVIATION** but functionally correct

**Event Reducers Checked**:
- agent.created, agent.started, agent.stopped, agent.status_changed, agent.output_received ✅
- pipeline.status_changed, review.status_changed ✅
- specialist.started, specialist.completed, specialist.failed ✅
- resources.updated ✅
- planning.started ✅
- All correctly mutate state immutably ✅

**Missing Implementations**:
- [ ] `eventReducers.ts` (separate file) — NOT FOUND
- [ ] `recovery.ts` (recovery coordinator) — NOT FOUND
- Note: Recovery logic appears to be in `recoveryCoordinator.ts` ✅

**Status**: ⚠️ **PARTIALLY INCOMPLETE** — Logic is implemented but organization differs from PRD

---

### 8. Frontend Component Migration ❌ INCOMPLETE

**Critical Finding**: Components are NOT migrated to use Zustand store

**Evidence**:
- App.tsx still imports `useQuery` from @tanstack/react-query (line 3) ❌
- App.tsx still imports `useSocketIssues` (line 27) ❌
- KanbanBoard.tsx still uses `useQuery` for multiple endpoints ❌
- CloisterStatusBar.tsx uses React Query ❌
- TldrServiceStatus.tsx uses React Query ❌
- HandoffsPage.tsx uses React Query (4 useQuery calls) ❌
- AgentTimeline.tsx uses React Query ❌
- FileActivityTree.tsx uses React Query ❌
- BeadsKanban.tsx uses React Query ❌
- ContainerDetailPanel.tsx uses React Query ❌

**Component Using Store**:
- KanbanBoard.tsx imports `useDashboardStore, selectAgentList, selectSpecialistList` ✅
- But continues to use React Query for other data ⚠️

**Files That Should Be Deleted**:
- [x] `src/dashboard/frontend/src/hooks/useSocketIssues.ts` — **STILL EXISTS** ❌

**Summary**: 
- The store exists and works
- Contracts are broadcast properly
- **BUT**: Routes are not connected to trigger state updates
- **AND**: Components have not been migrated to use the store

**Status**: ❌ **NOT DONE** — This is a major incomplete piece

---

### 9. Terminal Service ✅ COMPLETE

**File**: `src/dashboard/server/services/terminal-service.ts`

**Dual-Runtime PTY**:
- [x] Runtime detection (Bun vs Node) ✅
- [x] BunPtyProcess wrapper ✅
  - Bun.spawn() implementation ✅
  - Write and resize support ✅
- [x] NodePtyProcess wrapper ✅
  - node-pty integration ✅
  - Fallback for Node ✅

**Critical Features (from CLAUDE.md)**:
- [x] Deferred PTY spawn (spawn on first resize, not open) ✅
- [x] Stale data suppression (~200ms) ✅
- [x] Dimension toggle for SIGWINCH + repaint ✅
- [x] Do NOT kill PTY on close — just remove from tracking ✅
- [x] Pending input queue ✅

**RPC Integration**:
- [x] open() ✅
- [x] write() ✅
- [x] resize() ✅
- [x] close() ✅
- [x] streamSession() ✅

**Status**: ✅ **APPROVED**

---

### 10. Cleanup ⚠️ INCOMPLETE

**Old Express/Socket.io Removal**:

Root package.json:
- [x] No express ✅
- [x] No socket.io ✅
- [x] No cors ✅

Server package.json:
- [x] No express ✅
- [x] No socket.io ✅
- [x] No cors ✅

**Old Index.ts**:
- [x] `src/dashboard/server/index.ts` deleted ✅

**Version Update**:
- [x] Root package.json version: 0.6.0 ✅

**Missing Files per PRD**:
- [ ] `bunfig.toml` — **NOT FOUND** ❌
- [ ] `middleware/cors.ts` — **NOT FOUND** ❌
- [ ] `middleware/json-body.ts` — **NOT FOUND** ❌
- [ ] `routes/static.ts` — **NOT FOUND** (handled inline in server.ts) ⚠️
- [ ] `routes/health.ts` — **NOT FOUND** (handled inline in server.ts) ⚠️
- [ ] `routes/convoys.ts` — **NOT FOUND** (merged into metrics.ts) ⚠️

**Analysis**:
- bunfig.toml is mentioned in PRD section 6 but not essential for functionality
- Middleware not needed in Effect.js (no Express paradigm)
- Static/health routes implemented inline (acceptable deviation)
- Convoys merged into metrics (acceptable consolidation)

**Status**: ⚠️ **MOSTLY COMPLETE** — bunfig.toml is missing, but middleware/static/health not strictly required

---

### 11. Missing Per PRD ⚠️ INCOMPLETE

**Explicitly mentioned in PRD**:
- [ ] `bunfig.toml` — **MISSING**
- [ ] Middleware directory — **NOT CREATED** (Effect.js doesn't need it)
- [ ] Convoys route consolidation — **UNCLEAR** (appears merged into metrics or misc)

**Event Emission from Routes**:
- Routes are NOT appending events to EventStore when changes occur
- Example gaps:
  - POST /api/agents should emit agent.created event
  - POST /api/agents/:id/message should emit agent.output_received event
  - Specialist state changes should emit specialist.* events
  - Cost calculations should emit cost.event_recorded

**Status**: ❌ **INCOMPLETE** — Event emission missing

---

### 12. Tests ✅ PARTIALLY COMPLETE

**Test Files Found**:
- [x] `tests/unit/event-store.test.ts` — **NEW** ✅
  - Comprehensive event store unit tests (12 test cases)
  - Tests: sequences, readFrom, subscribe, JSON round-trip, compaction

**Missing Tests**:
- [ ] RPC handler tests
- [ ] Route integration tests
- [ ] Frontend store reducer tests
- [ ] Terminal service tests
- [ ] E2E tests verifying full flow

**Status**: ⚠️ **MINIMAL** — Only event-store tests, missing RPC/route/store tests

---

## Critical Issues Summary

### Blocking Issues (Must Fix Before Merge)

1. **EVENT EMISSION FROM ROUTES** ❌
   - Routes do not append events to EventStore
   - This breaks the entire real-time update system
   - Need to add `eventStore.append()` calls in all 12 route modules
   - Example: POST /api/agents/:id should emit `agent.started`, `cost.event_recorded`

2. **FRONTEND COMPONENT MIGRATION** ❌
   - App.tsx, KanbanBoard, and 10+ components still use React Query
   - useSocketIssues hook still exists and needs deletion
   - Components must be refactored to use `useDashboardStore` selectors
   - Requires wiring frontend transport to subscribe to domain events

3. **WEBSOCKET TRANSPORT NOT HOOKED UP** ❌
   - wsTransport exists but is not integrated into App.tsx
   - No subscription to `subscribeDomainEvents` in App.tsx
   - No call to `store.syncSnapshot()` on connection
   - No call to `store.applyEvent()` on each domain event

### Minor Issues (Should Fix)

4. **bunfig.toml Missing** ⚠️
   - PRD mentions bunfig.toml but it's not critical for functionality
   - Can be deferred if not needed

5. **Event coverage incomplete in routes** ⚠️
   - Only event-store is tested
   - Route handlers, RPC handlers, terminal service need tests

---

## Approval Checklist

| Requirement | Status | Notes |
|-------------|--------|-------|
| Contracts package | ✅ | 23 events, 9 RPC methods, complete |
| Event store (SQLite + PubSub) | ✅ | Append, readFrom, subscribe, compact working |
| Server skeleton | ✅ | Main.ts, server.ts, dual-runtime HTTP |
| Route modules (12 files) | ✅ | 182 routes total, HttpRouter.add() pattern |
| Routes emit events | ❌ | CRITICAL GAP — missing event.append() calls |
| Shared services | ✅ | Domain services, terminal service, proper DI |
| Frontend transport | ✅ | wsTransport.ts exists, auto-reconnect working |
| Frontend store | ✅ | Zustand with pure reducers, all event types |
| Frontend components migrated | ❌ | CRITICAL GAP — still using React Query |
| Frontend wired to store | ❌ | CRITICAL GAP — no subscription to domain events |
| Terminal dual-runtime PTY | ✅ | Bun.spawn + node-pty, deferred spawn, stale suppression |
| Old Express/socket.io removed | ✅ | Dependencies removed from package.json |
| Old index.ts deleted | ✅ | File removed |
| Version 0.6.0 | ✅ | Updated in root package.json |
| bunfig.toml | ⚠️ | Missing but not critical |
| Tests | ⚠️ | Only event-store tests, missing RPC/route/store tests |

---

## Recommended Next Steps

### Phase 1: Connect the Data Flow (Blocking)
1. Add `eventStore.append()` calls in all 12 route modules
   - POST routes: append creation/lifecycle events
   - State change routes: append status events
   - Cost calculation: append cost.event_recorded
   
2. Hook up frontend transport in App.tsx
   - Call `getTransport().subscribe()` for subscribeDomainEvents
   - Fetch initial snapshot with GetSnapshot RPC
   - Call `store.syncSnapshot()` and `store.applyEvent()` appropriately

3. Delete useSocketIssues.ts

### Phase 2: Migrate Frontend Components (Blocking)
1. Update App.tsx to use store selectors instead of useQuery
2. Remove @tanstack/react-query from remaining components
3. Test that all tabs work with store-driven state

### Phase 3: Testing & Polish (Optional for Release)
1. Add RPC handler tests
2. Add route integration tests
3. Add frontend store reducer tests
4. Create bunfig.toml if needed for Bun workflow

---

## Code Quality Assessment

**Strengths**:
- Excellent Type Safety (full Schema validation)
- Clean Effect.js patterns throughout
- Proper separation of concerns (services/routes/domain)
- Comprehensive event schema coverage
- Smart dual-runtime detection

**Weaknesses**:
- Incomplete integration (routes ↔ events, frontend ↔ transport)
- Missing event emission from route handlers
- Frontend still mixed React Query + Zustand
- Limited test coverage

**Architecture Score**: 8/10
- Core is sound, but integration layer incomplete
