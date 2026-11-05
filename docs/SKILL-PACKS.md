# Skill Packs: Developer Guide

## Overview

A skill pack is a third-party git repository of skills that Overdeck pins to
one trusted commit and mounts into Overdeck-managed Claude Code and Codex
launches. This doc covers the module layout, the data flow from `pan skills
pack add` to a mounted skill, the adapter contract, and how to add a known
pack or write a new adapter. For the operator-facing feature — the quickstart,
the pack catalog, the trust model, and the fork runbook — see
[features/skill-packs.mdx](../features/skill-packs.mdx). For every CLI flag,
see [cli/skills-commands.mdx](../cli/skills-commands.mdx). For what makes a
third-party repository a valid pack, see
[guides/skill-pack-authoring.mdx](../guides/skill-pack-authoring.mdx). For
every config key, see
[configuration/skills.mdx](../configuration/skills.mdx).

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
| `ox-build.ts` | `buildOx`, `isOxBuildReady`, `assertGoAvailable`, `oxBuildCommands`, `oxBuildDownloads`, `oxBuildEnv`, `OX_BINARIES`, `OX_BUILD_MARKER`: the `sageox` pack's `go build` of `ox` and its two adapters (PAN-4852) |

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
| `install-snapshot.ts` | `DeftInstallSnapshot`, `readDeftSnapshot`, `writeDeftSnapshot`, `touchedDeftDir`, `legacyDeftExcludeFilePath` (the pre-PAN-4852 exclude file that `uninstall.ts` still clears) |
| `install.ts` | `installDeftIntoWorktree`, `runDirectiveInstall` (npm/pnpm launcher, or `bun add` plus runtime setup for Bun); hides the deposit through `src/lib/git/worktree-exclude.ts` |
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
`<worktree>/.overdeck/deft-install.json`; the hide is the `deft` block in
`<git-dir>/info/overdeck-exclude` (shared with SageOx, see below); the run summary is
`<worktree>/.overdeck/deft-run-summary.jsonl`. The lift wraps
`rebaseFeatureBranch` (`src/lib/cloister/merge-rebase.ts`), each repo sync in
`syncMainAcrossWorkspaceRepos` (`src/lib/cloister/sync-main-workspace.ts`), and
the merge train's sibling rebase and force-push (`rebaseSibling` in
`src/lib/cloister/merge-train-deps.ts`).
The merge gate (`evaluateIssueMergeGate`, `src/lib/cloister/merge-gate.ts`)
waives approval at head for a Deft issue and runs `deftMergeGuardForIssue`
through `evaluateRepoMergeGuards` (`src/lib/cloister/repo-merge-guards.ts`);
`forgeMergeGate` raises the drift decision, and the forge-merge route calls
`evaluateRepoMergeGuards` itself. `startRequestReviewPipeline`, `spawnReviewRoleForIssueBody` and
`spawnRun` keep Overdeck review and test agents off Deft issues; the derived
state treats `deftPipeline` as approved; the auto-merge schedule route,
scheduler and executor apply `deftAutoMergeHold`. User guide:
`features/skill-packs.mdx`, "Running an issue on Deft".

### `src/lib/sageox/` and the shared hide — SageOx (PAN-2444, PAN-4852)

| File | Responsibility |
|---|---|
| `disclosure.ts` | `SAGEOX_DISCLOSURE` (leaf module) |
| `config.ts` | `sageox_upload` and `sageox_binding: committed` in `projects.yaml`: `readSageoxUpload`, `setSageoxUpload`, `readSageoxBindingCommitted`, `setSageoxBindingCommitted` |
| `probe.ts` | `probeOxHostContract`: `ox host-contract --json` with a 2 s timeout |
| `binary.ts` | `resolveOxBinary`: the built `<packdir>/<commit>/bin/ox` for the trusted commit; no `PATH` fallback |
| `binding.ts` | The binding store: `bindingDir`, `readBinding`, `writeBinding`, `defaultBranchTracksSageox`, `readSageoxLinkState` |
| `placement.ts` | `sageoxDirState` (tracked, placed, hand-made, absent), `ensureSageoxPlaced`, `removeSageoxPlacement`, `PLACEMENT_MARKER` |
| `launch.ts` | `resolveSageoxLaunch`, `oxHookCommand`, `sageoxClaudeHooks`, `SAGEOX_CLAUDE_EVENTS` |
| `codex-hooks.ts` | `writeSageoxCodexHooks`, `removeSageoxCodexHooks`, `codexHookTrustHash`, `SAGEOX_CODEX_EVENTS` |
| `link.ts` | `linkSageoxProject` (`pan skills pack sageox link`), `sageoxAuthFilePath` |
| `commit.ts` | `commitSageoxBinding` (`pan skills pack sageox commit`), `SAGEOX_LINK_BRANCH` |
| `merge-guard.ts` | `evaluateSageoxMergeGuard`, `readSageoxChangedPaths`, `sageoxMergeGuardForIssue` |
| `../git/worktree-exclude.ts` | `excludeTarget`, `setExcludeBlock`, `readExcludeBlock`, `removeExcludeBlock`: owner blocks (`deft`, `sageox`) in `<git-dir>/info/overdeck-exclude` for a linked worktree, or in `info/exclude` for the primary checkout |
| `../cloister/repo-merge-guards.ts` | `evaluateRepoMergeGuards`: the Deft guard, then the SageOx guard; the first refusal wins |

### SageOx

The `sageox` pack builds `ox`, `ox-adapter-claude-code` and
`ox-adapter-codex` into `~/.overdeck/packs/sageox/<commit>/bin/` with Go's
caches under `~/.overdeck/packs/sageox/go/` (`oxBuildEnv`). The build marker
`bin/.overdeck-ox-build.json` (`OX_BUILD_MARKER`) is written last; a build is
ready only when it names the trusted commit and `bin/ox` is executable. Only
`add`, `update` and `sync` build; launches, probes, hooks and doctor use the
built binary (`resolveOxBinary`). `scripts/check-sageox-build-home.sh` runs
`pan skills pack add sageox --yes` with an empty `HOME` and fails if anything
lands outside `~/.overdeck/` or under `packs/` outside `sageox/`.

The **binding store** `~/.overdeck/packs/sageox/bindings/<project>/` holds the
untracked `.sageox/` files `ox init` wrote in `link`'s throwaway worktree
(`config.json` required, at most 50 files). `removePack('sageox')` keeps it. At
launch, `ensureSageoxPlaced` copies it into the git root's `.sageox/` and
writes the **marker** `.sageox/.overdeck-placed` (`{ version, projectKey,
files, placedAt }`); `removeSageoxPlacement` deletes only marker-listed
untracked files, then the marker. Both resolve every marker path inside
`.sageox/` before deleting, since the marker lives in the worktree.

The hide is one `sageox` owner block in the same exclude file Deft uses
(`worktree-exclude.ts`). A worktree has only one `core.excludesFile`, so the
two owners share it.

For Codex, `writeSageoxCodexHooks` writes `<codexHome>/hooks.json` and the
**Codex trust block** (`# overdeck:sageox-hooks:begin` …
`# overdeck:sageox-hooks:end`) at the end of `config.toml`, one
`[hooks.state."<realpath(codexHome)>/hooks.json:<event_snake>:0:0"]` table
with `trusted_hash` per event. The launch-settings step writes it after
`initCodexHome` and the pack block, so it survives both rewrites.

The merge guard runs in `evaluateIssueMergeGate` (for otherwise-ready PRs) and
in the forge-merge route, both through `evaluateRepoMergeGuards`. It is
server-reachable, so its git calls are async `execFile` with a 30 s timeout.
Fork contract and ledger: [docs/SAGEOX-FORK.md](SAGEOX-FORK.md). User guide:
`features/skill-packs.mdx`, "SageOx".

### Other files

`src/cli/commands/skills.ts`, `src/cli/commands/skills-deft.ts`, `src/cli/commands/skills-deft-pipeline.ts`,
`src/cli/commands/skills-sageox.ts`, `src/cli/commands/doctor-sageox.ts`,
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
5. For `sageox` only: `oxBuildPreview` adds the build to the preview.
6. The consent prompt asks to trust the commit (`--yes` is required without a
   TTY).
7. For `gstack-runtime` only: `renderRuntimePack` runs the fork's pack-mode
   setup. For `sageox` only: `buildPackOx` runs the build (`addPack` in
   `sources.ts`).
8. `writePackEntry` writes the registry entry.
9. At launch, the launcher runs the hidden `pan skills launch-settings` step.
10. It calls `loadSkillOverrideLayers` and `listPackCatalog`.
11. `resolveLaunchPackSelection` resolves each pack skill's on/off state and
    collects warnings.
12. `buildMount` builds the content-addressed mount.
13. Claude Code: `linkClaudeMount`, then the launch passes `--plugin-dir
    <launch link>`. Codex: `writeCodexPackBlock` writes the `overdeck-packs`
    local marketplace into the agent's `CODEX_HOME`.

### Update

`updatePack`: fetch; resolve the ref or `--ref`; extract; read the manifest;
diff against the trusted commit (added, removed and changed skills, new
capabilities); return without asking when the commit and ref are unchanged;
preview the render, browser and ox build; consent; render, build the browser
runtime when consent is recorded, build ox; `writePackEntry` with the new ref
and commit.

### Sync

`syncPack`: fetch; extract the trusted commit (never moves it); for
`gstack-runtime`, render, and build a missing browser runtime when consent is
recorded; for `sageox`, build `ox` without asking.

### Browser

`enablePackBrowser` / `disablePackBrowser`: a second consent; build into
`~/.overdeck/packs/gstack/browser`; record `browser: true`. Off clears it.

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
- **`gstack-runtime`** — reads the manifest from the extraction
  (`packExtractDir`, in `listPackCatalog` and `addPack`); skills are
  classified by `GSTACK_SKILL_MAP`; only the mount reads the render
  (`resolveLaunchPackSelection` sets `root` to `packRenderDir` for
  `gstack-runtime`), and its mount transform applies there.

## `KnownPack` fields

| Field | Meaning | Packs that use it |
|---|---|---|
| `id` | The pack id | all known packs |
| `url` | Default repository url when none is passed | all known packs |
| `adapter` | Default adapter | all known packs |
| `skillsRoot` | Directory the `plain` adapter scans instead of `skills/`, relative to the plugin root | `sageox` |
| `pluginRoot` | Repo-relative directory holding the plugin (manifest, skills, agents, hooks, license); default the repo root | `pstack` |
| `ref` | Ref `pan skills pack add <id>` pins when `--ref` is omitted (a tag, branch, or 40-hex commit) | `pstack`, `sageox` |
| `mountExtras` | Plugin-root-relative files or directories the mount copies next to `skills/` | `pstack` |
| `optIn` | Skill names that are opt-in: the pack toggle never turns them on | `mattpocock`, `sageox`, `pstack` |
| `disclosure` | One-line statement of what leaves the machine, shown on the pack row | `sageox`, `gstack` |

`gstack` ignores the `optIn` field: `readPackManifest` takes its opt-ins from
`GSTACK_OPT_IN_SKILLS` and `GSTACK_BROWSER_OPT_IN_SKILLS` (`gstack.ts`)
instead.

## Adding a known pack

1. Add a `KNOWN_PACKS` entry in `adapters.ts`.
2. Choose an adapter.
3. Set `optIn` for every skill that writes files Overdeck owns, or reaches
   paid, cloud, or push actions. For `gstack`, opt-ins belong in
   `GSTACK_OPT_IN_SKILLS` / `GSTACK_BROWSER_OPT_IN_SKILLS` (`gstack.ts`), not
   in `optIn`.
4. Set `ref` only when a fixed commit is the right default.
5. Set `pluginRoot`, `skillsRoot`, or `mountExtras` as needed.
6. Add a `disclosure` if anything leaves the machine.
7. The dashboard's empty state shows one hard-coded example command,
   `ADD_COMMAND` in
   `src/dashboard/frontend/src/components/skills/SkillPacksSection.tsx`;
   change it only if the example should name the new pack.
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
[--conversation <tmuxSession>] [--codex-home <dir>] [--plugin-link <path>]`,
registered in `registerSkillsCommands` (`skills.command('launch-settings'`)
and handled by `skillsLaunchSettingsCommand` in
`src/cli/commands/skills.ts`. The step exits 2 for any harness except
`claude-code` and `codex`.

## Tests

| Part | Test file |
|---|---|
| Pack adapters, sources, browser sources, mount, render, browser, gstack, Deft, the `ox` build | `src/lib/skill-packs/__tests__/{adapters,sources,sources-browser,sources-sageox,mount,render,browser,gstack,deft,ox-build}.test.ts` |
| Skill override resolution, store, launch, conversation flags | `src/lib/skill-overrides/__tests__/{resolve,store,launch,conversation-flags}.test.ts` |
| CLI: skills, pack browser, SageOx doctor check | `src/cli/commands/__tests__/{skills,skills-pack-browser,doctor-sageox}.test.ts` |
| Dashboard skill-overrides route | `src/dashboard/server/routes/__tests__/skill-overrides-route.test.ts` |
| Dashboard skill packs UI | `src/dashboard/frontend/src/components/skills/SkillPacksSection.test.tsx` |
| SageOx (binary, binding, placement, launch, Codex hooks, link, commit, merge guard, config, probe) | `src/lib/sageox/__tests__/*.test.ts` |
| Shared hide | `src/lib/git/__tests__/worktree-exclude.test.ts` |
| Repo merge guards | `src/lib/cloister/__tests__/repo-merge-guards.test.ts` |
| SageOx build with an empty `HOME` (operator script, needs Go and the network) | `scripts/check-sageox-build-home.sh` |
| Deft | `src/lib/deft/__tests__/*.test.ts` |
