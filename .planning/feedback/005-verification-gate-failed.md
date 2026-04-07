---
specialist: verification-gate
issueId: PAN-448
outcome: failed
timestamp: 2026-04-07T15:44:23Z
---

VERIFICATION FAILED for PAN-448 (attempt 2/10):

Failed check: test

Verification FAILED at test (63556ms):

ault)
Warning: An update to TestComponent inside a test was not wrapped in act(...).

When testing, code that causes React state updates should be wrapped into act(...):

act(() => {
  /* fire events that update state */
});
/* assert on the output */

This ensures that you're testing the behavior the user would see in the browser. Learn more at https://reactjs.org/link/wrap-tests-with-act
    at TestComponent (/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-448/node_modules/.bun/@testing-library+react@16.3.2/node_modules/@testing-library/react/dist/pure.js:328:5)

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/dashboard/frontend/src/__tests__/store.test.ts > selectIssuesByCycle > excludes done and canceled issues when includeCompleted=false
AssertionError: expected [ 'PAN-1', 'PAN-2', 'PAN-3', 'PAN-5' ] to deeply equal [ 'PAN-1', 'PAN-2', 'PAN-5' ]

- Expected
+ Received

  Array [
    "PAN-1",
    "PAN-2",
+   "PAN-3",
    "PAN-5",
  ]

 ❯ src/dashboard/frontend/src/__tests__/store.test.ts:281:35
    279|   it('excludes done and canceled issues when includeCompleted=false', …
    280|     const result = selectIssuesByCycle('current', false)(state) as Arr…
    281|     expect(result.map(i => i.id)).toEqual(['PAN-1', 'PAN-2', 'PAN-5'])
       |                                   ^
    282|   })
    283| 

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

 FAIL  src/dashboard/frontend/src/__tests__/store.test.ts > selectIssuesByCycle > filters by state field as well as canonicalStatus
AssertionError: expected [ 'A', 'C' ] to deeply equal [ 'C' ]

- Expected
+ Received

  Array [
+   "A",
    "C",
  ]

 ❯ src/dashboard/frontend/src/__tests__/store.test.ts:297:35
    295|     const s: DashboardState = { ...emptyState, issuesRaw: mixedIssues }
    296|     const result = selectIssuesByCycle('all', false)(s) as Array<{ id:…
    297|     expect(result.map(i => i.id)).toEqual(['C'])
       |                                   ^
    298|   })
    299| 

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯



## REQUIRED: Fix the failing check BEFORE resubmitting

1. Read the error output above carefully
2. Fix the code causing the failure
3. Run the failing check locally to verify it passes
4. Commit and push ALL changes
5. ONLY THEN resubmit:
curl -X POST http://localhost:3011/api/workspaces/PAN-448/request-review -H "Content-Type: application/json" -d '{}'

Do NOT run the curl command until steps 1-4 are complete. Do NOT stop until review passes.
