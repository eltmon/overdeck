# Planning Session: PAN-161

## CRITICAL: PLANNING ONLY - NO IMPLEMENTATION

**YOU ARE IN PLANNING MODE. DO NOT:**
- Write or modify any code files (except STATE.md)
- Run implementation commands (npm install, docker compose, make, etc.)
- Create actual features or functionality
- Start implementing the solution

**YOU SHOULD ONLY:**
- Ask clarifying questions (use AskUserQuestion tool)
- Explore the codebase to understand context (read files, grep)
- Generate planning artifacts:
  - STATE.md (decisions, approach, architecture)
  - Beads tasks (via `bd create`)
  - PRD file at `docs/prds/active/{issue-id}-plan.md` (copy of STATE.md, required for dashboard)
- Present options and tradeoffs for the user to decide

When planning is complete, STOP and tell the user: "Planning complete - click Done when ready to hand off to an agent for implementation."

---

## Issue Details
- **ID:** PAN-161
- **Title:** Mission Control: Unified monitoring view with Shadow Engineering mode
- **URL:** https://github.com/eltmon/panopticon-cli/issues/161

## Description
# Mission Control: Unified Monitoring View with Shadow Engineering Mode

## Overview

Create a new primary view — **Mission Control** — that becomes the default landing page for Panopticon. This replaces the current Kanban board as the entry point and provides a Codex-inspired interface for monitoring all active projects, features, and agent activity in one place. Additionally, introduce **Shadow Engineering** — a groundbreaking mode for teams transitioning to AI-assisted development.

### Visual Reference

The UI must closely match the design language of OpenAI Codex:

![Codex Landing](https://raw.githubusercontent.com/eltmon/panopticon-cli/main/.github/assets/codex-landing.png)
![Codex Skills](https://raw.githubusercontent.com/eltmon/panopticon-cli/main/.github/assets/codex-skills.png)

**Key design tokens to replicate:**
- **Font**: System sans-serif (Inter / SF Pro / geometric sans), generous line-height (~1.5)
- **Type scale**: 12px metadata → 14px body → 16px subtitles → 28-36px headings
- **Colors**: White `#FFFFFF` main area, warm cream `#FAF9F7` sidebar, near-black `#1A1A1A` text, medium gray `#6B7280` secondary, subtle borders `#E5E7EB`
- **Spacing**: 4px grid system, generous whitespace, content-separated-by-space not lines
- **Components**: 8px border radius cards, no shadows, flat design, thin-stroke line icons
- **Mood**: Warm minimalism — professional, mature styling that builds confidence with senior executives

---

## Part 1: Mission Control View

### 1.1 Project & Feature Tree (Left Panel / Sidebar)

Display all configured Panopticon projects as expandable folders. Inside each project, show currently active/open features (workspaces) as sub-items:

```
▼ panopticon-cli
    🔄 PAN-162  Add webhook notifications           Planning
    ⚠️ PAN-158  Implement cost alerts               In Progress
    🔄 PAN-155  Dashboard dark mode polish           In Review
▼ myn-app
    🔄 MYN-42   User authentication revamp           In Progress
▶ househunt (no active features)
```

**Requirements:**
- Each project is a collapsible folder
- Each active feature/workspace shows:
  - **Status indicator**: 🔄 spinner if agent is running, ⚠️ yellow exclamation if no agent active
  - **Issue identifier** (PAN-XXX, MYN-XX, etc.)
  - **Title** (truncated with tooltip for full title)
  - **Current state** (Todo, Planning, In Progress, In Review, Done)
  - **Total cost** for the feature/workspace so far (e.g., `$4.82`)
- Clicking a feature selects it and loads its activity in the main panel

### 1.2 Feature Activity View (Main Panel)

When a feature is selected, show **all conversation threads/sessions** for that feature unified into one scrollable view. This is the "Project Activity" panel.

**Thread sources** (reference PAN-79 for specialist agent structure):
- Planning agent sessions
- Work agent sessions
- Review agent sessions
- Test agent sessions
- Merge agent sessions
- Any other specialist runs

**Display requirements:**
- Each agent session is a **section** with a clear header showing:
  - Agent type (Planning / Work / Review / Test / Merge)
  - **Model being used** (e.g., `claude-opus-4-6`, `claude-sonnet-4-5`)
  - Start time and duration
  - Status (running / completed / failed)
- Sections ordered by start time (earliest first)
- Full conversation/output rendered with proper formatting (code blocks, markdown, etc.)

**Critical UX for concurrent agents:**
Multiple agents may work on a feature simultaneously. To prevent jarring layout shifts:
- **Tail-anchored sections**: When a section is still producing output, it appends at the bottom — the *top* of the section stays fixed so earlier sections don't shift down
- **Section isolation mode**: Click anywhere in a section header to "focus" it — view only that section's output full-screen. Click again or press Escape to return to the multi-section view
- Unread/new content indicators for sections that received output while user was focused elsewhere

### 1.3 Feature Metadata Badges

For each active feature/workspace, provide quick-access buttons/badges to:

| Badge | Content | State |
|-------|---------|-------|
| **Tasks** | Show beads/tasks panel (like current issue card tasks button) | Always available |
| **STATE.md** | Render STATE.md from workspace | Grayed out if not generated |
| **PRD** | Render PRD.md from workspace | Grayed out if not generated |

- Markdown files rendered using `react-markdown` (already in deps)
- Badges should be small, inline, near the feature header
- Click opens a slide-over or modal with the rendered content

### 1.4 Skills Panel

Add a "Skills" section (matching the Codex Skills page layout) that lists all global Panopticon skills available after `pan init` or `pan sync`:
- Grid of skill cards with icon, name, and description
- Searchable
- Shows which skills are installed vs available
- Link to skill documentation

---

## Part 2: Planning Artifacts Management

### 2.1 `.panopticon/.planning/` Directory

For each feature/workspace, establish a `.panopticon/.planning/` directory (within the workspace, separate from code) that stores:

- **Refinement meeting transcripts** (markdown files)
- **Issue tracker discussions** (pulled from Linear/GitHub/GitLab comments, converted to markdown)
- **Requirement clarification notes** from mid-implementation reviews
- **Ad-hoc notes** and supplementary documentation

```
feature-pan-XXX/.panopticon/.planning/
├── PRD.md                          # If planning agent generated it
├── STATE.md                        # Current state
├── transcripts/
│   ├── 2026-02-01-kickoff.md
│   ├── 2026-02-05-refinement-1.md
│   └── 2026-02-08-mid-impl-review.md
├── discussions/
│   ├── linear-PAN-XXX-comments.md  # Synced from tracker
│   └── pr-123-discussion.md        # PR discussion threads
└── notes/
    ├── architecture-decision.md
    └── api-contract-draft.md
```

### 2.2 Tracker Discussion Sync

- Automatically pull issue comments/discussions from the configured tracker (Linear, GitHub, etc.)
- Convert to clean markdown and store in `.panopticon/.planning/discussions/`
- Keep in sync — new comments get appended
- Available to AI agents for context during planning and implementation

### 2.3 Transcript Attachment UI

In the Mission Control view, provide an easy way to:
- **Upload/attach** markdown files (transcripts, notes) to a feature
- **Drag and drop** files into the planning section
- **View** all planning artifacts in a dedicated "Planning" tab alongside Activity
- **Preview** each document with rendered markdown

---

## Part 3: Shadow Engineering Mode

### 3.1 Concept

**Shadow Engineering** is a new operational mode for teams that are *already doing work manually* but want AI assistance without replacing their existing workflow. This is the bridge for organizations transitioning to AI-first development.

Instead of AI *doing* the work, AI *observes, documents, and assists*:

| Standard Mode | Shadow Engineering |
|--------------|-------------------|
| Planning agent creates PRD | **Monitoring agent** infers plan from artifacts |
| Work agent implements features | **Observer agent** watches human PRs, comments on them |
| AI drives the work | AI shadows the work |
| PRD.md generated | **Inference Document** (working understanding of what the team is building) |

### 3.2 Monitoring Agent (replaces Planning Agent)

When a feature starts in Shadow Engineering mode:
- A **Monitoring Agent** analyzes all available artifacts:
  - Issue description and comments from tracker
  - Meeting transcripts in `.panopticon/.planning/`
  - PR descriptions and code changes
  - Any attached notes/documents
- Produces an **Inference Document** (not a PRD — this is the AI's *understanding* of what the team is building, not a prescriptive plan)
- The Inference Document is living — it updates as new artifacts arrive
- Surfaces gaps, ambiguities, and potential risks it detects in the plan

### 3.3 Observer Agent (replaces Work Agent)

After the Monitoring Agent sets up the feature:
- An **Observer Agent** watches the team's actual development work
- **Always does**: Comments on PRs with observations, suggestions, potential issues
- **Only if asked**: Can propose and commit PRs with improvements or missing pieces
- Tracks progress against the Inference Document
- Flags deviations or scope changes
- Documents patterns and decisions the team is making

### 3.4 Shadow Engineering Value Proposition

This should be a **flagship feature** of Panopticon. Key messaging:

> **"Shadow Engineering: AI that learns your team before it leads."**
>
> Not every team is ready to hand the keyboard to AI. Shadow Engineering lets your existing engineers keep working their way while Panopticon's AI observes, documents, and assists. It learns your codebase, your patterns, and your team's approach — so when you're ready to go further, the AI already understands how you build.

**Target audience**: Engineering leaders and senior executives at organizations that:
- Want to adopt AI-assisted development gradually
- Need to maintain existing team workflows during transition
- Want AI oversight and documentation without AI-driven changes
- Are evaluating AI coding tools but want a low-risk entry point

### 3.5 Implementation

- Add a toggle or mode selector when starting a new feature: **"Standard"** vs **"Shadow Engineering"**
- Shadow Engineering workspaces show a distinct visual indicator (perhaps a different accent color or icon)
- Monitoring Agent and Observer Agent use the same specialist infrastructure from PAN-79 but with different prompt configurations
- Observer Agent needs GitHub/GitLab PR webhook integration to watch for new PRs
- All Shadow Engineering artifacts stored in the same `.panopticon/.planning/` structure

---

## Part 4: Model & Cost Display

### 4.1 Per-Section Model Display
Each activity section must show which model the agent is using:
- Display model name badge (e.g., `opus-4-6`, `sonnet-4-5`) in the section header
- Use existing model display patterns from Settings/AgentCards

### 4.2 Per-Feature Cost
- Show cumulative cost for each feature in the sidebar tree
- Include costs from all agent sessions (planning + work + review + test + merge)
- Use existing cost tracking infrastructure (`/api/costs/by-issue`, `useCostStream` hook)

---

## Technical Notes

### Routing
- New route: `/mission-control` (or just `/` as new default)
- Move current Kanban to `/kanban`
- Add route configuration in `App.tsx`

### Data Sources
- Projects: From Panopticon config (`~/.panopticon/config.yaml`)
- Active features/workspaces: From workspace registry + agent state
- Conversations/threads: From agent session logs and specialist run logs (per PAN-79)
- Planning artifacts: From `.panopticon/.planning/` in each workspace
- Costs: From existing cost tracking APIs
- Skills: From skill registry (existing `/api/skills` or scan)

### Real-time Updates
- Extend existing Socket.io events for live agent output streaming
- New events needed:
  - `activity:output` — streaming agent output for a feature
  - `planning:sync` — new planning artifact detected
  - `shadow:inference-update` — Inference Document updated

### Dependencies
- Extends PAN-79 specialist agent infrastructure
- Uses existing `react-markdown` for document rendering
- Uses existing `@xterm/xterm` for terminal-style agent output
- May need a file upload component (can use native HTML5 drag-and-drop)

---

## Acceptance Criteria

- [ ] Mission Control is the new default landing view at `/`
- [ ] Projects displayed as collapsible folders with active features inside
- [ ] Each feature shows agent status (spinner/warning), state, and cost
- [ ] Clicking a feature shows unified activity view with all agent sessions
- [ ] Activity sections are tail-anchored (no layout jitter from concurrent agents)
- [ ] Section isolation mode works (click to focus one section)
- [ ] Each section displays the model being used
- [ ] Tasks, STATE.md, and PRD badges work (grayed when unavailable)
- [ ] Skills panel matches Codex Skills layout
- [ ] `.panopticon/.planning/` directory structure established
- [ ] Tracker discussions auto-synced to planning directory
- [ ] Transcript/note upload UI works
- [ ] Shadow Engineering mode toggle available when creating features
- [ ] Monitoring Agent produces Inference Document from artifacts
- [ ] Observer Agent comments on PRs
- [ ] Observer Agent only commits PRs when explicitly asked
- [ ] UI matches Codex design language (fonts, spacing, warm minimalism)
- [ ] Existing Kanban view still accessible at `/kanban`
- [ ] README updated with Shadow Engineering feature prominently described

---

## Naming Suggestions

**For the main view**: "Mission Control" — authoritative, implies operational oversight and command

**For the observer feature**: "Shadow Engineering" — evokes AI following alongside the team, learning their patterns. Alternatives considered:
- "AI Overwatch" — too gaming
- "Sentinel Mode" — decent but less descriptive
- "Copilot Mode" — taken by GitHub
- "Guardian Mode" — too protective-sounding

**For the Inference Document** (Shadow Engineering's equivalent of PRD): "Inference Document" or "Understanding Brief" — emphasizes that the AI is inferring/understanding the team's plan, not prescribing one

Open to better names — these are starting points.

---

## Your Mission

You are a planning agent conducting a **discovery session** for this issue.

### Phase 1: Understand Context
1. Read the codebase to understand relevant files and patterns
2. Identify what subsystems/files this issue affects
3. Note any existing patterns we should follow

### Phase 2: Discovery Conversation
Use AskUserQuestion tool to ask contextual questions:
- What's the scope? What's explicitly OUT of scope?
- Any technical constraints or preferences?
- What does "done" look like?
- Are there edge cases we need to handle?

### Difficulty Estimation

For each sub-task, estimate difficulty using this rubric:

| Level | When to Use | Model |
|-------|-------------|-------|
| `trivial` | Typo, comment, formatting only | haiku |
| `simple` | Bug fix, single file, obvious change | haiku |
| `medium` | New feature, 3-5 files, standard patterns | sonnet |
| `complex` | Refactor, migration, 6+ files, some risk | sonnet |
| `expert` | Architecture, security, performance, high risk | opus |

Consider these factors:
- **Files to modify**: 1-2 (simple), 3-5 (medium), 6+ (complex/expert)
- **Cross-cutting**: None (simple), Some (medium), Many (complex/expert)
- **Risk level**: Low (simple), Medium (medium), High (expert)
- **Domain knowledge**: Standard (simple), Research needed (medium), Deep expertise (expert)

When creating beads tasks, include difficulty labels:
```bash
bd create "PAN-XX: Task name" --type task -l "PAN-XX,linear,difficulty:medium" -d "Description"
```

### Phase 3: Generate Artifacts (NO CODE!)
When discovery is complete:
1. Create STATE.md with decisions made
2. Copy STATE.md to PRD at `docs/prds/active/{issue-id}-plan.md` (required for dashboard)
3. Create beads tasks with dependencies using `bd create` (include difficulty:LEVEL labels)
4. Summarize the plan and STOP

**IMPORTANT:** Create the PRD file BEFORE creating beads tasks.

**Remember:** Be a thinking partner, not an interviewer. Ask questions that help clarify.

Start by exploring the codebase to understand the context, then begin the discovery conversation.
