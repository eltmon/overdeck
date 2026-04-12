# Project Setup Wizard — Dashboard UI

> **Companion to:** [`project-setup-wizard.md`](./project-setup-wizard.md) (PAN-574, merged)
>
> The wizard CLI shipped, but Phase 4 ("Dashboard Integration") was waved at and never built. This PRD specifies the full-blown UI: what the dashboard surface looks like, how it drives the same wizard pipeline as the CLI, and how the Setup Agent is presented as a first-class agent inside the dashboard.

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
2. **Full feature parity with `pan setup`.** Every prompt, every detection step, every template choice, every Setup Agent invocation is reachable from the dashboard. CLI and UI are two front-ends for the same backend pipeline.
3. **The Setup Agent is a first-class agent.** It appears in the agent list, has a terminal panel, streams progress events through the existing RPC, and supports the same lifecycle controls (stop, restart, view logs) as planning agents.
4. **Project management lives in the dashboard.** A "Projects" page lists every configured project, shows health, lets the user edit config visually, re-run setup, and remove projects.
5. **Edits round-trip safely.** Anything edited in the UI writes valid YAML to `~/.panopticon/projects.yaml` with the same schema validation the CLI uses. Anything edited in YAML is reflected in the UI on next load.
6. **Dogfoodable.** We can use the dashboard wizard to onboard a new project end-to-end without ever opening a terminal.

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

### US-2 — Second project (existing user)
*As a user who already has Panopticon running for one project, I want to add another from the dashboard.*

**Acceptance:** A "Projects" entry in the global navigation opens a project list. A "+ New project" button opens the same wizard. On save, the project switcher in the header shows both projects.

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

The wizard backend is the thing the CLI already calls. We extract it from `src/cli/commands/setup.ts` into a reusable service, expose it over the existing Effect RPC layer, and add a React wizard component that drives it.

```
┌──────────────────────────┐         ┌──────────────────────────┐
│  CLI (pan setup)         │         │  Dashboard (wizard UI)   │
│  src/cli/commands/setup  │         │  WizardFlow.tsx          │
└──────────┬───────────────┘         └──────────┬───────────────┘
           │                                    │
           │  same in-process API               │  Effect RPC
           │  (function call)                   │  (PanRpcGroup.setup.*)
           ▼                                    ▼
        ┌─────────────────────────────────────────────┐
        │  src/lib/setup/  (extracted from CLI)       │
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

The CLI keeps its `inquirer`-style prompts but delegates every business operation to `src/lib/setup/`. The dashboard never reaches into `src/cli/`; both call the lib.

### Why RPC, not REST

Every other dashboard server feature uses Effect RPC over `/ws/rpc`. Wizard steps need to stream progress (repo detection on a 50-repo polyrepo can take 30s; the Setup Agent runs for minutes), so a streaming RPC is the right primitive. We add a new RPC group `SetupRpcGroup` to `packages/contracts/` with these procedures:

| Procedure | Type | Purpose |
|---|---|---|
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

### Backend extraction

Today, `src/cli/commands/setup.ts` is one big file with `inquirer` calls interleaved with detection and config writing. We split it:

```
src/lib/setup/
├── detect.ts              # detectRepos(), branch detection, language detection
├── templates.ts           # loadTemplate(), listTemplates(), applyTemplate()
├── config-builder.ts      # stateToYaml(), validateState(), mergeAnswers()
├── spawn-setup-session.ts # spawnSetupSession() — exists per original PRD
├── setup-agent-events.ts  # event types streamed from setup agent
├── write-config.ts        # atomic writes to projects.yaml
└── index.ts               # exports
```

`src/cli/commands/setup.ts` becomes a thin wrapper: `inquirer` for prompts, calls into `src/lib/setup/` for everything else.

### Setup Agent as a first-class agent

The Setup Agent already runs in a tmux session (per the original PRD: "modeled on planning agent"). What's missing is dashboard plumbing. We treat it exactly like a planning agent:

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

We also wire a fourth surface:

4. **First-run welcome** at `/` when zero projects exist. A simple full-screen card that points to `/projects/new`. This is an empty-state, not a separate route — the existing root route just renders this when `useProjectStore().projects.length === 0`.

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
│ ✓ Loc.   │  Project Type Detection                                │
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
| 1 | **Location** | File-system path picker. Defaults to `~/Projects/<basename>`. Browse-folder dialog uses the existing native folder picker (we already have this for workspace paths). On Next, calls `detectRepos` and shows a progress spinner. |
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
5. Wizard mounts with `currentStep: 'location'` and a default path of `~/Projects`.
6. User picks a directory, clicks Next. `detectRepos` RPC runs, shows a spinner. Result populates `wizardStore.detection`.
7. Wizard advances to Step 2, shows detected type. User accepts.
8. Step 3: Template grid. User picks `polyrepo`.
9. Step 4: Repo table. User edits one branch from `master` to `main`.
10. Step 5: Tracker. User picks GitHub, enters org/repo. Credentials read from env.
11. Step 6: User toggles Setup Agent on, clicks Spawn. Agent terminal opens. Events stream. After 4 minutes, agent signals done. Wizard advances.
12. Step 7: User reviews YAML and generated files. Accepts CLAUDE.md and repo-map.md, rejects repo-groups.yaml (wants to write it manually).
13. Step 8: Save. `commitProject` RPC writes `projects.yaml`, copies accepted files into the meta repo, emits `ProjectAdded`.
14. Dashboard navigates to `/projects/myproject`. Project switcher in the header shows the new project. Kanban is empty until the user files an issue.

### Flow B — Adding a second project

Same as Flow A but starts from `/projects` instead of the welcome screen, and the project switcher shows both projects at the end.

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

### Phase 1 — Backend extraction

- Create `src/lib/setup/` modules by extracting from `src/cli/commands/setup.ts`.
- Add `SetupRpcGroup` schemas to `packages/contracts/src/setup.ts`.
- Implement RPC handlers in `src/dashboard/server/routes/setup.ts`.
- Wire CLI to use the lib (no behavior change for CLI users).
- Tests: every lib module has unit tests; CLI smoke test still passes.

### Phase 2 — Project list & detail pages (no wizard yet)

- Add `/projects` route with list UI.
- Add `/projects/:projectKey` route with Overview, Configuration, Repos, Quality Gates, Danger Zone tabs.
- Implement `listProjects`, `getProject`, `updateProject`, `removeProject` handlers.
- "Re-detect repos" with diff dialog.
- Project switcher in the global header reads from `listProjects`.

### Phase 3 — Wizard UI (without Setup Agent)

- Add `/projects/new` route with `WizardFlow.tsx`.
- Implement steps 1–5, 7, 8 (everything except the Setup Agent step).
- `wizardStore` with localStorage persistence.
- Detection step uses `detectRepos` streaming RPC.
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
| `src/lib/setup/detect.ts` | Repo scanning extracted from CLI. |
| `src/lib/setup/templates.ts` | Template loading extracted from CLI. |
| `src/lib/setup/config-builder.ts` | State → YAML, validation, merging. |
| `src/lib/setup/write-config.ts` | Atomic write of `projects.yaml`. |
| `src/lib/setup/setup-agent-events.ts` | Event types and JSONL parser for the Setup Agent's progress stream. |
| `src/dashboard/server/routes/setup.ts` | Effect RPC handlers for `SetupRpcGroup`. |
| `src/dashboard/server/services/setup-agent-events.ts` | File watcher service tailing setup-progress.jsonl. |
| `src/dashboard/frontend/src/pages/ProjectsPage.tsx` | `/projects` route. |
| `src/dashboard/frontend/src/pages/ProjectDetailPage.tsx` | `/projects/:projectKey` route. |
| `src/dashboard/frontend/src/pages/WizardPage.tsx` | `/projects/new` route. |
| `src/dashboard/frontend/src/components/wizard/WizardFlow.tsx` | Step orchestration shell. |
| `src/dashboard/frontend/src/components/wizard/StepLocation.tsx` | Step 1. |
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
| `tests/lib/setup/detect.test.ts` | Detection tests (already in original PRD; extend). |
| `tests/lib/setup/config-builder.test.ts` | YAML round-trip tests. |
| `tests/lib/setup/write-config.test.ts` | Atomic write tests. |
| `tests/dashboard/server/routes/setup.test.ts` | RPC handler integration tests. |
| `tests/dashboard/frontend/wizard/WizardFlow.test.tsx` | Wizard happy-path test (Vitest + RTL). |
| `tests/dashboard/frontend/wizard/StepSetupAgent.test.tsx` | Setup Agent step with mocked event stream. |
| `tests/e2e/wizard.spec.ts` | Playwright end-to-end: open dashboard with no projects, complete the wizard, verify project appears. |

## Files to Modify

| File | Changes |
|---|---|
| `src/cli/commands/setup.ts` | Replace inline business logic with calls to `src/lib/setup/`. Behavior unchanged. |
| `src/cli/commands/project.ts` | Already deprecated by original PRD; ensure it just delegates. |
| `src/lib/agents.ts` | Add `setup-agent` to recognized kinds (already in original PRD; verify shipped). |
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
- **Add second project.** With one project already, open `/projects/new`, complete the wizard, verify both projects are visible.
- **Edit branch.** Open project detail → Configuration → change `pr_target` → save → reload page → assert persisted.
- **Re-detect adds repos.** Pre-create a project pointing at a directory, add a new repo to the directory, click Re-detect, accept diff, verify config updated.
- **Setup Agent terminal streams.** Spawn the agent against a fixture project, assert the terminal shows output and the event log advances through phases.
- **Remove project.** Open detail → Danger Zone → confirm → assert removed from list and YAML.

Per CLAUDE.md, every UI change is verified with Playwright. Every flow above MUST have a Playwright test before the issue closes.

---

## Open Questions

1. **Where does the Setup Agent's Claude Code session actually run?** The CLI version runs it in a tmux session on the user's machine via `--dangerously-skip-permissions`. The dashboard version should do the same — we don't want to invent a second execution model. Confirm the spawn path in the existing `spawn-setup-session.ts` is reusable as-is from a server-side RPC handler, not just from the CLI process. *(Probable answer: yes, since `pan up` runs on the same host.)*
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
- Every CLI prompt has a UI equivalent.
- The Setup Agent appears as a normal agent and inherits all existing agent infrastructure.
- `projects.yaml` files written by the CLI and the dashboard are byte-identical given the same state.
- Editing a project's branch config in the UI takes effect on the next workspace creation.
- All Playwright tests above pass.
- The original wizard PRD's Phase 4 is closed out with a pointer to this one.
