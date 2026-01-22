# Planning Session: PAN-19

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
- **ID:** PAN-19
- **Title:** pan up: Dashboard fails to start - spawn npm ENOENT
- **URL:** https://github.com/eltmon/panopticon-cli/issues/19

## Description
## Bug Description

Running `pan up` fails to start the dashboard with a `spawn npm ENOENT` error.

## Steps to Reproduce

1. Run `pan install` (completes successfully)
2. Run `pan up`

## Error Output

```
Failed to start dashboard: spawn npm ENOENT

Starting Panopticon...

Starting Traefik...
⚠ Failed to start Traefik (continuing anyway)
  Run with --skip-traefik to suppress this message

Starting dashboard...
  Frontend: https://pan.localhost
  API:      https://pan.localhost/api

Press Ctrl+C to stop
```

The process exits with code 1.

## Environment

- Platform: macOS (darwin)
- Node.js: v20.19.5
- npm: available in PATH
- panopticon-cli installed globally via npm
- Docker: running

## Analysis

The error `spawn npm ENOENT` suggests that npm cannot be found when spawning a child process. This may be a PATH issue when the CLI spawns subprocesses, or npm may need to be resolved differently.

## Workaround Attempted

None found yet.

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
