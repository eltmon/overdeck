---
specialist: review-agent
issueId: PAN-446
outcome: changes-requested
timestamp: 2026-04-18T22:59:10Z
---

CODE REVIEW BLOCKED for PAN-446:

CHANGES REQUESTED:
1. src/dashboard/server/services/cache-service.ts:43-45 introduces top-level await in a module that is synchronously required via issue-service-singleton -> routes/issues.ts:65 and routes/misc.ts:114. That turns cache-service into an async ESM module and breaks those require() call sites at runtime under Node with ERR_REQUIRE_ASYNC_MODULE / inability to synchronously load the shared issue service. This is a production blocker for route handling.
2. The new tests do not cover this integration path: tests/dashboard/cache-service-init-home.test.ts only imports the module and constructs CacheService, but never exercises the real require()-based singleton load path, so the regression would ship unnoticed.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-446 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
