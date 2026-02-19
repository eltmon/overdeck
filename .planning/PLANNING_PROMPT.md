# Planning Session: PAN-142

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
- **ID:** PAN-142
- **Title:** PAN-141: Remove opencode, codex, cursor, gemini sync targets - consolidate on Claude Code only
- **URL:** https://github.com/eltmon/panopticon-cli/issues/142

## Description
## Summary

We've decided to use Claude Code as the sole AI coding tool, with claude-code-router handling alternative models. The multi-runtime sync support (opencode, codex, cursor, gemini) is no longer needed and adds maintenance burden.

## What to remove

- **`src/lib/paths.ts`**: Remove `CODEX_DIR`, `CURSOR_DIR`, `GEMINI_DIR`, `OPENCODE_DIR` and their `SYNC_TARGETS` entries. Keep only `claude`.
- **`src/lib/sync.ts`**: Simplify — no longer need to handle multiple runtimes
- **`src/cli/commands/sync.ts`**: Simplify runtime loop (or remove it entirely since there's only one target)
- **`~/.panopticon/config.toml`**: `targets` field becomes unnecessary (always claude)
- **Clean up `~/.opencode/skills/`** etc. — remove any synced symlinks

## Context

- Alternative models are accessed via [claude-code-router](https://github.com/musistudio/claude-code-router), not separate tools
- opencode, codex, cursor, gemini targets were aspirational but we've standardized on Claude Code
- Simplifying this reduces code surface and config confusion
- The crash fixed in 843ad26 was caused by opencode being in config but not in SYNC_TARGETS — removing multi-target eliminates this class of bug entirely

## Acceptance Criteria

- [ ] Only `claude` sync target remains
- [ ] Config `[sync].targets` is either removed or defaults to `["claude"]`
- [ ] Synced symlinks in `~/.opencode/`, `~/.codex/`, `~/.cursor/`, `~/.gemini/` are cleaned up
- [ ] Tests updated

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
