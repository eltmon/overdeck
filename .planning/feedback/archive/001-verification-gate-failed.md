---
specialist: verification-gate
issueId: PAN-699
outcome: failed
timestamp: 2026-04-21T18:32:56Z
---

VERIFICATION FAILED for PAN-699 (attempt 1/10):

Failed check: test

Verification FAILED at test (25723ms):

Element's getContext() method: without installing the canvas npm package

stderr | src/components/__tests__/StandaloneTerminal.test.tsx
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package

stderr | src/components/ResourceBar.test.tsx
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package

stderr | src/components/inspector/StatusHistory.test.tsx
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package

stderr | src/hooks/__tests__/useNow.test.ts
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package

stderr | src/hooks/useResourceStats.test.ts
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package

stderr | src/__tests__/pipeline-state.test.ts
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL |root|  tests/lib/cloister/review-agent.test.ts > buildReviewFeedbackBody > APPROVED body does not include resubmit instructions
AssertionError: expected '# Review: APPROVED\n\n## Summary\n\nL…' to contain 'approved'

- Expected
+ Received

- approved
+ # Review: APPROVED
+
+ ## Summary
+
+ LGTM
+
+ ## ✅ CODE APPROVED — YOUR WORK IS COMPLETE
+
+ **Do NOT make any more changes.**
+ **Do NOT run `pan done` again.**
+ **Do NOT run `pan review request`.**
+
+ The specialist pipeline will now run tests. If tests pass, the issue enters the merge queue for human approval.
+

 ❯ tests/lib/cloister/review-agent.test.ts:195:18
    193|     const approved: ReviewResult = { success: true, reviewResult: 'APP…
    194|     const body = buildReviewFeedbackBody('PAN-999', approved);
    195|     expect(body).toContain('approved');
       |                  ^
    196|     expect(body).not.toMatch(/pan done|rebase-and-submit|request-revie…
    197|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯



## REQUIRED: Fix the failing check, then invoke the /rebase-and-submit skill

1. Read the error output above carefully
2. Fix the code causing the failure
3. Run the failing check locally to verify it passes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-699 — this is an atomic task. Because verification already ran once (a PR exists), the skill will run `pan review request PAN-699 -m "Fixed test"` for you. NEVER curl `/api/review/...` or any dashboard endpoint — `pan review request` is the only supported re-entry point.

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until `pan review request` has completed successfully.
