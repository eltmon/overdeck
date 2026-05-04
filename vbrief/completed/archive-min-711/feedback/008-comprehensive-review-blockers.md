---
specialist: overseer
issueId: MIN-711
outcome: changes-requested
timestamp: 2026-03-02T23:45:00Z
---

# COMPREHENSIVE CODE REVIEW — MIN-711 Blockers Remaining

Three independent reviewers analyzed your implementation against the PRD. Good progress on the core architecture, but **5 blockers** remain. Fix ALL of these before resubmitting.

## CRITICAL BLOCKERS

### 1. ChatService message IDs broken — conversationId not passed
**File:** `fe/src/services/ChatService.ts` lines 70 and 187-196

`getMessages()` calls `mapMessageResponse(msg, index)` but does NOT pass the `conversationId`. The `mapMessageResponse` method tries to read `data.conversationId` which is `undefined` on the `MessageResponse` interface. Result: ALL message IDs are `msg-{timestamp}-{role}-{index}` — the `conversationId` prefix is always `msg`.

This means messages across different conversations can collide on IDs, React keys are unstable, and message deduplication breaks.

**Fix:**
```typescript
// Line 70: Pass conversationId
async getMessages(conversationId: string): Promise<Message[]> {
  const response = await axios.get(
    `${API_HOST}/api/v1/ai/conversations/${conversationId}/messages`,
    { headers: this.getHeaders() }
  );
  return response.data.map((msg: MessageResponse, index: number) =>
    this.mapMessageResponse(msg, index, conversationId)  // ← ADD conversationId
  );
}

// Line 187: Accept conversationId parameter
private mapMessageResponse(data: MessageResponse, index: number, conversationId: string): Message {
  return {
    id: `${conversationId}-${data.timestamp}-${data.role}-${index}`,
    content: data.content,
    role: data.role as 'user' | 'assistant' | 'system',
    timestamp: data.timestamp,
    modality: data.modality
  };
}
```

### 2. Voice/text NOT unified — VoiceMode doesn't pass conversationId
**File:** `fe/src/components/voice/VoiceMode.tsx` line 48

The PRD's core goal is unified voice+text in one conversation. But VoiceMode calls `fetchTokens()` WITHOUT passing the active conversation ID. This means voice messages go to a **separate conversation** — the exact problem MIN-711 is supposed to fix.

**Fix:**
```typescript
function VoiceModePortalContent() {
  const { tokens, loading, error, fetchTokens, clearTokens } = useHumeVoice();
  const { stopVoiceMode, activeConversationId } = useChat();  // ← Get activeConversationId

  useEffect(() => {
    if (activeConversationId) {
      fetchTokens(activeConversationId);  // ← Pass it
    }
  }, [fetchTokens, activeConversationId]);
```

### 3. B6 (WebSocket title notifications) NOT IMPLEMENTED
**PRD requirement:** "When AIService auto-generates a title after the first message, push a WebSocket event CONVERSATION_TITLE_UPDATED so the frontend can update the conversation list without polling."

This is completely missing. `ConversationService.updateTitleAndTopics()` exists but does NOT emit any WebSocket event. The frontend has no way to know when a conversation title changes without reloading the entire list.

**Fix:** In `AIService.java`, after the title is generated and saved, send:
```java
// After calling conversationService.updateTitleAndTopics(...)
messagingTemplate.convertAndSendToUser(
    customer.getAccount().getEmail(),
    "/queue/events",
    Map.of(
        "type", "CONVERSATION_TITLE_UPDATED",
        "conversationId", conversationId,
        "title", generatedTitle
    )
);
```

### 4. Race condition regression tests MISSING (T8)
**File:** Should be `fe/src/contexts/__tests__/chatRaceConditions.test.ts` — DOES NOT EXIST.

The PRD documents 8 specific race conditions that MIN-711 fixes. Without tests proving these are fixed, the rearchitecture is unverifiable. This is the entire justification for MIN-711.

**Create this file testing all 8 races:**
1. Multiple loadMessagesFromBackend — mount 3 components, verify GET /messages called once
2. Temp ID migration — send message with no conversation, verify messages never empty during CREATING
3. Sync clearing during streaming — start stream, dispatch LOAD_CONVERSATIONS, verify active not cleared
4. Completion vs load race — STREAM_COMPLETE + LOAD_CONVERSATIONS, verify single load
5. Stale closure — send message while streaming, verify both tokens accumulated
6. Delete + select next — delete active of 3, verify exactly one state update selects next
7. Parallel write paradigms — verify no way to write messages outside dispatch
8. StorageManager sync — delete via StorageManager, verify DELETE request + local state cleanup

### 5. ChatService unit tests MISSING (T5)
**File:** Should be `fe/src/services/__tests__/ChatService.test.ts` — DOES NOT EXIST.

The I/O layer has zero test coverage. SSE parsing, auth headers, error handling all untested.

**Create this file covering:**
- SSE stream parsing (chunked and complete)
- Auth header inclusion
- Error response handling (401, 429, 500)
- `getMessages()` returns correct IDs (after fix #1)
- `sendMessage()` SSE streaming callbacks

## SHOULD FIX (non-blocking but important)

### 6. ADD_MESSAGE reducer only removes LAST temp message
**File:** `fe/src/contexts/chatReducer.ts` lines 151-177

If user rapid-fires 2 messages before first persists, only the last temp message is removed. Earlier temp messages become orphans.

**Fix:** Use `filter()` instead of `findLastIndex()`:
```typescript
if (newMessage.role === 'user') {
  filteredMessages = existingMessages.filter(m =>
    !(m.role === 'user' && m.id.startsWith('temp-'))
  );
}
```

### 7. Backend: generateContinuationSummary iterates messages backwards
**File:** `api/.../ConversationController.java` line 570

The loop goes `i = messages.size() - 1` to `0`, producing reversed context for the heuristic.

**Fix:**
```java
int startIndex = Math.max(0, messages.size() - 5);
for (int i = startIndex; i < messages.size(); i++) { ... }
```

### 8. Backend: Null safety in mapRowToMessageWithTimestamp
**File:** `api/.../ChatMemoryService.java` line 257

`type` field from ResultSet is never null-checked before use. Add: `if (type == null) type = "SYSTEM";`

### 9. jest.fn() in sseMock.js should be vi.fn()
**File:** `fe/tests/mocks/sseMock.js` line 193

Uses Jest syntax instead of Vitest. Will fail at runtime.

## COMPLETION CHECKLIST

Before resubmitting:
- [ ] Fix #1: Pass conversationId to mapMessageResponse in ChatService.ts
- [ ] Fix #2: Pass activeConversationId to fetchTokens in VoiceMode.tsx
- [ ] Fix #3: Implement B6 WebSocket title notification in AIService.java
- [ ] Fix #4: Create chatRaceConditions.test.ts with all 8 races
- [ ] Fix #5: Create ChatService.test.ts with I/O layer coverage
- [ ] Fix #6: Update ADD_MESSAGE to remove ALL temp messages
- [ ] Fix #7: Fix backwards iteration in generateContinuationSummary
- [ ] Fix #8: Add null safety in mapRowToMessageWithTimestamp
- [ ] Fix #9: Change jest.fn() to vi.fn() in sseMock.js
- [ ] `cd fe && pnpm build` passes
- [ ] `cd fe && pnpm test` passes (including new test files)
- [ ] `cd api && ./mvnw test` passes
- [ ] All changes committed and pushed
- [ ] Resubmit: `curl -X POST http://localhost:3011/api/workspaces/MIN-711/request-review -H "Content-Type: application/json" -d '{}'`

Do NOT call `pan work done` until every checkbox above is checked. Prioritize fixes #1-#5 (blockers) first, then #6-#9.
