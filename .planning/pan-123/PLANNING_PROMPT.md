# Planning Session: PAN-123

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
- **ID:** PAN-123
- **Title:** Kanban: Drag and drop cards to change status
- **URL:** https://github.com/eltmon/panopticon-cli/issues/123

## Description
## Summary

Add drag-and-drop functionality to the Kanban board so users can move issue cards between columns to change their status.

## Dependencies

- **Blocked by #28** (Shadow mode) - Drag and drop should update the shadow/local status, not directly modify the issue tracker. This allows users to reorganize their view without affecting the upstream issue tracker state.

## Requirements

- [ ] Cards can be dragged between Kanban columns
- [ ] Dropping a card updates the **shadow status** (not the real issue tracker)
- [ ] Visual feedback during drag (ghost card, drop zone highlighting)
- [ ] Smooth animations for card movement
- [ ] Undo capability (or easy way to revert)

## Implementation Notes

- Use a library like `@dnd-kit/core` or `react-beautiful-dnd` for drag-and-drop
- Shadow status from #28 must be implemented first so we have a local state layer to update
- Consider optimistic updates with rollback on error

## Out of Scope

- Syncing drag-and-drop changes back to the real issue tracker (that's a separate feature)
- Multi-select drag
- Cross-board drag (if we ever have multiple boards)

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
2. Create beads tasks with dependencies using `bd create` (include difficulty:LEVEL labels)
3. Summarize the plan and STOP

**Remember:** Be a thinking partner, not an interviewer. Ask questions that help clarify.

Start by exploring the codebase to understand the context, then begin the discovery conversation.
