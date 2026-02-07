# Planning Session: PAN-79

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
- **ID:** PAN-79
- **Title:** Per-project specialist agents with ephemeral lifecycle and persistent logs
- **URL:** https://github.com/eltmon/panopticon-cli/issues/79

## Description
## Problem

Currently there is a single shared set of specialist agents (review-agent, test-agent, merge-agent) that handle work across all projects. This causes issues:

1. **Queueing conflicts** - When multiple projects have work ready for review, they compete for the same review-agent
2. **Context pollution** - Specialists accumulate context from multiple unrelated projects
3. **Scaling bottleneck** - Can only process one review/test/merge at a time across all projects
4. **Project-specific configuration** - Different projects may need different review criteria, test commands, or merge strategies
5. **Wasted resources** - Specialists stay running even when idle, consuming memory and tmux sessions
6. **Lost history** - When specialists crash or are restarted, all context from previous runs is gone

## Proposed Solution

### Per-project specialist structure

Each project should have its own set of specialists:

```
~/.panopticon/specialists/
├── myn/
│   ├── review-agent/
│   ├── test-agent/
│   └── merge-agent/
├── panopticon/
│   ├── review-agent/
│   ├── test-agent/
│   └── merge-agent/
└── househunt/
    ├── review-agent/
    ├── test-agent/
    └── merge-agent/
```

### Ephemeral lifecycle — start, do work, stop

Specialists should NOT be long-running daemons. Instead:

1. **Spawn on demand** — When work is ready (e.g., a review is requested), start the specialist
2. **Do the work** — Run the review/test/merge to completion
3. **Stop completely** — Once finished, the specialist agent fully terminates (no idle sessions)

This is a fundamental shift from the current model where specialists stay running waiting for work. The orchestrator (dashboard/API) is responsible for spawning specialists when needed.

### Persistent run logs

Every specialist run must produce a persistent, viewable log:

```
~/.panopticon/specialists/<project>/<type>/runs/
├── 2026-02-05T14-30-00-review-PAN-79.log
├── 2026-02-04T10-15-00-review-PAN-55.log
├── 2026-02-03T09-00-00-review-PAN-42.log
└── ...
```

- Logs capture the full specialist session output (what the agent did, its reasoning, results)
- Logs are viewable from the dashboard (users should be able to read exactly what the specialist did)
- Logs persist across agent restarts, crashes, and system reboots

### Context seeding on restart

When a specialist starts a new run, it should be seeded with context from its recent history:

- **Review agent** sees summaries of the last N reviews it performed for this project
- **Test agent** sees recent test results and failure patterns
- **Merge agent** sees recent merge history, any conflicts encountered and how they were resolved

This gives specialists "memory" without keeping them running. The logs serve double duty: user-visible audit trail AND context for future runs.

## Benefits

- **Parallel processing** - Multiple projects can have reviews/tests running simultaneously
- **Clean context** - Each specialist only knows about its project
- **Custom prompts** - Projects can override default specialist prompts
- **Independent queues** - Project A's backlog doesn't block Project B
- **Resource efficient** - No idle agents consuming resources
- **Full auditability** - Users can see exactly what every specialist did
- **Resilient memory** - Specialists maintain effective context without persistent sessions
- **Cost savings** - No API costs from idle long-running agent sessions

## Implementation Notes

- Specialist tmux sessions should be named `specialist-<project>-<type>` (e.g., `specialist-myn-review-agent`)
- Session IDs and history should be stored per-project
- Fallback to global specialists if project-specific ones don't exist
- Consider lazy initialization (only create specialists when first needed)
- Log format should be structured enough to extract summaries for context seeding
- Dashboard needs a "Specialist Logs" view per project (or per-specialist tab in project view)
- Configurable log retention (e.g., keep last 30 days or last 50 runs)
- Context seeding should use summarized logs, not raw dumps (to stay within context limits)

## Acceptance Criteria

- [ ] Specialists are created per-project
- [ ] Specialist state (session ID, history) is stored per-project
- [ ] Multiple projects can run reviews in parallel
- [ ] Project-specific prompt overrides are supported
- [ ] Backward compatible with existing global specialists during migration
- [ ] Specialists fully terminate after completing their task
- [ ] Each specialist run produces a persistent log file
- [ ] Logs are viewable from the dashboard UI
- [ ] On startup, specialists are seeded with context from recent runs (configurable N)
- [ ] Log retention is configurable

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
