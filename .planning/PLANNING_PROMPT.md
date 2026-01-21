# Planning Session: PAN-27

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
- **ID:** PAN-27
- **Title:** Cloister Phase 2: Agent Management UI
- **URL:** https://github.com/eltmon/panopticon-cli/issues/27

## Description
## Overview

Implement Cloister Phase 2: Enhanced Agent Management UI per PRD.

**PRD:** docs/PRD-CLOISTER.md

## Phase 2 Scope

### 1. Two-Section Agents Page

Split agents into:
- **Specialist Agents (Permanent)** - merge-agent, review-agent, test-agent
- **Issue Agents (Ephemeral)** - from /work-issue

Specialist agent display:
```
┌─────────────────────────────────────────────────────┐
│ 😴 merge-agent     Sleeping    Last: 2 hrs ago      │
│    Session: 286e638d...  Context: 45K tokens        │
│                                      [Wake] [Reset] │
└─────────────────────────────────────────────────────┘
```

### 2. Agent Detail View

When clicking an agent, show:
- Terminal output stream (existing)
- Health history timeline (new)
- Git status (existing)
- Session ID and context size (for specialists)

### 3. Action Buttons

- **Poke** - Send nudge message to stuck agent
- **Kill** - Terminate agent (existing)
- **Send Message** - Custom message to agent
- **Wake** - Resume sleeping specialist (--resume)
- **Reset** - Clear specialist session and start fresh

### 4. Health History Graph

Show agent health over last 24 hours:
- Timeline of state changes (🟢→🟡→🟠→🔴)
- Activity events
- Interventions (pokes, kills)

## Backend Requirements

- [ ] API: List specialist agents from `~/.panopticon/specialists/`
- [ ] API: GET /api/specialists - list all specialists with status
- [ ] API: POST /api/specialists/:name/wake - wake with --resume
- [ ] API: POST /api/specialists/:name/reset - clear session
- [ ] API: POST /api/agents/:id/poke - send nudge message
- [ ] API: POST /api/agents/:id/message - send custom message
- [ ] API: GET /api/agents/:id/health-history - last 24h of health

## Frontend Requirements

- [ ] Split AgentList into SpecialistAgents + IssueAgents sections
- [ ] Add Wake/Reset buttons for specialists
- [ ] Add Poke/Message buttons for all agents
- [ ] Add health history timeline component
- [ ] Show session ID and context size for specialists

## Depends On

- Phase 1 complete (#21) ✅

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
