# Overdeck Desktop App

For users: see [Desktop app](../features/desktop-app.mdx).

The Electron-based desktop app wraps the Overdeck dashboard in a native window with system tray integration, native notifications, and automatic server embedding.

---

## Installation

### Linux (AppImage)

Download the `.AppImage` from the releases page and make it executable:

```bash
chmod +x Overdeck-*.AppImage
./Overdeck-*.AppImage
```

Or place it in `~/Applications/` so `pan up` detects and launches it automatically.

`pan up` also treats `~/.local/bin/overdeck` as the app, but that path is where `scripts/install.sh` puts the `overdeck` CLI itself, so detection there is wrong; see [#5557](https://github.com/eltmon/overdeck/issues/5557).

### macOS (DMG)

Open the `.dmg`, drag `Overdeck.app` to `/Applications/`, then launch it. `pan up` will detect and open it automatically if present at `/Applications/Overdeck.app`.

---

## How It Works

When you launch the desktop app:

1. The embedded dashboard server starts (`dist/dashboard/server.js` under Node.js — not Bun).
2. The server listens on port 7825 (`BASE_PORT`); after a crash it restarts with backoff on the next port, up to 7834, and gives up after 8 consecutive failures.
3. Once the server responds to `/api/health`, a `BrowserWindow` opens and loads the dashboard.
4. A system tray icon appears, polling `/api/health` every 5 seconds (see [System Tray](#system-tray) for what that polling currently does).

The embedded server behaves identically to `pan up` — same SQLite database, same WebSocket endpoints, same REST API. The desktop app sets `OVERDECK_MODE=desktop` and `OVERDECK_NO_BROWSER=1` to suppress the CLI's own browser-open behavior.

When you have chosen another machine (see [Open another machine](#open-another-machine)), the app starts no embedded server. Its windows show that machine's dashboard, and the tray polls that machine instead.

---

## Open another machine

The desktop app can show one other machine's dashboard instead of running its own, for example your desktop's dashboard over Tailscale. The app stores at most one chosen machine.

**Pair with the machine.** On that machine, create a pairing link: **Settings → Anywhere → Pair a device**, or `pan pair --url <its Tailscale address>`. In the desktop app, choose **Connect to a Machine…** (Overdeck menu or tray), paste the whole link, and click **Connect**. A bare `odp_…` credential is not enough; the link carries the machine's address. The app exchanges the one-time credential for a revocable device credential, stops its embedded server, and opens the machine's dashboard. The machine's **Settings → Anywhere → Devices** lists this computer as "Overdeck desktop on <hostname>".

**Which addresses are allowed.** The app sends the device credential only over an encrypted route or this computer's loopback:

1. any `https:` address;
2. `http:` to loopback (`localhost`, `127.0.0.0/8`, `::1`), such as an SSH forward;
3. `http:` to a Tailscale address: an IPv4 address in `100.64.0.0/10`, an IPv6 address in `fd7a:115c:a1e0::/48`, a name ending in `.ts.net`, or a name that resolves only to such addresses (a MagicDNS short name like `desk`).

Any other `http:` address, such as `http://192.168.1.5:3011`, is refused. The check runs at pairing and again at every launch.

**Where the credential is stored.** The machine record lives in `<userData>/remote-machine.json` (mode `0600`). The device credential in it is encrypted with Electron `safeStorage`: Keychain on macOS, DPAPI on Windows, GNOME Keyring (libsecret) or KWallet on Linux. If no secure store is available, including a Linux session that falls back to the `basic_text` backend, the app refuses to pair before it spends the pairing credential. The plaintext credential is never written to disk and never reaches a page.

The dashboard windows use an in-memory Electron session (`remote-<environmentId>`, no `persist:` prefix), so the session cookie never reaches disk either. As a result the remote dashboard's browser storage (UI preferences, drafts) resets each time the app starts.

**At every launch** the app checks the machine before opening it. When the check fails, the connect window opens with the reason; the app never falls back to this computer's dashboard on its own:

| Failure | Message |
|---------|---------|
| Not reachable | "Can't reach <label> at <origin>. Check that its Overdeck is running and that this computer is on the same tailnet." |
| A different machine now answers | "<origin> is now a different Overdeck machine (<new label>). Pair again." |
| Credential revoked | "<label> no longer accepts this computer's credential. Pair again with a new link." |
| Protocol mismatch | "<label> speaks Overdeck protocol <n>; this app supports 1. Update the older side." |
| Credential store cannot decrypt | "This computer's credential store could not decrypt the saved credential. Pair again." |

The connect window then offers **Open <label>** (retry), **Use this computer**, and **Forget <label>**.

**Use This Computer** (Overdeck menu, tray, or connect window) keeps the pairing but starts the embedded server and shows this computer's dashboard again. **Connect to a Machine… → Open <label>** goes back.

**Forget <label>** revokes this computer's device credential on the machine, then deletes the local record either way. If the machine cannot be reached, the window says so; revoke the device in that machine's **Settings → Anywhere → Devices**. Pairing with a new machine also revokes the old device first, on a best-effort basis.

While a remote dashboard is shown, links to other origins open in your browser, and **Restart Dashboard** is refused: restart that dashboard on its own machine.

---

## System Tray

The tray icon's color, tooltip counts and dock badge do not reflect agent status today: `/api/health` returns no `agentCount`, `attentionCount` or `lastActivity` for the tray to poll. **Settings → Desktop App → System Tray** (**Show agent count badge**, **Tooltip detail**) has no visible effect until that wiring lands; see [#5556](https://github.com/eltmon/overdeck/issues/5556).

### Tray Menu

Right-clicking the tray icon shows:

- **Show Dashboard** — bring the window to focus
- **Connect to a Machine…** — open the connect window to pair with or reopen another machine
- **Use This Computer** — leave the chosen machine and show this computer's dashboard (enabled only while another machine is shown)
- **Start Cloister** / **Stop Cloister** — toggle autonomous orchestration
- **Emergency Stop All**: halt all running agents immediately
- **Settings** — open the Settings page
- **Quit** — stop the server and exit

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

Nothing currently reads these switches: the notifications that actually fire come straight from the frontend's own event handling, regardless of this table; see [#5556](https://github.com/eltmon/overdeck/issues/5556).

Clicking a notification brings the dashboard window to focus.

---

## Auto-Start

Enable **Launch at login** in **Settings → Desktop App → Auto-start** to have Overdeck start automatically when you log in. This works on macOS and Windows only; `app.setLoginItemSettings` is a no-op on Linux, so the switch does nothing there ([#5556](https://github.com/eltmon/overdeck/issues/5556)).

### Nag Flow

If auto-start is not configured, Overdeck gently prompts you to enable it:

- **First launch**: Native system dialog asking if you want to enable auto-start
- **Launches 2–5**: In-app toast notification with an "Enable" action button
- **After launch 5** (or if dismissed): No more prompts

You can reset the nag counter in **Settings → Desktop App → Auto-start → Reset reminder**.

---

## Command Palette

The command palette is not a desktop-specific feature; see [Keyboard shortcuts](../features/keyboard-shortcuts.mdx) for how it works in the dashboard, desktop app included.

---

## Application Menu

The app's own menu exists on every platform (not only macOS), with an **Overdeck** menu that has **Start Cloister**, **Stop Cloister**, **Emergency Stop All Agents**, **Connect to a Machine…**, **Use This Computer** and **Settings...**.

Menu actions dispatch to the renderer via IPC, which the frontend handles via `overdeckBridge.onMenuAction()`.

---

## Desktop Settings UI

The **Settings** page includes a **Desktop App** section when running inside the Electron app. This section is automatically hidden in browser mode (when `window.overdeckBridge` is absent).

Settings are persisted to `$userData/desktop-settings.json` (e.g., `~/.config/Overdeck/desktop-settings.json` on Linux, `~/Library/Application Support/Overdeck/desktop-settings.json` on macOS).

---

## Frontend Protocol (Packaged Builds)

In packaged builds, the frontend is served via a custom `overdeck://` protocol instead of a localhost URL. This avoids cross-origin restrictions and allows the app to work without a running Vite dev server.

- **Dev mode**: Loads from `VITE_DEV_SERVER_URL` (Vite HMR, source maps)
- **Packaged**: Loads `overdeck://app/index.html` from bundled static assets

The protocol handler includes path-traversal protection — paths containing `..` are rejected and fall back to `index.html`. Non-asset routes (no file extension) also fall back to `index.html` for SPA routing.

---

## IPC Bridge

The Electron preload script exposes `window.overdeckBridge` to the renderer via `contextBridge`. This is the only communication channel between the sandboxed renderer and the main process.

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
| `getUpdateStatus()` | Returns the shared updater snapshot |
| `checkForUpdates()` | Resolves the current channel's exact GitHub release and manifest |
| `downloadUpdate()` | Downloads and verifies the native update |
| `quitAndInstall()` | Restarts into an update that has finished downloading |
| `onUpdateStatus(listener)` | Subscribes to update lifecycle and progress changes |

---

## `npx overdeck serve`

If you don't want the full desktop app, `npx overdeck serve` starts only the server and opens it in your system browser:

```bash
npx overdeck serve
```

This is equivalent to `pan up` without the Electron wrapper — useful on headless servers or when you prefer the browser experience.

---

## Updating Overdeck

The `v<version>` button at the bottom of the left column is an update control. Hovering it explains the action; clicking it opens the updater and always performs a fresh check. The same dialog opens from **Help → Check for Updates…** in the desktop app.

The dialog shows the installed and target versions, the GitHub release changelog, download/install progress, and the final restart action. If no newer release exists, it confirms that Overdeck is current instead of silently closing. Development checkouts are detected and show a manual-update message rather than modifying the repository.

The action depends on how Overdeck is running:

| Runtime | Update action |
|---|---|
| Desktop app | Download the native package, then restart into it |
| Globally installed dashboard | Install the exact published `@overdeck/core` version, run `pan sync`, then restart the dashboard |
| Development checkout | Report availability only; update through Git |

Release manifests carry dashboard and agent protocol versions. When a release changes the agent protocol and agents are still active, Overdeck may download the update but disables restart until those sessions stop. Compatible updates preserve the dashboard's project, conversation, and agent state.

### Auto-Updater Channels

The desktop app uses `electron-updater` with GitHub Releases as the update server. Updates respect the release channel so stable and canary users never cross-pollute:

| Build Type | Version Pattern | Update Channel | Behavior |
|---|---|---|---|
| **Stable** | `x.y.z` | `latest` | Offers only stable releases |
| **Canary** | `x.y.z-canary.n` | `beta` | Offers only canary prereleases |

The channel is derived automatically from `app.getVersion()` at startup:
- Versions containing `-canary` → `beta` channel
- All other versions → `latest` channel

This means a user on `v1.0.0` will not be prompted to install `v1.1.0-canary.3`, and a user on `v1.1.0-canary.3` will not be offered `v1.0.0`.

The `beta` channel maps to GitHub prereleases; `latest` maps to full releases. Overdeck resolves the exact matching GitHub release and then gives `electron-updater` a generic release URL. Each release includes the platform manifest and integrity metadata consumed by Squirrel.Mac on macOS, NSIS on Windows, and AppImage updater on Linux.

---

## Building the Desktop App

See [BUILD.md § Electron Desktop App](./BUILD.md#electron-desktop-app-appsdesktop) for the full build pipeline.

### Packaged server dependencies

`apps/desktop/scripts/prepare-server-resources.mjs` stages the dashboard
server (`server/`, in the `files` list above, so it ships in every flavor —
npm, npx, and the installers). It discovers the server's runtime
dependencies by walking the built chunk graph from `server.js` and the
other entry points for bare `import`/`require` specifiers
(`scanImportClosure`, `apps/desktop/scripts/import-closure.mjs`), then
installs each discovered package at the repo's installed version. That scan
is a regex over chunk source text, so it can also match a specifier that
only appears in a comment.

`SERVER_SKIP_PACKAGES`, exported from `apps/desktop/scripts/package-policy.mjs`,
lists bare specifiers the scan must not treat as real server externals: two
bun-only/lazy packages, and `@huggingface/transformers`. transformers is
bundled into a `dist/dashboard/transformers.node-*.js` chunk and only
reachable there through a JSDoc example string (PAN-5424) — the packaged
server's fact-retrieval path reads cached vectors and never actually loads
it; embedding runs from the CLI runtime instead, which keeps `transformers`
as a real dependency (PAN-5358). Skipping it keeps roughly 720 MB of
`onnxruntime` out of the staged server.

Two guards backstop that skip, both in `prepare-server-resources.mjs` and
`build-for-publish.mjs`:
- **Forbidden-package guard** — right after installing the server's
  externals, `findForbiddenPackages` (`package-policy.mjs`) walks
  `server/node_modules` recursively (including nested and scoped
  `node_modules`) for `@huggingface/transformers`, `onnxruntime-node`,
  `onnxruntime-web`, or `onnxruntime-common`, and fails the build if any is
  present.
- **Tarball size guard** — `build-for-publish.mjs` runs
  `npm pack --dry-run --json` and fails the build (`checkDesktopPackSize`,
  same module) when the packed `@overdeck/desktop` tarball exceeds
  300,000,000 bytes.

See "The npm job stopped at 'Build desktop package'" in
[RELEASING.md](./RELEASING.md) for what to do when either guard fails.

### Packaged CLI runtime

The packaged app includes a self-contained `pan` CLI runtime at
`resources/dist/cli/index.js`, together with its reachable build chunks and
external dependencies. `apps/desktop/package.json` installs the staged runtime
with this electron-builder resource mapping:

```json
[
  { "from": "cli", "to": "dist", "filter": ["**/*", "!**/*.map"] },
  { "from": "cli/package.json", "to": "package.json" }
]
```

The dashboard's `panCliInvocation` helper resolves the entry from
`packageRoot/dist/cli/index.js`. In a packaged app, `packageRoot` is Electron's
`resources/` directory, so the normal resolver reaches the packaged runtime
without a desktop-specific code path. The second resource mapping places the
generated CLI manifest at `resources/package.json`, where the shared version
resolver expects the package-root manifest. The preparation script also copies the
complete `sync-sources/` tree because commands such as `pan sync` need the
skills, rules, agents, development skills, and hooks payload.

The embedded dashboard server starts under Electron with
`ELECTRON_RUN_AS_NODE=1`, and every `pan` child inherits that environment. This
inheritance is what makes `process.execPath` behave as Node when the executable
is Electron. A packaged `pan` spawn site must preserve the inherited environment
or explicitly retain `ELECTRON_RUN_AS_NODE=1`; passing a replacement `env`
without it launches Electron as an application instead of running the CLI.

This staged CLI runtime belongs to the electron-builder packages (AppImage,
DMG, and NSIS). The npm/npx flavor does not copy it: `cli/` is not in
`apps/desktop/package.json`'s `files` list, so `npm pack` never includes it.
Its runtime-vendoring work remains part of the
[PAN-2561](https://github.com/eltmon/overdeck/issues/2561) packaging story.

---

## Architecture

```
apps/desktop/
├── src/
│   ├── main.ts          # Electron main process entry
│   ├── preload.ts       # contextBridge IPC definitions
│   ├── boot.ts          # Boot decision: embedded server or chosen machine
│   ├── machine-url.ts   # Pairing-link parser + transport policy
│   ├── machine-store.ts # Chosen-machine record, safeStorage-encrypted token
│   ├── machine-client.ts # Pairing exchange, launch preflight, self-revoke
│   ├── connection.ts    # Active dashboard, bearer fetch, in-memory remote session
│   ├── connect-window.ts # Connect window + its IPC guard
│   ├── connect-preload.ts # contextBridge for the connect window
│   ├── tray.ts          # System tray icon + polling
│   ├── server.ts        # Embedded server spawn + health wait
│   ├── menu.ts          # Application menu bar
│   ├── notifications.ts # Native OS notifications
│   ├── autostart.ts     # Login item + nag flow
│   ├── protocol.ts      # overdeck:// file protocol
│   └── settings.ts      # Desktop settings persistence
├── tests/
│   ├── settings.test.ts # Settings load/save/update unit tests
│   └── protocol.test.ts # Path traversal + SPA routing unit tests
├── resources/
│   ├── icon.png         # App icon (512×512)
│   └── connect.html     # Connect window page
├── scripts/
│   ├── dev-electron.mjs      # Dev watcher (restarts on dist-electron/ changes)
│   ├── start-electron.mjs    # Production launcher
│   └── afterPack.cjs         # electron-rebuild for node-pty post-package
├── tsdown.config.ts     # Builds main.ts, preload.ts, connect-preload.ts → dist-electron/ (CJS)
└── vitest.config.ts     # Desktop-local test config
```
