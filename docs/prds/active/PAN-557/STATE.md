# Planning: PAN-557 — Conversation Deep Linking & Copy Buttons

## Context

Conversations (user-driven Claude Code sessions spawned from Mission Control) are currently not directly linkable. Selection is internal React state only (`selectedConversation: string | null`). Users cannot share a URL to a specific conversation.

## Decisions

### 1. Deep Link URL Format
- **Path**: `/conv/:id` where `id` is the conversation's numeric database primary key
- **Rationale**: `id` is stable; `name` can be user-renamed. Using `/conv/` (not `/convoy/`) avoids confusion with the Convoy feature area.

### 2. Deep Link Navigation Behavior
- Navigating to `/conv/:id` opens the Mission Control tab (kanban) with the specific conversation loaded in the main panel.
- No separate "conv" tab needed — conversations are already managed in Mission Control.

### 3. Copy Button Feedback
- Icon swap: `Copy` → `Check` (lucide-react) for 2 seconds, then reverts
- Same pattern used by code block copy buttons in `ChatMarkdown.tsx`

## Affected Files

| File | Change |
|------|--------|
| `App.tsx` | Add `/conv/:id` route handler, sync URL to MissionControl |
| `MissionControl/index.tsx` | Accept `convId` prop, load conversation by ID on mount |
| `MissionControl/ConversationList.tsx` | Add copy-link button next to archive button |
| `chat/ConversationPanel.tsx` | Add copy-link button in header |
| Dashboard server | Add `GET /api/conversations/:id` endpoint |

## Implementation Plan

1. **Backend**: Add `GET /api/conversations/:id` to fetch a single conversation by ID
2. **Routing**: Add `/conv/:id` path handling in `App.tsx` that sets a `convId` state, syncs to `MissionControl`
3. **MissionControl**: Accept `convId` prop, select conversation by ID on mount (look up name from conversations list)
4. **Copy button in list**: Add Copy icon button next to Archive button in `ConversationList.tsx`
5. **Copy button in panel**: Add Copy icon button in `ConversationPanel.tsx` header area
6. **CSS**: Style copy buttons to match existing archive button patterns (hover-reveal, consistent sizing)

## Out of Scope
- Changing how conversations are stored/named
- Any changes to Convoys (unrelated feature)
- Toast notifications (icon-swap feedback is sufficient per user choice)
