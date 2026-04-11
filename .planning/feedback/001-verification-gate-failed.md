---
specialist: verification-gate
issueId: PAN-557
outcome: failed
timestamp: 2026-04-11T11:55:37Z
---

VERIFICATION FAILED for PAN-557 (attempt 5/10):

Failed check: test

Verification FAILED at test (53035ms):

re.js:328:5)

stderr | src/dashboard/frontend/src/hooks/__tests__/useTheme.test.ts > useTheme > Integration with CSS > should add dark class for dark mode (Tailwind default)
Warning: An update to TestComponent inside a test was not wrapped in act(...).

When testing, code that causes React state updates should be wrapped into act(...):

act(() => {
  /* fire events that update state */
});
/* assert on the output */

This ensures that you're testing the behavior the user would see in the browser. Learn more at https://reactjs.org/link/wrap-tests-with-act
    at TestComponent (/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-557/node_modules/.bun/@testing-library+react@16.3.2/node_modules/@testing-library/react/dist/pure.js:328:5)

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/unit/lib/cloister/pan-344-auto-merge.test.ts > checkReadyForMergeStuck > notifies for a stuck readyForMerge issue older than 2 min (no auto-merge, PAN-354)
AssertionError: expected "spy" to be called once, but got 0 times
 ❯ tests/unit/lib/cloister/pan-344-auto-merge.test.ts:149:26
    147| 
    148|     // Must notify via callback, not by calling the merge API
    149|     expect(mockNotifier).toHaveBeenCalledOnce();
       |                          ^
    150|     expect(mockNotifier).toHaveBeenCalledWith('PAN-344');
    151|     expect(actions.length).toBeGreaterThan(0);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

 FAIL  tests/unit/lib/cloister/pan-344-auto-merge.test.ts > checkReadyForMergeStuck > circuit breaker stops notifying after 3 attempts for the same issue
AssertionError: expected 0 to be greater than or equal to 3
 ❯ tests/unit/lib/cloister/pan-344-auto-merge.test.ts:235:35
    233| 
    234|     const notifyCallsAfterThree = mockNotifier.mock.calls.length;
    235|     expect(notifyCallsAfterThree).toBeGreaterThanOrEqual(3);
       |                                   ^
    236| 
    237|     // 4th attempt — should be blocked by the circuit breaker

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯



## REQUIRED: Fix the failing check BEFORE resubmitting

1. Read the error output above carefully
2. Fix the code causing the failure
3. Run the failing check locally to verify it passes
4. Commit and push ALL changes
5. ONLY THEN resubmit:
curl -X POST http://localhost:3011/api/workspaces/PAN-557/request-review -H "Content-Type: application/json" -d '{}'

Do NOT run the curl command until steps 1-4 are complete. Do NOT stop until review passes.
