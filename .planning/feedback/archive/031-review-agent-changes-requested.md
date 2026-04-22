---
specialist: review-agent
issueId: PAN-539
outcome: changes-requested
timestamp: 2026-04-18T16:03:39Z
---

CODE REVIEW BLOCKED for PAN-539:

1. src/dashboard/server/routes/conversations.ts:613-615, 941-943 and src/dashboard/server/services/conversation-lifecycle.ts:36-39 call cleanupUnreferencedConversationAttachments() immediately after stop/archive/session-end. That helper deletes every upload not already present in the JSONL, so unsent attachments are destroyed as soon as a user stops/switches/closes a conversation. This is a real data-loss bug in the new image workflow. 2. The regression tests only cover cleanup after uploads are already referenced in the session file or explicitly removed. There is no test protecting unsent uploaded images from stop/archive/lifecycle cleanup, so the bug above would ship unnoticed.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-539 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
