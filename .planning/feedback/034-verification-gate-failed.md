---
specialist: verification-gate
issueId: PAN-714
outcome: failed
timestamp: 2026-04-18T13:13:15Z
---

VERIFICATION FAILED for PAN-714 (attempt 1/10):

Failed check: test

Verification FAILED at test (21601ms):

_/StandaloneTerminal.test.tsx
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package

stderr | src/components/inspector/StatusHistory.test.tsx
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package

stderr | src/components/ResourceBar.test.tsx
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package

stderr | src/hooks/__tests__/useNow.test.ts
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package

stderr | src/hooks/useResourceStats.test.ts
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package

stderr | src/__tests__/pipeline-state.test.ts
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL |root|  tests/lib/shadow-state.test.ts > shadow-state > getUnsyncedHistory > should return only unsynced entries
AssertionError: expected +0 to be 2 // Object.is equality

- Expected
+ Received

- 2
+ 0

 ❯ tests/lib/shadow-state.test.ts:211:31
    209| 
    210|       let unsynced = await getUnsyncedHistory(id);
    211|       expect(unsynced.length).toBe(2);
       |                               ^
    212| 
    213|       await markAsSynced(id, 'closed');

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

 FAIL |root|  tests/lib/shadow-state.test.ts > shadow-state > listShadowedIssues > should return all shadowed issues sorted by shadowedAt
AssertionError: expected 1 to be greater than or equal to 2
 ❯ tests/lib/shadow-state.test.ts:236:33
    234|       const testIssues = issues.filter(i => i.issueId.includes('TEST-'…
    235| 
    236|       expect(testIssues.length).toBeGreaterThanOrEqual(2);
       |                                 ^
    237|       // Should be sorted by shadowedAt descending (newest first)
    238|       if (testIssues.length >= 2) {

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯



## REQUIRED: Fix the failing check, then invoke the /rebase-and-submit skill

1. Read the error output above carefully
2. Fix the code causing the failure
3. Run the failing check locally to verify it passes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-714 — this is an atomic task. Because verification already ran once (a PR exists), the skill will run `pan review request PAN-714 -m "Fixed test"` for you. NEVER curl `/api/review/...` or any dashboard endpoint — `pan review request` is the only supported re-entry point.

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until `pan review request` has completed successfully.
