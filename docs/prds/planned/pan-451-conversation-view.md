# PAN-451: Conversation View — T3Code-Style Message Rendering + Tmux Toggle

## Problem

The dashboard has no way to see agent work except through raw tmux terminal output. Users can't read the conversation history, see tool calls, or interact with agents without understanding terminal ANSI escape codes. T3Code has a polished conversation UI that renders messages, tool calls, code blocks, and streaming output beautifully.

## Goal

Replicate T3Code's conversation UI in Overdeck, using the **same component patterns, data structures, and dependencies** so we can easily pull updates from T3Code as they evolve. Add a toggle for switching between the rendered conversation view and the live tmux terminal view.

## Design Principle: Mirror T3Code

**CRITICAL:** Use the same libraries, component names, data structures, and CSS patterns as T3Code wherever possible. When T3Code updates their conversation UI, we should be able to diff their changes and apply them to ours mechanically. This means:

- Same component names (`ChatView`, `MessagesTimeline`, `ChatMarkdown`, `ComposerPromptEditor`)
- Same external dependencies (`react-markdown`, `remark-gfm`, Shiki for highlighting, Lexical for input, `@tanstack/react-virtual` for scrolling)
- Same Zustand store shape for messages (`ChatMessage`, `Thread`, etc.)
- Same Tailwind class patterns for styling
- Same data flow (WebSocket → store → components)

Where we diverge (tmux toggle, Claude-only for now), isolate the differences in wrapper components so the core rendering stays identical.

## Architecture

```
ConversationPanel (new — wraps both views)
├── ViewToggle: [Conversation] [Terminal]
│
├── [Conversation View] (T3Code mirror)
│   ├── MessagesTimeline (virtual scroll, message rows)
│   │   ├── User message rows (right-aligned bubbles)
│   │   ├── Assistant message rows (left-aligned markdown)
│   │   ├── Work log rows (collapsed tool calls)
│   │   └── Working indicator (streaming)
│   ├── ChatMarkdown (react-markdown + Shiki)
│   └── ComposerFooter
│       ├── ComposerPromptEditor (Lexical rich input)
│       ├── ModelPicker (Claude models only for now)
│       ├── EffortPicker (low/medium/high/max)
│       └── SendButton
│
└── [Terminal View] (existing)
    └── XTerminal (raw WebSocket /ws/terminal)
```

## Data Source

Conversation data comes from the Claude Code JSONL session file:
```
~/.claude/projects/<workspace-path-encoded>/<session-id>.jsonl
```

Each line is a JSON entry with `message.content[]` containing `text`, `tool_use`, `tool_result` blocks. The file is append-only — tail it for streaming updates.

### Server API Endpoint

```
GET /api/agents/:agentId/conversation
  → { messages: ChatMessage[], sessionId: string, streaming: boolean }

WS /ws/rpc → subscribeAgentConversation(agentId)
  → Stream<ConversationEvent> (new messages, updates to streaming message)
```

The server reads the JSONL file and transforms it into T3Code's `ChatMessage` format. For streaming, it watches the file for appends (fs.watch or polling) and pushes new messages via the existing RPC WebSocket.

### Data Model (mirror T3Code)

```typescript
// In @panopticon/contracts — same shape as T3Code's types
interface ChatMessage {
  id: MessageId;
  role: 'user' | 'assistant' | 'system';
  text: string;
  attachments?: ChatAttachment[];
  turnId?: TurnId | null;
  createdAt: string;
  completedAt?: string;
  streaming: boolean;
}

interface WorkLogEntry {
  id: string;
  kind: 'tool_call' | 'command' | 'file_change' | 'thinking';
  label: string;
  detail?: string;
  changedFiles?: string[];
  tone: 'tool' | 'thinking' | 'info' | 'error';
  timestamp: string;
}

// Timeline entries derived from messages (same as T3Code's deriveTimelineEntries)
type TimelineEntry =
  | { kind: 'message'; message: ChatMessage }
  | { kind: 'work'; entries: WorkLogEntry[] }
  | { kind: 'working' };  // streaming indicator
```

## Components (in implementation order)

### Phase 1: Core Rendering (mirror T3Code)

#### 1. ChatMarkdown
**Mirror:** `t3code/apps/web/src/components/ChatMarkdown.tsx` (~300 lines)
**Dependencies:** `react-markdown`, `remark-gfm`, Shiki (via `shiki` package)
- Markdown rendering with GFM support
- Shiki syntax highlighting with LRU cache (500 entries)
- Copy button on code blocks
- Dual theme support (dark/light)
- Error boundary fallback to plain text

#### 2. MessagesTimeline
**Mirror:** `t3code/apps/web/src/components/chat/MessagesTimeline.tsx` (~891 lines)
**Dependencies:** `@tanstack/react-virtual`
- Virtual scrolling for large message histories
- User messages: right-aligned bubbles with `rounded-2xl rounded-br-sm`
- Assistant messages: left-aligned with ChatMarkdown
- Work log entries: collapsed tool calls with icons
- Auto-scroll pinned to bottom during streaming
- Last 8 rows unvirtualized for fast updates

#### 3. JSONL Parser (server-side)
**New:** `src/dashboard/server/services/conversation-service.ts`
- Reads Claude Code JSONL session files
- Transforms `tool_use`/`tool_result`/`text` blocks into `ChatMessage` + `WorkLogEntry`
- File watcher for streaming (fs.watch with debounce)
- Caches parsed messages, only re-parses appended content

### Phase 2: Input Bar

#### 4. ComposerPromptEditor
**Mirror:** `t3code/apps/web/src/components/ComposerPromptEditor.tsx` (~1177 lines)
**Dependencies:** `lexical`, `@lexical/react`
- Rich text input with Enter to submit, Shift+Enter for newline
- Auto-expand height
- Draft persistence to localStorage (debounced)

**Simplification for v1:** No mention nodes or terminal context nodes — just plain text input.

#### 5. ModelPicker
**Simplified from:** `t3code/apps/web/src/components/chat/ProviderModelPicker.tsx`
- Claude models only for now: claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5
- Placeholder slots for: Codex, KimiCode, OpenCode, Gemini, Cursor (disabled, "coming soon")
- Reads available models from settings

#### 6. EffortPicker
**Simplified from:** `t3code/apps/web/src/components/chat/TraitsPicker.tsx`
- Effort levels: low, medium, high, max
- No thinking toggle, context window, or fast mode for v1

#### 7. SendButton + Message Submission
- Collects text from ComposerPromptEditor
- Sends to agent via `pan tell <agent-id> <message>` (tmux load-buffer pattern)
- Clears editor, refocuses

### Phase 3: Integration

#### 8. ConversationPanel (wrapper)
**New:** Wraps both views with a toggle
- Toggle button: [Conversation] / [Terminal]
- Conversation view: MessagesTimeline + ComposerFooter
- Terminal view: existing XTerminal component
- Remembers last-used view in localStorage

#### 9. Wire into existing UI
- Replace agent output panel in KanbanBoard detail view
- Replace terminal area in PlanDialog (with toggle defaulting to Conversation)
- Wire into AgentDetailView

## Dependencies to Add

```json
{
  "react-markdown": "^9.0.0",
  "remark-gfm": "^4.0.0",
  "shiki": "^3.0.0",
  "lexical": "^0.22.0",
  "@lexical/react": "^0.22.0",
  "@tanstack/react-virtual": "^3.0.0"
}
```

Note: We already have `lucide-react`, `zustand`, `@tanstack/react-query`, and Tailwind.

## Styling

Mirror T3Code's Tailwind patterns:
- User messages: `border border-border bg-secondary px-4 py-3 rounded-2xl rounded-br-sm max-w-[80%]`
- Assistant text: `text-sm leading-relaxed text-foreground/80`
- Work log: `bg-card/25 border-border/45 rounded-xl`
- Code blocks: `rounded-lg` with Shiki output
- Timeline container: `max-w-3xl` centered

Use the same CSS custom property names as T3Code for semantic colors.

## Files Changed

| File | Action |
|------|--------|
| **Phase 1** | |
| `src/dashboard/frontend/src/components/chat/ChatMarkdown.tsx` | CREATE — mirror T3Code |
| `src/dashboard/frontend/src/components/chat/MessagesTimeline.tsx` | CREATE — mirror T3Code |
| `src/dashboard/frontend/src/components/chat/session-logic.ts` | CREATE — timeline derivation |
| `src/dashboard/frontend/src/types.ts` | MODIFY — add ChatMessage, WorkLogEntry types |
| `src/dashboard/server/services/conversation-service.ts` | CREATE — JSONL parser |
| `src/dashboard/server/routes/agents.ts` | MODIFY — add conversation endpoint |
| **Phase 2** | |
| `src/dashboard/frontend/src/components/chat/ComposerPromptEditor.tsx` | CREATE — mirror T3Code (simplified) |
| `src/dashboard/frontend/src/components/chat/ModelPicker.tsx` | CREATE — Claude models + placeholders |
| `src/dashboard/frontend/src/components/chat/EffortPicker.tsx` | CREATE — effort levels |
| `src/dashboard/frontend/src/components/chat/ComposerFooter.tsx` | CREATE — input bar assembly |
| **Phase 3** | |
| `src/dashboard/frontend/src/components/ConversationPanel.tsx` | CREATE — view toggle wrapper |
| `src/dashboard/frontend/src/components/KanbanBoard.tsx` | MODIFY — wire ConversationPanel |
| `src/dashboard/frontend/src/components/PlanDialog.tsx` | MODIFY — wire ConversationPanel |

## Testing

### Component Tests
```
tests/frontend/ChatMarkdown.test.tsx
  - Renders plain text
  - Renders markdown headers, lists, links
  - Renders code blocks with language tag
  - Copy button copies code to clipboard
  - Handles streaming content without cache

tests/frontend/MessagesTimeline.test.tsx
  - Renders user messages right-aligned
  - Renders assistant messages left-aligned
  - Renders work log entries collapsed
  - Shows streaming indicator during active turn
  - Auto-scrolls to bottom on new message
  - Virtual scrolling handles 1000+ messages

tests/frontend/ComposerPromptEditor.test.tsx
  - Enter submits message
  - Shift+Enter inserts newline
  - Draft persisted to localStorage
  - Editor clears after submit

tests/frontend/ConversationPanel.test.tsx
  - Toggle switches between conversation and terminal view
  - Remembers last view in localStorage
  - Both views receive same session data
```

### Server Tests
```
tests/services/conversation-service.test.ts
  - Parses Claude Code JSONL format correctly
  - Extracts user messages from tool_result with text
  - Extracts assistant messages from text blocks
  - Groups tool_use/tool_result into work log entries
  - Handles streaming (partial last message)
  - File watcher detects appends
  - Caches parsed content, only re-parses new bytes
```

### Integration Tests
```
tests/integration/conversation-view.spec.ts (Playwright)
  - Opens agent detail, sees conversation view
  - Messages render with correct alignment
  - Code blocks have syntax highlighting
  - Toggle switches to terminal view
  - Toggle switches back to conversation view
  - Send message appears in conversation
```

## Risks

1. **Shiki bundle size** — Shiki includes language grammars. Use dynamic imports to load only needed languages. T3Code wraps it in `@pierre/diffs` — we'll use `shiki` directly with lazy loading.

2. **Lexical complexity** — The full ComposerPromptEditor is 1177 lines in T3Code. For v1, we can use a simplified version without mentions or terminal context nodes.

3. **JSONL parsing performance** — Session files can be megabytes. Use incremental parsing (track byte offset, only parse new content) and async file reading (PAN-446).

4. **Streaming latency** — fs.watch has platform-dependent behavior. Consider polling fallback (check file mtime every 500ms).
