# Changelog

## Unreleased

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
