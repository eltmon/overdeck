---
scope: dev
---
## Dashboard Server: Node 22 Only — NEVER Bun

`pan up` starts `dist/dashboard/server.js` under Node 22. Do NOT change this to `bun run`.

### Why

Two hard blockers for running the dashboard under Bun:

**1. node-pty native addon (breaks /ws/terminal)**
`@homebridge/node-pty-prebuilt-multiarch` is a native Node addon used to stream
live tmux sessions to the browser terminal panel. Under Bun's native addon
compatibility layer, the PTY spawns but exits immediately with code 0, causing
an infinite "Connection lost / Reconnecting" loop in the terminal panel.
The PTY works correctly only under Node 22.

**2. Circular ESM dependencies (breaks tsx source-mode)**
The dashboard TypeScript source has circular ESM imports (e.g. health-filtering.ts
→ cloister/config → ...). Bun tolerates these; Node.js strict ESM rejects them
with "Cannot require() ES Module ... in a cycle". This means you cannot run the
dashboard with `tsx` under Node — you must run the pre-built `dist/dashboard/server.js`
which resolves circular deps at build time via tsdown/rolldown bundling.

### Rules

- `pan up` → always runs `node dist/dashboard/server.js` (Node 22)
- After changing dashboard server code: run `npm run build` before restarting
- The `isBunRuntime()` check in `server.ts` can be removed — it's now dead code
- If you see `/ws/terminal` PTY exits with code 0: the server is running under Bun — stop and restart with Node 22
