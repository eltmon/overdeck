# PAN-3232 Completion Specification

## Executive Summary

PAN-3232 is **60% feature-complete** but has two critical implementation gaps preventing merge:

1. **NeedsYouStrip and ConversationDock** cannot yet render conversation-only pending input
2. **Test coverage** is symbolic (hand-written literals) not mechanical (production code paths)

Both gaps require focused implementation work, not incremental patches. This document specifies the exact work needed.

## What Works

✅ **SimpleHomePage conversation-only rendering** — can display and answer conversation pending-input  
✅ **Conversation message endpoint** — useSimpleActions.answer routes to `/api/conversations/:name/message` with correct payload  
✅ **ReviewerNode type contract** — specialist nodes declare pending-input fields  
✅ **Event schema and delta infrastructure** — pending_input_changed delta, enrichment events with issueId  
✅ **Server-side specialist projection** — buildReviewerNodes, buildTestNodes, buildShipNodes all include pending-input fields  
✅ **Documentation** — all required doc updates, markdownlint passes

## What Needs Implementation

### 1. NeedsYouStrip Conversation Materialization

**File:** `src/dashboard/frontend/src/components/KanbanBoard/NeedsYouStrip.tsx`

**Current state:**
- Derives items only from `bucketSimpleHome(derivations).needsYou` (agent-backed)
- Cannot create rows for conversations with no backing issue or agent

**Required changes:**

a. **Detect conversation-only subjects**
   - In the useMemo at line 112, detect subjects with `pendingAskUserQuestion` where:
     - `agentId` starts with `conv-` (or use a more robust type check)
     - No corresponding agent exists in `agentsById`
     - No issue row exists in derivations
   
b. **Materialize synthetic rows**
   - Create a "question" kind item for each such conversation
   - Carry the conversation name as a separate property (not `pendingInputAgent`)
   - Store issue ID from subject if available

c. **Update NeedsYouRow component**
   - Accept optional `conversationName` prop alongside `item`
   - When rendering question kind with `conversationName` (not `questionAgent`):
     - Disable button only when `answer` is empty, NOT when `!questionAgent`
     - Pass `isConversation: true` to `actions.answer.mutate`
     - Use `conversationName` as the `agentId` parameter

d. **Execution path**
   ```
   usePendingInputSubjects() 
     → conversation rows with pendingAskUserQuestion
     → filter: no agent backing, no issue item
     → create synthetic "question" items
     → render NeedsYouRow with conversationName
     → answer.mutate({ agentId: conversationName, text, isConversation: true })
   ```

### 2. ConversationDock Conversation Rendering

**File:** `src/dashboard/frontend/src/components/CommandDeck/ConversationDock.tsx`

**Current state:**
- Only renders pre-existing docked issues
- Does not detect or render pending conversations

**Required changes:**

a. **Add conversation pending-input detection**
   - Query `usePendingInputSubjects()` in the component
   - Find subjects with `pendingAskUserQuestion` and no backing agent/issue

b. **Materialize conversation items**
   - Create a "dock item" entry for each pending conversation
   - Store conversation name, issue ID (if available), pending question

c. **Render conversation entries**
   - In the expanded dock view, render conversation items alongside issue rows
   - Show pending question text
   - Provide a button to open/activate the conversation

d. **Execution path**
   ```
   useConvoDock() + usePendingInputSubjects()
     → docked issues + conversation-only subjects
     → render both in dock rail
     → click opens conversation in ConversationPanel (not issue panel)
   ```

### 3. Integration Test Coverage

**File:** `src/dashboard/frontend/src/__tests__/pending-input-conversation-routing.test.ts`

**Current state:**
- Only hand-writes endpoint strings and payload shapes
- Doesn't import or invoke any production code
- Not in default test gate (npm test)

**Required additions:**

a. **Answer mutation integration test**
   ```typescript
   it('renders SimpleHomePage, answers conversation question through real mutation', () => {
     // 1. Render SimpleHomePage with pending conversation in usePendingInputSubjects
     // 2. Verify conversation question appears in extraQuestions
     // 3. Click answer button, type response
     // 4. Assert fetch called with /api/conversations/:name/message
     // 5. Assert payload shape { message: text }
   });
   ```

b. **NeedsYouStrip conversation materialization test**
   ```typescript
   it('NeedsYouStrip renders conversation-only pending input', () => {
     // 1. Mock usePendingInputSubjects to return conversation subject (no agent)
     // 2. Render NeedsYouStrip
     // 3. Verify conversation item appears in strip
     // 4. Click answer button, verify isConversation: true in mutation
   });
   ```

c. **ConversationDock conversation rendering test**
   ```typescript
   it('ConversationDock displays pending conversation entry', () => {
     // 1. Mock usePendingInputSubjects with conversation subject
     // 2. Render ConversationDock
     // 3. Verify conversation appears in dock
     // 4. Verify click opens conversation (not issue)
   });
   ```

d. **Server specialist route test**
   ```typescript
   it('buildReviewerNodes includes pending-input fields from snapshot', () => {
     // 1. Create mock reviewer snapshot with awaitingInput data
     // 2. Call buildReviewerNodes
     // 3. Assert returned node has awaitingInput, prompt, reason, pendingInputKinds
   });
   ```

e. **Event-to-delta mapper test**
   ```typescript
   it('mapEventToDelta creates pending_input_changed delta from enrichment event', () => {
     // 1. Create mock agent.enrichment_changed event
     // 2. Call mapEventToDelta
     // 3. Assert delta kind is pending_input_changed
     // 4. Assert delta includes awaitingInput, prompt, reason, pendingInputKinds
   });
   ```

f. **Client reducer test**
   ```typescript
   it('applySessionTreeDelta updates and clears pending input on node', () => {
     // 1. Create initial node state with awaitingInput: false
     // 2. Apply pending_input_changed delta with awaitingInput: true
     // 3. Assert node updated
     // 4. Apply delta with awaitingInput: false (clearing)
     // 5. Assert prompt/reason/kinds all cleared
   });
   ```

**Integration with test gate:**
- Add to `src/dashboard/frontend/src/__tests__/` so frontend test runner picks it up
- Also ensure it's in root `npm test` gate by updating root vitest config or creating a top-level test entry

## Acceptance Criteria Met by Completion

| Requirement | Path | Status |
|---|---|---|
| FR-1: Issue-view projection | src/dashboard/server/routes/projects.ts | ✅ Impl, ⚠️ No test |
| FR-2: Decisions precedence | src/dashboard/frontend/src/lib/useDecisions.ts | ✅ Impl, ⚠️ No test |
| FR-3: SessionPanel label/kind | src/dashboard/frontend/src/components/CommandDeck/SessionView/SessionPanel.tsx | ✅ Impl, ⚠️ Advisory caveat |
| FR-4/NFR-1/NFR-2: Delta infrastructure | src/dashboard/server/ws-rpc.ts + src/dashboard/frontend/src/lib/store.ts | ✅ Impl, ⚠️ No test |
| FR-5: Specialist nodes | src/dashboard/server/routes/reviewer-tree.ts | ✅ Impl + contract, ⚠️ No test |
| FR-6/NFR-3: Conversation routing | src/dashboard/frontend/src/lib/simple/useSimpleActions.ts | ✅ Impl + partial FR-7 |
| FR-7: Conversation surfaces | NeedsYouStrip + ConversationDock | ❌ Incomplete |
| FR-8: Documentation | docs/ASKUSERQUESTION-DASHBOARD.md | ✅ Impl + markdownlint |

## Effort Estimate

- **NeedsYouStrip materialization:** 2-3 hours (component logic + derivation updates)
- **ConversationDock materialization:** 2-3 hours (dock detection + rendering)
- **Integration test suite:** 4-6 hours (6-8 focused tests covering all seams)
- **Total:** ~9-12 hours focused work

## Testing Strategy

Tests should follow the pattern of existing integration tests in the codebase:
- Use `render()` from vitest/React Testing Library for component tests
- Mock external APIs and hooks with `vi.fn()` for predictable test environments
- Assert on actual DOM output and function calls, not internal state
- Use `beforeEach`/`afterEach` for mock setup/teardown

## Notes for Next Work Session

1. **Start with NeedsYouStrip** — it's the simpler of the two UI changes and will validate the pattern
2. **Then ConversationDock** — follows same pattern, just in a different component
3. **Tests last** — write them as you implement, not as an afterthought
4. **Branch state** — current branch is clean; all prior cycle fixes remain intact
5. **Review cycle** — expect one more review cycle after implementation; the review agent is clear on what's needed

This is focused, well-scoped work. It's not a refactor or redesign—it's completing what was promised in the xBRIEF.
