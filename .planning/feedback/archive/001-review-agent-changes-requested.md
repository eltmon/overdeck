---
specialist: review-agent
issueId: PAN-805
outcome: changes-requested
timestamp: 2026-04-23T16:25:51Z
---

# Review: CHANGES_REQUESTED

## Summary

PAN-805 delivers the full reconciler scope (23/23 vBRIEF items, 34/35 ACs, 6/6 required tests) but three critical correctness bugs undermine the feature's stated guarantees: boot backfill writes phantom `AGENT-PAN-XXX` rows into `issue_state`, the lazy-insert path in `ensureIssueState` leaves `last_synced_at = now` so new issues never push their `in-progress` label, and `Retry-After` HTTP-date values collapse to `NaN` and defeat backoff under exactly the secondary-rate-limit scenarios the client was built for. Two of these are masked by tests that were written to match the implementation instead of the AC (`multi-dev-pull-sync` asserts stale `last_synced_at`; `rate-limit-recovery` covers only the seconds form). Additional high-priority items: pull step is not paginated, `label-cleanup.ts` is dead code with a CI grandfather exception, and the push step is fully serial so a busy tick can exceed the 30 s interval. No blocking security issues. Fix Critical #1–#3 and High #4–#7, update the two tests to assert ACs, then re-review.

## Security Issues

- GitHub token could leak if log line is widened to include headers
- Unbounded/NaN Retry-After defeats exponential backoff under hostile or non-integer headers

## Performance Issues

- Serial per-issue push can exceed tick interval (N×(1+L) round trips)
- External merge sweep re-fetches first 100 closed issues every tick without incremental watermark
- Boot backfill does per-row SELECT+INSERT instead of set-based INSERT OR IGNORE

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-805 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

