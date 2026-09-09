# Dashboard Server Architecture (Effect + Raw WebSocket)

> Moved from CLAUDE.md (2026-08-07). See also docs/DASHBOARD-PERFORMANCE.md and docs/OVERDECK_DEV_SOP.md.


The dashboard server uses **Effect.js** for HTTP routes and structured RPC, plus a
**raw WebSocket** endpoint for terminal streaming.

**Server structure** (split from old 15K-line monolith in PAN-428):
- `src/dashboard/server/main.ts` — entry point, dual-runtime (Bun dev, Node prod)
- `src/dashboard/server/server.ts` — Effect HTTP server, route composition, layers
- `src/dashboard/server/ws-rpc.ts` — Effect RPC over WebSocket at `/ws/rpc`
- `src/dashboard/server/ws-terminal.ts` — raw WebSocket terminal at `/ws/terminal`
- `src/dashboard/server/routes/` — ~60 route modules plus domain subdirs (agents/, misc/, resources/, specialists/, workspaces/)
- `src/dashboard/server/services/*.ts` — domain services (cache, agent enrichment, TTS runtime/playback, etc.)
- `src/dashboard/server/event-store.ts`, `read-model.ts` — event store and in-memory read model, at the server root

**Two WebSocket endpoints:**
- `/ws/rpc` — Effect RPC (PanRpcGroup): domain events, snapshots, replay. Uses typed Schema.
- `/ws/terminal?session=<name>` — Raw WebSocket: live PTY terminal streaming via `ws` library.
  Terminal data bypasses Effect RPC because the RPC serialization layer can't handle
  high-throughput binary-like terminal data reliably.

**Terminal architecture** (`ws-terminal.ts` + `XTerminal.tsx`):
- Server: raw `WebSocketServer` with `noServer: true`, deferred PTY spawn (waits for
  client resize dimensions), `node-pty` spawns `tmux attach-session`
- Client: raw `WebSocket` API with a five-minute patient reconnect window from
  `terminalReconnectPolicy.ts`: delays are 1s, 2s, 4s, then a flat 5s.
- Reconnect state stays outside xterm scrollback in a status overlay; exhaustion keeps
  the terminal mounted and offers a manual Reconnect action.
- Close code `4404` means the tmux session is still gone after the server-side wait and
  is fatal. Close code `4503` means the dashboard is gracefully restarting, so the UI
  shows calm "Dashboard restarting" copy and uses the same patient reconnect policy;
  `handleShutdownSignal` broadcasts `4503` before server teardown.
- PTY waits for the tmux session to exist (`sessionExists` + respawn-pending waits) before spawning
- Attach uses a deterministic snapshot protocol: the server sends a `snapshot` control frame,
  the client acks `ready`, and only then does live data flow (`readyForLiveData` in XTerminal.tsx);
  unready clients are closed with `terminal-ready-timeout`

**Frontend data flow:**
- `EventRouter.tsx` → connects to `/ws/rpc`, fetches snapshot via `getSnapshot` RPC,
  subscribes to `subscribeDomainEvents` stream, applies events to Zustand store
- `wsTransport.ts` — Effect-based RPC client with auto-reconnection
- Store: Zustand with shared reducers from `@overdeck/contracts`

**DB job worker lanes:**
- The `read` lane handles interactive lookups, the `long` lane handles bulk scans and
  reconciliation, and the `semantic` lane isolates embedding and semantic-search work.
  The `parse` lane runs `parseTranscriptSnapshot`. Transcript parsing is CPU-bound and
  can take seconds, so its own lane cannot block interactive reads or wait behind bulk
  sweeps.
- Worker implementations live in `src/dashboard/server/services/dashboard-db-worker.ts`.
  Add each new operation to both `dashboard-db-task.ts` and the worker dispatch table so
  the main thread and worker remain type-safe.
- Jobs that wait or run for more than one second emit
  `[db-jobs] slow: op=<operation> lane=<lane> waitMs=<n> runMs=<n> depth=<n>`.
  The line identifies whether queue delay or worker execution caused the slowdown.
- `costReconcileSweep` walks and parses transcript files in the `long` lane. The main
  thread records bounded 250-event progress batches through the canonical write doors and
  acknowledges each batch before the worker continues its single-pass scan. This limits
  transfer memory without repeated parsing while preserving EventBus publication and
  durable skip-cache updates.
- Cost polling, conversation-list ledger totals, and search counters use shared worker
  snapshots. Concurrent refreshes coalesce. Cost snapshots refresh after 15 seconds;
  search counters refresh after 60 seconds. Successful values remain usable for at most
  five minutes during refresh failures, with a five-second retry backoff. Search
  configuration, provider availability, and runtime health are still read per request.
- `subscribeConversationMessages` resolves transcript paths on the main thread and
  shares worker parse results across subscribers. Codex consumes appended records;
  other full-parser harnesses still parse changed files in the worker. Clients receive
  complete initial history, then changed message/tool rows and metadata. Explicit resets
  replace history after truncation/replacement, and metadata snapshots clear removed
  plans or compact boundaries. Full tool results remain accessible.
- Global issue updates use `issues.delta`: complete changed rows at their original
  array positions plus the resulting length. Initial/reconnect snapshots retain all
  rows and descriptions. Shared reducers preserve order, removal, and arbitrary tracker
  fields without repeatedly transmitting unchanged descriptions. These projections use
  in-memory publication and never enter the durable event log.

**Conversation loading and delivery:**
- A `/conv/<id>` deep link loads that conversation directly, independently of the
  sidebar list. Favorites, pending-input state, and normal list navigation remain intact.
- HTTP acceptance and transcript confirmation are distinct. A late echo does not prove
  delivery failure. Unknown delivery preserves the operator's text; confirmed rejection
  retains the existing recovery actions. The client bounds the request and body read to
  120 seconds, and reconciles late echoes using message identity or text/time matching.
- Conversation sends carry `clientMessageId`; retries preserve it and set `retry: true`.
  The server coalesces matching concurrent requests and retains their result, including
  ambiguous failures. Changed text or command confirmation requires a new ID. Receipts
  are bounded to 2,000 entries and 24 hours. A retry whose receipt was lost to restart or
  expiry is refused with an unknown outcome, never injected as a new message. This is
  safe retry handling, not an exactly-once guarantee from the underlying harness.
- `pan pause sequencer-runner` prevents both explicit and automatic sequencer starts.
  The launcher checks the pause before preparation and immediately before spawning.
  Resume permission requires `pan unpause sequencer-runner`.

**Issue views:** Rail, cockpit, and console issue surfaces share the kit documented in
`docs/ISSUE-VIEW.md`. Route new issue sections through `IssueViewModel`, the shared
components, and `DENSITY_SECTIONS`; update the inventory and real `data-section`
marker so the no-loss gate proves that no existing surface disappeared.

**God View:** `/god-view` centers the Confluence production canvas from [PAN-3447](https://github.com/eltmon/overdeck/issues/3447); its deliberate style-guide exemption and live-data contract are documented in `docs/GOD-VIEW.md`.

**Session lifecycle rules:**
- On WebSocket close, do NOT kill the PTY — the tmux session survives independently.
- Do NOT pre-resize tmux windows. Let the PTY spawn handle sizing via client dimensions.
- The planning launcher script MUST export TERM/COLORTERM/LANG for Claude Code rendering.
- Planning sessions use `remain-on-exit on` + `destroy-unattached off` so the session
  survives after the agent exits, until the user clicks Done.
