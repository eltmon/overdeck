# Architecture

Panopticon is a multi-agent orchestrator for AI coding work: a CLI (`pan`), a
dashboard server, a React frontend, and a fleet of tmux-hosted coding agents.

## Top-level layout

| Path | What lives there |
| --- | --- |
| `src/cli/` | Commander-based CLI. `index.ts` declares all verbs/flags; `commands/` holds per-verb modules (doctor, install, memory, beads…). |
| `src/lib/` | Core domain logic shared by CLI and server. The big ones below. |
| `src/dashboard/server/` | Effect.js HTTP server + raw WebSocket terminal streaming. Entry `main.ts`, routes in `routes/`, services in `services/`. Runs ONLY as built `dist/dashboard/server.js` under Node 22. |
| `src/dashboard/frontend/` | React + Zustand + Vite SPA. Components under `src/components/`. |
| `packages/contracts/` | Shared types/schemas (`@panctl/contracts`) used by server + frontend (e.g. `Harness` union at `src/types.ts:49`). |
| `skills/` | Claude Code wrapper skills for `pan` verbs (lint-enforced vs `--help`). |
| `roles/` | Prompt sources for pipeline roles (plan/work/review/test + review sub-roles). |
| `sync-sources/rules/` | Bundled context rules distributed by `pan sync`. |

## Key src/lib modules

- `agents.ts` (~5k lines) — agent lifecycle: `spawnAgent`, `spawnRun` (role runs),
  `restartAgent`, `resumeAgent`, `buildAgentLaunchConfig`, runtime state
  (`claudeSessionId` snapshot), harness resolution (`resolveEffectiveHarness`).
- `runtimes/` — harness adapters: `claude-code.ts`, `pi.ts` (+ `pi-fifo.ts` rpc.in
  named pipe), `codex.ts`. `RuntimeName = 'claude-code' | 'pi' | 'codex'` in `types.ts`.
- `harness-policy.ts` — ToS gate `canUseHarnessSync()` (Pi + Anthropic + subscription
  is the only blocked combo). Never weaken.
- `providers.ts` — `PROVIDERS` registry (10 providers), `getProviderForModelSync()`.
- `config-yaml.ts` — `~/.panopticon/*.yaml` settings: `RoleConfig` (model/harness/effort
  per role), `providerHarnesses`, workhorses, normalization + defaults.
- `settings-api.ts` — settings GET/PUT payload mapping between YAML and dashboard.
- `cloister/` — the Deacon (lifecycle watchdog), model routing (`router.ts`),
  legacy `model_selection.specialist_harnesses` (PAN-636).
- `planning/spawn-planning-session.ts` — plan-role kickoff (own spawn path).
- `launcher-generator.ts` — generates tmux launcher scripts (`--resume`, PTY
  supervisor wrapping, env exports).
- `tmux.ts` — tmux primitives on the `panopticon` socket. Async (Effect) variants
  are canonical; `*Sync` are legacy debt.
- `session-format-converter.ts` — conversation transcript conversion between
  harness JSONL formats (tier-4 harness switch; experimental).
- `conversations/switch-strategy.ts` — model/harness switch tiers 1–4.

## Agent pipeline

Issue → `pan plan` (vBRIEF + beads) → `pan start` (work agent in a git worktree
`workspaces/feature-<issue>/`) → verification gate → review convoy → test/UAT →
server-side rebase/merge → close-out. Spawned agents live in tmux sessions
(`tmux -L panopticon`), with state in `~/.panopticon/agents/<id>/state.json`.

## Spawn sites (harness decision points)

1. Plan kickoff — `planning/spawn-planning-session.ts` (~:558)
2. Work agent — `agents.ts` `spawnAgent` (~:3339)
3. Role runs — `agents.ts` `spawnRun` (~:3011)
4. Restart — `agents.ts` `restartAgent` (~:4736)
5. Dashboard start route — `dashboard/server/routes/agents.ts` (~:3156, shells to `pan start`)

Conversations pin harness at creation (`routes/conversations.ts` ~:2741) — not a spawn site.

## Remote (Fly.io) work agents

Work agents can run on Fly.io VMs (`src/lib/remote/remote-agents.ts`,
`fly-provider.ts`). State lives at
`~/.panopticon/agents/agent-<issue>/remote-state.json` (`location: 'remote'`,
`vmName`, `status`). The dashboard surfaces them via
`listActiveRemoteAgentStates()` in `services/resource-discovery.ts` (issue chip
+ aggregate status, PAN-1676) and session-row synthesis in
`routes/projects.ts` `collectSessionTreeNodes()` (PAN-1775). Remote agents have
no local tmux session — never assume tmux discovery covers them.

<!-- last-verified: 2026-06-12 -->
