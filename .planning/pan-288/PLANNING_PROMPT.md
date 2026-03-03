# Planning Session: PAN-288

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
- **ID:** PAN-288
- **Title:** Dashboard: Separate canceled issues from Done — add Canceled filter view
- **URL:** https://github.com/eltmon/panopticon-cli/issues/288

## Description
## Problem

Canceled issues (Canceled, Duplicate, Won't Do) are currently lumped into the Done column on the kanban board:

```typescript
// KanbanBoard.tsx line 191-193
if (status === 'canceled') {
  grouped.done.push(issue);
}
```

This makes Done misleading — it shows issues that were never actually completed.

## Proposed Solution

Treat canceled issues like Backlog issues: give them their own filter view and exclude them from the kanban board.

### Changes

1. **KanbanBoard.tsx**: Stop pushing canceled issues into `grouped.done`. Instead, filter them out of the kanban entirely (same as backlog issues are filtered out).

2. **Add "Canceled" to the cycle filter** (alongside "Current Cycle", "All", "Backlog"): clicking it shows only canceled issues in a list view, similar to how Backlog works today.

3. **Canceled issues should not appear in the kanban columns** — they aren't backlog, todo, in progress, in review, or done. They're a terminal state that means "we decided not to do this."

4. **Visual treatment in the Canceled view**: dimmed or strikethrough styling to make the terminal state obvious at a glance.

## Key Files

- `src/dashboard/frontend/src/components/KanbanBoard.tsx` — line 191-193 (groupByStatus), cycle filter UI
- `src/dashboard/frontend/src/types.ts` — CanonicalStatus type already has 'canceled'
- `src/dashboard/server/services/issue-data-service.ts` — `getIssues()` post-filter (may need `includeCanceled` param)

## Acceptance Criteria

- [ ] Canceled issues no longer appear in the Done column
- [ ] New "Canceled" filter option in the cycle filter bar (next to Current/All/Backlog)
- [ ] Canceled view shows issues in a list with dimmed/strikethrough styling
- [ ] "Include closed-out" toggle does NOT resurface canceled issues in Done
- [ ] Existing Done column only shows truly completed issues

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
