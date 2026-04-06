# PAN-488: Project repo artifact structure — .pan/ migration + multi-tool skill sync

## Status: In Progress

## Current Phase
Working on bead panopticon-bjd (archive structure: flat → per-issue subdirectory).

## Completed Work
- [x] panopticon-u6e: Copied docs/REPO-ARTIFACTS.md to workspace branch (commit: c6064e0)
- [x] panopticon-wju: Renamed project-level .panopticon/ paths to .pan/ in wal.ts, sync-wal.ts, convoy-templates.ts, convoy.ts, remote-agents.ts, projects.ts, project.ts (commit: e5906a8)
- [x] panopticon-d31: Updated config-yaml.ts to load .pan.yaml first, fall back to .panopticon.yaml with deprecation warning; updated hasProjectConfig, getProjectConfigPath; updated comments/strings in shadow-mode.ts, config.ts (commit: pending)

## Remaining Work
- [ ] panopticon-wju: Rename all project-level .panopticon/ path references to .pan/
- [ ] panopticon-d31: Rename .panopticon.yaml to .pan.yaml with backwards compat
- [ ] panopticon-bjd: Change archive structure from flat to per-issue subdirectory
- [ ] panopticon-b6g: Add .pan/events/, .pan/convoy/, .pan/prompts/ to .gitignore
- [ ] panopticon-0dp: Safe migration of existing .panopticon/ subdirs in workspaces
- [ ] panopticon-2nu: Add .pan/skills/ as a sync source with correct precedence
- [ ] panopticon-ihe: Implement multi-tool sync for all 6 AI tool targets
- [ ] panopticon-4xd: Update documentation to match implemented behavior

## Key Decisions
- See Decisions Made section below for full context

## Specialist Feedback
(none yet)

## Summary

Implement the repo artifact design from `docs/REPO-ARTIFACTS.md`. This consolidates
project-level directory renames (`.panopticon/` → `.pan/`), config file renames
(`.panopticon.yaml` → `.pan.yaml`), archive structure changes (flat → per-issue subdir),
and multi-tool skill sync into one cohesive feature.

## Decisions Made

### 1. `.panopticon/` → `.pan/` (project-level only)

All project-level references to `.panopticon/` change to `.pan/`. The global tool directory
`~/.panopticon/` is **unchanged**.

Affected files:
- `src/lib/costs/wal.ts` — `DEFAULT_EVENTS_SUBDIR` → `.pan/events`
- `src/lib/costs/sync-wal.ts` — `DEFAULT_EVENTS_SUBDIR` → `.pan/events`
- `src/lib/convoy-templates.ts` — outputDir `.panopticon/triage` → `.pan/convoy`, `.panopticon/health` → `.pan/convoy`
- `src/lib/convoy.ts` — default outputDir `.panopticon/convoy-output` → `.pan/convoy`
- `src/lib/remote/remote-agents.ts` — `/workspace/.panopticon/prompts/` → `/workspace/.pan/prompts/`
- `src/lib/projects.ts` — events_path default `.panopticon/events` → `.pan/events`

**Convoy unification**: Both triage and health outputs previously went to separate
`.panopticon/triage` and `.panopticon/health` directories. They now unify under `.pan/convoy`.

### 2. `.panopticon.yaml` → `.pan.yaml`

- `loadProjectConfig()` in `config-yaml.ts` looks for `.pan.yaml` first, falls back to
  `.panopticon.yaml` with a **stderr deprecation warning**
- `hasProjectConfig()` and `getProjectConfigPath()` updated to check both
- Workspace setup code generates `.pan.yaml` instead of `.panopticon.yaml`
- Backwards compat: `.panopticon.yaml` continues to work, just warns

### 3. Archive structure: flat → per-issue subdirectory

`complete-planning` in `issues.ts` changes from:
```
docs/prds/active/<ID>-plan.md
docs/prds/active/<ID>-plan.vbrief.json
```
To:
```
docs/prds/active/<issue-id>/STATE.md
docs/prds/active/<issue-id>/plan.vbrief.json
```

`movePrd` in `archive-planning.ts` also uses the subdirectory format for completed PRDs.

Existing flat archives are left as-is. New closures always use subdirectory format.

### 4. `findWorkspacePath` numeric suffix fix

`findWorkspacePath()` in `archive-planning.ts` adds a `feature-${numericSuffix}` candidate
to match the pattern from `getWorkspaceInfoForIssue()` (commit be33bfb). This fixes
archive of legacy-named workspaces.

### 5. `.pan/skills/` as sync source

`sync.ts` updated to include `.pan/skills/` from the project repo with precedence:
1. `.claude/skills/<name>/` already in project → **skip, never overwrite**
2. `.pan/skills/<name>/` in project repo → write to tool dirs
3. `~/.panopticon/skills/<name>/` → global fallback

### 6. Multi-tool sync (all 6 tools)

Read `tools.also_sync` from `~/.panopticon/config.yaml` (global) merged with `.pan.yaml`
(per-project, additive only). For each configured tool, write skills/rules:

| Tool | Target |
|------|--------|
| `cursor` | `.cursor/rules/*.mdc` |
| `codex` | `AGENTS.md` (named blocks) |
| `windsurf` | `.windsurf/rules/*.md` |
| `cline` | `.clinerules/` |
| `copilot` | `.github/instructions/*.instructions.md` |
| `aider` | `CONVENTIONS.md` |

Per-project `also_sync` merges with global — never replaces.

### 7. `.gitignore` injection

When creating/updating a workspace, ensure these paths are in `.gitignore`:
```
.pan/events/
.pan/convoy/
.pan/prompts/
```

**NOT** `.pan/` itself — `.pan/skills/` must remain tracked.
**NOT** `.planning/` — planning artifacts are committed to the feature branch.

### 8. Workspace migration safety

When `pan sync` or `pan install` encounters an existing `.panopticon/` subdir, migration:
1. Check old path exists
2. Verify new `.pan/` path does NOT already exist
3. Move old → new
4. If both exist (partial previous run), log warning and skip — never overwrite silently

### 9. Design doc

`docs/REPO-ARTIFACTS.md` exists as an uncommitted file in the main worktree. The
implementation agent must copy it into the workspace branch and commit it.

### 10. Cleanup

`.claude/rules/planning-artifacts.md` does not exist on any branch — already gone. No
cleanup needed.

## Out of Scope

- `~/.panopticon/` global tool directory — unchanged
- Tracker routing in `src/lib/agents.ts` — that is PAN-489 scope
- `.planning/` gitignore — `.planning/` stays committed on feature branches
- Migrating existing flat archives to subdirectory format (leave as-is)

## Risk Assessment

- **Medium risk**: Multi-tool sync is new functionality with no existing tests. Needs
  comprehensive unit tests for each tool adapter.
- **Low risk**: Path renames are mechanical but touch many files. Grep-verify completeness.
- **Low risk**: Archive structure change is additive (old format left as-is).
- **Medium risk**: Workspace migration — must handle partial state safely (overseer flagged).

## Test Strategy

- Unit tests for each multi-tool adapter (Cursor, Codex, Windsurf, Cline, Copilot, Aider)
- Unit tests for `.pan.yaml` loading with fallback
- Unit tests for workspace migration (old only, new only, both exist, neither exists)
- Integration test for `planSync()` with `.pan/skills/` source
- Verify existing cost WAL tests still pass after path rename
