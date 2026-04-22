---
specialist: review-agent
issueId: PAN-569
outcome: changes-requested
timestamp: 2026-04-22T20:18:51Z
---

# Review: CHANGES_REQUESTED

## Summary

All 27 acceptance criteria are implemented and the feature works end-to-end, but two correctness issues should be fixed before merge: (1) successful close-outs containing any skipped sub-step are misreported as "Skipped" with wrong aggregate counts, and (2) the bulk-close endpoint has no server-side active-agent guard, so any caller can tear down a running agent's workspace. Also recommend adding input validation/size cap and an origin check to the destructive bulk endpoint. Other findings (per-card planning-state polling, selection-clear on list mutation, serial cache invalidation) are good follow-up items.

## Security Issues

- Unvalidated issueIds array elements and no size cap on bulk-close endpoint
- Destructive bulk endpoint with no auth/CSRF/origin check
- Swallowed cache-invalidation errors hide tracker desyncs
- Upstream error strings rendered in tooltips may leak tokens

## Performance Issues

- Per-card planning-state polling causes O(n) network traffic
- Bulk close-out runs serially and re-invalidates tracker caches per issue
- O(selected x agents) scans in warning dialog and bulk handlers

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-569 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

