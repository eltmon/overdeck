# Planning Session: PAN-136

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
- **ID:** PAN-136
- **Title:** Fix pre-existing test failures (16 failures across multiple suites)
- **URL:** https://github.com/eltmon/panopticon-cli/issues/136

## Description
## Problem

There are 16 pre-existing test failures across multiple test suites that are unrelated to any specific feature branch. These failures cause the specialist handoff cycle to break - test-agent marks `testStatus: "failed"` even when all issue-specific tests pass, preventing the merge flow.

## Failing Suites (as of PAN-105 test run)

These failures need investigation and fixing:

- `tests/lib/model-presets.test.ts` - Likely removed/refactored without updating tests
- `tests/lib/router-config.test.ts` - Configuration test failures
- `tests/lib/settings-api.test.ts` - Settings API test failures
- Other suites with intermittent or stale test failures

## Impact

- Blocks the specialist workflow: review passes → test-agent reports "failed" → work agent loops trying to fix unrelated tests
- Makes it impossible to distinguish real regressions from pre-existing issues
- Forces manual merge intervention

## Proposed Fix

1. Run full test suite and catalog all failures
2. Fix each failing test (update expectations, remove stale tests, fix broken assertions)
3. Ensure CI passes with zero failures on main branch
4. Consider adding a "known failures" baseline to test-agent so it can distinguish new regressions from pre-existing issues

## Labels
bug, testing, infrastructure

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
