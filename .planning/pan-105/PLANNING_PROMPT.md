# Planning Session: PAN-105

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
- **ID:** PAN-105
- **Title:** Per-model cost breakdown in API responses
- **URL:** https://github.com/eltmon/panopticon-cli/issues/105

## Description
## Feature Request

Add detailed per-model cost breakdown to the /api/costs/by-issue endpoint.

## Consolidates

This issue consolidates:
- **PAN-77** - Cost breakdown modal UI
- **PAN-36** - Specialist cost breakdown

## Current State
The API returns total costs but doesn't break down by model (Opus, Sonnet, Haiku).

## Proposed Enhancement
Add model-level detail to the response:
```json
{
  "issueId": "PAN-81",
  "totalCost": 12.50,
  "byModel": {
    "claude-opus-4": { "cost": 10.00, "tokens": 50000 },
    "claude-sonnet-4": { "cost": 2.00, "tokens": 100000 },
    "claude-haiku-4.5": { "cost": 0.50, "tokens": 200000 }
  },
  "byStage": {
    "planning": { "cost": 1.50, "tokens": 30000 },
    "implementation": { "cost": 8.00, "tokens": 150000 },
    "review": { "cost": 2.50, "tokens": 100000 },
    "merge": { "cost": 0.50, "tokens": 20000 }
  }
}
```

## Use Cases
- Understand which model is driving costs
- Identify opportunities to use cheaper models
- Compare efficiency between issues
- See cost distribution across workflow stages (planning, implementation, review, merge)
- Click cost badge to see detailed modal breakdown

## Dependencies
- Requires PAN-81 (event-sourced cost tracking) since model data is already in events ✅

## Labels
enhancement, cost-tracking

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
