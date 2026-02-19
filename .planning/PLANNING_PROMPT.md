# Planning Session: PAN-208

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
- **ID:** PAN-208
- **Title:** Stale planning state causes premature 'Planning Complete' on restart
- **URL:** https://github.com/eltmon/panopticon-cli/issues/208

## Description
## Problem

When clicking "Plan" on an issue that was previously planned (even after deep-wipe), the PlanDialog shows "Planning Complete" after only a few seconds without the planning agent actually running. Closing the dialog and clicking "Resume Planning" works correctly.

## Root Cause

1. **Stale `STATE.md` survives workspace recreation**: The `.planning/` directory in the workspace contains `STATE.md` from a previous planning session. Since workspaces are git worktrees, the branch may still contain the old `.planning/` directory even after the worktree is deleted and recreated.

2. **Status endpoint trusts STATE.md pattern matching**: `GET /api/planning/:id/status` checks if `STATE.md` contains `## Status: Complete` or `## Planning Status: Complete` (regex). It doesn't validate whether this is from the current planning attempt.

3. **PlanDialog auto-transitions on initial check**: When the dialog opens in "checking" step, if `data.planningCompleted` is `true`, it immediately transitions to `step='complete'` **without** requiring:
   - An active session connection
   - A minimum time threshold
   - The `.planning-complete` marker file

## Affected Code

- **Status endpoint**: `src/dashboard/server/index.ts` lines ~8812-8909
- **PlanDialog initial check**: `src/dashboard/frontend/src/components/PlanDialog.tsx` lines ~226-251
- **Deep-wipe**: `src/dashboard/server/index.ts` lines ~10284-10491

## Proposed Fix

1. **Start-planning should clear stale planning state**: Before spawning a new planning agent, delete any existing `.planning/` directory in the workspace (or at least remove `STATE.md` and `.planning-complete` marker)
2. **PlanDialog should require session connection**: Don't transition to "complete" on initial check unless `hasConnectedToSession.current === true` (the agent was actually seen running)
3. **Deep-wipe should clean workspace-backed `.planning/`**: Currently only cleans the legacy project-level `.planning/{issue}/` directory, not the workspace-backed one

## Reproduction

1. Plan an issue to completion
2. Deep-wipe the issue
3. Click "Plan" again
4. Dialog shows "Planning Complete" after ~2-3 seconds without the agent running

## Related

- PAN-207 (ERR_NETWORK_CHANGED) was a separate issue with Docker network disruptions, now fixed with retry logic

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
