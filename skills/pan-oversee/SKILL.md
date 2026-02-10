---
name: pan-oversee
description: Actively supervise an agent through the full work lifecycle, fixing infrastructure issues as they arise
triggers:
  - oversee issue
  - oversee agent
  - supervise agent
  - watch agent workflow
  - monitor issue lifecycle
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Task
---

# Pan Oversee — Active Agent Supervision

## Purpose

Actively supervise an agent working on an issue through the **entire lifecycle**:
`spawn/resume → work → completion → review → feedback loop → test → merge-ready`

This is NOT passive monitoring — you actively watch for breakdowns at each stage
and fix the underlying Panopticon infrastructure code when something fails.

## Usage

```
/pan-oversee PAN-129
```

The argument is an issue ID (e.g. PAN-129). The skill handles the rest.

## Phase Detection (CRITICAL — Always Run First)

Before doing anything, detect what phase the issue is currently in. **Do NOT assume the issue is at the beginning.** Run all checks and jump to the correct phase.

```bash
ISSUE_ID="PAN-{ID}"
ISSUE_LOWER=$(echo "$ISSUE_ID" | tr '[:upper:]' '[:lower:]')

echo "=== Phase Detection for $ISSUE_ID ==="

# 1. Dashboard running?
DASHBOARD=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3011/api/health 2>/dev/null)
echo "Dashboard: $DASHBOARD"

# 2. Workspace exists?
WS_PATH=""
for dir in ~/.panopticon/workspaces/feature-$ISSUE_LOWER /home/eltmon/projects/*/workspaces/feature-$ISSUE_LOWER; do
  if [ -d "$dir" ]; then WS_PATH="$dir"; break; fi
done
echo "Workspace: ${WS_PATH:-NONE}"

# 3. Agent state?
AGENT_STATE=$(cat ~/.panopticon/agents/agent-$ISSUE_LOWER/state.json 2>/dev/null)
echo "Agent state: ${AGENT_STATE:-NONE}"

# 4. Tmux session?
TMUX_SESSION=$(tmux list-sessions 2>/dev/null | grep -i "$ISSUE_LOWER" | head -1)
echo "Tmux: ${TMUX_SESSION:-NONE}"

# 5. Completion marker?
COMPLETED=$(ls ~/.panopticon/agents/agent-$ISSUE_LOWER/completed 2>/dev/null)
echo "Completed: ${COMPLETED:-NO}"

# 6. Review/test/merge status?
REVIEW_STATUS=$(curl -s http://localhost:3011/api/workspaces/$ISSUE_ID/review-status 2>/dev/null)
echo "Review status: $REVIEW_STATUS"

# 7. Specialist activity?
SPECIALISTS=$(curl -s http://localhost:3011/api/specialists 2>/dev/null)
echo "Specialists: $SPECIALISTS"
```

### Phase Decision Matrix

Based on the checks above, determine the current phase:

| Condition | Current Phase | Jump To |
|-----------|--------------|---------|
| No workspace, no agent state | Not started | Phase 0 → Phase 1 |
| Workspace exists, agent active + tmux running | Agent working | Phase 2 |
| Workspace exists, agent active, no tmux | Agent crashed/stuck | Phase 2 (recovery) |
| Workspace exists, agent stopped, no completion | Agent gave up or crashed | Phase 1 (resume) |
| Completion marker exists, reviewStatus = "pending" or "reviewing" | Awaiting review | Phase 4 |
| reviewStatus = "failed", work agent has feedback | Feedback loop | Phase 5 |
| reviewStatus = "passed", testStatus = "pending" or "testing" | Awaiting tests | Phase 6 |
| reviewStatus = "passed", testStatus = "passed" | Merge ready | Phase 7 |
| reviewStatus = "passed", testStatus = "failed" | Test failed | Phase 5 (test feedback) |
| mergeStatus = "merged" | Done | Report success |

**Print which phase you're entering and why**, e.g.:
> "Issue PAN-129 is in Phase 4 (review pending) — reviewStatus is 'reviewing', skipping to monitor review agent."

## Supervision Workflow

### Phase 0: Pre-flight Check

Only needed if dashboard isn't running or Cloister isn't active.

```bash
# Dashboard running?
curl -s http://localhost:3011/api/health | jq .

# Cloister running? (needed for specialist handoffs)
curl -s http://localhost:3011/api/cloister/status | jq '{running, lastCheck}'

# Specialists initialized?
curl -s http://localhost:3011/api/specialists | jq '.[] | {name, state, isRunning}'
```

If workspace doesn't exist, create it:
```bash
pan workspace create PAN-{ID}
```

If Cloister isn't running, start it:
```bash
curl -s -X POST http://localhost:3011/api/cloister/start
```

### Phase 1: Spawn or Resume Agent

Check if agent exists and resume or spawn:

```bash
# If agent state exists and has a session ID — resume
pan work resume PAN-{ID}

# If no agent state — spawn fresh
curl -s -X POST http://localhost:3011/api/agents \
  -H 'Content-Type: application/json' \
  -d '{"issueId": "PAN-{ID}"}'
```

Or use the dashboard UI via Playwright:
1. Navigate to `https://pan.localhost`
2. Find the issue card for PAN-{ID}
3. Click "Start Agent" or "Resume"

### Phase 2: Monitor Work Phase

Poll the agent's activity every 30-60 seconds. Watch for:

**Signs of progress:**
- tmux pane shows tool calls, file edits, test runs
- `lastActivity` timestamp in state.json is updating
- Heartbeat file is fresh: `~/.panopticon/heartbeats/agent-pan-{ID}.json`

**Signs of trouble:**
- No output change for > 5 minutes → agent may be stuck
- Error messages in tmux output
- Agent asking questions with no one to answer
- Auth errors (wrong API key, provider issues)

**Monitoring commands:**
```bash
# Watch live output (non-blocking)
tmux capture-pane -t agent-pan-{ID} -p -S -30

# Check heartbeat freshness
cat ~/.panopticon/heartbeats/agent-pan-{ID}.json 2>/dev/null | jq '{timestamp, tool_name, current_task}'

# Check activity log
curl -s http://localhost:3011/api/agents/agent-pan-{ID}/activity | jq '.[-3:]'
```

**If stuck:** Poke the agent or send a message:
```bash
pan work tell PAN-{ID} "Are you stuck? Please continue working on the task."
```

### Phase 3: Watch for Completion Signal

The agent should eventually run `pan work done PAN-{ID}`. Watch for:

```bash
# Check if completed marker exists
ls -la ~/.panopticon/agents/agent-pan-{ID}/completed 2>/dev/null

# Check review status (set by `pan work done`)
curl -s http://localhost:3011/api/workspaces/PAN-{ID}/review-status | jq .
```

**Expected state after completion:**
- `completed` file exists in agent state dir
- Review status: `{ reviewStatus: "reviewing" | "pending", testStatus: "pending" }`
- GitHub issue has "In Review" label or status

**Common failures at this stage:**
- Agent doesn't call `pan work done` — it just stops
- Agent calls it but dashboard doesn't process it (API error)
- Review isn't auto-triggered after completion

**If review not triggered:**
```bash
# Manually trigger review
curl -s -X POST http://localhost:3011/api/workspaces/PAN-{ID}/review
```

### Phase 4: Monitor Review Agent

Once review is triggered, the review-agent specialist should wake up:

```bash
# Check specialist status
curl -s http://localhost:3011/api/specialists | jq '.[] | select(.name == "review-agent")'

# Watch review agent output
tmux capture-pane -t specialist-review-agent -p -S -50 2>/dev/null

# Check review status progression
curl -s http://localhost:3011/api/workspaces/PAN-{ID}/review-status | jq '{reviewStatus, reviewNotes}'
```

**Expected outcomes:**
- `reviewStatus: "passed"` → proceeds to test
- `reviewStatus: "failed"` with `reviewNotes` → feedback sent to work agent

**Common failures:**
- Review agent not waking up (Cloister not running, specialist not initialized)
- Review passes but doesn't trigger test agent
- Review fails but feedback not delivered to work agent
- Review agent crashes mid-review

**If review agent doesn't wake:**
```bash
# Wake it manually
curl -s -X POST http://localhost:3011/api/specialists/review-agent/wake

# Or reset and re-trigger
curl -s -X POST http://localhost:3011/api/specialists/review-agent/reset
curl -s -X POST http://localhost:3011/api/workspaces/PAN-{ID}/review
```

### Phase 5: Monitor Feedback Loop (if review failed)

If review returned feedback, the work agent should receive it and fix issues:

```bash
# Check if work agent received feedback
tmux capture-pane -t agent-pan-{ID} -p -S -50 2>/dev/null | tail -20

# Check auto-requeue count (circuit breaker: max 3)
curl -s http://localhost:3011/api/workspaces/PAN-{ID}/review-status | jq '.autoRequeueCount'
```

The work agent should:
1. Read the feedback
2. Fix the issues
3. Run `pan work request-review PAN-{ID} -m "Fixed: ..."`

**If feedback not delivered:** This is a code bug to fix. Check:
- `send-feedback-to-agent` skill
- Dashboard's feedback delivery mechanism
- Agent's message queue in `~/.panopticon/agents/agent-pan-{ID}/mail/`

### Phase 6: Monitor Test Agent

After review passes, test-agent should run:

```bash
# Check test status
curl -s http://localhost:3011/api/workspaces/PAN-{ID}/review-status | jq '{testStatus, testNotes}'

# Watch test agent
tmux capture-pane -t specialist-test-agent -p -S -50 2>/dev/null
```

**Expected:** `testStatus: "passed"` → ready for merge

**Common failures:**
- Test agent not triggered after review passes
- Tests fail but agent doesn't report results
- Test agent crashes

### Phase 7: Verify Merge Readiness

After tests pass:

```bash
# Final status check
curl -s http://localhost:3011/api/workspaces/PAN-{ID}/review-status | jq .
```

**Expected final state:**
```json
{
  "reviewStatus": "passed",
  "testStatus": "passed",
  "readyForMerge": true
}
```

At this point, the user can click "Approve & Merge" in the dashboard or run:
```bash
pan work approve PAN-{ID}
```

## Intervention Protocol

When you find a bug in the Panopticon infrastructure:

1. **Stop the agent** (if it's actively hitting the bug)
2. **Identify the root cause** in the source code
3. **Fix the code** — edit the relevant file(s)
4. **Rebuild if needed** — `npx tsup` or restart dashboard
5. **Resume/restart the agent** to continue from where it left off
6. **Continue monitoring** from the current phase

## Key API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/health` | GET | Dashboard health |
| `/api/agents` | GET | List all agents |
| `/api/agents/:id/output` | GET | Agent terminal output |
| `/api/agents/:id/activity` | GET | Agent activity log |
| `/api/workspaces/:id/review-status` | GET | Review/test/merge status |
| `/api/workspaces/:id/review` | POST | Trigger review |
| `/api/workspaces/:id/request-review` | POST | Re-request review |
| `/api/workspaces/:id/approve` | POST | Approve & merge |
| `/api/specialists` | GET | List specialists |
| `/api/specialists/:name/wake` | POST | Wake specialist |
| `/api/cloister/status` | GET | Cloister status |
| `/api/cloister/start` | POST | Start Cloister |

## Timing Expectations

| Phase | Expected Duration |
|-------|-------------------|
| Work phase | 5-30 min (depends on complexity) |
| Review | 2-5 min |
| Feedback fix | 5-15 min per round |
| Testing | 1-3 min |
| Total (no issues) | 10-40 min |
| Total (with 1 feedback round) | 20-60 min |
