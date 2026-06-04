# Project Setup Wizard — Dashboard UI

> **Companion to:** [`project-setup-wizard.md`](./project-setup-wizard.md) (PAN-574)
>
> This PRD specifies the full-blown dashboard surface for project setup: what it looks like, how it drives the setup pipeline, the ways a user can create a new project (including the sidebar `+`), and how the Setup Agent is presented as a first-class agent inside the dashboard.

---

## ⚠️ Status correction (2026-05-30 staleness pass)

This PRD was originally written as a "Phase 4 / dashboard front-end" companion to a CLI wizard that was assumed shipped. **That assumption is wrong.** An audit of what PAN-574 actually merged found:

- **PAN-574 (PR #588) shipped documentation only** — 10 files, all `.mdx`/`.md` (`configuration/setup-wizard.mdx`, `meta-repos.mdx`, `progressive-polyrepo.mdx`, updates to `projects.mdx`/`issue-trackers.mdx`/`INDEX.md`). The docs describe a wizard, templates, and a Setup Agent that **do not exist in code**.
- **There is no `pan setup` command.** The only `setupCommand` in the tree is `src/cli/commands/remote/setup.ts` (Fly remote setup, unrelated). `src/cli/commands/setup/` contains only `hooks.ts` and `safe-settings.ts`.
- **There is no `src/lib/setup/`**, no detection module, no template archetypes (`simple-app` / `monorepo` / `polyrepo` / `progressive-polyrepo` do not exist as templates), and **no Setup Agent** (`setup-agent` kind / `spawnSetupSession` appear nowhere in `src/`).
- **Project creation today is just `pan project add <path>`** (the path must already exist on disk) plus `pan project init` (writes an example `projects.yaml`). See `src/cli/commands/project.ts`.

**Consequences for this PRD:**

1. The work is **entirely net-new**, not an extraction. "Phase 1 — Backend extraction" is renamed **"Phase 1 — Build the setup pipeline"** — we build `src/lib/setup/` from scratch. The existing `configuration/setup-wizard.mdx` doc serves as a behavioral spec, but no code backs it yet.
2. To make the already-shipped docs honest, this issue **also delivers a thin `pan setup` CLI** that wraps the new `src/lib/setup/` pipeline (the docs already tell users it exists). CLI and dashboard remain two front-ends over one pipeline.
3. The permission model has changed since the doc was written — the Setup Agent spawns under **`--permission-mode auto`** by default, not `--dangerously-skip-permissions` (see Architecture → Setup Agent).

---

## Problem

`pan setup` works on the CLI, but the dashboard is the primary surface for everything else in Panopticon (kanban, agent terminals, planning, costs, health). New users who land on the dashboard hit a dead end: there's no way to add a project, no way to see what projects exist, no way to edit a project's config without dropping to YAML, and no visibility into the Setup Agent while it runs.

This is a serious adoption blocker:

1. **First-run cliff.** A user installs Panopticon, runs `pan up`, opens the dashboard, and... sees nothing. There's no project, no kanban, no agents. The "create your first project" moment lives in a CLI command they didn't know to run.
2. **No dogfooding loop.** We have a CLAUDE.md rule that says "always dogfood the dashboard, never curl APIs manually." But for project creation we ourselves drop to the CLI because the dashboard can't do it.
3. **Setup Agent is invisible.** The Setup Agent spawns in tmux like a planning agent, but unlike planning agents it has no row in the agent list, no terminal panel, no progress events. Users running `pan setup` from the CLI literally cannot see the agent's reasoning except by tmux-attaching.
4. **Editing is YAML-only.** Once a project exists, changing branch names, adding repos, toggling specialists, configuring quality gates, or rotating tracker config means opening `~/.panopticon/projects.yaml` in a text editor. Every Panopticon power-user has corrupted this file at least once.
5. **Multi-project teams have no overview.** A user with 5 projects (Panopticon, MYN, Auricle, Krux, etc.) has no place in the dashboard to see them side-by-side, see which is healthy, jump between them, or trigger setup re-runs.

The CLI wizard is a faithful onboarding tool for terminal-native users, but Panopticon's identity is the dashboard. This feature has to live there too.

## Goals

1. **First-run flow that doesn't require the CLI.** A user who opens the dashboard with no projects configured sees a welcome screen with a "Set up your first project" button that opens the wizard inline.
2. **Multiple, obvious entry points to create a project.** The wizard is reachable from (a) the first-run welcome, (b) a **`+` button on the PROJECTS header in the left sidebar** (the primary, always-visible affordance), (c) a "+ New project" tile on the `/projects` list page, and (d) the CLI (`pan setup`). All four open the same wizard / drive the same pipeline.
3. **Every way of pointing at code is supported.** A new project can be created from any of four sources: an existing git repo on disk, a plain folder on disk (not yet a repo), a remote repo to clone (GitHub / GitLab / arbitrary git URL), or a brand-new project where the wizard creates the folder and — highly recommended — initializes a git repo (and optionally creates+pushes a remote).
4. **Full feature parity across front-ends.** Every prompt, every detection step, every template choice, every Setup Agent invocation is reachable from both the dashboard and `pan setup`. CLI and UI are two front-ends for the same backend pipeline.
5. **The Setup Agent is a first-class agent.** It appears in the agent list, has a terminal panel, streams progress events through the existing RPC, and supports the same lifecycle controls (stop, restart, view logs) as planning agents.
6. **Project management lives in the dashboard.** A "Projects" page lists every configured project, shows health, lets the user edit config visually, re-run setup, and remove projects.
7. **Edits round-trip safely.** Anything edited in the UI writes valid YAML to `~/.panopticon/projects.yaml` with the same schema validation the CLI uses. Anything edited in YAML is reflected in the UI on next load.
8. **Dogfoodable.** We can use the dashboard wizard to onboard a new project end-to-end — including cloning a remote repo or creating a brand-new one — without ever opening a terminal.

## Non-goals

- **Replacing the CLI wizard.** `pan setup` continues to exist for terminal-only environments, scripting, and CI. The two share a backend; the CLI is not deprecated.
- **A general project YAML editor.** We are not building a YAML schema editor for arbitrary fields. The UI exposes the same field set the CLI prompts for; everything else is "advanced — edit YAML directly" with a button that opens the file in the user's editor.
- **Re-implementing template selection logic.** Templates remain server-side. The UI renders cards for whatever templates the backend reports.
- **Mobile / small-screen support.** The dashboard isn't responsive today and this PRD doesn't change that.
- **Cross-team template sharing UX.** Meta-repo template publishing is mentioned in the original PRD as a future capability; the UI surfaces locally-resolved templates only.

---

## User Stories

### US-1 — First project (zero state)
*As a new user who just installed Panopticon and opened the dashboard, I want to be guided to create my first project without leaving the browser.*

**Acceptance:** Dashboard with no projects configured shows a welcome screen with a single primary action ("Set up your first project") that opens the wizard. The wizard walks me through detection, template selection, tracker, meta repo, and review. On save, the dashboard transitions to the normal kanban view scoped to my new project.

### US-2 — Second project (existing user) via the sidebar `+`
*As a user who already has Panopticon running for one project, I want to add another straight from the sidebar without hunting through menus.*

**Acceptance:** The left-sidebar **PROJECTS section header shows a `+` button**. Clicking it opens the wizard (`/projects/new`). The same wizard is also reachable from a "+ New project" tile on the `/projects` list page. On save, the project appears in the sidebar tree and the project switcher.

### US-2b — Create from an existing repo or folder on disk
*As a user, I want to point the wizard at code already on my machine — whether it's a git repo or just a folder.*

**Acceptance:** The wizard's Source step offers "Existing repo or folder on this computer" with a folder picker. If the chosen path (or its subdirectories) contains git repos, they're detected and pre-filled. If it's a plain folder with no `.git`, the wizard still proceeds and offers to `git init` it during setup (recommended, not forced).

### US-2c — Clone a remote repo (GitHub / GitLab / git URL)
*As a user onboarding a project whose code lives on GitHub but isn't on my machine yet, I want the wizard to clone it for me.*

**Acceptance:** The Source step offers "Clone from a remote". I paste a GitHub/GitLab URL (or `owner/repo` shorthand) or pick from my `gh`-authenticated repos, choose a destination directory, and the wizard clones it (streaming progress), then runs detection on the clone. Auth uses the existing `gh`/git credentials on the host; no new credential store.

### US-2d — Brand-new project (create folder + repo)
*As a user starting something from scratch, I want Panopticon to create the project folder and set up git for me.*

**Acceptance:** The Source step offers "Start a brand-new project". I name it and pick a parent directory; the wizard creates the folder, **strongly recommends and defaults to `git init` + an initial commit**, and optionally creates a remote (GitHub via `gh repo create`, or a URL I provide) and pushes. Declining the repo is allowed but the UI nudges toward creating one.

### US-3 — Watch the Setup Agent work
*As a user running the wizard with a 30-repo polyrepo, I want to see the Setup Agent's progress in real time.*

**Acceptance:** When I opt into the Setup Agent step, a terminal panel opens beside the wizard showing the agent's tmux session live. Below the terminal, a structured event log shows phases ("Scanning repos", "Reading READMEs", "Generating CLAUDE.md", "Done"). I can stop the agent and continue without it, or wait and review its output before saving.

### US-4 — Review generated docs
*As a user, after the Setup Agent finishes, I want to review what it generated before it's written to my meta repo.*

**Acceptance:** The wizard's "Review" step shows generated files (CLAUDE.md, repo-map.md, repo-groups.yaml, onboarding/checklist.md) in a tabbed file viewer. I can edit each file inline (Monaco editor), reject individual files, or accept all. Only accepted files are written.

### US-5 — Edit an existing project's config
*As a user, I want to change my project's PR target branch from `main` to `qa` without editing YAML.*

**Acceptance:** From the project list, I click a project to open its detail page. A "Configuration" tab shows the same form fields the wizard used, pre-filled with current values. I change the field and click "Save". The change is written to `projects.yaml` and reflected in subsequent workspace creates.

### US-6 — Re-run setup after adding repos
*As a user who just cloned 3 new repos into my polyrepo project directory, I want the dashboard to detect them and offer to add them.*

**Acceptance:** The project detail page has a "Re-detect repos" button. Clicking it re-runs the detection step and shows a diff: "3 new repos found, 0 removed." I can accept all, accept some, or cancel. Accepted repos are merged into the existing config.

### US-7 — Remove a project
*As a user, I want to remove a project I no longer use.*

**Acceptance:** Project detail page has a "Remove project" action behind a destructive confirmation. Removing the project deletes its `projects.yaml` entry but leaves the repos and meta repo on disk untouched.

### US-8 — Dogfood through the dashboard
*As a Panopticon developer, I want every wizard interaction to go through the dashboard so I can catch UI bugs as I work.*

**Acceptance:** I can onboard a brand-new project end-to-end without running `pan setup`. The dashboard wizard hits the same backend code paths and produces a byte-identical `projects.yaml` entry to the CLI version.

---

## Architecture

### High-level shape

The setup backend does not exist yet (see Status correction). We **build** `src/lib/setup/` as a reusable service, expose it over the existing Effect RPC layer for the dashboard, and add a thin `pan setup` CLI that wraps the same lib so the already-shipped docs become accurate. Neither front-end reaches into the other; both call the lib.

```
┌──────────────────────────┐         ┌──────────────────────────┐
│  CLI (pan setup) — NEW   │         │  Dashboard (wizard UI)   │
│  src/cli/commands/       │         │  WizardFlow.tsx          │
│    setup-wizard.ts       │         │                          │
└──────────┬───────────────┘         └──────────┬───────────────┘
           │                                    │
           │  same in-process API               │  Effect RPC
           │  (function call)                   │  (SetupRpcGroup.*)
           ▼                                    ▼
        ┌─────────────────────────────────────────────┐
        │  src/lib/setup/  (NET-NEW, built here)      │
        │   • source.ts        — resolve repo source  │
        │   • clone.ts         — clone remote repo    │
        │   • init-repo.ts     — git init + remote    │
        │   • detect.ts        — repo scanning        │
        │   • templates.ts     — template loading     │
        │   • config-builder.ts— state → YAML         │
        │   • spawn-setup-session.ts — Setup Agent    │
        │   • write-config.ts  — projects.yaml IO     │
        └─────────────────────────────────────────────┘
                              │
                              ▼
                 ~/.panopticon/projects.yaml
```

The CLI wrapper uses `inquirer`-style prompts but delegates every business operation to `src/lib/setup/`. The dashboard never reaches into `src/cli/`; both call the lib. Because no CLI logic exists to preserve, the "byte-identical YAML" invariant is enforced from day one rather than after an extraction.

### Repo source resolution

Every project starts by resolving a **source** into a local project directory before detection runs. `src/lib/setup/source.ts` defines four kinds:

| Source kind | Input | Action before detection |
|---|---|---|
| `existing-repo` | a path on disk that is (or contains) git repos | none — detection runs in place |
| `existing-folder` | a path on disk with no `.git` | proceed; offer `git init` during the Repo step (recommended) |
| `clone-remote` | a GitHub/GitLab/git URL or `owner/repo` shorthand + destination dir | `clone.ts` clones via the host's `git`/`gh` credentials (streaming progress), then detection runs on the clone |
| `new-project` | a project name + parent dir | `init-repo.ts` creates the folder; defaults to `git init` + initial commit; optionally `gh repo create` (or a provided remote URL) + push |

Source resolution is a distinct, streamable concern (clone can take a while) and is the first real step of the wizard. `clone.ts` and `init-repo.ts` are async-only (no `execSync` — server-reachable) and shell out to `git`/`gh` via `execAsync`/`spawn`.

### Why RPC, not REST

Every other dashboard server feature uses Effect RPC over `/ws/rpc`. Wizard steps need to stream progress (repo detection on a 50-repo polyrepo can take 30s; the Setup Agent runs for minutes), so a streaming RPC is the right primitive. We add a new RPC group `SetupRpcGroup` to `packages/contracts/` with these procedures:

| Procedure | Type | Purpose |
|---|---|---|
| `resolveSource` | unary | Validate a chosen source (path / URL / new-project name) and report what will happen (clone, init, detect-in-place). |
| `cloneRemote` | streaming | Clone a remote repo to a destination dir. Streams clone progress. Cancellable. |
| `scaffoldProject` | streaming | Create a brand-new project: mkdir, optional `git init` + initial commit, optional `gh repo create` + push. Streams progress. |
| `detectRepos` | unary | Scan a directory, return `DetectedRepo[]`. |
| `listTemplates` | unary | Return all available templates with metadata for card rendering. |
| `previewConfig` | unary | Take wizard state, return YAML preview as a string for the Review step. |
| `validateConfig` | unary | Validate wizard state against the projects.yaml schema, return field-level errors. |
| `spawnSetupAgent` | streaming | Spawn the Setup Agent. Streams `SetupAgentEvent` (phase changes, file writes, completion). Cancellable. |
| `readGeneratedFiles` | unary | After the Setup Agent finishes, read generated meta-repo files for the Review step. |
| `commitProject` | unary | Atomically write the new project to `projects.yaml`, accept generated files into the meta repo, and emit a `ProjectAdded` domain event. |
| `listProjects` | unary | Return all configured projects with health summary. |
| `getProject` | unary | Return one project's full config plus current detection state. |
| `updateProject` | unary | Patch a project's config from the visual editor. |
| `redetectProject` | streaming | Re-run detection on an existing project, stream a diff. |
| `removeProject` | unary | Remove a project from `projects.yaml`. |

All schemas live in `packages/contracts/src/setup.ts` so the CLI can also import them — useful for keeping the CLI's in-memory state shape aligned with the wire format.

### Backend pipeline (net-new)

There is no existing `src/cli/commands/setup.ts` to extract from — `pan setup` was never implemented (only its docs shipped). We build the lib from scratch:

```
src/lib/setup/
├── source.ts              # resolveSource() — classify existing-repo/folder/clone/new
├── clone.ts               # cloneRemote() — git/gh clone, async-only, streamed
├── init-repo.ts           # scaffoldProject() — mkdir + git init + optional remote
├── detect.ts              # detectRepos(), branch detection, language detection
├── templates.ts           # loadTemplate(), listTemplates(), applyTemplate()
├── config-builder.ts      # stateToYaml(), validateState(), mergeAnswers()
├── spawn-setup-session.ts # spawnSetupSession() — Setup Agent tmux launcher
├── setup-agent-events.ts  # event types streamed from setup agent
├── write-config.ts        # atomic writes to projects.yaml
└── index.ts               # exports
```

A new `src/cli/commands/setup-wizard.ts` (registered as `pan setup`) is a thin wrapper: `inquirer` for prompts, calls into `src/lib/setup/` for everything else. The existing `pan project add` continues to work (it becomes the "register a path I already prepared" fast-path; `pan setup` is the guided flow).

**Async-only constraint.** Because these modules are called from the dashboard server (which must never block the event loop), all filesystem and git operations use `fs/promises` and `execAsync`/`spawn` — never sync FS or `execSync`. This is a hard rule for the whole lib, not just the parts the server touches, so there is one code path.

### Setup Agent as a first-class agent

The Setup Agent is modeled on the planning agent: a Claude Code session in a tmux session on the `panopticon` socket. It does not exist yet — we build it here alongside the dashboard plumbing. It is spawned through the standard launcher, which means it inherits the project-wide permission model: **`--permission-mode auto` by default** (Claude Code's built-in classifier blocks destructive ops), with `--dangerously-skip-permissions --permission-mode bypassPermissions` only when the user has opted into `bypass` (`PAN_YOLO=true` or `claude.permissionMode: bypass`). See `src/lib/claude-permissions.ts` — the wizard must **not** hardcode a permission flag; it goes through the same resolution path as every other agent. We treat it exactly like a planning agent:

1. **Agent record.** When the wizard spawns the Setup Agent, a row is inserted in the agents table with `kind: 'setup-agent'`. The dashboard's `AgentList.tsx` already iterates over agent kinds; we add a filter chip for "Setup".
2. **Terminal streaming.** The Setup Agent's tmux session is reachable at `/ws/terminal?session=<setup-session-name>` via the existing raw WebSocket terminal endpoint (`ws-terminal.ts`). No new code path — the wizard component just opens an `XTerminal` pointed at the right session name.
3. **Progress events.** The agent writes structured progress to a JSONL file in `~/.panopticon/agents/<id>/setup-progress.jsonl`. A file watcher in `src/dashboard/server/services/` tails this file and emits `SetupAgentEvent` over `subscribeDomainEvents`. The wizard's progress panel subscribes via the existing event router.
4. **Lifecycle controls.** Stop / restart / done all reuse the planning-agent equivalents. The Setup Agent's session is configured with `remain-on-exit on` so the user can review its terminal output even after it finishes.

This means the Setup Agent inherits everything we already built for planning: cost tracking, health monitoring, the inspector panel, the run log, the budget widget. Zero net-new agent infrastructure.

### Dashboard surfaces

Three new surfaces:

1. **`/projects`** — Project list page. Card grid of all configured projects.
2. **`/projects/new`** — Wizard entry point. Multi-step inline form, not a modal (the wizard is too tall and the Setup Agent step needs the full canvas).
3. **`/projects/:projectKey`** — Project detail page. Tabs: Overview, Configuration, Repos, Quality Gates, Setup History, Danger Zone.

We also wire two more entry points:

4. **First-run welcome** at `/` when zero projects exist. A simple full-screen card that points to `/projects/new`. This is an empty-state, not a separate route — the existing root route just renders this when `useProjectStore().projects.length === 0`.
5. **Sidebar `+` button.** The left sidebar (`src/dashboard/frontend/src/components/CommandDeck/index.tsx`) renders a collapsible PROJECTS/Issues section with a `sectionHeader` (around line 1061). We add a small `+` icon button to that header — the always-visible, primary affordance for creating a project. It mirrors the existing `handleNewProjectConversation` `+`-style pattern and navigates to `/projects/new`. Clicking the `+` must not toggle the section collapse (stop propagation on the header's `onClick`).

### Wizard state model

The wizard is a multi-step form with branching based on detected project type and selected template. State is held in a Zustand store (consistent with the rest of the dashboard) and persisted to `localStorage` so a refresh mid-wizard doesn't lose progress.

```typescript
// src/dashboard/frontend/src/stores/wizardStore.ts
interface WizardStore {
  currentStep: WizardStep;
  state: SetupState;             // mirrors src/lib/setup/state
  detection: {
    status: 'idle' | 'running' | 'done' | 'error';
    repos: DetectedRepo[];
    error?: string;
  };
  templates: Template[];
  setupAgent: {
    status: 'idle' | 'spawning' | 'running' | 'done' | 'cancelled' | 'error';
    sessionId?: string;
    progress: SetupAgentEvent[];
    generatedFiles?: GeneratedFile[];
  };
  validationErrors: Record<string, string>;
  // actions
  goto(step: WizardStep): void;
  detect(path: string): Promise<void>;
  selectTemplate(name: string): void;
  spawnSetupAgent(): Promise<void>;
  cancelSetupAgent(): Promise<void>;
  acceptFile(path: string, content: string): void;
  rejectFile(path: string): void;
  commit(): Promise<void>;
}
```

The store calls into the RPC client (`WsTransport`) and feeds events from the RPC stream into local state. On `commit()` success, it clears `localStorage` and navigates to `/projects/:projectKey`.

---

## UX Specification

### Wizard layout

The wizard is a single full-page route at `/projects/new` with a fixed left rail (step list) and a scrollable right panel (current step content). At the bottom of the right panel: Back, Next, Cancel buttons. The Setup Agent step (Step 6) splits the right panel vertically: top half is the agent's terminal, bottom half is the progress event log.

```
┌──────────────────────────────────────────────────────────────────┐
│ Header: ← Back to Projects     Set up a new project              │
├──────────┬───────────────────────────────────────────────────────┤
│ Steps    │  Step content                                          │
│          │                                                        │
│ ✓ Src.   │  Project Type Detection                                │
│ ✓ Type   │  ────────────────────                                  │
│ ● Tmpl   │  Found 31 git repositories under /home/eltmon/Projects│
│   Repos  │  /HS                                                   │
│   Track  │                                                        │
│   Setup  │  Detected: Polyrepo (multiple independent git repos)   │
│   Review │                                                        │
│          │  ○ Simple app                                          │
│          │  ○ Monorepo                                            │
│          │  ● Polyrepo                                            │
│          │  ○ Progressive polyrepo (recommended for 30+ repos) ★  │
│          │                                                        │
│          │  [ Next → ]                                            │
└──────────┴───────────────────────────────────────────────────────┘
```

### Steps

| # | Name | Notes |
|---|---|---|
| 1 | **Source** | Choose how to bring in the code, then resolve it to a local path. Four radio options: **(a) Existing repo or folder on this computer** — folder picker (reuses the native picker we already have for workspace paths); **(b) Clone from a remote** — text field for a GitHub/GitLab URL or `owner/repo` shorthand, optional pick-from-`gh`-repos list, plus a destination dir; **(c) Start a brand-new project** — name + parent dir, with a checked-by-default "Initialize a git repo" toggle and an optional "Create remote (GitHub via `gh`, or paste a URL) and push"; **(d)** the path defaults to `~/Projects/<basename>`. On Next: for clone, calls `cloneRemote` (streaming progress); for new-project, calls `scaffoldProject` (streaming progress); then all kinds call `detectRepos` and show a spinner. A plain folder with no `.git` is allowed and surfaces a "this folder isn't a git repo yet — initialize one? (recommended)" prompt carried into Step 4. |
| 2 | **Type** | Shows detection result. User can override the detected type. Each type has a one-line "best for" caption. |
| 3 | **Template** | Card grid of templates returned by `listTemplates`. Each card: name, description, "recommended" badge if matching detection heuristics. Selecting a card loads the template's prompt schema for Step 4. |
| 4 | **Repos** | Shows detected repos in a sortable table: name, path, default branch, language, has-tests, has-CI. Inline editable per row. "Group repos" button opens a side panel where the user can drag repos into named groups (groups become `repo-groups.yaml`). |
| 5 | **Tracker** | Tracker selector (Linear, GitHub, Rally, GitLab, None). Each option expands to its config fields. Linear: team prefix + API key (read from `~/.panopticon.env` if present, otherwise prompt). GitHub: org/repo, App credentials. Rally: project name, artifact types. |
| 6 | **Setup Agent** | Optional. Toggle: "Spawn Setup Agent to analyze the codebase and generate docs." If on, shows a "Spawn agent" button. Clicking spawns the agent and the right panel splits into terminal (top) + event log (bottom). Cancel anytime. |
| 7 | **Review** | YAML preview (Monaco, read-only) of `projects.yaml` entry. Tabs for generated files if Setup Agent ran. Per-file accept/reject. "Open in editor" button for the YAML escape hatch. |
| 8 | **Save** | Final confirm. Shows what will be written and where. "Save project" commits via `commitProject` RPC. On success, redirects to project detail. |

The CLI's flow has 7 steps; ours adds an explicit Save step because dashboard users expect a "you are about to commit changes" confirmation (versus the CLI's implicit "press Y at the prompt").

### Project list page (`/projects`)

A card grid. Each project card:

- Project name + key
- Type badge (simple-app / monorepo / polyrepo / progressive-polyrepo)
- Repo count
- Tracker badge (Linear / GitHub / Rally / etc.)
- Health indicator (green/yellow/red dot driven by the existing health service)
- "Last activity" timestamp
- Three actions: Open kanban, Edit config, Remove

A "+ New project" tile in the top-left of the grid opens the wizard.

The currently-active project (whichever the user has selected in the global project switcher) gets a subtle highlight border.

### Project detail page (`/projects/:projectKey`)

Tabs along the top:

1. **Overview** — Stats: workspace count, agent count, recent activity, health timeline (reuse `HealthHistoryChart`).
2. **Configuration** — Same form as wizard Steps 4–5, pre-filled. Save button writes via `updateProject`. Form is dirty-tracked.
3. **Repos** — Same table as wizard Step 4. "Re-detect repos" button at the top right runs the streaming `redetectProject` RPC and shows a diff dialog.
4. **Quality Gates** — Edit `quality_gates` config: typecheck command, lint command, test command, per-repo overrides.
5. **Setup History** — Timeline of Setup Agent runs for this project. Each entry: timestamp, agent ID (clickable to the agent detail view), status, files generated. Lets the user re-run the agent without re-running the whole wizard.
6. **Danger Zone** — Remove project button with destructive confirmation matching `DeepWipeDialog`'s pattern (typed confirmation).

### First-run welcome

When `useProjectStore().projects.length === 0`, the root route renders a full-screen card instead of the kanban:

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│              Welcome to Panopticon                        │
│                                                          │
│   Panopticon orchestrates AI agents across your          │
│   projects. To get started, set up your first project.   │
│                                                          │
│              [ Set up a project → ]                      │
│                                                          │
│   Or if you prefer the terminal:                         │
│              $ pan setup                                 │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

No tour, no checklist, no marketing fluff. One button.

### Setup Agent in the agent list

The existing `AgentList.tsx` filters agents by kind. We add a `setup-agent` kind to the filter chips. When a Setup Agent is running, it appears in the list with the same row layout as a planning agent. Clicking the row opens `AgentDetailView` with the terminal panel pointed at the setup session. The same Stop / Recover / View Cost actions work without modification because the agent record has the same shape.

---

## Detailed flows

### Flow A — First-run

1. User runs `pan up`, opens `https://localhost:3001`.
2. Dashboard loads. `getSnapshot` RPC returns zero projects.
3. Root route renders the first-run welcome.
4. User clicks "Set up a project". Router pushes `/projects/new`.
5. Wizard mounts with `currentStep: 'source'`, source kind defaulting to "Existing repo or folder", path defaulting to `~/Projects`.
6. User picks a directory, clicks Next. `detectRepos` RPC runs, shows a spinner. Result populates `wizardStore.detection`.
7. Wizard advances to Step 2, shows detected type. User accepts.
8. Step 3: Template grid. User picks `polyrepo`.
9. Step 4: Repo table. User edits one branch from `master` to `main`.
10. Step 5: Tracker. User picks GitHub, enters org/repo. Credentials read from env.
11. Step 6: User toggles Setup Agent on, clicks Spawn. Agent terminal opens. Events stream. After 4 minutes, agent signals done. Wizard advances.
12. Step 7: User reviews YAML and generated files. Accepts CLAUDE.md and repo-map.md, rejects repo-groups.yaml (wants to write it manually).
13. Step 8: Save. `commitProject` RPC writes `projects.yaml`, copies accepted files into the meta repo, emits `ProjectAdded`.
14. Dashboard navigates to `/projects/myproject`. Project switcher in the header shows the new project. Kanban is empty until the user files an issue.

### Flow B — Adding a second project (sidebar `+`)

User clicks the **`+` on the sidebar PROJECTS header** (or the "+ New project" tile on `/projects`). Router pushes `/projects/new`. The rest is identical to Flow A. The project switcher and sidebar tree show both projects at the end.

### Flow B2 — Clone a remote repo

1. User opens the wizard, Step 1 Source, picks "Clone from a remote".
2. User pastes `eltmon/krux` (or a full GitHub/GitLab URL) and accepts the default destination `~/Projects/krux`.
3. On Next, `cloneRemote` streams clone progress into the step (line-by-line `git clone` output). Auth uses the host's existing `gh`/git credentials.
4. On clone success, `detectRepos` runs on the clone and the wizard advances to Step 2 with detection pre-filled.
5. Remainder identical to Flow A.

### Flow B3 — Brand-new project with repo init

1. User picks "Start a brand-new project", names it `widget`, parent dir `~/Projects`. "Initialize a git repo" is checked by default.
2. User also checks "Create GitHub remote and push" (uses `gh repo create`).
3. On Next, `scaffoldProject` streams: `mkdir ~/Projects/widget` → `git init` → initial commit → `gh repo create eltmon/widget --source . --push`.
4. `detectRepos` runs (finds the freshly-initialized repo), wizard advances. Remainder identical to Flow A.
5. If the user had *unchecked* git init, the wizard still proceeds but Step 4 shows a persistent "this project has no git repo — agents need one to create feature branches" warning.

### Flow C — Editing branch config

1. User clicks "Projects" in the global nav.
2. Project list renders. User clicks the MYN card.
3. Project detail page mounts on the Overview tab.
4. User clicks Configuration tab. Form renders pre-filled.
5. User changes `pr_target` from `main` to `qa`. Form is dirty.
6. User clicks Save. `updateProject` RPC writes the change.
7. Toast: "Project updated." Form returns to clean state.
8. Next workspace creation uses the new config.

### Flow D — Re-detecting repos

1. User cloned 3 new repos into the project directory yesterday.
2. From project detail, user clicks Repos tab, then "Re-detect repos".
3. `redetectProject` RPC runs as a stream, emitting per-repo events.
4. UI shows a progress bar with current repo name.
5. On completion, a diff dialog opens: "+ 3 added, ~ 0 changed, − 0 removed."
6. User accepts. New repos merge into the project config.

### Flow E — Killing a stuck Setup Agent

1. User spawned the Setup Agent at Step 6. After 10 minutes it appears stuck.
2. User clicks Stop in the wizard's agent panel. `cancelSetupAgent` action calls the existing `stopAgent` RPC with the setup session ID.
3. Agent stops. Wizard offers two choices: "Continue without agent (skip generated files)" or "Retry agent".
4. User picks Continue. Wizard advances to Step 7 with no generated files.

---

## Implementation Plan

Phased so each phase ships value, but per CLAUDE.md "deliver complete features," all phases are required for the issue to close.

### Phase 1 — Build the setup pipeline (net-new)

- Create `src/lib/setup/` modules from scratch: `source.ts`, `clone.ts`, `init-repo.ts`, `detect.ts`, `templates.ts`, `config-builder.ts`, `write-config.ts` (Setup Agent lands in Phase 4). All async-only — `fs/promises` + `execAsync`/`spawn`, no sync FS, no `execSync`.
- Define the template archetypes that the docs already describe but that don't exist yet: `simple-app`, `monorepo`, `polyrepo`, `progressive-polyrepo`.
- Add `SetupRpcGroup` schemas to `packages/contracts/src/setup.ts` (including `resolveSource`, `cloneRemote`, `scaffoldProject`).
- Implement RPC handlers in `src/dashboard/server/routes/setup.ts`.
- Build the new `pan setup` CLI (`src/cli/commands/setup-wizard.ts`) as a thin wrapper over the lib, so the shipped `configuration/setup-wizard.mdx` docs become accurate. Register it in `src/cli/index.ts`.
- Tests: every lib module has unit tests; clone/scaffold tested against temp dirs; CLI smoke test for `pan setup`.

### Phase 2 — Project list & detail pages (no wizard yet)

- Add `/projects` route with list UI.
- Add `/projects/:projectKey` route with Overview, Configuration, Repos, Quality Gates, Danger Zone tabs.
- Implement `listProjects`, `getProject`, `updateProject`, `removeProject` handlers.
- "Re-detect repos" with diff dialog.
- Project switcher in the global header reads from `listProjects`.

### Phase 3 — Wizard UI (without Setup Agent)

- Add `/projects/new` route with `WizardFlow.tsx`.
- Implement steps 1–5, 7, 8 (everything except the Setup Agent step).
- **Step 1 Source** with all four kinds: existing-repo/folder picker, clone-from-remote (streams `cloneRemote`), brand-new project (streams `scaffoldProject`, git-init checked by default).
- **Sidebar `+` entry point** on the CommandDeck PROJECTS header → `/projects/new` (stop propagation so it doesn't toggle collapse). Plus the "+ New project" tile on `/projects`.
- `wizardStore` with localStorage persistence.
- Detection step uses `detectRepos`; clone/scaffold use their streaming RPCs.
- Review step uses `previewConfig` and renders Monaco read-only.
- Commit step uses `commitProject`.

### Phase 4 — Setup Agent integration

- Add `setup-agent` kind to the agent registry and `AgentList` filter.
- Implement `spawnSetupAgent` streaming RPC.
- File watcher in `src/dashboard/server/services/setup-agent-events.ts` tails the JSONL progress file.
- Wizard step 6 splits panel, opens terminal at the setup session.
- Setup History tab on project detail page.

### Phase 5 — First-run welcome

- Detect zero-project state in the root route.
- Render welcome card. Wire button to `/projects/new`.
- Dogfood: tear down the local `projects.yaml`, run `pan up`, complete onboarding entirely from the browser.

### Phase 6 — Polish

- Empty states for every list/table.
- Validation errors inline on every form field.
- Keyboard navigation through wizard steps (Tab, Enter for Next, Shift+Tab for Back).
- Loading states for every RPC call.
- Error states with retry buttons.
- Toast notifications for every commit/update/delete.

---

## Files to Create

| File | Purpose |
|---|---|
| `packages/contracts/src/setup.ts` | RPC schemas: `SetupRpcGroup`, `SetupState`, `DetectedRepo`, `Template`, `SetupAgentEvent`, `GeneratedFile`. |
| `src/lib/setup/index.ts` | Public exports of the lib. |
| `src/lib/setup/source.ts` | Resolve a chosen source (existing-repo/folder/clone/new) into a local path + planned actions. |
| `src/lib/setup/clone.ts` | `cloneRemote()` — clone a GitHub/GitLab/git-URL repo via async `git`/`gh`. |
| `src/lib/setup/init-repo.ts` | `scaffoldProject()` — create folder, `git init`, initial commit, optional `gh repo create` + push. |
| `src/cli/commands/setup-wizard.ts` | New `pan setup` command — thin `inquirer` wrapper over `src/lib/setup/`. Makes the shipped docs true. |
| `src/lib/setup/detect.ts` | Repo scanning (net-new). |
| `src/lib/setup/templates.ts` | Template loading + the `simple-app`/`monorepo`/`polyrepo`/`progressive-polyrepo` archetypes (net-new). |
| `src/lib/setup/config-builder.ts` | State → YAML, validation, merging. |
| `src/lib/setup/write-config.ts` | Atomic write of `projects.yaml`. |
| `src/lib/setup/setup-agent-events.ts` | Event types and JSONL parser for the Setup Agent's progress stream. |
| `src/dashboard/server/routes/setup.ts` | Effect RPC handlers for `SetupRpcGroup`. |
| `src/dashboard/server/services/setup-agent-events.ts` | File watcher service tailing setup-progress.jsonl. |
| `src/dashboard/frontend/src/pages/ProjectsPage.tsx` | `/projects` route. |
| `src/dashboard/frontend/src/pages/ProjectDetailPage.tsx` | `/projects/:projectKey` route. |
| `src/dashboard/frontend/src/pages/WizardPage.tsx` | `/projects/new` route. |
| `src/dashboard/frontend/src/components/wizard/WizardFlow.tsx` | Step orchestration shell. |
| `src/dashboard/frontend/src/components/wizard/StepSource.tsx` | Step 1 — source kind selector (existing repo/folder, clone remote, brand-new) + location/clone-progress/scaffold-progress UI. |
| `src/dashboard/frontend/src/components/wizard/StepType.tsx` | Step 2. |
| `src/dashboard/frontend/src/components/wizard/StepTemplate.tsx` | Step 3. |
| `src/dashboard/frontend/src/components/wizard/StepRepos.tsx` | Step 4. |
| `src/dashboard/frontend/src/components/wizard/StepTracker.tsx` | Step 5. |
| `src/dashboard/frontend/src/components/wizard/StepSetupAgent.tsx` | Step 6 (terminal + progress log). |
| `src/dashboard/frontend/src/components/wizard/StepReview.tsx` | Step 7 (YAML + generated files). |
| `src/dashboard/frontend/src/components/wizard/StepSave.tsx` | Step 8. |
| `src/dashboard/frontend/src/components/wizard/RepoTable.tsx` | Reused by Step 4 and Project Detail Repos tab. |
| `src/dashboard/frontend/src/components/wizard/RepoGroupEditor.tsx` | Drag-to-group UI. |
| `src/dashboard/frontend/src/components/wizard/GeneratedFileViewer.tsx` | Tabbed file viewer with accept/reject. |
| `src/dashboard/frontend/src/components/projects/ProjectCard.tsx` | Card on project list page. |
| `src/dashboard/frontend/src/components/projects/ProjectConfigForm.tsx` | Form on Configuration tab. |
| `src/dashboard/frontend/src/components/projects/QualityGatesEditor.tsx` | Quality gates editor. |
| `src/dashboard/frontend/src/components/projects/RedetectDiffDialog.tsx` | Diff dialog after re-detect. |
| `src/dashboard/frontend/src/components/projects/SetupHistoryTimeline.tsx` | Setup History tab content. |
| `src/dashboard/frontend/src/components/projects/RemoveProjectDialog.tsx` | Destructive confirmation. |
| `src/dashboard/frontend/src/components/welcome/FirstRunWelcome.tsx` | Empty-state welcome card. |
| `src/dashboard/frontend/src/stores/wizardStore.ts` | Zustand store for wizard state. |
| `src/dashboard/frontend/src/stores/projectStore.ts` | Zustand store for project list / current project. |
| `tests/lib/setup/detect.test.ts` | Detection tests. |
| `tests/lib/setup/source.test.ts` | Source resolution: classify path/URL/new, clone into temp dir, scaffold + git-init into temp dir. |
| `tests/lib/setup/config-builder.test.ts` | YAML round-trip tests. |
| `tests/lib/setup/write-config.test.ts` | Atomic write tests. |
| `tests/dashboard/server/routes/setup.test.ts` | RPC handler integration tests. |
| `tests/dashboard/frontend/wizard/WizardFlow.test.tsx` | Wizard happy-path test (Vitest + RTL). |
| `tests/dashboard/frontend/wizard/StepSetupAgent.test.tsx` | Setup Agent step with mocked event stream. |
| `tests/e2e/wizard.spec.ts` | Playwright end-to-end: open dashboard with no projects, complete the wizard, verify project appears. |

## Files to Modify

| File | Changes |
|---|---|
| `src/cli/index.ts` | Register the new `pan setup` command (it does not exist today). |
| `src/cli/commands/project.ts` | Keep `pan project add` working as the "register an already-prepared path" fast-path; have it share `write-config.ts` with the lib so YAML output is identical. |
| `src/dashboard/frontend/src/components/CommandDeck/index.tsx` | Add a `+` button to the PROJECTS/Issues `sectionHeader` (~line 1061) that navigates to `/projects/new`; stop propagation so it doesn't toggle collapse. |
| `src/lib/agents.ts` | Add `setup-agent` to recognized kinds (net-new — does not exist today). |
| `src/dashboard/server/server.ts` | Register `SetupRpcGroup` and the new `routes/setup.ts`. |
| `src/dashboard/server/services/index.ts` | Register the setup-agent-events watcher service. |
| `src/dashboard/frontend/src/EventRouter.tsx` | Handle `SetupAgentEvent` and `ProjectAdded` / `ProjectUpdated` / `ProjectRemoved` domain events. |
| `src/dashboard/frontend/src/components/AgentList.tsx` | Add `setup-agent` filter chip. |
| `src/dashboard/frontend/src/components/Header.tsx` | Project switcher dropdown reads from `projectStore`. Add a "Manage projects" link. |
| `src/dashboard/frontend/src/router.tsx` | Add `/projects`, `/projects/new`, `/projects/:projectKey` routes. |
| `src/dashboard/frontend/src/App.tsx` | Conditional first-run render at `/`. |
| `docs/prds/planned/project-setup-wizard.md` | Strike through Phase 4 ("Dashboard Integration") with a pointer to this PRD. |
| `configuration/setup-wizard.mdx` | Document the dashboard wizard alongside the CLI. |

---

## Testing

### Unit
- All `src/lib/setup/` modules: detection edge cases, template merging, YAML round-trips, validation.
- `wizardStore` reducers: state transitions, file accept/reject, validation flag propagation.
- `projectStore` reducers: list/add/update/remove.

### Integration
- RPC handlers in `tests/dashboard/server/routes/setup.test.ts`: each procedure with realistic input.
- File watcher emits events from a sample JSONL fixture.
- `commitProject` writes byte-identical YAML to what the CLI produces from the same state.

### Component
- `WizardFlow` happy path with mocked RPC client.
- `StepSetupAgent` with a mocked event stream.
- `StepReview` accept/reject behavior.
- `RedetectDiffDialog` with synthetic diffs.

### End-to-end (Playwright)
- **Zero-project onboarding.** Tear down `~/.panopticon/projects.yaml`, open the dashboard, click through the welcome → wizard → save flow, assert the project appears in the list.
- **Sidebar `+` entry point.** With one project already, click the `+` on the PROJECTS sidebar header, assert it routes to `/projects/new` without toggling section collapse.
- **Clone source.** In Step 1, choose "Clone from a remote", point at a local bare-repo fixture (no network), assert clone progress streams and detection runs on the clone.
- **Brand-new project.** Choose "Start a brand-new project" into a temp dir with git-init checked, complete the wizard, assert the directory exists, `git log` has the initial commit, and the project is registered.
- **Folder-without-git warning.** Brand-new project with git-init unchecked, assert the Repo step shows the no-git warning and the project still saves.
- **Add second project.** With one project already, open `/projects/new`, complete the wizard, verify both projects are visible.
- **Edit branch.** Open project detail → Configuration → change `pr_target` → save → reload page → assert persisted.
- **Re-detect adds repos.** Pre-create a project pointing at a directory, add a new repo to the directory, click Re-detect, accept diff, verify config updated.
- **Setup Agent terminal streams.** Spawn the agent against a fixture project, assert the terminal shows output and the event log advances through phases.
- **Remove project.** Open detail → Danger Zone → confirm → assert removed from list and YAML.

Per CLAUDE.md, every UI change is verified with Playwright. Every flow above MUST have a Playwright test before the issue closes.

---

## Open Questions

1. **Where does the Setup Agent's Claude Code session actually run?** It runs in a tmux session on the `panopticon` socket on the user's machine, spawned through the standard launcher so it inherits the resolved permission model — **`--permission-mode auto` by default**, `bypass` only on explicit opt-in (`src/lib/claude-permissions.ts`). The wizard must not invent its own permission flag or a second execution model. There is no `spawn-setup-session.ts` today; we build it in Phase 4 modeled on the planning-agent launcher, and it must be callable from a server-side RPC handler (the dashboard server and `pan up` run on the same host, so a host-local tmux spawn is fine — Docker workspaces are out of scope, matching the PTY-supervisor exclusion).
2. **Multi-user dashboards.** Today, the dashboard assumes one local user. When a setup wizard is in progress, should we lock `projects.yaml` against other dashboard sessions / CLI invocations? *(Probable answer: optimistic, last-write-wins, with a "config changed externally" toast on conflict — same as we'd do for any file-backed config.)*
3. **Template authoring UX.** Do we want a "create custom template" UI in this PRD, or is "edit YAML in your meta repo" the answer? *(Recommended: out of scope. Add a `templates/` browser later.)*
4. **Dashboard project switcher placement.** It currently doesn't exist. Header dropdown vs. left rail vs. command palette? *(Recommended: header dropdown to match every other tool in this category.)*
5. **What happens if the user deletes a project from the dashboard while a workspace is active for it?** *(Recommended: block deletion with a clear error listing active workspaces. The destructive confirmation surfaces this before the user types the project name.)*

## Risks

- **Scope creep into a generic project YAML editor.** Resist. Anything not in the wizard's prompt set is "advanced — edit YAML directly."
- **RPC stream complexity for the Setup Agent.** We've done streaming RPCs for terminal data and domain events; this is the same shape. But the file watcher service is new and needs solid teardown to avoid leaking watchers when a wizard is abandoned.
- **localStorage persistence drift.** If the wizard's state schema changes between dashboard versions, persisted state from an older version could break the wizard on reload. Mitigation: version the persisted blob, bump on breaking changes, drop incompatible state.
- **Dashboard server has a hard rule against blocking sync FS calls.** Repo detection scans many directories — must use `fs/promises` everywhere. The CLI version may use sync calls today; the lib extraction must convert all of those to async before being called from server routes.
- **Setup Agent cost surprises.** A 30-repo polyrepo Setup Agent run could burn meaningful tokens. Surface estimated and actual cost prominently in the wizard and the Setup History timeline. Reuse the existing `BudgetWidget`.

---

## Success Criteria

- A new user can install Panopticon, open the dashboard, and have a fully configured project without ever opening a terminal.
- A project can be created via all four entry points: first-run welcome, sidebar `+`, `/projects` "+ New project" tile, and `pan setup`.
- A project can be created from all four sources: an existing repo on disk, a plain folder on disk, a cloned remote (GitHub/GitLab/URL), and a brand-new project where the wizard creates the folder and initializes git (and optionally a remote).
- A brand-new project ends up with a git repo by default (the recommended path), and a folder-without-git surfaces a clear warning rather than silently producing a project agents can't branch in.
- `pan setup` exists and drives the same pipeline as the dashboard — the shipped `setup-wizard.mdx` docs are now accurate.
- The Setup Agent appears as a normal agent, inherits all existing agent infrastructure, and runs under the resolved permission mode (`auto` by default), never a hardcoded flag.
- `projects.yaml` files written by the CLI and the dashboard are byte-identical given the same state.
- Editing a project's branch config in the UI takes effect on the next workspace creation.
- All Playwright tests above pass.
