# Planning Session: PAN-205

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
- **ID:** PAN-205
- **Title:** Convert remaining ~83 execSync calls to async across CLI and lib files
- **URL:** https://github.com/eltmon/panopticon-cli/issues/205

## Description
## Problem

PAN-70 and PAN-72 converted the highest-impact `execSync` calls in the dashboard server, specialists, and health files. However, **~83 `execSync` calls remain across 15 files**, some of which are called from the dashboard server and still block the event loop.

## Remaining execSync calls by file

| File | Count | Impact |
|------|-------|--------|
| `src/cli/commands/install.ts` | 14 | Low (CLI one-shot) |
| `src/lib/tmux.ts` | 13 | **HIGH** (called from dashboard via agents.ts) |
| `src/cli/index.ts` | 8 | Low (CLI entry) |
| `src/cli/commands/setup/hooks.ts` | 8 | Low (CLI one-shot) |
| `src/lib/worktree.ts` | 7 | **MEDIUM** (called during workspace creation) |
| `src/lib/cloister/session-rotation.ts` | 5 | **HIGH** (called from dashboard cloister) |
| `src/cli/commands/work/approve.ts` | 5 | Low (CLI) |
| `src/cli/commands/beads.ts` | 4 | Low (CLI) |
| `src/lib/dns.ts` | 3 | Medium (called during workspace setup) |
| `src/cli/commands/update.ts` | 3 | Low (CLI) |
| `src/cli/commands/sync.ts` | 3 | Low (CLI) |
| `src/cli/commands/doctor.ts` | 3 | Low (CLI) |
| `src/lib/skills-merge.ts` | 2 | Low |
| `src/cli/commands/work/issue.ts` | 2 | Low (CLI) |
| `src/lib/cloister/handoff.ts` | 1 | Medium |
| `src/dashboard/server/index.ts` | 1 | Low (1 remaining) |

## Priority

High-impact files that block the dashboard event loop:
1. **`tmux.ts`** — `createSession()`, `killSession()`, `sendKeys()`, `capturePane()` are all sync and called from the async dashboard server
2. **`session-rotation.ts`** — cloister rotation runs on the dashboard
3. **`worktree.ts`** — workspace creation blocks during git operations

CLI-only files (`cli/commands/*`) are lower priority since they're one-shot commands.

## Approach

Follow the same pattern established by PAN-70:
```typescript
// Before
const output = execSync('cmd', { encoding: 'utf-8' });

// After  
const { stdout: output } = await execAsync('cmd', { encoding: 'utf-8' });
```

For `tmux.ts`, this means making `createSession()`, `killSession()`, `sendKeys()`, and `capturePane()` async — which will cascade to all callers in `agents.ts`, `convoy.ts`, etc.

## Context

- PAN-70: Converted ~70 calls in server/index.ts, specialists.ts, health.ts
- PAN-72: Converted remaining cloister calls in triggers.ts, handoff-context.ts, plan.ts
- This issue covers the remaining tail

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
