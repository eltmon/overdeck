# Planning Session: PAN-32

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
- **ID:** PAN-32
- **Title:** Cloister Phase 5: Remaining Specialist Agents (review, test, planning)
- **URL:** https://github.com/eltmon/panopticon-cli/issues/32

## Description
## Overview

Implement the remaining specialist agents beyond merge-agent. Specialists are long-lived agents that sleep until triggered and maintain context via `--resume`.

## Completed

- [x] merge-agent (PAN-29) ✅

## Remaining Specialists

### review-agent (Sonnet)
**Trigger:** PR opened
**Responsibility:** Code review, security checks, suggest changes

```typescript
// Wake prompt example
`# Code Review Request

PR: ${task.prUrl}
Branch: ${task.sourceBranch}
Files changed: ${task.filesChanged.length}

## Instructions
1. Review code for correctness, security, performance
2. Check for OWASP top 10 vulnerabilities
3. Suggest improvements
4. Approve or request changes
`
```

### test-agent (Haiku)
**Trigger:** Push to branch
**Responsibility:** Run test suites, report failures, simple fixes

```typescript
// Wake prompt example
`# Test Request

Workspace: ${task.workspace}
Branch: ${task.branch}

## Instructions
1. cd to workspace
2. Run full test suite
3. If failures:
   - Analyze root cause
   - Fix if simple (< 5 min)
   - Otherwise report back
4. Report results
`
```

### planning-agent (Opus)
**Trigger:** New complex issue
**Responsibility:** Architecture, breaking down work, creating beads tasks

```typescript
// Wake prompt example
`# Planning Request

Issue: ${task.issueId}
Title: ${task.title}

## Instructions
1. Understand the requirements
2. Research existing codebase patterns
3. Design implementation approach
4. Break down into beads tasks
5. Estimate complexity for each task
6. Write to .planning/STATE.md
`
```

## Tasks

- [ ] review-agent implementation
  - [ ] PR webhook trigger (GitHub/GitLab)
  - [ ] Code review prompt template
  - [ ] Integration with existing review workflow
- [ ] test-agent implementation
  - [ ] Push webhook trigger
  - [ ] Test runner detection (jest/vitest/pytest/etc)
  - [ ] Simple fix capability
- [ ] planning-agent implementation
  - [ ] Complex issue detection
  - [ ] Beads task generation
  - [ ] STATE.md template
- [ ] Auto-wake on triggers (webhook from GitHub/Linear)
- [ ] Session rotation when context gets too large

## Specialist Registry

All specialists share:
- Session persistence in `~/.panopticon/specialists/<name>.session`
- Wake with `claude --resume $SESSION_ID -p "task prompt"`
- Context accumulation over time

## Configuration

```yaml
specialists:
  merge-agent:
    enabled: true
    model: sonnet
    auto_wake: true
  review-agent:
    enabled: true
    model: sonnet
    auto_wake: true
  test-agent:
    enabled: true
    model: haiku
    auto_wake: true
  planning-agent:
    enabled: true
    model: opus
    auto_wake: false  # Manual trigger only
```

## Dependencies

- Phase 1 (Watchdog Framework) ✅
- Phase 2 (Agent Management UI) ✅
- merge-agent (PAN-29) ✅

## References

- PRD-CLOISTER.md lines 16-47 (Agent Taxonomy)
- PRD-CLOISTER.md lines 1411-1421 (Phase 5 tasks)

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

### Phase 3: Generate Artifacts (NO CODE!)
When discovery is complete:
1. Create STATE.md with decisions made
2. Create beads tasks with dependencies using `bd create`
3. Summarize the plan and STOP

**Remember:** Be a thinking partner, not an interviewer. Ask questions that help clarify.

Start by exploring the codebase to understand the context, then begin the discovery conversation.
