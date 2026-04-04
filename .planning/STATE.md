# PAN-416: Mission Control Conversation Launcher

## Status: Planning Complete

## Summary

Add the ability to spawn, manage, and resume Claude conversations directly from Mission Control. Conversations are user-driven (invisible to Cloister), backed by tmux sessions, with cost attribution via environment propagation.

## Decisions

### Scope: Core Launcher MVP
- **In scope:** New Conversation button, spawn Claude in tmux, embedded terminal panel, session list, named sessions, cost attribution, SQLite session metadata
- **Out of scope:** Multi-tab terminals, supervised mode, auth tokens, keybindings, tool call collapse, detachable/pop-out panels

### Layout: Right Panel Replacement
When a conversation is selected in the sidebar, the right content area switches from the activity/feature view to an embedded XTerminal. When no conversation is selected, the existing Mission Control content displays as normal.

### Sidebar: Collapsible Panel at Top
A "Conversations" section at the top of the Mission Control sidebar, above the project tree. Collapsible. Shows active sessions (green dot) and ended sessions (gray dot). Includes a `[+]` button that reveals an inline name input for spawning.

### Spawn UX: Inline Name Input
Click `[+]` → inline text input appears in the Conversations section → type name → Enter spawns. Auto-generates a name (e.g., `conv-20260404-1`) if left blank. Escape cancels.

### Working Directory: Always ~/Projects (devroot)
All conversations start in `~/Projects`. No project-scoping in the spawn dialog. Users `cd` as needed.

### Orchestration: User-Driven Only
- Session naming convention: `conv-{name}` (NOT `agent-*` or `planning-*`)
- Cloister ignores `conv-*` sessions entirely
- No verification gates, no specialist pipeline
- Domain events NOT emitted for conversations (keeps event store clean)

### Session Persistence & Resume
- tmux sessions survive browser close, page navigation, dashboard restart
- Clicking an active session reattaches the terminal (same tmux session name)
- Clicking an ended session spawns a **new Claude session with the same tmux session name** — conceptually resuming the conversation identity
- Session metadata (name, timestamps, status) stored in SQLite for history

## Architecture

### New Components

#### Backend

1. **`src/dashboard/server/routes/conversations.ts`** — REST API
   - `GET /api/conversations` — list all conversation sessions (from SQLite)
   - `POST /api/conversations` — spawn new conversation (creates tmux session + SQLite row)
   - `DELETE /api/conversations/:name` — kill tmux session, mark ended in SQLite
   - `POST /api/conversations/:name/resume` — reattach or respawn

2. **`src/lib/database/schema.ts`** — add `conversations` table
   ```sql
   CREATE TABLE IF NOT EXISTS conversations (
     id          INTEGER PRIMARY KEY AUTOINCREMENT,
     name        TEXT    NOT NULL UNIQUE,
     tmux_session TEXT   NOT NULL,
     status      TEXT    NOT NULL DEFAULT 'active',  -- 'active', 'ended'
     cwd         TEXT    NOT NULL,
     issue_id    TEXT,                                -- optional cost attribution
     created_at  TEXT    NOT NULL,
     ended_at    TEXT,
     last_attached_at TEXT
   );
   ```

#### Frontend

3. **`src/dashboard/frontend/src/components/MissionControl/ConversationList.tsx`**
   - Collapsible "Conversations" section
   - Active/ended session list with status dots
   - `[+]` button → inline name input
   - Click session → select it (triggers terminal in right panel)

4. **`src/dashboard/frontend/src/components/MissionControl/ConversationTerminal.tsx`**
   - Wraps existing `XTerminal` component
   - Passes `conv-{name}` as the session name
   - Shows "Session ended — click to resume" state for ended sessions
   - Handles the resume flow (POST to `/api/conversations/:name/resume`)

5. **Modify `MissionControl/index.tsx`**
   - Add `selectedConversation` state
   - When set: render `ConversationTerminal` in right panel
   - When null: render existing feature detail view
   - Pass conversation selection handler to `ConversationList`

### Existing Infrastructure Reused

| Component | How it's reused |
|-----------|----------------|
| `XTerminal.tsx` | Embedded directly — same WebSocket protocol, same PTY lifecycle |
| `ws-terminal.ts` | No changes — already handles any `?session=<name>` parameter |
| `tmux.ts createSession()` | Used by conversation spawn endpoint to create `conv-{name}` sessions |
| `cost_events` table | Heartbeat hook already captures costs — just needs `PANOPTICON_ISSUE_ID` env set on spawn |
| Mission Control sidebar | ConversationList added as first child, above ProjectTree |

### Session Spawn Flow

```
User clicks [+] → types "crash-recovery" → Enter
  ↓
Frontend: POST /api/conversations { name: "crash-recovery" }
  ↓
Backend:
  1. Insert row into `conversations` table (status: 'active')
  2. createSession("conv-crash-recovery", "~/Projects", "claude", { env: {} })
  3. Return { name, tmuxSession: "conv-crash-recovery", status: "active" }
  ↓
Frontend:
  1. Add to conversation list
  2. Set selectedConversation = "crash-recovery"
  3. ConversationTerminal renders XTerminal with session="conv-crash-recovery"
  4. XTerminal connects to /ws/terminal?session=conv-crash-recovery
  5. ws-terminal.ts spawns PTY → attaches to tmux session → terminal is live
```

### Session Resume Flow

```
User clicks ended session "crash-recovery"
  ↓
Frontend: POST /api/conversations/crash-recovery/resume
  ↓
Backend:
  1. Check if tmux session "conv-crash-recovery" exists
  2a. If exists: update last_attached_at, return { status: "active", reattached: true }
  2b. If gone: createSession("conv-crash-recovery", cwd, "claude"), update status → 'active', return { status: "active", reattached: false }
  ↓
Frontend: same as spawn — XTerminal connects to the session
```

### Cost Attribution

- When spawning, if the conversation is associated with an issue, set `PANOPTICON_ISSUE_ID={issue-id}` in the tmux session environment
- The existing heartbeat hook reads this env var and attributes costs to the issue
- Unscoped conversations (no issue) get attributed to a "general" bucket — the absence of `PANOPTICON_ISSUE_ID` already handles this (costs show as unattributed)

## Task Breakdown

### Task 1: SQLite conversations table (trivial)
Add `conversations` table to `src/lib/database/schema.ts`. Migration-safe with `CREATE TABLE IF NOT EXISTS`.

### Task 2: Conversation REST API (medium)
New route file `src/dashboard/server/routes/conversations.ts` with CRUD endpoints. Wire into server route composition. All async — no execSync.

### Task 3: ConversationList sidebar component (medium)
Collapsible section with session list, status indicators, inline spawn input. Integrates into Mission Control sidebar.

### Task 4: ConversationTerminal panel component (medium)
Wraps XTerminal for conversation context. Handles active/ended states, resume action.

### Task 5: Mission Control integration (medium)
Wire ConversationList and ConversationTerminal into the Mission Control layout. selectedConversation state management, right panel switching.

### Task 6: Session lifecycle polling (simple)
Periodic check (every 10s) whether active tmux sessions still exist. Update SQLite status to 'ended' if session disappeared. Drives UI status dots.

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Terminal resize issues in right panel | XTerminal already handles ResizeObserver — tested in workspace detail view |
| Session name collisions | `conv-` prefix avoids collision with `agent-*` and `planning-*`. SQLite UNIQUE constraint prevents duplicate names. |
| Stale session status | Polling tmux session existence every 10s. Acceptable latency for user-driven feature. |
| Cost attribution gaps | Heartbeat hook already handles this — just need env propagation at spawn time |

## Files Modified (Estimated)

**New files:**
- `src/dashboard/server/routes/conversations.ts` (~150 lines)
- `src/dashboard/frontend/src/components/MissionControl/ConversationList.tsx` (~200 lines)
- `src/dashboard/frontend/src/components/MissionControl/ConversationTerminal.tsx` (~100 lines)

**Modified files:**
- `src/lib/database/schema.ts` — add conversations table (~15 lines)
- `src/dashboard/server/server.ts` — wire conversation routes (~5 lines)
- `src/dashboard/frontend/src/components/MissionControl/index.tsx` — integrate conversation components (~30 lines)
