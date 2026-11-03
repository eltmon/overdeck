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
| `src/dashboard/server/sharing/` | Shared Sessions host WebRTC (PAN-4474): `peer-hub.ts` (one werift peer per host-admitted viewer, five channels, reads only `control`), `conversation-bridge.ts`, `terminal-bridge.ts` (PAN-4477: a watching viewer's read-only terminal from a Herdr observe stream or a tmux hub listener), `channel-writer.ts`; owned by `ShareManager` in `services/share-host.ts`. Viewer side: `services/share-join.ts` + frontend `components/chat/sharing/` (`SharedTerminalView.tsx` for the terminal). Terminal PTYs: `pty-hub.ts` (tmux, one PTY per session, many `/ws/terminal` clients plus read-only listeners) and `pty-hub-attach.ts` (hub PTY start, `subscribeToTmuxHub`) vs per-client Herdr bridges in `ws-terminal.ts`. See `docs/SHARED-SESSIONS.md`. |
| `src/dashboard/frontend/` | React + Zustand + Vite SPA. Components under `src/components/`. |
| `packages/contracts/` | Shared types/schemas (`@overdeck/contracts`) used by server + frontend (e.g. `Harness` union at `src/types.ts:49`). |
| `packages/anywhere-channel/` | `@overdeck/anywhere-channel` (PAN-4833): the secure-channel protocol (`noise.ts`, `wire.ts`, `initiator.ts`) for server and phone, behind a crypto port. Entries `.` (core), `./node` (`nodeCrypto`), `./web` (`webCrypto`, `openSecureChannel`, `RtcDuplexWeb`, `DirectoryWebClient`, `createMachineDialer`, `createChannelPool`, `ChannelWebSocket`, `installChannelShims`). Source exports, bundled into the server; own `typecheck:anywhere-channel` lane; CP-1 harness under `cp1/`. See its `README.md`. |
| `sync-sources/skills/` | Bundled wrapper skills for `pan` verbs, one `<name>/SKILL.md` each (lint-enforced vs `--help` by `scripts/lint-skills.sh`). Exception: `okf/` is canonical in `eltmon/okf` (since 2026-09-29; the old subtree mirror was deleted in `abaeeab9647`) and is vendored here from a release tag — never edit it in place (PAN-4408). |
| `roles/` | Prompt sources for pipeline roles (plan/work/review/test + review sub-roles). |
| `sync-sources/rules/` | Bundled context rules distributed by `pan sync`. |
| `services/account/` | The overdeck.ai account service: a Cloudflare Worker (D1) for GitHub sign-in, device tokens, the invite-only allowlist and its admin screen. Own Bun workspace and `typecheck:account` lane; Web APIs only; unit tests on a `node:sqlite` D1 shim, one Miniflare integration test. Deploy is operator-only. See `docs/ACCOUNT-SERVICE.md`. |
| `services/connect/` | The overdeck.ai directory (PAN-2356): a Cloudflare Worker with one `AccountDirectory` SQLite Durable Object per account (machine presence and the free 3-machine limit, phone clients (5 per account, not machines; bearer-subprotocol auth), WebRTC signalling, two-screen approval requests, relay TURN credentials and monthly metering, the sealed webhook inbox), checking device tokens through `AccountRpc`. Own `typecheck:connect` lane; tests under `tests/{unit,integration}/services/connect/`; `scripts/anywhere/directory-smoke.mjs` runs it end to end. See `docs/CONNECT-SERVICE.md`. |
| `services/share/` | Shared Sessions rendezvous: a Cloudflare Worker with one `ShareRoom` Durable Object per room (hibernating sockets, WebRTC signalling, Cloudflare Realtime TURN credentials), checking device tokens through the `ACCOUNT` service binding (`AccountRpc`). Own `typecheck:share` lane; tests under `tests/{unit,integration}/services/share/`. See `docs/SHARED-SESSIONS.md`. |

## Key src/lib modules

- `anywhere/` (PAN-4645) — machine links: the X25519 machine key (`machine-key.ts`), the Noise
  secure channel (`channel/`: `open.ts`/`accept.ts`, `ChannelSocket`; the Noise and wire code —
  `noise.ts`, `wire.ts`, the shared initiator — lives in `@overdeck/anywhere-channel` and the
  server passes it the Node crypto port, `nodeCrypto`), route parsing and ranking (`routes.ts`), the link store (`link-store.ts`,
  `machine-links.json`) and `linkFetch` pooling (`link-client.ts`). The supervisor and boot live in
  `src/dashboard/server/services/{link-supervisor,anywhere-boot}.ts`. PAN-2356 adds the WebRTC
  transport (`channel/rtc-transport.ts`, `rtc-duplex.ts`), approval mode `03`, `sealed-box.ts` and
  `directory-config.ts`; the directory client, approvals, relay meter and inbox client are
  `src/dashboard/server/services/{directory-*,relay-client,inbox-client}.ts`. See `docs/ANYWHERE-ARCHITECTURE.md`.
  `connect-runtime.ts` owns the `pan connect` runtime (`ensureDurableRuntime`,
  `isRuntimePackageRoot`); `update-manager.ts` installs updates into it when the dashboard
  runs from it (PAN-4722).
- `agents.ts` is now a thin barrel over `src/lib/agents/` — `spawn.ts` (`spawnAgent`,
  `spawnRun`), `spawn-prep.ts` (`buildAgentLaunchConfig`, tier spawn params),
  `staffing.ts` (the single staffing resolver, PAN-2397), `resolve-tier.ts` +
  `tier-table.ts` (tiered execution), `runtime-command.ts` (`getProviderAuthMode`),
  `delivery.ts`, `health.ts`, `resume.ts`, `termination.ts`. Harness resolution lives in
  `src/lib/harness-resolve.ts`.
- `runtimes/` — harness adapters: `claude-code.ts`, `ohmypi.ts` (+ `ohmypi-fifo.ts`),
  `codex.ts`, `acp.ts`, `kimi-code.ts`, `muse.ts`, plus OpenCode via ACP. `RuntimeName =
  'claude-code' | 'ohmypi' | 'codex' | 'acp' | 'kimi-code' | 'opencode' | 'muse'` (`pi` is a
  legacy alias). Per-harness behavior table: `packages/contracts/src/harness-behavior.ts`;
  its `HarnessBehavior.capabilities` (`packages/contracts/src/harness-capabilities.ts`)
  declares every per-harness behavior decision, and the `lint:harness-branches` ratchet
  keeps harness-name comparisons in `src/` from growing.
- `protocol-capture/` (PAN-4563) — recorded-protocol tests for the Codex app-server and
  ACP transports: capture mode (`OVERDECK_PROTOCOL_CAPTURE_DIR`, off by default), the
  capture-time scrubber, the recorder (`record.ts`), and the replay engine (`replay.ts`).
  Fixtures live in `src/lib/codex/__fixtures__/replay/` and
  `src/lib/acp/__tests__/fixtures/replay/`. See `docs/PROTOCOL-REPLAY-TESTS.md`.
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
  OpenAI ids may also need a ChatGPT-sign-in Codex floor (`codex/model-floors.ts`), and they
  join `GPT_56_MODELS` (`agents/provider-env.ts`) only when the pinned CLIProxy serves them.
  Kimi ids on the Claude Code route get their wire id from `getClaudeCodeLaunchModel`
  (`kimi-claude-routing.ts`, a narrow id set) and `resolveKimiModelForEndpoint` (`providers.ts`,
  coding vs platform endpoint); native `kimi-code/*` aliases need rows in both
  `KIMI_LEGACY_MODEL_TO_NATIVE_ALIAS` and `acp/kimi.ts` `KIMI_ACP_MODEL_IDS` (a lockstep test).
  Retiring an id: a `MODEL_DEPRECATIONS` row, out of `PROVIDERS.<p>.models`/available lists/pickers, but
  capability (`(deprecated)` displayName), cost and `getProviderForModel` lookup-list rows stay.
  `tierModels`/`haikuModel` become Claude Code tier env vars, so they must never name a retired id;
  `tier-table.ts` validates tiered-execution ids against `provider.models`. `getPricing` prefix-matches
  in table order, so a longer id's cost row goes above its prefix. Google/DashScope also need
  `ohmypi-models.ts` registry rows (their default harness is ohmypi).
  `MODEL_CAPABILITIES` is `Record<ModelId, …>`: a retired id stays in its type union and
  routing list (only `models`/`tierModels`/pickers drop it). A provider-native id containing `/`
  (Nous `qwen/qwen3.6-plus`) needs a carve-out before the OpenRouter slash catch-all in
  `getProviderForModel` and `isOpenRouterModel`. Effort = model ∩ harness row (`effort-support.ts`).
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
  and the arrows + Enter answer route; recognizes clipped prompts (rule and title
  off-screen, PAN-4466). See `docs/DASHBOARD-ARCHITECTURE.md`.
- `vault/` (PAN-2609) — Session Vault: encrypted off-machine transcript storage. Standalone
  (Node built-ins + sibling modules only; `tests/unit/lib/vault/import-graph.test.ts`).
  `store/types.ts` is the `VaultStore` contract (immutable objects + CAS refs; reserved
  slot `keywrap/v1` for the PAN-4328 passphrase-wrapped key), with `store/dir.ts` and
  `store/git.ts` backends and a shared contract suite under `tests/unit/lib/vault/store/`.
  `identity.ts` owns the key and the 24-word phrase. CLI verbs: `src/cli/commands/vault/`.
- `memory/facts/` (PAN-3957) — curated memory facts: `store.ts` (one `<id>.md` per fact; project store
  `<planHome>/.overdeck/memory/`, operator store `~/.overdeck/context/memory/`, machine store
  `~/.overdeck/context/machine-memory/`) and `render.ts` (the launch-time index, rendered from
  frontmatter, never stored, never network). PAN-4578: `operator-sync.ts` + `operator-sync-conflicts.ts`
  make the operator store a git clone of an operator-owned remote (setup, sync, status; conflict copies);
  triggers are `pan memory sync` (`memory-sync.ts`), `pan sync`, `--user` writes and the dashboard's
  `operator-memory-sync-service.ts` — never a launch. CLI verbs in `src/cli/commands/memory-facts.ts`.
  Distinct from observation memory (`memory/*.ts`, `~/.overdeck/memory/`).
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
  `cost_events` SQLite; `reconcile({source})` sweeps per-agent session dirs),
  `overdeck/cost-issue-rollup.ts` (trigger-maintained `cost_issue_rollup` table read by
  `getCostsByIssue`, PAN-4724).
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

CI test-job classification (`verification.tests: ci`, PAN-3965) lives in
`cloister/verification-tests-mode.ts` (`isCiTestCheckName`); PR checks
(`cloister/pr-facts.ts`), the default-branch baseline
(`cloister/ci-default-branch-tests.ts`) and the `check_run`/`status` webhooks
(`webhook-handlers.ts` → `cloister/ci-failure-feedback.ts`) all filter through it.

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

Work agents can run on Fly.io VMs. State lives at
`~/.overdeck/agents/agent-<issue>/remote-state.json` (`location: 'remote'`,
`vmName`, `status`), scanned by `listActiveRemoteAgentStates()`
(`remote-agents.ts`). Since PAN-4734, `pan start --remote` (and `--machine fly`)
goes through `src/cli/commands/start-remote.ts` → `POST /api/remote/work-agents`
→ `services/fly-work-agent-service.ts`: the agent runs as a **conversation** on a
PAN-4652 Fly machine (VMs that run `pan serve`, linked from home:
`src/lib/anywhere/fly/`, `services/fly-machine-service.ts`, `pan machines add-fly`),
in the worktree `/workspace/<project>/workspaces/feature-<issue>`. Its remote-state
carries `linked: true` plus the VM tmux target (`tmuxSession: conv-<name>`,
`tmuxSocket: overdeck`) that every remote tmux helper resolves through
`remoteTmuxTarget()`. The issue tree shows it as a linked conversation row
(`resourceDetails.conversations`, `origin: 'linked'`), not a `SessionNode`. Legacy
raw-tmux VMs (`src/lib/remote-workspace.ts` `createRemoteWorkspace`, no Overdeck
server) remain only for workspaces created before PAN-4734; the dashboard helper
`handleRemoteAgentSpawn` still spawns on them and writes `state.json`. Remote agents
have no local tmux session — never assume tmux discovery covers them. The reap is
`remote-completion.ts` (deacon-lite, behind the freeze, keyed on
`/workspace/.pan/REMOTE_DONE`); for a linked agent it destroys the Fly machine
through `destroyAndForgetFlyMachine` (`fly-machine-loops.ts`). The default
image is `registry.fly.io/<app>:latest` (`defaultFlyImage()` in `fly-provider.ts`,
used by both `FlyProvider` and `provisionFlyMachine`), because the Fly registry is
app-scoped (PAN-4682).

## Dashboard Agents page (`/agents`)

`components/Agents/FleetAgentsView.tsx` hosts it. Data is
`GET /api/agent-directory` (`services/agent-directory.ts`, derived on read,
memoized 3 s); entry `state` comes from the pane inventory, never stored
status. PAN-4197 makes the Live view (`?scope=live`) the default and keeps the
Directory as `?view=history`.

## Awareness rail (Command Deck right column)

`components/sessionFeed/SessionFeedSidebar.tsx`: Needs you = `DecisionsPanel`, fed by `lib/useDecisions.ts` (agent rows with non-empty `pendingInputKinds` from the 10 s enrichment poller `services/agent-enrichment-service.ts` → `computeAgentEnrichment` in `src/lib/agent-enrichment.ts`, which also surfaces an open `pan ask` decision from the workspace pipeline journal via `src/lib/cloister/operator-decision.ts` (PAN-4383), plus a 5 s poll of `/api/conversations/pending-input`, which also returns every unarchived held handoff with `heldKickoff: { since, focus? }`, shown as the non-blocking `heldKickoff` kind (PAN-4596)); agent answers go to `POST /api/agents/:id/answer-question` (`routes/agents/permissions.ts`); Project/Global merge conversations (`GET /api/conversations`), `activity.entry` (`recentActivity`, capped at 50) and memory observations in `useMergedFeed.ts`, with All / Chats / Activity tabs. All dates conversations by `createdAt`/`endedAt` in a 24 h window; Chats by recency. Lanes fold into one run card per `(projectKey, gauntletRun)` (`gauntletRunEntries.ts`); D10 lane activity is `laneActivityOf` in `@overdeck/contracts` (PAN-4301). PAN-4306 moves telemetry to `activity.detailed`. Details: `docs/DASHBOARD-ARCHITECTURE.md` "Awareness feed".

## Flywheel (PAN-3964, derived view)

The flywheel is the `/pan-flywheel` skill running in conversation `conv-flywheel`; it has
no run record. `src/lib/flywheel/derive-status.ts` `deriveFlywheelStatus()` computes the
status on read for `pan flywheel status`, `GET /api/flywheel/status`
(`dashboard/server/routes/flywheel.ts`), and the `/flywheel` page
(`frontend/src/pages/FlywheelPage.tsx`, `components/flywheel/`). Every source is an
injectable dep: the lib defaults serve the CLI; the route must inject the server's cached
facts (IssueDataService tracker rows, `getBackendPanes()`), because `src/lib` never
imports server code. Contract: `packages/contracts/src/flywheel-derived.ts`.

Skills: `pan sync` copies `sync-sources/skills` → `~/.overdeck/skills` → `~/.claude/skills` + `~/.agents/skills`; workspaces get a copy in `.claude/skills` (`skills-merge.ts`); Codex agents copy into a per-agent `CODEX_HOME/skills`. Per-skill on/off (global `config.yaml` `skills.overrides`, project `projects.yaml` `skill_overrides`, issue `<planHome>/.pan/skill-overrides/<ISSUE>.yaml`, conversation (`conversations.skill_overrides`, `pan skills launch-settings --conversation`, PAN-4486; `pan handoff --skill/--pack` writes it for the successor, PAN-4499)) lives in `src/lib/skill-overrides/`; launchers hide off skills by name at launch through `pan skills launch-settings` (Claude `--settings` `skillOverrides`, Codex `[[skills.config]] enabled=false`) — PAN-3942. `launcher-lines.ts` is a leaf so `launcher-generator.ts` never reaches the store. Skill packs (PAN-4334, `src/lib/skill-packs/`): third-party skill repos registered with `pan skills pack add` (registry `config.yaml` `skills.packs.<id>`, pinned to a trusted commit, cache `~/.overdeck/packs/`), off unless toggled on per level (`pack_overrides`/`skill_pack_overrides`/issue `packs:`); the same launch step mounts enabled pack skills as a generated plugin (Claude `--plugin-dir` per-launch link, Codex `overdeck-packs` local marketplace in per-agent `CODEX_HOME`), shown to agents as `pack:skill`. `KNOWN_PACKS` (`adapters.ts`) carries per-id defaults such as opt-in skills, a default ref, a `pluginRoot` for packs whose plugin sits in a subfolder (pstack: `harness/pstack/claude-code`, PAN-4728) and `mountExtras` the mount copies next to `skills/`. Deft Directive (PAN-3943): the `deft` known pack uses the `deft-readonly` adapter (`skill-packs/deft.ts` skill map, allowlist, and host notice the mount inserts); `src/lib/deft/` holds read-only Directive detection, the ownership report, the managed-mode decision (`projects.<key>.deft_integration`), and the per-launch plan the same launch step applies (env file read by an allowlist in the launcher, marked `.deft-directive-disable` flag in issue worktrees only, Claude `permissions.deny` outside Directive projects). Per-issue Deft pipeline (PAN-4820): the issue file's `pipeline: deft` key (`deft/issue-pipeline.ts`) switches one issue onto Deft's own pipeline; `deft/install.ts`, `uninstall.ts`, `lift.ts` install Directive into that worktree hidden from git (exclude file, skip-worktree, worktree `core.hooksPath`) and undo it exactly; `archive.ts` (state archive), `merge-guard.ts`, `policy.ts` (auto-merge hold), `role-refusal.ts`, `kickoff.ts` and `switch.ts` wire it into the merge gate, review dispatch, launches and `pan skills deft use|back|save|show`. The dashboard reads Deft's state (PAN-4849) through the fs-only `deft/state-reader.ts` and `review-cycle.ts`, served by `src/dashboard/server/routes/deft.ts` and rendered by `components/deft/`; Deft escalations and menus join pending questions through `deft/pending.ts`. Developer guide: `docs/SKILL-PACKS.md`.

Held kickoff (PAN-4499): `pan handoff --hold` launches the successor's session without delivering its kickoff; the text sits on `conversations.held_kickoff` (`src/lib/overdeck/conversation-kickoff-store.ts`) until `GET`/`POST /api/conversations/:name/kickoff` (`src/lib/overdeck/conversation-kickoff.ts`) claims and sends it exactly once — the only path that does. An ended held conversation renders `HeldHandoffView.tsx` (focus, cwd, handoff doc, Start, Archive, no Resume) instead of "no saved history"; Start POSTs the door, which relaunches the session (PAN-4596). Full mechanism: `docs/FORKS.md`.

SageOx (PAN-2444, PAN-4852): the `sageox` skill pack (sourced from the `eltmon/ox` fork, off by default) is also the opt-in for session capture. `pan skills pack add|update|sync sageox` builds `ox` and its Claude Code and Codex adapters into `<packdir>/<commit>/bin/` (`src/lib/skill-packs/ox-build.ts`); launches, hooks and doctor resolve only that binary (`binary.ts`). `src/lib/sageox/launch.ts` runs inside `pan skills launch-settings` for Claude Code and Codex: when the pack resolves on and the built `ox` answers `ox host-contract --json` with `overdeck-host/1` (`probe.ts`), it places the project's stored binding (`binding.ts`, created by `pan skills pack sageox link`, `link.ts`) into the git root's `.sageox/` and hides it through `src/lib/git/worktree-exclude.ts` (`placement.ts`), then merges the host-managed env and six `ox agent hook` entries into the `--settings` JSON, or writes six pre-trusted hooks into the agent's `CODEX_HOME` (`codex-hooks.ts`); otherwise it warns once and excludes the pack from the mount. When the pack resolves off, the launch removes a placed binding. Every merge door runs `evaluateRepoMergeGuards` (`src/lib/cloister/repo-merge-guards.ts`), which refuses a PR touching `.sageox/` unless the project committed its binding (`merge-guard.ts`; `pan skills pack sageox commit`, `commit.ts`). Uploads are a per-project `sageox_upload` flag in `projects.yaml` (`config.ts`); `pan doctor` reports the built binary (`doctor-sageox.ts`). Fork contract and ledger: `docs/SAGEOX-FORK.md`.

gstack (PAN-4727): the `gstack` known pack uses the `gstack-runtime` adapter. `skill-packs/gstack.ts` is the skill map (classes, unknown names excluded as unreviewed); `skill-packs/render.ts` runs the `eltmon/gstack` fork's pack mode (`bash setup --pack-root <render> --pack-state-root <state>`) only in the CLI write paths (`add`/`update`/`sync`), never at launch. Mounts copy skills from `~/.overdeck/packs/gstack/render/<commit>/`; gstack state lives in `packs/gstack/state/` via a marker file, not launch env. `pan skills pack remove` sweeps mounts, launch links and Codex plugin caches (`mount.ts` `removePackFromMounts`). The optional browser runtime (PAN-4730): `skill-packs/browser.ts` runs the fork's `bash setup --pack-browser <render> --pack-browser-cache <packs/gstack/browser>` after a second consent (`pan skills pack browser gstack on`, recorded as `browser: true` in the registry); the catalog derives readiness from `<render>/.gstack-pack-browser.json`, and the `browser`/`browser-opt-in` skills mount only when it is ready. Launches never build; they warn when consent is recorded but the runtime is missing.

## Session Vault (PAN-2609, standalone)

`src/lib/vault/**` + `src/cli/commands/vault/**` (`pan vault`): encrypted off-machine
storage and cross-machine resume. `settle.ts` appends transcript chunks and a `Settlement`
to a CAS'd record through `VaultStore` (`store/dir.ts`, `store/git.ts`); `adopt.ts` +
`materialize.ts` resume elsewhere. Must stay importable without the dashboard, Effect or
terminal backends (`tests/unit/lib/vault/import-graph.test.ts`). PAN-4329 adds
`wip-capture.ts` / `wip-apply.ts`: encrypted git-bundle snapshots of uncommitted code on
`Settlement.wip`. Dashboard consumer (PAN-4307, verified 2026-10-01): `open.ts` `openVaultContext()`
resolves config/key/store into a tagged state and prints nothing; `src/dashboard/server/services/vault-service.ts`
runs every dashboard vault operation through one queue (`enqueueVaultOperation`) plus the sync loop
(primary dashboard only, or `OVERDECK_VAULT_IN_PEER=1`); `routes/vault.ts` + Settings → Session Vault.
PAN-4647: `vault-agent-subjects.ts` also lists pipeline agents inside their tracking window, so
the settle poller auto-saves work/review/test/plan transcripts, not just managed conversations.

## Pull requests on conversations and issue rows (PAN-3822, PAN-4457)

`conversation_pull_requests` (overdeck.db) links PRs to conversations; door
`src/lib/overdeck/conversation-pull-requests.ts`. The sweep
`services/pull-request-sync-service.ts` (primary dashboard, boot +30 s, 60 s)
inserts `branch` links via `resolveConversationBranch` (`conversation-branch.ts`)
and refreshes snapshots; links are never deleted, only dismissed. `pan done` /
`review-artifacts.ts` write `created` links. Command Deck issue rows
(`ProjectTree/FeatureItem.tsx`) and sidebar workspace rows read the issue's PR
from `DerivedIssueState.pr`, not from links; the conversation list's badge
(`primitives/PullRequestBadge.tsx`) reads the effective link.

Conversation-message delivery (`handleConversationMessage`,
`src/lib/overdeck/conversation-message.ts`) refuses an `ended` conversation with
422; callers resume first via `handleConversationResume`
(`conversation-runtime.ts`). Deacon-lite runs in the forked `deacon.js` child and
reaches the dashboard only over internal HTTP, so work that resumes or messages
conversations belongs in a dashboard service like the PR sync sweep. PAN-4640
added `conversation_schedules` and `services/conversation-schedule-service.ts`
on that pattern.

## Scheduled messages (PAN-4641)

`conversation_scheduled_messages` (overdeck.db) holds operator messages that wait
for a Claude Code usage limit to reset; door
`src/lib/overdeck/conversation-scheduled-messages.ts`. The tick
`src/lib/overdeck/scheduled-message-delivery.ts` acts on each conversation's head
row (resume if ended, defer on a choice menu, paste through
`handleConversationMessage`, then confirm or re-arm from the transcript). It is
hosted by `services/scheduled-message-patrol.ts` in the dashboard process, not the
Deacon child, because the delivery and resume doors live there (60 s, skips peer
dashboards, a frozen Deacon and `OVERDECK_DISABLE_SCHEDULED_MESSAGES=1`). Reset
times come from `conversation-usage-limit.ts` and `limit-reset-text.ts`.

## Conversation triage: settle and snooze (PAN-4639)

`conversations.settled_at` / `settle_reason` (`manual` | `merge` | `idle`) /
`snoozed_until` (epoch ms) are read and written only through
`src/lib/overdeck/conversation-triage-store.ts`; the write route is
`POST /api/conversations/triage` (`routes/conversation-triage.ts`). Settling is
display-only: the session keeps running. An expired snooze is not cleared
server-side; the client derives Inbox from `snoozed_until <= now`. Sections
(Needs you / Inbox / Snoozed / Settled) are a pure client rule decided on the
tree root (`CommandDeck/conversation-triage.ts` `sectionOf`, nesting from
`conversation-tree.ts` `displayParentId`). Automatic settling: on merge is
PAN-4653; on idle is PAN-4655 (`src/lib/overdeck/conversation-idle-settle.ts`,
run by `services/conversation-idle-settle-service.ts`; unsettle and unsnooze
write `idle_reset_at` to restart the clock; setting
`conversations.auto_settle_idle_days`, default 3).

## Dashboard auth (verified 2026-11-01)

No per-route auth middleware; two global gates plus opt-in route checks (`rejectUnauthorizedDashboardRequest`, `rejectUnsafeDashboardMutationRequest` in `routes/dashboard-auth.ts`). `resolveDashboardCredential` is the one credential check: internal token, the root-derived `overdeck_session` cookie, or an `odk_` registry credential from `src/lib/access-tokens.ts` (`~/.overdeck/access-tokens.json`; PAN-3762 paired devices, `kind: 'device'`; PAN-4645 linked machines, `kind: 'machine'`, which resolve only inside a secure channel whose proved key matches the record: `resolveDashboardCredential(headers, channel)`, channel marker from `channel-peer.ts`). `remote-request-gate.ts` is a global middleware requiring a credential on `/api/*` and `/events/*` unless allowlisted or a loopback peer; `ws-auth.ts` `authorizeDashboardUpgrade` gates every `/ws/*` upgrade. The session mint alone trusts `isLoopbackPeer` (off under `dashboard.require_token_mint`, read by `src/lib/remote-access/config.ts`). The server binds `0.0.0.0`. PAN-2351 adds scoped `kind: 'token'` credentials enforced at both gates from one route-scope table (`route-scopes.ts`, default `admin`). PAN-4645 adds the secure channel: `channel-listener.ts` demuxes a `0x00` first byte on the dashboard port (and `/ws/link`) into a Noise channel handed to the HTTP server; `channel` requests are never loopback; `/ws/rpc` gets a scope-restricted RPC group for non-admin credentials (`ws-rpc-auth.ts`); `require_token_mint` is on whenever remote access exists (`remote-access/config.ts`). Machine identity is `src/lib/environment-identity.ts`. See `docs/DASHBOARD-AUTH.md`.

## Webhook triggers (PAN-4648)

`src/lib/triggers/`: `store.ts` is the door for `~/.overdeck/triggers.json` (0600; URL secrets kept as SHA-256 only), `signatures.ts` checks GitHub/Stripe HMACs over raw bytes, `envelope.ts` wraps the body as nonce-fenced external data (44 KiB inline), and `deliver.ts` runs secret → signature → rate limit → CPU hold → pending-input hold → message or create door through injected deps. `POST /hooks/:id/:secret` (`routes/trigger-hooks.ts`) is outside `/api`, so the gate passes it by path; `/api/triggers` (`routes/triggers.ts`) manages triggers; `pan triggers` writes the store directly. A request carrying `Tailscale-Funnel-Request` reaches only `POST /hooks/*`: the gate 404s everything else, the mint and `/ws/*` refuse it. Docs: `configuration/triggers.mdx`, `docs/DASHBOARD-AUTH.md`.

## Conversations across machines (PAN-4650)

Owner side: `src/lib/anywhere/shared-conversations.ts` builds the shared list (`GET /api/machines/conversations`, switch in `anywhere-settings.ts` / `anywhere.json`); `routes/conversation-pull.ts` + `services/conversation-release-service.ts` release a conversation (settle into a transfer store via `src/lib/vault/transfer-pack.ts`, `settle({ index })`), undo and reclaim; `src/lib/overdeck/conversation-release.ts` is the `released_to` / `pulled_from` door and the 409 write refusal every write door calls; `link-fence.ts` refuses agent actors; `ws-forward.ts` + `forward-ports.ts` serve port forwards; `routes/conversation-preview-ports.ts`. Viewer side: `src/lib/overdeck/linked-conversations.ts` (the `linked_conversations` cache door), `services/linked-conversations-sync.ts` (connect + heartbeat hash), `linked-conversations-merge.ts` + `services/conversation-list-merged.ts` (the merged list), `linked-conversation-proxy.ts` (`/api/conversations/@<machine>/…`), `ws-linked.ts` (`/ws/linked/<env>/rpc|terminal`), `services/conversation-pull.ts` (the Pull here job), `services/port-forwards.ts`, `routes/linked-open.ts` + `services/open-remote.ts` (remote-SSH editor). Frontend: `lib/linkedConversation.ts`, `chat/ConversationMachineBanner.tsx`, `chat/PullHereDialog.tsx`, `chat/OpenPreviewPopover.tsx`, `CommandDeck/LinkedConversationRow.tsx`. CLI: `pan conv pull|reclaim`, `pan tell @<machine>/<conv>`, `pan machines forward`. Docs: `configuration/linked-machines.mdx`, `docs/ANYWHERE-ARCHITECTURE.md`.

## Work across machines (PAN-4651)

Owner side: `routes/machines-work.ts` (the `/api/machines/work/*` doors: conversations, workers, issue start, projects; machine credential only, matched by git origin slug), `routes/agents/spawn-issue.ts` (the extracted `POST /api/agents` body), `src/lib/overdeck/conversation-provenance.ts` (`started_by_environment_id`, read by `link-fence.ts`), `routes/workers.ts` status/stop, `routes/machines-projects.ts` + `src/lib/projects/ignored-files.ts` (project source and git-ignored files), `services/machine-load.ts` + `src/lib/anywhere/machine-capabilities.ts` (load and tags in the heartbeat), `services/needs-you-feed.ts`, `services/issue-activity.ts`, `src/lib/costs/request-digest.ts` + `routes/costs-digest.ts`, `src/lib/settings-resolved.ts` + `routes/settings-resolved.ts`. Viewer side: `src/lib/anywhere/placement.ts` (pure D-19 rule) + `services/fleet-target.ts` (`fly` calls `services/fleet-fly-target.ts`'s `startFlyTarget` when the route passes a spawn context; without one, 400 `fly-unavailable`; `auto` falls back to it too when `remote.auto_fly` is on and nothing else fits — PAN-4743), `routes/fleet-work.ts` (`/api/fleet/placement|conversations|workers|issues/:id/start|machines`), `src/lib/agents/worker/remote-standin.ts` + `services/remote-worker-follower.ts` (stand-ins), `src/lib/anywhere/project-origin.ts` + `services/linked-projects-sync.ts` + `routes/fleet-projects.ts` + `services/fleet-add-project.ts`, `services/linked-needs-you-sync.ts` + `routes/fleet-awareness.ts` (Needs-You, search, issue activity), `services/fleet-usage-cache.ts` + `routes/fleet-usage.ts`, `routes/fleet-settings.ts` (Compare settings). CLI: `cli/commands/worker-remote.ts`, `delegation-push-check.ts`, `start-machine.ts`, `machines-who.ts`, `machines-add-project.ts`, `config-set.ts`. Frontend: `newConversation/MachineField.tsx`, `sidebar/OtherMachineProjects.tsx`, `sidebar/AddProjectToMachineDialog.tsx`, `palette-fleet-hits.tsx`, `costs/FleetUsagePanel.tsx`, `Settings/anywhere/CompareSettingsDialog.tsx`. MCP: `src/lib/mcp/tools-{read,write}.ts` use the fleet routes. Docs: `configuration/linked-machines.mdx`, `docs/ANYWHERE-ARCHITECTURE.md` "Work across machines".

Gauntlet lanes across machines (PAN-4638): home keeps the run rules in `src/lib/lanes/launch.ts` (`deps.remote` / `resolveMachine`) over `src/lib/lanes/lane-rows.ts` (`listAllLaneRows`: local lane rows plus stand-ins, cwd key `<environmentId>:<cwd>`) and `src/lib/lanes/remote-lanes.ts` (the stand-in store `~/.overdeck/remote-lanes/<name>/{lane,mirror,archived}.json` and the `lane-link.json` critic sidecar); `routes/lanes.ts` resolves `machine` and adds `POST /api/lanes/:name/stop` and the remote reap; `services/remote-lane-follower.ts` mirrors the owner's status and reports. Owner side: `routes/machines-work-lanes.ts` (`/api/machines/work/lanes`, `…/:name/status`, `…/:name/reap`) runs `src/lib/lanes/owner-launch.ts` (`launchOwnedLane`). Views, pairing (by name) and waits: `src/lib/lanes/views.ts`, `pairing.ts`, `wait.ts`; nesting: `src/lib/overdeck/linked-conversations-merge.ts` (`remoteLanes`). CLI: `cli/commands/lane.ts`. Docs: `reference/lanes.mdx` "Lanes on other machines", `docs/ANYWHERE-ARCHITECTURE.md` "Gauntlet lanes across machines".

## Color themes (PAN-4644, PAN-4659, PAN-4660)

Model and built-ins (`overdeck-dark`, `overdeck-light`; read-only, full terminal palette, no `ui`/`syntax`) live in `packages/contracts/src/color-theme.ts` (`normalizeColorTheme`, `effectiveTerminalPalette`, `slugifyThemeId`, `RESERVED_COLOR_THEME_IDS`). User themes are `~/.overdeck/themes/<id>.json` via `src/lib/color-themes/store.ts` (read fresh on every list; `saveColorTheme` is create-only — `claimThemeFile` uses `link()` and suffixes `-2`, never overwrites; `updateColorTheme` is the in-place counterpart — temp file + `rename()`, refuses built-in/reserved ids). Selection is `ui.color_theme.{light,dark}` in `config.yaml` (`selection.ts` read, `selection-write.ts` write door); `terminal-background.ts` feeds the tmux `window-style` stamp for new sessions only. VS Code import: `vscode-import.ts` maps one theme JSON(C); `.vsix` packages (PAN-4659) are read in memory by `zip-reader.ts` and every contributed theme is mapped by `vsix-import.ts`; the preview route returns a `themes[]` array and writes nothing. Routes: `src/dashboard/server/routes/color-themes.ts` (`GET /api/color-themes`, `PUT …/selection`, `POST …/import/preview`, `POST /api/color-themes`, `PUT /api/color-themes/:id`). Frontend: `hooks/useColorTheme.ts` (zustand; `applyUiTokens` writes the `ui` subset as inline styles on `<html>`, never signal/state tokens; `reconcileFromServer` refetches and re-applies; `updateTheme` PUTs then reconciles), `lib/uiTokenStyles.ts` (pure `uiTokenStyles(theme)`, shared by `applyUiTokens` and the editor preview), `lib/colorThemeEditor.ts` (pure draft model: `createDraft`/`setEdit`/`revertEdit`/`draftToFile`/`pickerValue`), `lib/syntaxTheme.ts` (content-hashed Shiki theme names), consumers `XTerminal.tsx`, `chat/ChatMarkdown.tsx`, `chat/MarkdownFileLink.tsx`; UI in `Settings/sections/ColorThemeSection.tsx` (theme list, Duplicate-and-edit/Edit entry points) + `ColorThemeImportPreview.tsx` + `ColorThemeEditor.tsx` + `ColorThemeEditorPreview.tsx`. Docs: `configuration/appearance.mdx` "Color themes".

<!-- last-verified: 2026-11-03 (PAN-4477, PAN-4834, PAN-4852, PAN-4829, PAN-4833, PAN-4849, PAN-4820, PAN-4827, PAN-4825, PAN-4813, PAN-4728, PAN-4651, PAN-4730, PAN-4638, PAN-4759, PAN-4682, PAN-4655, PAN-4644, PAN-4659, PAN-4660, PAN-4743, PAN-4722) -->
