---
specialist: review-agent
issueId: PAN-539
outcome: changes-requested
timestamp: 2026-04-18T15:36:04Z
---

CODE REVIEW BLOCKED for PAN-539:

Blocking issues: (1) src/dashboard/server/routes/__tests__/conversations.test.ts adds coverage for cleanupConversationAttachments() and asserts archive preserves attachments, but production code never calls cleanupConversationAttachments on archive or lifecycle transitions, so uploaded attachment directories become orphaned indefinitely. This is a missing lifecycle implementation for the new attachment feature. (2) src/lib/database/conversations-db.ts exports listArchivedConversationNames() but nothing uses it anywhere in the branch, leaving dead code in production.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-539 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
