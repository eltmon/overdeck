# Architecture

Overdeck is a multi-agent orchestrator for AI coding work: a CLI (`pan`), a
dashboard server, a React frontend, and a fleet of coding agents hosted by a
**terminal backend** — Herdr by default, tmux as the fallback (PAN-3917 D10).

## Top-level layout

| Path | What lives there |
| --- | --- |
| `src/cli/` | Commander-based CLI. `index.ts` declares all verbs/flags; `commands/` holds per-verb modules (doctor, install, memory, task…). |
| `src/lib/` | Core domain logic shared by CLI and server. The big ones below. |
| `src/dashboard/server/` | Effect.js HTTP server + raw WebSocket terminal streaming. Entry `main.ts`, routes in `routes/`, services in `services/`. Runs ONLY as built `dist/dashboard/server.js` under Node 22. |
| `src/dashboard/frontend/` | React + Zustand + Vite SPA. Components under `src/components/`. |
| `packages/contracts/` | Shared types/schemas (`@overdeck/contracts`) used by server + frontend (e.g. `Harness` union at `src/types.ts:49`). |
| `skills/` | Claude Code wrapper skills for `pan` verbs (lint-enforced vs `--help`). |
| `roles/` | Prompt sources for pipeline roles (plan/work/review/test + review sub-roles). |
| `sync-sources/rules/` | Bundled context rules distributed by `pan sync`. |

## Key src/lib modules

- `agents.ts` is now a thin barrel over `src/lib/agents/` — `spawn.ts` (`spawnAgent`,
  `spawnRun`), `spawn-prep.ts` (`buildAgentLaunchConfig`, tier spawn params),
  `staffing.ts` (the single staffing resolver, PAN-2397), `resolve-tier.ts` +
  `tier-table.ts` (tiered execution), `runtime-command.ts` (`getProviderAuthMode`),
  `delivery.ts`, `health.ts`, `resume.ts`, `termination.ts`. Harness resolution lives in
  `src/lib/harness-resolve.ts`.
- `runtimes/` — harness adapters: `claude-code.ts`, `ohmypi.ts` (+ `ohmypi-fifo.ts`),
  `codex.ts`, `acp.ts`, `kimi-code.ts`, `muse.ts`, plus OpenCode via ACP. `RuntimeName =
  'claude-code' | 'ohmypi' | 'codex' | 'acp' | 'kimi-code' | 'opencode' | 'muse'` (`pi` is a
  legacy alias). Per-harness behavior table: `packages/contracts/src/harness-behavior.ts`.
- `harness-policy.ts` — ToS gate `canUseHarnessSync()` (ohmypi + Anthropic + subscription
  is the only blocked combo). Never weaken.
- `providers.ts` — `PROVIDERS` registry (18 providers incl. opencode/meta),
  `getProviderForModelSync()`, per-provider `tierModels` (opus/sonnet/haiku slots).
- `model-capabilities.ts` — `MODEL_CAPABILITIES` skill/cost matrix; `model-deprecations.ts`
  alias table; `model-capability-class.ts` (PAN-3842) frontier/workhorse/small classes.
- `config-yaml.ts` — `~/.overdeck/*.yaml` settings: `RoleConfig` (model/harness/effort
  per role), `providerHarnesses`, workhorses, normalization + defaults.
- `settings-api.ts` — settings GET/PUT payload mapping between YAML and dashboard.
- `cloister/` — the Deacon (lifecycle watchdog), model routing (`router.ts`),
  legacy `model_selection.specialist_harnesses` (PAN-636).
- `planning/spawn-planning-session.ts` — plan-role kickoff (own spawn path).
- `launcher-generator.ts` — generates tmux launcher scripts (`--resume`, PTY
  supervisor wrapping, env exports).
- `terminal-backends/` (PAN-3917 W8) — the backend contract (`types.ts`), the Herdr
  adapter (`herdr.ts`, `herdr-api.ts`, `herdr-stream.ts`), the tmux adapter (`tmux.ts`),
  selection (`select.ts`: `OVERDECK_TERMINAL_BACKEND` → `terminal.backend` → Herdr when
  its socket exists), the FR-17 prompt guard (`prompt-guard.ts`), and the **launch door**
  `launch.ts` (`launchAgentPane`: place a pane in the issue workspace and stamp the
  `issue`/`role`/`harness`/`model` tokens). Every spawner goes through it; PAN-3921 adds
  conversations/handoffs. Herdr detects agents by the pane's FOREGROUND process, so the
  PTY supervisor wrapper is tmux-only (`decideSupervisorForWorkAgent`).
- `tmux.ts` — tmux primitives on the `overdeck` socket. Async (Effect) variants
  are canonical; `*Sync` are legacy debt.
- `session-format-converter.ts` — conversation transcript conversion between
  harness JSONL formats (tier-4 harness switch; experimental).
- `conversations/switch-strategy.ts` — model/harness switch tiers 1–4.
- Cost metering — `cost-parsers/` (per-harness session parsers: `jsonl-parser.ts`
  claude-code, `ohmypi-parser.ts`, `codex-parser.ts`, legacy `pi-parser.ts`),
  `cost.ts` (pricing table, `getPricingSync`), `overdeck/cost.ts` (the two-door
  CostWriter: `record()` dedupes by requestId/sourceFile → append-only archive →
  `cost_events` SQLite; `reconcile({source})` sweeps per-agent session dirs).
  Live triggers: claude via WAL/transcript sync, ohmypi via
  `cloister/pi-cost-reconciler.ts` (gated on a running ohmypi agent), plus
  `POST /api/costs/reconcile` (`dashboard/server/routes/costs.ts`).

## Agent pipeline

Issue → `pan plan` (xBRIEF plan + item checklist under `.pan/` in the project repo) →
`pan start` (work agent in a git worktree `workspaces/feature-<issue>/`) → verification
gate → review convoy → test/UAT → server-side rebase/merge → close-out. Spawned agents
live in the terminal backend (Herdr live agents named after the agent id, or tmux
sessions on `tmux -L overdeck`), with launch state in `~/.overdeck/agents/<id>/state.json`
(`backend`, `paneId`). Issue state is DERIVED (tracker + PR + checks + git + backend
inventory; `src/lib/overdeck/derived-issue-state.ts`) — there is no record plane and no
`overdeck-state` branch writes (PAN-3917).

## Spawn sites (harness decision points)

1. Plan kickoff — `planning/spawn-planning-session.ts` (~:558)
2. Work agent — `agents/spawn.ts` `spawnAgent` (~:600; single-work tier staffing ~:629)
3. Role runs — `agents/spawn.ts` `spawnRun` (~:120; slot tier staffing ~:137)
4. Restart — `agents/resume.ts` / `agents/recovery.ts`
5. Dashboard start route — `dashboard/server/routes/agents.ts` (~:3156, shells to `pan start`)

Conversations pin harness at creation in `handleConversationCreate`
(`src/lib/overdeck/conversation-runtime.ts` ~:918, called from `POST /api/conversations` in
`routes/conversations.ts` ~:303); the one spawn function is `spawnConversationSession`
(~:545), also used by respawn/restart-all, the fork/handoff pipeline
(`conversation-forks.ts`), and `pan flywheel start`. The conversation's backend identity is
`tmuxSession` = `conv-<name>` (Herdr agent name or tmux session); `deliverAgentMessage`
and the terminal WebSocket resolve it by that name on either backend. Conversation kickoff templates read at
request time live in `roles/` (`handoff.md`, `retrospective.md`); `src/lib/cloister/prompts/*.md`
are build-copied to `dist/dashboard/prompts/` and cached by `renderPrompt`.

## Projects and workspaces domain (PAN-1990, PAN-3330)

- `projects.yaml` (`~/.overdeck/projects.yaml`) is the project registry. Read it
  through `getProjectSync`/`listProjectsSync`/`listProjectsAsync` (`src/lib/projects.ts`,
  mtime-cached); write it through `registerProjectSync`/`updateProjectsConfigSync`,
  which invalidate the cache. `src/lib/project-registration.ts` is the
  `registerProjectFromPath` entry every project-creation front door ends in.
- The `projects`/`workspaces`/`project_targets`/`pinned_docs` tables in overdeck.db
  have one read door (`src/lib/workspaces/resolver.ts`, e.g. `getMainWorkspace`)
  and one write door (`src/lib/workspaces/writer.ts`);
  `scripts/guard-workspace-doors.sh` fails lint on SQL elsewhere.
- Creation follows resolve-before-create: `src/lib/workspaces/create.ts` exports
  `resolveWorkspaceCreateIntent` (zero writes, returns `findings`) and
  `performWorkspaceCreate`. The CLI (`pan workspace new|main`) and the dashboard
  route `POST /api/workspace-registry/resolve` call the same functions, and the
  `/workspaces/new` page polls resolve per settled keystroke
  (`components/workspace/new/useWorkspaceCreateIntent.ts`). PAN-3836 adds the
  same shape for projects in `src/lib/projects/create.ts` and `/projects/new`.

## Remote (Fly.io) work agents

Work agents can run on Fly.io VMs (`src/lib/remote/remote-agents.ts`,
`fly-provider.ts`). State lives at
`~/.overdeck/agents/agent-<issue>/remote-state.json` (`location: 'remote'`,
`vmName`, `status`). The dashboard surfaces them via
`listActiveRemoteAgentStates()` in `services/resource-discovery.ts` (issue chip
+ aggregate status, PAN-1676) and session-row synthesis in
`routes/projects.ts` `collectSessionTreeNodes()` (PAN-1775). Remote agents have
no local tmux session — never assume tmux discovery covers them.

<!-- last-verified: 2026-09-19 -->
