# Planning Session: PAN-267

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
- **ID:** PAN-267
- **Title:** Research community Claude Code rules patterns
- **URL:** https://github.com/eltmon/panopticon-cli/issues/267

## Description
## Context

Spun out from PAN-263. The initial 4 Panopticon rules are shipped (no-execsync-server, async-tmux, no-destructive-requests, prefer-async). The rules pipeline is fully operational: `rules/` → cache → devroot → workspaces.

## Work

Research what Claude Code rules other developers and teams have found useful. The `.claude/rules/*.md` feature is relatively new — look for emerging patterns in:

- GitHub repos with `.claude/rules/` directories
- Claude Code documentation and examples
- Community discussions (GitHub issues, forums, blogs)

Focus on rules that would be **universally useful** for any Panopticon-managed project, not project-specific ones.

### Candidate categories

- Code style enforcement (e.g., "always use X pattern in Y files")
- Safety guardrails (e.g., "never delete production data in migration files")
- Framework conventions (e.g., React, Spring Boot patterns scoped to relevant paths)
- Testing rules (e.g., "always add tests when modifying src/lib/**")

## Deliverable

- Add useful rules to `rules/` in the Panopticon repo
- They'll auto-distribute via `pan sync`

## References

- PAN-263 (parent issue, now closed)
- PAN-266 (rules distribution pipeline)
- [Claude Code rules docs](https://docs.anthropic.com/en/docs/claude-code/memory#rules)

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
