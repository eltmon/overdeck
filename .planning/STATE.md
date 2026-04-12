# PAN-596: Allow editing a conversation title

## Problem
Conversation titles shown in Mission Control can only be renamed by `curl`-ing the backend's `PATCH /api/conversations/:name` endpoint. No UI exists.

## Backend status: already done
`src/dashboard/server/routes/conversations.ts:695` implements `PATCH /api/conversations/:name`:
- Looks up conversation by name (404 if missing)
- On non-empty `title` string, calls `updateConversationTitle(name, title.trim(), 'manual')`
- `'manual'` source prevents the AI title generator from overwriting user renames (see `generateAiTitle` at line 253 — it re-reads the conversation and only writes if source isn't manual)

No backend changes required. Work is purely frontend.

## Approach
Add inline rename UI in **two** places (per user decision):

1. **ConversationList row** (`src/dashboard/frontend/src/components/MissionControl/ConversationList.tsx`)
   - New pencil icon button next to existing Archive/Copy/Stop actions (line 155–176 pattern)
   - Click → row's `<span class="conversationName">` (line 149) becomes an `<input>`
   - Enter saves, Esc cancels, blur saves, empty reverts
   - `e.stopPropagation()` so clicks don't select the conversation

2. **ConversationPanel header** (`src/dashboard/frontend/src/components/chat/ConversationPanel.tsx`)
   - Pencil icon next to the title at line 120 (`{conversation.title ?? conversation.name}`)
   - Same edit interaction

### Shared logic
- New `updateConversationTitle(name, title)` API helper calling `PATCH /api/conversations/${encodeURIComponent(name)}` with `{ title }`
- `useMutation` with `onSuccess` → `queryClient.invalidateQueries(['conversations'])` for instant UI update
- Optimistic update optional — invalidation is sufficient since the list refetches at 10s anyway and invalidation is immediate
- Place helper in `ConversationList.tsx` (already hosts `archiveConversation`/`stopConversation`) and export, OR extract both panels' shared API calls into a small module. **Decision:** keep helper in `ConversationList.tsx` and export it; `ConversationPanel` imports. No new module needed.

### Edit state
Each component tracks `editingName: string | null` and `draftTitle: string` local state. Refs on the input for autofocus + select-all on entry.

### Empty/whitespace
Trimmed empty string → revert to previous title (don't call API). Matches backend's `typeof body.title === 'string' && body.title.trim()` guard.

## Out of scope
- Backend changes (already works)
- Bulk rename, title history, undo
- Validation beyond non-empty (no max length, no unique check — name is already the unique key)
- Changing `title_source` transitions other than manual (AI→manual is automatic via backend)

## Files touched
1. `src/dashboard/frontend/src/components/MissionControl/ConversationList.tsx` — add API helper, mutation, edit state, pencil button, inline input
2. `src/dashboard/frontend/src/components/chat/ConversationPanel.tsx` — import helper, add edit state, pencil button, inline input at title
3. `src/dashboard/frontend/src/components/MissionControl/styles/mission-control.module.css` — styles for `.conversationEditBtn`, `.conversationNameInput`
4. Possibly `src/dashboard/frontend/src/components/chat/styles/*.module.css` — styles for panel-header edit button/input

## Testing
- Unit: none needed for presentation; existing backend tests cover the PATCH route
- Manual: rename from sidebar, rename from panel header, verify title_source transitions AI→manual and AI generator no longer overwrites, verify Enter/Esc/blur behavior, verify list updates instantly

## Difficulty
`simple` — ~3 files, single feature, established patterns (existing inline buttons, react-query mutation, backend already done). `haiku` should handle it.
