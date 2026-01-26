---
name: opus-plan
description: >
  Opus-driven planning for issues before Sonnet implementation. Creates workspace,
  PRD.md, STATE.md, beads with dependencies, and updates issue tracker. Ensures
  strategic decisions are made by Opus, not cheaper models.
triggers:
  - opus plan
  - opus-plan
  - opus planning
  - plan with opus
allowed-tools:
  - Read
  - Write
  - Bash
  - Task
  - Grep
  - Glob
  - ToolSearch
version: "1.2.0"
author: "Ed Becker"
license: "MIT"
---

# Opus Planning Skill

**Trigger:** `/opus-plan <issue-id>`

**CRITICAL:** This skill MUST be run by Opus. The entire point is that Opus does ALL the thinking so Sonnet just executes. If you are Sonnet or Haiku, STOP and tell the user to switch to Opus.

## Core Principle

**Opus plans EVERYTHING. Sonnet executes.**

Do NOT leave any decisions for the implementation agent. Every architectural choice, every file path, every function name, every edge case - all decided here. The implementation agent should be able to work through beads mechanically without making any design decisions.

---

## EXECUTION STEPS

### Step 1: Parse Issue ID and Setup

```bash
# PAN-XXX -> /home/eltmon/projects/panopticon (GitHub)
# MIN-XXX -> /home/eltmon/projects/myn (Linear)
# HH-XXX  -> /home/eltmon/projects/househunt (Linear)
# JH-XXX  -> /home/eltmon/projects/jobhunt (Linear)

mkdir -p <project>/workspaces/feature-<issue-id-lowercase>/.planning
```

### Step 2: Fetch Issue Details

**GitHub (PAN-*):** `gh issue view <number>`
**Linear:** Use `mcp__linear__get_issue` tool

Read the FULL issue. Understand what's being asked.

### Step 3: Deep Discovery

**YOU MUST** thoroughly explore the codebase. Use `Task` tool with `subagent_type=Explore` or manually:

1. Find ALL related files:
   - Where does the feature touch?
   - What patterns exist?
   - What tests exist?

2. Read key files completely:
   - Don't skim - read line by line
   - Understand the data flow
   - Note function signatures

3. Identify:
   - Files to create (new)
   - Files to modify (existing)
   - Files to delete (cleanup)
   - Tests to write/update

### Step 4: Write PRD.md

Create `.planning/PRD.md` with ALL sections filled in completely:

```markdown
# PRD: <Title>

**Issue:** <issue-id>
**Author:** Ed Becker (with Claude Opus 4.5)
**Created:** <date>
**Status:** Ready for Implementation

## Executive Summary
<2-3 sentences describing what we're building and why>

## Problem Statement
<Detailed description of the problem. Include:
- Current behavior
- Desired behavior
- Impact of not fixing>

## User Personas
<At least 3 personas with specific needs>

## User Stories
<10+ user stories covering all use cases>

## Functional Requirements

### FR1: <Category>
- FR1.1: <Specific, testable requirement>
- FR1.2: <Specific, testable requirement>

### FR2: <Category>
...

## Non-Functional Requirements
<Performance, accessibility, security, etc.>

## Technical Design

### Architecture Overview
<High-level description with diagram if helpful>

### Data Flow
<How data moves through the system>

### API Changes
<New endpoints, modified endpoints, with full signatures>

### Component Structure
<File tree of new/modified components>

### Database Changes
<Schema changes if any>

## Acceptance Criteria
<Numbered checkboxes - these become the final verification>

## Dependencies
<External dependencies, internal dependencies>

## Risks and Mitigations
<What could go wrong, prevention strategies>
```

### Step 5: Write STATE.md

Create `.planning/STATE.md` with COMPLETE task breakdown:

```markdown
# <issue-id>: <Title>

**Status:** Ready for Implementation
**Planned by:** Claude Opus 4.5
**Date:** <date>

---

## Discovery Summary
<What you learned - specific file paths, patterns, gotchas>

## Key Architectural Decisions

### Decision 1: <Topic>
**Choice:** <What we're doing>
**Rationale:** <Why this choice, not alternatives>
**Implications:** <What this means for implementation>

### Decision 2: ...

## Implementation Plan

### Phase 1: <Name> (Priority: P1)

#### Task 1.1: <Specific task name>
**File:** `src/path/to/file.ts`
**Action:** Create new file / Modify existing
**Details:**
- Create function `functionName(param: Type): ReturnType`
- Handle edge case X
- Integrate with Y
**Tests:** `tests/path/to/test.ts`

#### Task 1.2: ...

### Phase 2: <Name> (Priority: P2)
...

## Task Dependencies

```
Task 1.1 ──┬── Task 2.1 ── Task 3.1
           │
Task 1.2 ──┴── Task 2.2 ── Task 3.2
```

<Explicit list: "Task X blocks Task Y because...">

## Definition of Done
- [ ] All beads completed
- [ ] All tests passing
- [ ] No TypeScript errors
- [ ] Manual testing complete
- [ ] PR created and reviewed

## Notes for Implementation Agent
- Start with Phase 1 tasks (they unblock everything)
- Run tests after each task
- Don't refactor code outside the scope
- Ask for help if blocked
```

### Step 6: CREATE ALL BEADS

**This is the critical step.** Create 30-60+ beads for a typical feature. Each bead must be:
- Completable in 1 focused session
- Specific enough that no decisions are needed
- Include exact file paths and function names

**For each task in STATE.md, create a bead:**

```bash
bd create --title "<ISSUE-ID>: <exact task name>" \
  --priority <1-4> \
  --labels "<ISSUE-ID>,difficulty:<level>,phase-<n>,<optional-tags>" \
  --description "<VERY detailed description:
File: src/exact/path/file.ts

What to do:
1. Create/modify function X
2. Add parameter Y
3. Handle edge case Z

Expected behavior:
- When A happens, B should occur
- If C fails, show error D

Tests:
- Add test in tests/path/test.ts
- Cover cases: E, F, G>"
```

**Label format:**
- `<ISSUE-ID>` - always include
- `difficulty:trivial|simple|medium|complex`
- `phase-1|phase-2|etc`
- `api` - backend work
- `frontend` - React components
- `stitch` - design work
- `test` - test-only tasks

**After creating beads, set dependencies:**
```bash
bd dep add <blocked-id> <blocker-id>
```

**VERIFY:** `bd search "<ISSUE-ID>"` and count. Should be 30-60+ for a real feature.

### Step 7: Stitch Integration (UI Work)

If issue involves UI, YOU MUST use Stitch:

```bash
# Load Stitch tools
ToolSearch query: "+stitch"

# Create project
mcp__stitch__create_project name="<issue-id>-design"

# Design each screen
mcp__stitch__generate_screen_from_text ...
```

Document all designs in `.planning/STITCH_DESIGNS.md`.

### Step 8: Update Issue Tracker

**GitHub (PAN-*):**
```bash
gh label create "planned" --color "0E8A16" 2>/dev/null || true
gh label create "ready-for-implementation" --color "1D76DB" 2>/dev/null || true
gh label create "opus-planned" --color "7057FF" 2>/dev/null || true

gh issue edit <number> --add-label "planned,ready-for-implementation,opus-planned"

gh issue comment <number> --body "## Planning Complete
**Planned by:** Claude Opus 4.5
**Workspace:** workspaces/feature-<issue-id>/

### Beads Created: <N> tasks
### Ready Work: <list unblocked beads>
### Next: /work-issue <ISSUE-ID>"
```

### Step 9: Output Summary

```
## Opus Planning Complete for <ISSUE-ID>

**Workspace:** <path>
**PRD:** <title> - <N> requirements
**STATE.md:** <N> phases, <M> tasks

**Beads Created:** <total>
- Ready (unblocked): <N>
- Blocked: <M>

**Ready Work:**
1. <bead-id>: <title> [P<n>]
...

**Next:** /work-issue <ISSUE-ID>
```

---

## Task Breakdown Templates

### For Backend API Work:

```
Phase: API Implementation
Tasks:
- Define types/interfaces in types.ts
- Create endpoint handler function
- Add route registration
- Add request validation
- Add error handling
- Write unit tests for handler
- Write integration tests for endpoint
- Update API documentation
```

### For React Component Work:

```
Phase: Component Implementation
Tasks:
- Create component file with shell
- Add props interface
- Implement render logic
- Add state management (if needed)
- Add event handlers
- Style with Tailwind/CSS
- Add loading states
- Add error states
- Write unit tests
- Wire into parent component
- Add to Storybook (if applicable)
```

### For Bug Fixes:

```
Phase: Bug Fix
Tasks:
- Write failing test that reproduces bug
- Identify root cause (document in bead)
- Implement fix
- Verify test passes
- Add regression tests
- Check for similar issues elsewhere
```

### For Refactoring:

```
Phase: Refactoring
Tasks:
- Write tests for current behavior (if missing)
- Extract function/module
- Update all call sites
- Run tests, fix failures
- Update documentation
- Remove old code
```

---

## Quality Checklist

Before completing /opus-plan, verify:

- [ ] PRD.md has ALL sections filled
- [ ] STATE.md has EVERY task detailed
- [ ] Each bead has exact file paths
- [ ] Each bead has expected behavior
- [ ] Dependencies are set correctly
- [ ] Ready tasks identified
- [ ] Issue tracker updated
- [ ] No decisions left for implementation agent
