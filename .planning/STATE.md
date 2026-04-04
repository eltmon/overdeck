# PAN-428: Dashboard Data Layer — Consolidate Polling, Push-First Architecture

## Status: Planning Complete

## Problem

The dashboard takes 5-20+ seconds to open a workspace detail panel. Root cause: 80+ HTTP requests/minute from aggressive, duplicated polling (three independent `/api/issues` fetches at 1.3MB each with different React Query keys). The browser's 6-connection HTTP/1.1 limit through Traefik queues foreground requests behind background polls.

The 15,793-line monolithic `src/dashboard/server/index.ts` with 185 Express routes compounds the problem — no separation of concerns, recurring `execSync` bugs, three uncoordinated transport paradigms (socket.io, raw WebSocket, HTTP polling).

## Decision

**Full Effect.js migration** — replace Express and socket.io entirely with Effect's HTTP server + WebSocket RPC. Single paradigm, single error model, async-by-default. Modeled on T3Code's production architecture (`/home/eltmon/Projects/t3code`).

### Key Architectural Choices

1. **Effect 4.0.0-beta.43** (pinned exact) — required for `unstable/http` and RPC APIs. T3Code is the canary.
2. **Bun** as package manager + dev runtime, Node 22 for production (npm distribution).
3. **Shared contracts package** (`packages/contracts/` → `@panopticon/contracts`) — event schemas, RPC definitions, shared types.
4. **Event-driven architecture** — SQLite event store + PubSub for live streaming, Zustand store on frontend with pure event reducers.
5. **Single multiplexed WebSocket** — replaces socket.io + raw WS + HTTP polling.
6. **12 parallel route modules** — each agent creates one file, B18 wires them together.

### What Does NOT Change

- `src/lib/*` modules stay as-is (agents, cloister, costs, tmux, etc.) — route handlers wrap them in Effect.
- API response shapes are preserved exactly (same URLs, same JSON, same status codes).
- CLI (`src/cli/`) is untouched.
- Database schema (cost_events, review_status, etc.) is unchanged — only an `events` table is added.

## Scope

Full PRD scope: 22 beads (B0–B21) as specified in `docs/prds/planned/pan-428-dashboard-data-layer-architecture.md`.

### In Scope
- Bun toolchain migration (package manager, dev runtime, workspace config)
- `@panopticon/contracts` package (event schemas, RPC definitions, shared types)
- SQLite event store with PubSub
- Effect.js HTTP server with dual-runtime support (Bun dev, Node prod)
- WebSocket RPC (subscribeDomainEvents, subscribeTerminal, subscribeAgentOutput, getSnapshot, etc.)
- 12 route modules replacing the monolithic index.ts
- Frontend transport layer (WsTransport + auto-reconnect)
- Zustand store with event reducers replacing React Query polling
- Recovery coordinator for sequence gaps
- Terminal streaming via RPC (dual-runtime PTY: Bun.spawn + node-pty)
- Deletion of Express, socket.io, cors, ws dependencies
- Playwright E2E verification
- Version bump to 0.6.0

### Out of Scope
- CLI refactoring
- `src/lib/*` module rewrites (only wrapping in Effect services)
- Database schema changes (beyond adding events table)
- New features — this is a pure architectural migration

## Parallelization Strategy

- **Sequential chain**: B0 → B1 → {B2, B3, B4} → B5 → {B6–B17} → B18 → {B19, B20} → B21
- **Maximum parallelism**: 12 agents on route modules (B6–B17), 3 agents on B2/B3/B4, 2 agents on B19/B20
- **Merge isolation**: Each route agent creates ONE file. No shared file modifications during parallel work. B18 (integration) wires everything together.

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Effect 4.x beta instability | Pin exact `4.0.0-beta.43`. T3Code is canary. |
| 185 routes — large scope | 12 parallel agents, each isolated to one route file |
| Merge conflicts | Each agent creates ONE file, B18 integrates |
| node-pty + Bun incompatibility | Dual-runtime PTY: Bun.spawn() on Linux, node-pty on Node |
| Frontend regression | Preserve exact API response shapes, Playwright E2E in B21 |

## Difficulty Estimates

| Bead | Difficulty | Model | Rationale |
|------|-----------|-------|-----------|
| B0 | medium | sonnet | Toolchain migration, workspace config, verify builds |
| B1 | complex | sonnet | ~25 event schemas, RPC definitions, shared types |
| B2 | complex | sonnet | SQLite event store, dual-runtime, PubSub, retention |
| B3 | simple | sonnet | Env var wrapping, straightforward Effect service |
| B4 | complex | sonnet | WsTransport, Zustand store, recovery coordinator, selectors |
| B5 | expert | opus | Server skeleton, RPC handlers, dual-runtime HTTP, all service wrappers |
| B6 | medium | sonnet | 17 issue routes |
| B7 | medium | sonnet | 20 agent routes |
| B8 | medium | sonnet | 19 workspace routes |
| B9 | complex | sonnet | 33 specialist routes (largest module) |
| B10 | medium | sonnet | 11 cost routes |
| B11 | medium | sonnet | 9 cloister routes |
| B12 | simple | sonnet | 8 resource routes |
| B13 | simple | sonnet | 7 mission-control routes |
| B14 | medium | sonnet | 9 remote routes (SSH/Fly.io) |
| B15 | simple | sonnet | 6 settings routes |
| B16 | simple | sonnet | 11 metrics + convoys routes |
| B17 | complex | sonnet | 35 misc routes (catch-all) |
| B18 | expert | opus | Wire all routes + fibers, full integration test |
| B19 | complex | sonnet | Migrate 7+ components from React Query to Zustand store |
| B20 | expert | opus | Dual-runtime PTY, terminal RPC, deferred spawn, stale suppression |
| B21 | complex | sonnet | Delete 15K lines, remove deps, Playwright verification, version bump |

## Reference

- **PRD**: `docs/prds/planned/pan-428-dashboard-data-layer-architecture.md`
- **T3Code**: `/home/eltmon/Projects/t3code` (server.ts, ws.ts, rpc.ts, store.ts, wsTransport.ts)
- **Current server**: `src/dashboard/server/index.ts` (15,793 lines, 185 routes)

## Specialist Feedback

- **[2026-04-04T01:49Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/001-review-agent-changes-requested.md`
- **[2026-04-04T01:56Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/002-review-agent-changes-requested.md`
