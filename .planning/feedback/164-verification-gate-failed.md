---
specialist: verification-gate
issueId: PAN-457
outcome: failed
timestamp: 2026-04-21T02:06:00Z
---

VERIFICATION FAILED for PAN-457 (attempt 4/10):

Failed check: test

Verification FAILED at test (24963ms):

getContext() method: without installing the canvas npm package

stderr | src/hooks/useResourceStats.test.ts
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package

stderr | src/__tests__/pipeline-state.test.ts
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯

 FAIL |root|  tests/unit/lib/lifecycle/workflows.test.ts > workflows > deepWipe > should return a successful workflow result
AssertionError: expected false to be true // Object.is equality

- Expected
+ Received

- true
+ false

 ❯ tests/unit/lib/lifecycle/workflows.test.ts:166:30
    164| 
    165|       expect(result.workflow).toBe('deep-wipe');
    166|       expect(result.success).toBe(true);
       |                              ^
    167|     });
    168| 

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/3]⎯

 FAIL |root|  tests/unit/lib/lifecycle/workflows.test.ts > workflows > deepWipe > should pass workspaceConfig through to teardown
AssertionError: expected false to be true // Object.is equality

- Expected
+ Received

- true
+ false

 ❯ tests/unit/lib/lifecycle/workflows.test.ts:214:30
    212| 
    213|       // Should not crash with workspace config
    214|       expect(result.success).toBe(true);
       |                              ^
    215|     });
    216| 

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/3]⎯

 FAIL |root|  tests/unit/lib/lifecycle/workflows.test.ts > workflows > deepWipe > should preserve workspace when deleteWorkspace is false
AssertionError: expected false to be true // Object.is equality

- Expected
+ Received

- true
+ false

 ❯ tests/unit/lib/lifecycle/workflows.test.ts:225:30
    223|       const result = await deepWipe(ctx, { deleteWorkspace: false });
    224| 
    225|       expect(result.success).toBe(true);
       |                              ^
    226|       // Workspace should still exist
    227|       expect(existsSync(wsPath)).toBe(true);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/3]⎯



## REQUIRED: Fix the failing check, then invoke the /rebase-and-submit skill

1. Read the error output above carefully
2. Fix the code causing the failure
3. Run the failing check locally to verify it passes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-457 — this is an atomic task. Because verification already ran once (a PR exists), the skill will run `pan review request PAN-457 -m "Fixed test"` for you. NEVER curl `/api/review/...` or any dashboard endpoint — `pan review request` is the only supported re-entry point.

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until `pan review request` has completed successfully.
