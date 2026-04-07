# PAN-442: Electron Desktop App for Panopticon Dashboard

## Status: In Progress

## Current Phase
Implementing bead 4yt (system tray) — adding tray.ts + settings.ts, wiring into main.ts.

## Completed Work
- [x] oe7: Created apps/desktop/ scaffold with Electron 40.6.0 + electron-builder config for Linux/macOS. (commit: d977db74)

## Remaining Work
- [ ] 4yt: System tray with configurable status indicator (in progress)
- [ ] fkl: Embed dashboard server as child process in main.ts
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
- main.ts organized by feature; each bead adds one module (tray.ts, menu.ts, notifications.ts, etc.)
- settings.ts handles all desktop settings persistence; loaded at app.ready

## Specialist Feedback
(none yet)
