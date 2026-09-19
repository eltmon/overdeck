# Overdeck — Stack

- **Language:** TypeScript (strict), ESM throughout.
- **Runtime:** Node.js 22+ for the dashboard server and PTY supervisor
  (node-pty native addon); Bun as package manager / workspaces
  (`packages/contracts`, `src/dashboard/server`, `src/dashboard/frontend`).
- **Server:** Effect.js (@effect/platform HTTP, Effect RPC over WebSocket at
  `/ws/rpc`), raw `ws` for `/ws/terminal` PTY streaming,
  `@homebridge/node-pty-prebuilt-multiarch`.
- **Frontend:** React 18, Vite, Zustand (shared reducers from
  `@overdeck/contracts`), TanStack React Query, CSS modules.
- **DB:** SQLite (`~/.overdeck/overdeck.db`) via runtime-bundled
  `node:sqlite` / `bun:sqlite`; DB is a disposable cache rebuilt from git +
  GitHub + JSONL + tmux.
- **Build:** tsdown/rolldown (CLI, server, contracts), Vite (frontend).
- **Tests:** Vitest (root + frontend projects); Playwright for browser UAT.
- **Issue tracking:** GitHub Issues (`PAN-<n>` = eltmon/overdeck#<n>); per-issue
  xBRIEF items via `pan task` (beads removed, PAN-2648).
- **Process orchestration:** tmux (dedicated socket `-L overdeck`), PTY
  supervisor (`dist/pty-supervisor.js`) for message delivery, Traefik for
  `*.overdeck.localhost` routing, Docker compose per workspace devcontainer.
- **Agents/harnesses:** claude-code (default), pi/ohmypi, codex
  (`codex app-server` transport), acp, kimi-code; CLIProxy sidecar (port 8317)
  bridges GPT models; model routing via Cloister config, never hardcoded
  fallbacks.
- **Key dirs:** `~/.overdeck/` (home: agents/, sockets/, state/, config.yaml),
  `${OVERDECK_HOME}/state/<project>/` (overdeck-state worktree),
  `workspaces/feature-<issue>/` (git worktrees).
- **Dashboard:** port 3011 (`pan up` → `node dist/dashboard/server.js`);
  frontend dev via `pan dev` (Vite HMR).

<!-- last-verified: 2026-08-12 -->
