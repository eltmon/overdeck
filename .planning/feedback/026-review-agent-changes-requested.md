---
specialist: review-agent
issueId: PAN-539
outcome: changes-requested
timestamp: 2026-04-18T14:55:50Z
---

CODE REVIEW BLOCKED for PAN-539:

1. src/dashboard/server/routes/conversations.ts:165-179 accepts arbitrary-size base64 image payloads and writes them to disk with no size limit, enabling trivial memory/disk exhaustion via the new upload endpoint. Add a strict max decoded byte limit and regression tests for oversized payload rejection. 2. src/dashboard/server/main.ts:29-35 and src/lib/database/conversations-db.ts:120-127 delete attachments for every ended conversation on startup. Because conversations are marked ended across restarts while their history remains available, this can silently delete valid attachments still referenced from saved conversation messages after a dashboard restart. Cleanup must only remove attachments when a conversation is archived or otherwise truly terminal, and tests should cover restart persistence for ended-but-retained conversations. 3. Missing regression tests: src/dashboard/frontend/src/components/chat/__tests__/ComposerFooter.test.tsx covers failed uploads but not the "upload still in progress" guard at ComposerFooter.tsx:282-286, and src/dashboard/server/routes/__tests__/conversations.test.ts lacks a regression test for oversized upload rejection.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-539 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
