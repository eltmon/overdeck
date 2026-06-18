# PAN-Fix-All: Autonomous Workflow Orchestration with Manual Merge Gates

## Overview

**Fix-All** is a continuous autonomous workflow orchestration system that:

1. **Oversees all In Progress and In Review issues** via repeated `pan-oversee` cycles
2. **Fixes infrastructure bugs on-the-fly** that block autonomous completion
3. **Orchestrates issues through the full pipeline** (work → verify → review → test → ready for merge)
4. **Pauses only at the merge gate** — waiting for user UAT validation before clicking merge
5. **Self-improves** — as the workflow orchestration layer itself is debugged and enhanced, future cycles run faster and more autonomously

## User Experience

### For the User

```
[Dashboard] → "Fix-All" button clicked
                ↓
         Fix-All runs autonomously...
         (Issues flow through pipeline)
                ↓
         "Awaiting Merge" page appears
         (List of PRs ready for UAT + merge)
                ↓
         User optionally clicks frontend link
         (Does UAT on the feature)
                ↓
         User signals done (or agent auto-detects readiness)
                ↓
         Agent clicks merge via Playwright
                ↓
         Issue moves to Done, PR merged
                ↓
         Loop continues (or repeats)
```

### For the System

Fix-All is a **self-improving orchestration loop**:

1. **Cycle N**: Run pan-oversee on all In Progress/In Review
   - Some issues complete autonomously
   - Some hit infrastructure bugs
   - Bugs are identified and recorded

2. **Between Cycles**: Infrastructure improvements
   - Dashboard team (or dedicated agent) fixes bugs found in Cycle N
   - Fixes are committed to main
   - Overdeck itself is working under the workflow (via agents)

3. **Cycle N+1**: Run pan-oversee again
   - More issues complete autonomously (bugs from N are fixed)
   - New classes of bugs emerge
   - System improves incrementally

**Key insight**: Overdeck's workflow orchestration layer is the target of improvement, not separate from it. The system debugs itself.

## Architecture

### Three Core Components

#### 1. All-Up Skill
- Automatically runs `pan-oversee` on all active issues
- Monitors for blockers (agent crashes, specialist dispatch failures, verification gates)
- Identifies and logs infrastructure bugs
- Waits for `readyForMerge: true` status
- Advances to "Awaiting Merge" phase

#### 2. Awaiting Merge Page
A **simple, focused UI** showing:
- **List of PRs ready for merge**
  - Issue number + title
  - PR status (checks passing, review approved)
  - "Open in Playwright" button to review in browser
  
- **Merge action**
  - "Auto-Merge" button (agent uses Playwright to click merge on GitHub)
  - Confirmation modal (requires final approval or auto-proceeds after timeout)

- **Frontend UAT link**
  - Direct link to the deployed feature (if available)
  - Opens in user's browser for manual testing

#### 3. Workflow Orchestration Visibility
- **Infrastructure bug log** — visible in dashboard
  - Bug class, symptom, root cause
  - Fix status (pending, fixed, verified)
- **Cycle metrics**
  - Issues completed in this cycle
  - Blockers encountered
  - Average time through pipeline

### Data Flow

```
Dashboard
  ↓
[All-Up Skill Triggers]
  ↓
[For each issue in In Progress/In Review]
  ├─ Spawn or resume pan-oversee agent
  ├─ Monitor issue through full pipeline
  ├─ Record blockers/bugs
  └─ Advance to "Awaiting Merge" when ready
  ↓
[Awaiting Merge Page]
  ├─ Shows list of merge-ready PRs
  ├─ User clicks UAT link (optional)
  ├─ User signals ready or auto-timeout
  └─ Agent clicks merge via Playwright
  ↓
[Post-Merge]
  ├─ Cleanup (Docker, state)
  ├─ Mark issue as Done
  └─ Repeat (or wait for next cycle)
```

## Detailed Flow

### Phase 1: Oversee All Issues

```typescript
all-up skill runs:
  for each issue in ["In Progress", "In Review"]:
    - Check if agent is running
    - If running: monitor and let it work
    - If crashed/stuck: invoke pan-oversee to resume
    - Poll issue status periodically
    - Record any blockers encountered
```

**Monitoring interval**: 30-60 seconds between checks
**Blocker types** (to log and analyze):
- Agent crashed (no tmux session, but status: running)
- Verification gate failed (typecheck/lint/test)
- Specialist dispatch stalled (review/test agent not starting)
- Status race condition (issue reverted to earlier column)
- Context exhausted (agent at idle, can't proceed)

### Phase 2: Awaiting Merge

When issue status = `readyForMerge: true`:

```
All-Up skill:
  ├─ Advance issue to "Awaiting Merge" state
  ├─ Show PR in Awaiting Merge page
  └─ Wait for user signal
  
User sees Awaiting Merge page:
  ├─ Click "Open in browser" → sees the PR / feature
  ├─ Do UAT validation
  └─ Signal ready (explicit button or auto-advance after timeout)
  
Agent detects ready signal:
  ├─ Open Playwright browser
  ├─ Navigate to PR on GitHub
  ├─ Click "Merge pull request" button
  ├─ Confirm merge
  └─ Wait for merge to complete
  
Post-merge:
  ├─ Run postMergeLifecycle (cleanup, Docker, state)
  ├─ Update issue status to Done
  └─ Advance to next issue
```

### Phase 3: Self-Improvement Loop

Between fix-all cycles:

```
Issues completed in Cycle N
  ↓
Bug log analyzed:
  - Which infrastructure bugs were hit?
  - How often? By which agents?
  - Root causes identified
  ↓
Overdeck infrastructure improved:
  - Cloister agent fixes bugs in its own code
  - Dashboard routes updated
  - Specialist dispatch logic refined
  ↓
Fixes committed to main
  ↓
Cycle N+1 begins:
  - Same operation, better results
  - More issues complete without hitting bugs
  - New bugs emerge (revealing deeper issues)
```

## Awaiting Merge Page Spec

### URL
`/dashboard/awaiting-merge`

### Layout
- **Header**: "Issues Awaiting Merge" + refresh button
- **List** (sortable by issue #, age in awaiting-merge state):
  - Issue card per PR
    - Issue number + title
    - PR checks status (✅ passing, ⚠️ blocked, etc.)
    - Time in "Awaiting Merge" state
    - Two action buttons:
      - "Open in Browser" (opens PR + linked feature frontend)
      - "Merge Now" (shows confirmation, agent clicks merge)

### Data Source
- API endpoint: `GET /api/awaiting-merge`
  - Returns array of `{ issueId, prUrl, checksStatus, timeInState, frontendUrl }`
- Real-time updates via WebSocket (if available) or polling every 10s

### Behavior
- **"Open in Browser"**: Opens a new tab with the PR
- **"Merge Now"**: 
  - Shows modal: "Ready to merge? [Cancel] [Merge Now]"
  - Optional auto-confirm after 30s (user can disable)
  - Agent uses Playwright to click GitHub merge button
- **Auto-refresh**: Page refreshes every 30s to show new issues
- **Completed issues**: Fade out/remove after merge completes

## Benefits

1. **Continuous improvement**: Each cycle fixes bugs, next cycle runs better
2. **No manual work overflow**: User only approves final merge, doesn't babysit
3. **Full pipeline visibility**: Bug log shows exactly where issues get stuck
4. **Autonomous everywhere**: Issues complete without user touching code/issues
5. **Infrastructure debugging**: The system debugs itself as it runs

## Success Metrics

- **Cycle velocity**: Average issues completed per cycle (Target: +20% per cycle)
- **Blocker reduction**: Infrastructure bugs found per cycle (Target: -30% per cycle)
- **Merge readiness**: Issues reaching "Awaiting Merge" without blockers (Target: 80%+)
- **Mean time to merge**: From "readyForMerge" to merged (Target: <5 min, limited by user UAT)

## Acceptance Criteria

### Must Have
- [ ] All-up skill runs autonomously on all In Progress/In Review issues
- [ ] Issues complete full pipeline without user intervention (except merge gate)
- [ ] Awaiting Merge page displays PRs with UAT link and merge action
- [ ] Agent uses Playwright to click GitHub merge button
- [ ] Infrastructure bugs are logged with root cause analysis
- [ ] Dashboard shows "awaiting merge" column/state

### Should Have
- [ ] Bug log visible in dashboard with fix status
- [ ] Cycle metrics (issues completed, blockers, avg pipeline time)
- [ ] Auto-advance (optional timeout after UAT link is opened)
- [ ] Slack notification when PR is awaiting merge

### Nice to Have
- [ ] Workflow orchestration visualization (flow diagram in dashboard)
- [ ] Historical bug database (track patterns across cycles)
- [ ] Suggested fixes for common blockers (in-dashboard hints)

## Implementation Phases

### Phase 1: Core All-Up + Awaiting Merge Page (this issue)
- All-up skill with pan-oversee orchestration
- Awaiting Merge page UI
- Basic Playwright merge integration
- Bug logging

### Phase 2: Infrastructure Visibility
- Cycle metrics dashboard
- Bug log UI + history
- Blocker detection + analysis

### Phase 3: Self-Learning
- Automated bug-fix recommendations
- Workflow analyzer (identifies slow steps)
- Predictive blocker detection

## Related Documents

- **OPERATION-FIX-ALL**: Root principles and manual bug-hunting guide
- **PAN-70**: Original async/sync file system issues in dashboard
- **PAN-446**: Sync filesystem call cleanup (139 calls identified)
- **PAN-328**: postMergeLifecycle infinite loop (idempotency guard added)
