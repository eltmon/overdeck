# PAN-451: Conversation View — T3Code-Style Message Rendering + Tmux Toggle

## Status: Planning Complete

## Decisions

### Scope: MissionControl Only
The conversation view replaces `ConversationTerminal` in MissionControl's content area. No changes to KanbanBoard, PlanDialog, AgentDetailView, or any other integration point. MissionControl conversations only — agent work sessions (planning/implementation) keep terminal-only view.

### Mirror T3Code with @pierre/diffs
Use T3Code's exact component names, data types, and patterns. Use `@pierre/diffs` for Shiki syntax highlighting (same as T3Code) rather than raw `shiki`. Source reference: `/home/eltmon/Projects/t3code/`.

### Full Lexical Editor
Use Lexical-based `ComposerPromptEditor` matching T3Code. No mention nodes or terminal context nodes for v1 — plain text input with Enter/Shift+Enter semantics.

### JSONL Session File Discovery
After spawning a conversation's Claude Code tmux session, detect the new JSONL session file by watching `~/.claude/projects/<encoded-cwd>/` for new `.jsonl` files. Store the discovered path in a new `session_file` column on the conversations table (schema migration v6→v7). This is a one-time detection per conversation.

### Input Bar Sends via tmux
Message submission uses the existing `messageAgent()` / `sendKeysAsync()` pattern — load-buffer + paste-buffer into the conversation's tmux session. No new transport needed.

## Architecture

```
MissionControl (index.tsx)
├── Sidebar (unchanged)
│   ├── ConversationList (unchanged)
│   └── ProjectTree (unchanged)
│
└── Content area
    └── ConversationPanel (NEW — replaces ConversationTerminal)
        ├── ViewToggle: [Conversation] [Terminal]
        │
        ├── [Conversation View]
        │   ├── MessagesTimeline (@tanstack/react-virtual)
        │   │   ├── User message rows (right-aligned bubbles)
        │   │   ├── Assistant message rows (ChatMarkdown)
        │   │   ├── Work log rows (grouped tool calls)
        │   │   └── Working indicator (streaming dot animation)
        │   └── ComposerFooter
        │       ├── ComposerPromptEditor (Lexical)
        │       ├── ModelPicker (Claude models)
        │       ├── EffortPicker (low/medium/high/max)
        │       └── SendButton
        │
        └── [Terminal View]
            └── XTerminal (existing, raw WebSocket /ws/terminal)
```

## Data Flow

```
JSONL file (append-only)
    ↓ fs.watch + polling fallback (500ms)
conversation-service.ts (server)
    ↓ parse new lines, transform to ChatMessage/WorkLogEntry
    ↓ cache parsed offset
GET /api/conversations/:name/messages → initial load
WS /ws/rpc → subscribeConversationMessages(name) → streaming updates
    ↓
Zustand store (conversationMessages slice)
    ↓
MessagesTimeline → ChatMarkdown → render
```

## Server Changes

### Schema Migration (v7)
Add `session_file TEXT` column to `conversations` table. Nullable — populated asynchronously after Claude Code starts and creates the JSONL file.

### New Service: conversation-service.ts
- `discoverSessionFile(cwd: string, afterTimestamp: string)` — watch JSONL dir for new file
- `parseConversationMessages(sessionFile: string, fromOffset?: number)` — incremental parse
- `watchConversation(sessionFile: string, callback)` — fs.watch + polling for new messages
- Transform JSONL entries → `ChatMessage[]` + `WorkLogEntry[]`
- LRU cache for parsed content keyed by file path + byte offset

### New API Endpoints
- `GET /api/conversations/:name/messages` → `{ messages: ChatMessage[], workLog: WorkLogEntry[], streaming: boolean }`
- RPC: `subscribeConversationMessages(name)` → `Stream<ConversationEvent>`

### Modified: conversations.ts route
After `spawnConversationSession()`, kick off async session file discovery. Store result in DB.

## Frontend Changes

### New Dependencies
```
@pierre/diffs, react-markdown, remark-gfm, lexical, @lexical/react, @tanstack/react-virtual
```

### New Components (in `src/dashboard/frontend/src/components/chat/`)
| Component | Mirror Source | Lines (est.) |
|-----------|-------------|-------------|
| `ChatMarkdown.tsx` | `t3code/ChatMarkdown.tsx` | ~300 |
| `MessagesTimeline.tsx` | `t3code/chat/MessagesTimeline.tsx` | ~600 |
| `MessagesTimeline.logic.ts` | `t3code/chat/MessagesTimeline.logic.ts` | ~150 |
| `session-logic.ts` | `t3code/chat/session-logic.ts` | ~200 |
| `ComposerPromptEditor.tsx` | `t3code/ComposerPromptEditor.tsx` | ~800 |
| `ComposerFooter.tsx` | New assembly | ~150 |
| `ModelPicker.tsx` | Simplified from T3Code | ~100 |
| `EffortPicker.tsx` | Simplified from T3Code | ~80 |
| `ConversationPanel.tsx` | New wrapper | ~200 |

### New Types (in `@overdeck/contracts` or `types.ts`)
- `ChatMessage` — mirrors T3Code
- `WorkLogEntry` — mirrors T3Code
- `TimelineEntry` — derived union type
- `MessagesTimelineRow` — row rendering type
- `ConversationEvent` — streaming event type

### Modified Components
- `MissionControl/index.tsx` — swap `<ConversationTerminal>` for `<ConversationPanel>`
- `MissionControl/ConversationTerminal.tsx` — may be absorbed into `ConversationPanel`

## Key Risks

1. **@pierre/diffs availability** — may need `npm pack` from T3Code or local file reference
2. **JSONL file discovery timing** — Claude Code may take seconds to create the file; need retry/polling
3. **Large JSONL files** — incremental parsing essential; full re-parse on 2MB files is too slow
4. **Streaming latency** — fs.watch is unreliable on some Linux filesystems; polling fallback at 500ms
5. **Lexical complexity** — simplified v1 without mentions, but still ~800 lines; test thoroughly
