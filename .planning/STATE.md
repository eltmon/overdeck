# PAN-53: E2E Integration Test - Full Specialist Workflow

## Summary

This issue serves as a **live integration test** of the specialist workflow. The work itself is trivial (add a timestamp to a fixture file), but the real purpose is verifying that the `review-agent → test-agent → merge-agent` pipeline executes correctly when work is approved via the dashboard.

## Decisions Made

### 1. Test Strategy: Real Workflow ✓
- PAN-53 itself is the test subject
- Agent makes the simple fixture change
- Approve triggers the real specialist pipeline
- Playwright E2E tests verify dashboard shows specialists activating

### 2. Trigger Mechanism: Dashboard API ✓
- Approval via `POST /api/agents/:id/approve` endpoint (dashboard)
- This endpoint orchestrates: review-agent → test-agent → merge-agent
- NOT the CLI command (`pan work approve`) which does simpler merge

### 3. Verification: Automated E2E Tests ✓
- Playwright tests check dashboard during approve workflow
- Verify each specialist card transitions to "Active" state
- Check for green status indicators (🟢) on specialist cards

## Architecture

### Existing Components (Already Built)
1. **Specialist System** (`src/lib/cloister/specialists.ts`)
   - `wakeSpecialist()` - wakes a specialist with a task prompt
   - `isRunning()` - checks if specialist tmux session exists
   - `getSpecialistStatus()` - returns state (sleeping/active/uninitialized)

2. **Dashboard Approve Endpoint** (`src/dashboard/server/index.ts:3100+`)
   - Orchestrates review-agent → test-agent → merge-agent
   - Each specialist gets woken with task-specific prompts
   - merge-agent via `spawnMergeAgentForBranches()`

3. **Dashboard UI** (`SpecialistAgentCard.tsx`)
   - Shows specialist state with emoji (🟢 active, 😴 sleeping, ⚪ uninitialized)
   - Real-time updates via React Query

### New Components Needed
1. **Playwright E2E Test** (`src/dashboard/frontend/tests/specialist-workflow.spec.ts`)
   - Navigate to dashboard
   - Trigger approve workflow (via API or UI click)
   - Assert specialists transition to active state
   - Assert merge completes (check main branch)

2. **Fixture Update** (`tests/fixtures/e2e-test.txt`)
   - Add: `E2E test completed at: [timestamp]`

## Implementation Steps

### Phase 1: Prepare Test Infrastructure
1. Ensure fixture file exists and is tracked
2. Create the Playwright test file skeleton
3. Verify dashboard server is accessible for tests

### Phase 2: Implement the Simple Change
1. Add timestamp line to `tests/fixtures/e2e-test.txt`
2. Commit with message referencing PAN-53
3. Push to feature branch

### Phase 3: Create E2E Test
1. Write Playwright test that:
   - Waits for agent to push changes
   - Triggers approve via dashboard API
   - Polls `/api/specialists` for state changes
   - Asserts all three specialists become active
   - Verifies merge completion

### Phase 4: Verify Success Criteria
- [ ] All three specialists visibly working in dashboard
- [ ] Merge completes successfully
- [ ] Change appears in main branch
- [ ] E2E test passes

## Test Considerations

### Timing
- Specialists may not become active immediately
- Need polling/waiting for state transitions
- review-agent: ~2s delay before test-agent
- test-agent: ~3s delay before merge-agent

### Dashboard URLs
```
Frontend: http://localhost:3010 (or 3001 in some configs)
API: http://localhost:3011 (or 3002 in some configs)
```

### Specialist States to Check
```typescript
// Expected transitions during approve:
review-agent: sleeping → active → sleeping
test-agent: sleeping → active → sleeping
merge-agent: uninitialized → active → sleeping (or terminated)
```

## Out of Scope
- Workspace cleanup (mentioned in issue but separate concern)
- Deleting the issue after test (manual step)
- Linear integration testing
- PR creation (direct branch merge)

## Risks
1. **Specialists not initialized**: May fail if no session files exist
2. **Timing races**: E2E test may miss transient "active" states
3. **Dashboard not running**: Tests need dashboard server up

## Beads (Implementation Tasks)

Execute in order (each depends on previous):

| Bead ID | Task | Description |
|---------|------|-------------|
| `panopticon-am4j` | Add timestamp to fixture | Add `E2E test completed at: [timestamp]` to e2e-test.txt |
| `panopticon-j4z1` | Commit and push | Git commit/push to feature branch |
| `panopticon-owuo` | Create Playwright test | Write specialist-workflow.spec.ts |
| `panopticon-40zw` | Run and verify | Execute test, verify all success criteria |

## Related Files
- `src/lib/cloister/specialists.ts` - Specialist infrastructure
- `src/dashboard/server/index.ts` - Approve endpoint (~line 3100)
- `src/dashboard/frontend/src/components/SpecialistAgentCard.tsx` - UI component
- `tests/fixtures/e2e-test.txt` - Test fixture
- `src/dashboard/frontend/tests/` - Playwright tests location
