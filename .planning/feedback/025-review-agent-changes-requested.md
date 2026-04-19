---
specialist: review-agent
issueId: PAN-446
outcome: changes-requested
timestamp: 2026-04-18T23:16:11Z
---

CODE REVIEW BLOCKED for PAN-446:

1. src/dashboard/server/routes/misc.ts:95 introduces top-level await via panopticonVersion = await readPackageVersion(). This makes misc.ts an async ESM module and can break static import/evaluation of the route layer under Node. 2. Missing regression coverage for the real startup path: the new guarantee that PANOPTICON_HOME exists before CacheService construction depends on main.ts startup ordering, but tests only check CacheService import/constructor and never assert that importing/evaluating main.ts or the server startup path preserves the synchronous require()-based issue-service-singleton path without async-module breakage. Add a regression test covering the actual startup/import chain.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-446 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
