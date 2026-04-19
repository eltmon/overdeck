# Panopticon Desktop App

The Electron-based desktop app wraps the Panopticon dashboard in a native window with system tray integration, native notifications, and automatic server embedding.

---

## Installation

### Linux (AppImage)

Download the `.AppImage` from the releases page and make it executable:

```bash
chmod +x Panopticon-*.AppImage
./Panopticon-*.AppImage
```

Or place it in `~/Applications/` so `pan up` detects and launches it automatically.

You can also install to `~/.local/bin/panopticon` for system-wide detection.

### macOS (DMG)

Open the `.dmg`, drag `Panopticon.app` to `/Applications/`, then launch it. `pan up` will detect and open it automatically if present at `/Applications/Panopticon.app`.

---

## How It Works

When you launch the desktop app:

1. The embedded dashboard server starts (`dist/dashboard/server.js` under Node.js — not Bun).
2. The server listens on an available port (default 3011, increments on conflict).
3. Once the server responds to `/api/health`, a `BrowserWindow` opens and loads the dashboard.
4. A system tray icon appears, polling `/api/health` every 5 seconds.

The embedded server behaves identically to `pan up` — same SQLite database, same WebSocket endpoints, same REST API. The desktop app sets `PANOPTICON_MODE=desktop` and `PANOPTICON_NO_BROWSER=1` to suppress the CLI's own browser-open behavior.

---

## System Tray

The tray icon changes color to indicate agent status:

| Color | Meaning |
|-------|---------|
| Green | All agents idle |
| Yellow | Agents active / working |
| Red | Agent needs attention (input required, stuck, merge failure) |

### Tray Menu

Right-clicking the tray icon shows:

- **Show Dashboard** — bring the window to focus
- **Start Cloister** / **Stop Cloister** — toggle autonomous orchestration
- **Emergency Stop** — halt all running agents immediately
- **Settings** — open the Settings page
- **Quit** — stop the server and exit

### Tray Settings

Configure tray behavior in **Settings → Desktop App → System Tray**:

- **Show agent count badge** — displays active agent count on the dock/taskbar icon
- **Tooltip detail** — `Minimal` (agent count only) or `Full` (count + attention + activity)

---

## Notifications

The desktop app sends native OS notifications for key agent events. Each event type can be enabled or disabled individually in **Settings → Desktop App → Notifications**:

| Event | Default | Description |
|-------|---------|-------------|
| Input Needed | On | Agent is waiting for your decision |
| Stuck Agents | On | Agent has been idle too long |
| Merge Failures | On | Merge specialist encountered an error |
| Work Complete | On | Agent finished and called `pan done` |
| Planning Done | Off | Planning session completed |
| Merge Ready | On | PR is ready for your approval |

Clicking a notification brings the dashboard window to focus.

---

## Auto-Start

Enable **Launch at login** in **Settings → Desktop App → Auto-start** to have Panopticon start automatically when you log in.

### Nag Flow

If auto-start is not configured, Panopticon gently prompts you to enable it:

- **First launch**: Native system dialog asking if you want to enable auto-start
- **Launches 2–5**: In-app toast notification with an "Enable" action button
- **After launch 5** (or if dismissed): No more prompts

You can reset the nag counter in **Settings → Desktop App → Auto-start → Reset reminder**.

---

## Cmd+K Command Palette

Press `Cmd+K` (macOS) or `Ctrl+K` (Linux/Windows) to open the command palette from anywhere in the dashboard.

### Available Actions

| Group | Actions |
|-------|---------|
| **Orchestration** | Start Cloister, Stop Cloister, Emergency Stop |
| **Navigation** | Open Settings, Kanban, Terminal, Agents view |
| **Active Workspaces** | Issues with running agents (navigates to kanban + selects issue) |
| **Running Agents** | Jump to the kanban card for a specific agent |

Type to filter. Press `Enter` to execute, `Escape` to close.

The palette is also accessible from the desktop app's **Panopticon** menu bar menu.

---

## Menu Bar (macOS)

The macOS menu bar includes a **Panopticon** menu with:

- Start/Stop Cloister
- Emergency Stop
- Open Workspace (lists all registered workspaces)
- Settings

Menu actions dispatch to the renderer via IPC, which the frontend handles via `panopticonBridge.onMenuAction()`.

---

## Desktop Settings UI

The **Settings** page includes a **Desktop App** section when running inside the Electron app. This section is automatically hidden in browser mode (when `window.panopticonBridge` is absent).

Settings are persisted to `$userData/desktop-settings.json` (e.g., `~/.config/Panopticon/desktop-settings.json` on Linux, `~/Library/Application Support/Panopticon/desktop-settings.json` on macOS).

---

## Frontend Protocol (Packaged Builds)

In packaged builds, the frontend is served via a custom `panopticon://` protocol instead of a localhost URL. This avoids cross-origin restrictions and allows the app to work without a running Vite dev server.

- **Dev mode**: Loads from `VITE_DEV_SERVER_URL` (Vite HMR, source maps)
- **Packaged**: Loads `panopticon://app/index.html` from bundled static assets

The protocol handler includes path-traversal protection — paths containing `..` are rejected and fall back to `index.html`. Non-asset routes (no file extension) also fall back to `index.html` for SPA routing.

---

## IPC Bridge

The Electron preload script exposes `window.panopticonBridge` to the renderer via `contextBridge`. This is the only communication channel between the sandboxed renderer and the main process.

Available methods:

| Method | Description |
|--------|-------------|
| `isDesktopApp()` | Returns `true` — used to detect desktop context |
| `getServerUrl()` | Returns the embedded server base URL |
| `getWsUrl()` | Returns the WebSocket server URL |
| `pickFolder()` | Opens a native folder picker dialog |
| `openExternal(url)` | Opens a URL in the system browser |
| `onMenuAction(listener)` | Subscribes to menu bar action events |
| `getDesktopSettings()` | Loads current desktop settings from main process |
| `updateDesktopSetting(key, value)` | Updates a single setting (dotted key, e.g. `"tray.showBadge"`) |
| `notify(eventType, title, body)` | Triggers a native notification (respects per-event toggle) |

---

## `npx panopticon serve`

If you don't want the full desktop app, `npx panopticon serve` starts only the server and opens it in your system browser:

```bash
npx panopticon serve
```

This is equivalent to `pan up` without the Electron wrapper — useful on headless servers or when you prefer the browser experience.

---

## Auto-Updater Channels

The desktop app uses `electron-updater` with GitHub Releases as the update server. Updates respect the release channel so stable and canary users never cross-pollute:

| Build Type | Version Pattern | Update Channel | Behavior |
|---|---|---|---|
| **Stable** | `x.y.z` | `latest` | Offers only stable releases |
| **Canary** | `x.y.z-canary.n` | `beta` | Offers only canary prereleases |

The channel is derived automatically from `app.getVersion()` at startup:
- Versions containing `-canary` → `beta` channel
- All other versions → `latest` channel

This means a user on `v1.0.0` will not be prompted to install `v1.1.0-canary.3`, and a user on `v1.1.0-canary.3` will not be offered `v1.0.0`.

The `beta` channel maps to GitHub prereleases; `latest` maps to full releases. Both are served from the same `eltmon/panopticon-cli` release feed.

---

## Building the Desktop App

See [BUILD.md § Electron Desktop App](./BUILD.md#electron-desktop-app-appsdesktop) for the full build pipeline.

---

## Architecture

```
apps/desktop/
├── src/
│   ├── main.ts          # Electron main process entry
│   ├── preload.ts       # contextBridge IPC definitions
│   ├── tray.ts          # System tray icon + polling
│   ├── server.ts        # Embedded server spawn + health wait
│   ├── menu.ts          # Application menu bar
│   ├── notifications.ts # Native OS notifications
│   ├── autostart.ts     # Login item + nag flow
│   ├── protocol.ts      # panopticon:// file protocol
│   └── settings.ts      # Desktop settings persistence
├── tests/
│   ├── settings.test.ts # Settings load/save/update unit tests
│   └── protocol.test.ts # Path traversal + SPA routing unit tests
├── resources/
│   └── icon.png         # App icon (512×512)
├── scripts/
│   ├── dev-electron.mjs      # Dev watcher (restarts on dist-electron/ changes)
│   ├── start-electron.mjs    # Production launcher
│   └── afterPack.cjs         # electron-rebuild for node-pty post-package
├── tsdown.config.ts     # Builds main.ts + preload.ts → dist-electron/ (CJS)
└── vitest.config.ts     # Desktop-local test config
```
