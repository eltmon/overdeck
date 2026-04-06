<!-- panopticon:orchestration-context-start -->
<!-- This is Panopticon orchestration context injected automatically.
     It contains planning session setup instructions, not agent reasoning.
     Session summarizers should SKIP this block and focus on the agent's
     actual work, decisions, and tradeoffs that follow. -->

# Planning Session: PAN-485

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
- **ID:** PAN-485
- **Title:** Add workspace lifecycle events to fix stale UI after wipe/cleanup/abort
- **URL:** https://github.com/eltmon/panopticon-cli/issues/485

## Description
## Problem

Several workspace operations complete on the backend but don't emit domain events, so the frontend stays stale until the tracker poll cycle fires (1–3s delay). Classic symptom: wipe a workspace, card doesn't update until manual refresh.

## Root Cause

The event-sourced architecture is correct, but these routes rely on `issueDataService.invalidateTracker()` as the primary signal instead of emitting domain events:

| Operation | Route | Should Emit | Actually Emits |
|---|---|---|---|
| Deep wipe | `POST /api/issues/:id/deep-wipe` | `workspace.destroyed` | ❌ relies on tracker poll |
| Cleanup workspace | `POST /api/issues/:id/cleanup-workspace` | `workspace.deleted` | ❌ nothing at all |
| Abort planning | `POST /api/issues/:id/abort-planning` | `agent.stopped` for planning agent | ❌ nothing |
| Start planning (workspace created) | `POST /api/issues/:id/start-planning` | `workspace.created` | ❌ nothing |

## Fix

### 1. Add events to contracts (`packages/contracts/src/events.ts`)
```ts
{ type: 'workspace.created';    payload: { issueId: string; workspacePath: string } }
{ type: 'workspace.deleted';    payload: { issueId: string } }
{ type: 'workspace.destroyed';  payload: { issueId: string } }
{ type: 'workspace.wipe_started'; payload: { issueId: string } }
```

### 2. Emit in routes
- `deep-wipe`: emit `workspace.wipe_started` at start, `workspace.destroyed` + `agent.stopped` (for planning agent if present) at completion
- `cleanup-workspace`: emit `workspace.deleted`
- `abort-planning`: emit `agent.stopped` for the planning agent when `tmux kill-session` fires
- `start-planning`: emit `workspace.created` after worktree is set up

### 3. Add reducers (`packages/contracts/src/event-reducers.ts`)
- `workspace.destroyed` / `workspace.deleted` → remove agent entries for the issue, reset `canonicalStatus` to `todo`
- `workspace.wipe_started` → set issue to a `wiping` transitional state so UI shows spinner immediately
- `workspace.created` → set issue status to `planning`

### 4. Frontend: react to new events directly
Workspace card should update the moment the event arrives — tracker invalidation stays as a consistency backstop, not the primary signal.

## Acceptance Criteria
- [ ] Wipe a workspace → card updates immediately (no refresh needed)
- [ ] Cleanup workspace → card updates immediately
- [ ] Abort planning → planning agent disappears from agent list immediately
- [ ] Start planning → workspace card transitions to planning state immediately
- [ ] All new events appear in the event store audit log

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
3. Create a vBRIEF plan file at `.planning/plan.vbrief.json` — **MUST follow the exact format below**
4. Summarize the plan and STOP

**DO NOT run `bd create` commands.** Beads tasks are created automatically from `plan.vbrief.json` by Cloister when planning completes.

### vBRIEF Plan Format (REQUIRED)

The plan file MUST conform to vBRIEF v0.5 spec (https://github.com/deftai/vBRIEF).
It MUST have exactly two top-level keys: `vBRIEFInfo` and `plan`.

```json
{
  "vBRIEFInfo": {
    "version": "0.5",
    "created": "<ISO 8601 timestamp>",
    "author": "panopticon-cli/0.0.0",
    "description": "Plan for PAN-485: <issue title>"
  },
  "plan": {
    "id": "pan-485",
    "title": "<issue title>",
    "status": "approved",
    "uid": "<generate a UUID v4>",
    "author": "agent:claude-opus-4-6",
    "sequence": 1,
    "created": "<ISO 8601 timestamp — same as vBRIEFInfo.created>",
    "updated": "<ISO 8601 timestamp — same as created>",
    "references": [
      { "uri": "https://github.com/eltmon/panopticon-cli/issues/485", "label": "PAN-485", "type": "issue" }
    ],
    "tags": ["<relevant tags>"],
    "narratives": {
      "Problem": "<what problem this solves>",
      "Proposal": "<the approach chosen>"
    },
    "items": [
      {
        "id": "<short-kebab-id>",
        "title": "<task title>",
        "status": "pending",
        "priority": "medium",
        "created": "<ISO 8601 timestamp>",
        "metadata": {
          "difficulty": "trivial|simple|medium|complex|expert",
          "issueLabel": "pan-485"
        },
        "narrative": { "Action": "<what needs to be done>" },
        "subItems": [
          {
            "id": "<parent-id>.ac1",
            "title": "<specific testable acceptance criterion>",
            "status": "pending",
            "metadata": { "kind": "acceptance_criterion" }
          }
        ]
      }
    ],
    "edges": [
      { "from": "<source-item-id>", "to": "<target-item-id>", "type": "blocks" }
    ]
  }
}
```

**CRITICAL vBRIEF rules:**
- The file MUST have `vBRIEFInfo` and `plan` as the ONLY top-level keys
- `plan.id` MUST be the issue ID in lowercase (e.g., "pan-485")
- `plan.uid` MUST be a freshly generated UUID v4
- Do NOT use `issue`, `issueId`, or `issue_id` — use `plan.id`
- `items[].status` MUST be one of: draft, proposed, approved, pending, running, completed, blocked, cancelled
- Acceptance criteria MUST be `subItems` with `metadata.kind: "acceptance_criterion"`
- `metadata.difficulty` and `metadata.issueLabel` are Panopticon extensions to the vBRIEF spec
- Edge types: `blocks` (hard dependency), `informs` (soft), `invalidates`, `suggests`

**IMPORTANT:** Create the plan file BEFORE creating beads tasks.
**NOTE:** `*-spec.md` files are human-written specs — do NOT overwrite them. Your output is `*-plan.md`.

**Remember:** Be a thinking partner, not an interviewer. Ask questions that help clarify.

Start by exploring the codebase to understand the context, then begin the discovery conversation.

<!-- panopticon:orchestration-context-end -->
