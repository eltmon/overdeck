<!-- panopticon:orchestration-context-start -->
<!-- This is Panopticon orchestration context injected automatically.
     It contains planning session setup instructions, not agent reasoning.
     Session summarizers should SKIP this block and focus on the agent's
     actual work, decisions, and tradeoffs that follow. -->

# Planning Session: PAN-444

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
- **ID:** PAN-444
- **Title:** Auto-deploy: rebuild + restart dashboard server after merge to main
- **URL:** https://github.com/eltmon/panopticon-cli/issues/444

## Description
## Problem

After merging a feature branch to main, the running dashboard server has stale code-split chunk references. tsdown generates content-hashed filenames (e.g., `close-issue-BVnGI6Mw.js`). When new code merges, the hashes change but the running server still references the old filenames → `ERR_MODULE_NOT_FOUND`.

This broke PAN-440's post-merge lifecycle:
```
[merge-agent] Could not move issue to Done: Cannot find module 'close-issue-BVnGI6Mw.js'
[merge] Error: TypeError: onMergeComplete is not a function
```

The old esbuild build produced a single `server.js` file — no chunk hash issues. The tsdown migration (PAN-432) introduced code splitting which creates this problem.

## Required: Post-Merge Auto-Deploy

After every merge to main, the system should automatically:

1. **`npm run build`** — rebuild CLI + server + frontend
2. **Restart dashboard server** — kill old process, start new one
3. **`npm link`** — update global `pan` command to new build
4. **Verify** — health check passes

## Options

### Option 1: Git post-merge hook
```bash
# .git/hooks/post-merge
npm run build && npm link
# Restart server if running
lsof -ti:3011 | xargs kill 2>/dev/null
nohup node dist/dashboard/server.js > /tmp/pan-server.log 2>&1 &
```

### Option 2: Cloister post-merge lifecycle step
The merge-agent's `postMergeLifecycle` already runs after merge. Add a build+restart step before issue state transition. This ensures the server has new code before trying to update issue state.

### Option 3: File watcher / auto-build daemon
Watch `main` branch for changes, auto-build on push. Overkill for single-developer but robust.

## Recommendation

Option 2 is the right fix — the merge-agent already orchestrates post-merge. Add build+restart as the FIRST step in postMergeLifecycle, before any issue state changes that depend on new code.

## Immediate Workaround

Until this is fixed, manually run after each merge:
```bash
npm run build && npm link
# Restart dashboard
lsof -ti:3011 | xargs kill; nohup node dist/dashboard/server.js &
```

## Related

- PAN-432 introduced code splitting (tsdown migration)
- Affects every merge, not just PAN-440

🤖 Generated with [Claude Code](https://claude.com/claude-code)

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
