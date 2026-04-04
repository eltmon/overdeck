<!-- panopticon:orchestration-context-start -->
<!-- This is Panopticon orchestration context injected automatically.
     It contains planning session setup instructions, not agent reasoning.
     Session summarizers should SKIP this block and focus on the agent's
     actual work, decisions, and tradeoffs that follow. -->

# Planning Session: PAN-440

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
- **ID:** PAN-440
- **Title:** Agent enrichment missing from Effect server — INPUT badge, Watch Planning, resolution badges broken
- **URL:** https://github.com/eltmon/panopticon-cli/issues/440

## Description
## Problem

The Effect server migration (PAN-428) dropped agent enrichment fields that the frontend depends on. The old Express `/api/agents` endpoint computed these fields by scanning JSONL sessions and runtime state. The new RPC snapshot only returns basic `AgentSnapshot` fields.

## Missing Fields

| Field | What it does | How old code computed it |
|-------|-------------|------------------------|
| `agentPhase` | `'planning'` vs `'implementation'` | Checked agent state.json `type` field |
| `hasPendingQuestion` | Shows INPUT badge, triggers toast | Scanned JSONL for unanswered `AskUserQuestion` tool calls |
| `pendingQuestionCount` | Count shown on INPUT badge | Count of pending questions from JSONL scan |
| `resolution` | Done/Stuck/Blocked/needs_input badges | Read from runtime.json `resolution` field |
| `resolutionCount` | Shown in Stuck badge tooltip | Read from runtime.json |

## Broken UI Features

1. **INPUT badge** on kanban cards — never shown because `hasPendingQuestion` is always undefined
2. **"Watch Planning" button** — should replace "Plan" when planning is active, depends on `agentPhase === 'planning'` + agent in store
3. **Done/Stuck/Blocked badges** — never shown because `resolution` is always undefined
4. **Planning input toast** — App.tsx filters on `agentPhase === 'planning' && hasPendingQuestion` — never triggers
5. **Terminal scroll history** — after PTY reconnect, scroll buffer is lost (separate issue)

## Root Cause

The old Express `/api/agents` endpoint (commit 97e101e, line ~1700) did heavy computation per agent:
- `getAgentPendingQuestions()` — read JSONL, parse tool_use/tool_result pairs
- `getAgentRuntimeState()` — read runtime.json for resolution/phase
- Merged this into the agent response

The Effect server's `ReadModelService.getSnapshot()` returns agents from `listRunningAgents()` which only has basic fields (id, issueId, workspace, status, etc.).

## Fix Options

1. **Enrich at bootstrap + events**: Add agent enrichment to the read model bootstrap, emit events when question state changes
2. **Background poller**: Periodically scan JSONL files and emit `agent.input_needed` / `agent.resolution_changed` domain events
3. **Hybrid**: Keep a REST endpoint for agent details (with enrichment) alongside the RPC snapshot

Option 2 matches T3Code's pattern — the server watches for state changes and emits events rather than the client polling.

## Priority

Critical — core workflow features (planning interaction, stuck detection) are silently broken.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

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

### Phase 3: Generate Artifacts (NO CODE!)
When discovery is complete:
1. Create STATE.md with decisions made
2. Copy STATE.md to implementation plan at `docs/prds/active/{issue-id}-plan.md` (required for dashboard)
3. Create a vBRIEF plan file at `.planning/plan.vbrief.json` (structured machine-readable plan)
4. Summarize the plan and STOP

**DO NOT run `bd create` commands.** Beads tasks are created automatically from `plan.vbrief.json` by Cloister when planning completes.

**IMPORTANT:** Create the plan file BEFORE creating beads tasks.
**NOTE:** `*-spec.md` files are human-written specs — do NOT overwrite them. Your output is `*-plan.md`.

**Remember:** Be a thinking partner, not an interviewer. Ask questions that help clarify.

Start by exploring the codebase to understand the context, then begin the discovery conversation.

<!-- panopticon:orchestration-context-end -->
