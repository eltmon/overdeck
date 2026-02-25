# PAN-266: Devroot-Based Skill Distribution Architecture

## Problem Statement

Panopticon's current skill distribution has three critical problems:

1. **Stale copies** — `pan install` copies skills to `~/.panopticon/skills/` once and never updates them. `pan sync` only recreates symlinks. Users run stale versions indefinitely.
2. **Symlink discovery bug** — Claude Code ([#14836](https://github.com/anthropics/claude-code/issues/14836)) doesn't list symlinked skills in `/skills`, even though they work when invoked directly. Causes repeated confusion.
3. **Wrong priority level** — Skills at `~/.claude/skills/` (personal level) silently override project-specific customizations in workspaces. Claude Code precedence: personal > project. This makes project template overrides invisible.

## Decisions Made

Full analysis in `docs/SKILL-DISTRIBUTION-ANALYSIS.md` (912 lines, 17 decisions). Key decisions:

### D1: Copies, not symlinks
All `.claude/` content (skills, agents, rules) is distributed as file copies, never symlinks. Avoids Claude Code's symlink discovery bug.

### D2: The Devroot Pattern
The **devroot** is the parent directory where all projects live (e.g., `~/Projects/`). It is NOT a git repo. Claude Code treats it as the project root when launched from there.

Panopticon places skills at `<devroot>/.claude/skills/` (project level) instead of `~/.claude/skills/` (personal level). Since workspace agents run from inside workspaces (which ARE git repos with separate project roots), devroot skills and workspace skills are in completely isolated scopes — no precedence conflicts.

**Verified**: Tested by placing a skill at `~/Projects/.claude/skills/devroot-test/` and confirming Claude Code discovered it when launched from `~/Projects/`.

### D3: `~/.claude/` is the user's personal space
Panopticon NEVER touches `~/.claude/skills/`, `~/.claude/agents/`, or `~/.claude/rules/`. Users can put overrides there that beat everything (personal > project).

### D4: Manifest-based tracking
JSON manifests at devroot and workspace levels track what Panopticon placed (file hashes, source, install time). Enables safe updates, conflict detection, and clean removal.

### D5: Frozen workspaces
Running workspaces are never updated. Skills are installed at `pan workspace create` time only. Explicit `pan workspace update` for refreshing existing workspaces.

### D6: Configurable devroot
`devroot: ~/Projects` in `~/.panopticon/config.yaml`. Set to `null` to disable devroot placement (skills only go to workspaces).

### D7: Conflict resolution
Default: warning messages. `--force` to overwrite. `--diff` to show changes. Never silently skip or overwrite.

### D8: Rules distribution
`.claude/rules/` distributed via same copy + manifest mechanism as skills. Path-scoped instruction files (see PAN-263 for content analysis).

### D9: Commands → skills migration
MYN's 8+ legacy commands in `.claude/commands/` migrate to skills as part of this effort. Commands and skills coexist during transition.

## Architecture

### Three-Level Distribution

```
REPO SOURCE (panopticon-cli/)
  skills/           64 skills (git-tracked)
  dev-skills/       3 dev-only skills
  agents/           8 agent definitions
        │
        │ pan sync (COPY, keeps fresh)
        ▼
PANOPTICON CACHE (~/.panopticon/)
  skills/           Full copies (always up-to-date)
  agents/
  rules/
  .manifest.json    Hashes of all cached files
        │
        ├─── pan sync ───────────────► DEVROOT (<devroot>/.claude/)
        │                               skills/    (all Panopticon skills)
        │                               agents/    (all Panopticon agents)
        │                               rules/     (all Panopticon rules)
        │                               .panopticon-manifest.json
        │
        └─── pan workspace create ───► WORKSPACE (workspace/.claude/)
                                        skills/    (Panopticon + project template)
                                        agents/    (Panopticon + project template)
                                        rules/     (Panopticon + project template)
                                        commands/  (legacy, from template)
                                        .manifest.json
```

### Precedence (No Conflicts)

```
~/.claude/skills/              Personal — user's overrides (WINS over everything)
                               Panopticon NEVER writes here

<devroot>/.claude/skills/      Project (devroot) — for manual Claude Code sessions
                               Isolated from workspaces (different project root)

workspace/.claude/skills/      Project (workspace) — for workspace agents
                               Isolated from devroot (different project root)
```

### Manifest Schema

```json
{
  "version": 1,
  "managed_by": "panopticon",
  "installed": {
    "skills/beads/SKILL.md": {
      "hash": "sha256:abc123...",
      "source": "panopticon",
      "installed_at": "2026-02-24T10:30:00Z"
    },
    "skills/session-health/SKILL.md": {
      "hash": "sha256:xyz999...",
      "source": "project-template",
      "installed_at": "2026-02-24T10:30:00Z"
    }
  }
}
```

### Conflict Resolution Logic

```
For each file to install:
  if file does NOT exist at target:
    → COPY (new install, add to manifest)
  else if file exists AND hash matches manifest:
    → UPDATE (Panopticon placed it, user didn't modify)
  else if file exists AND hash differs from manifest:
    → WARN "Skipping skills/beads — modified since Panopticon installed it"
    → with --force: overwrite anyway
    → with --diff: show diff between installed and current
  else if file exists AND NOT in manifest:
    → SKIP (user placed it, never touch)
```

### Devroot Configuration

```yaml
# ~/.panopticon/config.yaml
devroot: ~/Projects        # where you launch Claude Code from
                            # set to null to disable devroot skill placement
```

### Workspace Creation Flow

```
pan workspace create MIN-678
  │
  ├── 1. Copy Panopticon defaults from ~/.panopticon/ cache
  │      skills/ → workspace/.claude/skills/
  │      agents/ → workspace/.claude/agents/
  │      rules/  → workspace/.claude/rules/
  │
  ├── 2. Copy project template ON TOP (overrides Panopticon defaults)
  │      e.g., MYN's session-health overwrites Panopticon's session-health
  │      e.g., MYN's code-reviewer.md overwrites Panopticon's
  │      e.g., MYN's no-localias added (MYN-only skill)
  │
  ├── 3. Write workspace/.claude/.manifest.json
  │      Records hash + source (panopticon vs project-template) for each file
  │
  ├── 4. Generate workspace CLAUDE.md
  │      (existing generateClaudeMd() — unchanged)
  │
  └── 5. Existing workspace setup (git worktree, beads, docker, etc.)
```

## Files to Modify

### Core Sync Engine

| File | Change | Difficulty |
|------|--------|-----------|
| `src/lib/sync.ts` | Rewrite `planSync()` and `executeSync()` — copy to devroot instead of symlink to `~/.claude/`, add manifest tracking, add `--force`/`--diff` flags | **hard** |
| `src/lib/sync.ts` | Add `refreshCache()` — copy from repo source to `~/.panopticon/` (replaces stale `pan install` copy) | medium |
| `src/lib/sync.ts` | Add manifest read/write/compare utilities | medium |
| `src/cli/commands/sync.ts` | Wire `--force` and `--diff` CLI flags | simple |

### Workspace Creation

| File | Change | Difficulty |
|------|--------|-----------|
| `src/lib/workspace.ts` or equivalent | Rewrite skill/agent installation — copy from cache + overlay project template, write manifest | **hard** |
| `src/lib/workspace.ts` | Stop using symlinks for `.claude/skills/`, `.claude/agents/` | medium |

### New Command

| File | Change | Difficulty |
|------|--------|-----------|
| `src/cli/commands/workspace/update.ts` | New `pan workspace update <ISSUE-ID>` command — refresh skills in existing workspace using manifest-based conflict detection | medium |

### Install / Config

| File | Change | Difficulty |
|------|--------|-----------|
| `src/cli/commands/install.ts` | Remove skip-if-exists logic (line 254), always refresh `~/.panopticon/` cache from repo | medium |
| `src/lib/config.ts` or config schema | Add `devroot` setting to config | simple |

### Migration

| File | Change | Difficulty |
|------|--------|-----------|
| `src/lib/sync.ts` | One-time migration: detect old symlinks in `~/.claude/`, remove them, populate devroot | medium |

### MYN Template (Commands → Skills)

| File | Change | Difficulty |
|------|--------|-----------|
| `myn/infra/.agent-template/.claude/commands/` → `skills/` | Convert 8+ legacy commands to skills format | medium |
| `~/.panopticon/projects.yaml` | Update MYN template config (remove `symlinks:` key) | simple |

### Rules Distribution

| File | Change | Difficulty |
|------|--------|-----------|
| `src/lib/sync.ts` | Add rules to the same copy + manifest pipeline as skills/agents | simple (same mechanism) |
| `~/.panopticon/rules/` | Create directory, add initial rules (if PAN-263 is done) | simple |

## Implementation Phases

### Phase 1: Cache Refresh + Manifest Foundation
**Goal**: Fix stale copies and build manifest infrastructure.

1. Implement manifest read/write/compare utilities in `sync.ts`
2. Rewrite `refreshCache()` — always copy from repo to `~/.panopticon/`, generate `~/.panopticon/.manifest.json`
3. Fix `pan install` to always refresh (remove skip-if-exists)
4. Tests: verify cache is always fresh after sync

### Phase 2: Devroot Distribution
**Goal**: `pan sync` copies to devroot instead of symlinks to `~/.claude/`.

1. Add `devroot` config setting
2. Rewrite `executeSync()` — copy from cache to `<devroot>/.claude/`, write devroot manifest
3. Implement conflict resolution logic (warn/force/diff)
4. Add `--force` and `--diff` CLI flags
5. Tests: verify skills appear at devroot, manifest is correct, conflicts handled

### Phase 3: Migration
**Goal**: Clean transition from old symlink approach.

1. Detect existing Panopticon symlinks in `~/.claude/skills/`, `~/.claude/agents/`
2. Remove Panopticon symlinks (preserve user-created content)
3. Run Phase 2 logic to populate devroot
4. Print migration summary
5. Tests: verify old symlinks removed, user content preserved, devroot populated

### Phase 4: Workspace Copy + Overlay
**Goal**: `pan workspace create` uses copies + project template overlay.

1. Rewrite workspace skill/agent installation — copy from cache, not symlink
2. Copy project template on top (later copy wins)
3. Write workspace `.manifest.json` with source tracking
4. Add rules distribution (same pipeline)
5. Tests: verify workspace has correct content, template overrides work, manifest is correct

### Phase 5: Workspace Update Command
**Goal**: Explicit refresh for existing workspaces.

1. Implement `pan workspace update <ISSUE-ID>`
2. Use manifest-based conflict detection (same as `pan sync`)
3. Block if agent is running
4. Tests: verify update works, conflicts handled, running agent check

### Phase 6: Commands → Skills Migration
**Goal**: Convert MYN legacy commands to skills.

1. Audit MYN commands — map to existing Panopticon skills or create new project-template skills
2. Convert remaining commands to skill format
3. Update `projects.yaml` template config
4. Keep commands for backward compatibility with deprecation warning
5. Tests: verify skills work, commands still work during transition

## Acceptance Criteria

- [ ] `pan sync` copies skills/agents/rules to devroot (no symlinks anywhere)
- [ ] `pan sync` refreshes `~/.panopticon/` cache from repo source (no more stale copies)
- [ ] `pan sync` writes manifest at devroot, warns on conflicts
- [ ] `pan sync --force` overwrites modified files
- [ ] `pan sync --diff` shows changes between installed and current
- [ ] `pan sync` removes old symlinks from `~/.claude/` on first run (migration)
- [ ] `pan sync` NEVER touches `~/.claude/skills/`, `~/.claude/agents/`, `~/.claude/rules/`
- [ ] `pan workspace create` copies from cache + project template overlay (no symlinks)
- [ ] `pan workspace create` writes workspace manifest with source tracking
- [ ] Project template overrides work (MYN's session-health beats Panopticon's at workspace level)
- [ ] `pan workspace update` refreshes skills in existing workspace
- [ ] `pan workspace update` blocks if agent is running
- [ ] `devroot` config setting works; `null` disables devroot placement
- [ ] `.claude/rules/` distributed via same mechanism
- [ ] MYN commands audited and migration plan documented
- [ ] All existing tests pass
- [ ] `npm run build` succeeds

## Dependencies

```
Phase 1 (cache + manifest) → no dependencies, start here
  │
  ├──► Phase 2 (devroot distribution) → depends on Phase 1
  │       │
  │       └──► Phase 3 (migration) → depends on Phase 2
  │
  └──► Phase 4 (workspace copy) → depends on Phase 1
          │
          └──► Phase 5 (workspace update) → depends on Phase 4

Phase 6 (commands → skills) → can run in parallel after Phase 4
```

## Beads

| Phase | Bead ID | Title |
|-------|---------|-------|
| 1 | panopticon-4xt3 | Manifest read/write/compare utilities |
| 1 | panopticon-80aa | Rewrite cache refresh — copy from repo to ~/.panopticon/ |
| 2 | panopticon-nasm | Add devroot config setting |
| 2 | panopticon-vocj | Rewrite executeSync() for devroot distribution |
| 2 | panopticon-eig5 | Add --force and --diff CLI flags to pan sync |
| 3 | panopticon-ifu3 | Migration — detect and remove old symlinks from ~/.claude/ |
| 4 | panopticon-mgeh | Rewrite workspace skill/agent installation — copies + overlay |
| 5 | panopticon-pkxo | Implement pan workspace update command |
| 6 | panopticon-24pm | Commands → skills migration for MYN |

## References

- **Analysis doc**: `docs/SKILL-DISTRIBUTION-ANALYSIS.md` — comprehensive 912-line analysis with all decisions, inventory, and MYN audit
- **Original architecture**: [PAN-3](https://github.com/eltmon/panopticon-cli/issues/3)
- **Symlink bug**: [claude-code#14836](https://github.com/anthropics/claude-code/issues/14836)
- **Rules analysis**: [PAN-263](https://github.com/eltmon/panopticon-cli/issues/263)
- **Localias cleanup**: [PAN-264](https://github.com/eltmon/panopticon-cli/issues/264)
- **Skill categorization**: [PAN-265](https://github.com/eltmon/panopticon-cli/issues/265)
- Current sync code: `src/lib/sync.ts`
- Current install code: `src/cli/commands/install.ts`
- MYN template: `myn/infra/.agent-template/.claude/`
