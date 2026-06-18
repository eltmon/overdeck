# t3code Drift Plan

**Goal:** Hand-port Overdeck CLI toward the t3code upstream codebase where the patterns are cleaner, while preserving Overdeck's unique multi-agent orchestration functionality. Effort is not a constraint; architectural clarity is.

**Companion research:** [`t3code-research.md`](./t3code-research.md) — what t3code is, how it's laid out, what's already been mirrored.

**Scope anchors:**
- Overdeck is on `effect@4.0.0-beta.43`; upstream and t3code are on `4.0.0-beta.48`.
- PAN-428 (server split) and PAN-521 (store atomic slices) are **already landed** and match t3code's architecture. Confirmed in [`src/dashboard/server/ws-rpc.ts`](../../src/dashboard/server/ws-rpc.ts) and [`src/dashboard/frontend/src/lib/store.ts`](../../src/dashboard/frontend/src/lib/store.ts).
- t3code `main` is 107 commits ahead of the local clone at `/home/eltmon/Projects/t3code`.

---

## 0. Prerequisite: Effect beta.43 → beta.48 bump

This is the blocking prerequisite for everything else. Every other theme below assumes the Effect surface has been moved forward first.

### 0.1 The breaking change

Between beta.43 and beta.48, Effect renamed `ServiceMap` back to `Context` across the entire public API. This is not cosmetic — every import, type reference, and call site changes:

| beta.43                              | beta.48                              |
| ------------------------------------ | ------------------------------------ |
| `import * as ServiceMap from "effect/ServiceMap"` | `import * as Context from "effect/Context"` |
| `ServiceMap.ServiceMap<R>`           | `Context.Context<R>`                 |
| `ServiceMap.Service<I, S>`           | `Context.Service<I, S>`              |
| `ServiceMap.Key<I, S>`               | `Context.Key<I, S>`                  |
| `ServiceMap.Reference(...)`          | `Context.Reference(...)`             |
| `ServiceMap.get(services, Tag)`      | `Context.get(context, Tag)`          |
| `ServiceMap.getUnsafe(services, Tag)`| `Context.getUnsafe(context, Tag)`    |
| `ServiceMap.makeUnsafe(map)`         | `Context.makeUnsafe(map)`            |
| `Effect.services<R>()`               | `Effect.context<R>()`                |
| `Effect.servicesWith((services) => …)` | `Effect.contextWith((context) => …)` |
| `Effect.provideServices(eff, svcMap)`| `Effect.provideContext(eff, ctx)`    |
| `fiber.services.mapUnsafe`           | `fiber.context.mapUnsafe`            |

Verified by diffing `v43/src/unstable/rpc/RpcServer.ts`, `v43/src/unstable/rpc/RpcGroup.ts`, and `v43/src/unstable/http/HttpRouter.ts` against v48. The rename happened in one of beta.44–.47.

### 0.2 Files affected in Overdeck

Grep for `ServiceMap|Effect\.services|provideServices|\.services\.mapUnsafe` returns 11 dashboard server files:

- `src/dashboard/server/services/terminal-service.ts`
- `src/dashboard/server/services/domain-services.ts`
- `src/dashboard/server/services/issue-lifecycle.ts`
- `src/dashboard/server/services/linear-client.ts`
- `src/dashboard/server/services/rally-client.ts`
- `src/dashboard/server/services/agent-spawner.ts`
- `src/dashboard/server/services/openrouter-service.ts`
- `src/dashboard/server/services/github-client.ts`
- `src/dashboard/server/services/workspace-service.ts`
- `src/dashboard/server/read-model.ts`
- `src/dashboard/server/config.ts`

Plus a second breaking change in `RpcServer`: inside RPC handler middleware, `{ clientId: number }` becomes `{ client: Rpc.ServerClient }`. Overdeck's `ws-rpc.ts` does not currently read `clientId`, but any future middleware will use the new shape.

### 0.3 Execution

1. `bun add effect@4.0.0-beta.48` at the repo root (Bun workspaces propagate it).
2. Global rename across the 11 files: `ServiceMap` → `Context` (module + type refs), `Effect.services` → `Effect.context`, `Effect.provideServices` → `Effect.provideContext`, `Effect.servicesWith` → `Effect.contextWith`, `.services.mapUnsafe` → `.context.mapUnsafe`.
3. Rebuild: `npm run build` (tsdown) — must pass.
4. `npm run typecheck` — must pass clean.
5. Smoke test: `pan up` + open dashboard + verify `/ws/rpc` snapshot loads + `/ws/terminal` renders a session.
6. The `@overdeck/contracts` workspace also pulls Effect transitively; rebuild `packages/contracts` explicitly.

### 0.4 Risk

- The rename is mechanical but volume is large; the typechecker will catch almost all of it.
- `effect/unstable/http` and `effect/unstable/rpc` are still marked "unstable" — minor shape changes beyond the rename are possible. Diff any call site that fails to compile against `v48/src/unstable/...` for the exact new signature.
- `packages/contracts` defines `PanRpcGroup` using `RpcGroup` — its public type may surface `Context.Context<…>` where it used to surface `ServiceMap.ServiceMap<…>`. Downstream imports will need the same rename.

---

## 1. WebSocket architecture: diverge deliberately

This is the most important architectural decision in this plan. The user explicitly asked for the better long-term solution even if it means diverging — and large effort is **not** a valid reason to keep the old shape.

### 1.1 What t3code does

- **One** WebSocket endpoint: `/ws`, served by `HttpRouter.add("GET", "/ws", RpcServer.toHttpEffectWebsocket(WsRpcGroup))` in [`apps/server/src/ws.ts`](../../../t3code/apps/server/src/ws.ts).
- A single `WsRpcGroup` declares **every** RPC: snapshot, dispatch, domain events, terminal (`terminalOpen/Write/Resize/Clear/Restart/Close`, `subscribeTerminalEvents`), git (`gitStatus/Pull/…`), projects, settings, keybindings, shell, lifecycle.
- Terminal data flows as **schema-shaped `TerminalEvent`** objects through the same RpcSerialization.layerJson transport — not raw PTY bytes. Server owns a `TerminalManager` with a per-session history buffer (default 5000 lines), debounced persistence (40 ms), inactive-session GC (128 retained), and dual-runtime PTY (Bun or Node).
- Server-owned sessions: the server keeps the PTY alive independent of client connections; clients subscribe for replay + live events.

### 1.2 What Overdeck does today

- **Two** WebSocket endpoints:
  - `/ws/rpc` — Effect RPC (`PanRpcGroup`) for snapshots, domain events, conversation stream. [`ws-rpc.ts`](../../src/dashboard/server/ws-rpc.ts).
  - `/ws/terminal?session=<name>` — **raw** `ws` WebSocketServer with `noServer: true`, spawning `node-pty` against `tmux attach-session`. [`ws-terminal.ts`](../../src/dashboard/server/ws-terminal.ts). A shared `pty-hub.ts` fans one PTY out to many browser tabs (PAN-484).
- The raw path exists because a previous attempt to run terminal data through the Effect RPC stream (`subscribeTerminal` in `ws-rpc.ts`) "queued terminal data but never delivered it to the browser" — comment at top of `ws-terminal.ts`. That was on pre-PAN-435 Effect.
- `PanRpcGroup` still declares `subscribeTerminal` / `terminalOpen/Write/Resize/Close` via a `TerminalService`, but the browser doesn't use them.

### 1.3 Recommendation: migrate to single `/ws` with structured `TerminalEvent`

Adopt t3code's architecture for terminal transport. Reasoning, not ranked:

- One WebSocket, one serialization layer, one reconnect policy, one auth check. Overdeck's monkey-patch of `server.on('upgrade', …)` in `ws-terminal.ts` to route `/ws/terminal` around Effect's handler is a workaround, not a design choice — it exists because the raw path was bolted on after the Effect path stopped working. The forcing function is gone.
- Structured `TerminalEvent` (schema-typed) is better than raw bytes for observability, replay, and adding server-owned history buffers. The t3code `TerminalManager` already solved history replay on reconnect — which Overdeck also wants for browser tab reloads.
- The original "queueing never delivered" bug was in older Effect RPC stream plumbing; `RpcServer.toHttpEffectWebsocket` in beta.48 is the same primitive t3code uses in production today, so the historical reason to diverge no longer applies.
- Overdeck's `pty-hub.ts` fan-out (one PTY, many subscribers) maps cleanly onto t3code's server-owned session model — `TerminalManager` already does this upstream.

**What stays Overdeck-specific:** the PTY spawn target is `tmux attach-session -t <name>`, not a bare shell. tmux is Overdeck's substrate for agent sessions and that does not change. We adopt t3code's **transport** (structured events over single `/ws`), not its **backend** (direct shell spawn).

**What stays raw if we're wrong:** if at integration time `TerminalEvent` throughput measurably can't keep up with interactive tmux output (backpressure on JSON serialization of e.g. `fzf` redraws), document the measurement and keep `/ws/terminal` — but that's a measured failure mode, not a prospective one, and must be revisited post-bump since beta.48's stream primitives differ from whatever broke pre-PAN-435.

### 1.4 Work breakdown

1. Bump to beta.48 (section 0) first.
2. In `@overdeck/contracts`, model `TerminalEvent` as a tagged schema union mirroring [`apps/server/src/terminal/Services/Manager.ts`](../../../t3code/apps/server/src/terminal/Services/Manager.ts) — `{ kind: "data" | "exit" | "resize" | "snapshot" | "ready" | "size", … }`.
3. Rewrite `TerminalService` in `src/dashboard/server/services/terminal-service.ts` around a `TerminalManager` contract: per-session history buffer (default 5000 lines), `subscribe()` returning `Stream<TerminalEvent>` that emits a snapshot frame then live deltas, server-owned PTY lifecycle independent of client connections.
4. Wire `subscribeTerminal` in `ws-rpc.ts` to emit `TerminalEvent` through `RpcSerialization.layerJson`. Delete the unused `terminalOpen/Write/Resize/Close` RPC methods if the new `subscribe` returns a duplex, otherwise keep them and delete the stub implementations.
5. Rewrite the frontend `XTerminal.tsx` to consume `subscribeTerminal` via `WsTransport.ts` instead of opening its own raw WebSocket.
6. Delete `src/dashboard/server/ws-terminal.ts`, `src/dashboard/server/pty-hub.ts`, the `server.on('upgrade', …)` monkey-patch, and the `WebSocketServer` dependency for terminal (ws library still needed elsewhere, check).
7. Verify: open two browser tabs on the same workspace terminal, confirm they see the same session and that reloading a tab replays history.

---

## 2. HTTP routes: do NOT migrate wholesale to RPC

This is the **valid architectural reason to diverge** that the user asked me to flag.

### 2.1 Why t3code could collapse HTTP into WebSocket

t3code's server only has 3 HTTP route layers in [`apps/server/src/server.ts`](../../../t3code/apps/server/src/server.ts): `attachmentsRouteLayer`, `projectFaviconRouteLayer`, `staticAndDevRouteLayer`, plus `websocketRpcRouteLayer`. Everything else runs over `/ws`. This works because t3code has **one** audience: the single t3code browser/desktop client that owns the WebSocket connection.

### 2.2 Why Overdeck cannot

Overdeck's HTTP routes serve **two** audiences:

1. **Browser dashboard** — can talk WebSocket RPC, has a persistent connection, already uses `/ws/rpc` for snapshots/events.
2. **Machine-to-machine callers** — Cloister, specialists, `pan tell`, merge-agent, CI webhooks, the CLI itself. These are fire-and-forget HTTP clients that shouldn't hold a WebSocket open per request. They hit endpoints like `POST /api/agents/:id/deep-wipe`, `POST /api/specialists/done`, `POST /api/workspaces/:id/start-agent`, `POST /api/remote/trigger`, `GET /api/workspaces/:id/plan`, etc.

Routing machine-to-machine flows through an RPC WebSocket would:

- Break the CLI and any external webhook (GitHub, Linear) that cannot speak Effect RPC.
- Force every specialist subprocess to open + hold + handshake a WebSocket for each request.
- Make `curl` debugging and log replay impossible.
- Collapse the clean separation where `postMergeLifecycle` idempotency guards and route-level auth live today.

### 2.3 The partition

| Surface                           | Transport     | Rationale                               |
| --------------------------------- | ------------- | --------------------------------------- |
| Dashboard snapshot + domain events| `/ws/rpc`     | Already there; match t3code.            |
| Terminal streaming                | `/ws/rpc` (new `TerminalEvent`) | Section 1 above.      |
| Conversation JSONL streaming      | `/ws/rpc`     | Already there (`subscribeConversationMessages`). |
| Workspace/agent snapshots for dashboard reads | Prefer `/ws/rpc` | Adds no M2M burden. |
| `POST /api/agents/:id/deep-wipe`, `POST /api/specialists/done`, `POST /api/remote/trigger`, `POST /api/workspaces/:id/start-agent`, all `/api/cloister/*` | **Keep HTTP** | M2M callers; idempotency guards; webhook clients. |
| GitHub/Linear webhooks            | **Keep HTTP** | External callers.                       |
| Attachments / static assets       | **Keep HTTP** | Matches t3code.                         |

**Do not** migrate `src/dashboard/server/routes/{agents,cloister,specialists,remote,mission-control,workspaces,issues}.ts` to RPC. They are the agent-orchestration control plane, not browser UI plumbing.

**Do** audit the 15 route files in `src/dashboard/server/routes/` and identify browser-only read endpoints (e.g. things that only the dashboard polls for data the read model already has) — those can become RPC methods and simplify the router.

---

## 3. `58e5f714 Provider skill discovery` — explained and ported

### 3.1 What t3code did

Upstream commit `58e5f714` adds automatic discovery of Claude Code slash commands and Codex skills through the provider SDKs, so the composer's `/` menu shows them grouped by provider without hard-coding.

**Server side** ([`apps/server/src/providers/ClaudeProvider.ts`](../../../t3code/apps/server/src/providers/ClaudeProvider.ts), +109 lines):

- Calls `@anthropic-ai/claude-agent-sdk` `query().initializationResult()` and reads `init.commands` — the SDK itself knows about user/project/local slash commands.
- New helpers `parseClaudeInitializationCommands` and `dedupeSlashCommands` normalize the list.
- `settingSources: []` → `settingSources: ["user", "project", "local"]` in the query options, so the SDK picks up `.claude/commands/*.md` at all three scopes.
- `checkClaudeProviderStatus` grows an optional `resolveSlashCommands` callback.
- Results get cached with `Cache.make({ capacity: 1, timeToLive: Duration.minutes(5), lookup: … })` — skill discovery is expensive so the probe only runs once per five minutes.
- Returns `{ subscriptionType, slashCommands }` extracted via separate `Effect.map` calls.

Codex side ([`apps/server/src/providers/CodexProvider.ts`](../../../t3code/apps/server/src/providers/CodexProvider.ts), +43 lines): `probeCodexAccount` renamed to `probeCodexDiscovery`, gains `cwd` input, new `resolveSkills` callback, new `ServerProviderSkill` type in the contracts.

**Client side** ([`apps/web/src/components/ComposerCommandMenu.tsx`](../../../t3code/apps/web/src/components/ComposerCommandMenu.tsx), +188 lines):

- `ComposerCommandItem` discriminated union grows two new variants: `"provider-slash-command"` and `"skill"`.
- New UI primitives `CommandGroup` / `CommandGroupLabel` / `CommandSeparator` for provider grouping.
- New `SkillGlyph` component.
- New files `composerMenuHighlight.ts`, `composerSlashCommandSearch.ts`, plus tests.
- `formatProviderSkillInstallSource` helper in a new `~/providerSkillPresentation` module.

### 3.2 Why Overdeck wants it

Overdeck's 60 bundled skills in `~/.claude/skills/` are exactly the shape this discovery path would expose automatically. Today Overdeck has no UI to run a skill from the dashboard composer — users have to drop into tmux and type. Porting 58e5f714 gives:

- Live list of installed Claude Code slash commands (including user-added ones under `.claude/commands/`) in the dashboard composer.
- Free integration with the existing `@anthropic-ai/claude-agent-sdk` — Overdeck already uses this SDK for agent spawning.
- 5-minute cached discovery so repeated composer opens are cheap.

### 3.3 Work breakdown

1. Add `ClaudeProvider` / `CodexProvider` modules under `src/dashboard/server/services/providers/` (if they don't exist yet — Overdeck currently launches the SDK through `src/lib/agent-runner.ts`). Wire `query().initializationResult()` + `settingSources: ["user","project","local"]`.
2. Port `parseClaudeInitializationCommands` and `dedupeSlashCommands` verbatim.
3. Add a `Cache.make` wrapper with 5-minute TTL keyed on `cwd`.
4. Add `ProviderSkill` / `ProviderSlashCommand` schemas to `@overdeck/contracts`.
5. Expose over RPC as `getProviderCapabilities(cwd)` — cache hit returns in µs, cache miss runs the probe.
6. Frontend: extend the existing composer (`src/dashboard/frontend/src/components/chat/ComposerPromptEditor.tsx`) with the `provider-slash-command` / `skill` item variants. Reuse `CommandGroup` structure from t3code.
7. Ship `composerMenuHighlight.ts` + `composerSlashCommandSearch.ts` as-is with their tests.

---

## 4. `1ec346c2 Refactor web stores into atomic slices` — explained and mostly no-op

### 4.1 What t3code did

Upstream commit `1ec346c2` (21 files, +1329 / −544) reshapes `apps/web/src/store.ts` from a Zustand store with methods inline into a two-layer structure:

- **Pure reducer functions** exported from `store.ts`: `syncServerReadModel(state, readModel)`, `applyOrchestrationEvent(state, event)`, `applyOrchestrationEvents(state, events)`, `setError(state, threadId, err)`, `setThreadBranch(...)`. These are plain functions over plain state — trivially unit-testable, no hook harness.
- **Parameterized selector factories** also exported from `store.ts`: `selectProjectById(projectId) => (state) => state.projects.find(...)`, `selectThreadById`, `selectSidebarThreadSummaryById`, `selectThreadIdsByProjectId`.
- **Thin Zustand wrapper**: `export const useStore = create<AppStore>((set) => ({ ...initialState, syncServerReadModel: (rm) => set((s) => syncServerReadModel(s, rm)), … }))`.
- **`storeSelectors.ts`**: React hooks that wrap factories with `useMemo` for stable refs — `useProjectById(id)`, `useThreadById(id)`, etc. Consumers subscribe to exactly what they need.

Why: splits `ChatView` into subcomponents that each select their own minimal slice instead of pulling the whole thread state. Avoids the "re-render the world when any thread changes" problem.

Size caps: `MAX_THREAD_MESSAGES = 2000`, `MAX_THREAD_CHECKPOINTS = 500`, `MAX_THREAD_PROPOSED_PLANS = 200`, `MAX_THREAD_ACTIVITIES = 500`.

### 4.2 Overdeck status: already done (PAN-521)

[`src/dashboard/frontend/src/lib/store.ts`](../../src/dashboard/frontend/src/lib/store.ts) already follows this exact pattern:

- Reducers imported and re-exported: `syncSnapshot as syncSnapshotReducer`, `applyEvent as applyEventReducer`, `applyEvents as applyEventsReducer`.
- Selector factories / hooks: `selectAgentList`, `selectAgentById`, `selectSpecialistList`, `selectReviewStatus`, `selectAwaitingMerge`, `selectAgentOutput`, `selectIsBootstrapped`, `selectDashboardLifecycle`, `selectResources`, `selectIssues`, `selectIssuesByCycle`.
- `DashboardState extends ReadModelState`, `DashboardStore extends DashboardState` — same two-layer split.

**Action:** no port required. Validate parity by checking that Overdeck's reducer functions are pure (no closure over the store) and that there are no remaining consumers calling `useStore((s) => s)` to pull the whole state. If 1ec346c2 introduces size caps we don't have, mirror them: check `src/dashboard/server/read-model.ts` for thread-style buffers and add caps if missing.

---

## 5. Chat component drift — cherry-pick, don't re-mirror

Four files under `src/dashboard/frontend/src/components/chat/` were originally hand-ported from t3code in commits `b4519457` and `de034e19` (2026-04-05, PAN-451):

| Overdeck file              | t3code source                                      | Overdeck LOC | Upstream LOC |
| ---------------------------- | -------------------------------------------------- | -------------: | -----------: |
| `ChatMarkdown.tsx`           | `apps/web/src/components/ChatMarkdown.tsx`         | 247            | 300          |
| `MessagesTimeline.tsx`       | `apps/web/src/components/chat/MessagesTimeline.tsx`| 450            | 891          |
| `ComposerPromptEditor.tsx`   | `apps/web/src/components/ComposerPromptEditor.tsx` | 573            | 1177         |
| `session-logic.ts`           | `apps/web/src/components/chat/MessagesTimeline.logic.ts` | 144      | 199          |

They've since been modified by Overdeck-only commits `ef2b3aea` (dedupe), `2a0a328c` (measurement), `e8ffddf2` (persist model), `eb59af05` (virtualizer ref stability). The upstream versions have moved significantly (roughly 2× in LOC) with features Overdeck doesn't have.

**Strategy:** cherry-pick by feature, not by file.

1. Identify the upstream commits that touched these files between `b4519457` and current t3code `main`. Candidates flagged during research: `33dadb5a`, `7c0849fe`, `1bf048eb`, `5467d119`, `869789b4`.
2. For each upstream commit, read the diff, decide whether the feature is in-scope for the Overdeck dashboard.
3. Port the in-scope changes through a three-way merge: (Overdeck-current vs Overdeck-b4519457 vs t3code-main). Preserve the four Overdeck-only modifications above.
4. Do not wholesale replace the files — that would drop dedupe, measurement, persist-model, and ref stability fixes.
5. After each cherry-pick, verify the timeline renders correctly with a real agent conversation in the dashboard.

---

## 6. Themed upstream adoption (the other ~95 commits)

Full enumeration of all 107 commits in `t3code/origin/main` ahead of the local clone, grouped by theme. Applicability column: **Y** = port to Overdeck, **P** = partially applicable (port the idea, not the code), **N** = not applicable (desktop-only, codex-only, or upstream-UI-only), **✓** = already covered by sections 1–5 above.

### 6.1 Effect infrastructure

| SHA | Title | Applies |
| --- | --- | --- |
| `3405a64d` | bump effect to latest beta | ✓ (section 0) |

### 6.2 WebSocket / RPC resilience cluster

This is the most important theme not already in the plan. Upstream spent heavy work hardening the `/ws` transport in the last 50 commits. Overdeck's `WsTransport.ts` in the frontend is likely to have the same failure modes because it uses the same `RpcClient` primitive.

| SHA | Title | Applies |
| --- | --- | --- |
| `f5ecca44` | Clear tracked RPCs on reconnect | **Y** |
| `94d13a2b` | Preserve live stream subscriptions across explicit reconnects | **Y** |
| `f2cd53f2` | Add WebSocket disconnect recovery and slow RPC toast UX | **Y** |
| `e0874b65` | Raise slow RPC ack warning threshold to 15s | **Y** |
| `9bedd714` | Debounce reconnect disconnect logging | **Y** |
| `528bb2a1` | [codex] Harden WebSocket reconnect recovery | **Y** |
| `da107f31` | Fix websocket closing and reopening connections too eagerly | **Y** |
| `70f5dfce` | Stabilize keybindings toast stream setup | **P** (pattern only; no keybindings in Overdeck yet) |
| `6de4b47e` | Return replay retry state from orchestration recovery | **Y** |
| `d18e43b6` | Fix lost provider session recovery | **P** (maps to Overdeck's conversation-recovery path) |

**Port strategy:** land this cluster as a single PR after section 0. These are transport-level bugs whose fingerprints we will hit as soon as we put Overdeck's `/ws/rpc` under real usage. `f5ecca44` in particular fixes a leak where tracked RPCs from a killed connection re-fire on reconnect — Overdeck's event replay sequence is vulnerable to the same.

### 6.3 Terminal / shell

| SHA | Title | Applies |
| --- | --- | --- |
| Section 1 (TerminalManager, history, dual-runtime) | | ✓ |
| `2e42f3fd` | Improve shell PATH hydration and fallback detection | **Y** (applies to PTY env for tmux-launched agents) |
| `c9b07d66` | Backfill projected shell summaries and stale approval cleanup | **P** (maps to Overdeck's agent output summary) |
| `f7fa62aa` | Add shell snapshot queries for orchestration state | **Y** (feeds the "what is this agent doing right now" question) |
| `9013c07f` | Clean up terminal state when threads are archived | **Y** (maps to Overdeck workspace cleanup) |
| `1f4a3f65` | Fix opening urls wrapped across lines in the terminal | **Y** |
| `340dbbb3` | Unwrap windows shell command wrappers | **N** (Linux-only dashboard) |

### 6.4 Git / worktree

Overdeck already manages worktrees, but upstream has been aggressively fixing edge cases. Most of these translate.

| SHA | Title | Applies |
| --- | --- | --- |
| `8515f027` | Move worktree bootstrap to the server and persist terminal launch context | **Y** (aligns with Overdeck specialist flow) |
| `9dcea68b` | Refresh git status after branch rename and worktree setup | **Y** |
| `5f7ec73a` | Fix new-thread draft reuse for worktree defaults | **P** |
| `77fcad35` | Prevent live thread branches from regressing to temp worktree names | **P** |
| `801b83e9` | Allow empty server threads to bootstrap new worktrees | **P** |
| `e2316814` | Fix worktree base branch updates for active draft | **P** |
| `cf2c628b` | Use active worktree path for workspace saves | **Y** |
| `53a552e8` | Stream git status updates over WebSocket | **Y** — aligns with section 2 partition (browser read → RPC) |
| `2aa73985` | Refresh local git status on turn completion | **Y** |
| `f9019cd6` | Coalesce status refreshes by remote | **Y** |
| `e0e01b4a` | Handle deleted git directories as non-repositories | **Y** |
| `1cba2f64` | Harden workspace git indexing against repo-configured fsmonitor execution | **Y** (fsmonitor is a real Overdeck footgun) |
| `d2822a88` | Use explicit refspec for push in worktrees with slashed branch names | **Y** (feature/PAN-123 branches are Overdeck's default) |
| `b547fee7` | Scope git toast state by thread ref | **P** |

### 6.5 Auth / pairing / multi-environment

User flagged in section 7 that this is conditional on the remote-dashboard story being decided.

| SHA | Title | Applies |
| --- | --- | --- |
| `b7559c46` | Implement server auth bootstrap and pairing flow | **Y** (required if dashboard ever leaves localhost) |
| `cf9f236c` | Add headless `t3 serve` pairing output | **Y** (maps to `pan up --remote`) |
| `4ae9de31` | Stabilize auth session cookies per server mode | **Y** |
| `5b3b31b6` | Use dev proxy for loopback auth and environment requests | **Y** |
| `b96308fc` | Prepare datamodel for multi-environment | **P** — Overdeck's "projects" are the equivalent; watch for schema ideas |
| `e32077ce` | Persist client settings and saved environment secrets | **Y** |
| `e3004ae8` | Harden secret store and resolve catalog overrides | **Y** (Overdeck has `~/.overdeck.env` — same concerns) |
| `1a05d8ca` | Document remote server network access setup | **Y** (docs) |

### 6.6 Observability / tracing

| SHA | Title | Applies |
| --- | --- | --- |
| `752f96e9` | Add server observability tracing and metrics | **Y** |
| `e9ed849b` | Persist server OTLP tracing settings across restarts | **Y** |
| `04a1ae77` | Proxy browser OTLP traces through the server | **Y** |

Additive Effect instrumentation — low-risk but high-value for Overdeck's multi-agent concurrency debugging. Port after sections 0 and 6.2 land.

### 6.7 Provider / model runtime

| SHA | Title | Applies |
| --- | --- | --- |
| `58e5f714` | Add provider skill discovery | ✓ (section 3) |
| `008ac5c3` | Cache provider status and gate desktop startup | **P** (gate server startup, not desktop) |
| `740d7a32` | Use lazy stream accessors for provider runtime events | **Y** |
| `678f827f` | Remove Claude subscription-based model adjustment | **Y** (Overdeck's model-routing should not key off subscription type either) |
| `226ed997` | Assign default capabilities to Codex custom models | **N** (no Codex) |
| `7a008461` | Align token usage metrics for both Claude and Codex | **P** (align Claude-only) |
| `0d280262` | Emit plan events for TodoWrite during input streaming | **Y** — high value; Overdeck's work-agent UI should show TodoWrite as live plan updates |

### 6.8 Chat / composer / messages

Section 5 cherry-pick list expanded with the full set of touchpoints:

| SHA | Title | Target file(s) in Overdeck |
| --- | --- | --- |
| `33dadb5a` | Fix thread timeline autoscroll and simplify branch state | `MessagesTimeline.tsx` |
| `7c0849fe` | Harmonize typography in chat messages and code blocks | `ChatMarkdown.tsx`, `MessagesTimeline.tsx` |
| `1bf048eb` | Avoid copy button overlapping long code blocks | `ChatMarkdown.tsx` |
| `5467d119` | Prevent number-key shortcuts from hijacking input in focused editor | `ComposerPromptEditor.tsx` |
| `869789b4` | Extract ChatComposer to fix composer keystroke re-renders | `ComposerPromptEditor.tsx` (refactor) |
| `934037cb` | Add extensible command palette | new surface (consider) |
| `65d797c1` | Add surround selection in composer | `ComposerPromptEditor.tsx` |
| `26cc1fff` | Add assistant message copy action + harden fallbacks | `MessagesTimeline.tsx` |
| `386eb18a` | Fix persisted composer image hydration typo | `ComposerPromptEditor.tsx` |
| `08534058` | Fix scroll to bottom button flickering near bottom of the chat | `MessagesTimeline.tsx` |
| `48481aa9` | Fix stale send spinner after completed turns | `MessagesTimeline.tsx` |
| `57d7746a` | Replace turn strip overlay gradients with mask-image fade | `MessagesTimeline.tsx` |
| `96c9306d` | Migrate chat scrolling and branch lists to LegendList | virtualizer swap (defer) |
| `ea9e61b2` | Align chat composer and toolbar widths | `ComposerPromptEditor.tsx` |
| `f2205bdc` | Pad composer model picker to prevent ring clipping | `ComposerPromptEditor.tsx` |
| `66d76b5d` | Fix composer footer focus ring overflow | `ComposerPromptEditor.tsx` |
| `5fa09fa2` | Codex composer footer compact layout | **N** |
| `9385314d` | Persist changed-files expansion state per thread | **Y** (map to workspace diff panel) |

**Cherry-pick order:** transport fixes (5467d119, 869789b4) → autoscroll/spinner (33dadb5a, 08534058, 48481aa9) → typography/layout (7c0849fe, 1bf048eb, ea9e61b2, f2205bdc, 66d76b5d, 57d7746a) → features (65d797c1, 26cc1fff, 934037cb) → LegendList last.

### 6.9 Sidebar / threads / projects

Overdeck doesn't have a "thread" concept but does have "workspaces" and "issues" — most of these translate to the workspace list.

| SHA | Title | Applies |
| --- | --- | --- |
| `569fea87` | Warm sidebar thread detail subscriptions | **Y** (warm issue detail on hover) |
| `cadd7086` | Show full thread title in tooltip when hovering sidebar | **Y** |
| `6f699346` | Use latest user message time for thread timestamps | **P** (use latest agent activity for workspace ordering) |
| `a2215429` | Add project rename support in the sidebar | **N** (Overdeck projects come from `projects.yaml`) |
| `b80e8476` | Memoize derived thread reads | **Y** (same memoization patterns) |
| `11d456f6` | Support multi-select pending user inputs | **P** (maps to specialist "awaiting approval" UX) |
| `28e481eb` | Distinguish singular/plural in pending action submit label | **Y** |

### 6.10 Editor / shell integrations

| SHA | Title | Applies |
| --- | --- | --- |
| `5f7becf3` | Add Kiro editor support | **Y** (cheap) |
| `afc39243` | Add Zed support to Open actions | **Y** |
| `1b272fd7` | Support IntelliJ IDEA open-in launch | **Y** |
| `72b7f90c` | Add VSCode Insiders and VSCodium icons | **Y** |
| `2fce84a1` | Quote editor launch args on Windows | **N** |
| `592c234f` | Make file uri links clickable | **Y** |
| `d9ded65d` | Add Copy Link action for chat links | **Y** |

### 6.11 Desktop (Electron) — mostly N/A

Overdeck currently ships as a CLI + browser dashboard, not a desktop app. Some of these become relevant once the Electron shell lands (see `memory/overdeck-electron-npx.md`).

| SHA | Title | Applies |
| --- | --- | --- |
| `dff8784a` | Window controls overlay (Windows & Linux) | **P** (future Electron) |
| `850c9125` | Increase backend readiness timeout from 10s to 30s | **Y** (same problem exists for `pan up` dashboard bootstrap) |
| `f9372a4c` | Separate dev AppUserModelID on Windows | **N** |
| `12c3af78` | Add "Copy Image" to right-click context menu | **P** (future) |
| `abb84c09` | Use different bundle ID for dev runner | **N** |
| `5d9eb183` | Don't let un-updateable builds check for an update | **N** |
| `e82b9873` | Select desktop backend port by sequential scan | **P** (maps to Overdeck dashboard port collision handling) |

### 6.12 CLI

| SHA | Title | Applies |
| --- | --- | --- |
| `27c2b145` | Allow optional positional cwd argument | **P** (for `pan` subcommands that take a workspace path) |

### 6.13 Modes / labels / UX strings

| SHA | Title | Applies |
| --- | --- | --- |
| `c6f57a10` | Rename "Chat" to "Build" in interaction mode toggle | **N** (Overdeck has no mode toggle) |
| `7372184d` | Map runtime modes to correct permission levels | **P** (maps to agent permission routing) |
| `7b3cdc6a` | Clarify environment and workspace picker labels | **P** |
| `047a0a69` | Add pointer cursor to permissions mode select trigger | **Y** (micro-fix pattern) |
| `ae3ea398` | Clicking logo now navigates to threads | **Y** (clicking logo → navigate to workspaces) |
| `97880e88` | Resolve logical-to-physical key mismatch in project drag reorder | **P** |

### 6.14 Build / CI / release / docs

| SHA | Title | Applies |
| --- | --- | --- |
| `2028d57e` | Fix server publish check for bin entrypoint | **P** |
| `a3dadf31`, `a3f29277` | release prep (v0.0.16, v0.0.17) | **N** |
| `b1934b92` | Add explicit timeouts to CI and release workflows | **Y** |
| `8244fb80` | Support devcontainer development | **P** |
| `9b29be91` | Document environment prep before local development | **Y** (docs) |
| `f59ee36b` | Allow concurrent browser tests to retry ports | **Y** (Overdeck tests have the same contention) |
| `9847e9b6` | fix build | **N** |

### 6.15 Codex-specific — N/A

| SHA | Title |
| --- | --- |
| `12347082` | Fix marketing download fallback links |
| `cd7980b4` | Canonicalize PR number references |
| `e8f5b4ad` | Revert stale send spinner fix |

All three are Codex marketing/product work, not transferable.

---

## 7. Execution order

1. **Effect bump** (section 0) — prerequisite, blocks everything.
2. **WebSocket terminal migration** (section 1) — largest architectural win, unblocks server-owned session features.
3. **Provider skill discovery** (section 3) — self-contained feature port with immediate user value.
4. **Route partition audit** (section 2) — no code change, a decision document that gates sections 6.2 and 6.3.
5. **Themed backlog** (section 6) — sequence by PR size, each in its own branch.
6. **Chat component cherry-pick** (section 5) — ongoing, one commit at a time.

Store slices (section 4) are already done; only validation is needed.

---

## 8. Rules we do not violate

- **Node 22 only for the dashboard server.** `pan up` runs `dist/dashboard/server.js` under Node 22. [`.claude/rules/dashboard-node22-only.md`](../../.claude/rules/dashboard-node22-only.md). The Effect bump does not change this; `node-pty` still requires Node and circular ESM imports still forbid tsx source-mode.
- **No blocking calls in dashboard server code.** Section 1's new `TerminalManager` must use `fs/promises` or the Effect `FileSystem` service, not `readFileSync` / `writeFileSync`, even though t3code upstream may use sync calls (t3code is single-user; Overdeck is multi-agent-concurrent).
- **tmux stays the PTY backend.** Section 1 changes transport only.
- **HTTP routes for machine-to-machine callers stay HTTP.** Section 2.
- **`postMergeLifecycle` idempotency guards** (PAN-328) and **Docker cleanup step** survive unchanged through any refactor.

---

## 9. Open questions

1. Do we want to push Overdeck's `TerminalManager` history buffer *upstream* to t3code once it's built on top of tmux? t3code's current spawn is a bare shell; Overdeck's tmux backend is strictly more powerful.
2. Does `packages/contracts` need a major version bump when `ServiceMap` → `Context` propagates through its public types? It probably does; pin consumers explicitly.
3. Does the dashboard need a feature flag for the new `TerminalEvent` path so we can roll it back per-user if integration surprises hit?
