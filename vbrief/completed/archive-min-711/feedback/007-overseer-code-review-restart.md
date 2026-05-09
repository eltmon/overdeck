---
specialist: overseer
issueId: MIN-711
outcome: changes-requested
timestamp: 2026-03-02T23:15:00Z
---

# OVERSEER CODE REVIEW — MIN-711 Remaining Work

Your previous session crashed during system reboot. The Flyway V100 conflict is already fixed (renumbered to V204/V205). The backend compilation issues are resolved. But several critical code issues remain. Fix ALL of these, then resubmit.

## CRITICAL BLOCKERS (must fix)

### 1. Undefined `voiceSessionIdAtom` — Runtime Crash
**File:** `src/atoms/kaiaSidebarAtoms.js` around line 598

```javascript
export const switchToVoiceModeAtom = atom(
  null,
  (get, set, sessionId = null) => {
    set(sidebarModeAtom, 'voice');
    if (sessionId) {
      set(voiceSessionIdAtom, sessionId);  // ❌ voiceSessionIdAtom is NOT DEFINED anywhere
    }
  }
);
```

`voiceSessionIdAtom` was deleted as part of F10 dead code removal but this reference was left behind. This will crash at runtime when switching to voice mode.

**Fix:** Remove the `voiceSessionIdAtom` setter. Voice session state is now managed by ChatContext. Either delete the whole `switchToVoiceModeAtom` if nothing uses it, or just remove the `voiceSessionIdAtom` reference:
```javascript
export const switchToVoiceModeAtom = atom(
  null,
  (get, set) => {
    set(sidebarModeAtom, 'voice');
  }
);
```

### 2. Infinite Recursion in `sendMessage` — Stack Overflow Risk
**File:** `src/contexts/ChatContext.tsx` in the `sendMessage` function

```typescript
if (!targetConversationId) {
  const newId = await createConversation(content.slice(0, 50), false);
  return sendMessage(content, newId);  // ❌ If createConversation fails/returns null → infinite loop
}
```

Two recursion paths with no guard:
- If `createConversation` throws, error is uncaught, recursion loops
- If `continueConversation` returns a conversation still at 20-message cap, recursion loops

**Fix:** Add try/catch around conversation creation and a recursion depth guard:
```typescript
const sendMessage = useCallback(async (content: string, conversationId?: string, _depth = 0) => {
  if (_depth > 2) throw new Error('sendMessage recursion limit exceeded');

  const targetConversationId = conversationId || state.activeConversationId;

  if (!targetConversationId) {
    try {
      const newId = await createConversation(content.slice(0, 50), false);
      if (!newId) throw new Error('Failed to create conversation');
      return sendMessage(content, newId, _depth + 1);
    } catch (error) {
      dispatch(chatActions.setError(error instanceof Error ? error.message : 'Failed to create conversation'));
      return;
    }
  }
  // ... similar guard for continuation path
```

### 3. Message ID Instability — Duplicates & Flicker
**File:** `src/services/ChatService.ts` in `mapMessageResponse`

```typescript
private mapMessageResponse(data: MessageResponse): Message {
  return {
    id: `${data.timestamp}-${Math.random().toString(36).substr(2, 9)}`,  // ❌ Random ID
    ...
  };
}
```

Every call to `getMessages()` generates NEW random IDs for the same backend messages. This means:
- Same message loaded twice → shown as 2 different messages
- React keys unstable → unnecessary re-renders, lost state
- Optimistic messages can't be reconciled with synced messages

**Fix:** Use a deterministic ID. The backend doesn't return an `id` field for chat memory messages, so create a stable composite key:
```typescript
private mapMessageResponse(data: MessageResponse, index: number): Message {
  return {
    id: `${data.conversationId}-${data.timestamp}-${data.role}-${index}`,
    ...
  };
}
```
Or better: update the backend `MessageDTO` to include the database row ID, then use that.

### 4. Dead Jotai Conversation Atoms — ~200 Lines of Dead Code
**File:** `src/atoms/kaiaSidebarAtoms.js`

The old conversation state atoms (`conversationsAtom`, `conversationMessagesAtom`, `activeConversationAtom`, `activeConversationDataAtom`, `createConversationAtom`, etc.) are still defined but no longer the source of truth — ChatContext owns all this state now.

**Action:** Remove all conversation-related atoms that are now handled by ChatContext. Keep ONLY the sidebar UI state atoms (`isSidebarOpenAtom`, `sidebarModeAtom`, `chatInputAtom`, `pendingAutoSendAtom`). Check every import of these atoms across the codebase and verify nothing still reads from them directly.

## REQUIRED VERIFICATION

After fixing all the above:

1. **Build check:** `cd fe && pnpm build` — must succeed with zero errors
2. **Unit tests:** `cd fe && pnpm test` — all 71+ tests must pass
3. **Backend tests:** `cd api && ./mvnw test` — must compile and pass
4. **Commit all changes** with a clear message
5. **Push to branch**
6. **Resubmit for review:**
   ```
   curl -X POST http://localhost:3011/api/workspaces/MIN-711/request-review -H "Content-Type: application/json" -d '{}'
   ```

## NON-BLOCKERS (fix if time permits)

- `findLastIndex` polyfill for older browsers (chatReducer.ts)
- Stale closure in `selectConversation` (ChatContext.tsx) — use ref-based tracking
- Add AbortController support for SSE stream cancellation
- Clean up misleading variable name `allMessages` in StorageManager.jsx

Do NOT call `pan work done` until the build passes, all tests pass, and review is resubmitted.
