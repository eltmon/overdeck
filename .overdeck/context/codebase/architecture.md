# Architecture

Overdeck is a multi-agent orchestrator for AI coding work: a CLI (`pan`), a
dashboard server, a React frontend, and a fleet of tmux-hosted coding agents.

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

Issue → `pan plan` (xBRIEF plan + item checklist) → `pan start` (work agent in a git worktree
`workspaces/feature-<issue>/`) → verification gate → review convoy → test/UAT →
server-side rebase/merge → close-out. Spawned agents live in tmux sessions
(`tmux -L overdeck`), with state in `~/.overdeck/agents/<id>/state.json`.

## Spawn sites (harness decision points)

1. Plan kickoff — `planning/spawn-planning-session.ts` (~:558)
2. Work agent — `agents/spawn.ts` `spawnAgent` (~:600; single-work tier staffing ~:629)
3. Role runs — `agents/spawn.ts` `spawnRun` (~:120; slot tier staffing ~:137)
4. Restart — `agents/resume.ts` / `agents/recovery.ts`
5. Dashboard start route — `dashboard/server/routes/agents.ts` (~:3156, shells to `pan start`)

Conversations pin harness at creation in `handleConversationCreate`
(`src/lib/overdeck/conversation-runtime.ts` ~:918, called from `POST /api/conversations` in
`routes/conversations.ts` ~:303) — not a spawn site. Conversation kickoff templates read at
request time live in `roles/` (`handoff.md`, `retrospective.md`); `src/lib/cloister/prompts/*.md`
are build-copied to `dist/dashboard/prompts/` and cached by `renderPrompt`.

## Remote (Fly.io) work agents

Work agents can run on Fly.io VMs (`src/lib/remote/remote-agents.ts`,
`fly-provider.ts`). State lives at
`~/.overdeck/agents/agent-<issue>/remote-state.json` (`location: 'remote'`,
`vmName`, `status`). The dashboard surfaces them via
`listActiveRemoteAgentStates()` in `services/resource-discovery.ts` (issue chip
+ aggregate status, PAN-1676) and session-row synthesis in
`routes/projects.ts` `collectSessionTreeNodes()` (PAN-1775). Remote agents have
no local tmux session — never assume tmux discovery covers them.

<!-- last-verified: 2026-09-16 -->
