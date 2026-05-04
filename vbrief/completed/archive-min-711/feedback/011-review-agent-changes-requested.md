---
specialist: review-agent
issueId: MIN-711
outcome: changes-requested
timestamp: 2026-03-03T15:41:00Z
---

CODE REVIEW BLOCKED for MIN-711:

Re-review: 12 of 27 blockers FIXED, 5 partially fixed, 8 still broken. Remaining blockers:

API:
- #2 getChatResponse lacks @Transactional — 4 DB ops with no transaction wrapper
- #3 continueConversation missing catch-all exception handler — stack trace leaks
- #5 getConversationHistoryWithTimestamps still returns empty list on DB error
- #7 Magic number 20 still hardcoded in 3 places instead of using DEFAULT_MESSAGE_LIMIT constant

FE:
- #13 No tests for ChatService.getUsageStatus() and updateConversationTitle()
- #14 No tests for RESET and REMOVE_LAST_ASSISTANT_MESSAGE reducer actions
- #15 No tests for regenerateResponse, continueConversation, checkUsageStatus, reset in ChatContext
- #25 Integration test missing import { rest } from 'msw' — will crash with ReferenceError
- #27 Voice mode split-brain: VoiceFAB/QuickTypeBar/KaiaSettings/VoiceAssistantButton write Jotai voiceModeOpenAtom but VoiceMode reads ChatContext.voiceState.active — no bridge between state systems

Partially fixed (not blocking but should improve):
- #1 updateMessageModality uses SKIP LOCKED which silently skips on contention
- #10 abortStream still uses state.activeConversationId instead of stateRef
- #16 useConversationManager.test.js exists but has trivial no-throw-only assertions
- #20 Message edit/delete buttons visible but non-functional (regenerate works)
- #4 generateContinuationSummary Javadoc/API docs still say AI summary

NOT a blocker (verified): #12 API path inconsistency is correct — AIController at /api/ai, ConversationController at /api/v1/ai/conversations per backend routes.

Fix these issues, commit and push, then RESUBMIT for review by running:
curl -X POST http://localhost:3011/api/workspaces/MIN-711/request-review -H "Content-Type: application/json" -d '{}'
Do NOT stop until review passes.
