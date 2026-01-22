# Planning Session: PAN-35

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
- **ID:** PAN-35
- **Title:** Terminal latency: Phase 2 - remaining blocking operations
- **URL:** https://github.com/eltmon/panopticon-cli/issues/35

## Description
## Problem

Terminal view still has occasional lag spikes (~2 second latency on first keystroke, occasional freezes).

## Investigation Method

Run Playwright latency tests:
```bash
cd src/dashboard/frontend
npx playwright test tests/terminal-latency.spec.ts --reporter=list
```

## Current Results (2026-01-21)

```
WebSocket connect time: 2354ms  # TOO SLOW
First keystroke: 2066ms        # MAJOR LAG
P50: 0.90ms                    # OK
P95: 2066ms                    # SPIKES
```

## Root Cause Analysis

### Fixed in PAN-17 (commit b2874bb)
- Converted main endpoints to async (`execAsync`)
- Added reconnection with backoff
- Debounced resize events

### Remaining Sync Operations Found

1. **`/api/agents/:id/message`** (line 1311-1315) - Uses `execSync` for tmux send-keys
2. **`/api/agents/:id`** DELETE (line 1329) - Uses `execSync` for tmux kill-session  
3. **`/api/agents/:id/answer-question`** (line 1449-1468) - Multiple `execSync` for tmux interaction
4. **`/api/agents/:id/pending-questions`** - May have sync file reads in `getAgentPendingQuestions()`
5. **Beads endpoints** (line ~984-1018) - Uses `execSync` for `bd` commands

### Polling Pressure

Multiple components poll aggressively:
- WorkspacePanel output: **1 second**
- ActivityPanel: **1 second**  
- TerminalView: **2 seconds**
- PlanDialog: **2 seconds** during planning
- AgentList: **3 seconds**
- Many others: **5 seconds**

Combined polling could cause event loop pressure even with async calls.

## Proposed Fixes

1. **Convert remaining execSync to execAsync** - Low risk, high impact
2. **Batch/throttle polling** - Reduce concurrent requests
3. **Move tmux operations to worker thread** - Isolate blocking ops
4. **WebSocket for real-time data** - Replace polling with push

## Testing

After each fix, re-run Playwright tests:
```bash
npx playwright test tests/terminal-latency.spec.ts
```

Target metrics:
- WebSocket connect: < 500ms
- First keystroke: < 100ms
- P95 latency: < 50ms

## References

- PAN-17: Original async fix
- Playwright tests: `src/dashboard/frontend/tests/terminal-latency.spec.ts`
- Server code: `src/dashboard/server/index.ts`

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
