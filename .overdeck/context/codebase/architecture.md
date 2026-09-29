# Architecture

Overdeck is a multi-agent orchestrator for AI coding work: a CLI (`pan`), a
dashboard server, a React frontend, and a fleet of coding agents hosted on a
terminal backend (Herdr by default, tmux when `terminal.backend: tmux`).

## Top-level layout

| Path | What lives there |
| --- | --- |
| `src/cli/` | Commander-based CLI. `index.ts` declares all verbs/flags; `commands/` holds per-verb modules (doctor, install, memory, task…). |
| `src/lib/` | Core domain logic shared by CLI and server. The big ones below. |
| `src/dashboard/server/` | Effect.js HTTP server + raw WebSocket terminal streaming. Entry `main.ts`, routes in `routes/`, services in `services/`. Runs ONLY as built `dist/dashboard/server.js` under Node 22. |
| `src/dashboard/frontend/` | React + Zustand + Vite SPA. Components under `src/components/`. |
| `packages/contracts/` | Shared types/schemas (`@overdeck/contracts`) used by server + frontend (e.g. `Harness` union at `src/types.ts:49`). |
| `sync-sources/skills/` | Bundled wrapper skills for `pan` verbs, one `<name>/SKILL.md` each (lint-enforced vs `--help` by `scripts/lint-skills.sh`). Exception: `okf/` is canonical in `eltmon/okf` (since 2026-09-29; the old subtree mirror was deleted in `abaeeab9647`) and is vendored here from a release tag — never edit it in place (PAN-4408). |
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
- `harness-policy.ts` — sync, pure launchability gate `canUseHarness()`. Denies ohmypi or
  prime-agent + Anthropic + subscription (ToS), non-Kimi models on acp/kimi-code,
  cross-routing of opencode and Muse ids, Ollama off claude-code, and subscription-only
  OpenAI models under API-key auth. Unlisted harnesses are denied. Never weaken.
- `providers.ts` — `PROVIDERS` registry (18 providers incl. opencode/meta),
  `getProviderForModel()`, per-provider `tierModels` (opus/sonnet/haiku slots).
- `model-capabilities.ts` — `MODEL_CAPABILITIES` skill/cost matrix; `model-deprecations.ts`
  alias table; `model-capability-class.ts` (PAN-3842) frontier/workhorse/small classes.
  New models land in `model-capability-additions.ts` (spread first into the matrix);
  `model-capabilities.ts` is at its file-size cap. Adding a `ModelId` also needs rows in
  `model-fallback.ts` `MODEL_PROVIDERS`, `providers.ts`, `cost.ts` and the dashboard pickers.
- `config-yaml.ts` — `~/.overdeck/*.yaml` settings: `RoleConfig` (model/harness/effort
  per role), `providerHarnesses`, workhorses, normalization + defaults.
- `settings-api.ts` — settings GET/PUT payload mapping between YAML and dashboard.
- `github-quota/` (PAN-4264) — GitHub API quota metering: the per-hour ledger,
  `runGh` (metered `gh` exec), `withGitHubCaller`, App/PAT metering
  (`rest-meter.ts`), the cross-process pause gate, the GraphQL `rateLimit`
  sampler (REST `/rate_limit` for the REST bucket) and the quota snapshot.
  Policy: `docs/PIPELINE-GATES.md` "GitHub quota policy".
- `agents/permission-prompt.ts` + `overdeck/conversation-permission*.ts` (PAN-4278) —
  parse Claude Code's terminal permission prompt from a pane, the in-memory
  PermissionRequest hook registry, the conversation `pendingPermission` feed field,
  and the arrows + Enter answer route. See `docs/DASHBOARD-ARCHITECTURE.md`.
- `vault/` (PAN-2609) — Session Vault: encrypted off-machine transcript storage. Standalone
  (Node built-ins + sibling modules only; `tests/unit/lib/vault/import-graph.test.ts`).
  `store/types.ts` is the `VaultStore` contract (immutable objects + CAS refs; reserved
  slot `keywrap/v1` for the PAN-4328 passphrase-wrapped key), with `store/dir.ts` and
  `store/git.ts` backends and a shared contract suite under `tests/unit/lib/vault/store/`.
  `identity.ts` owns the key and the 24-word phrase. CLI verbs: `src/cli/commands/vault/`.
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
  `cost.ts` (pricing table, `getPricing`), `overdeck/cost.ts` (the two-door
  CostWriter: `record()` dedupes by requestId/sourceFile → append-only archive →
  `cost_events` SQLite; `reconcile({source})` sweeps per-agent session dirs).
  Live triggers: claude via WAL/transcript sync, ohmypi via
  `cloister/pi-cost-reconciler.ts` (gated on a running ohmypi agent), plus
  `POST /api/costs/reconcile` (`dashboard/server/routes/costs.ts`).

## Agent pipeline

Issue → `pan plan` (xBRIEF plan + item checklist) → `pan start` (work agent in a git worktree
`workspaces/feature-<issue>/`) → verification gate → review convoy → test/UAT →
server-side rebase/merge → close-out. Spawned agents live in terminal-backend
panes (Herdr default; legacy tmux on `tmux -L overdeck`), with state in
`~/.overdeck/agents/<id>/state.json`. Liveness is answered only by
`src/lib/agents/liveness.ts`; the dashboard's live pane list is
`services/backend-inventory.ts` (`backendPanesById` in the read model).

## Spawn sites (harness decision points)

1. Plan kickoff — `planning/spawn-planning-session.ts` (~:558)
2. Work agent — `agents/spawn.ts` `spawnAgent` (~:600; single-work tier staffing ~:629)
3. Role runs — `agents/spawn.ts` `spawnRun` (~:120; slot tier staffing ~:137)
4. Restart — `agents/resume.ts` / `agents/recovery.ts`
5. Dashboard start route — `POST /api/agents`, `postAgentsRoute` in
   `dashboard/server/routes/agents/spawn.ts` (~:263, shells to `pan start` via
   `buildPanStartArgs` in `routes/agents/shared.ts`)

Conversations pin harness at creation in `handleConversationCreate`
(`src/lib/overdeck/conversation-runtime.ts` ~:939, called from `POST /api/conversations` in
`routes/conversations.ts` ~:304) — not a spawn site. Conversation kickoff templates read at
request time live in `roles/` (`handoff.md`, `retrospective.md`); `src/lib/cloister/prompts/*.md`
are build-copied to `dist/dashboard/prompts/` and cached by `renderPrompt`.

Planning auto-start consent lives in
`~/.overdeck/agents/planning-<issue>/auto-spawn-on-finalize.json`
(`planning/auto-spawn-consent.ts`): one generation per planning cycle, claimed
and spent by the first consent-bearing work spawn (`withAutoSpawnConsentClaim`
in `agents/spawn.ts` `spawnAgent`/`spawnRun` and `remote/remote-agents.ts`).
There is no per-issue pipeline record since the Cut (PAN-3917).

## Projects and workspaces domain (PAN-1990, PAN-3330)

- `projects.yaml` (`~/.overdeck/projects.yaml`) is the project registry. Read it
  through `getProjectSync`/`listProjectsSync`/`listProjectsAsync` (`src/lib/projects.ts`,
  mtime-cached); write it through `registerProject`/`updateProjectsConfigSync`,
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

## Dashboard Agents page (`/agents`)

`components/Agents/FleetAgentsView.tsx` hosts it. Data is
`GET /api/agent-directory` (`services/agent-directory.ts`, derived on read,
memoized 3 s); entry `state` comes from the pane inventory, never stored
status. PAN-4197 makes the Live view (`?scope=live`) the default and keeps the
Directory as `?view=history`.

## Awareness rail (Command Deck right column)

`components/sessionFeed/SessionFeedSidebar.tsx`: Needs you = `DecisionsPanel`; Project/Global merge conversations (`GET /api/conversations`), `activity.entry` (`recentActivity`, capped at 50) and memory observations in `useMergedFeed.ts`, with All / Chats / Activity tabs. All dates conversations by `createdAt`/`endedAt` in a 24 h window; Chats by recency. Lanes fold into one run card per `(projectKey, gauntletRun)` (`gauntletRunEntries.ts`); D10 lane activity is `laneActivityOf` in `@overdeck/contracts` (PAN-4301). PAN-4306 moves telemetry to `activity.detailed`. Details: `docs/DASHBOARD-ARCHITECTURE.md` "Awareness feed".

## Flywheel (PAN-3964, derived view)

The flywheel is the `/pan-flywheel` skill running in conversation `conv-flywheel`; it has
no run record. `src/lib/flywheel/derive-status.ts` `deriveFlywheelStatus()` computes the
status on read for `pan flywheel status`, `GET /api/flywheel/status`
(`dashboard/server/routes/flywheel.ts`), and the `/flywheel` page
(`frontend/src/pages/FlywheelPage.tsx`, `components/flywheel/`). Every source is an
injectable dep: the lib defaults serve the CLI; the route must inject the server's cached
facts (IssueDataService tracker rows, `getBackendPanes()`), because `src/lib` never
imports server code. Contract: `packages/contracts/src/flywheel-derived.ts`.

Skills: `pan sync` copies `sync-sources/skills` → `~/.overdeck/skills` → `~/.claude/skills` + `~/.agents/skills`; workspaces get a copy in `.claude/skills` (`skills-merge.ts`); Codex agents copy into a per-agent `CODEX_HOME/skills`. Per-skill on/off (global `config.yaml` `skills.overrides`, project `projects.yaml` `skill_overrides`, issue `<planHome>/.pan/skill-overrides/<ISSUE>.yaml`) lives in `src/lib/skill-overrides/`; launchers hide off skills by name at launch through `pan skills launch-settings` (Claude `--settings` `skillOverrides`, Codex `[[skills.config]] enabled=false`) — PAN-3942. `launcher-lines.ts` is a leaf so `launcher-generator.ts` never reaches the store. Skill packs (PAN-4334, `src/lib/skill-packs/`): third-party skill repos registered with `pan skills pack add` (registry `config.yaml` `skills.packs.<id>`, pinned to a trusted commit, cache `~/.overdeck/packs/`), off unless toggled on per level (`pack_overrides`/`skill_pack_overrides`/issue `packs:`); the same launch step mounts enabled pack skills as a generated plugin (Claude `--plugin-dir` per-launch link, Codex `overdeck-packs` local marketplace in per-agent `CODEX_HOME`), shown to agents as `pack:skill`. `KNOWN_PACKS` (`adapters.ts`) carries per-id defaults such as opt-in skills. Deft Directive (PAN-3943): the `deft` known pack uses the `deft-readonly` adapter (`skill-packs/deft.ts` skill map, allowlist, and host notice the mount inserts); `src/lib/deft/` holds read-only Directive detection, the ownership report, the managed-mode decision (`projects.<key>.deft_integration`), and the per-launch plan the same launch step applies (env file read by an allowlist in the launcher, marked `.deft-directive-disable` flag in issue worktrees only, Claude `permissions.deny` outside Directive projects).

## Session Vault (PAN-2609, standalone)

`src/lib/vault/**` + `src/cli/commands/vault/**` (`pan vault`): encrypted off-machine
storage and cross-machine resume. `settle.ts` appends transcript chunks and a `Settlement`
to a CAS'd record through `VaultStore` (`store/dir.ts`, `store/git.ts`); `adopt.ts` +
`materialize.ts` resume elsewhere. Must stay importable without the dashboard, Effect or
terminal backends (`tests/unit/lib/vault/import-graph.test.ts`). PAN-4329 adds
`wip-capture.ts` / `wip-apply.ts`: encrypted git-bundle snapshots of uncommitted code on
`Settlement.wip`.

## Dashboard auth (verified 2026-09-29)

No global auth middleware: each route opts in (`rejectUnauthorizedDashboardRequest`, `rejectUnsafeDashboardMutationRequest` in `routes/dashboard-auth.ts`), and many call only `validateOrigin`. The one credential check is `hasDashboardAuthHeaders` (internal token or the root-derived `overdeck_session` cookie); the session mint also trusts `isLoopbackPeer`. The server binds `0.0.0.0`. `/ws/*` upgrades bypass `HttpRouter` (PAN-1166 / PR #4317 adds `ws-auth.ts`). Machine identity is `src/lib/environment-identity.ts` (`environment-id.json`). PAN-3762 adds device sessions, pairing and a global remote request gate; see `docs/DASHBOARD-AUTH.md`.

<!-- last-verified: 2026-09-29 -->
