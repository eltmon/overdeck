# Planning State — PAN-486: Detachable Terminal

## Discovery Decisions

### PAN-484 Status
PAN-484 (shared PTY + WebSocket multiplexing) is **already implemented and deployed**. The `pty-hub.ts` architecture supports multiple WebSocket clients sharing one PTY. Proceeding with popout implementation without any blocking fixes.

### Window Title
**"agent-{issueId} · {issueId}"** — e.g., "agent-PAN-486 · PAN-486"
- `agent.id` (tmux session name) = "agent-PAN-486"
- `agent.issueId` = "PAN-486"
- Agent type has both fields available from the store.

### Always-on-Top
**Included in Phase 1.** Toggle button in the standalone terminal header. Implemented via:
- Electron: IPC message to set `BrowserWindow.setAlwaysOnTop(bool)`
- Browser popup: `window.open()` features string

### Routing Approach
**Add a `/terminal/:sessionName` standalone route.** The frontend uses a custom tab-based router in `App.tsx` (no React Router). The routing is path-based via `window.location.pathname`. The `/terminal/:id` path will render only a `StandaloneTerminal` component — no sidebar, header, or dashboard chrome.

---

## Architecture

### Two Runtime Paths

```
[Detach Button Click]
        │
        ├── Browser ──→ window.open(`/terminal/${sessionName}`, name, features)
        │                   │
        │                   └── /terminal/:sessionName → StandaloneTerminal
        │
        └── Electron ──→ window.electronAPI.openTerminalWindow({ sessionName, title })
                              │
                              ├── IPC: OPEN_TERMINAL_WINDOW
                              ├── main.ts creates BrowserWindow (frameless)
                              ├── Loads /terminal/sessionName
                              └── IPC for title + always-on-top updates
```

### Session Sharing
The standalone terminal uses the **same tmux session** as the dashboard panel. The `XTerminal` component connects to `/ws/terminal?session={sessionName}`. The pty-hub (`activePtyHubs`) broadcasts output to all attached WebSocket clients — no new PTY is spawned.

---

## Files to Create/Modify

### Frontend

| File | Change |
|------|--------|
| `src/dashboard/frontend/src/components/TerminalPanel.tsx` | Add detach button (ExternalLink icon) in header |
| `src/dashboard/frontend/src/components/StandaloneTerminal.tsx` | **NEW** — standalone page with terminal + header |
| `src/dashboard/frontend/src/App.tsx` | Add `/terminal/:sessionName` route |
| `src/dashboard/frontend/src/types/ambient.d.ts` | Add `openTerminalWindow` to `PanopticonBridge` type |
| `src/dashboard/frontend/src/components/TerminalPanel.tsx` | Add `popoutTerminal()` helper |

### Desktop (Electron)

| File | Change |
|------|--------|
| `apps/desktop/src/preload.ts` | Add `OPEN_TERMINAL_WINDOW` IPC channel + `openTerminalWindow()` bridge method |
| `apps/desktop/src/main.ts` | Add `IPC.OPEN_TERMINAL_WINDOW` handler → creates BrowserWindow + IPC for title/alwaysOnTop |

---

## Component Details

### StandaloneTerminal (new)
- Renders a header bar with: title ("agent-PAN-486 · PAN-486") + always-on-top toggle
- Renders `XTerminal` below the header
- Applies terminal-themed CSS (dark background, no dashboard chrome)
- No sidebar, no header — full focus on terminal

### Always-on-Top Toggle
- Icon button in header (Pin or PinOff from lucide-react)
- Tracks `isAlwaysOnTop` state
- **Electron**: sends IPC `set-always-on-top` to main process → `win.setAlwaysOnTop(bool)`
- **Browser**: calls `popupWindow.focus()` (browser popups can't control always-on-top; acceptable limitation)

### IPC Protocol for Electron Window
```
Renderer → Main (IPC):
  OPEN_TERMINAL_WINDOW { sessionName, title }
  SET_ALWAYS_ON_TOP { value: boolean }
  SET_WINDOW_TITLE { title: string }

Main → Renderer (IPC):
  None needed — renderer sets title before window shown
```

---

## Acceptance Criteria

1. **Detach button visible** in terminal panel header (TerminalPanel.tsx) — right side, next to close button
2. **Browser popup** opens at `/terminal/{sessionName}` with only the terminal + header (no dashboard chrome)
3. **Electron window** opens as frameless native window with same content
4. **Same tmux session** — popout shares the PTY with dashboard panel (no new session spawned)
5. **Window title** reflects "agent-{issueId} · {issueId}"
6. **Closing popup** does NOT kill the tmux session (pty-hub keeps PTY alive while any client is connected)
7. **Re-clicking detach** re-focuses existing popup (window naming via `window.open` name parameter)
8. **Always-on-top toggle** works in Electron window
9. **Works in both** single-agent view (AgentOutputPanel) and other views (Kanban board cards)
