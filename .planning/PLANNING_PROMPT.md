<!-- panopticon:orchestration-context-start -->
<!-- This is Panopticon orchestration context injected automatically.
     It contains planning session setup instructions, not agent reasoning.
     Session summarizers should SKIP this block and focus on the agent's
     actual work, decisions, and tradeoffs that follow. -->

# Planning Session: PAN-366

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
- **ID:** PAN-366
- **Title:** Review & Test / Merge buttons should be per-issue, not globally locked
- **URL:** https://github.com/eltmon/panopticon-cli/issues/366

## Description
## Problem

The dashboard pipeline UX has several issues that make it confusing to manage multiple issues simultaneously.

### Already Fixed
- ~~Review & Test button disables for ALL issues when any single issue is being reviewed~~ (fixed in 7237ac4 — button now only disables during the HTTP request for THAT click)

### Still Open

#### 1. INPUT tag shows during active merge (wrong)
The INPUT tag appears on issue cards when the merge-agent is actively merging. INPUT should ONLY appear when genuine human attention is needed:
- Planning agent asking a question
- Work agent finished, waiting for merge approval (`readyForMerge`)
- Agent stuck and needs help
- Specialist requesting human review

It should NOT show INPUT during active merge, active review, active testing, or any automated pipeline phase.

#### 2. Queue position display
When clicking Review & Test, the issue should show its position in the queue:
- **Idle**: Normal button, clickable
- **Queued**: Shows "Queued" or "Queued (2nd)" — not a spinner
- **Active** (specialist processing THIS issue): Shows spinner + "Reviewing..." / "Testing..." / "Merging..."
- **Complete**: Shows result (passed/failed)

The specialist API should return which issue it's currently processing so the UI can distinguish "queued" from "active."

#### 3. Stale state recovery
If `testStatus: "testing"` or `reviewStatus: "reviewing"` but no specialist tmux session exists (crash, reboot), the status stays stuck permanently with a spinner. Need auto-reset:
- On status poll, if status is `reviewing`/`testing` for >10 minutes with no specialist activity, auto-reset to `pending`
- Or the server should detect dead specialist sessions and reset affected issue statuses on startup

## Technical Notes

### INPUT tag logic
Find where the INPUT tag/label is determined in the dashboard frontend. It likely checks agent state or pipeline state. Restrict it to only the conditions listed above.

### Queue position
The specialist queue exists in the backend (`checkSpecialistQueue`, `getNextSpecialistTask`). Need to:
1. Expose queue position in the review-status API response
2. Frontend reads queue position and displays it instead of a spinner

### Stale state
Add to server startup (`[startup]` section in index.ts):
- Scan all issues with `reviewing`/`testing` status
- Check if the corresponding specialist tmux session exists
- If not, reset to `pending`

Also add to deacon patrol:
- If an issue has been in `reviewing`/`testing` for >10min and no specialist is active for that issue, reset

## Files
- `src/dashboard/frontend/src/components/InspectorPanel.tsx` — button state, status display
- `src/dashboard/frontend/src/components/KanbanBoard.tsx` — INPUT tag logic on cards
- `src/dashboard/server/index.ts` — review-status API, startup cleanup
- `src/lib/cloister/deacon.ts` — stale state detection in patrol

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
3. Create beads tasks with dependencies using `bd create` (include difficulty:LEVEL labels)
4. Summarize the plan and STOP

**IMPORTANT:** Create the plan file BEFORE creating beads tasks.
**NOTE:** `*-spec.md` files are human-written specs — do NOT overwrite them. Your output is `*-plan.md`.

**Remember:** Be a thinking partner, not an interviewer. Ask questions that help clarify.

Start by exploring the codebase to understand the context, then begin the discovery conversation.

<!-- panopticon:orchestration-context-end -->
