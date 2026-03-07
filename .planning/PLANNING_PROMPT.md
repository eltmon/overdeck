<!-- panopticon:orchestration-context-start -->
<!-- This is Panopticon orchestration context injected automatically.
     It contains planning session setup instructions, not agent reasoning.
     Session summarizers should SKIP this block and focus on the agent's
     actual work, decisions, and tradeoffs that follow. -->

# Planning Session: PAN-302

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
- **ID:** PAN-302
- **Title:** Plan: close dialog after confirming, show INPUT when ready; optional watch checkbox
- **URL:** https://github.com/eltmon/panopticon-cli/issues/302

## Description
## Desired behaviour

The planning dialog works exactly as it does today for the initial interaction. The change is in what happens **after** the user submits it:

1. **Dialog closes immediately** after the user confirms — no more watching the workspace creation / agent spin-up process inside the dialog
2. **Background execution** — workspace creation and the planning agent run in the background as normal
3. **INPUT when ready** — when the agent has completed discovery and needs user input, the `INPUT` prompt appears exactly as it does today

## Optional: watch mode

Add a **checkbox inside the planning dialog** (unchecked by default):

> ☐ Stay and watch planning

- **Unchecked (default)**: dialog closes immediately after confirm; user is notified via INPUT when the agent needs them
- **Checked**: current behaviour is preserved — dialog stays open and the user can watch the agent work in real time

## Why

Most of the time the user doesn't need to watch workspace creation and agent bootstrap. Closing the dialog immediately makes planning feel instant and non-blocking. The checkbox gives power users the option to observe without making it the forced default.

## Acceptance criteria

- [ ] Planning dialog opens and behaves as today for user input
- [ ] After confirming, dialog closes immediately (unless watch checkbox is checked)
- [ ] Planning agent and workspace creation proceed in background
- [ ] INPUT prompt appears when agent is ready for user interaction (unchanged from today)
- [ ] Dialog contains a checkbox "Stay and watch planning" — unchecked by default
- [ ] When checkbox is checked, dialog stays open and shows agent output (current behaviour)

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
2. Copy STATE.md to PRD at `docs/prds/active/{issue-id}-plan.md` (required for dashboard)
3. Create beads tasks with dependencies using `bd create` (include difficulty:LEVEL labels)
4. Summarize the plan and STOP

**IMPORTANT:** Create the PRD file BEFORE creating beads tasks.

**Remember:** Be a thinking partner, not an interviewer. Ask questions that help clarify.

Start by exploring the codebase to understand the context, then begin the discovery conversation.

<!-- panopticon:orchestration-context-end -->
