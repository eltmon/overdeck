# PAN-428: Full Effect.js Migration — Dashboard Server + Data Layer

## Problem

The Panopticon dashboard takes 5-20+ seconds to open a workspace detail panel. Root cause: **80+ HTTP requests/minute** from aggressive, duplicated polling saturates the browser's 6-connection HTTP/1.1 limit through Traefik.

Additionally, the server is a single 15,777-line Express file (`src/dashboard/server/index.ts`) with 185 routes, making it unmaintainable. Two paradigms (Express + socket.io) coexist poorly. The `execSync` class of bugs (PAN-70/72/205/425) keeps recurring because the Express model doesn't prevent blocking calls.

## Decision

**Go full Effect.js.** Replace Express and socket.io entirely with Effect's HTTP server + WebSocket RPC. Single paradigm, single error model. Modeled on T3Code's production architecture (`/home/eltmon/Projects/t3code`).

This work will be parallelized across multiple Panopticon agents.

---

## Reference Implementation

T3Code source: `/home/eltmon/Projects/t3code`

| T3Code File | Pattern | We Adapt For |
|-------------|---------|--------------|
| `apps/server/src/server.ts` | Layer composition, `HttpRouter.serve()` | Server assembly |
| `apps/server/src/ws.ts` | `WsRpcGroup.toLayer()`, streaming subscriptions | Real-time data |
| `apps/server/src/http.ts` | `HttpRouter.add()` route handlers | REST-like routes |
| `apps/web/src/wsTransport.ts` | `ManagedRuntime`, auto-reconnect subscriptions | Client transport |
| `apps/web/src/store.ts` | Zustand + `applyDomainEvent()` pure reducers | Client state |
| `apps/web/src/routes/__root.tsx` | Recovery coordinator, event coalescing | Reconnection |
| `packages/contracts/src/rpc.ts` | `Rpc.make()` with Schema validation | Shared contracts |

**Effect imports (from T3Code — pin to same version `4.0.0-beta.43`):**
```typescript
import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { Effect, Layer, Stream, PubSub, Queue, Ref, Schema, Scope, Context } from "effect";
import * as Rpc from "effect/Rpc";
import * as RpcGroup from "effect/RpcGroup";
import * as RpcClient from "effect/RpcClient";
import * as RpcServer from "effect/RpcServer";
import * as RpcSerialization from "effect/RpcSerialization";
import * as Socket from "effect/Socket";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeHttp from "node:http";
```

---

## Work Decomposition — Dependency DAG

```
                    ┌─────────────┐
                    │   B1: Deps  │  npm install effect, @effect/platform-node, zustand
                    │  + Contracts│  Create src/shared/contracts/{events,rpc,types}.ts
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
      ┌──────────┐  ┌───────────┐  ┌───────────────┐
      │B2: Event │  │B3: Config │  │B4: Frontend   │
      │  Store   │  │  Service  │  │  Transport +  │
      │          │  │           │  │  Store + Rcvry │
      └────┬─────┘  └─────┬─────┘  └───────┬───────┘
           │              │                 │
           ▼              ▼                 │ (can start after B1)
      ┌────────────────────────┐            │
      │ B5: Server Skeleton    │            │
      │ main.ts, server.ts,   │            │
      │ ws-rpc.ts, static.ts, │            │
      │ middleware, health     │            │
      └────────────┬───────────┘            │
                   │                        │
    ┌──────────────┼──────────────┐         │
    ▼              ▼              ▼         │
┌────────┐  ┌──────────┐  ┌──────────┐    │
│B6-B17: │  │B6-B17:   │  │B6-B17:   │    │
│Route   │  │Route     │  │Route     │    │
│Module 1│  │Module 2  │  │Module N  │    │
│(issues)│  │(agents)  │  │(misc)    │    │
└───┬────┘  └────┬─────┘  └────┬─────┘    │
    │            │              │           │
    ▼            ▼              ▼           ▼
┌──────────────────────────────────────────────┐
│ B18: Integration — wire all route layers     │
│ into server.ts, update esbuild, smoke test   │
└──────────────────────┬───────────────────────┘
                       │
              ┌────────┼────────┐
              ▼                 ▼
    ┌──────────────┐  ┌──────────────────┐
    │B19: Frontend │  │B20: Terminal     │
    │ Component    │  │ Streaming RPC    │
    │ Migration    │  │ (node-pty)       │
    └──────┬───────┘  └────────┬─────────┘
           │                   │
           ▼                   ▼
    ┌──────────────────────────────────┐
    │ B21: Cleanup — delete index.ts,  │
    │ remove Express/socket.io deps,   │
    │ Playwright verification          │
    └──────────────────────────────────┘
```

**Parallelism opportunities:**
- B2, B3, B4 can all run in parallel (after B1)
- B6–B17 (12 route modules) can ALL run in parallel (after B5)
- B4 (frontend transport/store) can run in parallel with B5–B17 (only needs contracts from B1)
- B19 and B20 can run in parallel (after B18)

---

## Critical Rules for Agents

### 1. Do NOT rewrite `src/lib/*` modules

The existing library code (`src/lib/agents.ts`, `src/lib/cloister/*.ts`, `src/lib/costs/*.ts`, etc.) stays as-is. These are plain TypeScript modules with async functions. Route handlers wrap calls to them:

```typescript
// CORRECT — wrap existing async code in Effect
const result = yield* Effect.tryPromise({
  try: () => deepWipeAgent(issueId, { deleteWorkspace: true }),
  catch: (err) => new DeepWipeError({ message: String(err) }),
});

// WRONG — don't rewrite the library function itself
```

The only lib files that get modified are the ones that need to emit events (they gain an `eventStore.append()` call).

### 2. Do NOT modify `server.ts` from route modules

Each route module exports a `Layer`. The integration bead (B18) wires them together. Route agents create their file and ONLY their file:

```typescript
// routes/issues.ts — Agent creates this file
export const issueRoutes = Layer.mergeAll(getIssues, createIssue, deepWipe, /* ... */);

// server.ts — Only B18 (integration bead) modifies this
export const makeRoutesLayer = Layer.mergeAll(
  issueRoutes, agentRoutes, workspaceRoutes, /* ... all route layers */
);
```

### 3. Preserve exact API contracts

Every route must return the SAME response shape as the current Express route. The frontend depends on these shapes. Don't rename fields, don't change status codes, don't change URL patterns. The frontend migration (B19) handles changing how the frontend consumes data.

### 4. Socket.io → EventStore mapping

Where current code does `socketIo.emit('event-name', data)`, the new code does `yield* eventStore.append({ type: 'event.name', payload: data })`. The event store's PubSub delivers to the WebSocket RPC stream subscribers. Map:

| Old socket.io event | New domain event type |
|---------------------|----------------------|
| `agents:changed` | `agent.started` / `agent.stopped` |
| `pipeline:status` | `pipeline.review-completed` / `pipeline.test-completed` |
| `planning:started` | `planning.started` |
| `planning:failed` | `planning.failed` |
| `merge:ready` | `pipeline.merge-ready` |
| `resources:updated` | `workspace.containers-ready` |
| `plan:item-status-changed` | `bead.status-changed` |
| `godview:agent-output` | delivered via `subscribeAgentOutput` RPC stream |
| `godview:status-change` | `agent.started` / `agent.stopped` (same events) |
| `shadow:inference-update` | `issue.shadow-updated` |

### 5. Background processes become Effect fibers

The current server has background processes started in `startServer()`:
- `IssueDataService` — polls Linear/GitHub every 5-60s
- `DockerStatsCollector` — polls Docker every 5s
- `Deacon` — patrol cycle every 60s
- `Cloister` — specialist watchdog

In the Effect model, these become long-running fibers started as `Layer.effectDiscard`:

```typescript
const IssuePollerLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const issueService = yield* IssueDataService;
    const eventStore = yield* EventStore;
    // Poll loop as Effect fiber
    yield* Effect.forever(
      Effect.gen(function* () {
        const changes = yield* issueService.poll();
        for (const change of changes) {
          yield* eventStore.append(change);
        }
        yield* Effect.sleep("30 seconds");
      })
    ).pipe(Effect.fork); // Fork as background fiber
  })
);
```

### 6. Effect service pattern for injecting existing modules

Existing modules become Effect services via `Context.Tag`:

```typescript
// services/agent-manager.ts
import * as agentsLib from '../../lib/agents.js';

export class AgentManager extends Context.Tag("AgentManager")<
  AgentManager,
  {
    readonly startAgent: (issueId: string, opts: StartAgentOpts) => Effect.Effect<void, AgentError>;
    readonly stopAgent: (agentId: string) => Effect.Effect<void, AgentError>;
    readonly deepWipe: (issueId: string, opts: WipeOpts) => Effect.Effect<CleanupLog, AgentError>;
    readonly listAgents: () => Effect.Effect<Agent[], never>;
  }
>() {}

export const AgentManagerLive = Layer.succeed(AgentManager, {
  startAgent: (issueId, opts) => Effect.tryPromise(() => agentsLib.startAgent(issueId, opts)),
  stopAgent: (agentId) => Effect.tryPromise(() => agentsLib.stopAgent(agentId)),
  deepWipe: (issueId, opts) => Effect.tryPromise(() => agentsLib.deepWipe(issueId, opts)),
  listAgents: () => Effect.tryPromise(() => agentsLib.listAgents()),
});
```

---

## Bead Specifications

### B1: Dependencies + Shared Contracts

**Creates:**
- `src/shared/contracts/events.ts` — All domain event Schema definitions (~25 event types)
- `src/shared/contracts/rpc.ts` — RPC method + group definitions (6 streaming + 3 unary + 3 command)
- `src/shared/contracts/types.ts` — Issue, Agent, Specialist, Workspace, Cost schemas
- `src/shared/contracts/index.ts` — Re-exports

**Modifies:**
- `package.json` — Add `effect@4.0.0-beta.43`, `@effect/platform-node@4.0.0-beta.43`
- `src/dashboard/frontend/package.json` — Add `effect@4.0.0-beta.43`, `zustand@^5`
- `tsconfig.json` — Ensure `src/shared/` is included in compilation

**Blocks:** B2, B3, B4, B5

**Reference:** T3Code `packages/contracts/src/rpc.ts`, `packages/contracts/src/orchestration.ts`

**Acceptance criteria:**
- [ ] `npm install` succeeds
- [ ] `tsc --noEmit` on contracts compiles
- [ ] Event schemas cover all 13 current socket.io events
- [ ] RPC group includes all methods from the RPC Methods section below

---

### B2: Event Store

**Creates:**
- `src/dashboard/server/event-store.ts`

**Design:**
- SQLite-backed append-only event store (use `better-sqlite3`, already a transitive dep)
- In-memory `PubSub<DomainEvent>` for live streaming
- Monotonic sequence counter (loaded from DB max on startup)
- Methods: `append()`, `readFrom(sequence)`, `liveStream`, `getLatestSequence()`
- DB schema: single table `events (sequence INTEGER PRIMARY KEY, type TEXT, timestamp TEXT, payload JSON)`
- DB location: `~/.panopticon/dashboard-events.db`

**Blocks:** B5

**Reference:** T3Code `apps/server/src/orchestration/Layers/OrchestrationEngine.ts` (PubSub pattern)

**Acceptance criteria:**
- [ ] Events persist across server restarts
- [ ] `readFrom(N)` returns only events with sequence > N
- [ ] `liveStream` delivers events in real-time
- [ ] Sequence numbers are gap-free and monotonic
- [ ] Unit tests for append, read, stream, restart recovery

---

### B3: ServerConfig Service

**Creates:**
- `src/dashboard/server/config.ts`

**Design:**
- Effect service that loads env vars (from `~/.panopticon.env`), projects.yaml, and CLI flags
- Provides: port, staticDir, Linear API key, GitHub token, GitHub repos, project configs
- Replaces the inline env loading at the top of current `index.ts`

**Blocks:** B5

**Acceptance criteria:**
- [ ] All env vars currently used by index.ts are accessible via `yield* ServerConfig`
- [ ] Missing required vars produce typed errors

---

### B4: Frontend Transport + Store + Recovery

**Creates:**
- `src/dashboard/frontend/src/transport/protocol.ts` — `createWsRpcProtocolLayer(url)`
- `src/dashboard/frontend/src/transport/wsTransport.ts` — `WsTransport` class with `request()`, `requestStream()`, `subscribe()`
- `src/dashboard/frontend/src/transport/rpcClient.ts` — Typed `PanRpcClient` wrapping transport
- `src/dashboard/frontend/src/store/store.ts` — Zustand `DashboardState` + `applyDomainEvent`
- `src/dashboard/frontend/src/store/selectors.ts` — All selectors (see list below)
- `src/dashboard/frontend/src/store/eventReducers.ts` — Pure `switch` reducer per event type
- `src/dashboard/frontend/src/store/recovery.ts` — Sequence-based recovery coordinator
- `src/dashboard/frontend/src/components/EventRouter.tsx` — Root subscriber component

**Selectors needed:**
```typescript
selectAllIssues(state)                              // full list
selectIssuesByCycle(cycle, includeCompleted)(state)  // kanban filter
selectIssueByIdentifier(id)(state)                   // detail panel
selectAgents(state)                                  // all agents
selectAgentForIssue(issueId)(state)                  // detail panel
selectSpecialists(state)                             // cloister bar
selectCostForIssue(issueId)(state)                   // cost badge
selectIsBootstrapped(state)                          // loading state
```

**Can run in parallel with:** B2, B3, B5, B6–B17 (only depends on B1 contracts)

**Reference files (copy and adapt):**
- `WsTransport`: T3Code `apps/web/src/wsTransport.ts` (131 lines)
- `store.ts`: T3Code `apps/web/src/store.ts` (state shape + reducers)
- `recovery.ts`: T3Code `apps/web/src/orchestrationRecovery.ts` (137 lines)
- `EventRouter.tsx`: T3Code `apps/web/src/routes/__root.tsx` lines 194-524

**Acceptance criteria:**
- [ ] WsTransport connects to `/ws/rpc` and auto-reconnects
- [ ] Store receives snapshot on connect, applies events incrementally
- [ ] Recovery coordinator detects sequence gaps and replays
- [ ] Event coalescing batches rapid events via `queueMicrotask`
- [ ] Selectors return correct filtered views
- [ ] Unit tests for every event reducer and selector

---

### B5: Server Skeleton

**Creates:**
- `src/dashboard/server/main.ts` — Entry: Layer composition + `NodeRuntime.runMain`
- `src/dashboard/server/server.ts` — `makeServerLayer`, `makeRoutesLayer` assembly
- `src/dashboard/server/ws-rpc.ts` — RPC handlers: `getSnapshot`, `subscribeDomainEvents`, `replayEvents`
- `src/dashboard/server/routes/static.ts` — Static file serving (Vite build output)
- `src/dashboard/server/routes/health.ts` — `/api/health`, `/api/version`
- `src/dashboard/server/middleware/cors.ts` — CORS middleware
- `src/dashboard/server/middleware/json-body.ts` — JSON body parsing middleware

**Design for `server.ts`:**
```typescript
// Follows T3Code apps/server/src/server.ts pattern
export const makeRoutesLayer = Layer.mergeAll(
  healthRoutes,
  staticRoutes,
  // Route modules added by B18 integration bead
);

export const makeServerLayer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const httpListeningLayer = Layer.effectDiscard(
      Effect.log(`Panopticon API server running on http://0.0.0.0:${config.port}`)
    );
    return Layer.mergeAll(
      HttpRouter.serve(makeRoutesLayer),
      httpListeningLayer,
    ).pipe(
      Layer.provideMerge(rpcLayer),      // WebSocket RPC
      Layer.provideMerge(EventStoreLive),
      Layer.provideMerge(ServerConfigLive),
      Layer.provideMerge(NodeHttpServer.layer(NodeHttp.createServer, { port: config.port })),
    );
  })
);
```

**Design for `ws-rpc.ts`:**
Implements `subscribeDomainEvents` with T3Code's sequence-ordered deduplication pattern (see ws.ts lines 134-190). Also implements `getSnapshot` (returns current issue/agent/specialist state) and `replayEvents` (reads from event store).

**Blocks:** B6–B17 (route modules need the server skeleton to exist)

**Acceptance criteria:**
- [ ] `node dist/dashboard/server.js` starts and listens on port 3011
- [ ] `curl http://localhost:3011/api/health` returns `{ status: "ok" }`
- [ ] Frontend static files served at `/`
- [ ] WebSocket connects at `/ws/rpc`
- [ ] `subscribeDomainEvents` streams events to connected clients
- [ ] `getSnapshot` returns current state
- [ ] CORS headers present on API responses

---

### B6–B17: Route Modules (12 beads, ALL parallel)

Each bead creates ONE route file. Pattern:

```typescript
// src/dashboard/server/routes/{category}.ts
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

// GET /api/{category}
const list = HttpRouter.add("GET", "/api/{category}",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    // ... existing logic wrapped in Effect.tryPromise
    return HttpServerResponse.json(result);
  }).pipe(Effect.catchAll(/* error handling */))
);

// POST /api/{category}/:id/action
const action = HttpRouter.add("POST", "/api/{category}/:id/action",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const params = HttpServerRequest.params(request);
    const body = yield* HttpServerRequest.bodyJson(request);
    // ... existing logic
    return HttpServerResponse.json(result);
  }).pipe(Effect.catchAll(/* error handling */))
);

export const {category}Routes = Layer.mergeAll(list, action, /* ... */);
```

**Each agent MUST:**
1. Read ALL Express routes for their category from `src/dashboard/server/index.ts` using `grep '/api/{category}` to find every route
2. Create the new route file at `src/dashboard/server/routes/{category}.ts`
3. Convert each Express route to an `HttpRouter.add()` call
4. Wrap existing async logic in `Effect.tryPromise()` — do NOT rewrite business logic
5. Replace `socketIo.emit(...)` calls with `yield* eventStore.append(...)` using the mapping table above
6. Replace `execSync` calls with `yield* Effect.tryPromise(() => execAsync(...))` 
7. Export a single `{category}Routes` Layer that merges all routes
8. **Do NOT import or modify `server.ts`** — that's B18's job
9. For routes that need services, use `yield* ServiceTag` pattern (services defined in B5 or created inline)

**Bead assignments:**

| Bead | File | Routes | How to find them |
|------|------|--------|------------------|
| B6 | `routes/issues.ts` | 17 | `grep "app\.\(get\|post\|put\|delete\)('/api/issues" src/dashboard/server/index.ts` |
| B7 | `routes/agents.ts` | 20 | `grep "app\.\(get\|post\|put\|delete\)('/api/agents" src/dashboard/server/index.ts` |
| B8 | `routes/workspaces.ts` | 19 | `grep "app\.\(get\|post\|put\|delete\)('/api/workspaces" src/dashboard/server/index.ts` |
| B9 | `routes/specialists.ts` | 33 | `grep "app\.\(get\|post\|put\|delete\)('/api/specialists" src/dashboard/server/index.ts` |
| B10 | `routes/costs.ts` | 11 | `grep "app\.\(get\|post\|put\|delete\)('/api/costs" src/dashboard/server/index.ts` |
| B11 | `routes/cloister.ts` | 9 | `grep "app\.\(get\|post\|put\|delete\)('/api/cloister" src/dashboard/server/index.ts` |
| B12 | `routes/resources.ts` | 8 | `grep "app\.\(get\|post\|put\|delete\)('/api/resources" src/dashboard/server/index.ts` |
| B13 | `routes/mission-control.ts` | 7 | `grep "app\.\(get\|post\|put\|delete\)('/api/mission-control" src/dashboard/server/index.ts` |
| B14 | `routes/remote.ts` | 9 | `grep "app\.\(get\|post\|put\|delete\)('/api/remote" src/dashboard/server/index.ts` |
| B15 | `routes/settings.ts` | 6 | `grep "app\.\(get\|post\|put\|delete\)('/api/settings" src/dashboard/server/index.ts` |
| B16 | `routes/metrics.ts` + `routes/convoys.ts` | 11 | `grep "app\.\(get\|post\|put\|delete\)('/api/\(metrics\|convoys\)" src/dashboard/server/index.ts` |
| B17 | `routes/misc.ts` | 35 | All remaining routes not covered by B6–B16 (activity, confirmations, tracker-status, handoffs, shadow, planning, deacon, skills, version, godview, rally, project-mappings, services, registered-projects, cache-status) |

---

### B18: Integration + Build

**Modifies:**
- `src/dashboard/server/server.ts` — Add all 12+ route layers to `makeRoutesLayer`
- `esbuild.config.mjs` — Entry point to `src/dashboard/server/main.ts`
- `package.json` scripts — `build:dashboard:server` targets new entry

**Creates:**
- `src/dashboard/server/services/` — Any Effect service wrappers needed by multiple route modules (AgentManager, WorkspaceManager, etc.)

**Does:**
- Wire all `B6–B17` route layers into `server.ts` `makeRoutesLayer`
- Wire background fibers (IssuePoller, Deacon, DockerStats, Cloister)
- Run full test suite — all existing tests must pass
- Smoke test: start server, verify all endpoints return same responses as before

**Blocks:** B19, B20

**Acceptance criteria:**
- [ ] `npm run build` succeeds
- [ ] `npm test -- --run` all pass
- [ ] Server starts and all 185 routes respond correctly
- [ ] WebSocket RPC streams events
- [ ] Old `index.ts` is no longer the entry point

---

### B19: Frontend Component Migration

**Modifies:**
- `frontend/src/App.tsx` — Remove React Query issues/agents polling, add EventRouter
- `frontend/src/components/KanbanBoard.tsx` — Replace `useQuery(['issues', ...])` with `useStore(selectIssuesByCycle(cycle))`
- `frontend/src/components/InspectorPanel.tsx` — Replace 5 polling queries with store selectors + single `getWorkspaceDetail` RPC
- `frontend/src/components/search/SearchModal.tsx` — Replace independent issue fetch with store selector
- `frontend/src/components/AgentList.tsx` — Replace 3-5s agent polling with store selector
- `frontend/src/components/CloisterStatusBar.tsx` — Replace specialist/cloister polling with store selector
- `frontend/src/components/MetricsSummaryRow.tsx` — Derive metrics from store

**Deletes:**
- `frontend/src/hooks/useSocketIssues.ts` — Replaced by EventRouter

**Acceptance criteria:**
- [ ] KanbanBoard renders from store, zero `/api/issues` HTTP polling
- [ ] Detail panel opens in <1 second (Playwright verified)
- [ ] Total HTTP requests from kanban board: <5/minute
- [ ] Search works from store data
- [ ] All existing frontend tests pass

---

### B20: Terminal Streaming RPC

**Modifies:**
- `src/dashboard/server/ws-rpc.ts` — Add `subscribeTerminal` streaming RPC
- `src/dashboard/frontend/src/components/TerminalPanel.tsx` — Subscribe via RPC stream

**Creates:**
- `src/dashboard/server/services/terminal-service.ts` — Extract node-pty/tmux management from index.ts

**Design:** `subscribeTerminal` takes `{ sessionName, cols, rows }`, spawns `tmux attach-session` via node-pty, streams `TerminalChunk { data: string }` to client. Handles resize messages from client. On WebSocket close, kills PTY (not tmux session).

**Reference:** Current WebSocket terminal code at index.ts lines ~13064-13200

**Acceptance criteria:**
- [ ] Terminal panel shows live agent output via WebSocket RPC
- [ ] Resize works
- [ ] Multiple terminals can be open simultaneously
- [ ] PTY cleanup on disconnect (no leaked processes)

---

### B21: Cleanup + Verification

**Deletes:**
- `src/dashboard/server/index.ts` (the 15,777-line Express file)

**Removes from `package.json`:**
- `express`, `cors`, `socket.io`, `socket.io-client`

**Removes from frontend `package.json`:**
- `socket.io-client` (if present)

**Modifies:**
- `CLAUDE.md` — Update architecture section for Effect.js
- `docs/INDEX.md` — Update references

**Verification (Playwright):**
- [ ] Dashboard loads in <3 seconds
- [ ] Click kanban card → detail panel appears in <1 second
- [ ] Terminal tab shows live output
- [ ] Plan button → planning dialog → agent starts
- [ ] All buttons (Watch, Tasks, Tell, Kill, Wipe, etc.) work
- [ ] HTTP requests/minute from idle board: <5
- [ ] WebSocket connections: exactly 1

---

## Domain Events Catalog

Every event: `{ type: string, sequence: number, timestamp: string, payload: {...} }`

### Issue Events
| Event Type | Emitted When | Payload |
|------------|-------------|---------|
| `issue.updated` | IssueDataService detects change from tracker poll | `{ identifier, changedFields: Record<string, unknown> }` |
| `issue.status-changed` | Status transition (todo→in_progress, etc.) | `{ identifier, from, to }` |
| `issue.labels-changed` | Labels added/removed | `{ identifier, added: string[], removed: string[] }` |
| `issue.shadow-updated` | Shadow state inference changes | `{ identifier, shadowStatus, shadowTrackerStatus }` |

### Agent Events
| Event Type | Emitted When | Payload |
|------------|-------------|---------|
| `agent.started` | Agent tmux session created | `{ agentId, issueId, model, phase, runtime }` |
| `agent.stopped` | Agent exited or killed | `{ agentId, issueId, exitCode? }` |
| `agent.heartbeat` | Stop-hook fires (idle detection) | `{ agentId, state, contextPercent?, lastActivity }` |
| `agent.stuck` | Deacon detects stuck agent | `{ agentId, issueId, stuckDuration }` |

### Pipeline Events
| Event Type | Emitted When | Payload |
|------------|-------------|---------|
| `pipeline.review-started` | Review specialist spawned | `{ issueId, specialistId, project }` |
| `pipeline.review-completed` | Review passes/fails | `{ issueId, result, feedback? }` |
| `pipeline.test-started` | Test specialist spawned | `{ issueId, specialistId, project }` |
| `pipeline.test-completed` | Tests pass/fail | `{ issueId, result, output? }` |
| `pipeline.merge-ready` | All gates passed, waiting for human | `{ issueId }` |
| `pipeline.merged` | Human clicked merge | `{ issueId, branch, project }` |

### Planning Events
| Event Type | Emitted When | Payload |
|------------|-------------|---------|
| `planning.started` | Planning agent launched | `{ issueId, sessionName, location }` |
| `planning.completed` | stop-hook fires complete-planning | `{ issueId, beadCount }` |
| `planning.failed` | Workspace creation or planning fails | `{ issueId, error }` |

### Specialist Events
| Event Type | Emitted When | Payload |
|------------|-------------|---------|
| `specialist.spawned` | Specialist session created | `{ id, type, issueId, project }` |
| `specialist.completed` | Specialist finishes | `{ id, type, issueId, result }` |
| `specialist.handoff` | One specialist hands off to next | `{ fromId, toType, issueId }` |

### Workspace Events
| Event Type | Emitted When | Payload |
|------------|-------------|---------|
| `workspace.created` | `pan workspace create` completes | `{ issueId, path, type }` |
| `workspace.containers-ready` | Docker containers healthy | `{ issueId, containers: string[] }` |
| `workspace.deleted` | Deep-wipe or worktree remove | `{ issueId }` |

### Cost Events
| Event Type | Emitted When | Payload |
|------------|-------------|---------|
| `cost.recorded` | Cost event ingested | `{ issueId, agentId, amount, model }` |

### Bead Events
| Event Type | Emitted When | Payload |
|------------|-------------|---------|
| `bead.status-changed` | Bead transitions state | `{ issueId, beadId, from, to }` |

---

## RPC Methods

### Streaming
| Method | Input | Output | Description |
|--------|-------|--------|-------------|
| `pan.subscribeDomainEvents` | `{}` | `Stream<DomainEvent>` | All events, sequence-ordered, with replay |
| `pan.subscribeTerminal` | `{ sessionName, cols, rows }` | `Stream<TerminalChunk>` | Live PTY output |
| `pan.subscribeAgentOutput` | `{ agentId }` | `Stream<OutputLine>` | Agent log tail |

### Unary
| Method | Input | Output | Description |
|--------|-------|--------|-------------|
| `pan.getSnapshot` | `{}` | `DashboardSnapshot` | Full state for cold start |
| `pan.replayEvents` | `{ fromSequence }` | `DomainEvent[]` | Missed events for recovery |
| `pan.getWorkspaceDetail` | `{ issueId }` | `WorkspaceDetail` | Batched detail panel data |

### Commands
| Method | Input | Output | Description |
|--------|-------|--------|-------------|
| `pan.startPlanning` | `{ issueId, location, shadow? }` | `{ sessionName }` | Launch planning |
| `pan.startAgent` | `{ issueId }` | `{ agentId }` | Launch implementation |
| `pan.deepWipe` | `{ issueId, deleteWorkspace? }` | `{ cleanupLog }` | Wipe workspace |

---

## Effect.js Setup Notes (for agents)

### Dependencies (pin exact versions — match T3Code)
```bash
npm install effect@4.0.0-beta.43 @effect/platform-node@4.0.0-beta.43
cd src/dashboard/frontend && npm install effect@4.0.0-beta.43 zustand@^5
```

### Node.js Compatibility
- We use Node 22, not Bun — use `@effect/platform-node`, not `@effect/platform-bun`
- Effect 4.x HTTP is at `effect/unstable/http` (will stabilize in a future release)
- esbuild bundles Effect fine (standard ESM)
- Our Vitest config needs `maxForks: 4` (CLAUDE.md rule — prevents OOM)

### Route Conversion Cheat Sheet

**Express → Effect mapping:**

| Express | Effect |
|---------|--------|
| `req.params.id` | `HttpServerRequest.params(request).id` |
| `req.query.foo` | `HttpServerRequest.toURL(request)` → `url.searchParams.get('foo')` |
| `req.body` | `yield* HttpServerRequest.bodyJson(request)` |
| `res.json(data)` | `HttpServerResponse.json(data)` |
| `res.status(404).json(...)` | `HttpServerResponse.json(data, { status: 404 })` |
| `res.sendFile(path)` | `yield* HttpServerResponse.file(path)` |
| `try/catch` | `Effect.catchAll()` or `Effect.tryPromise({ try, catch })` |
| `async (req, res) => { }` | `Effect.gen(function* () { })` |
| Global variable access | `yield* ServiceTag` (dependency injection) |

---

## Testing Strategy

1. **Contracts (B1):** Schema encode/decode round-trip for every event and RPC type
2. **Event store (B2):** append, readFrom, liveStream, sequence gaps, restart recovery
3. **Route modules (B6–B17):** For each route, call the Effect handler with mock request and verify response matches current Express behavior. Use `@effect/vitest` or plain Vitest with `Effect.runPromise`.
4. **Recovery coordinator (B4):** Unit test state machine: bootstrap → streaming → gap → replay → streaming
5. **Zustand reducers (B4):** Unit test each event type produces correct state transition
6. **Integration (B21):** Playwright E2E — full flow from board load through card click to terminal view

---

## Acceptance Criteria

| Bead | Metric | Target |
|------|--------|--------|
| B5 | Effect server running, health endpoint | Functional |
| B18 | All 185 routes return correct responses | Zero regressions |
| B18 | All existing tests pass | 223/223 |
| B19 | Detail panel open time | <1 second |
| B19 | HTTP requests/min (kanban board) | <5 (from 80+) |
| B20 | Terminal streams live via RPC | Zero HTTP polling |
| B21 | Express/socket.io removed | Zero deps |
| B21 | `index.ts` deleted | 15,777 lines gone |

---

## Risk

| Risk | Impact | Mitigation |
|------|--------|------------|
| Effect 4.x is beta | API may change | Pin `4.0.0-beta.43` (same as T3Code production) |
| 185 routes to convert | Large scope | 12 parallel agents, each isolated to one file |
| node-pty + Effect WS | Compatibility unknown | Prototype in B20 early, fallback to raw WS |
| Build system (esbuild) | Bundle issues | Test in B5 before parallelizing |
| Merge conflicts | Parallel agents touch same files | Each agent creates ONE file, B18 integrates |
| Frontend React Query removal | State timing | Keep React Query for external data (git), only remove for app state |
