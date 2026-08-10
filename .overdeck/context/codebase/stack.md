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
- **Lint:** `npm run lint` is ESLint plus ~20 chained shell guards in `scripts/`
  (skill/CLI drift, state doors, prompt trailers, file size, circular deps,
  ratchet audit, …). `npm run typecheck` chains root + hooks + evals + the two
  dashboard halves, where server and frontend are shrink-only ratchets
  (`scripts/lint-dashboard-types.sh`, `scripts/lint-frontend-types.sh`) — note
  those two ratchets live in the **typecheck** chain, not the lint chain.
  `packages/effect-acp` is checked by the root `typecheck:acp` lane; `packages/contracts`
  remains typechecked by no root gate.
- **Agent substrate:** tmux on a dedicated `overdeck` socket
  (`tmux -L overdeck`); per-agent state under `~/.overdeck/agents/`;
  harnesses: claude-code, pi, and codex with persistent transports.
- **Issue tracking:** GitHub Issues (`PAN-<n>` = `#<n>` on eltmon/overdeck);
  xBRIEF v0.8 specs and task state live on `overdeck-state` and are exposed through `pan task`.
- **Config:** YAML at `~/.overdeck/` (settings, projects.yaml), normalized by
  `src/lib/config-yaml.ts`; Mintlify docs in `configuration/*.mdx` +
  `reference/*.mdx`.

<!-- last-verified: 2026-08-06 -->
