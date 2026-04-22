---
specialist: review-agent
issueId: PAN-540
outcome: changes-requested
timestamp: 2026-04-18T22:10:56Z
---

CODE REVIEW BLOCKED for PAN-540:

1. src/lib/cloister/deacon.ts:1362-1365 and src/lib/cloister/service.ts:396-397 unconditionally set reviewStatus to reviewing after dispatchParallelReview(), but dispatchParallelReview() always returns success immediately and later resets status to pending on async failure (src/lib/cloister/review-agent.ts:744-755). If spawnReviewAgent throws before any tmux review session exists, deacon/startup recovery records a false reviewing state and orphan recovery can re-dispatch again on the next patrol. This regresses the PAN-511 guarantee that reviewing is only set after a successful dispatch and can create duplicate review runs or stuck status churn. 2. tests/lib/cloister/deacon-orphan-recovery.test.ts:279-317 only covers the happy path for the new pending-review recovery branch. There is no regression test for dispatch failure/rejection from dispatchParallelReview, so the new false-reviewing state bug above is not covered.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-540 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
