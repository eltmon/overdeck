# PAN-428: Full Effect.js Migration — Dashboard Server + Data Layer

## Problem

The Overdeck dashboard takes 5-20+ seconds to open a workspace detail panel. Root cause: **80+ HTTP requests/minute** from aggressive, duplicated polling saturates the browser's 6-connection HTTP/1.1 limit through Traefik.

The server has a partial data layer already — `IssueDataService` handles background tracker polling, GitHub ETag caching, and socket.io snapshot/update push. The core problem is **inconsistency**: issues are partially centralized through `IssueDataService`, but agents, specialists, workspaces, costs, and resources each have their own independent React Query polling loops. The frontend has 3 independent `/api/issues` queries with different cache keys, plus 42+ other polls at 2-5 second intervals. Live updates are split across socket.io, raw WebSocket (terminal), and HTTP polling — three transport paradigms that don't coordinate.

The server is a single 15,777-line Express file (`src/dashboard/server/index.ts`) with 185 routes. The `execSync` class of bugs (PAN-70/72/205/425) keeps recurring because the Express model doesn't prevent blocking calls.

## Decision

**Go full Effect.js.** Replace Express and socket.io entirely with Effect's HTTP server + WebSocket RPC. Single paradigm, single error model, async-by-default. Modeled on T3Code's production architecture (`/home/eltmon/Projects/t3code`).

**Switch to Bun** as package manager and dev runtime (Node remains the production runtime for npm distribution). Add shared contracts as a proper workspace package.

This work will be parallelized across multiple Overdeck agents.

---

## Toolchain Changes

### Package Manager: npm → Bun

T3Code uses Bun for package management, workspace resolution, and dev execution. We adopt the same:

| What | Current | Target |
|------|---------|--------|
| Package manager | npm | Bun 1.3+ |
| Lockfile | `package-lock.json` | `bun.lock` |
| Workspace protocol | npm workspaces | Bun workspaces |
| Dev execution | `tsx watch` / `node dist/...` | `bun run src/...` (native TS) |
| Production runtime | Node 22 | Node 22 (unchanged — npm published CLI must work with Node) |

**Why Bun**: Native TS execution (no build step in dev), faster installs, workspace `catalog:` versioning for Effect packages, and Bun.spawn() provides native PTY without the node-pty native addon.

### Build System: esbuild → tsdown + Vite

| Component | Current | Target |
|-----------|---------|--------|
| Server | esbuild → `dist/dashboard/server.js` | tsdown → `dist/server/index.mjs` |
| Frontend | Vite → `dist/dashboard/public/` | Vite → `dist/web/` (unchanged tooling) |
| CLI | tsup → `dist/cli/index.js` | tsup → `dist/cli/index.js` (unchanged for now) |

**tsdown** is what T3Code uses for server compilation. It's TypeScript-native and simpler than esbuild for Effect code. In dev mode, Bun executes TS directly — no build step at all.

### Runtime: Dual-Mode (Bun + Node)

Following T3Code's exact pattern (`apps/server/src/server.ts:48-91`):

```typescript
// Auto-detect runtime for HTTP server
if (typeof Bun !== "undefined") {
  const BunHttpServer = await import("@effect/platform-bun/BunHttpServer");
  return BunHttpServer.layer({ port });
} else {
  const NodeHttpServer = await import("@effect/platform-node/NodeHttpServer");
  const NodeHttp = await import("node:http");
  return NodeHttpServer.layer(NodeHttp.createServer, { port });
}
```

**Dev**: `bun run src/dashboard/server/main.ts` — instant startup, native TS
**Production**: `node dist/server/index.mjs` — compiled JS, works everywhere

### PTY: Dual-Runtime Terminal

**Investigation finding**: `@homebridge/node-pty-prebuilt-multiarch` is a native C++ addon (Node N-API) that does **NOT** work with Bun. T3Code solved this with runtime detection:

```typescript
// T3Code pattern: apps/server/src/terminal/Layers/BunPTY.ts
if (typeof Bun !== "undefined" && process.platform !== "win32") {
  // Bun: native PTY via Bun.spawn() — no native addon needed
  const subprocess = Bun.spawn(command, {
    cwd, env,
    terminal: { cols, rows, data: (terminal, data) => onData(data) }
  });
} else {
  // Node: use node-pty (prebuilt native addon)
  const pty = require("@homebridge/node-pty-prebuilt-multiarch");
  const process = pty.spawn(command, args, { cols, rows, cwd, env });
}
```

We run on Linux (Ubuntu), so Bun.spawn() PTY works. We keep node-pty as a fallback for Node production runtime. The existing deferred-spawn + stale-data-suppression logic (PAN-417) is preserved in both paths.

### SQLite: Dual-Runtime

Following T3Code's pattern (`persistence/Layers/Sqlite.ts`):

| Runtime | SQLite Provider |
|---------|----------------|
| Bun | `@effect/sql-sqlite-bun` (Bun's native sqlite) |
| Node | `node:sqlite` (Node 22.16+ built-in) |

Both are fast, both avoid native compilation headaches.

### Effect Version: `4.0.0-beta.43` (pinned)

**Investigation finding**: Effect 4.x is beta. The maintainers explicitly recommend v3 for production. However:
- T3Code (by Theo, who has a relationship with the Effect team) runs this version in production
- The APIs we need (`unstable/http`, `unstable/rpc`) only exist in v4
- We pin the EXACT version `4.0.0-beta.43` — no auto-updates
- T3Code serves as our canary: if an update breaks them, we'll know before we update

**Risk mitigation:**
1. Pin exact version in root `package.json` catalog (not `^` or `~`)
2. Never auto-update Effect — manual, tested version bumps only
3. Track T3Code's version bumps via their git history
4. All Effect imports from `unstable/*` modules are concentrated in contracts + transport layers, making future API changes a localized fix

---

## Reference Implementation

T3Code source: `/home/eltmon/Projects/t3code`

| T3Code File | Pattern | We Adapt For |
|-------------|---------|--------------|
| `apps/server/src/server.ts` | Layer composition, dual-runtime HTTP, `HttpRouter.serve()` | Server assembly |
| `apps/server/src/ws.ts` | `WsRpcGroup.toLayer()`, sequence-ordered streaming | Real-time data |
| `apps/server/src/http.ts` | `HttpRouter.add()` route handlers | REST-like routes |
| `apps/server/src/terminal/Layers/BunPTY.ts` | Bun.spawn() native PTY | Terminal streaming |
| `apps/web/src/wsTransport.ts` | `ManagedRuntime`, auto-reconnect subscriptions | Client transport |
| `apps/web/src/store.ts` | Zustand + `applyDomainEvent()` pure reducers | Client state |
| `apps/web/src/routes/__root.tsx` | Recovery coordinator, event coalescing | Reconnection |
| `packages/contracts/src/rpc.ts` | `Rpc.make()` with Schema validation | Shared contracts |
| `persistence/Layers/Sqlite.ts` | Dual-runtime SQLite detection | Event store |

**Key Effect imports:**
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
```

---

## Monorepo Structure

### Current Layout
```
panopticon-cli/
├── src/
│   ├── cli/                    # CLI (tsup → npm published)
│   ├── dashboard/
│   │   ├── server/             # Express server (15K line index.ts)
│   │   └── frontend/           # React frontend (Vite)
│   └── lib/                    # Shared library code
├── package.json                # workspaces: ["src/dashboard/frontend"]
└── package-lock.json
```

### Target Layout
```
panopticon-cli/
├── packages/
│   └── contracts/              # @panopticon/contracts (NEW)
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── events.ts       # Domain event schemas
│           ├── rpc.ts          # RPC method definitions
│           ├── types.ts        # Shared types (Issue, Agent, etc.)
│           └── index.ts        # Re-exports
├── src/
│   ├── cli/                    # CLI (unchanged for now)
│   ├── dashboard/
│   │   ├── server/             # Effect.js server (REWRITTEN)
│   │   │   ├── main.ts         # Entry: NodeRuntime.runMain
│   │   │   ├── server.ts       # Layer assembly
│   │   │   ├── config.ts       # ServerConfig service
│   │   │   ├── event-store.ts  # SQLite event store + PubSub
│   │   │   ├── ws-rpc.ts       # WebSocket RPC handlers
│   │   │   ├── routes/         # 12+ route modules
│   │   │   ├── services/       # Effect service wrappers
│   │   │   └── middleware/     # CORS, body parsing
│   │   └── frontend/           # React frontend (MODIFIED)
│   │       └── src/
│   │           ├── transport/  # Effect WsTransport (NEW)
│   │           ├── store/      # Zustand store (NEW)
│   │           └── components/ # Modified to use store
│   └── lib/                    # Shared library code (UNCHANGED)
├── package.json                # workspaces: ["packages/*", "src/dashboard/frontend"]
├── bunfig.toml                 # Bun configuration
├── bun.lock                    # Bun lockfile
└── turbo.json                  # Build task orchestration (optional)
```

**Key decision**: We do NOT restructure `src/` into `apps/`. The CLI, server, and frontend stay where they are. Only the NEW contracts package goes in `packages/`. This minimizes file moves and keeps import paths stable for the massive route migration.

### Workspace Configuration

**Root `package.json`:**
```json
{
  "workspaces": ["packages/*", "src/dashboard/frontend"],
  "catalog": {
    "effect": "4.0.0-beta.43",
    "@effect/platform-node": "4.0.0-beta.43",
    "@effect/platform-bun": "4.0.0-beta.43",
    "@effect/sql-sqlite-bun": "4.0.0-beta.43"
  }
}
```

**`packages/contracts/package.json`:**
```json
{
  "name": "@panopticon/contracts",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "effect": "catalog:" }
}
```

Server and frontend import: `import { DomainEvent, PanRpcGroup } from "@panopticon/contracts"`

---

## Work Decomposition — Dependency DAG

```
┌──────────────────┐
│  B0: Toolchain   │  Switch to Bun, create packages/contracts/,
│  Setup           │  bunfig.toml, workspace config, tsdown setup
└────────┬─────────┘
         │
┌────────┴─────────┐
│  B1: Contracts   │  Event schemas, RPC definitions, shared types
│  Package         │  in packages/contracts/src/
└────────┬─────────┘
         │
    ┌────┼──────────────┐
    ▼    ▼              ▼
┌──────┐ ┌──────┐ ┌───────────────┐
│  B2  │ │  B3  │ │  B4: Frontend │
│Event │ │Config│ │  Transport +  │
│Store │ │ Svc  │ │  Store + Rcvry│
└──┬───┘ └──┬───┘ └──────┬────────┘
   │        │             │
   ▼        ▼             │ (parallel with B2-B17)
┌──────────────────┐      │
│ B5: Server       │      │
│ Skeleton + RPC   │      │
└────────┬─────────┘      │
         │                │
  ┌──────┼──────────┐    │
  ▼      ▼          ▼    │
┌────┐ ┌────┐ ┌────────┐ │
│B6  │ │B7  │ │  B17   │ │
│iss │ │agt │ │  misc  │ │
│ues │ │nts │ │        │ │
└─┬──┘ └─┬──┘ └───┬────┘ │
  │       │        │      │
  ▼       ▼        ▼      ▼
┌────────────────────────────┐
│ B18: Integration           │
│ Wire routes + build + test │
└─────────────┬──────────────┘
              │
     ┌────────┼────────┐
     ▼                 ▼
┌──────────┐  ┌───────────────┐
│B19: FE   │  │B20: Terminal  │
│Component │  │Streaming RPC  │
│Migration │  │(dual-runtime) │
└────┬─────┘  └──────┬────────┘
     │               │
     ▼               ▼
┌────────────────────────────┐
│ B21: Cleanup + Playwright  │
└────────────────────────────┘
```

**Parallelism:**
- B2, B3, B4 all parallel (after B1)
- B6–B17 (12 route modules) ALL parallel (after B5)
- B4 runs in parallel with B2–B17 (only needs B1 contracts)
- B19, B20 parallel (after B18)

---

## Critical Rules for Agents

### 1. Do NOT rewrite `src/lib/*` modules

The existing library code (`src/lib/agents.ts`, `src/lib/cloister/*.ts`, `src/lib/costs/*.ts`, etc.) stays as-is. Route handlers wrap calls to them:

```typescript
// CORRECT — wrap existing async code in Effect
const result = yield* Effect.tryPromise({
  try: () => deepWipeAgent(issueId, { deleteWorkspace: true }),
  catch: (err) => new DeepWipeError({ message: String(err) }),
});

// WRONG — don't rewrite the library function
```

The only lib files modified are those that need to emit events (they gain an `eventStore.append()` call).

**Caveat on sync code:** `Effect.tryPromise()` only works on async functions. If the underlying lib function uses `execSync` or `readFileSync`, the call still blocks the event loop even though it's wrapped in Effect. The known sync hot paths in server-reachable lib code (`src/lib/tmux.ts` sendKeys/listSessions) have already been converted to async (`sendKeysAsync`, `execAsync`) by PAN-70/205. If route agents encounter remaining sync calls in hot paths, they should convert them to async as part of the route migration — don't leave a sync call wrapped in `Effect.tryPromise()`.

### 2. Do NOT modify `server.ts` from route modules

Each route module exports a `Layer`. The integration bead (B18) wires them together. Route agents create their file and ONLY their file.

### 3. Preserve exact API contracts

Every route must return the SAME response shape as the current Express route. The frontend depends on these shapes. Don't rename fields, don't change status codes, don't change URL patterns.

### 4. Socket.io → EventStore mapping

| Old socket.io event | New domain event type | Notes |
|---------------------|----------------------|-------|
| `agents:changed` | `agent.started` / `agent.stopped` | Split into specific lifecycle events |
| `pipeline:status` | `pipeline.review-completed` / `pipeline.test-completed` | Split by stage |
| `planning:started` | `planning.started` | Direct mapping |
| `planning:failed` | `planning.failed` | Direct mapping |
| `planning:sync` | `planning.artifact-synced` | NOT the same as completed — fired when artifacts upload/sync during planning |
| `merge:ready` | `pipeline.merge-ready` | Direct mapping |
| `resources:updated` | `resources.stats-updated` | Carries container stats, not just readiness |
| `plan:item-status-changed` | `bead.status-changed` | Direct mapping |
| `plan:items-unblocked` | `bead.unblocked` | Items whose blockers cleared |
| `plan:subitem-status-changed` | `bead.ac-status-changed` | AC (acceptance criteria) sub-item status |
| `godview:agent-output` | Delivered via `subscribeAgentOutput` RPC stream | Not a domain event — live data stream |
| `godview:status-change` | `agent.started` / `agent.stopped` | Derived from agent lifecycle events |
| `godview:activity` | Derived from all domain events | Client-side projection, not a separate event |
| `shadow:inference-update` | `issue.shadow-updated` | Direct mapping |

### 5. Background processes become Effect fibers

```typescript
const IssuePollerLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const issueService = yield* IssueDataService;
    const eventStore = yield* EventStore;
    yield* Effect.forever(
      Effect.gen(function* () {
        const changes = yield* issueService.poll();
        for (const change of changes) {
          yield* eventStore.append(change);
        }
        yield* Effect.sleep("30 seconds");
      })
    ).pipe(Effect.fork);
  })
);
```

### 6. Effect service pattern for existing modules

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

### B0: Toolchain Setup

**Goal:** Switch package manager to Bun, create workspace structure, configure builds.

**Creates:**
- `bunfig.toml` — Bun configuration
- `packages/contracts/package.json` — `@panopticon/contracts` workspace package
- `packages/contracts/tsconfig.json` — TypeScript config for contracts
- `packages/contracts/src/index.ts` — Placeholder re-export

**Modifies:**
- `package.json` — Switch to Bun workspaces, add `catalog` for Effect versions, add `@effect/platform-node`, `@effect/platform-bun`, `@effect/sql-sqlite-bun` to catalog
- `.gitignore` — Add `bun.lock` exclusions if needed
- Remove `package-lock.json` (replaced by `bun.lock`)

**Does:**
- Run `bun install` to generate `bun.lock`
- Verify `bun run build` still works (existing builds must not break)
- Verify `bun test` runs existing tests

**Blocks:** B1

**Acceptance criteria:**
- [ ] `bun install` succeeds
- [ ] `bun run build` produces working CLI and dashboard
- [ ] `bun test` passes all 223 existing tests
- [ ] `packages/contracts/` exists and is resolvable as `@panopticon/contracts`

---

### B1: Contracts Package

**Creates (in `packages/contracts/src/`):**
- `events.ts` — All domain event Schema definitions (~25 event types from catalog below)
- `rpc.ts` — RPC method + group definitions (streaming + unary + commands)
- `types.ts` — Issue, Agent, Specialist, Workspace, Cost schemas
- `index.ts` — Re-exports everything

**Reference:** T3Code `packages/contracts/src/rpc.ts`, `packages/contracts/src/orchestration.ts`

**Blocks:** B2, B3, B4, B5

**Acceptance criteria:**
- [ ] `bun run --filter @panopticon/contracts typecheck` passes
- [ ] Event schemas cover all 13 current socket.io events (mapped to ~25 domain events)
- [ ] RPC group includes all methods from the RPC Methods section
- [ ] Server and frontend can both `import { DomainEvent } from "@panopticon/contracts"`

**Note on npm distribution:** The contracts package exports raw `.ts` files (`"exports": { ".": "./src/index.ts" }`). This works for local dev (Bun/Vite resolve TS natively) and for production builds (tsdown/Vite bundle the contracts into the output). The contracts package itself is NOT published to npm — it's build-time only, always bundled into the server and frontend artifacts that ship.

---

### B2: Event Store

**Creates:** `src/dashboard/server/event-store.ts`

**Design:**
- SQLite-backed append-only event store
- Dual-runtime SQLite: Bun native sqlite or `node:sqlite` (detect at startup, following T3Code `persistence/Layers/Sqlite.ts`)
- In-memory `PubSub<DomainEvent>` for live streaming
- Monotonic sequence counter (loaded from DB max on startup)
- Methods: `append()`, `readFrom(sequence)`, `liveStream`, `getLatestSequence()`
- DB schema: `events (sequence INTEGER PRIMARY KEY, type TEXT, timestamp TEXT, payload JSON)`
- DB location: `~/.panopticon/panopticon.db` (existing app DB — add `events` table, NOT a third database). The repo already has `cache.db` and `panopticon.db`; do not create a third SQLite file.
- **Retention**: Events older than 7 days are compacted on startup. The snapshot RPC provides the full current state, so old events are only needed for short-term replay/recovery. A daily cleanup fiber truncates events where `sequence < latestSequence - 10000`.
- **Schema migrations**: Version table (`event_store_version`) with ordered migration array, applied on startup. Following the same pattern as `src/lib/database/index.ts`.

**Blocks:** B5

**Acceptance criteria:**
- [ ] Events persist across server restarts
- [ ] `readFrom(N)` returns only events with sequence > N
- [ ] `liveStream` delivers events in real-time via PubSub
- [ ] Sequence numbers are gap-free and monotonic
- [ ] Works on both Bun and Node runtimes
- [ ] Unit tests for append, read, stream, restart recovery

---

### B3: ServerConfig Service

**Creates:** `src/dashboard/server/config.ts`

Wraps env vars (`~/.panopticon.env`), projects.yaml, CLI flags as an Effect service. Replaces the inline env loading in current `index.ts`.

**Blocks:** B5

**Acceptance criteria:**
- [ ] All env vars currently used by index.ts accessible via `yield* ServerConfig`
- [ ] Missing required vars produce typed errors (not runtime crashes)

---

### B4: Frontend Transport + Store + Recovery

**Creates:**
- `src/dashboard/frontend/src/transport/protocol.ts` — `createWsRpcProtocolLayer(url)`
- `src/dashboard/frontend/src/transport/wsTransport.ts` — `WsTransport` class
- `src/dashboard/frontend/src/transport/rpcClient.ts` — Typed `PanRpcClient`
- `src/dashboard/frontend/src/store/store.ts` — Zustand `DashboardState`
- `src/dashboard/frontend/src/store/selectors.ts` — All selectors
- `src/dashboard/frontend/src/store/eventReducers.ts` — Pure event reducers
- `src/dashboard/frontend/src/store/recovery.ts` — Recovery coordinator
- `src/dashboard/frontend/src/components/EventRouter.tsx` — Root subscriber

**Selectors:**
```typescript
selectAllIssues(state)
selectIssuesByCycle(cycle, includeCompleted)(state)
selectIssueByIdentifier(id)(state)
selectAgents(state)
selectAgentForIssue(issueId)(state)
selectSpecialists(state)
selectCostForIssue(issueId)(state)
selectIsBootstrapped(state)
```

**Can run in parallel with:** B2, B3, B5, B6–B17 (only depends on B1)

**Reference:** T3Code `apps/web/src/wsTransport.ts` (131 lines), `apps/web/src/store.ts`, `apps/web/src/orchestrationRecovery.ts` (137 lines), `apps/web/src/routes/__root.tsx` lines 194-524

**Acceptance criteria:**
- [ ] WsTransport connects to `/ws/rpc` and auto-reconnects with exponential backoff
- [ ] Store receives snapshot on connect, applies events incrementally
- [ ] Recovery coordinator detects sequence gaps and triggers replay
- [ ] Event coalescing batches rapid events via `queueMicrotask`
- [ ] Selectors return correct filtered views
- [ ] Unit tests for every event reducer and selector

---

### B5: Server Skeleton + RPC + Shared Services

**Creates:**
- `src/dashboard/server/main.ts` — Entry: Layer composition + `NodeRuntime.runMain`
- `src/dashboard/server/server.ts` — `makeServerLayer`, `makeRoutesLayer`, dual-runtime HTTP
- `src/dashboard/server/ws-rpc.ts` — RPC handlers: `getSnapshot`, `subscribeDomainEvents`, `replayEvents`
- `src/dashboard/server/routes/static.ts` — Static file serving (adapted from T3Code `http.ts`)
- `src/dashboard/server/routes/health.ts` — `/api/health`, `/api/version`
- `src/dashboard/server/middleware/cors.ts` — CORS middleware
- `src/dashboard/server/middleware/json-body.ts` — JSON body parsing
- `src/dashboard/server/services/agent-manager.ts` — Effect service wrapping `src/lib/agents.ts`
- `src/dashboard/server/services/workspace-manager-service.ts` — Effect service wrapping workspace ops
- `src/dashboard/server/services/specialist-service.ts` — Effect service wrapping specialist/cloister ops
- `src/dashboard/server/services/cost-service.ts` — Effect service wrapping cost tracking
- `src/dashboard/server/services/docker-stats-service.ts` — Effect service wrapping Docker stats

**Why services are here (not B18):** Route modules (B6-B17) run in parallel and all need to `yield*` from shared services. If services aren't created until B18 (integration), the parallel beads can't compile. Creating all service wrappers in B5 eliminates merge conflicts — route agents import from `../services/` and never create their own service definitions.

**Service wrapper pattern:**
```typescript
export class AgentManager extends Context.Tag("AgentManager")<AgentManager, {
  readonly startAgent: (issueId: string, opts: StartAgentOpts) => Effect.Effect<void, AgentError>;
  readonly stopAgent: (agentId: string) => Effect.Effect<void, AgentError>;
  // ... all methods route modules will need
}>() {}

export const AgentManagerLive = Layer.succeed(AgentManager, {
  startAgent: (issueId, opts) => Effect.tryPromise(() => agentsLib.startAgent(issueId, opts)),
  // ...
});
```

**Design for `server.ts`:** Follows T3Code `apps/server/src/server.ts` — dual-runtime HTTP detection, Layer composition, `HttpRouter.serve(makeRoutesLayer)`.

**Design for `ws-rpc.ts`:** Implements `subscribeDomainEvents` with T3Code's sequence-ordered deduplication pattern (ws.ts lines 134-190). `getSnapshot` returns current state. `replayEvents` reads from event store.

**Blocks:** B6–B17

**Acceptance criteria:**
- [ ] `bun run src/dashboard/server/main.ts` starts and listens on port 3011
- [ ] `node dist/server/index.mjs` also starts (dual-runtime)
- [ ] `curl http://localhost:3011/api/health` returns `{ status: "ok" }`
- [ ] Frontend static files served at `/`
- [ ] WebSocket connects at `/ws/rpc`
- [ ] `subscribeDomainEvents` streams test events to connected clients
- [ ] CORS headers present on API responses
- [ ] All service wrappers compile and export valid Effect services

---

### B6–B17: Route Modules (12 beads, ALL parallel)

Each bead creates ONE route file. **See full pattern, instructions, and assignment table in the "Route Migration" section below.**

---

### B18: Integration + Build

**Modifies:**
- `src/dashboard/server/server.ts` — Wire all 12+ route layers into `makeRoutesLayer`
- Build config — Entry point to `src/dashboard/server/main.ts`
- `package.json` scripts — Update `build:dashboard:server` for tsdown

**Creates:**
- Background fiber layers: IssuePoller, Deacon, DockerStats, Cloister (long-running Effect fibers that poll external systems and emit events to the store)

**Does:**
- Wire all B6–B17 route layers into server.ts
- Wire background fibers into server layer
- Run full test suite — all existing tests must pass
- Smoke test: start server, verify all endpoints return same responses

**Blocks:** B19, B20

**Acceptance criteria:**
- [ ] `bun run build` succeeds
- [ ] All existing tests pass (223/223)
- [ ] Server starts and all 185 routes respond correctly
- [ ] WebSocket RPC streams events
- [ ] Background processes (issue polling, deacon patrols) run as Effect fibers

---

### B19: Frontend Component Migration

**Modifies:** App.tsx, KanbanBoard.tsx, InspectorPanel.tsx, SearchModal.tsx, AgentList.tsx, CloisterStatusBar.tsx, MetricsSummaryRow.tsx

**Deletes:**
- `frontend/src/hooks/useSocketIssues.ts` — replaced by EventRouter
- `frontend/src/components/IssueDetailPanel.tsx` — dead code, superseded by InspectorPanel
- `frontend/src/components/WorkspacePanel.tsx` — dead code, superseded by InspectorPanel

**Acceptance criteria:**
- [ ] KanbanBoard renders from store selectors, zero `/api/issues` HTTP polling
- [ ] Detail panel opens in <1 second (Playwright)
- [ ] HTTP requests from kanban board: <5/minute
- [ ] All frontend tests pass

---

### B20: Terminal Streaming RPC (Dual-Runtime)

The codebase has TWO terminal surfaces:
- **`XTerminal.tsx`** — Interactive PTY via raw WebSocket at `/ws/terminal`. Used by `PlanDialog.tsx` and workspace detail. Full input, resize, deferred spawn (PAN-417), stale-data suppression.
- **`TerminalPanel.tsx`** — Passive log viewer polling `/api/agents/{id}/output?lines=200`. Shows text output, no PTY.

Both migrate to Effect RPC streams over the single WebSocket:
- `subscribeTerminal` replaces `XTerminal.tsx`'s raw WebSocket (interactive PTY with input/resize)
- `subscribeAgentOutput` replaces `TerminalPanel.tsx`'s HTTP polling (lightweight text stream)

**Creates:**
- `src/dashboard/server/services/terminal-service.ts` — Dual-runtime PTY management

**Design:** Runtime detection for PTY:
- **Bun**: `Bun.spawn(command, { terminal: { cols, rows } })` — native, no addon
- **Node**: `@homebridge/node-pty-prebuilt-multiarch` — prebuilt native addon

Preserves deferred-spawn (PAN-417), stale-data suppression (200ms), dimension-toggle repaint.

**Remote terminals (Fly.io):** Preserved as `subscribeTerminal({ location: 'remote', vmName })`. Same stream interface, spawns `fly ssh console` instead of local `tmux attach`.

**Modifies:**
- `src/dashboard/server/ws-rpc.ts` — Add `subscribeTerminal` + `subscribeAgentOutput` RPCs
- `src/dashboard/frontend/src/components/XTerminal.tsx` — Replace raw WS with `rpcClient.subscribeTerminal()`
- `src/dashboard/frontend/src/components/TerminalPanel.tsx` — Replace HTTP poll with `rpcClient.subscribeAgentOutput()`

**Note on "1 WebSocket connection":** The acceptance criterion means 1 multiplexed RPC connection. Multiple concurrent streams (2 terminals + domain events) run over the same socket. Effect RPC handles this natively.

**Acceptance criteria:**
- [ ] Interactive terminal (XTerminal) works via RPC stream — input, resize, deferred spawn
- [ ] Passive log viewer (TerminalPanel) works via RPC stream — no HTTP polling
- [ ] Works on both Bun (dev) and Node (production) runtimes
- [ ] Remote terminal (Fly.io) works via same stream interface
- [ ] Multiple terminals open simultaneously on one WebSocket
- [ ] PTY cleanup on disconnect, deferred spawn + stale data suppression preserved

---

### B21: Cleanup + Verification

**Deletes:**
- `src/dashboard/server/index.ts` (15,777 lines)
- `package-lock.json` (replaced by `bun.lock`)

**Removes from dependencies:**
- `express`, `cors`, `socket.io`, `ws` (raw WebSocket server)
- `socket.io-client` (if in frontend)

**Dist path migration checklist** (these all reference the old paths):
- [ ] `src/cli/index.ts` — looks for bundled server at `dist/dashboard/server.js`, update to new path
- [ ] `src/dashboard/server/index.ts` — build-freshness check hard-coded to `server.js`, remove
- [ ] Static file serving — currently looks for `dist/dashboard/public`, update to new Vite output path
- [ ] `esbuild.config.mjs` — replace with tsdown config or remove
- [ ] `npm run dev` script — update to `bun run` with new entry point
- [ ] `npm link` / `pan` CLI — verify `dist/` output is correct for npm consumers

**Version bump:** `0.5.x` → `0.6.0` — this is a major architectural milestone (Express → Effect.js), not a patch.

**Modifies:**
- `package.json` — version to `0.6.0`
- `CLAUDE.md` — Update architecture section for Effect.js + Bun
- `docs/INDEX.md` — Update references

**Playwright verification:**
- [ ] Dashboard loads in <3 seconds
- [ ] Click kanban card → detail panel in <1 second
- [ ] Terminal tab shows live output
- [ ] Plan → planning dialog → agent starts (full flow)
- [ ] All action buttons work (Watch, Tasks, Tell, Kill, Wipe, etc.)
- [ ] HTTP requests/minute from idle board: <5
- [ ] WebSocket connections: exactly 1

---

## Route Migration Details (B6–B17)

### Pattern

```typescript
// src/dashboard/server/routes/{category}.ts
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

const list = HttpRouter.add("GET", "/api/{category}",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    // Parse query: HttpServerRequest.toURL(request) → url.searchParams
    // Wrap existing logic: yield* Effect.tryPromise(() => existingAsyncFn())
    return HttpServerResponse.json(result);
  }).pipe(Effect.catchAll((error) =>
    Effect.succeed(HttpServerResponse.json({ error: String(error) }, { status: 500 }))
  ))
);

export const {category}Routes = Layer.mergeAll(list, /* ... */);
```

### Agent Instructions

1. `grep "app\.\(get\|post\|put\|delete\)('/api/{category}" src/dashboard/server/index.ts` to find ALL routes
2. Create `src/dashboard/server/routes/{category}.ts`
3. Convert each Express route to `HttpRouter.add()` — wrap business logic in `Effect.tryPromise()`
4. Replace `socketIo.emit(...)` with `yield* eventStore.append(...)` per mapping table
5. Replace `execSync` with `yield* Effect.tryPromise(() => execAsync(...))`
6. Export single `{category}Routes` Layer
7. Do NOT import or modify `server.ts`

### Route Conversion Cheat Sheet

| Express | Effect |
|---------|--------|
| `req.params.id` | `HttpServerRequest.params(request).id` (if params API unavailable, parse URL: `url.pathname.split('/')[3]`) |
| `req.query.foo` | `HttpServerRequest.toURL(request)` → `url.searchParams.get('foo')` |
| `req.body` | `yield* HttpServerRequest.bodyJson(request)` |
| `res.json(data)` | `HttpServerResponse.json(data)` |
| `res.status(404).json(...)` | `HttpServerResponse.json(data, { status: 404 })` |
| `res.sendFile(path)` | `yield* HttpServerResponse.file(path)` |
| `try { } catch { }` | `Effect.tryPromise({ try, catch })` |
| `async (req, res) => {}` | `Effect.gen(function* () {})` |
| Global variable | `yield* ServiceTag` (DI) |
| `socketIo.emit(...)` | `yield* eventStore.append(...)` |

### Bead Assignments

| Bead | File | Routes | Grep Pattern |
|------|------|--------|--------------|
| B6 | `routes/issues.ts` | 17 | `'/api/issues` |
| B7 | `routes/agents.ts` | 20 | `'/api/agents` |
| B8 | `routes/workspaces.ts` | 19 | `'/api/workspaces` |
| B9 | `routes/specialists.ts` | 33 | `'/api/specialists` |
| B10 | `routes/costs.ts` | 11 | `'/api/costs` |
| B11 | `routes/cloister.ts` | 9 | `'/api/cloister` |
| B12 | `routes/resources.ts` | 8 | `'/api/resources` |
| B13 | `routes/mission-control.ts` | 7 | `'/api/mission-control` |
| B14 | `routes/remote.ts` | 9 | `'/api/remote` |
| B15 | `routes/settings.ts` | 6 | `'/api/settings` |
| B16 | `routes/metrics.ts` + `routes/convoys.ts` | 11 | `'/api/metrics\|/api/convoys` |
| B17 | `routes/misc.ts` | 35 | Everything else (activity, confirmations, tracker-status, handoffs, shadow, planning, deacon, skills, version, godview, rally, project-mappings, services, registered-projects, cache-status) |

---

## Domain Events Catalog

Every event: `{ type: string, sequence: number, timestamp: string, payload: {...} }`

### Issue Events
| Event Type | Emitted When | Payload |
|------------|-------------|---------|
| `issue.updated` | IssueDataService detects change | `{ identifier, changedFields }` |
| `issue.status-changed` | Status transition | `{ identifier, from, to }` |
| `issue.labels-changed` | Labels added/removed | `{ identifier, added[], removed[] }` |
| `issue.shadow-updated` | Shadow state inference | `{ identifier, shadowStatus }` |

### Agent Events
| Event Type | Emitted When | Payload |
|------------|-------------|---------|
| `agent.started` | tmux session created | `{ agentId, issueId, model, phase, runtime }` |
| `agent.stopped` | Agent exited/killed | `{ agentId, issueId, exitCode? }` |
| `agent.heartbeat` | Stop-hook fires | `{ agentId, state, contextPercent?, lastActivity }` |
| `agent.stuck` | Deacon detects stuck | `{ agentId, issueId, stuckDuration }` |

### Pipeline Events
| Event Type | Emitted When | Payload |
|------------|-------------|---------|
| `pipeline.review-started` | Review specialist spawned | `{ issueId, specialistId, project }` |
| `pipeline.review-completed` | Review passes/fails | `{ issueId, result, feedback? }` |
| `pipeline.test-started` | Test specialist spawned | `{ issueId, specialistId, project }` |
| `pipeline.test-completed` | Tests pass/fail | `{ issueId, result, output? }` |
| `pipeline.merge-ready` | Gates passed, waiting for human | `{ issueId }` |
| `pipeline.merged` | Human clicked merge | `{ issueId, branch, project }` |

### Planning Events
| Event Type | Emitted When | Payload |
|------------|-------------|---------|
| `planning.started` | Planning agent launched | `{ issueId, sessionName, location }` |
| `planning.completed` | stop-hook fires complete-planning | `{ issueId, beadCount }` |
| `planning.failed` | Planning fails | `{ issueId, error }` |
| `planning.artifact-synced` | Planning artifact uploaded/synced | `{ issueId, artifactType, filename }` |

### Specialist Events
| Event Type | Emitted When | Payload |
|------------|-------------|---------|
| `specialist.spawned` | Session created | `{ id, type, issueId, project }` |
| `specialist.completed` | Specialist finishes | `{ id, type, issueId, result }` |
| `specialist.handoff` | Hands off to next | `{ fromId, toType, issueId }` |

### Workspace Events
| Event Type | Emitted When | Payload |
|------------|-------------|---------|
| `workspace.created` | Workspace creation completes | `{ issueId, path, type }` |
| `workspace.containers-ready` | Docker containers healthy | `{ issueId, containers[] }` |
| `workspace.deleted` | Deep-wipe | `{ issueId }` |

### Resource Events
| Event Type | Emitted When | Payload |
|------------|-------------|---------|
| `resources.stats-updated` | DockerStatsCollector polls (5s) | `{ containers: { name, cpu, mem, status }[] }` |

**Note:** Resource stats are ephemeral telemetry — they are NOT persisted to the event store. They flow through PubSub only (live subscribers get them, replay does not include them). The snapshot includes current container state.

### Cost / Bead Events
| Event Type | Emitted When | Payload |
|------------|-------------|---------|
| `cost.recorded` | Cost event ingested | `{ issueId, agentId, amount, model }` |
| `bead.status-changed` | Bead transitions | `{ issueId, beadId, from, to }` |
| `bead.unblocked` | Blocker completed, item ready | `{ issueId, beadId }` |
| `bead.ac-status-changed` | AC sub-item status change | `{ issueId, beadId, subItemId, status }` |

---

## RPC Methods

### Streaming (server → client)
| Method | Input | Output | Description |
|--------|-------|--------|-------------|
| `pan.subscribeDomainEvents` | `{}` | `Stream<DomainEvent>` | All events, sequence-ordered with replay |
| `pan.subscribeTerminal` | `{ sessionName, cols, rows, location? }` | `Stream<TerminalChunk>` | Live PTY output (initial cols/rows replace the current "first resize" trigger) |
| `pan.subscribeAgentOutput` | `{ agentId }` | `Stream<OutputLine>` | Agent log tail (passive, no input) |

### Unary (request → response)
| Method | Input | Output | Description |
|--------|-------|--------|-------------|
| `pan.getSnapshot` | `{}` | `DashboardSnapshot` | Full state for cold start (see type below) |
| `pan.replayEvents` | `{ fromSequence }` | `DomainEvent[]` | Missed events for recovery |
| `pan.getWorkspaceDetail` | `{ issueId }` | `WorkspaceDetail` | Batched detail panel data (see type below) |
| `pan.sendTerminalInput` | `{ sessionName, data }` | `void` | Send keystrokes to PTY (client → server input channel) |
| `pan.resizeTerminal` | `{ sessionName, cols, rows }` | `void` | Resize PTY + tmux window |

### Commands (mutations)
| Method | Input | Output | Description |
|--------|-------|--------|-------------|
| `pan.startPlanning` | `{ issueId, location, shadow? }` | `{ sessionName }` | Launch planning |
| `pan.startAgent` | `{ issueId }` | `{ agentId }` | Launch implementation |
| `pan.deepWipe` | `{ issueId, deleteWorkspace? }` | `{ cleanupLog }` | Wipe workspace |

### Key Type Definitions

**`DashboardSnapshot`** — returned by `getSnapshot`, contains the full read model:
```typescript
{
  issues: Issue[],           // All issues from all trackers
  agents: Agent[],           // All agent states (running, stopped, etc.)
  specialists: Specialist[], // Current specialist pool
  cloisterStatus: CloisterStatus, // Pause state, config, active count
  costs: Record<string, IssueCost>, // Cost by issue identifier
  containers: ContainerStats[], // Current Docker container states
  snapshotSequence: number,  // Latest event sequence included in this snapshot
}
```

**`WorkspaceDetail`** — batched replacement for the 5 separate detail-panel queries:
```typescript
{
  workspace: WorkspaceInfo,        // path, branch, type, containers
  reviewStatus: ReviewStatus,       // review/test/merge pipeline state
  planning: PlanningInfo | null,    // STATE.md, PRD link, plan status
  costs: IssueCostData,            // cost breakdown by stage/model
  agentOutput: string[],           // last 200 lines of agent output
}
```

**Why `sendTerminalInput` and `resizeTerminal` are separate unary RPCs:** Effect RPC streaming is server→client only. The current raw WebSocket handles terminal bidirectionally (keystrokes go client→server on the same connection). In the new model, `subscribeTerminal` streams PTY output server→client, while `sendTerminalInput` sends keystrokes client→server as unary RPC calls over the same multiplexed WebSocket. This is the same connection — no extra HTTP, no extra sockets. The overhead is negligible (keystrokes arrive in batches, not individual bytes).

---

## Testing Strategy

1. **Contracts (B1):** Schema encode/decode round-trip for every event and RPC type
2. **Event store (B2):** append, readFrom, liveStream, sequence ordering, restart recovery
3. **Route modules (B6–B17):** Call Effect handler with mock request, verify response matches Express behavior. Use Vitest + `Effect.runPromise`.
4. **Recovery coordinator (B4):** State machine: bootstrap → streaming → gap → replay → streaming
5. **Zustand reducers (B4):** Each event type → correct state transition
6. **Integration (B18):** Start actual Effect server, connect WebSocket RPC client, verify events flow end-to-end. Test: dispatch command → event emitted → client receives → store updated.
7. **E2E (B21):** Playwright — board load → card click → detail panel <1s → terminal view → all action buttons work

---

## Acceptance Criteria

| Bead | Metric | Target |
|------|--------|--------|
| B0 | Bun install + existing tests pass | No regressions |
| B5 | Effect server running, health + RPC | Functional |
| B18 | All 185 routes correct responses | Zero regressions |
| B18 | All existing tests pass | 223/223 |
| B19 | Detail panel open time | <1 second |
| B19 | HTTP req/min (kanban board) | <5 (from 80+) |
| B20 | Terminal streams via RPC, both runtimes | Zero HTTP polling |
| B21 | Express/socket.io removed | Zero deps |
| B21 | `index.ts` deleted | 15,777 lines gone |

---

## Risk Assessment (Post-Investigation)

| Risk | Level | Finding | Mitigation |
|------|-------|---------|------------|
| Effect 4.x beta | 🟡 Medium | Effect recommends v3 for prod. T3Code runs beta.43 in prod. | Pin exact `4.0.0-beta.43`. T3Code is canary. |
| node-pty + Bun | ✅ Resolved | Native addon won't work in Bun. T3Code uses `Bun.spawn()` native PTY. | Dual-runtime PTY: Bun.spawn() on Linux, node-pty on Node. |
| Build system | ✅ Resolved | T3Code uses tsdown + Vite. Bun executes TS natively in dev. | Replace esbuild with tsdown. `bun run` for dev. |
| 185 routes | 🟡 Medium | Large scope. | 12 parallel agents, each isolated to one file. |
| Merge conflicts | ✅ Resolved | Each agent creates ONE file, B18 integrates. | No shared file modifications during parallel work. |
| Frontend state timing | 🟢 Low | React Query → Zustand is well-understood migration. | Keep React Query for external data (git status). |
| SQLite runtime | ✅ Resolved | T3Code has dual-runtime SQLite with auto-detection. | Copy pattern: Bun native sqlite / node:sqlite. |
