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

