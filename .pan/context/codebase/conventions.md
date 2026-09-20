# Overdeck — Conventions

## Language / runtime
- TypeScript strict, Node 22+, ESM. Package manager: Bun (`bun install`), but
  the dashboard server RUNS under Node 22 only (node-pty native addon +
  circular-ESM constraints) — never `bun run` for `dist/dashboard/server.js`.
- Build: `npm run build` (tsdown for CLI/server/contracts, Vite for frontend).
- Quality gates before `pan done`: `npm run typecheck`, `npm run lint`,
  `npm test` (Vitest, root + frontend projects).

## Code rules that recur in review
- No `execSync` in dashboard-server-reachable code — async only (PAN-70).
- tmux: only `sendKeysAsync` / load-buffer+paste-buffer pattern; sync variants
  are legacy debt.
- Delay/retry tests MUST use `vi.useFakeTimers()` + `advanceTimersByTimeAsync`.
- Never hardcode a model fallback; fail loudly when a default is unset.
- Effect.js is used across the server (`Effect.runPromise` at route edges).
- New AgentState fields need only codec entries + a round-trip audit test —
  the SQLite `agents` mirror is dropped (PAN-3917); `state.json` per agent
  dir is the sole copy.
- Additive refactors: never silently drop an existing field/affordance; run a
  no-loss audit (bundled rule).

## Naming / structure
- Agent/session ids double as tmux session names and
  `~/.overdeck/agents/<id>/` dirs: `agent-<issue>` (work),
  `planning-<issue>` (route-spawned plan), `agent-<issue>-plan`
  (Cloister spawnRun plan), `strike-<issue>`, `agent-<issue>-knowledge`,
  `conv-<n>` (conversations).
- Issue ids: `PAN-<n>` = GitHub eltmon/overdeck#<n>. Branch:
  `feature/pan-<n>`; workspace worktree `workspaces/feature-pan-<n>/`.
- Tests live in `tests/unit/...` (mirroring src path), `tests/lib/`,
  `src/**/__tests__/`, and frontend `*.test.tsx` beside components.
- Skills: `pan <verb>` CLI ↔ `skills/pan-<verb>/SKILL.md`; lint enforces
  flag drift (`scripts/lint-skills.sh`).

## Frontend (dashboard)
- React Query for fetches (`useQuery`), Zustand store fed by `/ws/rpc`
  domain events; raw WebSocket only for `/ws/terminal`.
- Style guide (`/pan-style-guide` skill): monospace-leaning typography, no
  pill badges, color = signal only, cyan reserved, running agents are not
  green.
- Cockpit components in `src/components/Stage/cockpit/`; shared kanban/deck
  helpers in `src/components/CommandDeck/`.

## Planning artifacts
- PRD drafts: `<planHome>/.pan/drafts/<issue>.md` (project repo, or the
  configured plan-home repo for polyrepo projects), committed on the
  feature branch. The `overdeck-state` orphan branch is archived
  (PAN-3917) and is no longer read or written by Overdeck.
- vBRIEF (xBRIEF v0.8): exactly `xBRIEFInfo` + `plan` top-level keys;
  ACs are nested items with `metadata.kind: "acceptance_criterion"` naming
  observable behavior; every item carries difficulty/kind/files_scope/
  readiness/requiresInspection metadata.
- `pan plan finalize` is the only sanctioned promoter of the workspace spec
  to `.pan/specs/` in the project (or plan-home) repo; items are tracked
  via `pan task` (beads removed, PAN-2648).

<!-- last-verified: 2026-09-20 -->
