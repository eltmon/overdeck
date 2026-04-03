# PAN-428: Full Effect.js Migration — Dashboard Server + Data Layer

## Problem

The Panopticon dashboard takes 5-20+ seconds to open a workspace detail panel. Root cause: **80+ HTTP requests/minute** from aggressive, duplicated polling saturates the browser's 6-connection HTTP/1.1 limit through Traefik.

Additionally, the server is a single 15,777-line Express file (`src/dashboard/server/index.ts`) with 185 routes, making it unmaintainable. Two paradigms (Express + socket.io) coexist poorly.

## Decision

**Go full Effect.js.** Replace Express and socket.io entirely with Effect's HTTP server + WebSocket RPC. Single paradigm, single error model. Modeled on T3Code's production architecture (`/home/eltmon/Projects/t3code`).

This work will be parallelized across multiple Panopticon agents overnight.

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

**Key Effect imports used by T3Code (from `effect/unstable/http`):**
```typescript
import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { Effect, Layer, Stream, PubSub, Queue, Ref, Schema, Scope } from "effect";
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

## Current Server Inventory

### Route Categories (185 total)

| Category | Count | Key Endpoints |
|----------|-------|---------------|
| specialists | 33 | CRUD, logs, status, handoffs |
| agents | 20 | start, stop, heartbeat, output, deep-wipe |
| workspaces | 19 | create, delete, containers, services, merge |
| issues | 17 | CRUD, status, planning, costs, close/reopen |
| costs | 11 | by-issue, by-agent, reconciliation, archive |
| remote | 9 | Fly.io workspace management |
| cloister | 9 | config, status, pause, specialist pool |
| resources | 8 | Docker stats, container management |
| mission-control | 7 | planning status, feature metadata |
| settings | 6 | config read/write |
| metrics | 6 | summary, daily, performance |
| convoys | 5 | CRUD, status |
| misc | 35 | health, activity, confirmations, skills, etc. |

### Server Dependencies

```
src/dashboard/server/index.ts (15,777 lines)
├── services/issue-data-service.ts (Linear/GitHub polling + cache)
├── services/cache-service.ts
├── services/tracker-config.ts
├── review-status.ts
├── utils/vtt-parser.ts
├── ../../lib/agents.ts
├── ../../lib/cloister/*.ts (8 modules)
├── ../../lib/costs/*.ts (3 modules)
├── ../../lib/convoy.ts
├── ../../lib/docker-stats.ts
├── ../../lib/projects.ts
├── ../../lib/remote/*.ts
├── ../../lib/config.ts
└── ../../lib/paths.ts
```

### Socket.io Events Emitted (13)

```
agents:changed, godview:activity, godview:agent-output,
godview:status-change, merge:ready, pipeline:status,
plan:item-status-changed, plan:items-unblocked, planning:failed,
planning:started, planning:sync, resources:updated,
shadow:inference-update
```

### WebSocket Terminal

Raw WebSocket at `/ws/terminal` using `node-pty` to spawn `tmux attach-session`. This streams terminal output for live agent monitoring. Must be preserved as a streaming RPC method.

## Target Architecture

### Server Module Structure

```
src/dashboard/server/
├── main.ts                          # Entry point: Layer composition + NodeRuntime.runMain
├── server.ts                        # makeServerLayer, makeRoutesLayer assembly
├── config.ts                        # ServerConfig Effect service (reads env, yaml)
├── event-store.ts                   # SQLite append-only event store with PubSub
├── ws-rpc.ts                        # WsRpcGroup.toLayer() — streaming subscriptions
│
├── routes/                          # HTTP routes (one file per domain)
│   ├── issues.ts                    # 17 routes → HttpRouter.Tag("IssueRoutes")
│   ├── agents.ts                    # 20 routes → HttpRouter.Tag("AgentRoutes")
│   ├── workspaces.ts                # 19 routes → HttpRouter.Tag("WorkspaceRoutes")
│   ├── specialists.ts               # 33 routes → HttpRouter.Tag("SpecialistRoutes")
│   ├── costs.ts                     # 11 routes → HttpRouter.Tag("CostRoutes")
│   ├── cloister.ts                  # 9 routes → HttpRouter.Tag("CloisterRoutes")
│   ├── resources.ts                 # 8 routes → HttpRouter.Tag("ResourceRoutes")
│   ├── mission-control.ts           # 7 routes → HttpRouter.Tag("MissionControlRoutes")
│   ├── remote.ts                    # 9 routes → HttpRouter.Tag("RemoteRoutes")
│   ├── settings.ts                  # 6 routes → HttpRouter.Tag("SettingsRoutes")
│   ├── metrics.ts                   # 6 routes → HttpRouter.Tag("MetricsRoutes")
│   ├── convoys.ts                   # 5 routes → HttpRouter.Tag("ConvoyRoutes")
│   ├── health.ts                    # 3 routes → HttpRouter.Tag("HealthRoutes")
│   ├── misc.ts                      # Remaining routes
│   └── static.ts                    # Static file serving (frontend assets)
│
├── services/                        # Effect service layers
│   ├── issue-data-service.ts        # Existing, wrapped as Effect service
│   ├── agent-manager.ts             # Agent lifecycle, extracted from index.ts
│   ├── workspace-manager-service.ts # Workspace ops, extracted from index.ts
│   ├── specialist-service.ts        # Specialist management
│   ├── cost-service.ts              # Cost tracking
│   ├── docker-stats-service.ts      # Container monitoring
│   └── terminal-service.ts          # node-pty terminal management
│
└── middleware/
    ├── cors.ts                      # CORS middleware
    └── json-body.ts                 # JSON body parsing
```

### Shared Contracts

```
src/shared/contracts/
├── events.ts           # All domain event schemas (Schema.Struct)
├── rpc.ts              # RPC method definitions (Rpc.make)
├── types.ts            # Shared types: Issue, Agent, Specialist, etc.
└── index.ts            # Re-exports
```

### Frontend Structure (new files)

```
src/dashboard/frontend/src/
├── transport/
│   ├── wsTransport.ts        # Effect.js WebSocket RPC client
│   ├── rpcClient.ts          # Typed API wrapper (like T3Code's wsRpcClient.ts)
│   └── protocol.ts           # createWsRpcProtocolLayer
│
├── store/
│   ├── store.ts              # Zustand store: DashboardState + applyDomainEvent
│   ├── selectors.ts          # All derived views (by cycle, by identifier, etc.)
│   ├── eventReducers.ts      # Pure functions: event → state transition
│   └── recovery.ts           # Sequence-based recovery coordinator
│
├── components/
│   └── EventRouter.tsx       # Root component: subscribes to events, manages recovery
│
└── hooks/
    └── useStore.ts           # Typed Zustand hooks with selectors
```

## Domain Events Catalog

Every event has: `{ type, sequence, timestamp, payload }`.

### Issue Events
| Event Type | Emitted When | Payload |
|------------|-------------|---------|
| `issue.updated` | IssueDataService detects change from tracker poll | `{ identifier, changedFields }` |
| `issue.status-changed` | Status transition (todo→in_progress, etc.) | `{ identifier, from, to }` |
| `issue.labels-changed` | Labels added/removed | `{ identifier, added[], removed[] }` |
| `issue.shadow-updated` | Shadow state inference changes | `{ identifier, shadowStatus }` |

### Agent Events
| Event Type | Emitted When | Payload |
|------------|-------------|---------|
| `agent.started` | Agent tmux session created | `{ agentId, issueId, model, phase }` |
| `agent.stopped` | Agent exited or killed | `{ agentId, issueId, exitCode }` |
| `agent.heartbeat` | Stop-hook fires (idle detection) | `{ agentId, state, contextPercent }` |
| `agent.stuck` | Deacon detects stuck agent | `{ agentId, issueId, duration }` |

### Pipeline Events
| Event Type | Emitted When | Payload |
|------------|-------------|---------|
| `pipeline.review-started` | Review specialist spawned | `{ issueId, specialistId }` |
| `pipeline.review-completed` | Review passes/fails | `{ issueId, result, feedback? }` |
| `pipeline.test-started` | Test specialist spawned | `{ issueId, specialistId }` |
| `pipeline.test-completed` | Tests pass/fail | `{ issueId, result }` |
| `pipeline.merge-ready` | All gates passed, waiting for human | `{ issueId }` |
| `pipeline.merged` | Human clicked merge | `{ issueId, branch }` |

### Planning Events
| Event Type | Emitted When | Payload |
|------------|-------------|---------|
| `planning.started` | Planning agent launched | `{ issueId, sessionName }` |
| `planning.completed` | stop-hook fires complete-planning | `{ issueId, beadCount }` |
| `planning.failed` | Workspace creation fails | `{ issueId, error }` |

### Specialist Events
| Event Type | Emitted When | Payload |
|------------|-------------|---------|
| `specialist.spawned` | Specialist session created | `{ id, type, issueId, project }` |
| `specialist.completed` | Specialist finishes | `{ id, type, issueId, result }` |
| `specialist.handoff` | One specialist hands off to next | `{ fromId, toId, issueId }` |

### Workspace Events
| Event Type | Emitted When | Payload |
|------------|-------------|---------|
| `workspace.created` | `pan workspace create` completes | `{ issueId, path, type }` |
| `workspace.containers-ready` | Docker containers healthy | `{ issueId, containers[] }` |
| `workspace.deleted` | Deep-wipe or worktree remove | `{ issueId }` |

### Cost Events
| Event Type | Emitted When | Payload |
|------------|-------------|---------|
| `cost.recorded` | Cost event ingested | `{ issueId, agentId, amount, model }` |

## RPC Methods

### Streaming (real-time)
| Method | Contract | Description |
|--------|----------|-------------|
| `pan.subscribeDomainEvents` | `() → Stream<DomainEvent>` | All domain events, sequence-ordered |
| `pan.subscribeTerminal` | `(sessionName) → Stream<TerminalChunk>` | Live terminal output via node-pty |
| `pan.subscribeAgentOutput` | `(agentId) → Stream<OutputLine>` | Agent log tail |

### Unary (request-response)
| Method | Contract | Description |
|--------|----------|-------------|
| `pan.getSnapshot` | `() → DashboardSnapshot` | Full state for cold start |
| `pan.replayEvents` | `(fromSequence) → DomainEvent[]` | Missed events for recovery |
| `pan.getWorkspaceDetail` | `(issueId) → WorkspaceDetail` | Single-call detail panel data |

### Commands (mutations via RPC)
| Method | Contract | Description |
|--------|----------|-------------|
| `pan.startPlanning` | `(issueId, opts) → void` | Launch planning agent |
| `pan.startAgent` | `(issueId) → void` | Launch implementation agent |
| `pan.deepWipe` | `(issueId, opts) → CleanupLog` | Wipe workspace + state |

**Note:** Most mutations (185 Express routes) stay as HTTP routes initially. Only the highest-value ones become RPC methods in Phase 1. Remaining routes migrate to Effect HTTP routes (`HttpRouter.add`) but remain request-response.

## Implementation Phases

### Phase 1: Foundation — Effect Server + Event Store

**Goal:** Effect.js server running alongside (then replacing) Express. Event store operational.

**Files to create:**

| File | What | Lines (est.) | Depends On |
|------|------|-------------|------------|
| `src/shared/contracts/events.ts` | All event Schema definitions | ~200 | nothing |
| `src/shared/contracts/rpc.ts` | RPC method + group definitions | ~100 | events.ts |
| `src/shared/contracts/types.ts` | Issue, Agent, Specialist schemas | ~150 | nothing |
| `src/dashboard/server/event-store.ts` | SQLite event store + PubSub | ~150 | events.ts |
| `src/dashboard/server/config.ts` | ServerConfig Effect service | ~80 | nothing |
| `src/dashboard/server/ws-rpc.ts` | RPC server: getSnapshot, subscribe, replay | ~200 | event-store, rpc.ts |
| `src/dashboard/server/server.ts` | Layer assembly: HTTP + WS + services | ~100 | all above |
| `src/dashboard/server/main.ts` | Entry: `NodeRuntime.runMain` | ~20 | server.ts |
| `src/dashboard/server/middleware/cors.ts` | CORS as Effect middleware | ~20 | nothing |
| `src/dashboard/server/middleware/json-body.ts` | JSON body parser | ~30 | nothing |
| `src/dashboard/server/routes/static.ts` | Static file serving | ~50 | T3Code http.ts |
| `src/dashboard/server/routes/health.ts` | `/api/health`, `/api/version` | ~30 | nothing |

**Files to modify:**

| File | Change |
|------|--------|
| `package.json` | Add `effect`, `@effect/platform-node` |
| `src/dashboard/server/services/issue-data-service.ts` | Emit events to EventStore on change |
| `esbuild.config.mjs` | Update entry point to `main.ts` |

**Validation:** Server starts, WebSocket connects, events flow to a test client.

### Phase 2: Route Migration (Parallelizable — 12 agents)

**Goal:** All 185 Express routes converted to Effect `HttpRouter.add()` handlers.

Each route module is independent and can be worked on by a separate agent. The pattern for each:

```typescript
// src/dashboard/server/routes/issues.ts
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { IssueDataService } from "../services/issue-data-service.js";
import { EventStore } from "../event-store.js";

// GET /api/issues
const getIssues = HttpRouter.add("GET", "/api/issues",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    // ... parse query params from url
    const issueDataService = yield* IssueDataService;
    const issues = yield* issueDataService.getIssues({ cycle, includeCompleted });
    return HttpServerResponse.json(issues);
  })
);

// POST /api/issues/:id/deep-wipe
const deepWipe = HttpRouter.add("POST", "/api/issues/:id/deep-wipe",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = yield* HttpServerRequest.bodyJson(request);
    // ... validation via Schema.decode
    // ... existing deep-wipe logic
    const eventStore = yield* EventStore;
    yield* eventStore.append({ type: "workspace.deleted", payload: { issueId } });
    return HttpServerResponse.json({ success: true, message: "..." });
  })
);

export const issueRoutesLayer = Layer.mergeAll(getIssues, deepWipe, /* ... */);
```

**Agent work assignments (one agent per file):**

| Agent | File | Routes | Source Lines (in index.ts) |
|-------|------|--------|---------------------------|
| Agent 1 | `routes/issues.ts` | 17 | grep `'/api/issues` |
| Agent 2 | `routes/agents.ts` | 20 | grep `'/api/agents` |
| Agent 3 | `routes/workspaces.ts` | 19 | grep `'/api/workspaces` |
| Agent 4 | `routes/specialists.ts` | 33 | grep `'/api/specialists` |
| Agent 5 | `routes/costs.ts` | 11 | grep `'/api/costs` |
| Agent 6 | `routes/cloister.ts` | 9 | grep `'/api/cloister` |
| Agent 7 | `routes/resources.ts` | 8 | grep `'/api/resources` |
| Agent 8 | `routes/mission-control.ts` | 7 | grep `'/api/mission-control` |
| Agent 9 | `routes/remote.ts` | 9 | grep `'/api/remote` |
| Agent 10 | `routes/settings.ts` | 6 | grep `'/api/settings` |
| Agent 11 | `routes/metrics.ts` + `convoys.ts` | 11 | grep `'/api/metrics\|/api/convoys` |
| Agent 12 | `routes/misc.ts` | 35 | everything else |

**Each agent's instructions:**
1. Read the relevant Express routes from `src/dashboard/server/index.ts`
2. Create the new route file using Effect `HttpRouter.add()` pattern
3. Preserve exact API contract (same URLs, same request/response shapes)
4. Inject services via `yield*` (not global imports)
5. Emit domain events to EventStore where appropriate
6. Export a `Layer` that combines all routes
7. Add the layer to `server.ts` `makeRoutesLayer`

### Phase 3: Frontend — Zustand Store + WsTransport

**Goal:** KanbanBoard + detail panel read from Zustand store. Zero HTTP polling for issues/agents.

**Files to create:**

| File | What | Lines (est.) |
|------|------|-------------|
| `frontend/src/transport/protocol.ts` | `createWsRpcProtocolLayer` | ~30 |
| `frontend/src/transport/wsTransport.ts` | `WsTransport` class (from T3Code) | ~130 |
| `frontend/src/transport/rpcClient.ts` | Typed API wrapper | ~100 |
| `frontend/src/store/store.ts` | Zustand store + `applyDomainEvent` | ~300 |
| `frontend/src/store/selectors.ts` | `selectIssuesByCycle`, `selectAgentForIssue`, etc. | ~100 |
| `frontend/src/store/eventReducers.ts` | Pure event→state reducers (one per event type) | ~400 |
| `frontend/src/store/recovery.ts` | Recovery coordinator (from T3Code) | ~140 |
| `frontend/src/components/EventRouter.tsx` | Root: subscribe, coalesce, apply, recover | ~200 |

**Files to modify:**

| File | Change |
|------|--------|
| `package.json` (frontend) | Add `effect`, `zustand` |
| `frontend/src/App.tsx` | Remove React Query issues/agents polling, wrap with EventRouter |
| `frontend/src/components/KanbanBoard.tsx` | Replace `useQuery` with `useStore(selectIssuesByCycle)` |
| `frontend/src/components/InspectorPanel.tsx` | Use store selectors + single `getWorkspaceDetail` RPC |
| `frontend/src/hooks/useSocketIssues.ts` | Remove (replaced by EventRouter) |

### Phase 4: Terminal Streaming

**Goal:** Terminal output streams over WebSocket RPC instead of HTTP polling.

| File | Change |
|------|--------|
| `server/ws-rpc.ts` | Add `subscribeTerminal` RPC using `Stream.callback` + node-pty |
| `server/services/terminal-service.ts` | Extract terminal management from index.ts |
| `frontend/src/components/TerminalPanel.tsx` | Subscribe via RPC stream instead of polling |

### Phase 5: Cleanup + Verification

- [ ] Delete `src/dashboard/server/index.ts` (the 15K-line Express file)
- [ ] Remove Express, socket.io, cors dependencies
- [ ] Remove React Query polling for application state
- [ ] Remove `useSocketIssues.ts`
- [ ] Update `esbuild.config.mjs` for new entry point
- [ ] Playwright verification: detail panel <1s, <5 HTTP req/min
- [ ] Update CLAUDE.md with new architecture notes

## Effect.js Setup Notes (for agents)

### Dependencies
```bash
npm install effect @effect/platform-node
# Frontend
cd src/dashboard/frontend && npm install effect zustand
```

### Node.js Compatibility
- T3Code uses `@effect/platform-node` for Node.js (not Bun-only)
- Effect 4.x HTTP is at `effect/unstable/http` (will stabilize)
- Our Node 22 is fully supported
- esbuild bundles Effect fine (it's standard ESM)

### Route Conversion Pattern

**Express (before):**
```typescript
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/agents/:id/deep-wipe', async (req, res) => {
  const { id } = req.params;
  const { deleteWorkspace } = req.body;
  try {
    const result = await deepWipeAgent(id, deleteWorkspace);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

**Effect (after):**
```typescript
const healthRoute = HttpRouter.add("GET", "/api/health",
  Effect.succeed(HttpServerResponse.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  }))
);

const deepWipeRoute = HttpRouter.add("POST", "/api/agents/:id/deep-wipe",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const params = HttpServerRequest.params(request);
    const body = yield* HttpServerRequest.bodyJson(request);
    const { deleteWorkspace } = yield* Schema.decode(DeepWipeInput)(body);
    const agentService = yield* AgentService;
    const result = yield* agentService.deepWipe(params.id, deleteWorkspace);
    return HttpServerResponse.json(result);
  }).pipe(
    Effect.catchAll((error) =>
      Effect.succeed(HttpServerResponse.json({ error: String(error) }, { status: 500 }))
    )
  )
);
```

### Streaming RPC Pattern (for terminal)
```typescript
// Server
subscribeTerminal: (input) =>
  Stream.callback<TerminalChunk>((queue) =>
    Effect.gen(function* () {
      const pty = spawn("tmux", ["attach-session", "-t", input.sessionName], {
        cols: input.cols, rows: input.rows,
      });
      pty.onData((data) => Queue.offer(queue, { data }));
      pty.onExit(() => Queue.end(queue));
    })
  ),

// Client
const unsub = rpcClient.subscribeTerminal(
  { sessionName: "agent-min-824", cols: 120, rows: 40 },
  (chunk) => xterm.write(chunk.data),
);
```

## Testing Strategy

1. **Each route module**: Unit test that the Effect handler returns the same response as the Express route for the same input
2. **Event store**: Test append, readFrom, liveStream, sequence ordering
3. **Recovery coordinator**: Test bootstrap, sequence gap, replay, snapshot fallback
4. **Zustand store**: Test each event reducer produces correct state transitions
5. **Integration**: Playwright E2E — load board, click card, verify detail panel in <1s

## Acceptance Criteria

| Phase | Metric | Target |
|-------|--------|--------|
| 1 | Effect server running, events flowing | Functional |
| 2 | All 185 routes migrated, Express removed | Zero Express |
| 3 | KanbanBoard from Zustand, zero issue/agent polling | <5 req/min |
| 3 | Detail panel open time | <1 second |
| 4 | Terminal streaming via RPC | Zero HTTP polling |
| 5 | Single 15K-line index.ts | Deleted |
| 5 | Dependencies removed | Express, socket.io, cors |

## Risk

| Risk | Impact | Mitigation |
|------|--------|------------|
| Effect 4.x is beta | API changes | Pin exact version, T3Code as reference |
| 185 routes to convert | Large scope | Parallelize across 12 agents |
| node-pty + Effect WebSocket | Compatibility unknown | Prototype in Phase 1 |
| Build system (esbuild) | Bundle size/compatibility | Test early, Effect is standard ESM |
