# Overdeck Repo Artifacts — Design Reference

**What lives in a project's repository, what doesn't, and why.**

This document is the canonical reference for Overdeck-managed content in project repos.
All future work must conform to these decisions.

---

## Guiding Principle

The repo is the source of truth. If an artifact is useful to a future agent, a future
developer, or a team member on a different machine, it belongs in the repo. Ephemeral
runtime state (tmux sessions, agent PIDs, caches) stays in `~/.overdeck/`.

---

## `.pan/` — Project-Level Overdeck Content

Each project repo may contain a `.pan/` directory for project-specific Overdeck content.
This is the project-facing counterpart to the global `~/.overdeck/`.

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
  Overdeck CLI repo under `skills/` and sync globally
- Runtime output (review results, cost events) — see [Runtime Output](#runtime-output-directories)

### Naming

`.pan/` was chosen over `.overdeck/` for brevity, and because `.overdeck/` already
appeared in the codebase as a project-level runtime output directory (now also renamed to
`.pan/`). The global tool directory (`~/.overdeck/`) is unchanged.

---

## Per-Project Config File

```
project-repo/
└── .pan.yaml            Per-project Overdeck configuration
```

(Previously `.overdeck.yaml` — renamed for consistency with `.pan/`.)

Overrides global `~/.overdeck/config.yaml` settings for this project. Key fields:

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
| **3 (lowest)** | `~/.overdeck/skills/<name>/` | Global Overdeck skills. |

If a `.claude/skills/<name>/` directory already exists in the project, `pan sync` skips
it entirely — it never overwrites user-managed skills.

### Multi-Tool Sync Targets

`pan sync` can write skills and rules to multiple AI tool directories. The target tool
is configured globally in `~/.overdeck/config.yaml`, with per-project additions in
`.pan.yaml`.

```yaml
# ~/.overdeck/config.yaml
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

## vBRIEF Lifecycle — `.pan/specs/`

Scope vBRIEFs are durable, first-class source-of-truth artifacts. They live in `.pan/specs/`
on main and **do not move between directories** — status is tracked via the `plan.status`
field inside each JSON file. See [VBRIEF.md](./VBRIEF.md) for the full format and lifecycle
reference.

```
project-repo/  (main branch)
└── .pan/
    ├── specs/
    │   ├── 2026-05-01-PAN-960-foo.vbrief.json     (status: "proposed")
    │   ├── 2026-04-28-PAN-714-bar.vbrief.json     (status: "active")
    │   └── 2026-04-20-MIN-846-baz.vbrief.json     (status: "completed")
    └── drafts/
        └── PAN-970-next-thing.md                   PRD being refined
```

**Key points:**
- Filenames are issue-keyed: `YYYY-MM-DD-<ISSUE-ID>-<slug>.vbrief.json`
- The date prefix is the immutable creation date (UTC)
- Files never move — `plan.status` field transitions: `draft → proposed → active → completed` (or `cancelled`)
- Continue state lives in the workspace at `.pan/continue.json`, not alongside the spec on main

### PRDs vs vBRIEFs

These are complementary, not competing artifacts:

| Artifact | Author | Format | Location | Purpose |
|----------|--------|--------|----------|---------|
| **PRD** | Human | Markdown | `docs/prds/` | Requirements, intent, context — input to planning |
| **vBRIEF** | Agent (Opus) | JSON | `.pan/specs/` | Structured operational plan — output of planning |

PRDs are human-authored Product Requirement Definitions that describe *what* to build and
*why*. They live in `docs/prds/{planned,active,completed}/` and are not touched by the
lifecycle system.

vBRIEFs are machine-readable operational artifacts that describe *how* to build it — with
acceptance criteria, dependency DAGs, and status tracking. They live in `.pan/specs/` on
main with field-based status transitions (files never move between directories).

The planning agent reads the PRD (if one exists) as input and produces a vBRIEF plan as output.

---

## Workspace Orchestration — `.pan/` (feature branch)

```
project-repo/  (feature branch workspace)
└── .pan/
    ├── spec.vbrief.json     Machine-readable work plan (copied from main at branch creation)
    ├── continue.json        Structured session state (resume point, decisions, hazards)
    ├── prd.md               Discovered/created requirements (copied from docs/prds/)
    ├── context.md           Workspace context for agents
    ├── sessions.jsonl       Append-only session history
    └── review/              Specialist feedback (review-agent, test-agent)
```

`.pan/` is **committed to git** in the feature branch worktree. It is not gitignored.
This means the entire planning/orchestration context travels with the branch and is visible in PRs.

Beads (task tracking) live at `.beads/` — a separate dot-directory, not inside `.pan/`.

During planning, the vBRIEF spec is created in `.pan/specs/` on main with
`plan.status: "proposed"`. When work starts, it is copied to the workspace as
`.pan/spec.vbrief.json`.

### Continue State (replaces STATE.md)

The structured continuation state file (`continue.json`) replaces the
free-form `STATE.md`. It contains git state, decisions, hazards, resume points, beads
mapping, agent model, and session history — all machine-parseable.

**During work**: Written to `.pan/continue.json` in the workspace.
**After merge**: Archived with the completed spec on main.

See [VBRIEF.md § Continue State](./VBRIEF.md#continue-state--structured-session-history) for the full schema.

---

## Runtime Output Directories

Some Overdeck features write transient output into the project workspace during agent
runs. These live under `.pan/` to keep the project root clean:

| Path | Written by | Contents |
|------|-----------|----------|
| `.pan/events/` | Cost WAL | Per-issue cost event logs (`<issue-id>.jsonl`) |
| `.pan/review/` | Review agents | Parallel review output |
| `.pan/prompts/` | Remote agents | VM-side agent prompt files |

These directories are **gitignored** — they are runtime state, not repo artifacts.
Add to `.gitignore`:

```
.pan/events/
.pan/review/
.pan/prompts/
```

---

## Complete Repo Structure Reference

```
project-repo/
├── .pan/                          Overdeck project content (committed)
│   ├── skills/<name>/SKILL.md     Project-specific skills
│   ├── agents/<name>/AGENT.md     Project-specific agent overrides
│   └── rules/<name>.md            Project-specific rules
├── .pan.yaml                      Per-project config (committed)
├── .pan/specs/                    vBRIEF specs (committed to main, field-based status)
│   └── YYYY-MM-DD-ID-slug.vbrief.json
├── .pan/drafts/                   PRDs being refined (committed to main)
├── .pan/spec.vbrief.json          Workspace scope plan (on feature branch)
├── .pan/continue.json             Workspace session state (on feature branch)
├── .pan/prd.md                    Workspace PRD copy (on feature branch)
├── .pan/review/                   Specialist feedback (on feature branch)
├── .beads/                        Task tracking beads (on feature branch)
├── .claude/                       Claude Code tool directories (committed)
│   ├── skills/                    ← .pan/skills/ synced here; user-owned skills NOT overwritten
│   ├── agents/
│   └── rules/
├── .cursor/rules/                 Cursor rules (synced by pan sync if configured)
├── .windsurf/rules/               Windsurf rules (synced by pan sync if configured)
├── .clinerules/                   Cline rules (synced by pan sync if configured)
├── .github/instructions/          Copilot instructions (synced by pan sync if configured)
├── AGENTS.md                      Codex instructions (synced by pan sync if configured)
├── CLAUDE.md                      Generated by Overdeck (committed)
├── docs/
│   └── prds/
│       ├── active/                Human-authored PRDs for active work
│       ├── planned/               Pre-work PRDs
│       └── completed/             Archived PRDs
└── .gitignore                     Must include .pan/events/, .pan/review/, .pan/prompts/
```

---

## Repo Root Policy

The repo root contains only canonical entrypoints and standard tooling metadata.
Nothing else belongs there.

**What belongs at root:**

| File / Pattern | Why |
|----------------|-----|
| `README.md` | Project front door |
| `CLAUDE.md`, `AGENTS.md` | AI tool instructions |
| `CONTRIBUTING.md`, `LICENSE` | Standard project metadata |
| `package.json`, `bun.lock`, `bunfig.toml` | Package manager manifest |
| `tsconfig.json`, `tsdown.config.ts` | Build tooling |
| `vitest.config.ts`, `vitest.workspace.ts` | Test runner config |
| `typedoc.json`, `commitlint.config.js` | Doc/lint tooling |
| `.gitignore`, `.gitattributes`, `.eslintrc.json` | Repo metadata |
| `introduction.mdx`, `quickstart.mdx`, `concepts.mdx` | Docs-site top-level entries |

**What does NOT belong at root — and where it goes instead:**

| Artifact type | Examples | Correct home |
|---------------|----------|--------------|
| Audit / investigation reports | `AGENT_AUDIT_REPORT.md`, `BUGS_FOUND.md`, `gemini-gaps-found.md` | `docs/audits/` |
| Historical writeups / post-mortems | `IMPLEMENTATION_SUMMARY.md`, `PAN-428-CODEX-FEEDBACK.md` | `docs/history/` |
| Screenshots / screen captures | `dashboard-home.png`, `command-deck.png` | `docs/screenshots/<topic>/` |
| Temporary debug scripts | `debug-review.mjs`, log files | `.gitignore`'d or deleted after use |
| Per-workspace env scaffolds | `.env.remote` | Never tracked — generated into the workspace at spawn time; root `.gitignore` blocks it |

When adding a new artifact, ask: *"Is this a canonical project entrypoint or tooling config?"*
If yes → root. If no → find or create the appropriate `docs/` subdirectory.

---

## What Does NOT Live in the Repo

| Artifact | Where it lives | Why |
|---------|---------------|-----|
| Global skills cache | `~/.overdeck/skills/` | Machine-local, refreshed by `pan sync` |
| Agent state dirs | `~/.overdeck/agents/<id>/` | Runtime state, not portable. Includes `state.json`, `health.json`, `lifecycle.log`, `spawn.log`, `output.log`, launcher scripts, and saved Claude session metadata. |
| Specialist sessions | `~/.overdeck/specialists/` | Runtime state |
| Issue archives (runtime) | `~/.overdeck/archives/<issue>/` | Closed-issue runtime state backup (agent dirs, logs). Scope vBRIEFs remain in `.pan/specs/` with `status: "completed"`. |
| Traefik config | `~/.overdeck/traefik/` | Infrastructure, not project content |
| Cost database | `~/.overdeck/panopticon.db` | Aggregated across all projects |
| Shadow state | `~/.overdeck/shadow-state/` | Derived from tracker, not authoritative |
