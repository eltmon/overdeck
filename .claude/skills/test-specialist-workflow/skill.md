# Test Specialist Workflow

Test the full specialist handoff pipeline: review-agent -> test-agent -> merge-agent

## When to Use

- After making changes to the specialist system
- To verify the approval pipeline works end-to-end
- As a smoke test for the dashboard approve functionality

## What This Skill Does

1. Creates a test GitHub issue
2. Creates a workspace for the issue
3. Makes a trivial change (adds timestamp to test fixture)
4. Commits and pushes the change
5. Triggers the approve workflow via dashboard API
6. Monitors specialist activity to verify handoffs occur
7. Verifies merge completes successfully
8. Cleans up (closes issue, removes workspace)

## Prerequisites

- Dashboard must be running (frontend on 3010, API on 3011)
- Specialists must be initialized (run `pan cloister start` if not)
- GitHub CLI must be authenticated

## Instructions

### Step 1: Verify Prerequisites

```bash
# Check dashboard is running
curl -s http://localhost:3011/api/health | jq .

# Check specialists are available
curl -s http://localhost:3011/api/specialists | jq '.[].name'

# Verify all three exist
curl -s http://localhost:3011/api/specialists | jq 'length' # Should be 3
```

### Step 2: Create Test Issue and Workspace

```bash
# Create GitHub issue
ISSUE_URL=$(gh issue create \
  --title "Test: Specialist workflow $(date +%Y%m%d-%H%M%S)" \
  --body "Automated test of specialist handoff pipeline. Will be auto-closed." \
  2>&1)
ISSUE_NUM=$(echo "$ISSUE_URL" | grep -oP 'issues/\K\d+')
echo "Created issue: PAN-$ISSUE_NUM"

# Create workspace
pan workspace create "PAN-$ISSUE_NUM"

# Navigate to workspace
WORKSPACE="/home/eltmon/projects/panopticon/workspaces/feature-pan-$ISSUE_NUM"
cd "$WORKSPACE"
```

### Step 3: Make Test Change

```bash
# Create test fixture
mkdir -p tests/fixtures
echo "Specialist workflow test at: $(date -Iseconds)" > tests/fixtures/specialist-test.txt

# Commit and push
git add tests/fixtures/specialist-test.txt
git commit -m "test: specialist workflow test (PAN-$ISSUE_NUM)"
git push -u origin "feature/pan-$ISSUE_NUM"
```

### Step 4: Trigger Approve Pipeline

```bash
# Trigger the approval - this kicks off review-agent
RESULT=$(curl -s -X POST "http://localhost:3011/api/workspaces/PAN-$ISSUE_NUM/approve" \
  -H "Content-Type: application/json")
echo "$RESULT" | jq .

# Should see: "pipeline": "running"
```

### Step 5: Monitor Specialist Activity

```bash
# Watch review-agent (should complete review and hand off)
echo "=== REVIEW-AGENT ==="
tmux capture-pane -t specialist-review-agent -p | tail -20

# Wait for handoff, then check test-agent
sleep 30
echo "=== TEST-AGENT ==="
tmux capture-pane -t specialist-test-agent -p | tail -20

# If test-agent task is pending, submit it
tmux send-keys -t specialist-test-agent Enter 2>/dev/null || true

# Wait for tests to run
sleep 60
echo "=== TEST-AGENT (after tests) ==="
tmux capture-pane -t specialist-test-agent -p | tail -20

# Check merge-agent
echo "=== MERGE-AGENT ==="
tmux capture-pane -t specialist-merge-agent -p | tail -20
```

### Step 6: Verify Merge Completed

```bash
# Check if branch was merged to main
cd /home/eltmon/projects/panopticon
git fetch origin
git log --oneline main -5 | grep -i "pan-$ISSUE_NUM" && echo "SUCCESS: Merge found!" || echo "PENDING: Merge not yet on main"

# Check specialist states
curl -s http://localhost:3011/api/specialists | jq '.[] | {name, state}'
```

### Step 7: Cleanup

```bash
# Close the GitHub issue
gh issue close "$ISSUE_NUM" -c "Automated test completed successfully"

# Remove workspace
rm -rf "$WORKSPACE"

echo "Cleanup complete!"
```

## Troubleshooting

### Specialists Not Responding

If specialists show "Exit code 1" errors or shell commands fail:

```bash
# Kill and restart specialist sessions
tmux kill-session -t specialist-review-agent 2>/dev/null
tmux kill-session -t specialist-test-agent 2>/dev/null
tmux kill-session -t specialist-merge-agent 2>/dev/null

# Restart them
pan specialists wake review-agent
pan specialists wake test-agent
pan specialists wake merge-agent
```

### Handoff Not Occurring

If test-agent doesn't receive task from review-agent:

```bash
# Manually trigger the handoff
pan specialists wake test-agent --task "TEST TASK for PAN-$ISSUE_NUM:
WORKSPACE: $WORKSPACE
BRANCH: feature/pan-$ISSUE_NUM
PROJECT: /home/eltmon/projects/panopticon

1. cd $WORKSPACE
2. Run tests: npm test
3. If PASS: Hand off to merge-agent
4. If FAIL: Report failures"
```

### Merge Blocked

If merge-agent can't complete:

```bash
# Check for uncommitted changes
cd /home/eltmon/projects/panopticon
git status

# If .beads/ files are modified, that's OK (should be ignored)
# Other uncommitted changes need to be committed or stashed
```

## Expected Timeline

- Review-agent: 30-60 seconds
- Test-agent: 60-120 seconds (depends on test suite)
- Merge-agent: 30-60 seconds
- Total: 2-4 minutes

## Success Criteria

1. Review-agent completes review and hands off to test-agent
2. Test-agent runs tests and hands off to merge-agent (if tests pass)
3. Merge-agent merges branch to main and pushes
4. Change appears in main branch
5. All specialists return to idle state
