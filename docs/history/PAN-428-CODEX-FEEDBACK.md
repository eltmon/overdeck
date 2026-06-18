# PAN-428 Codex Feedback

## Overall

The direction makes sense: the dashboard transport and state model are fragmented enough that a stronger server/data-layer architecture is warranted. The PRD is strongest where it proposes a shared contracts package, a batched workspace-detail API, and a single transport/recovery story.

The main problems are that the PRD currently over-simplifies the existing codebase, understates a few breaking/tooling implications, and has one important architectural contradiction: it wants to eliminate blocking behavior while explicitly avoiding rewrites of the blocking library code that the dashboard already depends on.

## High-priority corrections

### 1. The current dashboard already has a real data layer; the problem is inconsistency, not total absence

The PRD frames the current state as aggressive duplicated polling on top of a giant Express file. That is partly true, but it misses the fact that there is already a central issue pipeline:

- `src/dashboard/server/services/issue-data-service.ts`
- `src/dashboard/server/services/cache-service.ts`

`IssueDataService` already does:

- background polling per tracker
- GitHub ETag handling
- cache-backed cold start
- socket snapshot/update push
- rate-limit backoff

So the current problem is more specific:

- issues/board data is already partially centralized
- many other views are still component-local React Query polls
- live updates are split across Socket.io, raw WebSocket terminal streams, and HTTP polling

Recommendation:

- revise the problem statement from "no real data layer" to "partially centralized issue data plus many inconsistent per-view polling models"
- make it explicit which domains move to the new store first: board, detail panel, planning, resources, God View, terminal

### 2. "Wrap existing libs in Effect" does not fix the blocking-call problem

This is the most important architectural issue in the PRD.

The PRD says:

- go full Effect to avoid recurring blocking-call bugs
- do not rewrite `src/lib/*`
- route handlers should wrap existing code with `Effect.tryPromise()`

That is not enough. If the underlying implementation is synchronous, wrapping it in Effect does not make it non-blocking.

Concrete examples:

- `src/lib/tmux.ts` still uses `execSync` for core session operations
- `src/dashboard/server/index.ts` still uses many sync filesystem calls on hot paths
- many existing dashboard/lib paths still use `readFileSync`/`writeFileSync`

Recommendation:

- explicitly classify which library paths must be rewritten, not merely wrapped
- at minimum, identify all dashboard-hot code paths that still call sync child-process or sync filesystem APIs
- update Rule #1 in the PRD: "do not rewrite `src/lib/*`" is too strong if the migration goal is to remove event-loop blocking

### 3. The storage plan should not introduce a third SQLite story without justification

The PRD proposes a new `~/.panopticon/dashboard-events.db`.

The repo already has:

- `~/.panopticon/cache.db` via `src/dashboard/server/services/cache-service.ts`
- `~/.panopticon/panopticon.db` via `src/lib/database/index.ts`

So PAN-428 currently implies three SQLite databases unless the design is clarified.

Recommendation:

- decide whether event storage belongs in `panopticon.db`
- if `dashboard-events.db` is intentional, explain why it is separate from both the cache DB and the unified app DB
- define ownership, migrations, retention, and backup expectations up front

Related gap:

- the PRD does not define retention/compaction for replayable events
- current resources/God View behavior includes frequent timer-driven updates; persisting every volatile sample would grow quickly

### 4. The toolchain/runtime section is not fully aligned with the repo as it exists today

A few examples:

- root `package.json` already declares workspaces for `src/dashboard/server` and `src/dashboard/frontend`
- the same file also references a root `packages/shared` workspace that does not exist in this repo root
- the target workspace config in the PRD omits `src/dashboard/server` even though the server still appears to remain a separate package
- there are multiple `package-lock.json` files, not just the root one:
  - root
  - `src/dashboard/`
  - `src/dashboard/server/`
  - `src/dashboard/frontend/`
  - `skills/stitch-react-components/`
  - generated `workspaces/feature-*` copies

Recommendation:

- specify whether `src/dashboard/server/package.json` survives as a workspace package or is collapsed into the root package
- do not describe lockfile cleanup as if this were a single-lockfile repo
- explicitly exclude generated feature-worktree lockfiles from destructive cleanup

### 5. The dist/output migration has more blast radius than the PRD currently captures

Changing from:

- `dist/dashboard/server.js`
- `dist/dashboard/public/`

to:

- `dist/server/index.mjs`
- `dist/web/`

requires more than a build-script edit.

Current code depends on the old shape in multiple places:

- `src/cli/index.ts` looks for bundled server at `dist/dashboard/server.js`
- `src/dashboard/frontend/vite.config.ts` outputs to `dist/dashboard/public`
- `src/dashboard/server/index.ts` has static-file serving assumptions around the current dashboard output
- `src/dashboard/server/index.ts` also has a build-freshness check hard-coded to `server.js`

Recommendation:

- add an explicit migration checklist for CLI startup, static asset lookup, build freshness checks, and any packaging docs/scripts that reference current dist paths

### 6. The contracts/package publishing story is underspecified for an npm-distributed CLI

The PRD proposes:

- `packages/contracts/package.json`
- `exports: { ".": "./src/index.ts" }`

That is fine for local Bun/Vite dev, but Overdeck is published as an npm CLI and the root package currently only ships:

- `dist`
- `templates`
- `skills`
- `scripts`
- docs/license files

If the production server runtime imports `@panopticon/contracts` at runtime, the package needs a real build/distribution story. Exporting raw TS source alone is not enough unless the server build fully bundles it away.

Recommendation:

- decide whether contracts are build-only and always bundled into server/frontend artifacts
- or compile/publish the contracts package as part of the shipped npm artifact
- make this explicit in B0/B1, otherwise the production runtime plan is incomplete

### 7. The event mapping table is incomplete, and one mapping is wrong

The PRD correctly notices the Socket.io event sprawl, but the mapping table is not yet accurate enough.

Concrete issues:

- `plan:subitem-status-changed` exists in the server and is currently consumed by `PlanDAG.tsx`, but it is not listed in the PRD mapping table
- `planning:sync` is not "planning completed"
  - in current code it is emitted when planning artifacts/discussions are uploaded or synced
  - mapping it to `planning.completed` would collapse two different concepts
- the current transport model is not just Express + Socket.io; it is Express + Socket.io + raw `ws` for `/ws/terminal`

Recommendation:

- split "artifact synced/imported" from "planning completed"
- include the subitem event explicitly, even if it maps to the same domain reducer
- document the raw terminal WebSocket as a first-class migration concern

### 8. "Exactly 1 WebSocket connection" is not realistic without a clear ownership plan

Today the frontend opens multiple live connections:

- `useSocketIssues.ts`
- `useResourceStats.ts`
- `useGodViewSocket.ts`
- `PlanDialog.tsx`
- `PlanDAG.tsx`
- `XTerminal.tsx` uses raw `WebSocket` for `/ws/terminal`

So the PRD is right to target connection consolidation, but "exactly 1" needs clarification:

- is terminal traffic multiplexed over the same RPC socket?
- or does terminal remain a dedicated stream?

If terminal remains separate, "exactly 1 WebSocket connection" is not a valid acceptance criterion.

Recommendation:

- define a transport ownership model
- distinguish "one shared app-level RPC socket" from "one total WebSocket in the browser"

### 9. The detail-panel scope in the PRD is too narrow for the current frontend

The canonical detail path today is:

- `DetailPanelLayout.tsx`
- `InspectorPanel.tsx`
- `TerminalPanel.tsx`

Current fan-out for an open issue includes separate queries for:

- workspace info
- review status
- PRD content
- issue costs
- agent output polling

There are also older overlapping panels still in the repo:

- `IssueDetailPanel.tsx`
- `WorkspacePanel.tsx`

Recommendation:

- make `getWorkspaceDetail` the explicit replacement for all of the inspector-side fan-out, not just workspace info
- say whether `IssueDetailPanel.tsx` and `WorkspacePanel.tsx` are dead code to delete or migration targets to preserve

### 10. B20 does not fully account for the current terminal surface area

The PRD mentions migrating `TerminalPanel.tsx`, but the more important live terminal today is `XTerminal.tsx`, used by `PlanDialog.tsx` over raw `/ws/terminal`.

That means there are really two terminal use cases:

- passive log tail / output panel
- interactive PTY attach with resize/input behavior

Recommendation:

- define whether `subscribeTerminal` replaces `XTerminal.tsx`, `TerminalPanel.tsx`, or both
- define whether `subscribeAgentOutput` remains a separate lighter-weight stream for passive viewing

### 11. The resources event model is too narrow for the current resources UI

The current resources surface is not just "containers became ready."

Current code includes:

- `src/lib/docker-stats.ts` with rolling stats/history
- `ResourcesPanel.tsx`
- `/api/resources/:containerId/history`

The PRD's event catalog only mentions `workspace.containers-ready`, which is a transition event, not a telemetry model.

Recommendation:

- decide whether resources telemetry stays as HTTP polling/history endpoints
- or add an explicit ephemeral resource-stats stream
- do not assume a readiness event covers the existing Resources UI requirements

### 12. The dependency DAG has one sequencing problem

B18 says it creates shared Effect service wrappers needed by multiple route modules.

But B6-B17 are supposed to run in parallel immediately after B5.

If route modules depend on shared service wrappers, those wrappers cannot first appear in B18.

Recommendation:

- move shared service wrappers into B3/B5
- or explicitly allow route beads to create the service wrappers they need
- otherwise the parallelization plan is internally inconsistent

## Lower-priority corrections

### Node-version story needs one clear answer

The repo currently says different things in different places:

- root `package.json` engine says `>=18`
- README says Node 22+
- the PRD assumes Node 22 and references `node:sqlite`

Recommendation:

- make PAN-428 choose one supported production Node floor and update all three places together

### Hard-coded exact test counts are brittle

The "223/223" acceptance checks will drift.

Recommendation:

- prefer "all current tests pass in CI" unless the point of the PRD is to freeze an exact baseline count

## What the PRD gets right

- The route-count decomposition matches the current server shape.
- Moving shared transport/schema definitions into a dedicated contracts package is the right cleanup.
- A batched detail/snapshot model is the right response to the current panel fan-out.
- The dual-runtime PTY investigation aligns with the current raw terminal implementation and its resize/deferred-spawn constraints.
- Consolidating transport/recovery logic is worth doing; the current frontend really does have too many independent poll/socket entry points.

## Suggested PRD edits before implementation starts

If I were tightening the PRD before execution, I would make these changes first:

1. Rewrite the problem statement to reflect the existing `IssueDataService`/SQLite cache layer.
2. Relax the "do not rewrite `src/lib/*`" rule and explicitly identify blocking libs that must change.
3. Clarify the database strategy: `cache.db`, `panopticon.db`, and the proposed event store.
4. Clarify workspace/package ownership: root/server/frontend/contracts and which lockfiles are in scope.
5. Add a packaging/distribution section for `@panopticon/contracts` and the new dist layout.
6. Fix the event mapping table, especially `planning:sync`, `plan:subitem-status-changed`, and raw terminal transport.
7. Expand B20 to cover `XTerminal.tsx` and the interactive PTY path.
8. Move shared service-wrapper creation earlier in the DAG.
