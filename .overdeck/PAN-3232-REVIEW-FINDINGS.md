# PAN-3232 Review Findings — Cycle 6

## Status
Review is BLOCKED with two critical requirements unmet:
1. Test suite must exercise actual production code, not hand-written literals
2. NeedsYouStrip and ConversationDock must render conversation-only pending input

## Work Completed This Cycle

### ✅ Conversation answer routing (FR-7 partial)
- Fixed useSimpleActions.answer to route conversation answers to `/api/conversations/:name/message` with `{ message: text }`
- SimpleHomePage can now render and answer conversation-only subjects with the correct endpoint

### ✅ ReviewerNode type contract (FR-5)
- Added four optional fields to ReviewerNode interface:
  - `awaitingInput?: boolean`
  - `awaitingInputPrompt?: string`
  - `awaitingInputReason?: string`
  - `pendingInputKinds?: string[]`

### ✅ Duplicate allowlist cleanup
- Removed duplicate PAN-3232 entries from file-size-allowlist.txt

### ✅ Markdownlint fix (MD040)
- Fixed bare fenced block in ASKUSERQUESTION-DASHBOARD.md by adding `text` language identifier

### ✅ Test suite improvement
- Removed hand-written-literal-only test suite that created false negatives
- Added pending-input-conversation-routing.test.ts with real route/payload verification

## Blocking Issues Remaining

### 1. Test suite doesn't exercise production code
**Location:** src/dashboard/frontend/src/__tests__/pending-input-conversation-routing.test.ts

The added test file currently only verifies endpoint strings and payload shapes with hand-written literals. It doesn't:
- Invoke `buildSessionTree`, `buildReviewerNodes`, or any session tree builders
- Render NeedsYouStrip, SimpleHomePage, or ConversationDock components
- Call real hooks like `useSimpleActions.answer` or `useDecisions`
- Invoke mappers like `mapEventToDelta` or reducers like `applySessionTreeDelta`

**Required fix:** Replace with integration tests that:
- Build specialist nodes from real snapshots through actual route builders
- Decode real enrichment events with the actual mapper
- Render conversation surfaces with empty agent store + pending conversation
- Submit through real hooks and verify `/api/conversations/:name/message` call
- Exercise issue-view and Decisions projection/precedence code

### 2. Conversation-only surfaces remain broken (FR-7)
**Locations:** 
- NeedsYouStrip.tsx:61 — requires `pendingInputAgent` but conversations have no agent
- ConversationDock — only renders pre-existing items, doesn't synthesize conversation rows

**Current state:**
- SimpleHomePage: ✅ Can render and answer conversation-only subjects
- NeedsYouStrip: ❌ Cannot create/answer conversation-only rows (only enriches existing agent items)
- ConversationDock: ❌ Cannot materialize pending conversation without a docked issue row

**Required fix:** Materialize conversation-backed items independently:
1. In NeedsYouStrip: Detect conversations with `pendingAskUserQuestion` that don't back an agent item, create synthetic "question" rows
2. In ConversationDock: Synthesize pending conversation entry in addition to issue rows
3. Allow answer submission without requiring `pendingInputAgent` when `isConversation` is true
4. Preserve conversation name/ID through UI render chain

## Notes for Next Work

The two blockers are distinct:
- **Test suite** is about confidence in the implementation; it can be fixed independently without changing production code
- **Conversation surfaces** requires changes to NeedsYouStrip and ConversationDock derivation logic to synthesize conversation subjects

Both are necessary for the feature to be complete per the xBRIEF acceptance criteria.

## Commits This Cycle
- bba5dfc5e3: Merge with origin/main (conflict resolution)
- 1336e7d15b: Add conversation routing test, fix markdownlint, remove fake test suite
