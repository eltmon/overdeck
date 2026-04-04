# PAN-449: Refactor Route Handlers to Idiomatic Effect

## Status: Planning Complete

## Decision Log

### Scope: Full refactor — all 4 services, all 13 routes, CLI callers, full test suite
- Extract TrackerClients (LinearClient, GitHubClient, RallyClient)
- Extract IssueLifecycle service
- Extract AgentSpawner service (replaces src/lib/agents.ts)
- Extract WorkspaceService (replaces src/lib/workspace-manager.ts)
- Refactor all 13 route files to use new services
- Update ~15 CLI command files that import from replaced lib modules

### Lib strategy: Replace, not wrap
- src/lib/agents.ts → AgentSpawner Effect service (new canonical implementation)
- src/lib/workspace-manager.ts → WorkspaceService Effect service
- CLI commands updated to use Effect runtime (runPromise/runSync)

### Effect pattern: ServiceMap.Service + Layer.effect
- Matches existing EventStoreService and TerminalService patterns
- All services use typed errors (Data.TaggedError)

### Testing: Full suite as described in issue
- Unit tests for each service (tracker clients, lifecycle, spawner, workspace)
- Integration tests for route→service→Effect chains
- Error channel tests for consistent error responses

## Architecture

### New Services (src/dashboard/server/services/)

```
typed-errors.ts          — Shared error types (TrackerNotConfigured, IssueNotFound, RateLimited, etc.)
linear-client.ts         — LinearClient service (getIssue, updateState, getTeamStates, addComment)
github-client.ts         — GitHubClient service (getIssue, addLabel, removeLabel, createComment, closeIssue)
rally-client.ts          — RallyClient service (getIssue, updateState)
issue-lifecycle.ts       — IssueLifecycle service (transitionTo, addLabel, removeLabel, close)
agent-spawner.ts         — AgentSpawner service (startWork, startPlanning, kill, deepWipe)
workspace-service.ts     — WorkspaceService service (create, clean, containerize)
```

### Dependency Graph

```
LinearClient, GitHubClient, RallyClient
         ↓
    IssueLifecycle  (uses tracker clients + EventStoreService + issue-data-service cache)
         ↓
    AgentSpawner    (uses IssueLifecycle + WorkspaceService)
         ↓
    WorkspaceService (standalone, uses git/docker commands)
```

### Layer Composition (server.ts)

```typescript
const ServicesLive = Layer.mergeAll(
  LinearClientLive,
  GitHubClientLive,
  RallyClientLive,
).pipe(
  Layer.provideMerge(IssueLifecycleLive),
  Layer.provideMerge(WorkspaceServiceLive),
  Layer.provideMerge(AgentSpawnerLive),
);
```

### Typed Errors

```typescript
// src/dashboard/server/services/typed-errors.ts
export class TrackerNotConfigured extends Data.TaggedError("TrackerNotConfigured")<{ tracker: string }> {}
export class IssueNotFound extends Data.TaggedError("IssueNotFound")<{ id: string }> {}
export class RateLimited extends Data.TaggedError("RateLimited")<{ retryAfter: number }> {}
export class WorkspaceNotFound extends Data.TaggedError("WorkspaceNotFound")<{ id: string }> {}
export class AgentAlreadyRunning extends Data.TaggedError("AgentAlreadyRunning")<{ id: string }> {}
export class BeadsNotInitialized extends Data.TaggedError("BeadsNotInitialized")<{ workspace: string }> {}
export class PlanEmpty extends Data.TaggedError("PlanEmpty")<{ id: string }> {}
```

### Route Refactoring Pattern

Before:
```typescript
Effect.tryPromise({
  try: async () => {
    const apiKey = getLinearApiKey();
    if (!apiKey) return jsonResponse({ error: '...' }, { status: 500 });
    const res = await fetch('https://api.linear.app/graphql', { ... });
    // ... 40 more lines
  },
  catch: (err) => new Error(String(err)),
});
```

After:
```typescript
Effect.gen(function* () {
  const linear = yield* LinearClient;
  const issue = yield* linear.getIssue(id);
  yield* IssueLifecycle.transitionTo(id, 'In Progress');
  return jsonResponse({ success: true, issue });
}).pipe(
  Effect.catchTag('TrackerNotConfigured', () => jsonResponse({ error: '...' }, { status: 500 })),
  Effect.catchTag('IssueNotFound', () => jsonResponse({ error: '...' }, { status: 404 })),
);
```

### CLI Caller Updates

Files importing from lib/agents.ts (12 files):
- src/cli/commands/work/issue.ts, kill.ts, tell.ts, status.ts, health.ts, pending.ts, recover.ts, approve.ts, wipe.ts, done.ts
- src/cli/commands/workspace.ts
- src/dashboard/server/services/agent-enrichment-service.ts

Files importing from lib/workspace-manager.ts (3 files):
- src/cli/commands/workspace.ts, workspace-migrate.ts

CLI pattern: import service, provide layers, runPromise:
```typescript
import { AgentSpawner, AgentSpawnerLive } from '../../dashboard/server/services/agent-spawner.js';

const result = await Effect.gen(function* () {
  const spawner = yield* AgentSpawner;
  return yield* spawner.kill(agentId);
}).pipe(
  Effect.provide(AgentSpawnerLive),
  Effect.runPromise,
);
```

## Implementation Order

### Phase 1: Foundation (typed errors + tracker clients)
1. **typed-errors.ts** — Define all shared error types
2. **linear-client.ts** + tests — Extract Linear GraphQL calls
3. **github-client.ts** + tests — Extract GitHub REST calls  
4. **rally-client.ts** + tests — Extract Rally WSAPI calls

### Phase 2: Domain services
5. **issue-lifecycle.ts** + tests — Extract state transitions, label management, close-out
6. **workspace-service.ts** + tests — Extract workspace create/clean/containerize
7. **agent-spawner.ts** + tests — Extract agent start/stop/kill/deepWipe

### Phase 3: Route refactoring
8. **Refactor big routes** — issues.ts, agents.ts, specialists.ts, workspaces.ts, mission-control.ts, misc.ts
9. **Refactor small routes** — settings.ts, remote.ts, costs.ts, metrics.ts, resources.ts, conversations.ts, cloister.ts
10. **Update server.ts** — Wire new service layers into composition

### Phase 4: CLI + integration
11. **Update CLI callers** — All 15 files importing from replaced lib modules
12. **Integration tests** — Route→service→Effect chain tests
13. **Error channel tests** — Consistent error response validation

## Estimated Impact

| Metric | Before | After |
|--------|--------|-------|
| Route handler lines | 15,399 | ~5,000 |
| Service lines | 2,442 | ~5,500 |
| Total server code | ~18K | ~12K |
| Duplicated tracker API calls | ~40 | 0 |
| Duplicated state transitions | ~29 | 0 |
| Typed error handling | 0 endpoints | all endpoints |
| Effect.tryPromise wrappers | 133 | 0 |
| Test coverage (server) | 204 lines / 2 files | ~2,000 lines / 10+ files |

## Risks

1. **Blast radius** — Touches every route + 15 CLI files. Must pass typecheck/lint/test gates.
2. **CLI runtime** — CLI commands currently don't use Effect runtime. Need to ensure runPromise doesn't add latency to CLI startup.
3. **Existing service interactions** — issue-data-service.ts (1016L) is a plain class used by routes. IssueLifecycle will need to integrate with or subsume its cache-patching logic.
4. **postMergeLifecycle idempotency** — PAN-328 guards in specialists.ts MUST be preserved during refactor.
5. **Deep-wipe safety** — AgentSpawner.deepWipe must retain the explicit confirmation parameter requirement.
