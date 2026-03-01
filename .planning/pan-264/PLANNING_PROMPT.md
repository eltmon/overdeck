# Planning Session: PAN-264

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
- **ID:** PAN-264
- **Title:** Audit localias references across all code and documentation
- **URL:** https://github.com/eltmon/panopticon-cli/issues/264

## Description
## Context

MYN previously used `localias` for local development domain management but migrated to Panopticon's Traefik-based routing. There is a MYN skill (`no-localias`) that reminds agents not to use localias, but there may still be stale references to localias in code, documentation, configuration files, or comments across all repos.

The `no-localias` skill remains in MYN's project template at `myn/infra/.agent-template/.claude/skills/no-localias/`. It is MYN-specific and should NOT be promoted to Panopticon.

## Work Required

1. Search ALL repos (panopticon-cli, myn/frontend, myn/api, myn/infra, myn/docs, myn/splash, myn/meta) for any references to `localias`
2. Remove or update stale references — config files, documentation, comments, scripts
3. Verify the `no-localias` skill itself is accurate and up-to-date
4. Once no references remain, evaluate whether the `no-localias` skill is still needed or can be retired

## Repos to Search

- `~/Projects/panopticon-cli`
- `~/Projects/myn/frontend`
- `~/Projects/myn/api`
- `~/Projects/myn/infra`
- `~/Projects/myn/docs`
- `~/Projects/myn/splash`
- `~/Projects/myn/meta`

## References

- MYN skill: `myn/infra/.agent-template/.claude/skills/no-localias/SKILL.md`
- Domain convention: `.localhost` TLD (auto-resolves to 127.0.0.1, no /etc/hosts needed)
- Panopticon uses Traefik for reverse proxy and SSL handling

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
