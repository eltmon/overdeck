---
specialist: review-agent
issueId: PAN-711
outcome: changes-requested
timestamp: 2026-04-18T15:30:46Z
---

CODE REVIEW BLOCKED for PAN-711:

Blocking issue: tests/unit/dashboard/no-alias-routes.test.ts only scans source text for hard-coded route strings and does not verify the server route table or HTTP behavior. A deleted alias route could be reintroduced indirectly (via composed constants, helper-built paths, or non-src registration) without this test failing, so PAN-711 lacks a real regression test for the route removals it documents. Add an actual route-level regression test that proves the removed alias endpoints stay absent and the canonical endpoints remain present. Rebase-helper changes in src/lib/rebase-helper.ts do include a targeted regression test in tests/unit/lib/rebase-helper.test.ts.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-711 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
