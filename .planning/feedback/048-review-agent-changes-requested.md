---
specialist: review-agent
issueId: PAN-714
outcome: changes-requested
timestamp: 2026-04-18T19:16:01Z
---

CODE REVIEW BLOCKED for PAN-714:

src/lib/cloister/deacon.ts:1981-1989 resets CI-blocked merges back to readyForMerge=true after only 5 minutes of idle time. That bypasses the new CI retry circuit breaker in checkFailedMergeRetry(), which is supposed to stop after 5 transient retries and require agent action. Once ciRetryMap reaches 6, checkDeadEndAgents() can still requeue the same issue every 10 minutes with no link to ciRetryMap, causing repeated merge re-entry and defeating the intended backoff. Add a guard so dead-end recovery does not reset mergeStatus/readyForMerge for CI-blocked issues after CI retries are exhausted, and add a regression test for this interaction.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-714 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
