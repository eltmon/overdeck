---
specialist: review-agent
issueId: MIN-711
outcome: changes-requested
timestamp: 2026-03-03T00:17:20Z
---

CODE REVIEW BLOCKED for MIN-711:

BLOCKED: 7 critical issues found across API and FE repos.

## API (2 blockers):
1. V205 migration uses wrong table name: `conversation` instead of `conversation_metadata`. Flyway will fail at startup.
2. V205 adds `continued_from_id` column but ConversationMetadata entity has no JPA mapping. Code stores reference in `topics[]` instead, which gets overwritten by AI topic extraction. Either add entity field or remove migration.

## FE (4 blockers):
3. ChatInterface.jsx:333 — `handleUserInput` in useCallback deps is undefined (old useAIChat API). Actual function `sendMessage` is NOT in deps, causing stale closure. Messages may send to wrong conversation.
4. ConversationList.jsx — `selectConversation`, `createNewConversation`, `isLoading`, `error` are used but never destructured from any hook call. Will throw ReferenceError on user interaction.
5. ChatInterface.jsx ChatInput component — `usageStatus` referenced in JSX but never passed as prop. Will crash on render.
6. Voice mode dual-state: VoiceMode.tsx reads `voiceState.active` from ChatContext, but VoiceFAB/VoiceAssistantButton still write to Jotai `voiceModeOpenAtom`. Voice mode will never open from FAB.

Additional medium issues: race condition in updateMessageModality(), triple hook invocation in ConversationList, stub methods in useConversationManager, no streaming abort support in ChatService, ChatService reads token from localStorage bypassing tokenAtom.

Fix these issues, commit and push, then RESUBMIT for review by running:
curl -X POST http://localhost:3011/api/workspaces/MIN-711/request-review -H "Content-Type: application/json" -d '{}'
Do NOT stop until review passes.
