---
specialist: review-agent
issueId: PAN-539
outcome: changes-requested
timestamp: 2026-04-24T03:42:35Z
---

# Review: CHANGES_REQUESTED

## Summary

PAN-539 delivers a complete and well-implemented image paste/drop feature. The core user flow (paste → thumbnail → @path injection → send) is fully functional with solid MIME validation, magic-byte checking, and path containment. However, there is one blocker (path traversal via unvalidated specialist project name in conversations.ts:969), three critical security issues (missing CSRF guard on /unarchive, XFF rate-limit bypass, world-readable launcher script with embedded API keys), and a medium requirements gap (missing TTL cleanup for orphaned attachments). Fix the blocker and critical issues before merge; the TTL cleanup should be added to satisfy the vBRIEF server-cleanup-interval commitment.

## Security Issues

- Path traversal via unvalidated specialist project name
- Missing CSRF origin check on POST /unarchive
- Rate-limit bypass via X-Forwarded-For spoofing
- Launcher script written world-readable with embedded API keys

## Performance Issues

- Sequential tmux checks in POST restart-all cause 100s+ latency
- Unbounded session attachment cache key accumulation
- 500ms polling in discoverSessionFile
- Triple stat calls in attachment cleanup
- Activity summary cache with no eviction
- Messages cache unbounded growth
- Compact boundary cache staleness after external compaction
- Model backfill without timeout on startup
- Poll service unbounded concurrent tmux queries

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-539 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

