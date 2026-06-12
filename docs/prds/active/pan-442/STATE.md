# PAN-442: Electron Desktop App for Panopticon Dashboard

## Status: Planning Complete

## Decision Summary

### Framework: Electron
- Electron bundles Node.js natively, so `node-pty` works after rebuild and SQLite uses Node's built-in driver
- Electrobun rejected: Bun main process can't run native Node addons (node-pty exits with code 0)
- Electron 40.x (latest stable, matches T3Code reference)

### Architecture Decisions

**Location:** `apps/desktop/` as a new Bun workspace
- Follows T3Code's `apps/desktop/` pattern
- Clean separation from CLI (`src/cli/`) and server (`src/dashboard/server/`)

**Server embedding:** Main process spawns `dist/dashboard/server.js` as child process
- Uses `ELECTRON_RUN_AS_NODE=1` (same pattern as T3Code)
- Bootstrap config passed via fd 3 (port, auth token, mode)
- Exponential backoff restart on crash
- Graceful shutdown: SIGTERM on app quit

**Frontend loading: Hybrid approach**
- **Dev mode:** BrowserWindow loads `http://localhost:<vite-port>` (Vite dev server with HMR)
- **Packaged builds:** Custom `panopticon://` protocol serves static files from bundled `dist/dashboard/public/`
- Avoids localhost exposure in production, maintains dev ergonomics

**Build system:** tsdown for main.ts + preload.ts (CJS output to `dist-electron/`)
- Reuses existing tsdown infrastructure
- electron-builder for packaging (AppImage for Linux, DMG for macOS)

### Feature Decisions

**System tray (full):**
- Color states: green (idle), yellow (agents working), red (attention needed)
- Agent count badge overlay on tray icon
- Rich tooltip: agent count, issues needing attention, last activity
- Tray context menu: quick actions (start/stop cloister, emergency stop, open dashboard, quit)
- All aspects configurable in Settings

**Native notifications (configurable):**
- Event types: INPUT_NEEDED, stuck agents, merge failures, work complete, planning done, merge ready
- Per-event-type toggle in Settings
- Uses Electron's `Notification` API (native OS notifications)

**Auto-start with playful nag flow:**
- Launch 1: Full dialog explaining value proposition, warm and inviting
- Launches 2-5: In-app toasts with personality and countdown
  - "Reminder 3 of 5 — Auto-start means never missing an agent asking for help"
  - Buttons: [Enable (primary, inviting)] [Not yet] [Stop reminding me]
  - "Enable" is always the most prominent, lowest-friction option
- After 5 or "Stop reminding me": never prompt again
- State tracked in Electron's `electron-store` or `conf`

**Menu bar + command palette:**
- Standard Electron menus: File, Edit, View, Window, Help
- Panopticon menu: Start/Stop Cloister, Emergency Stop All, Open Workspace, Settings
- Cmd+K / Ctrl+K command palette for quick access to all actions
- Command palette searches: workspaces, agents, actions, settings

**CLI integration:**
- `pan up` detects installed Electron app and launches it instead of bare server
- Falls back to bare server + browser if Electron not found
- Detection: check for app binary in standard install locations

**npx launcher:**
- `npx panopticon` starts the dashboard server and opens localhost in default browser
- No Electron download required — lowest friction for non-admin users
- Separate from the Electron app distribution

### Target Platforms
- **Linux:** AppImage (primary)
- **macOS:** DMG (arm64 + x64)
- **Windows:** Follow-up issue — requires WSL2 for node-pty/tmux

### Reference Architecture
- T3Code (`/home/eltmon/Projects/t3code/apps/desktop/`) — Electron 40.6.0
- Key patterns borrowed: child process server spawn, fd 3 bootstrap, tsdown CJS build, dev-electron script

## Out of Scope
- Windows support (follow-up issue)
- Auto-update via electron-updater (follow-up — needs release infrastructure)
- Code signing for macOS (follow-up — needs Apple Developer account setup)
- Detachable terminal as native BrowserWindow (PAN-486 follow-up)

## Technical Risks
1. **Native addon rebuilds**: node-pty needs `electron-rebuild` for Electron's Node version
2. **Custom protocol + WebSocket**: `panopticon://` protocol needs to handle WS connections to the embedded server correctly
3. **macOS code signing**: Unsigned apps trigger Gatekeeper warnings — acceptable for alpha, needs signing for distribution
4. **Bundle size**: Electron adds ~150MB — acceptable tradeoff for native experience
