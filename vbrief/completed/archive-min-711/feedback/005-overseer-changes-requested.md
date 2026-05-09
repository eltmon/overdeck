---
specialist: overseer
issueId: MIN-711
outcome: changes-requested
timestamp: 2026-03-02T17:30:00Z
---

# OVERSEER CODE REVIEW — MIN-711 NOT COMPLETE

Your beads all show complete but the work is NOT done. The following issues MUST be fixed before calling `pan work done` again. Do NOT stop working until ALL of these are addressed.

## BLOCKERS (must fix)

### 1. UNCOMMITTED CHANGES — B5 and B6 are not committed
You have unstaged working tree changes in 4 files:
- `AIChatMessage.java` — chatHistory field removal (B5)
- `AIController.java` — setChatHistory/getChatHistory reference removal
- `AIStreamingController.java` — same
- `AIService.java` — WebSocket title notification (B6)

These changes exist ONLY in your working tree. They are NOT on the branch. You must commit them.

**BUT FIRST** — fix `AIControllerTest.java` line 304 which calls `setChatHistory(new ArrayList<>())`. That method no longer exists after your B5 changes, so the entire test suite won't compile. Fix the test, THEN commit B5+B6 together.

### 2. DUAL SOURCE OF TRUTH — 5 components still use Jotai atoms for chat state
Your ChatProvider does NOT write to the old Jotai atoms, but these components still READ from them. They will show stale/empty data:

- `StorageManager.jsx` — still uses `conversationsAtom` and `conversationMessagesAtom`
- `ChatHeader.jsx` — still uses `activeConversationAtom`, `activeConversationDataAtom`, `createConversationAtom`
- `KaiaSidebar.jsx` — 4 Jotai chat atoms
- `KaiaHeaderButton.tsx` — 2 Jotai chat atoms
- `KaiaFloatingActionButton.jsx` — 2 Jotai chat atoms

You MUST migrate these to use `useChat()` from ChatContext, or they will be completely broken at runtime. This is the whole point of the rearchitecture — single source of truth.

### 3. AIStreamingService is 862 lines — PRD says under 200
Success criterion #4: "All dead code removed, AIStreamingService under 200 lines." You did not touch this file at all. Refactor it — extract dead code, remove legacy paths that are replaced by ChatService.

### 4. Duplicate test files — pick one location
You created the same tests in TWO places:
- `src/contexts/__tests__/chatReducer.test.ts` AND `tests/unit/contexts/chatReducer.test.js`
- `src/contexts/__tests__/ChatContext.test.tsx` AND `tests/unit/contexts/ChatContext.test.jsx`

Pick ONE location (prefer `src/__tests__/` colocated pattern), delete the duplicates.

### 5. Tests were NEVER RUN — run them
None of your tests (unit or E2E) were ever executed. After fixing the backend compilation issue (#1 above) and deduplicating test files (#4), actually RUN the tests:
- `cd fe && pnpm test` for unit tests
- `cd api && ./mvnw test` for backend tests
- Fix any failures before marking complete

### 6. useAIChat.jsx and useConversationManager.js — delete or justify
The PRD says to delete these files. You refactored them into thin wrappers instead. If other non-chat components depend on them, that's fine — but document WHY in STATE.md. If nothing outside the migrated components uses them, delete them.

## NON-BLOCKERS (fix if time permits)

### 7. Continuation summary uses hardcoded heuristics
`generateContinuationSummary()` in ConversationService does naive keyword matching (`context.contains("task")` -> "Task Planning Continued"). The PRD says "AI-generated summary." At minimum, call the existing AI summarization endpoint instead of the heuristic.

### 8. Topics field overloaded for continuation references
`conversation.setTopics(new String[]{"continued_from:" + previousConversationId})` is a hack. Acceptable for now but add a TODO comment noting it should be a dedicated column.

## COMPLETION CHECKLIST

Before calling `pan work done MIN-711`:
- [ ] B5+B6 committed (with AIControllerTest fix)
- [ ] All 5 Jotai-dependent components migrated to ChatContext
- [ ] AIStreamingService refactored to < 200 lines
- [ ] Duplicate test files removed
- [ ] `pnpm test` passes in fe/
- [ ] `./mvnw test` passes in api/
- [ ] All changes committed and pushed
- [ ] STATE.md updated with accurate remaining work status

Do NOT call `pan work done` until every checkbox above is checked.
