# Changelog

## Unreleased

### Added: Deft state in the dashboard

- The issue menu offers **Run on Deft** and **Back to Overdeck**, which run `pan skills deft use|back` (PAN-4849).
- A Deft issue's cockpit shows Deft's escalations (resolvable in a new Decisions tab and from Needs-you), decision records, policy, scopes with **Sign off**, the scope dependency map, Deft's gate runs and Deft's review cycle (PAN-4849).
- The question dialog answers Deft's numbered menus with the exact label for Claude Code Deft agents (PAN-4849).
- Board cards, project-tree rows, the phase rail, Changes › Files, Activity and the agents lane show Deft's scope counts, spec and install drift, delivery state, approved-scope check, finish loop and subagent heartbeats (PAN-4849).
- New routes: `GET /api/issues/:id/deft`, `GET /api/issues/:id/deft/review-cycle`, `GET /api/deft/issues`, `POST /api/issues/:id/pipeline`, and the escalation-resolve and scope sign-off routes (PAN-4849).

### Added: Deft pipeline per issue

- `pan skills deft use <ISSUE>` runs one issue on Deft Directive's own pipeline: Overdeck installs Directive into that issue's worktree and hides every deposited file from git, so the PR never carries it. Bun projects get the runtime through `bun add` and Directive's own setup step (PAN-4820).
- The work agent gets a Deft kickoff (Deft's build, pre-PR and review-cycle skills); Overdeck runs no review, test or verification agents for the issue, and `pan sync-main` lifts the hidden install around the merge (PAN-4820).
- The merge gate waives the approval at head for a Deft issue, so its PR reaches awaiting merge, and adds a merge guard that refuses install paths, drifted hidden files, and a stale `.pan/deft/<ISSUE>/` state archive (PAN-4820).
- Auto-merge holds a Deft issue whose Deft policy requires a human merge (PAN-4820).
- `pan skills deft save|show|back <ISSUE>`: commit the state archive, inspect the install and merge-guard verdict, and switch back with an exact undo (PAN-4820).

### Added: SageOx without committing (PAN-4852)

- Overdeck builds `ox` itself: `pan skills pack add sageox` (no `--ref` needed; the pack pins `eltmon/ox` `0e6c7e2`) shows the three `go build` commands, the output paths and the downloads (Go modules and, when your Go is older, the go1.27.3 toolchain), then builds `ox`, `ox-adapter-claude-code` and `ox-adapter-codex` into `~/.overdeck/packs/sageox/<commit>/bin/`. `update` and `sync` rebuild when needed, launches and `pan doctor` use only that binary, and nothing is written to `~/.local/bin` or outside `~/.overdeck/`. `pan skills pack remove sageox` keeps the stored SageOx links (PAN-4852).
- `pan skills pack sageox link --project <key>` runs `ox init` in a throwaway worktree, stores the project's `.sageox/` files outside the repository, and waits for the ledger clone; no checkout changes. With SageOx on, each launch places those files in its checkout, hides them from git (the worktree's `info/overdeck-exclude`, or an `info/exclude` block in the primary checkout), and removes them at the next launch after SageOx is switched off. `pan skills pack sageox status` gains a `LINK` column (PAN-4852).
- Every merge door refuses a PR that touches `.sageox/` unless the project committed its link; `pan skills pack sageox commit --project <key>` opens that one PR and records `sageox_binding: committed` (PAN-4852).
- SageOx works with Codex launches: six `ox agent hook` hooks in the agent's own `CODEX_HOME`, pre-trusted in `config.toml`, removed when SageOx is off (PAN-4852).
- The `eltmon/ox` fork is rebased onto upstream `v0.25.0` as new `overdeck-base-v0.25.0` and `overdeck/host-managed-v0.25.0` branches; `docs/SAGEOX-FORK.md` records the rebase (PAN-4852).

### Added: Overdeck Anywhere

The public, per-release changelog is [`changelog.mdx`](changelog.mdx). Session Vault (`pan vault`) and device pairing (`pan pair`, `pan devices`) were released in v0.64.0. Merged since then:

- Scoped API tokens: `pan token create|list|revoke` and `/api/access-tokens` (#4441, PAN-2351).
- Settings → Access Tokens and the `dashboard.require_token_mint` toggle (#4450, PAN-4435).
- Settings → Anywhere: pair dialog, trusted addresses, paired devices, Anywhere status card (#4449, PAN-4445).
- Dashboard Session Vault: automatic save and sync, Settings → Session Vault with the eviction review (#4444, PAN-4307).
- Read-only "from `<machine>`" conversation rows for vault conversations another machine owns (#4448, PAN-4436).
- **Continue here** for those rows (#4454, PAN-4437).
- **Continue on another device** from a conversation: open it on another screen (QR code, optional pairing) or hand it off through the Session Vault (PAN-4455).

### Added: gstack skill pack

- `pan skills pack add gstack https://github.com/eltmon/gstack --ref main` adds gstack as a runtime pack. The eltmon fork's pack mode renders the skills and their bash/bun runtime into `~/.overdeck/packs/gstack/render/<commit>/` and keeps gstack's state in `~/.overdeck/packs/gstack/state/`; it never writes `~/.claude` or `~/.gstack` and never calls the network (PAN-4727).
- The consent preview shows the exact render command, every script the mounted skills can run, and the skills that are not mounted. Trusting renders the commit once; `update` and `sync` render again when needed, and launches never render.
- gstack skills are classified as default, opt-in (code sent to OpenAI, paid or cloud APIs, pushes, blocking hooks), browser, browser-opt-in, or excluded.
- `pan skills pack browser gstack` (or `pan skills pack add gstack … --browser`) builds gstack's browser, design and PDF runtime after a second consent that lists the exact command, each direct npm dependency, a summary line for their locked dependencies and one for the Playwright browsers, and every path the build writes; nine browser skills (qa, qa-only, browse, make-pdf and more) then mount with the pack toggle and nine more (ship, land-and-deploy, the design skills) with a per-skill `on`. The runtime itself stays under `~/.overdeck/packs/gstack/` and `pan skills pack browser gstack off` removes it; running browser skills also write project `.gstack/` files, `/tmp/browse-*` files and bun's transpiler cache under `~/.bun/install/cache/@t@`, which `off` and `remove` leave in place. `remove` and `off` report live browse daemons without stopping them (PAN-4730).
- `pan skills pack remove gstack` also removes every mount, launch link and Codex plugin cache that holds gstack, and lists project `.gstack/` dirs without deleting them; `pan skills pack gc` removes stale renders and orphaned pack state.

### Docs: skill packs

- A dedicated Skill Packs page (`features/skill-packs.mdx`) with the quickstart, the pack catalog, the consolidated trust model, the fork sync runbook, and the per-pack sections moved out of `features/skills.mdx`.
- A `pan skills` CLI reference page (`cli/skills-commands.mdx`) covering every `pan skills`, `pan skills pack`, and `pan skills deft` subcommand.
- A `docs/SKILL-PACKS.md` developer guide to `src/lib/skill-packs/` and `src/lib/skill-overrides/`: the module map, data flow, adapter contract, and how to add a pack or write a new adapter.

### Breaking changes

**Removed public exports.** `src/index.ts` (the `@overdeck/core` main entry) is an internal entry point, not a supported library API, so names can be removed in any release. These 38 names are gone with no bare-name replacement:

- **#4026** — `findDevrootForProject`, `hasAlias`, `isOverdeckSymlink`, `isAnthropicModel`, `validateSettings` (5 names).
- **#4050** — `findDevrootForProjectSync`, `HANDOFFS_DIR`, `CACHE_SKILLS_DIR`, `DOCS_INDEX_FILE`, `DOCS_BUDGET_STATE_FILE`, `DOCS_DISABLE_STATE_FILE`, `DOCS_TELEMETRY_FILE`, `resolvePiExtensionPath`, `getDirectProviders`, `isOverdeckSymlinkSync` (10 names).
- **#4055** — `DOCS_INDEX_SCHEMA_VERSION`, `createDocsIndexSchema`, `readDocsIndexMetadata`, `createDocsEmbeddingFunction`, `embedDocsWithLocalModel`, `embedDocsWithOpenAI`, `isAnthropicModelSync`, `hasAliasSync` (8 names).
- **#4051** — `LEGACY_RUNTIME_DIRS`, `piExtensionCandidates`, `getDocsDir`, `loadDocsCorpus`, `deterministicDocsTestEmbedding`, `saveSettingsSync`, `validateSettingsSync` (7 names).
- **#4049** — `claudeProjectDir`, `claudeSessionTranscriptExists`, `encodeClaudeProjectDir`, `sessionFilePath`, `sessionIdFromFile` moved from `paths.ts` into internal `src/lib/runtimes/storage/*.ts` modules with no public re-export (5 names).
- **#4044** — `saveSettings` (1 name). Its `…Sync` twin, `saveSettingsSync`, was later deleted outright by #4051 rather than renamed, so `saveSettings` never came back.
- **#4048** — `getConversationsConfig`, `getConversationsConfigSync` deleted from `config.ts` as dead code ("Neither had a production caller: every apparent caller imported config-yaml's function of the same name").

Use the corresponding `…Sync` function where one still exists; for the docs-index and storage-path names there is no replacement in the public surface.

**Renamed public exports (#4057, PAN-4002).** 36 exports reachable from `src/index.ts` were renamed from a stale `…Sync`/`…Promise` suffix to the bare name (ts-morph codemod rename, every call site updated with it, no compatibility alias):

| Old | New |
| --- | --- |
| `backupFileSync` | `backupFile` |
| `cleanOldBackupsSync` | `cleanOldBackups` |
| `createBackupSync` | `createBackup` |
| `listBackupsSync` | `listBackups` |
| `restoreBackupSync` | `restoreBackup` |
| `getDashboardApiUrlSync` | `getDashboardApiUrl` |
| `getDashboardLoopbackApiUrlSync` | `getDashboardLoopbackApiUrl` |
| `getDefaultConfigSync` | `getDefaultConfig` |
| `getDevrootPathSync` | `getDevrootPath` |
| `saveConfigSync` | `saveConfig` |
| `clearCredentialFileAuthSync` | `clearCredentialFileAuth` |
| `getProviderEnvSync` | `getProviderEnv` |
| `getProviderForModelSync` | `getProviderForModel` |
| `setupCredentialFileAuthSync` | `setupCredentialFileAuth` |
| `getAgentCommandSync` | `getAgentCommand` |
| `getAvailableModelsSync` | `getAvailableModels` |
| `getClaudeModelFlagSync` | `getClaudeModelFlag` |
| `getDefaultSettingsSync` | `getDefaultSettings` |
| `loadSettingsSync` | `loadSettings` |
| `addAliasSync` | `addAlias` |
| `detectShellSync` | `detectShell` |
| `getAliasInstructionsSync` | `getAliasInstructions` |
| `getShellRcFileSync` | `getShellRcFile` |
| `executeSyncSync` | `executeSync` |
| `migrateStalePersonalContentSync` | `migrateStalePersonalContent` |
| `mirrorProjectSkillsSync` | `mirrorProjectSkills` |
| `planSyncSync` | `planSync` |
| `refreshCacheSync` | `refreshCache` |
| `removeLegacySkills070Sync` | `removeLegacySkills070` |
| `syncContextLayersSync` | `syncContextLayers` |
| `syncPiSettingsSync` | `syncPiSettings` |
| `syncStatuslineSync` | `syncStatusline` |
| `isStartupSyncNeededSync` | `isStartupSyncNeeded` |
| `writeSyncManifestSync` | `writeSyncManifest` |
| `planHooksSyncSync` | `planHooksSync` |
| `syncHooksSync` | `syncHooks` |

**Signature changes: Effect → Promise.** `loadConfig` (`src/lib/config.ts`, #4043) now returns `Promise<OverdeckConfig>` instead of `Effect.Effect<OverdeckConfig, FsError>`.

**Signature changes: Effect → plain synchronous return.** 32 names did not come back as Effects after their removal. Their `…Sync` twin was renamed onto the bare name by #4057, so the bare name is now the plain synchronous function, not an Effect wrapper: 29 whose Effect wrapper was deleted by #4026/#4029, and 3 (`getDashboardApiUrl`, `createBackup`, `syncContextLayers`) whose Effect wrapper was deleted by #4044 instead. A caller doing `Effect.runPromise(getDefaultConfig())` or `yield* loadSettings()` breaks at runtime even though the export name is unchanged:

`getDefaultConfig`, `getDevrootPath`, `getProviderForModel`, `getProviderEnv`, `getAgentCommand`, `getAvailableModels`, `getClaudeModelFlag`, `getDefaultSettings`, `loadSettings`, `detectShell`, `getAliasInstructions`, `getShellRcFile`, `addAlias`, `executeSync`, `migrateStalePersonalContent`, `mirrorProjectSkills`, `planSync`, `refreshCache`, `removeLegacySkills070`, `syncStatusline`, `syncPiSettings`, `planHooksSync`, `syncHooks`, `cleanOldBackups`, `listBackups`, `createBackup`, `restoreBackup`, `saveConfig`, `clearCredentialFileAuth`, `setupCredentialFileAuth`, `getDashboardApiUrl`, `syncContextLayers`

(`saveSettings` is not in this list: its `…Sync` twin was deleted, not renamed, by #4051, so `saveSettings` is a permanent removal — see "Removed public exports" — not a signature change.)

### Behavior changes

- **Diverged-push recovery on merge approve (#4041).** Approving a merge whose push finds `origin/main` has moved returns HTTP 409 with both SHAs and recovery steps, instead of HTTP 400 "Merge succeeded but push failed" with the raw error. No automatic reset, force-push, or retry.
- **Stash route errors carry git's message (#4041).** A failing git command in the stash routes (list, recover, drop, and the workspace-view stash list) now returns git's actual error text in the 500 body, instead of an empty string.
- **Herdr stop closes more agent-stop paths (#4048).** `pan handoff`, the memory governor, `pan start --fresh`, migrate-to-remote, and stuck-agent force kill now stop agents through `stopAgent`, which closes the agent's pane on whichever terminal backend is selected (Herdr or tmux). The underlying close-through-backend primitive shipped in v0.60.0 (#3989, already released); #4048 is what routes these additional stop paths through it.
- **One merge gate for strikes, the CI test job, and failed UAT (#4040).** Every merge door (merge-ready set, dashboard Merge button, auto-merge executor, merge train, per-project merge queue) now asks a single `evaluateIssueMergeGate`. A CI-mode project's merge now requires a recognized CI test-job check to have concluded `SUCCESS` on the PR head (a skipped-only test job no longer counts as green), and a failed UAT verdict for the current head blocks merge readiness until a later pass restores it. A UAT verdict comment posted before this change carries no marker, so it now reads as no verdict — it neither blocks nor clears a merge.
- **Verdict and UAT markers are trusted only from authorized sources (#4040).** A PR comment's verdict marker (UAT pass/fail, `APPROVED`, `CHANGES_REQUESTED`) is read only when GitHub reports the comment author's association as `OWNER`, `MEMBER`, or `COLLABORATOR`, or when the author is Overdeck's own posting identity. This closes a pre-existing hole where an `overdeck-verdict: APPROVED` comment from any GitHub account on the public repo counted as review approval.

### Changed

- OpenAI model routing now requires Codex/ChatGPT subscription auth through CLIProxy; direct OpenAI API-key fallback is deprecated because api.openai.com is not Anthropic-compatible.
- Kimi models now launch through Claude Code directly, selecting the Kimi coding or Moonshot Anthropic endpoint from the configured key prefix.
- Z.AI / GLM models now launch through Claude Code directly against Z.AI's Anthropic-compatible endpoint.
- MiniMax models now launch through Claude Code directly against MiniMax's Anthropic-compatible endpoint.
- Mimo models now launch through Claude Code directly against Xiaomi MiMo's Anthropic-compatible endpoint.
- OpenRouter models now launch through Claude Code directly against OpenRouter's Anthropic-compatible endpoint while preserving slash-containing model IDs.
- `pan install`, `pan sync`, and lazy prerequisite checks no longer install or require `claudish`.
- Provider compatibility is now direct-only; claudish provider helpers and inspector badges have been removed.

## [0.7.0] — Command Taxonomy Reorganization

### Breaking Changes

The `pan` command surface has been reorganized around a five-bucket taxonomy.
All plumbing commands move under `pan admin`. Lifecycle commands lose the `pan work` prefix.

**Migration table:**

| Legacy | New |
|---|---|
| `pan work issue <id>` | `pan start <id>` |
| `pan work plan <id>` | `pan plan <id>` |
| `pan plan-finalize <id>` | `pan plan finalize <id>` |
| `pan work list` / `pan work triage` | `pan issues` |
| `pan work tell <id>` | `pan tell <id>` |
| `pan work kill <id>` | `pan kill <id>` |
| `pan work resume <id>` | `pan resume <id>` |
| `pan work recover <id>` | `pan recover <id>` |
| `pan work done <id>` | `pan done <id>` |
| `pan work approve <id>` | `pan approve <id>` |
| `pan work reopen <id>` | `pan reopen <id>` |
| `pan work wipe <id>` | `pan wipe <id>` |
| `pan work sync-main <id>` | `pan sync-main <id>` |
| `pan inspect <id>` | `pan inspect <id>` *(unchanged)* |
| `pan work close-out <id>` | `pan close <id>` |
| `pan work pending` | `pan review pending` |
| `pan work request-review <id>` | `pan review request <id>` |
| `pan work reset-review <id>` | `pan review reset <id>` |
| `pan work reset-session <id>` | `pan review reset <id> --session` |
| `pan work shadow <id>` | `pan show <id>` |
| `pan work cv <id>` | `pan show <id> --cv` |
| `pan work context <id>` | `pan show <id> --context` |
| `pan work health <id>` | `pan show <id> --health` |
| `pan work refresh <id>` | `pan show <id>` *(refresh implicit)* |
| `pan work list` | `pan issues` |
| `pan work triage` | `pan issues` |
| `pan cloister *` | `pan admin cloister *` |
| `pan specialists *` | `pan admin specialists *` |
| `pan remote *` | `pan admin remote *` |
| `pan db *` | `pan admin db *` |
| `pan beads *` | `pan admin beads *` |
| `pan config *` | `pan admin config *` |
| `pan setup hooks` | `pan admin hooks install` |
| `pan work hook *` | `pan admin fpp *` |
| `pan work tldr *` | `pan admin tldr *` |
| `pan work linear-states` | `pan admin tracker linear-states` |
| `pan work linear-cleanup` | `pan admin tracker linear-cleanup` |
| `pan migrate-config` | `pan admin migrate-config` |
| `pan sync-costs` | `pan cost sync` |

### New Commands

- `pan show <id>` — Unified observation: shadow state, CV, context, health in one command
  - `--cv` — agent work history only
  - `--context` — context engineering state
  - `--health` — health + heartbeat only
- `pan review pending` — Completed work awaiting review
- `pan review request <id>` — Request re-review after fixing feedback
- `pan review reset <id>` — Reset review/test/merge cycles
  - `--session` — also clears saved Claude session
- `pan issues` — List and triage work across configured trackers
- `pan plan <id>` — Create execution plan (was `pan work plan`)
- `pan plan finalize <id>` — Materialize plan to beads (was `pan plan-finalize`)

### Changes

- `pan admin` namespace introduced for all plumbing commands
- Dashboard HTTP routes renamed: `/api/work/*` → `/api/issues/*`, `/api/review/*`, `/api/show/*`, `/api/admin/*`
- All distributed Claude Code skills renamed to match new CLI verbs
- Umbrella `/pan` skill added to Claude Code for single entry point
- First-launch upgrade announcement banner added to dashboard

### Deprecations Removed

- `pan work` command group (no stub — `pan work <anything>` is an unknown command)
- Top-level `pan cloister`, `pan specialists`, `pan remote`, `pan db`, `pan beads`, `pan config`, `pan migrate-config`
- `pan setup hooks` (replaced by `pan admin hooks install`)
- `pan plan-finalize` (replaced by `pan plan finalize`)
- `pan sync-costs` (replaced by `pan cost sync`)
