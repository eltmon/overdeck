# Planning Session: PAN-290

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
- **ID:** PAN-290
- **Title:** Fix 9 pre-existing test failures in session-rotation.test.ts and skills-merge.test.ts
- **URL:** https://github.com/eltmon/panopticon-cli/issues/290

## Description
## Problem

9 pre-existing test failures on main across 2 test files. These block specialist test-agent from cleanly distinguishing feature regressions from baseline failures.

Detected during PAN-288 specialist pipeline run (1358 pass, 14 fail — 9 of which are these + 5 others that may have been fixed since).

## Failing Tests

### `tests/cloister/session-rotation.test.ts` (5 failures)

Needs investigation — likely related to session rotation logic changes that weren't reflected in tests.

### `tests/unit/lib/skills-merge.test.ts` (4 failures)

All in `cleanupGitignore` / `cleanupWorkspaceGitignore`:

1. **should remove duplicate entries** — `duplicatesRemoved` expected 1, got 0
2. **should sort entries alphabetically** — `result.cleaned` expected false, got true
3. **should handle severely duplicated content** — `duplicatesRemoved` expected 24, got 0
4. **cleanupWorkspaceGitignore > should target correct path** — `duplicatesRemoved` expected 1, got 0

Root cause: `cleanupGitignore()` implementation was likely refactored (possibly now deduplicates differently or sorts unconditionally) without updating the test expectations.

### `tests/lib/config-migration.test.ts`

Passes clean as of 2026-03-01.

## Reproduction

```bash
npx vitest run tests/cloister/session-rotation.test.ts tests/unit/lib/skills-merge.test.ts --reporter=verbose
```

## Impact

These failures cause test-agent to report 14 total failures during specialist review cycles, requiring manual triage to confirm they're pre-existing. Fixing them restores a clean baseline for automated merge decisions.

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
