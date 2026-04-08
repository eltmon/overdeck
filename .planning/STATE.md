# Planning State — PAN-486: Detachable Terminal

## Status: Implementation Complete

## Current Phase
All beads implemented and committed. Running test suite before signaling completion.

## Completed Work
- [x] `feature-pan-489-blq`: Add detach button to TerminalPanel header (commit: a1dff3cc)
- [x] `feature-pan-489-b4h`: Implement popoutTerminal() helper with browser/electron runtime detection (commit: 73891d23)
- [x] `feature-pan-489-omn`: Create StandaloneTerminal component and /terminal/:sessionName route (commit: 5564111b)
- [x] `feature-pan-489-yvk`: Extend panopticonBridge with openTerminalWindow IPC (commit: d2be3576)
- [x] `feature-pan-489-72x`: Add Electron BrowserWindow creation for terminal popout (commit: d2be3576)
- [x] `feature-pan-489-zvj`: Add always-on-top toggle to standalone terminal header (commit: 585652b7)

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

## Key Decisions

- **D1**: Used `?terminal=` query param for Electron windows instead of URL path — `panopticon://` protocol scheme doesn't support path routing for SPA, so the URL path `/terminal/{sessionName}` only works in browser popup mode
- **D2**: SET_ALWAYS_ON_TOP IPC sends to focused window — the terminal window is focused when the user clicks the toggle, so `BrowserWindow.getFocusedWindow()` correctly targets it

## Specialist Feedback
None — all beads closed with passing inspections.
- **[2026-04-08T04:45Z] verification-gate → FAILED** — `.planning/feedback/001-verification-gate-failed.md`
- **[2026-04-08T04:47Z] verification-gate → FAILED** — `.planning/feedback/002-verification-gate-failed.md`
- **[2026-04-08T04:49Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/003-review-agent-changes-requested.md`
