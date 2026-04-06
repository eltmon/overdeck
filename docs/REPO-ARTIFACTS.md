# Panopticon Repo Artifacts — Design Reference

**What lives in a project's repository, what doesn't, and why.**

This document is the canonical reference for Panopticon-managed content in project repos.
All future work must conform to these decisions.

---

## Guiding Principle

The repo is the source of truth. If an artifact is useful to a future agent, a future
developer, or a team member on a different machine, it belongs in the repo. Ephemeral
runtime state (tmux sessions, agent PIDs, caches) stays in `~/.panopticon/`.

---

## `.pan/` — Project-Level Panopticon Content

Each project repo may contain a `.pan/` directory for project-specific Panopticon content.
This is the project-facing counterpart to the global `~/.panopticon/`.

```
project-repo/
└── .pan/
    ├── skills/          Project-specific skills (synced by pan sync)
    │   └── <name>/
    │       └── SKILL.md
    ├── agents/          Project-specific agent overrides
    │   └── <name>/
    │       └── AGENT.md
    └── rules/           Project-specific rules (path-scoped context)
        └── <name>.md
```

**What belongs here:**
- Skills that only make sense in the context of this project (e.g., `myn-release`,
  `auricle-deploy`, `openclaw-deploy`)
- Agent overrides specific to this project's conventions
- Rules describing project-specific coding standards, banned patterns, etc.

**What does NOT belong here:**
- General-purpose skills that other projects could use — those live in the
  Panopticon CLI repo under `skills/` and sync globally
- Runtime output (convoy results, cost events) — see [Runtime Output](#runtime-output-directories)

### Naming

`.pan/` was chosen over `.panopticon/` for brevity, and because `.panopticon/` already
appeared in the codebase as a project-level runtime output directory (now also renamed to
`.pan/`). The global tool directory (`~/.panopticon/`) is unchanged.

---

## Per-Project Config File

```
project-repo/
└── .pan.yaml            Per-project Panopticon configuration
```

(Previously `.panopticon.yaml` — renamed for consistency with `.pan/`.)

Overrides global `~/.panopticon/config.yaml` settings for this project. Key fields:

```yaml
models:
  overrides:
    issue-agent:implementation: kimi-k2.5

tools:
  also_sync:
    - cursor              # Merge with global also_sync, never replaces it

tracker_keys:
  linear: lin_api_xxxxx  # Optional per-project override
```

---

## Skills — Source of Truth Hierarchy

When `pan sync` writes skills to a project's tool directories, it respects this precedence:

| Priority | Source | Rule |
|----------|--------|------|
| **1 (highest)** | `.claude/skills/<name>/` already in project repo | **Never touched.** User owns it. |
| **2** | `.pan/skills/<name>/` in project repo | Project-specific. Written by `pan sync`. |
| **3 (lowest)** | `~/.panopticon/skills/<name>/` | Global Panopticon skills. |

If a `.claude/skills/<name>/` directory already exists in the project, `pan sync` skips
it entirely — it never overwrites user-managed skills.

### Multi-Tool Sync Targets

`pan sync` can write skills and rules to multiple AI tool directories. The target tool
is configured globally in `~/.panopticon/config.yaml`, with per-project additions in
`.pan.yaml`.

```yaml
# ~/.panopticon/config.yaml
tools:
  primary: claude-code
  also_sync:
    - cursor
```

```yaml
# .pan.yaml (per-project, merges with global — never replaces)
tools:
  also_sync:
    - codex
```

**Output paths per tool:**

| Tool | Skills/Rules target | Notes |
|------|-------------------|-------|
| **Claude Code** | `.claude/skills/` + `.claude/rules/` | Primary support |
| **Cursor** | `.cursor/rules/*.mdc` | Modern format (legacy: `.cursorrules`) |
| **Codex** | `AGENTS.md` sections | Skills become named blocks |
| **Windsurf** | `.windsurf/rules/*.md` | Modern format (legacy: `.windsurfrules`) |
| **Cline** | `.clinerules/` | Directory of markdown files |
| **GitHub Copilot** | `.github/instructions/*.instructions.md` | With `applyTo:` frontmatter |
| **Aider** | `CONVENTIONS.md` | Referenced via `.aider.conf.yml` `read:` option |

Per-project `also_sync` **merges** with global — a project cannot remove a tool the
developer configured globally.

---

## Planning Artifacts — `.planning/`

```
project-repo/
└── .planning/
    ├── STATE.md             Narrative: decisions made, approach taken, remaining work
    ├── plan.vbrief.json     Machine-readable work plan (vBRIEF v0.5)
    ├── PRD.md               Discovered/created requirements (copied from docs/prds/)
    ├── PLANNING_PROMPT.md   Planning agent instructions (deleted after planning)
    ├── beads/
    │   └── issues.jsonl     Task tracking (derived from vBRIEF items)
    └── feedback/            Specialist feedback (review-agent, test-agent)
```

`.planning/` is **committed to git** in the feature branch worktree. It is not gitignored.
This means the entire planning context travels with the branch and is visible in PRs.

### STATE.md — Final Decision

STATE.md lives in the repo, committed. It is not ephemeral.

**Why**: STATE.md is the narrative bridge between the issue tracker and the code changes.
It captures *why* decisions were made — information that is not recoverable from git
history alone. Future agents working in the same area need this context. Future developers
debugging a regression need this context.

**Active** (during work): `.planning/STATE.md` — updated as work progresses, committed
to the feature branch.

**Archived** (after issue closes): `docs/prds/active/<issue-id>/STATE.md` — permanent
record on the main branch.

### VBRIEFs — Final Decision

VBRIEFs live in the repo, always.

**Active** (during work): `.planning/plan.vbrief.json` — committed to the feature branch,
updated by the work agent as items complete.

**Archived** (after issue closes): `docs/prds/active/<issue-id>/plan.vbrief.json` —
permanent record on the main branch.

---

## Archive Structure — `docs/prds/active/`

After an issue closes, both the vBRIEF and STATE.md are archived together in a
**subdirectory per issue**:

```
docs/prds/active/
└── <issue-id>/
    ├── plan.vbrief.json     Archived vBRIEF
    └── STATE.md             Archived narrative
```

**Note**: This is a breaking change from the previous flat layout
(`docs/prds/active/<ID>-plan.vbrief.json`). The subdirectory structure is cleaner when
both files coexist and makes it easier to add additional artifacts (PRD snapshots,
feedback summaries) in the future.

Migration: existing flat archives remain valid. New closures always use the subdirectory
format.

---

## Runtime Output Directories

Some Panopticon features write transient output into the project workspace during agent
runs. These live under `.pan/` to keep the project root clean:

| Path | Written by | Contents |
|------|-----------|----------|
| `.pan/events/` | Cost WAL | Per-issue cost event logs (`<issue-id>.jsonl`) |
| `.pan/convoy/` | Convoy commands | Convoy analysis output |
| `.pan/prompts/` | Remote agents | VM-side agent prompt files |

These directories are **gitignored** — they are runtime state, not repo artifacts.
Add to `.gitignore`:

```
.pan/events/
.pan/convoy/
.pan/prompts/
```

---

## Complete Repo Structure Reference

```
project-repo/
├── .pan/                          Panopticon project content (committed)
│   ├── skills/<name>/SKILL.md     Project-specific skills
│   ├── agents/<name>/AGENT.md     Project-specific agent overrides
│   └── rules/<name>.md            Project-specific rules
├── .pan.yaml                      Per-project config (committed)
├── .planning/                     Active workspace artifacts (committed to feature branch)
│   ├── STATE.md
│   ├── plan.vbrief.json
│   ├── PRD.md
│   ├── PLANNING_PROMPT.md
│   ├── beads/issues.jsonl
│   └── feedback/
├── .claude/                       Claude Code tool directories (committed)
│   ├── skills/                    ← .pan/skills/ synced here; user-owned skills NOT overwritten
│   ├── agents/
│   └── rules/
├── .cursor/rules/                 Cursor rules (synced by pan sync if configured)
├── .windsurf/rules/               Windsurf rules (synced by pan sync if configured)
├── .clinerules/                   Cline rules (synced by pan sync if configured)
├── .github/instructions/          Copilot instructions (synced by pan sync if configured)
├── AGENTS.md                      Codex instructions (synced by pan sync if configured)
├── CLAUDE.md                      Generated by Panopticon (committed)
├── docs/
│   └── prds/
│       ├── active/<issue-id>/     Archived planning artifacts (committed to main)
│       │   ├── plan.vbrief.json
│       │   └── STATE.md
│       └── planned/               Pre-work PRDs
└── .gitignore                     Must include .pan/events/, .pan/convoy/, .pan/prompts/
```

---

## What Does NOT Live in the Repo

| Artifact | Where it lives | Why |
|---------|---------------|-----|
| Global skills cache | `~/.panopticon/skills/` | Machine-local, refreshed by `pan sync` |
| Agent state dirs | `~/.panopticon/agents/<id>/` | Runtime state, not portable |
| Specialist sessions | `~/.panopticon/specialists/` | Runtime state |
| Issue archives | `~/.panopticon/archives/<issue>/` | Closed-issue state backup |
| Traefik config | `~/.panopticon/traefik/` | Infrastructure, not project content |
| Cost database | `~/.panopticon/panopticon.db` | Aggregated across all projects |
| Shadow state | `~/.panopticon/shadow-state/` | Derived from tracker, not authoritative |
