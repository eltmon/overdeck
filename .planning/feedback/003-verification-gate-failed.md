---
specialist: verification-gate
issueId: PAN-946
outcome: failed
timestamp: 2026-05-03T17:01:30Z
---

VERIFICATION FAILED for PAN-946 (attempt 1/10):

Failed check: test

Verification FAILED at test (43336ms):

lt = syncBeadStatusToVBrief('bead-1', TEST_DIR);
    117|     expect(result).toBe('item-1');
       |                    ^
    118|   });
    119| });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[27/30]⎯

 FAIL |root|  src/dashboard/server/routes/__tests__/buildRichPRBody.test.ts > buildRichPRBody > includes beads task summary from issues.jsonl
AssertionError: expected 'Closes #42\n' to contain '## Implementation Tasks'

- Expected
+ Received

- ## Implementation Tasks
+ Closes #42
+

 ❯ src/dashboard/server/routes/__tests__/buildRichPRBody.test.ts:72:18
     70| 
     71|     const body = await buildRichPRBody('PAN-42', workspacePath);
     72|     expect(body).toContain('## Implementation Tasks');
       |                  ^
     73|     expect(body).toContain('- [x] Fix the bug');
     74|     expect(body).toContain('- [ ] Add the feature');

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[28/30]⎯

 FAIL |root|  src/dashboard/server/routes/__tests__/buildRichPRBody.test.ts > buildRichPRBody > includes both AC checklist and beads when both exist
AssertionError: expected 'Closes #5\n\n## Acceptance Criteria\n…' to contain '## Implementation Tasks'

- Expected
+ Received

- ## Implementation Tasks
+ Closes #5
+
+ ## Acceptance Criteria
+
+ - [x] AC One
+

 ❯ src/dashboard/server/routes/__tests__/buildRichPRBody.test.ts:98:18
     96|     expect(body).toContain('## Acceptance Criteria');
     97|     expect(body).toContain('- [x] AC One');
     98|     expect(body).toContain('## Implementation Tasks');
       |                  ^
     99|     expect(body).toContain('- [x] Task one');
    100|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[29/30]⎯

 FAIL |root|  src/dashboard/server/routes/__tests__/effect-patterns.test.ts > EventStoreServiceLive + ReadModelServiceLive end-to-end > appends and reads back an event using Live layers with real SQLite
Error: Test timed out in 10000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[30/30]⎯



## REQUIRED: Fix the failing check, then invoke the /rebase-and-submit skill

1. Read the error output above carefully
2. Fix the code causing the failure
3. Run the failing check locally to verify it passes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-946 — this is an atomic task. Because verification already ran once (a PR exists), the skill will run `pan review request PAN-946 -m "Fixed test"` for you. NEVER curl `/api/review/...` or any dashboard endpoint — `pan review request` is the only supported re-entry point.

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until `pan review request` has completed successfully.
