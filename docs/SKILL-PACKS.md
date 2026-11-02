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
| `store.ts` | `setSkillOverride`, `listSkillStates`, `loadSkillOverrideLayers`, `issueSkillOverridesPath` |
| `catalog.ts` | `listSkillCatalog`, `listPackCatalog`, `readInstalledClaudePluginNames` |
| `launch.ts` | `resolveLaunchPackSelection`, `applyClaudePacks`, `applyCodexPacks`, `applyDeftForLaunch`, `claudeSkillSettingsJson` |
| `launcher-lines.ts` | `launcherSkillOverrideLines`, `skillPackLinkPath`, `claudeSkillOverrideLaunch`, `codexSkillOverrideLines` (leaf module) |
| `conversation-flags.ts` | `expandConversationSkillFlags`, `resolveConversationSkillFlags` |

### Other files

`src/cli/commands/skills.ts`, `src/cli/commands/skills-deft.ts`,
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
