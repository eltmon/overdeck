# Planning Session: PAN-29

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
- **ID:** PAN-29
- **Title:** Implement merge-agent: Automatic merge conflict resolution
- **URL:** https://github.com/eltmon/panopticon-cli/issues/29

## Description
## Problem

When clicking "Approve & Merge" on an issue with merge conflicts, Panopticon currently shows:
```
Merge conflict! Please resolve manually:
cd /path/to/project
git merge feature-branch
```

Per the Cloister PRD, the `merge-agent` specialist should automatically wake up and resolve conflicts.

## Current State

- **Cloister Phase 1 (PAN-21)** ✅ - Watchdog framework for monitoring agents
- **Cloister Phase 2 (PAN-27)** ✅ - UI for displaying specialist agents
- **Specialist agents themselves** ❌ - Not implemented

The UI scaffolding exists (`SpecialistAgentCard.tsx`, `/api/specialists` endpoints), but no actual specialist agents are running.

## Proposed Solution: merge-agent

### Behavior

When approve workflow encounters a merge conflict:
1. Abort the merge attempt
2. Wake the `merge-agent` (or spawn if not running)
3. Pass context: branch names, conflict files, issue ID
4. merge-agent resolves conflicts using Claude Code
5. On success: continue with merge and push
6. On failure: notify user with details

### Specialist Agent Lifecycle

```
~/.panopticon/specialists/
├── merge-agent/
│   ├── config.json      # Agent configuration
│   ├── session.json     # Claude --resume session ID
│   └── history.jsonl    # Past merge resolutions (for context)
├── review-agent/
│   └── ...
└── test-agent/
    └── ...
```

### Configuration (config.json)

```json
{
  "name": "merge-agent",
  "model": "sonnet",
  "triggerOn": ["merge-conflict", "ci-failure"],
  "autoWake": true,
  "maxContextTokens": 100000,
  "sessionRotation": "weekly"
}
```

### merge-agent Prompt

```markdown
You are a merge specialist. Your job is to resolve git merge conflicts.

Context:
- Target branch: main
- Source branch: feature/pan-27
- Conflict files: [list]
- Issue: PAN-27 (Cloister Phase 2)

Instructions:
1. Analyze each conflict file
2. Understand the intent of both changes
3. Resolve conflicts preserving both intents where possible
4. Run tests to verify resolution
5. Stage and complete the merge
6. Report results
```

### Integration Points

1. **Approve workflow** (`/api/approve`) - Detect conflict, wake merge-agent
2. **Dashboard** - Show merge-agent status, allow manual wake
3. **CLI** - `pan specialist wake merge-agent`
4. **Hooks** - `on-merge-conflict` hook to trigger agent

## Implementation Tasks

- [ ] Create `~/.panopticon/specialists/` directory structure
- [ ] Implement specialist agent spawning with `--resume` support
- [ ] Add merge-agent configuration and prompt template
- [ ] Modify approve workflow to delegate conflicts to merge-agent
- [ ] Add `pan specialist` CLI commands (list, wake, reset, status)
- [ ] Integrate with existing Cloister health monitoring
- [ ] Add merge-agent activity to dashboard Agents tab

## Future Specialists (separate issues)

- **review-agent** - Triggered on PR open, performs code review
- **test-agent** - Triggered on push, runs and reports test results

## References

- Cloister PRD: `docs/PRD-CLOISTER.md`
- Phase 2 UI: PAN-27 (now merged)
- Specialist config: `src/lib/cloister/specialists.ts`

## Priority

P1 - Key workflow improvement, directly requested

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
