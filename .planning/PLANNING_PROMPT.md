<!-- panopticon:orchestration-context-start -->
<!-- This is Panopticon orchestration context injected automatically.
     It contains planning session setup instructions, not agent reasoning.
     Session summarizers should SKIP this block and focus on the agent's
     actual work, decisions, and tradeoffs that follow. -->

# Planning Session: PAN-416

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
- **ID:** PAN-416
- **Title:** Mission Control: conversation launcher with t3code-informed UX
- **URL:** https://github.com/eltmon/panopticon-cli/issues/416

## Description
## Summary

Supersedes PAN-362. Add the ability to **spawn, manage, and resume Claude conversations directly from Mission Control**, informed by t3code's architecture research (`docs/research/t3code-research.md`).

The current workflow for ad-hoc work (crash recovery, cross-issue fixes, system maintenance) requires opening a separate terminal and running Claude there. Costs are unattributed, sessions are invisible to the dashboard, and context is lost when the terminal closes.

## Core Feature: Conversation Launcher

### Spawn from Mission Control
- **"New Conversation" button** in Mission Control header area
- Spawns a Claude session in a tmux session (reuse planning agent spawn infrastructure)
- Session runs in **devroot** (`~/Projects`) by default — not tied to any workspace
- Optional: spawn scoped to a specific project or issue (right-click issue → "Open conversation")

### Integrated Terminal (xterm.js)
- Embed xterm.js terminal panel in Mission Control (same component as PAN-406's XTerminal)
- Full bidirectional terminal — not read-only polling
- Tabs for multiple concurrent conversations
- Resizable/detachable panel (dock bottom, dock right, pop-out)

### Session Persistence & History
- tmux-backed: sessions survive browser close, page navigation, crashes
- **Thread history** — list of past conversations per project, resumable
- Named sessions for easy identification ("crash-recovery-apr-1", "myn-auth-fix")
- SQLite storage for session metadata (name, project, issue, timestamps, cost)

### Cost Attribution
- `PANOPTICON_ISSUE_ID` propagated to spawned sessions
- When working on a specific issue, costs attribute to that issue
- Unscoped conversations attribute to a "general" bucket visible in cost tracking
- Heartbeat hook already captures cost data — just needs proper env propagation

## t3code-Informed Enhancements

From `docs/research/t3code-research.md` — features worth borrowing:

### Supervised Mode (High Priority)
Per-action approval UI for destructive operations. When an agent wants to run `rm`, force push, or db migration — pause and surface approve/deny buttons in the conversation panel. Maps to Codex's `approvalPolicy: on-request`.

### Auth Token on Dashboard (High Priority)  
`pan up --auth-token <token>` to unlock remote access. Currently dashboard is localhost-only. Enables phone/tablet monitoring when away from desk.

### Multi-tab Terminal with Keybindings
t3code's xterm implementation: `Mod+J` toggle, `Mod+D` split, `Mod+N` new tab, `Mod+W` close. Adopt similar keybinding system for conversation tabs.

### Tool Call Noise Reduction
Collapse tool calls into summary boxes (t3code uses `@pierre/diffs` for inline diffs). Reduces visual noise when watching an agent work.

## Technical Notes

- Reuse `createSession()` from planning agent infrastructure for spawning
- Use devroot (`~/Projects`) as default cwd — not a workspace directory
- Terminal WebSocket endpoint already exists (`/ws/terminal?session=<name>`)
- XTerminal.tsx component already exists (484 lines, xterm.js + WebSocket)
- Reuse existing node-pty + tmux attach terminal infrastructure (PAN-417 solved the orphan PTY issue via deferred PTY spawn + stale data suppression)
- Session metadata in SQLite alongside existing cost tracking tables

## Closes

- Supersedes #362 (Interactive Claude terminal in dashboard)
- Related to #406 (live interactive terminal for workspace detail)
- Related to #355 (show terminal by default when clicking issue)

## Context

Research session explored t3code's architecture in depth. Key insight: t3code solves "nice UI for a single agent" while Panopticon solves "autonomous issue-to-merge". The conversation launcher bridges this gap — giving Panopticon users a polished interactive experience for the work that doesn't fit the automated pipeline.

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
