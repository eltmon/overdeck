---
specialist: test-agent
issueId: PAN-475
outcome: failed
timestamp: 2026-04-07T00:08:29Z
---

TESTS FAILED for PAN-475:

2 failures in selectIssuesByCycle selector (src/dashboard/frontend/src/__tests__/store.test.ts).

Root cause: selectIssuesByCycle in src/dashboard/frontend/src/lib/store.ts:117-119 only filters out canceled issues when includeCompleted=false, but tests expect done issues to also be excluded.

Test 1 (excludes done and canceled issues when includeCompleted=false): PAN-3 with canonicalStatus/state=done is included in results but should be excluded. Got [PAN-1, PAN-2, PAN-3, PAN-5], expected [PAN-1, PAN-2, PAN-5].

Test 2 (filters by state field as well as canonicalStatus): Issue A with state=done is included but should be excluded. Got [A, C], expected [C].

Fix required: The filter at store.ts:118 must also exclude i[state] === done and i[canonicalStatus] === done. The comment saying Always include done issues contradicts the test specifications and should be removed.

## REQUIRED: Fix ALL test failures BEFORE resubmitting

1. Read each test failure carefully
2. Fix the code causing EVERY failure
3. Run the test suite to verify your fixes pass
4. Commit and push ALL changes
5. ONLY THEN resubmit:
curl -X POST http://localhost:3011/api/workspaces/PAN-475/request-review -H "Content-Type: application/json" -d '{}'

Do NOT run the curl command until steps 1-4 are complete. Do NOT stop until review passes.
