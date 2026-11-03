# Skill Packs: Developer Guide

## Overview

A skill pack is a third-party git repository of skills that Overdeck pins to
one trusted commit and mounts into Overdeck-managed Claude Code and Codex
launches. This doc covers the module layout, the data flow from `pan skills
pack add` to a mounted skill, the adapter contract, and how to add a known
pack or write a new adapter. For the operator-facing feature — the quickstart,
the pack catalog, the trust model, and the fork runbook — see
[features/skill-packs.mdx](../features/skill-packs.mdx). For every CLI flag,
see [cli/skills-commands.mdx](../cli/skills-commands.mdx).

## Module map

### `src/lib/skill-packs/`

| File | Responsibility |
|---|---|
| `sources.ts` | The pack registry (`config.yaml` `skills.packs.<id>`) and cache paths; `addPack`, `updatePack`, `removePack`, `syncPack`, `enablePackBrowser`, `disablePackBrowser` |
| `adapters.ts` | `KNOWN_PACKS`, `PackAdapterId`, `detectAdapter`, `readPackManifest`, `notAppliedLabels` |
| `mount.ts` | `buildMount`, `linkClaudeMount`, `writeCodexPackBlock`, `gcMounts`, `removePackFromMounts`, `CODEX_PACK_MARKETPLACE` |
| `render.ts` | `renderRuntimePack`, `isRenderReady`, `gcPackRenders` |
| `browser.ts` | `buildBrowserRuntime`, `isBrowserReady`, `browserDownloads` |
| `gstack.ts` | `GSTACK_SKILL_MAP`, `classifyGstackSkill`, `GSTACK_DISCLOSURE` |
| `deft.ts` | `DEFT_SKILL_MAP`, `DEFT_READONLY_SKILLS`, `applyDeftHostNotice` |

### `src/lib/skill-overrides/`

| File | Responsibility |
|---|---|
| `resolve.ts` | `CORE_SKILLS`, `resolvePackSkill`, `resolvePackToggle`, `resolveSkillStates` |
| `store.ts` | `setSkillOverride`, `setIssuePipeline`, `listSkillStates`, `loadSkillOverrideLayers`, `issueSkillOverridesPath` |
| `issue-file.ts` | Reads of the issue file (`skills:`, `packs:`, `pipeline:`): `readIssueOverrides`, `readIssuePipelineField`; split from `store.ts` so `deft/issue-pipeline.ts` avoids the store's write-side imports |
| `catalog.ts` | `listSkillCatalog`, `listPackCatalog`, `readInstalledClaudePluginNames` |
| `launch.ts` | `resolveLaunchPackSelection`, `applyClaudePacks`, `applyCodexPacks`, `applyDeftForLaunch`, `claudeSkillSettingsJson` |
| `launcher-lines.ts` | `launcherSkillOverrideLines`, `deftEnvReadLine`, `skillPackLinkPath`, `claudeSkillOverrideLaunch`, `codexSkillOverrideLines` (leaf module) |
| `conversation-flags.ts` | `expandConversationSkillFlags`, `resolveConversationSkillFlags` |

### `src/lib/deft/` — per-issue Deft pipeline (PAN-4820)

| File | Responsibility |
|---|---|
| `issue-pipeline.ts` | `readIssuePipeline`, `isDeftPipelineIssue`: the issue file's `pipeline: deft` key; errors read as Overdeck |
| `install-snapshot.ts` | `DeftInstallSnapshot`, `readDeftSnapshot`, `writeDeftSnapshot`, `touchedDeftDir` |
| `install.ts` | `installDeftIntoWorktree`, `runDirectiveInstall` (npm/pnpm launcher, or `bun add` plus runtime setup for Bun), `deftExcludeFilePath` |
| `uninstall.ts` | `removeDeftInstall`: exact undo from the snapshot |
| `lift.ts` | `withDeftInstallLifted`, `DeftLiftError` |
| `archive.ts` | `planDeftArchive`, `saveDeftState`, `isDeftArchiveCurrent`, `isNativeDirectiveProject` |
| `merge-guard.ts` | `evaluateDeftMergeGuard`, `deftMergeGuardForIssue`, `detectDrift`, `raiseDeftDriftDecision` |
| `policy.ts` | `readDeftPolicy`, `requireHumanMergeOf`, `deftAutoMergeHold` |
| `role-refusal.ts` | `assertRoleRunsOnPipeline`, `DeftPipelineRoleRefusedError` |
| `kickoff.ts` | `buildDeftWorkAgentPrompt`, `DeftNotInstalledError` (template `src/lib/cloister/prompts/work-deft.md`) |
| `switch.ts` | `useDeftPipeline`, `backToOverdeck` |
| `state-reader.ts` | `readDeftIssueState`, `summarizeDeftIssueState`: parses Directive's state files in the worktree for the dashboard (fs only, never throws; PAN-4849) |
| `escalations.ts` | `resolveDeftEscalation` (atomic rewrite of `.deft/escalations/<id>.json`), `notifyEscalationResolved` |
| `pending.ts` | `deftEscalationQuestions`, `deftMenuQuestion`, `deftIssueForAgent`: Deft escalations and menus as pending questions (read side, imported by `agent-enrichment.ts`) |
| `pending-answer.ts` | `answerDeftEscalation`, `answerDeftMenu`, `mapDeftEscalationAnswer`: the question dialog's answers (split from `pending.ts` to keep agent delivery out of the enrichment's imports) |
| `menu-parser.ts` | `parseDeftMenu`: Deft's numbered menu ending Discuss/Back |
| `signoff.ts` | `signOffDisposition`: human-event sign-off of a scope item's disposition |
| `review-cycle.ts` | `deriveDeftReviewCycle`, `countSeverities`: pure review-cycle view model (reconstructed rounds, exit predicate, lease) |
| `review-cycle-load.ts` | `loadDeftReviewCycle`, `listFixBatchCommits`: loads the review-cycle inputs (cached PR loaders, one async `git log`) |

### Deft pipeline

`pan skills deft use|back|save|show` (`src/cli/commands/skills-deft-pipeline.ts`)
switch one issue onto Deft Directive's pipeline. The install snapshot is
`<worktree>/.overdeck/deft-install.json`; the exclude file is
`<git-dir>/info/overdeck-deft-exclude`; the run summary is
`<worktree>/.overdeck/deft-run-summary.jsonl`. The lift wraps
`rebaseFeatureBranch` (`src/lib/cloister/merge-rebase.ts`), each repo sync in
`syncMainAcrossWorkspaceRepos` (`src/lib/cloister/sync-main-workspace.ts`), and
the merge train's sibling rebase and force-push (`rebaseSibling` in
`src/lib/cloister/merge-train-deps.ts`).
The merge gate (`evaluateIssueMergeGate`, `src/lib/cloister/merge-gate.ts`)
waives approval at head for a Deft issue and runs `deftMergeGuardForIssue`;
`forgeMergeGate` raises the drift decision, and the forge-merge route runs the
guard itself. `startRequestReviewPipeline`, `spawnReviewRoleForIssueBody` and
`spawnRun` keep Overdeck review and test agents off Deft issues; the derived
state treats `deftPipeline` as approved; the auto-merge schedule route,
scheduler and executor apply `deftAutoMergeHold`. User guide:
`features/skill-packs.mdx`, "Running an issue on Deft".

### Other files

`src/cli/commands/skills.ts`, `src/cli/commands/skills-deft.ts`, `src/cli/commands/skills-deft-pipeline.ts`,
`src/dashboard/server/routes/misc/skill-overrides.ts`,
`src/dashboard/frontend/src/components/skills/SkillPacksSection.tsx`,
`src/lib/sageox/`, `src/lib/deft/`.

## Data flow

1. `pan skills pack add <id> [url]` calls `fetchPackSource` and `resolveRef`
   (git, CLI only).
2. `extractCommit` extracts the trusted commit into
   `~/.overdeck/packs/<id>/<commit>/`, honoring the known pack's `pluginRoot`.
3. The adapter reads the manifest (`readPackManifest`).
4. For `gstack-runtime` only: `assertRenderable`, then a render preview.
5. The consent prompt asks to trust the commit (`--yes` is required without a
   TTY).
6. For `gstack-runtime` only: `renderRuntimePack` runs the fork's pack-mode
   setup.
7. `writePackEntry` writes the registry entry.
8. At launch, the launcher runs the hidden `pan skills launch-settings` step.
9. It calls `loadSkillOverrideLayers` and `listPackCatalog`.
10. `resolveLaunchPackSelection` resolves each pack skill's on/off state and
    collects warnings.
11. `buildMount` builds the content-addressed mount.
12. Claude Code: `linkClaudeMount`, then the launch passes `--plugin-dir
    <launch link>`. Codex: `writeCodexPackBlock` writes the `overdeck-packs`
    local marketplace into the agent's `CODEX_HOME`.

## Adapter contract

A `PackManifest` carries `skills`, `capabilities`, `license`, `pluginName`,
and an optional `excluded` list. `PackCapabilities` and `PackSkill` carry the
fields each adapter fills in — see their type definitions in `adapters.ts`.

- **`plain`** — scans `skills/`, or `KnownPack.skillsRoot` when the known pack
  sets one.
- **`claude-plugin`** — reads `.claude-plugin/plugin.json`.
- **`deft-readonly`** — reads `content/skills/deft-directive-<name>/`,
  filtered to the read-only allowlist `DEFT_READONLY_SKILLS`; its mount
  transform inserts the host notice into every mounted `SKILL.md`.
- **`gstack-runtime`** — reads from the render; skills are classified by
  `GSTACK_SKILL_MAP`, and its mount transform reads from the render instead of
  the raw checkout.

## `KnownPack` fields

| Field | Meaning | Packs that use it |
|---|---|---|
| `id` | The pack id | all known packs |
| `url` | Default repository url when none is passed | all known packs |
| `adapter` | Default adapter | all known packs |
| `skillsRoot` | Directory the `plain` adapter scans instead of `skills/`, relative to the plugin root | `sageox` |
| `pluginRoot` | Repo-relative directory holding the plugin (manifest, skills, agents, hooks, license); default the repo root | `pstack` |
| `ref` | Ref `pan skills pack add <id>` pins when `--ref` is omitted (a tag, branch, or 40-hex commit) | `pstack` |
| `mountExtras` | Plugin-root-relative files or directories the mount copies next to `skills/` | `pstack` |
| `optIn` | Skill names that are opt-in: the pack toggle never turns them on | `mattpocock`, `sageox`, `gstack`, `pstack` |
| `disclosure` | One-line statement of what leaves the machine, shown on the pack row | `sageox`, `gstack` |

## Adding a known pack

1. Add a `KNOWN_PACKS` entry in `adapters.ts`.
2. Choose an adapter.
3. Set `optIn` for every skill that writes files Overdeck owns, or reaches
   paid, cloud, or push actions.
4. Set `ref` only when a fixed commit is the right default.
5. Set `pluginRoot`, `skillsRoot`, or `mountExtras` as needed.
6. Add a `disclosure` if anything leaves the machine.
7. If the pack is shown in the dashboard, update its `ADD_COMMAND` literal
   (`src/dashboard/frontend/src/components/skills/SkillPacksSection.tsx`).
8. Add tests in `src/lib/skill-packs/__tests__/adapters.test.ts` and
   `sources.test.ts`.
9. Add a catalog row and a `### <pack>` section to
   [features/skill-packs.mdx](../features/skill-packs.mdx).
10. Add a row to the fork table if the pack comes from a fork.

## Writing a new adapter

1. Extend `PackAdapterId` in `adapters.ts`.
2. Extend the `ADAPTERS` list in `sources.ts` and the `--adapter` check in
   `src/cli/commands/skills.ts`.
3. Implement the manifest read in `adapters.ts`.
4. If the mount must change file contents, add a `MountTransform` in
   `mount.ts` and bump `MOUNT_FORMAT_VERSION`.
5. If the adapter runs code, follow the `render.ts`/`browser.ts` pattern:
   only CLI write paths render or build; a launch only checks readiness.
6. Add tests.

## Invariants

- A launch never touches the network (`launch.ts` header comment;
  `resolveLaunchPackSelection` reads the cache only).
- Mounts are content-addressed and immutable: `mountHash` in `mount.ts`
  names the mount, and building renames it into place.
- Mount contents are copies, never symlinks; the per-launch link is the only symlink.
- The render and the browser build write only under `~/.overdeck/packs/<id>/`;
  skills invoked later may write project `.gstack/`, `/tmp/browse-*` and bun's
  transpiler cache, as [features/skill-packs.mdx](../features/skill-packs.mdx)
  says.
- No repository can self-register a pack; the registry is written only by
  Overdeck's own pack-management functions in `sources.ts` (`addPack`,
  `updatePack`, `enablePackBrowser`, `disablePackBrowser`, `removePack`),
  never by anything a pack's own files can trigger.
- Removal under the agents dir goes through
  `src/lib/agents/state-dir-removal.ts` (`removeCodexPluginCaches`), enforced
  by `npm run lint:agent-dir-removal` (`scripts/guard-agent-dir-removal.sh`).
- `adapters.ts`, `sources.ts`, `mount.ts`, and `deft.ts` never import
  `src/lib/skill-overrides/` (see each file's header comment).
- `launcher-lines.ts` is a leaf module (imports nothing from
  `src/lib/skill-overrides/store.ts`), so `src/lib/launcher-generator.ts`
  never reaches the override store through it.

## Hidden launch step

`pan skills launch-settings --harness <h> --cwd <dir> [--issue <id>]
[--conversation <tmuxSession>] [--codex-home <dir>] [--plugin-link <path>]`
(`src/cli/commands/skills.ts:632-637`).

## Tests

| Part | Test file |
|---|---|
| Pack adapters, sources, browser sources, mount, render, browser, gstack, Deft | `src/lib/skill-packs/__tests__/{adapters,sources,sources-browser,mount,render,browser,gstack,deft}.test.ts` |
| Skill override resolution, store, launch, conversation flags | `src/lib/skill-overrides/__tests__/{resolve,store,launch,conversation-flags}.test.ts` |
| CLI: skills, pack browser, SageOx doctor check | `src/cli/commands/__tests__/{skills,skills-pack-browser,doctor-sageox}.test.ts` |
| Dashboard skill-overrides route | `src/dashboard/server/routes/__tests__/skill-overrides-route.test.ts` |
| Dashboard skill packs UI | `src/dashboard/frontend/src/components/skills/SkillPacksSection.test.tsx` |
| SageOx | `src/lib/sageox/__tests__/*.test.ts` |
| Deft | `src/lib/deft/__tests__/*.test.ts` |
