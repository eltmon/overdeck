---
specialist: review-agent
issueId: PAN-805
outcome: changes-requested
timestamp: 2026-04-24T04:26:13Z
---

# Review: CHANGES_REQUESTED

## Summary

PAN-805 delivers a well-architected label reconciler with 22/24 vBRIEF items fully implemented and no new security vulnerabilities. However, four critical correctness bugs in the reconciler core must be fixed before merge: (1) a COALESCE bug in `setCanonicalState` that permanently preserves stale `pending_mutation` values, (2) broad substring label matching in `remoteToCanonical` that produces false-positive state transitions for any repo with non-Panopticon labels, (3) a stale-fetch window in the push step that allows label deltas to be applied against outdated GitHub state, and (4) a boot-time backfill race that drops issues created in the <1s window before the first tick. Two partial requirements also need closing: an invalid `PANOPTICON_RECONCILER_INTERVAL_MS` value silently passes NaN to `setInterval`, and a dedicated unit test for all 5 `desiredLabels` states is missing despite being explicitly required in the vBRIEF. All six items are small fixes (5–30 min each). Two pre-existing command injection vulnerabilities in `issues.ts` were identified in modified files and should be fixed alongside the reconciler work.

## Security Issues

- Command Injection via reason Parameter in PR Close (issues.ts:154)
- Command Injection via issueIdentifier in Workspace Destroy (issues.ts:771)

## Performance Issues

- Unbatched INSERT statements in backfill loop (backfill.ts:82-97)

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-805 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

