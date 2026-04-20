---
specialist: verification-gate
issueId: PAN-699
outcome: failed
timestamp: 2026-04-20T23:04:21Z
---

VERIFICATION FAILED for PAN-699 (attempt 1/10):

Failed check: test

Verification FAILED at test (27184ms):

ctivity-logger.js" mock. Did you forget to return it from "vi.mock"?
If you need to partially mock a module, you can use "importOriginal" helper inside:

vi.mock(import("../../../../../src/lib/activity-logger.js"), async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    // your mocked methods
  }
})

 ❯ Module.setReviewStatus src/lib/review-status.ts:228:21
    226|     const entry = rMap[update.reviewStatus];
    227|     if (entry) emitActivityEntry({ source: 'review-specialist', level:…
    228|     if (entry?.tts) emitActivityTts({ utterance: entry.tts, priority: …
       |                     ^
    229|   }
    230|   if (update.testStatus && update.testStatus !== existing.testStatus) {
 ❯ tests/unit/dashboard/server/routes/unstick-route.test.ts:145:5

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[19/20]⎯

 FAIL |root|  tests/unit/dashboard/server/routes/unstick-route.test.ts > processUnstickRequest — POST /api/workspaces/:issueId/unstick route contract > 200: clears reviewedAtCommit so deacon does not re-trigger post-review reset
Error: [vitest] No "emitActivityTts" export is defined on the "../../../../../src/lib/activity-logger.js" mock. Did you forget to return it from "vi.mock"?
If you need to partially mock a module, you can use "importOriginal" helper inside:

vi.mock(import("../../../../../src/lib/activity-logger.js"), async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    // your mocked methods
  }
})

 ❯ Module.setReviewStatus src/lib/review-status.ts:228:21
    226|     const entry = rMap[update.reviewStatus];
    227|     if (entry) emitActivityEntry({ source: 'review-specialist', level:…
    228|     if (entry?.tts) emitActivityTts({ utterance: entry.tts, priority: …
       |                     ^
    229|   }
    230|   if (update.testStatus && update.testStatus !== existing.testStatus) {
 ❯ tests/unit/dashboard/server/routes/unstick-route.test.ts:179:5

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[20/20]⎯



## REQUIRED: Fix the failing check, then invoke the /rebase-and-submit skill

1. Read the error output above carefully
2. Fix the code causing the failure
3. Run the failing check locally to verify it passes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-699 — this is an atomic task. Because verification already ran once (a PR exists), the skill will run `pan review request PAN-699 -m "Fixed test"` for you. NEVER curl `/api/review/...` or any dashboard endpoint — `pan review request` is the only supported re-entry point.

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until `pan review request` has completed successfully.
