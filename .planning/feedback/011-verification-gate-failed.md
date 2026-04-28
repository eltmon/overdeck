---
specialist: verification-gate
issueId: PAN-905
outcome: failed
timestamp: 2026-04-28T19:26:06Z
---

VERIFICATION FAILED for PAN-905 (attempt 1/10):

Failed check: test

Verification FAILED at test (26298ms):

ext() method: without installing the canvas npm package

stderr | src/components/CommandDeck/__tests__/ToolFlash.test.tsx
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

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL |root|  src/lib/cloister/__tests__/review-temp-lifecycle.test.ts > review-temp stash lifecycle > drops persisted review-temp stash in runParallelReview finally block
Error: [vitest] No "isPaneDeadAsync" export is defined on the "../../tmux.js" mock. Did you forget to return it from "vi.mock"?
If you need to partially mock a module, you can use "importOriginal" helper inside:

vi.mock(import("../../tmux.js"), async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    // your mocked methods
  }
})

 ❯ Module.runParallelReview src/lib/cloister/review-agent.ts:962:30
    960|     const retryable: typeof failedReviewerResults = [];
    961|     for (const failed of failedReviewerResults) {
    962|       const paneDead = await isPaneDeadAsync(failed.sessionName);
       |                              ^
    963|       if (!paneDead) continue;
    964| 
 ❯ src/lib/cloister/__tests__/review-temp-lifecycle.test.ts:169:24

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯



## REQUIRED: Fix the failing check, then invoke the /rebase-and-submit skill

1. Read the error output above carefully
2. Fix the code causing the failure
3. Run the failing check locally to verify it passes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-905 — this is an atomic task. Because verification already ran once (a PR exists), the skill will run `pan review request PAN-905 -m "Fixed test"` for you. NEVER curl `/api/review/...` or any dashboard endpoint — `pan review request` is the only supported re-entry point.

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until `pan review request` has completed successfully.
