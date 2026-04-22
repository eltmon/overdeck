---
specialist: review-agent
issueId: PAN-539
outcome: changes-requested
timestamp: 2026-04-22T20:40:30Z
---

# Review: CHANGES_REQUESTED

## Summary

Requirements coverage is complete (5/5 vBRIEF items, 19/21 ACs fully met with 2 intentional security-driven drifts). No blockers, no critical issues. Four high-priority fixes are warranted before merge: (1) the `@/path` attachment regex matches prose and causes legitimate messages to 400 — flagged by both correctness and security; (2) `generateAiTitle` spawn lost its 30 s timeout and can split multi-byte UTF-8 across chunks plus has an unguarded stdin error; (3) `removePendingImage` performs HTTP side effects inside a React state updater, causing duplicate DELETEs under Strict Mode; (4) CSRF gate allows requests with neither Origin nor Referer. Medium: cache `summarizeConversationActivity` by mtimeMs so list polling doesn't re-parse every JSONL. The PR is a net security win (shell-injection closed, magic-byte validation, size caps, consistent origin checks) — recommend request-changes with the four fixes, then approve.

## Security Issues

- CSRF gate allows requests with no Origin and no Referer
- Attachment-path regex matches `@/path` tokens in prose
- Hard-coded trust for localhost:3000
- Title-generation spawn env allowlist is a no-op
- Base64 canonicalization round-trip cost

## Performance Issues

- Conversations list endpoint parses every session JSONL per refresh
- Base64 encoding duplicates image data in browser memory

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-539 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

