# Planning Session: PAN-242

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
- **ID:** PAN-242
- **Title:** Sync with Main: propagate hotfixes to active workspaces via merge agent
- **URL:** https://github.com/eltmon/panopticon-cli/issues/242

## Description
## Problem

When a hotfix is merged to main, active feature workspaces have no way to pick up those changes. The user must manually merge into each workspace branch — or worse, the workspace runs with stale main code and hits bugs that were already fixed.

Real example: MIN-693 (Service Worker stale cache bug) blocks MIN-678, but after fixing on main there's no mechanism to propagate that fix into the MIN-678 workspace.

## Solution

Add a **"Sync with Main"** action that merges the latest main into the workspace branch, routed through the **merge agent**. Must be available via **both** CLI skill and dashboard UI.

---

## Design Decisions (already made — do not revisit)

### 1. Git Strategy: Merge, NOT Rebase

Use `git merge main`. Do NOT use `git rebase`.

**Why merge:**
- Workspaces have running agents with local state tied to commit SHAs. Rebase rewrites those SHAs, breaking agent state.
- Force-push (required after rebase) is a destructive automated operation — too risky.
- Merge commits serve as clear audit markers: "main was synced into this branch at this point."
- Feature branches are squash-merged to main anyway, so intermediate merge commits don't pollute main's history.

### 2. Validation: Git + Conflict Resolution Only

Do NOT run tests or builds after the merge. Only validate that the git merge completed cleanly.

**What validation includes:**
- Merge committed successfully (no unresolved conflicts)
- No leftover conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) in any files
- Merge agent attempts auto-resolution of conflicts using project context. If it cannot resolve, it reports the conflicts back to the user and aborts (`git merge --abort`).

**What validation does NOT include:**
- No test suite execution
- No build/compile verification
- No lint checks

**Why skip tests/builds:** The feature branch is work-in-progress. Tests may already be broken from the agent's own incomplete work. Running validation would either fail from pre-existing issues (not the merge's fault) or take a long time for no benefit. This is syncing INTO a feature branch, not merging TO main — different quality bar.

### 3. Container Restart: Decoupled from Merge, User-Prompted

The merge and the container restart are **two separate operations**. The merge is the core operation. The restart is optional and may fail independently.

**Flow after successful merge:**
1. Report merge result (commit count, changed files)
2. If workspace containers are running, **prompt the user**: "Merge succeeded. Restart containers to pick up changes? (Note: agent's code may be in a non-compiling state)"
3. User chooses: Yes or No
4. If Yes and restart succeeds → report success
5. If Yes and restart fails → report: "Merge: succeeded. Container restart: failed (build error). The merge is preserved — the workspace agent will pick up changes on their next build."

**Critical rule: NEVER revert a successful merge because of a container restart failure.** The merge was a deliberate human decision. A failed restart is a separate issue (agent's WIP code doesn't compile, missing dependency, etc.) — not a merge failure.

### 4. No Future Enhancements in Scope

The following were considered and explicitly rejected:
- **Auto-sync** (auto-merge main when commits land): Too chaotic. 20 unrelated features merging while an agent works = noise. Sync is a deliberate human decision.
- **Selective sync / cherry-pick** (pick specific commits from main): Creates Frankenstein branches where some of main is present and some isn't. If you need something from main, merge all of main.
- **Batch sync** ("sync all workspaces" button): Same chaos problem as auto-sync. Sync each workspace deliberately.
- **Agent notifications** (alert other agents about synced changes): Adds noise. The orchestrator knows what's in flight and sequences work. Agents can't act on "this affects you" intelligently.

Do not plan, design, or stub out any of these. They are out of scope.

---

## Implementation

### CLI Skill

```bash
/pan-sync-main PAN-XXX    # Sync workspace PAN-XXX with latest main
pan sync-main PAN-XXX      # CLI equivalent
```

This is the primary interface. The CLI must work independently of the dashboard.

### Dashboard UI

The "Sync with Main" button on the workspace detail pane calls the same underlying operation as the CLI.

- **Button**: "Sync with Main" on workspace detail pane
- **Tooltip**: "Merge latest main into workspace branch to pick up hotfixes"
- **States**: idle → syncing (spinner) → success / conflict / error
- Show summary of what was pulled in (commit count, files changed)

Both CLI and dashboard are required deliverables — neither is optional.

### Merge Agent Flow

1. User triggers sync (CLI skill or dashboard button)
2. Request queued to the **merge agent** for that project
3. Merge agent:
   a. Checks for uncommitted changes in workspace → block with warning if found
   b. Fetches latest `main`
   c. Runs `git merge main` on the workspace branch
   d. If conflicts: attempts auto-resolution using project context
   e. If conflicts unresolvable: aborts (`git merge --abort`), reports conflicts to user
   f. If merge succeeds: scans all changed files for leftover conflict markers
   g. Reports result: success/failure, commit count, changed files summary
4. If merge succeeded and containers are running: prompt user about restart (see section 3 above)

### Why the Merge Agent

- Already has full context of the project's merge history and branch topology
- Understands conflict resolution patterns for the specific codebase
- Keeps all branch operations (merge to main, sync from main) centralized in one specialist
- Can make intelligent decisions about conflict resolution vs. flagging for human review

---

## Acceptance Criteria

### CLI
- [ ] `/pan-sync-main PAN-XXX` CLI skill triggers merge of main into workspace branch
- [ ] `pan sync-main PAN-XXX` CLI command equivalent works
- [ ] CLI reports merge result: commit count, changed files
- [ ] CLI works independently of the dashboard

### Dashboard
- [ ] "Sync with Main" button on workspace detail pane
- [ ] Button shows sync status: idle / syncing (spinner) / success / conflict / error
- [ ] Success view shows commit count and changed files summary
- [ ] Conflict view shows which files conflicted

### Git Operation
- [ ] Uses `git merge main` (NOT rebase)
- [ ] Blocks if workspace has uncommitted changes (with clear warning message)
- [ ] Merge agent attempts auto-resolution of conflicts
- [ ] Unresolvable conflicts: `git merge --abort`, reports conflicts to user
- [ ] After merge: scans for leftover conflict markers (`<<<<<<<` / `=======` / `>>>>>>>`)
- [ ] If markers found: treats as failed merge, aborts
- [ ] No-op with "Already up to date" if main hasn't changed

### Container Restart (Decoupled)
- [ ] After successful merge, prompts user about container restart (not automatic)
- [ ] Restart failure reported separately from merge result
- [ ] Successful merge is NEVER reverted due to restart failure

### Logging & Docs
- [ ] Operation logged in workspace activity feed
- [ ] Documentation: CLI skill usage and examples
- [ ] Documentation: Workspace management — when to sync, what it does, what it doesn't do
- [ ] Documentation: Merge agent — new sync-from-main capability alongside existing merge-to-main
- [ ] Documentation: Architecture — data flow from CLI/UI → queue → merge agent → git → optional restart

## Edge Cases

- Workspace has uncommitted changes → block with warning, do not merge
- Workspace branch has diverged significantly from main → warn about potential conflicts before proceeding
- Multiple workspaces request sync simultaneously → merge agent queues them sequentially
- Main hasn't changed since workspace was created → no-op: "Already up to date"
- Workspace is stopped/archived → git-only operation, skip container restart prompt
- Container restart fails after successful merge → report failure, preserve the merge
- Agent's WIP code doesn't compile after merge → not a merge failure, agent handles on next build

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
