# PAN-485: Add workspace lifecycle events to fix stale UI after wipe/cleanup/abort

## Status: Planning Complete

## Problem

Workspace operations (deep-wipe, cleanup, abort-planning, start-planning) complete on the backend but don't emit domain events for workspace lifecycle changes. The frontend relies on tracker poll cycles (1-3s) to detect changes, causing stale UI. The event-sourced architecture is designed to handle this — we just need to wire up the missing events.

## Decisions

1. **Both wipe events**: Emit `workspace.wipe_started` immediately (UI shows spinner), then `workspace.destroyed` on completion.
2. **Separate `workspace.created`**: Add distinct event even though `planning.started` already exists. Separates workspace lifecycle from planning lifecycle.
3. **`workspace.aborted` as single event**: New event type rather than reusing `agent.stopped`. The reducer handles both agent removal and workspace state in one event.

## Approach

### Layer 1: Contracts (packages/contracts/)

**events.ts** — Define 5 new event schemas:
- `WorkspaceCreatedEvent` — `{ issueId, workspacePath }`
- `WorkspaceWipeStartedEvent` — `{ issueId }`
- `WorkspaceDestroyedEvent` — `{ issueId }`
- `WorkspaceDeletedEvent` — `{ issueId }`
- `WorkspaceAbortedEvent` — `{ issueId, sessionName? }`

Add all 5 to the `DomainEvent` union.

**event-reducers.ts** — Add reducer cases:
- `workspace.created` → no-op (planning.started already handles agent state)
- `workspace.wipe_started` → update issue in `issuesRaw` to show `wiping` transitional state
- `workspace.destroyed` → remove all agents for the issue from `agentsById`, patch issue status to `todo`
- `workspace.deleted` → same as destroyed (remove agents, reset status)
- `workspace.aborted` → remove planning agent from `agentsById`

### Layer 2: Server Routes (src/dashboard/server/routes/issues.ts)

- **start-planning** (~line 531): Emit `workspace.created` after worktree setup, before `planning.started`
- **abort-planning** (~line 740): Emit `workspace.aborted` after tmux kill-session
- **cleanup-workspace** (~line 1518): Emit `workspace.deleted` after successful cleanup
- **deep-wipe** (~line 1532): Emit `workspace.wipe_started` at start, `workspace.destroyed` at end

### Layer 3: No Frontend Changes Needed

The shared reducer in `@panopticon/contracts` is used by both the server read model and the frontend Zustand store. Once the reducer handles the new events, the frontend reacts automatically via the existing WebSocket event stream.

## Files Changed

| File | Change |
|---|---|
| `packages/contracts/src/events.ts` | 5 new event schemas + union update |
| `packages/contracts/src/event-reducers.ts` | 5 new reducer cases |
| `src/dashboard/server/routes/issues.ts` | Emit events in 4 routes |

## Risks

- **Low**: The `default: { void (event as never) }` exhaustiveness check ensures TypeScript catches any missing reducer cases at compile time.
- **Low**: Existing `issue.statusChanged` events in some routes provide a fallback — new events add immediacy, not correctness.
- **Rebuild contracts**: After modifying contracts, `npm run build` in `packages/contracts/` is required before server/frontend can use the new types.
