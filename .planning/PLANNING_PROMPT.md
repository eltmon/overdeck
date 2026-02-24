# Planning Session: PAN-103

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
- **ID:** PAN-103
- **Title:** Dashboard UI: Progressive disclosure with resizable Inspector and Terminal panels
- **URL:** https://github.com/eltmon/panopticon-cli/issues/103

## Description
## Summary

Redesign the dashboard detail view to use progressive disclosure:

1. **Dashboard** - Kanban board always visible
2. **Click card** → Inspector panel slides in on the right (metadata, actions, no terminal)
3. **Click "View Terminal"** or expand → Terminal panel also appears alongside Inspector

Currently when you click a card, the entire WorkspacePanel replaces the view. We want the kanban to stay visible with panels opening to the right.

## Stitch Designs

Use these designs from the "Panopticon Agent Orchestration Dashboard" Stitch project (ID: `7429816648963385369`):

| Screen | Purpose | ID |
|--------|---------|-----|
| Panopticon Orchestration Dashboard v2 | Main kanban layout | `fd5bece5206f48cea74e13d745522659` |
| Agent Detail Panel with Inspector | Inspector + Terminal split view | `9777134c06e0443b9b92eb26dc90dded` |

**To access designs:**
\`\`\`bash
# List all screens in project
mcp__stitch__list_screens projectId="7429816648963385369"

# Get specific screen details
mcp__stitch__get_screen projectId="7429816648963385369" screenId="<id>"
\`\`\`

**To convert to React:**
Use \`/stitch-react-components\` skill after reviewing the designs.

## Requirements

### Layout Changes

1. **Main Layout** (`App.tsx`)
   - Kanban should always be visible (with reduced width when panels open)
   - Right side shows Inspector and/or Terminal as overlay panels

2. **Inspector Panel** (new component or refactored `WorkspacePanel`)
   - Default width ~320px
   - **Resizable** with drag handle (min 200px, max 500px)
   - **Collapsible** with chevron button
   - Shows: Agent info, Git status, Containers, Actions
   - NO terminal in this view

3. **Terminal Panel** (new component)
   - Appears when user clicks "View Terminal" or expand button
   - Flexible width (takes remaining space)
   - Shows: Logs tab, Status tab, message input
   - Has its own close button

4. **Resize Handle**
   - Vertical bar between Inspector and Terminal
   - `cursor: col-resize` on hover
   - Draggable to adjust Inspector width

### State Management

- Track panel state: `closed` | `inspector-only` | `inspector+terminal`
- Persist Inspector width in localStorage
- Remember panel state per agent (optional)

### Interaction Flow

1. Click card on kanban → Inspector slides in from right
2. Kanban narrows to accommodate (or use overlay)
3. Click "View Terminal" in Inspector → Terminal appears
4. Click collapse on Inspector → Inspector shrinks to icon strip
5. Click X on Terminal → Returns to inspector-only state
6. Click X on Inspector → All panels close, return to full kanban

## Technical Notes

- Current `WorkspacePanel.tsx` is 1073 lines - consider splitting into:
  - `InspectorPanel.tsx` - metadata and actions
  - `TerminalPanel.tsx` - logs and messaging
  - `DetailPanelLayout.tsx` - coordinates both panels

- Use CSS resize or a library like `react-resizable-panels` for the split view

## Acceptance Criteria

- [ ] Kanban remains visible when viewing agent details
- [ ] Inspector panel is resizable via drag handle
- [ ] Inspector panel is collapsible via button
- [ ] Terminal appears as separate panel, not replacing Inspector
- [ ] Visual style matches Stitch designs (colors, typography, spacing)
- [ ] Smooth transitions when panels open/close
- [ ] Responsive to window resize

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
