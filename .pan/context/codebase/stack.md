# Stack

- **Language:** TypeScript (strict), ESM throughout.
- **Runtime:** Node.js 22 for everything that ships (CLI, dashboard server,
  PTY supervisor). Bun is the *package manager / dev scratchpad* only
  (`bun install`, bun workspaces: root, `packages/contracts`,
  `src/dashboard/server`, `src/dashboard/frontend`).
- **Build:** tsdown (rolldown) for CLI / server / contracts (`tsdown.config.ts`
  at root, `src/dashboard/server/`, `packages/contracts/`, `scripts/`); Vite for
  the frontend. `npm run build` builds all.
- **Server:** Effect.js HTTP + Effect RPC over WebSocket (`/ws/rpc`); raw `ws`
  + `@homebridge/node-pty-prebuilt-multiarch` for terminal streaming
  (`/ws/terminal`). SQLite for event store / deacon state.
- **Frontend:** React 18, Zustand (shared reducers from `@overdeck/contracts`),
  TanStack Query for settings mutations, CSS modules (`command-deck.module.css`,
  `stage.module.css`) + Tailwind-style utility classes in Settings, lucide-react
  icons (being replaced by brand SVGs for providers/harnesses).
- **CLI:** commander (`src/cli/index.ts`), self-documenting `--help`.
- **Tests:** Vitest (`npm test` = root + frontend projects). Fake timers
  mandatory for delay-based logic. Playwright MCP for browser UAT.
- **Lint:** ESLint + `scripts/lint-skills.sh` (skill/CLI drift) via `npm run lint`.
- **Agent substrate:** tmux on a dedicated `panopticon` socket
  (`tmux -L panopticon`); per-agent state under `~/.panopticon/agents/`;
  harnesses: claude-code (default), pi (multi-provider, FIFO rpc.in), codex
  (OpenAI, `codex exec`).
- **Issue tracking:** GitHub Issues (`PAN-<n>` = `#<n>` on eltmon/panopticon-cli);
  beads (`bd`) for in-repo task tracking; vBRIEF v0.5/0.6 specs in `.pan/specs/`.
- **Config:** YAML at `~/.panopticon/` (settings, projects.yaml), normalized by
  `src/lib/config-yaml.ts`; Mintlify docs in `configuration/*.mdx` +
  `reference/*.mdx`.

<!-- last-verified: 2026-06-12 -->
