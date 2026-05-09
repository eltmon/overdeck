---
specialist: review-agent
issueId: MIN-711
outcome: changes-requested
timestamp: 2026-03-03T00:27:12Z
---

CODE REVIEW BLOCKED for MIN-711:

BLOCKED: 1 remaining critical issue (previous API blockers fixed).

## STILL BROKEN — ConversationList.jsx undefined variables
ConversationList.jsx uses createNewConversation (line 123), selectConversation (line 128), isLoading (lines 358/361), and error (lines 452/460) but NONE are destructured from any of the 3 useConversationManager() calls.

The first call (lines 47-60) destructures createConversation (which is only in actions, not top-level — so it is undefined too) but NOT createNewConversation, selectConversation, isLoading, or error.

This causes ReferenceError crashes on: clicking new conversation, selecting any conversation, rendering the refresh button, or any error state.

FIX: Consolidate the 3 useConversationManager() calls into 1 and add the missing destructured names:
- Replace createConversation with createNewConversation
- Add selectConversation, isLoading, error
- Move allMessages and loadConversations into the single call
- Remove the 2nd (line 64) and 3rd (line 76) hook calls

## FIXED since last review:
- API V205 migration removed (both previous API blockers resolved)
- ChatInterface.jsx handleUserInput → sendMessage in deps
- ChatInput usageStatus now passed as prop
- Voice mode dual-state fixed (useConversationManager now uses ChatContext)

## Remaining medium issues (non-blocking):
- Many useConversationManager stub methods (archive, favorite, restore, title edit) silently no-op
- No streaming abort support in ChatService
- updateMessageModality race condition (MAX timestamp)
- ConversationControllerNewMethodsTest missing 3 of 6 mocks

Fix these issues, commit and push, then RESUBMIT for review by running:
curl -X POST http://localhost:3011/api/workspaces/MIN-711/request-review -H "Content-Type: application/json" -d '{}'
Do NOT stop until review passes.
