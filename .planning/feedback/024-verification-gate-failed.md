---
specialist: verification-gate
issueId: PAN-905
outcome: failed
timestamp: 2026-04-29T02:38:34Z
---

VERIFICATION FAILED for PAN-905 (attempt 1/10):

Failed check: test

Verification FAILED at test (124938ms):

ugh to in-process lifecycle when spawn throws
 FAIL |root|  tests/unit/lib/pan-444-post-merge-step0.test.ts > postMergeLifecycle — step 0 deploy handoff > step 0 does not run when idempotency guard is set
 FAIL |root|  tests/unit/lib/lifecycle/workflows.test.ts > workflows > approve > should skip beads compaction when skipBeadsCompaction is true
 FAIL |root|  tests/unit/lib/lifecycle/workflows.test.ts > workflows > closeOut > should verify branch merged before proceeding
 FAIL |root|  tests/unit/lib/lifecycle/workflows.test.ts > workflows > closeOut > should abort if archive fails
 FAIL |root|  tests/unit/lib/lifecycle/workflows.test.ts > workflows > deepWipe > should return a successful workflow result
 FAIL |root|  tests/unit/lib/lifecycle/workflows.test.ts > workflows > deepWipe > should include teardown with branch deletion by default
 FAIL |root|  tests/unit/lib/lifecycle/workflows.test.ts > workflows > deepWipe > should skip branch deletion when deleteBranches is false
 FAIL |root|  tests/unit/lib/lifecycle/workflows.test.ts > workflows > deepWipe > should pass workspaceConfig through to teardown
 FAIL |root|  tests/unit/lib/lifecycle/workflows.test.ts > workflows > deepWipe > should preserve workspace when deleteWorkspace is false
 FAIL |root|  tests/unit/lib/lifecycle/workflows.test.ts > workflows > beads lifecycle (PAN-412) > approve should NOT clear beads (preserves them for history)
 FAIL |root|  tests/unit/lib/lifecycle/workflows.test.ts > workflows > beads lifecycle (PAN-412) > deepWipe should clear beads for the issue
 FAIL |root|  tests/unit/lib/lifecycle/workflows.test.ts > workflows > step ordering > approve should run archive before teardown
 FAIL |root|  tests/unit/lib/lifecycle/workflows.test.ts > workflows > step ordering > closeOut should run verify-merged first
Error: Test timed out in 10000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/15]⎯



## REQUIRED: Fix the failing check, then invoke the /rebase-and-submit skill

1. Read the error output above carefully
2. Fix the code causing the failure
3. Run the failing check locally to verify it passes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-905 — this is an atomic task. Because verification already ran once (a PR exists), the skill will run `pan review request PAN-905 -m "Fixed test"` for you. NEVER curl `/api/review/...` or any dashboard endpoint — `pan review request` is the only supported re-entry point.

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until `pan review request` has completed successfully.
