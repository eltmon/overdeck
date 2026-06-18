# State: PAN-558 — Auto-update mechanism for Electron app

## Discovery Summary

**Problem**: When users run `npx overdeck`, they get the version published to npm, not the latest. No auto-update mechanism exists for installed desktop app copies.

**Scope decision (confirmed with user)**:
- Both Electron app auto-update via `electron-updater` AND `npx` latest-version awareness
- Stable channel only for v1
- Both automatic background check AND manual "Check for Updates" menu item
- Silent background download + prompt-to-restart to apply

## Architecture

### Update Server
GitHub Releases (no custom server needed). `electron-updater` supports GitHub Releases natively with `setFeedURL({ provider: 'github', owner: 'eltmon', repo: 'overdeck' })`.

### Package Distribution
- **electron-updater** fetches the latest GitHub Release, compares `app.getVersion()` against the release tag
- Signed releases for macOS (code signing required) and Windows
- Auto-update works on all three platforms (Win/macOS/Linux AppImage)

### Update Flow
1. App starts → `autoUpdater.checkForUpdates()` in background
2. If update found → download in background (`update-downloaded` event)
3. Show non-blocking notification: "Update ready. Restart to apply."
4. User clicks restart (or menu "Install Update and Restart") → `autoUpdater.quitAndInstall()`
5. Periodic check every 4 hours via `setInterval`

### npx latest version
Separate from electron-updater. The `npm view @overdeck/desktop version` returns latest npm-published version. The CLI can warn if npm version < local version (for dev), but for installed desktop apps electron-updater handles everything.

### Menu Integration
- Help menu → "Check for Updates…" → manual trigger
- Help menu → "About Overdeck" (already exists via `role: about`) → shows current version
- After update downloaded: "Install Update and Restart" menu item appears

### Release Workflow Changes
Current `release.yml` publishes to npm and creates a GitHub Release, but does NOT build Electron packages. Must add `electron-builder` step to create `.exe`/`.AppImage`/`.dmg` artifacts attached to the GitHub Release. electron-updater requires artifacts to be attached to the release.

### Files to Modify
1. `apps/desktop/package.json` — add `electron-updater` dep, update `build` config with `publish` and `signing`
2. `apps/desktop/src/main.ts` — initialize auto-updater, set up IPC bridge
3. `apps/desktop/src/menu.ts` — add "Check for Updates" in Help, dynamic "Install Update" item
4. `.github/workflows/release.yml` — add `npm run build:desktop` + `electron-builder` step that attaches artifacts to release

### Items NOT in scope for v1
- Beta/canary channel (stable only)
- Custom update server
- Rollback mechanism
- Auto-update of the CLI (`pan`/`overdeck` npm package) — separate concern
- Code signing certificates (build config ready, certs not provisioned)

## Difficulty Estimates
| Item | Difficulty | Notes |
|------|-----------|-------|
| Add electron-updater dependency | trivial | `bun add electron-updater` |
| Configure build publish settings | simple | Add `publish` to electron-builder config |
| Implement auto-updater service | medium | Main process initialization + IPC |
| Menu integration | simple | Help menu additions |
| Update release workflow | medium | Add desktop build + attach artifacts |
| CLI version sync | trivial | `version` field already synced via root `package.json` |
