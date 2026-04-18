---
specialist: verification-gate
issueId: PAN-653
outcome: failed
timestamp: 2026-04-18T14:38:45Z
---

VERIFICATION FAILED for PAN-653 (attempt 1/10):

Failed check: vbrief-ac

Acceptance criteria check FAILED — 33/33 AC incomplete:

### Deacon respect: skip workspaces with stuck=true (3/3 incomplete)
  - [ ] patrolWorkAgentResolutions skips iterations where review_status.stuck = 1 for the agent's issueId
  - [ ] Ephemeral specialist force-kill/respawn path also checks the flag and bails out
  - [ ] Unit test: patrol run with a mocked stuck issue produces zero poke/respawn actions

### Persistent stuck state: schema + upsert helpers (3/3 incomplete)
  - [ ] review_status table has stuck, stuck_reason, stuck_at, stuck_details columns after migration from v16
  - [ ] markWorkspaceStuck / clearWorkspaceStuck helpers exist, roundtrip through SQLite, and persist across dashboard restart
  - [ ] Migration is idempotent (re-running does not error if columns already exist)

### Create git_operations SQLite table and git-activity service (3/3 incomplete)
  - [ ] git_operations table exists with all columns and indexes after fresh init and after migration
  - [ ] appendGitOperation and listGitOperations functions work and are used by the activity API
  - [ ] Rows survive a dashboard process restart

### Thin git-operations helper wrapper module (3/3 incomplete)
  - [ ] gitPush throws MainDivergedError when origin/main is not an ancestor of local main
  - [ ] Every helper call writes exactly one row to git_operations with before/after/remote SHAs populated where applicable
  - [ ] Unit tests cover success, non-fast-forward rejection, and divergence cases using mocked execAsync

### Pre-push divergence guard in approve flow (3/3 incomplete)
  - [ ] Approve flow aborts cleanly on divergence without losing the hotfix commit on origin/main
  - [ ] review_status.stuck is set to 1 with reason='main_diverged' and both SHAs in stuck_details
  - [ ] Integration repro: hotfix push between pull and push is preserved, not clobbered

### Same guard in salvageStrandedMerge + merge-agent push sites (2/2 incomplete)
  - [ ] salvageStrandedMerge aborts and marks stuck when origin/main has advanced beyond what it intended to push
  - [ ] Rebase force-push and auto-revert force-push both emit git.force_push activity events

### Unstick API endpoint and kanban card UI (3/3 incomplete)
  - [ ] POST /unstick clears stuck flag and re-enables Deacon for that workspace
  - [ ] Kanban card shows red border + warning badge when stuck=1
  - [ ] No new kanban lane added; grid remains at 4 columns

### Pattern-match specialist tmux output into activity feed (2/2 incomplete)
  - [ ] User sees 'pushing…', 'rejected non-fast-forward', 'retrying…' events live in the activity panel during an approve
  - [ ] Events are deduped and do not flood the activity table with repeated lines

### Concurrent-merge detection + divergence preview on approve (2/2 incomplete)
  - [ ] Approve flow shows a warning when another approve pushed to main in the last 30s
  - [ ] Divergence preview displays commit count delta after pull, before merge-agent runs

### Activity panel: grouping, filtering, warning pinning (3/3 incomplete)
  - [ ] Activity panel groups by issue/workspace and filters by event type
  - [ ] git.* events survive a dashboard restart and are visible in the panel
  - [ ] Warning and error entries are pinned to the top of the panel

### Kanban stuck count = union of persistent flag + inactivity heuristic (3/3 incomplete)
  - [ ] metrics.today.stuckCount reflects the deduped union
  - [ ] Stat increments by exactly 1 when a divergence-abort fires
  - [ ] Stat decrements by exactly 1 when the unstick button is clicked

### End-to-end integration tests (3/3 incomplete)
  - [ ] Original bug repro test exists and fails on pre-fix code, passes on post-fix
  - [ ] Restart-mid-stuck test confirms persistence across dashboard restart
  - [ ] Concurrent approve test confirms second approve aborts and marks stuck

## REQUIRED: Complete all acceptance criteria BEFORE resubmitting

1. Review the incomplete AC above
2. Implement the missing requirements and write tests
3. Update plan.vbrief.json subItem statuses to 'completed'
4. Commit and push ALL changes
5. ONLY THEN resubmit: pan review request PAN-653 -m "Completed acceptance criteria"

Do NOT resubmit until all AC are completed.
