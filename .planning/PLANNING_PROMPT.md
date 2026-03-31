<!-- panopticon:orchestration-context-start -->
<!-- This is Panopticon orchestration context injected automatically.
     It contains planning session setup instructions, not agent reasoning.
     Session summarizers should SKIP this block and focus on the agent's
     actual work, decisions, and tradeoffs that follow. -->

# Planning Session: PAN-402

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
  - Implementation plan at `docs/prds/active/{issue-id}-plan.md` (copy of STATE.md, required for dashboard)
- Present options and tradeoffs for the user to decide

When planning is complete, STOP and tell the user: "Planning complete - click Done when ready to hand off to an agent for implementation."

---

## Issue Details
- **ID:** PAN-402
- **Title:** Dashboard: planning agent spawn failures are invisible to the UI
- **URL:** https://github.com/eltmon/panopticon-cli/issues/402

## Description
## Summary

When the dashboard "Plan" button triggers `POST /api/issues/:id/start-planning`, the endpoint returns `planningAgent.started: true` immediately, then spawns the agent in a background async task. If the background task fails (workspace creation error, tmux spawn failure, remote VM issues), the agent state file is updated to `status: failed` but **the UI never learns about it**. The user sees a success state while nothing is actually running.

## Root Cause

The response is sent at line ~9428 of `server/index.ts`, BEFORE the background async function (line ~9432) runs workspace creation and agent spawning. This was intentional (PAN-302) to avoid blocking the UI spinner, but error propagation was never added.

## Failure Modes (all silent)

1. **Workspace creation fails** — `pan workspace create` throws, error logged to console, state file set to `failed`, UI shows success
2. **Local planning: workspace doesn't exist** — validation check returns early without spawning, state file set to `failed`, UI shows success
3. **Remote workspace not ready** — VM verification fails, falls through to local path which also fails, UI shows success
4. **tmux session creation fails** — caught by outer try/catch, state file set to `failed`, UI shows success

## How We Found It

PAN-388 planning failed because `projects.yaml` had `traefik: templates/traefik` (directory, not file), causing `docker compose -f` to error. The Traefik bug is fixed separately, but the silent failure pattern would have hidden any future workspace creation error.

## Fix

The frontend PlanDialog should poll `/api/planning/:issueId/status` after receiving the initial response to verify the agent actually started:

1. After receiving `started: true`, wait 3-5 seconds
2. Poll the status endpoint
3. If `active: false` and state file shows `failed`, show the error to the user
4. Consider adding a WebSocket event (`planning:failed`) so the UI gets notified immediately instead of polling

Alternatively, the backend could use Socket.io to push a `planning:started` or `planning:failed` event once the background task completes, which the PlanDialog listens for.

## Agent State File Location

`~/.panopticon/agents/planning-<issue-id>/state.json` — contains `status` and `error` fields when failures occur.

---

## Your Mission

You are a planning agent conducting a **discovery session** for this issue.

### Phase 1: Understand Context
1. **If a spec file was provided above**, read it thoroughly — it's your primary input
2. Read the codebase to understand relevant files and patterns
3. Identify what subsystems/files this issue affects
4. Note any existing patterns we should follow

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
2. Copy STATE.md to implementation plan at `docs/prds/active/{issue-id}-plan.md` (required for dashboard)
3. Create a vBRIEF plan file at `.planning/plan.vbrief.json` (structured machine-readable plan — see format below)
4. Create beads tasks with dependencies using `bd create` (include difficulty:LEVEL labels)
5. Summarize the plan and STOP

### vBRIEF Plan Format

Create `.planning/plan.vbrief.json` — a structured plan with items and dependency edges.
This file will be used to visualize the dependency graph and eventually to generate beads programmatically.

```json
{
  "vBRIEFInfo": { "version": "0.5", "created": "<ISO 8601 timestamp>" },
  "plan": {
    "id": "PAN-402",
    "title": "<issue title>",
    "status": "approved",
    "author": "opus-plan",
    "tags": ["<relevant tags>"],
    "narratives": {
      "Problem": "<what problem this solves>",
      "Proposal": "<the approach chosen>",
      "Constraint": "<limitations and boundaries>",
      "Risk": "<potential issues and mitigations>",
      "Alternative": "<other options considered and why rejected>"
    },
    "items": [
      {
        "id": "<short-kebab-id>",
        "title": "<task title>",
        "status": "pending",
        "priority": "high|medium|low",
        "metadata": {
          "difficulty": "trivial|simple|medium|complex|expert",
          "issueLabel": "pan-402"
        },
        "narrative": { "Action": "<what needs to be done>" },
        "subItems": []
      }
    ],
    "edges": [
      { "from": "<source-item-id>", "to": "<target-item-id>", "type": "blocks|informs|invalidates|suggests" }
    ]
  }
}
```

**Edge types:**
- `blocks` — target MUST wait for source to complete (hard dependency)
- `informs` — target benefits from source context (soft dependency)
- `invalidates` — source completion makes target unnecessary
- `suggests` — weak recommendation, no dependency

**IMPORTANT:** Create the plan file BEFORE creating beads tasks.
**NOTE:** `*-spec.md` files are human-written specs — do NOT overwrite them. Your output is `*-plan.md`.

**Remember:** Be a thinking partner, not an interviewer. Ask questions that help clarify.

Start by exploring the codebase to understand the context, then begin the discovery conversation.

<!-- panopticon:orchestration-context-end -->
