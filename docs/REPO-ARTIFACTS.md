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

tracker_keys:
  linear: lin_api_xxxxx  # Optional per-project override
```

---

## Native harness files

Project `CLAUDE.md`, `AGENTS.md`, `.claude/`, `.cursor/`, `.windsurf/`,
`.clinerules/`, Copilot instructions, and Aider conventions are user/repository
owned. `pan sync` never writes them. The retired `tools.also_sync` configuration
shape is accepted temporarily as a no-op for compatibility.

---

## xBRIEF Lifecycle — `specs/` on `overdeck-state`

Scope xBRIEFs are durable, first-class source-of-truth artifacts. They live in `specs/`
on `overdeck-state` (on disk: `${OVERDECK_HOME}/state/<project>/specs/`) and **do not move between directories** — status is tracked via the `plan.status`
field inside each JSON file. See [XBRIEF.md](./XBRIEF.md) for the full format and lifecycle
reference.

```
state-worktree/  (overdeck-state branch)
├── specs/
    │   ├── 2026-05-01-PAN-960-foo.xbrief.json     (status: "proposed")
    │   ├── 2026-04-28-PAN-714-bar.xbrief.json     (status: "active")
    │   └── 2026-04-20-MIN-846-baz.xbrief.json     (status: "completed")
└── drafts/
        └── PAN-970-next-thing.md                   PRD being refined
```

**Key points:**
- Filenames are issue-keyed: `YYYY-MM-DD-<ISSUE-ID>-<slug>.xbrief.json`
- The date prefix is the immutable creation date (UTC)
- Files never move — `plan.status` field transitions: `draft → proposed → active → completed` (or `cancelled`)
- Continue state lives in the workspace at `.overdeck/continue.json`, not alongside the canonical spec

### PRDs vs xBRIEFs

These are complementary, not competing artifacts:

| Artifact | Author | Format | Location | Purpose |
|----------|--------|--------|----------|---------|
| **PRD** | Human | Markdown | `drafts/` on `overdeck-state` | Requirements, intent, context — input to planning |
| **xBRIEF** | Agent (Opus) | JSON | `specs/` on `overdeck-state` | Structured operational plan — output of planning |

PRDs are human-authored Product Requirement Definitions that describe *what* to build and
*why*. Canonical drafts live in `drafts/` on `overdeck-state`.

xBRIEFs are machine-readable operational artifacts that describe *how* to build it — with
acceptance criteria, dependency DAGs, and status tracking. They live in `specs/` on
`overdeck-state` with field-based status transitions (files never move between directories).

The planning agent reads the PRD (if one exists) as input and produces an xBRIEF plan as output.

---

## Workspace Runtime — `.overdeck/` (feature workspace)

```
project-repo/  (feature workspace)
└── .overdeck/
    ├── continue.json        Mutable session state and xBRIEF statusOverrides
    ├── context.md           Workspace context for agents
    ├── sessions.jsonl       Append-only session history
    └── review/              Specialist feedback (review-agent, test-agent)
```

Workspace runtime files are local and gitignored. The canonical xBRIEF remains in `specs/` on `overdeck-state`; work agents and the dashboard read it through `findPlan()`, and `.overdeck/continue.json` overlays item and sub-item status without mutating the spec.

Older workspace plan filenames remain readable for compatibility, but they are not canonical state or current write targets. See the [xBRIEF migration note](./XBRIEF.md) for the exact legacy surfaces.

### Continue State

The workspace continue file stores the current resume point, decisions, hazards, session history, and xBRIEF `statusOverrides`. Project-side durable continue state lives separately in `continues/<issue>.xbrief.json` on `overdeck-state`.

See [xBRIEF Continue State](./XBRIEF.md#continue-state--structured-session-history) for the full schema.

---

## Runtime Output Directories

Some Overdeck features write transient output into the project workspace during agent
runs. These live under `.pan/` to keep the project root clean:

| Path | Written by | Contents |
|------|-----------|----------|
| `.pan/events/` | Cost WAL | Per-issue cost event logs (`<issue-id>.jsonl`) |
| `.overdeck/review/` | Review agents | Parallel review output |
| `.pan/prompts/` | Remote agents | VM-side agent prompt files |

These directories are **gitignored** — they are runtime state, not repo artifacts.
Add to `.gitignore`:

```
.pan/events/
.overdeck/review/
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
├── .overdeck/                     Gitignored workspace runtime state
│   ├── continue.json              Session state and xBRIEF statusOverrides
│   └── review/                    Specialist feedback
├── src/                           Implementation files

${OVERDECK_HOME}/state/<project>/  Dedicated overdeck-state worktree
├── specs/
│   └── YYYY-MM-DD-ID-slug.xbrief.json
├── continues/
│   └── issue-id.xbrief.json
├── drafts/
│   └── issue-id.md
└── records/
    └── issue-id.json
├── CLAUDE.md / AGENTS.md          Optional user-owned harness instructions
├── docs/
│   └── prds/
│       ├── active/                Human-authored PRDs for active work
│       ├── planned/               Pre-work PRDs
│       └── completed/             Archived PRDs
└── .gitignore                     Must include .pan/events/, .overdeck/review/, .pan/prompts/
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
| Issue archives (runtime) | `~/.overdeck/archives/<issue>/` | Closed-issue runtime state backup (agent dirs, logs). Scope xBRIEFs remain in `specs/` with `status: "completed"`. |
| Traefik config | `~/.overdeck/traefik/` | Infrastructure, not project content |
| Cost database | `~/.overdeck/panopticon.db` | Aggregated across all projects |
| Shadow state | `~/.overdeck/shadow-state/` | Derived from tracker, not authoritative |
