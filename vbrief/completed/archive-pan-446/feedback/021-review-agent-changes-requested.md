---
specialist: review-agent
issueId: PAN-446
outcome: changes-requested
timestamp: 2026-04-18T22:26:30Z
---

CODE REVIEW BLOCKED for PAN-446:

src/dashboard/server/services/cache-service.ts:84-87 now opens cache.db in the constructor without first ensuring ~/.panopticon exists. The old constructor created the directory synchronously; the new async initHome() only runs from src/dashboard/server/main.ts:30-33. CacheService is still constructed via src/dashboard/server/services/issue-service-singleton.ts:11-14, so any caller that instantiates it before main module startup will now fail with ENOENT when opening cache.db. The new tests cover initHome() in isolation but do not cover CacheService construction when PANOPTICON_HOME is absent, so this regression is untested. Fix by making CacheService construction itself safe or by guaranteeing all construction paths await home initialization, and add a regression test for constructor/startup behavior with a missing PANOPTICON_HOME.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-446 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
