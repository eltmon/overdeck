---
specialist: review-agent
issueId: PAN-539
outcome: changes-requested
timestamp: 2026-04-18T15:11:30Z
---

CODE REVIEW BLOCKED for PAN-539:

1. src/dashboard/frontend/src/components/chat/ComposerFooter.tsx:149-351 keeps pendingImages state across prop changes and only clears it on unmount. ConversationPanel is not consistently keyed outside Mission Control (e.g. src/dashboard/frontend/src/components/MissionControl/ActivityView/AgentSection.tsx:313 and src/dashboard/frontend/src/components/AgentOutputPanel.tsx:128), so switching the conversation prop can leak uploaded attachments into a different conversation and send/delete them against the wrong conversation. Add a regression test covering prop changes without remount. 2. src/dashboard/server/main.ts:29-35 adds startup attachment cleanup via cleanupInactiveConversationAttachments(), but there is no test covering this new startup behavior or integration with boot flow. PAN-539 is a bug fix around attachment lifecycle, so the new startup cleanup path needs regression coverage, not just the service helper test.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-539 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
