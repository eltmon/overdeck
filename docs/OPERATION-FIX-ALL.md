# Operation Fix-All: Mass Agent Oversight & Infrastructure Bug Hunt

## Purpose

A mass `/pan-oversee` operation across ALL active PAN issues simultaneously. The goal is
NOT to manually babysit agents through to completion, but to **identify and fix every
infrastructure bug** preventing the autonomous pipeline from working end-to-end.

## Core Principles

1. **Fix bugs, don't work around them.** If an agent is stuck because infrastructure is broken, fix the infrastructure. Don't manually curl APIs or send tmux keys as a substitute for working code.

2. **Fix the root cause, not symptoms.** If an issue keeps reverting to To Do, find out WHY the status is being reset — don't just re-assign the label.

3. **Manual intervention only for broken state recovery.** After fixing a bug, you may need to manually unstick agents left in a broken state BY that bug. But the fix comes first.

4. **Monitor ALL the way through.** Each issue should flow: In Progress → agent works → `pan work done` → verification → review specialist → test specialist → Done (merge-ready). Watch the full lifecycle.

5. **Every column, every tag, every state must be correct.** Wrong column = bug in status management. Wrong tag = bug in label sync. Fix the code, not the data.

6. **Validate Panopticon by using Panopticon.** Do not directly implement target issue work on `main`, rescue stale feature work by hand, or bypass the agent/review/test/merge pipeline just to clear the board. Infrastructure fixes to Panopticon itself are in scope; feature work under test must complete through Panopticon end-to-end or remain open with a valid blocking reason.

## Scope

- **Target**: ALL PAN issues currently in In Progress and In Review columns
- **Ignore**: MIN (Mind Your Now) and AUR (Auricle) issues — PAN only
- **Goal**: Get every active PAN issue to Done (merge-ready) by fixing every infrastructure bug encountered along the way

## Workflow

### Phase 1: Inventory & Triage

1. Get full state picture:
   - Dashboard API: all agents, their statuses, phases
   - tmux sessions: which agents actually have live processes
   - GitHub labels: which column each issue is in
   - Review status: where each issue is in the specialist pipeline
   - Heartbeats: which agents are actively working

2. Classify each issue:
   - **Healthy**: Agent running, tmux alive, making progress → monitor
   - **Ghost**: `status: running` but no tmux session → bug in crash recovery
   - **Stuck**: Agent at idle prompt, not progressing → check context exhaustion, permission blocks
   - **Pipeline stalled**: Review/test specialist not picking up → bug in specialist dispatch
   - **Wrong column**: Labels don't match actual state → bug in status sync
   - **Reverting**: Issue keeps going back to earlier state → race condition or status reset bug

### Phase 2: Fix Infrastructure Bugs

For each class of problem, investigate root cause and fix the code:

- **Ghost agents**: Fix crash recovery in deacon (`recoverOrphanedAgents`)
- **Planning tag on implementation agents**: Fix KanbanBoard badge logic
- **Done column empty**: Fix store selector over-filtering
- **Review stuck at pending**: Fix specialist dispatch/wake logic
- **Status reverts**: Fix race conditions in complete-planning, start-agent, etc.
- **Agents at idle prompt**: Check if `pan work done` flow or context compaction is failing

### Phase 3: Rebuild, Commit & Restart

After each code fix:
1. **Commit immediately** — every fix gets its own commit. Don't batch fixes. Use conventional commits (`fix(dashboard):`, `fix(deacon):`, etc.)
2. `npm run build` (rebuilds CLI + server + frontend)
3. Restart dashboard: kill server process, then `nohup node dist/dashboard/server.js`
4. **Verify ALL visual fixes in Playwright** — navigate to `https://pan.localhost`, scroll to the affected card/column, and take a screenshot proving the fix works. Text-based evaluation (`browser_evaluate`) is acceptable for data checks, but visual changes MUST have a screenshot.
5. Resume any agents stuck by the old bug

### Phase 4: Monitor Through Completion

After bugs are fixed, monitor each issue through the full pipeline:
- Agent completes work → calls `pan work done`
- Verification gate runs (typecheck, lint, test)
- Review specialist wakes and reviews
- Test specialist runs after review passes
- Issue reaches `readyForMerge: true`
- Flag to user for merge (only humans click merge)

If an issue's code needs changes, those changes must come from the Panopticon-managed work agent path. Do not manually patch the target issue outside the pipeline and then mark it as validation success.

## Using Playwright

Open `https://pan.localhost` in Playwright to visually verify:
- Cards in correct columns
- Tags/badges correct
- Done column populated
- Inspector panel shows correct agent state
- Terminal panel shows live agent output

## Bug Log Template

For each bug found during the operation:

```
### BUG: [Short description]
- **Severity**: Blocker / Bug / Cosmetic
- **Symptom**: What was observed
- **Root cause**: Why it happened
- **Fix**: What code was changed
- **Files**: Which files were modified
- **Verified**: How we confirmed the fix works
```

## Known Recurring Issues

- `complete-planning` race condition with `start-agent` (fixed: checks for running work agent)
- `postMergeLifecycle` infinite rebuild loop (fixed: `skipDeploy` option)
- Ghost agents after crash (fixed: `recoverOrphanedAgents` in deacon startup)
- Done column empty in store selector (fixing: `selectIssuesByCycle` over-filters)
- Planning tag on implementation agents (investigating: badge display logic)

## How to Run This Operation

```bash
# 1. Start Panopticon
pan up

# 2. Open dashboard in Playwright for visual monitoring
# (via Playwright MCP browser_navigate to https://pan.localhost)

# 3. Run inventory (see Phase 1 commands above)

# 4. Fix bugs as found, rebuild, restart, verify

# 5. Resume stuck agents after fixes

# 6. Monitor until all issues reach Done
```

## Exit Criteria

- Every PAN issue in In Progress or In Review has reached Done (merge-ready)
- All infrastructure bugs encountered have been fixed in code (not worked around)
- Dashboard correctly shows all columns, tags, and states
- No ghost agents, no stuck specialists, no wrong labels
- Any issue counted as success completed through the actual Panopticon pipeline, not direct manual implementation
