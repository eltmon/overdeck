---
specialist: review-agent
issueId: PAN-539
outcome: changes-requested
timestamp: 2026-04-22T22:51:06Z
---

# Review: CHANGES_REQUESTED

## Summary

No blockers or critical issues. Three high-priority items warrant fixes before merge: (1) the delete-image route is missing the `getConversationByName` existence guard that every other mutating route applies, and the `conversation-attachments` module should add an `assertSafeName` boundary check for defense in depth; (2) `cleanupUnreferencedConversationAttachments` uses strict `>` mtime comparison, so attachments uploaded in the same mtime tick as the session JSONL can be deleted on stop/archive — flip to `>=`; (3) `GET /api/conversations` now performs per-conversation JSONL parsing on the request path via `summarizeConversationActivity`, which will regress list-refresh latency at scale. Remaining findings are hardening (trusted-origin fallbacks, NaN parseInt, per-conversation quota, base64 round-trip over-strictness) and two vBRIEF AC wording drifts that are stronger than spec but should be reconciled post-merge. Requirements coverage is otherwise complete (19/21 literal, 2 deviations functionally satisfied).

## Security Issues

- Trusted origins unconditionally include localhost:3000
- Conversation name flows into filesystem paths without revalidation
- Missing per-conversation attachment quota
- SAFE_MODEL_PATTERN has no length cap
- generateAiTitle spawn env not minimized
- validateCwdContainment does not normalize paths

## Performance Issues

- GET /api/conversations does per-row session parsing on every request
- Stop/archive cleanup rescans full session JSONL
- Client-side base64 string concatenation peak memory

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-539 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

