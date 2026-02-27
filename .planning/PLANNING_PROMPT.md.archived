# Planning Session: PAN-273

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
- **ID:** PAN-273
- **Title:** Board view: filter Backlog from Current cycle, add list view for All mode
- **URL:** https://github.com/eltmon/panopticon-cli/issues/273

## Description
## Summary

Two changes to the Board (kanban) view:

### 1. Current cycle should NOT show Backlog items

When the cycle filter is set to "Current", Backlog items should be excluded. Currently they appear alongside active cycle items, cluttering the board with items that aren't planned for this cycle.

- Only show issues that are in the active cycle AND not in Backlog status
- The backend already filters by `cycle: { isActive: { eq: true } }` but Backlog-status items within the cycle still show up

### 2. "All" mode should show a list view instead of kanban columns

When the user switches to "All", replace the kanban column layout with a list/table view:
- Group issues by their labels (using existing labels in the workspace)
- Each group shows issues in a compact list format
- Include status indicators, assignee, priority, and key metadata inline
- This is better for "All" mode because kanban columns don't make sense when viewing across all cycles — there are too many issues to fit in columns

### Design Reference

List view should follow a grouped-by-label layout (screenshot to be attached). Use the labels that currently exist in the Linear workspace for grouping.

## Current Behavior

- **Current**: Shows kanban with Backlog + active cycle items mixed together (27 Backlog, 112 To Do, etc.)
- **All**: Shows same kanban layout but with all issues across cycles
- **Backlog**: Shows only Backlog items

## Expected Behavior

- **Current**: Kanban view with only non-Backlog items from the active cycle
- **All**: List view grouped by labels, showing all issues
- **Backlog**: Kanban or list view of Backlog items (unchanged)

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
