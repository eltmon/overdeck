# PAN-442: Electron Desktop App for Panopticon Dashboard

## Status: In Progress

## Current Phase
Implementing bead oe7 (electron-builder packaging) — committed scaffold + packaging config, ready to close.

## Completed Work
- [x] oe7: Created apps/desktop/ scaffold with package.json (Electron 40.6.0 + electron-builder), tsdown.config.ts, tsconfig.json, resources/icon.{png,ico}, scripts/ (dev-electron.mjs, start-electron.mjs, electron-launcher.mjs, wait-for-resources.mjs, afterPack.cjs). Added apps/desktop to root workspaces. Fixed pre-existing KanbanBoard test. (commit: pending)

## Remaining Work
- [ ] fkl: Embed dashboard server as child process in main.ts
- [ ] 4yt: System tray with configurable status indicator
- [ ] iyk: Menu bar with Panopticon actions
- [ ] sc7: Native notifications with per-event-type configuration
- [ ] 7pc: Auto-start with playful nag flow
- [ ] pcu: Hybrid frontend loading (protocol + localhost)
- [ ] ckt: Preload script with full IPC bridge
- [ ] c8k: Desktop settings UI section in frontend
- [ ] 0gm: Cmd+K command palette in frontend
- [ ] crj: pan up prefers Electron app when installed
- [ ] 1ng: npx panopticon server+browser launcher
- [ ] 6ef: Final scaffold integration (close last)

## Key Decisions
- apps/desktop/ scaffold created as part of oe7 since it is the physical foundation — 6ef is the final integration bead
- main.ts starts minimal; server spawning, tray, menu bar, notifications added incrementally
- preload.ts starts as a stub; full IPC bridge added in ckt bead
- resources/icon.{png,ico} generated via PIL from the panopticon SVG favicon
- electron-builder config: Linux=AppImage x64, macOS=DMG arm64+x64
- extraResources packages dist/dashboard/server.js and dist/dashboard/public/ from root dist/
- afterPack.cjs runs electron-rebuild for node-pty and better-sqlite3

## Specialist Feedback
(none yet)
