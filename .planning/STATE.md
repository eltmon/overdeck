# Planning: PAN-557 — Conversation Deep Linking & Copy Buttons

## Status: In Progress

## Current Phase
Implementing beads one at a time. Bead 1 (GET /api/conversations/:id endpoint) complete.

## Completed Work
- [x] bead-1: Add GET /api/conversations/:id endpoint (commit: fee83b67)

## Remaining Work
- [ ] bead-2: Add /conv/:id route in App.tsx
- [ ] bead-3: Pass convId prop to MissionControl
- [ ] bead-4: Add copy-link button in ConversationPanel header
- [ ] bead-5: Add copy-link button in ConversationList

## Key Decisions
- D1: Using numeric database `id` for deep linking (not `name`) — `id` is stable, `name` can be user-renamed
- D2: `/conv/:id` path opens Mission Control tab with conversation loaded — no separate tab needed

## Specialist Feedback
- None yet

## Context

Conversations (user-driven Claude Code sessions spawned from Mission Control) are currently not directly linkable. Selection is internal React state only (`selectedConversation: string | null`). Users cannot share a URL to a specific conversation.

### Deep Link URL Format
- **Path**: `/conv/:id` where `id` is the conversation's numeric database primary key
- **Rationale**: `id` is stable; `name` can be user-renamed. Using `/conv/` (not `/convoy/`) avoids confusion with the Convoy feature area.

### Deep Link Navigation Behavior
- Navigating to `/conv/:id` opens the Mission Control tab (kanban) with the specific conversation loaded in the main panel.
- No separate "conv" tab needed — conversations are already managed in Mission Control.

### Copy Button Feedback
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

## Out of Scope
- Changing how conversations are stored/named
- Any changes to Convoys (unrelated feature)
- Toast notifications (icon-swap feedback is sufficient per user choice)
