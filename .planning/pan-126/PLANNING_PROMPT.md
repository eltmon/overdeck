# Planning Session: PAN-126

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
- **ID:** PAN-126
- **Title:** pan work issue should use remote workspaces when configured
- **URL:** https://github.com/eltmon/panopticon-cli/issues/126

## Description
## Problem

`pan work issue` doesn't integrate with the remote workspace system (exe.dev VMs). 

The global config has `default_location = "remote"` but `pan work issue` bypasses this and always runs locally because:

1. It calls `spawnAgent()` directly
2. It doesn't check the workspace config `default_location` setting
3. The `pan workspace` command has remote workspace logic, but `pan work issue` doesn't use it

## Current Behavior

```bash
pan config set default_location remote  # User sets remote preference
pan work issue PAN-XXX                   # Agent runs locally anyway
```

## Expected Behavior

When `default_location = "remote"`:
1. `pan work issue` should check the config
2. If remote, create/use remote workspace via exe.dev
3. Spawn agent in the remote workspace

## Related

- PAN-125: Remote Workspaces exe.dev Integration (infrastructure)
- This issue: Wire `pan work issue` to USE the remote workspace infrastructure

## Files to Modify

- `src/cli/commands/work/issue.ts` - Check `default_location` config
- Potentially call `createRemoteWorkspace()` from workspace.ts

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
