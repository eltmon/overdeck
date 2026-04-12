# PAN-596: Allow editing a conversation title

## Status: In Progress

## Current Phase
Closing beads c72 and rel, then verifying bead 8o6 (title_source backend behavior)

## Completed Work
- [x] feature-pan-489-rel: Added exported `updateConversationTitle(name, title)` API helper to ConversationList.tsx (commit: 6b1e048f)
- [x] feature-pan-489-8er: Inline rename UI in ConversationList sidebar — pencil button, edit mode input, Enter/Esc/blur handlers, CSS styles; also fixed pre-existing TS error in deacon.ts (commit: 1322f09f)
- [x] feature-pan-489-c72: Inline rename UI in ConversationPanel header — pencil button, edit state, mutation, Enter/Esc/blur, CSS styles (commit: a479538b)

## Remaining Work
- [ ] feature-pan-489-8o6: Verify title_source transitions to 'manual' and blocks AI override (code-path verification, no code changes needed)

## Key Decisions
- API helper lives in ConversationList.tsx and is exported; ConversationPanel imports it
- Each component manages its own `useMutation` instance (follows existing pattern)
- Optimistic update not needed — invalidation is sufficient (list refetches at 10s, invalidation is immediate)
- Edit state: editingTitle/draftTitle per component; useRef for autofocus
- Empty/whitespace → revert without calling API (matches backend guard)
- Pencil icon button opacity-0 until hover on both sidebar row and panel title

## Specialist Feedback
- None yet
