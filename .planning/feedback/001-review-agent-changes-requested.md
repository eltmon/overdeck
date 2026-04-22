---
specialist: review-agent
issueId: PAN-539
outcome: changes-requested
timestamp: 2026-04-22T20:24:26Z
---

# Review: CHANGES_REQUESTED

## Summary

Feature is functionally complete — requirements review confirms all 5 vBRIEF items and 21 ACs satisfied end-to-end, and the correctness reviewer's "missing TTL cleanup" blocker is resolved by the intentional redesign to lifecycle-based per-conversation cleanup. However, the security review surfaced two critical shell-injection RCEs in routes/conversations.ts (user message in generateAiTitle's exec pipeline, and cwd/issueId/effort/model in the launcher-script template) that must be fixed before merge, plus incomplete validateOrigin coverage on mutating routes that exposes them to CSRF. A performance concern (full JSONL scan on every cleanup) and a latent path-traversal via an unused sanitizeName are high-priority but non-blocking.

## Security Issues

- Shell command injection in generateAiTitle via user message
- Shell injection in spawnConversationSession launcher script template
- Incomplete validateOrigin coverage on mutating routes
- Latent path traversal via unused sanitizeName
- Internal error messages echoed to clients
- MIME type trusted without magic-byte validation

## Performance Issues

- Full session JSONL scan during attachment cleanup on every stop/archive and lifecycle poll

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-539 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

