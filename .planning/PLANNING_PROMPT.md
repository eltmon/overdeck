# Planning Session: PAN-31

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
- **ID:** PAN-31
- **Title:** Cloister Phase 4: Model Routing & Handoffs
- **URL:** https://github.com/eltmon/panopticon-cli/issues/31

## Description
## Overview

Intelligently route tasks to the most cost-effective model based on task complexity. Enable automatic handoffs between models as work progresses.

## Goals

1. Route tasks to appropriate models based on complexity (Opus/Sonnet/Haiku)
2. Auto-escalate when agents get stuck
3. Downgrade to cheaper models for simpler tasks
4. Preserve context during handoffs via STATE.md

## Model Tiers

| Tier | Model | Cost | Best For |
|------|-------|------|----------|
| 💎 Opus | claude-opus-4 | $$$$$ | Architecture, complex debugging, planning |
| 🔷 Sonnet | claude-sonnet-4 | $$$ | Feature implementation, bug fixes, most work |
| 💠 Haiku | claude-haiku-3.5 | $ | Tests, simple fixes, formatting, docs |

## Tasks

From PRD-CLOISTER.md Phase 4:

- [ ] Beads complexity field support (`trivial`, `simple`, `medium`, `complex`, `expert`)
- [ ] Automatic complexity detection (tags, keywords, file count)
- [ ] Model router component in Cloister
- [ ] Complexity → Model mapping configuration
- [ ] Handoff triggers:
  - [ ] Task completion → check next task complexity
  - [ ] Stuck detection → escalate to higher model
  - [ ] Test failures → escalate
- [ ] Context preservation during handoff:
  - [ ] STATE.md summary
  - [ ] Active beads tasks
  - [ ] Git state
- [ ] Cost tracking per agent/model
- [ ] Dashboard cost display

## Handoff Triggers

| Trigger | Condition | From | To |
|---------|-----------|------|-----|
| Planning complete | Beads "plan" task closed | Opus | Sonnet |
| Implementation complete | Beads "implement" closed | Sonnet | test-agent |
| Stuck (Haiku) | No activity > 10 min | Haiku | Sonnet |
| Stuck (Sonnet) | No activity > 20 min | Sonnet | Opus |
| Test failures x2 | Repeated failures | Haiku | Sonnet |

## Kill & Spawn Handoff Flow

```
1. Signal current agent to save state (update STATE.md)
2. Wait for agent to become idle
3. Capture context (workspace, git, beads tasks)
4. Kill current agent
5. Build handoff prompt with context
6. Spawn new agent with appropriate model
```

## Configuration

```yaml
# ~/.panopticon/cloister.yaml
handoffs:
  auto_triggers:
    planning_complete:
      enabled: true
      from_model: opus
      to_model: sonnet
    stuck_escalation:
      enabled: true
      thresholds:
        haiku_to_sonnet_minutes: 10
        sonnet_to_opus_minutes: 20
```

## Dependencies

- Phase 1 (Watchdog Framework) ✅
- Phase 2 (Agent Management UI) ✅
- Phase 3 (Heartbeats & Hooks) - for stuck detection

## References

- PRD-CLOISTER.md lines 48-680 (Model Selection & Handoffs)

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
