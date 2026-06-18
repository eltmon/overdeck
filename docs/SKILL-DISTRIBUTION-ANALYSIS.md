# Skill Distribution Architecture: Analysis & Findings

> **Status**: Analysis complete — Feb 2026
> **Issue**: [PAN-266](https://github.com/eltmon/overdeck/issues/266)
> **PRD**: `docs/prds/active/PAN-266-plan.md`
> **Context**: Investigation into how Overdeck distributes skills, rules, agents, and commands — how Claude Code resolves conflicts, what's broken today, and the agreed end-state.

---

## 1. Claude Code's Native Hierarchy

Claude Code has two separate precedence systems that use **different** priority orders.

### CLAUDE.md Precedence (team wins over personal)

```
HIGHEST PRIORITY
├── Managed Policy    /etc/claude-code/CLAUDE.md (Linux)
│                     /Library/Application Support/ClaudeCode/CLAUDE.md (macOS)
│                     C:\Program Files\ClaudeCode\CLAUDE.md (Windows)
├── Project Memory    ./CLAUDE.md  or  ./.claude/CLAUDE.md
├── Project Rules     ./.claude/rules/*.md  (path-scoped, recursive)
├── User Memory       ~/.claude/CLAUDE.md
├── User Rules        ~/.claude/rules/*.md
├── Project Local     ./CLAUDE.local.md  (auto-gitignored)
└── Auto Memory       ~/.claude/projects/<project>/memory/
LOWEST PRIORITY
```

**Logic**: Team standards should override personal preferences.

> Source: [Claude Code Memory Docs](https://code.claude.com/docs/en/memory)

### Skills / Agents / Commands Precedence (personal wins over project)

```
HIGHEST PRIORITY
├── Enterprise        /etc/claude-code/skills/ (Linux)
├── Personal          ~/.claude/skills/
├── Project           .claude/skills/
└── Plugin            <plugin>/skills/  (namespaced, can't conflict)
LOWEST PRIORITY
```

**Logic**: Personal tools should override project defaults. Same order applies to agents and commands.

> Source: [Claude Code Skills Docs](https://code.claude.com/docs/en/skills)
> "When skills share the same name across levels, higher-priority locations win: enterprise > personal > project."

### Why They Differ

| Feature | Precedence | Rationale |
|---------|-----------|-----------|
| CLAUDE.md | Project > User | Team coding standards should govern, not individual style |
| Skills / Agents | User > Project | Users should be able to customize their own tooling |

### The Complete .claude/ Universe

| Thing | What It Is | Loaded When | Precedence | Overdeck Manages? |
|-------|-----------|-------------|-----------|-------------------|
| **CLAUDE.md** | Free-form instructions | Always, at conversation start | Managed > Project > User | Yes — generates workspace CLAUDE.md |
| **Rules** (`.claude/rules/`) | Modular, path-scoped instructions | Always, but filtered by file paths being touched | Project + User (both loaded) | **Planned** — will distribute via pan sync |
| **Skills** (`.claude/skills/`) | Invocable tools/workflows | Only when invoked by name (`/skill-name`) | Enterprise > Personal > Project | Yes — 64 skills + 3 dev-skills |
| **Agents** (`.claude/agents/`) | Custom subagent definitions | When Task tool selects by type | Enterprise > Personal > Project | Yes — 8 agents |
| **Commands** (`.claude/commands/`) | Legacy — replaced by skills | When invoked by `/command-name` | Skills win over same-name commands | Yes — legacy, migrating to skills |
| **Settings** (`settings.json`) | Permissions, hooks, model config | Always | Managed > CLI > Local > Project > User | No |
| **Settings Local** (`settings.local.json`) | Personal project overrides | Always (merged with project) | Merged with project settings | No |
| **MCP** (`.mcp.json`, `~/.claude.json`) | External tool servers | Always | Managed > Local > Project > User | Partially (MYN has a template) |
| **Plugins** | External packages | Always | Namespaced, can't conflict | No |
| **Hooks** | Lifecycle automation | On tool calls, notifications, etc. | In settings.json or skill/agent frontmatter | Yes — syncs hook scripts |

### Rules vs. Skills vs. Agents

| | CLAUDE.md | Rules | Skills | Agents |
|---|---|---|---|---|
| **What** | Free-form instructions | Focused instruction files | Invocable tools/workflows | Subagent definitions |
| **When loaded** | Always | Always (path-filtered) | Only when invoked | When Task tool selects |
| **Path scoping** | No | Yes — glob patterns in frontmatter | No | No |
| **Organization** | One file (or `@import`) | Many small files, subdirectories | One directory per skill | One file per agent |
| **Purpose** | "Here's how we work" | "When touching THIS code, follow THIS rule" | "Here's a workflow to execute" | "Here's a specialist to delegate to" |

**Rule example** — path-scoped instruction:
```yaml
---
paths:
  - "src/dashboard/**"
  - "src/lib/cloister/**"
---
NEVER use execSync in this code — it blocks the event loop.
Use execAsync or sendKeysAsync instead. See PAN-70.
```

This rule only activates when touching dashboard/cloister files. CLI code never sees it.

Rules support subdirectories for organization and are auto-discovered recursively with glob patterns and brace expansion.

### Additional Loading Behavior

**Recursive CLAUDE.md loading**: Parent directory CLAUDE.md files above cwd load at launch. Child directory CLAUDE.md files load on-demand when Claude reads files in those directories.

**Auto Memory control**:
```bash
export CLAUDE_CODE_DISABLE_AUTO_MEMORY=0  # Force ON
export CLAUDE_CODE_DISABLE_AUTO_MEMORY=1  # Force OFF
```

**CLAUDE.local.md**: Auto-gitignored. Personal overrides scoped to one project.

**Imports**: Any CLAUDE.md can import other files via `@path/to/file.md` syntax.

---

## 2. Overdeck's Current Distribution (Broken)

### The Three-Tier Flow

```
TIER 1: REPO SOURCE
overdeck/skills/                 Source of truth (git-tracked)
overdeck/dev-skills/             Dev-only skills (git-tracked)
overdeck/agents/                 Agent definitions (git-tracked)

        │ pan install (one-time COPY, never updates existing)
        ▼

TIER 2: RUNTIME COPIES
~/.overdeck/skills/                  Actual files on disk
~/.overdeck/agents/                  (never refreshed after first install)

        │ pan sync (SYMLINK)
        ▼

TIER 3: CLAUDE CODE INTEGRATION
~/.claude/skills/                      Symlinks → ~/.overdeck/skills/
~/.claude/agents/                      Symlinks → ~/.overdeck/agents/
```

Additionally, `pan workspace create` symlinks workspace `.claude/skills/` → `~/.overdeck/skills/`.

### Problem 1: Stale Copies

`pan install` copies skills from the repo to `~/.overdeck/skills/` but **skips existing directories** (line 254 of `install.ts`):
```typescript
if (!existsSync(destPath)) {
  copyDirectoryRecursive(sourcePath, destPath);
}
```

`pan sync` only recreates symlinks — it doesn't touch the underlying files.

**Result**: Once a skill is installed, its content is never updated. Users run stale versions indefinitely.

### Problem 2: Known Symlink Bug

Claude Code has a known bug ([anthropics/claude-code#14836](https://github.com/anthropics/claude-code/issues/14836)) where symlinked content in `~/.claude/skills/` (and likely agents, rules, etc.) doesn't appear in discovery listings, even though it works when invoked directly.

This has caused repeated confusion — skills seem to disappear from discovery but still function.

**Decision**: The end-state uses **copies, not symlinks** everywhere. We assume the symlink bug affects all `.claude/` content types.

### Problem 3: Wrong Priority Level

Overdeck skills land in `~/.claude/skills/` (personal level). Under Claude Code's precedence rules, personal **overrides** project. This means:

- A project-specific skill in `.claude/skills/beads/` gets silently overridden by Overdeck's version in `~/.claude/skills/beads/`
- Project teams cannot customize Overdeck skills — Overdeck always wins
- This contradicts PAN-3's design goal: "git-tracked always wins"

**Solved by the devroot pattern** — see Section 6.

### Current Inventory

| Type | Location | Count |
|------|----------|-------|
| Skills | `skills/` | 64 |
| Dev-skills | `dev-skills/` | 3 |
| Agents | `agents/` | 8 |
| Project-scoped skills | `.claude/skills/` | 1 (`update-overdeck-docs`) |
| Rules | `.claude/rules/` | 0 (none yet) |
| Commands | (legacy, in project templates) | varies |

---

## 3. Real-World Conflict: Mind Your Now

MYN has project-specific content in `myn/infra/.agent-template/.claude/`:

| Type | Count | Items |
|------|-------|-------|
| Skills | 9 | beads, blog-writer, myn-prod-backup, myn-standards, no-localias, reseed, session-health, workspace-status + orphan myn-prod-db.md |
| Agents | 2 | code-reviewer, test-runner |
| Commands | 8+ | work-issue, work-plan, work-approve, work-status, work-tell, work-unlock, etc. |
| Rules | 0 | (none yet) |

### Skill Audit (Feb 2026)

Detailed comparison of all MYN skills against Overdeck revealed three categories:

**Duplicates removed from MYN:**

| Skill | Finding | Action Taken |
|-------|---------|-------------|
| `web-design-guidelines` | Byte-for-byte identical to Overdeck | Removed from MYN |
| `skill-creator` | Identical to Overdeck | Removed from MYN |
| `beads` | MYN had truncated stale copy (100 lines vs Overdeck's 214). Missing critical ID Systems section and full CLI reference | Replaced with current Overdeck version |
| `react-best-practices` | Generic Vercel React/Next.js guide, not MYN-specific | Removed from MYN, promoted to Overdeck |

**Promoted to Overdeck (genericized):**

| Skill | What Changed |
|-------|-------------|
| `react-best-practices` | Moved as-is (already generic Vercel guide) |
| `workspace-status` | Generic version created in Overdeck with `{PROJECT_DOMAIN}` / `{TRACKER_URL}` placeholders. MYN keeps its version with MYN-specific URLs as a project-level override |

**Correctly customized (kept in MYN):**

| Skill | What's Customized |
|-------|------------------|
| `session-health` | Same detection logic, but examples use MYN paths (`agent-min-XXX`, `/work-issue`). This is the right pattern: inherit generic, customize examples |
| `workspace-status` | MYN-specific URLs (myn.localhost), Linear issue IDs, GitLab MR URLs. Overrides the generic Overdeck version |

**MYN-specific (kept in MYN, not candidates for Overdeck):**

| Skill | Why It's MYN-Specific |
|-------|----------------------|
| `myn-standards` | Brand colors, priority system, MYN design patterns, component templates |
| `myn-prod-backup` | MYN Kubernetes cluster pods, database names, namespace |
| `reseed` | MYN schema-aware seed generation, hardcoded customer IDs, circular FK handling |
| `blog-writer` | MYN engineering blog narrative voice |
| `no-localias` | MYN-specific domain reminders (myn.localhost, api.myn.localhost) |

### The Override Problem

```
pan workspace create MIN-678
        │
        ├── Copies MYN template skills → workspace/.claude/skills/  (project level)
        │   └── session-health/SKILL.md  (MYN-customized version)
        │
        └── pan sync already placed → ~/.claude/skills/session-health/  (personal level)
            └── session-health/SKILL.md  (Overdeck generic version)

Claude Code loads both, personal wins → MYN's customization is ignored
```

**Solved by the devroot pattern** — Overdeck places skills at the devroot (project level), not `~/.claude/skills/` (personal level). Workspace agents don't see devroot skills because they run from within the workspace (a different project root). Project templates override Overdeck defaults cleanly at workspace level. See Section 6.

### MYN Project Configuration

From `~/.overdeck/projects.yaml`, MYN's agent template is **currently** configured as:
```yaml
agent:
  template_dir: infra/.agent-template
  symlinks:                          # ← this key changes to "copies" in end-state
    - .claude/commands
    - .claude/skills
    - .claude/agents
```

In the end-state, `symlinks:` becomes irrelevant — `pan workspace create` copies template content directly (see Section 6).

---

## 4. Enterprise / Managed Policy

The "enterprise" and "managed policy" levels are the same thing — just inconsistent naming in Anthropic's docs.

Files placed at system-level paths that require admin/root access:

| Platform | Path |
|----------|------|
| Linux | `/etc/claude-code/` |
| macOS | `/Library/Application Support/ClaudeCode/` |
| Windows | `C:\Program Files\ClaudeCode\` |

Readable by all users, writable only by admins. Intended for IT/DevOps to deploy org-wide policies.

**Current state**: `/etc/claude-code/` does not exist on this machine. No enterprise policies in effect.

---

## 5. Path Portability (Completed)

Skills previously contained hardcoded absolute paths like `/home/eltmon/Projects/overdeck/...`. Fixed by introducing environment variables:
- `$OVERDECK_INSTALL_PATH` — where overdeck lives
- `$OVERDECK_PROJECT_PATH` — the project the agent works on
- `$OVERDECK_WORKSPACE_PATH` — the workspace directory

Injected at agent spawn via `createSession()`. A `pan paths` CLI command provides fallback resolution.

**Verification**: Zero hardcoded user paths remain in any skill file.

---

## 6. Agreed End-State

### The Devroot Pattern

The **devroot** is the parent directory where all projects live — typically `~/Projects/`. The user always launches Claude Code from the devroot. Since the devroot is not a git repo, Claude Code treats it as the project root, making `<devroot>/.claude/skills/` the project-level skills location.

**Key insight**: Workspace agents run from INSIDE the workspace (which IS a git repo), so they have a different project root. Devroot skills and workspace skills are completely isolated — no precedence conflicts.

```
DEVROOT (~/Projects/)                    Not a git repo
├── .claude/
│   ├── skills/                          Overdeck skills — visible during manual work
│   ├── agents/                          Overdeck agents
│   └── rules/                           Overdeck rules
├── overdeck/                      Git repo (own project root)
├── myn/                                 Git repos (own project roots)
└── ...

WORKSPACE (~/Projects/overdeck/    Git repo — separate project root
           workspaces/feature-pan-300/)
├── .claude/
│   ├── skills/                          Copied by pan workspace create
│   ├── agents/                          (devroot skills NOT visible here)
│   └── rules/
└── ...
```

**Verified**: Tested by placing a `devroot-test` skill at `~/Projects/.claude/skills/` and confirming Claude Code discovered it when launched from `~/Projects/`.

This is an opinionated pattern. Users who don't want it can configure `pan sync` to skip devroot placement (opt-out, not opt-in).

### Core Principles

1. **Overdeck provides defaults. Everything can be overridden by the layer above.**
2. **Copies, not symlinks** — avoids the Claude Code symlink discovery bug.
3. **Devroot for manual work, workspace for agents** — skills go to the devroot (project level) for non-workspace use AND to each workspace for agent use. No precedence conflicts because they're separate project roots.
4. **`~/.claude/` is the user's personal space** — Overdeck NEVER touches `~/.claude/skills/`, `~/.claude/agents/`, or `~/.claude/rules/`. The user can put overrides there that beat everything (personal > project).
5. **Manifest tracking** — Overdeck tracks what it placed at the devroot and in workspaces, enabling safe updates and clean removal.
6. **No mid-work updates** — running workspaces are frozen. Updates only happen at `pan workspace create` time (or explicit `pan workspace update`).

### What `pan sync` Does: Today vs End-State

**Today (broken):**
```
pan sync
  └── ~/.overdeck/skills/ → symlink → ~/.claude/skills/     (PERSONAL level — overrides projects)
  └── ~/.overdeck/commands/ → symlink → ~/.claude/commands/  (PERSONAL level)
  └── ~/.overdeck/agents/ → symlink → ~/.claude/agents/      (PERSONAL level)
  └── hooks → ~/.overdeck/bin/
```

**End-state:**
```
pan sync
  ├── Updates ~/.overdeck/ cache from repo source
  │   ├── skills/           (kept fresh — replaces stale copies)
  │   ├── agents/
  │   ├── rules/            (NEW)
  │   └── .manifest.json    (hashes of all cached files)
  │
  ├── Copies to <devroot>/.claude/ (PROJECT level — for manual/non-workspace use)
  │   ├── skills/           (all Overdeck skills)
  │   ├── agents/           (all Overdeck agents)
  │   └── rules/            (all Overdeck rules)
  │   📋 Tracks what Overdeck placed in <devroot>/.claude/.overdeck-manifest.json
  │
  ├── Cleans up old symlinks in ~/.claude/ (migration from current broken state)
  │
  └── Syncs hooks → ~/.overdeck/bin/

pan workspace create <ISSUE-ID>
  ├── COPIES all content from ~/.overdeck/ → workspace/.claude/
  │   ├── skills/           (Overdeck defaults)
  │   ├── agents/           (Overdeck defaults)
  │   └── rules/            (Overdeck defaults)
  │
  ├── COPIES project template ON TOP (overrides Overdeck defaults)
  │   ├── skills/           (e.g., MYN's session-health overrides Overdeck's)
  │   ├── agents/           (e.g., MYN's code-reviewer)
  │   ├── rules/            (e.g., MYN-specific rules)
  │   └── commands/         (legacy, from template)
  │
  ├── Generates workspace CLAUDE.md
  └── Writes workspace/.claude/.manifest.json (tracks installed hashes)
```

### Why the Devroot Solves the Precedence Problem

The old approach put Overdeck skills in `~/.claude/skills/` (personal level). Claude Code's precedence: personal > project. This meant Overdeck's generic skills silently overrode project-specific customizations in workspaces.

The devroot approach eliminates this entirely:

| Location | Level | Visible To | Wins Over |
|----------|-------|-----------|-----------|
| `~/.claude/skills/` | Personal | Everything | Everything (user's overrides) |
| `<devroot>/.claude/skills/` | Project (devroot) | Manual Claude Code sessions from devroot | Nothing (lowest priority) |
| `workspace/.claude/skills/` | Project (workspace) | Workspace agents only | Nothing (lowest priority) |

**Devroot and workspace are separate project roots** — they never compete. An agent running in a workspace only sees `workspace/.claude/skills/`, never `<devroot>/.claude/skills/`.

If a user wants to override a Overdeck skill globally, they put their version in `~/.claude/skills/` (personal level) — which Overdeck never touches.

### Devroot Configuration

The devroot path is configured in `~/.overdeck/config.yaml`:

```yaml
devroot: ~/Projects        # where you launch Claude Code from
                            # set to null/false to disable devroot skill placement
```

Users who don't work from a single parent directory can set `devroot: null` to skip devroot placement. They'll still get skills in workspaces.

### Manifest Tracking

Two manifests track Overdeck-managed content:

**`<devroot>/.claude/.overdeck-manifest.json`** — tracks devroot-level content:
```json
{
  "version": 1,
  "managed_by": "overdeck",
  "installed": {
    "skills/beads/SKILL.md": { "hash": "abc123", "source": "overdeck", "installed_at": "2026-02-24T..." },
    "skills/session-health/SKILL.md": { "hash": "def456", "source": "overdeck", "installed_at": "2026-02-24T..." },
    "agents/planning-agent.md": { "hash": "ghi789", "source": "overdeck", "installed_at": "2026-02-24T..." }
  }
}
```

**`workspace/.claude/.manifest.json`** — tracks workspace content:
```json
{
  "version": 1,
  "installed": {
    "skills/beads/SKILL.md": { "hash": "abc123", "source": "overdeck" },
    "skills/session-health/SKILL.md": { "hash": "xyz999", "source": "project-template" },
    "skills/myn-standards/SKILL.md": { "hash": "myn001", "source": "project-template" }
  }
}
```

### Conflict Resolution

**During `pan sync` (devroot level):**

| Scenario | Action |
|----------|--------|
| File doesn't exist in devroot | Copy it (new install) |
| File exists, hash matches manifest | Safe to update (Overdeck placed it, user didn't modify) |
| File exists, hash differs from manifest | **Warning**: "Skipping skills/beads — modified since Overdeck installed it" |
| File exists, NOT in manifest | Skip entirely (user placed it themselves) |

**During `pan workspace create`:**

Same logic, but workspace is typically fresh so conflicts are rare. Project template files always overwrite Overdeck defaults at the same level (later copy wins).

**CLI flags:**
- `--force` — overwrite even modified files (useful after `pan install` upgrades)
- `--diff` — show what changed between installed version and current version

### Frozen Workspaces

Running workspaces are never updated automatically. If you want updated skills in an existing workspace:

```bash
pan workspace update MIN-678    # explicit command, only when agent is stopped
```

This prevents untested skill changes from affecting mid-flight agents. The `pan workspace update` command uses the same manifest-based conflict detection as `pan sync` — it warns on modified files, supports `--force` and `--diff`.

### Workspace CLAUDE.md Generation

The workspace CLAUDE.md is generated (not hand-written) by `generateClaudeMd()` in `src/lib/template.ts`:

```
pan workspace create MIN-678
  │
  ├── 1. Load Overdeck default sections:
  │      templates/claude-md/sections/
  │      ├── workspace-info.md
  │      ├── beads.md
  │      ├── commands-skills.md
  │      └── warnings.md
  │
  ├── 2. Load project-specific sections (if exist):
  │      project/.overdeck/claude-md/sections/
  │      └── [merged in alphabetical order]
  │
  ├── 3. Substitute variables:
  │      {{ISSUE_ID}}       → MIN-678
  │      {{BRANCH_NAME}}    → feature/min-678
  │      {{WORKSPACE_PATH}} → /path/to/feature-min-678
  │      {{FRONTEND_URL}}   → https://min-678.myn.localhost
  │      {{API_URL}}        → https://api-min-678.myn.localhost
  │      {{BEAD_ID}}        → workspace bead ID
  │
  └── OUTPUT: workspace/CLAUDE.md
```

Generated once at workspace creation. Not updated automatically afterward.

### Agent Startup Context

When an agent starts on a workspace, it receives context from multiple sources:

```
Agent starts on MIN-678 workspace
  │
  ├── Injected into prompt (by buildWorkAgentPrompt()):
  │   ├── work-agent.md template (base instructions)
  │   ├── .planning/STATE.md  (progress, decisions, remaining work)
  │   ├── .planning/feedback/ (specialist review/test feedback)
  │   ├── Beads tasks         (open/closed task list)
  │   ├── Stitch designs      (if UI work with design assets)
  │   └── Polyrepo context    (if polyrepo project)
  │
  ├── Agent reads on first turn (instructed by prompt):
  │   ├── workspace/CLAUDE.md          (generated workspace rules)
  │   ├── workspace/.planning/STATE.md (current progress)
  │   ├── project/CLAUDE.md            (project-wide rules)
  │   └── .planning/feedback/*.md      (unaddressed feedback)
  │
  └── Available during work (via Claude Code native loading):
      ├── ~/.claude/CLAUDE.md          (user preferences)
      ├── ~/.claude/skills/*           (user's personal overrides, if any)
      ├── ~/.claude/rules/*            (user's personal rules, if any)
      ├── workspace/.claude/skills/*   (Overdeck + project template skills)
      ├── workspace/.claude/rules/*    (Overdeck + project template rules)
      ├── workspace/.claude/agents/*   (Overdeck + project template agents)
      └── ~/.claude/projects/*/memory/ (auto memory)
      NOTE: devroot skills are NOT visible — agent runs from workspace, not devroot
```

Environment variables available to agents:
- `$OVERDECK_INSTALL_PATH` — where overdeck lives
- `$OVERDECK_PROJECT_PATH` — the project the agent works on
- `$OVERDECK_WORKSPACE_PATH` — the workspace directory
- `$OVERDECK_AGENT_ID` — agent identifier
- `$OVERDECK_ISSUE_ID` — issue being worked on
- `$OVERDECK_SESSION_TYPE` — phase (planning, implementation, etc.)

### Directory Structure (End-State)

```
~/.overdeck/                          PANOPTICON'S PRIVATE CACHE
├── skills/                             64 skills (kept fresh by pan sync)
├── dev-skills/                         3 dev-only skills
├── agents/                             8 agent definitions
├── rules/                              Overdeck rules (NEW)
├── .manifest.json                      Hashes of all cached content
├── config.yaml                         (includes devroot setting)
└── projects.yaml

<devroot>/                              DEVROOT (e.g., ~/Projects/) — not a git repo
├── .claude/
│   ├── skills/                         Overdeck skills (for manual/non-workspace use)
│   │   ├── beads/SKILL.md
│   │   ├── code-review/SKILL.md
│   │   ├── session-health/SKILL.md
│   │   └── ... (all 64 skills)
│   ├── agents/                         Overdeck agents
│   ├── rules/                          Overdeck rules
│   ├── settings.local.json             (pre-existing user settings)
│   └── .overdeck-manifest.json       Tracks what Overdeck placed here
├── overdeck/                     Git repo
├── myn/                                Git repos
└── ...

~/.claude/                              USER'S PERSONAL SPACE — UNTOUCHED BY PANOPTICON
├── CLAUDE.md                           User's personal preferences
├── skills/                             User's personal overrides ONLY (if any)
│   └── my-custom-skill/SKILL.md       (beats everything — personal > project)
├── agents/                             User's personal agents (if any)
├── rules/                              User's personal rules (if any)
└── settings.json                       User settings

workspace/feature-min-678/              WORKSPACE (project level)
├── CLAUDE.md                           Generated by Overdeck
├── .claude/
│   ├── skills/                         Overdeck defaults + project template overrides
│   │   ├── beads/SKILL.md             (from Overdeck)
│   │   ├── session-health/SKILL.md    (from MYN template — overrides Overdeck)
│   │   ├── myn-standards/SKILL.md     (MYN-only, from template)
│   │   └── ...
│   ├── agents/                         Overdeck + project template agents
│   │   ├── planning-agent.md          (from Overdeck)
│   │   ├── code-reviewer.md           (from MYN template — overrides Overdeck)
│   │   └── ...
│   ├── rules/                          Overdeck + project template rules
│   ├── commands/                       From project template (legacy)
│   └── .manifest.json                  Tracks what was installed, for safe updates
├── .planning/
└── [source files]
```

### Precedence in Practice

**Inside a workspace** (agent context):
```
~/.claude/skills/my-override/               ← WINS (personal — user's own overrides)
  over
workspace/.claude/skills/session-health/    ← Project template version (workspace project level)
workspace/.claude/skills/beads/             ← Overdeck default (workspace project level)

NOTE: Devroot skills are NOT visible here — different project root.
```

**Outside a workspace** (manual prompting from devroot, hotfixes):
```
~/.claude/skills/my-override/               ← WINS (personal — user's own overrides)
  over
<devroot>/.claude/skills/beads/             ← Overdeck-installed (devroot project level)
<devroot>/.claude/skills/session-health/    ← Overdeck-installed (devroot project level)
```

**Project template overriding Overdeck default** (within workspace):
```
workspace/.claude/skills/session-health/   ← MYN template version (copied second, overwrites
  was originally                              Overdeck's version AT THE SAME LEVEL)
~/.overdeck/skills/session-health/       ← Overdeck generic version (copied first)
```

**No conflicts**: Devroot and workspace never compete because they're separate project roots. User overrides in `~/.claude/skills/` (personal level) win over both — as intended.

### Migration Path

When implementing, `pan sync` needs a one-time migration from the current symlink-based approach:

**Step 1: Update ~/.overdeck/ cache**
```
Replace stale copies in ~/.overdeck/skills/ with fresh content from repo.
This fixes the "pan install never updates" problem.
```

**Step 2: Remove old symlinks from ~/.claude/**
```
For each symlink in ~/.claude/skills/ pointing to ~/.overdeck/:
  - Remove the symlink
  - Do NOT replace (Overdeck no longer touches ~/.claude/)

For each symlink in ~/.claude/agents/ pointing to ~/.overdeck/:
  - Remove the symlink

For each non-Overdeck content (user-created files, non-Overdeck symlinks):
  - Leave it alone
```

**Step 3: Populate devroot**
```
Copy all skills, agents, rules from ~/.overdeck/ cache → <devroot>/.claude/
Write <devroot>/.claude/.overdeck-manifest.json
```

**Step 4: Print summary**
```
Overdeck sync migration:
  ✓ Removed 64 skill symlinks from ~/.claude/skills/
  ✓ Removed 8 agent symlinks from ~/.claude/agents/
  ⚠ Preserved 2 user-created items in ~/.claude/skills/
  ✓ Installed 64 skills to ~/Projects/.claude/skills/
  ✓ Installed 8 agents to ~/Projects/.claude/agents/
  ✓ Wrote ~/Projects/.claude/.overdeck-manifest.json
```

**Future syncs** after migration use manifest-based logic (no more symlink detection needed).

### Commands → Skills Migration

MYN's project template currently has 8+ legacy commands in `.claude/commands/`. Claude Code's skills system has superseded commands — skills win over same-name commands and offer richer metadata (description, triggers, frontmatter).

**This migration is part of this effort.** During implementation:

1. **Audit MYN commands**: Determine which commands have skill equivalents already
2. **Convert remaining commands to skills**: Each command becomes a skill in the project template
3. **Update `projects.yaml`**: Change template `symlinks` config from `commands` to `skills` (or both during transition)
4. **Update Overdeck's workspace creation**: Ensure commands are still copied for backward compatibility during transition, with a deprecation warning

**MYN commands to migrate:**

| Command | Action |
|---------|--------|
| `work-issue` | → skill (or keep as command if it's just a thin wrapper around `pan issue`) |
| `work-plan` | → skill |
| `work-approve` | → skill (likely maps to `pan-approve`) |
| `work-status` | → skill (likely maps to `pan-status` or `workspace-status`) |
| `work-tell` | → skill (likely maps to `pan-tell`) |
| `work-unlock` | → skill |
| `work-issues` | → skill |
| `work-pending` | → skill |
| `beads/`, `dev/`, `git/`, `pan/` | → evaluate: some may already be covered by Overdeck skills |

This doesn't need to happen atomically — commands and skills coexist. But the end goal is skills only.

---

## 7. Rules: Planned Content

Rules are a new content type Overdeck should distribute. Some content currently in generated workspace CLAUDE.md is better expressed as path-scoped rules.

**Planned Overdeck rules** (tracked in [PAN-263](https://github.com/eltmon/overdeck/issues/263)):

| Candidate Rule | Path Scope | Currently In |
|---------------|-----------|-------------|
| No execSync in server code | `src/dashboard/**`, `src/lib/cloister/**` | CLAUDE.md |
| Use sendKeysAsync not sendKeys | `src/dashboard/**`, `src/lib/agents.ts` | CLAUDE.md |
| Async tmux message delivery | `src/lib/tmux.ts` | CLAUDE.md |
| Never deep-wipe without confirmation | `src/dashboard/**`, `src/lib/**` | CLAUDE.md |

**Research needed**: Look online for common Claude Code rules others have found useful (tracked in PAN-263).

**MYN candidate rules**:

| Candidate Rule | Path Scope | Currently In |
|---------------|-----------|-------------|
| No localias — use Overdeck | `**` | Skill (should be a rule — always-on guidance, not invocable) |
| MYN domain conventions | `**/*.ts`, `**/*.tsx` | Scattered in CLAUDE.md |

---

## 8. Complete Content Inventory

### Overdeck Skills (64)

**Developer Power Tools** (useful everywhere, not just workspaces):

| Skill | Description |
|-------|-------------|
| `beads` | Git-backed issue tracker for multi-session work |
| `beads-completion-check` | Verify all beads closed before review |
| `beads-overdeck-guide` | Overdeck-specific beads patterns |
| `bug-fix` | Systematic bug investigation workflow |
| `clear-writing` | Prose quality rules for documentation |
| `code-review` | Comprehensive code review |
| `code-review-performance` | Deep performance analysis |
| `code-review-security` | OWASP-focused security analysis |
| `crash-investigation` | System crash/OOM analysis |
| `dependency-update` | Safe dependency update workflow |
| `feature-work` | Standard feature implementation workflow |
| `github-cli` | gh CLI reference |
| `incident-response` | Production incident workflow |
| `knowledge-capture` | AI self-monitoring for confusion patterns |
| `onboard-codebase` | Systematic codebase exploration |
| `react-best-practices` | Vercel React/Next.js optimization guide |
| `refactor` | Safe refactoring with test coverage |
| `refactor-radar` | AI self-monitoring for architectural debt |
| `release` | Step-by-step release process |
| `skill-creator` | Guide for creating Claude Code skills |
| `stitch-design-md` | Analyze Stitch projects into DESIGN.md |
| `stitch-react-components` | Convert Stitch designs to React components |
| `stitch-setup` | Set up Stitch MCP server |
| `web-design-guidelines` | Web Interface Guidelines compliance |

**Overdeck Operations** (useful everywhere for Overdeck users):

| Skill | Description |
|-------|-------------|
| `pan-approve` | Approve agent work and merge |
| `pan-code-review` | Orchestrated parallel code review |
| `pan-config` | View and edit Overdeck config |
| `pan-convoy-synthesis` | Synthesize parallel agent results |
| `pan-diagnose` | Troubleshoot common issues |
| `pan-docker` | Docker template selection |
| `pan-docs` | Find info in Overdeck docs |
| `pan-down` | Stop dashboard and services |
| `pan-health` | Check system health |
| `pan-help` | Overview of all commands |
| `pan-install` | Installation guide |
| `pan-issue` | Create workspace and spawn agent |
| `pan-kill` | Stop a running agent |
| `pan-logs` | View and analyze agent logs |
| `pan-network` | Traefik and local domain setup |
| `pan-oversee` | Supervise agent through full lifecycle |
| `pan-plan` | Interactive planning workflow |
| `pan-projects` | Manage Overdeck projects |
| `pan-quickstart` | Quick start guide |
| `pan-reload` | Rebuild and reload Overdeck |
| `pan-reopen` | Reopen a closed workspace |
| `pan-rescue` | Recover work from crashed agents |
| `pan-restart` | Restart the dashboard |
| `pan-setup` | First-time configuration wizard |
| `pan-skill-creator` | Create and distribute Overdeck skills |
| `pan-status` | Check running agents and workspaces |
| `pan-subagent-creator` | Create custom Claude Code subagents |
| `pan-sync` | Sync skills to Claude Code |
| `pan-sync-main` | Sync workspace with main branch |
| `pan-tell` | Send message to running agent |
| `pan-test-config` | Test configuration helper |
| `pan-tldr` | TLDR code analysis setup |
| `pan-tracker` | Configure issue tracker integration |
| `pan-up` | Start dashboard and services |
| `pan-workspace-config` | Workspace configuration |

**Agent Context** (primarily useful inside workspaces):

| Skill | Description |
|-------|-------------|
| `plan` | Opus-driven planning before implementation |
| `send-feedback-to-agent` | Send specialist feedback to issue agents |
| `session-health` | Detect and clean up stuck sessions |
| `work-complete` | Agent completion checklist |
| `workspace-status` | Display workspace info with URLs/commands |

### Overdeck Dev-Skills (3)

| Skill | Description |
|-------|-------------|
| `pan-dashboard-restart` | Dev: restart dashboard process |
| `pan-skill-creator` | Dev: skill creation for Overdeck contributors |
| `test-specialist-workflow` | Dev: test review→test→merge pipeline |

### Overdeck Agents (8)

| Agent | Description |
|-------|-------------|
| `planning-agent` | Discovery and planning phase |
| `triage-agent` | Issue triage and classification |
| `code-review-correctness` | Correctness-focused review |
| `code-review-performance` | Performance-focused review |
| `code-review-security` | Security-focused review |
| `code-review-synthesis` | Synthesize parallel review results |
| `codebase-explorer` | Systematic codebase exploration |
| `health-monitor` | Agent health monitoring |

### Project-Scoped (Overdeck repo only)

| Type | Item | Description |
|------|------|-------------|
| Skill | `update-overdeck-docs` | Guide for updating Overdeck docs (in `.claude/skills/`) |

### MYN Project Template Content

| Type | Item | Description |
|------|------|-------------|
| Skill | `beads` | Overdeck copy (was stale, replaced) |
| Skill | `blog-writer` | MYN engineering blog voice |
| Skill | `myn-prod-backup` | DOKS cluster backup |
| Skill | `myn-standards` | Brand, design system, patterns |
| Skill | `no-localias` | Domain reminder (candidate for rule) |
| Skill | `reseed` | Dev seed generation |
| Skill | `session-health` | MYN-customized version |
| Skill | `workspace-status` | MYN-specific URLs |
| Agent | `code-reviewer` | MYN code review agent |
| Agent | `test-runner` | MYN test runner agent |
| Command | `work-issue` | Spawn agent for Linear issue |
| Command | `work-plan` | Planning workflow |
| Command | `work-approve` | Merge MR, update Linear |
| Command | `work-status` | Show running agents |
| Command | `work-tell` | Send message to agent |
| Command | `work-unlock` | Unlock stuck agent |
| Command | (+ others) | beads, dev, git, pan subdirs |

---

## 9. Decisions Log

Decisions agreed upon during analysis, for reference during implementation.

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Copies, not symlinks, everywhere | Claude Code symlink bug #14836; affects skills and likely agents/rules too |
| D2 | Devroot for manual work, workspace for agents | Devroot (`~/Projects/.claude/`) for non-workspace use; workspace `.claude/` for agent use. Separate project roots = no precedence conflicts |
| D3 | Manifest-based tracking | Know what Overdeck placed vs. what user placed; enable safe updates and removal |
| D4 | `~/.claude/` is the user's personal space — Overdeck never touches it | User can put overrides at personal level that beat everything; Overdeck targets devroot (project level) instead |
| D5 | Frozen workspaces — no mid-work updates | Untested skill changes should never affect running agents |
| D6 | `pan workspace update` for explicit refresh | Opt-in mechanism for updating skills in an existing workspace |
| D7 | `--force` flag to overwrite on conflict | Escape hatch when user wants to accept Overdeck's version |
| D8 | `--diff` flag to show changes | Let user see what changed before deciding |
| D9 | Warning messages on conflict (default) | Not silent skip, not silent overwrite — inform the user |
| D10 | Clean up old symlinks from `~/.claude/` during migration | Overdeck no longer touches `~/.claude/`; old symlinks must be removed |
| D11 | Distribute rules via same mechanism | Same copy + manifest plumbing for `.claude/rules/` |
| D12 | File GitHub issues for rule analysis | Research which rules to create, including community suggestions |
| D13 | `no-localias` is MYN-specific | NOT promoted to Overdeck — MYN project template only |
| D14 | Project template overrides by copying second | Later copy at workspace level overwrites Overdeck defaults |
| D15 | Migrate MYN commands to skills as part of this effort | Commands are legacy; skills have richer metadata and win in precedence |
| D16 | All content from `~/Documents/` hierarchy docs incorporated here | Those files are now deleted; this analysis doc is the single source of truth |
| D17 | Devroot is configurable, opt-out | Default: `~/Projects/`. Users can set `devroot: null` in config to skip devroot placement |

---

## 10. Tracked Issues

Items tracked as GitHub issues (follow-up work, not blocking implementation):

| Issue | Title | Notes |
|-------|-------|-------|
| [PAN-263](https://github.com/eltmon/overdeck/issues/263) | Analyze and create initial Overdeck rules | Research candidates, community patterns, create `.claude/rules/` files |
| [PAN-264](https://github.com/eltmon/overdeck/issues/264) | Audit localias references across all code and docs | Clean up stale localias references in all repos |
| [PAN-265](https://github.com/eltmon/overdeck/issues/265) | Review skill categorization: all skills available everywhere | Confirm all 64 skills work gracefully outside workspace context |

## 11. Implementation Scope

Everything below is **part of this effort** — not deferred, not follow-up:

| Work Item | Described In |
|-----------|-------------|
| Rewrite `pan sync` to use copies + manifest + devroot | Section 6: "What `pan sync` Does" |
| Rewrite `pan workspace create` to copy + overlay | Section 6: "What `pan sync` Does" |
| Implement devroot config and placement | Section 6: "The Devroot Pattern", "Devroot Configuration" |
| Implement manifest tracking (devroot + workspace) | Section 6: "Manifest Tracking" |
| Implement conflict detection with warnings | Section 6: "Conflict Resolution" |
| Add `--force` and `--diff` flags | Section 6: "Conflict Resolution" |
| Implement `pan workspace update` command | Section 6: "Frozen Workspaces" |
| One-time migration: remove ~/.claude/ symlinks, populate devroot | Section 6: "Migration Path" |
| Distribute rules via same mechanism | Decision D11 |
| Commands → skills migration for MYN template | Section 6: "Commands → Skills Migration" |
| Update `~/.overdeck/` cache refresh (fix stale copies) | Section 6: "What `pan sync` Does" |

---

## References

- [Claude Code Memory Docs](https://code.claude.com/docs/en/memory) — CLAUDE.md hierarchy
- [Claude Code Skills Docs](https://code.claude.com/docs/en/skills) — Skills hierarchy
- [Claude Code Sub-agents Docs](https://code.claude.com/docs/en/sub-agents) — Agents hierarchy
- [Symlink Bug #14836](https://github.com/anthropics/claude-code/issues/14836) — Skills not listed when symlinked
- [PAN-3 Issue](https://github.com/eltmon/overdeck/issues/3) — Original skills architecture
- [PAN-263](https://github.com/eltmon/overdeck/issues/263) — Initial rules analysis
- [PAN-264](https://github.com/eltmon/overdeck/issues/264) — Localias reference cleanup
- [PAN-265](https://github.com/eltmon/overdeck/issues/265) — Skill categorization review
