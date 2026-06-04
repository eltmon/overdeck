---
scope: dev
---
### Dashboard server runs Node 22 only — never Bun

`pan up` starts `dist/dashboard/server.js` under Node 22. Do NOT change this to `bun run`.

**Why:** two hard blockers under Bun:

1. **node-pty native addon** — `@homebridge/node-pty-prebuilt-multiarch` is a native Node addon used to stream live tmux sessions to the browser terminal panel. Under Bun's native addon compatibility layer the PTY spawns but exits with code 0, causing an infinite "Connection lost / Reconnecting" loop. The PTY works correctly only under Node 22.
2. **Circular ESM dependencies** — the dashboard TypeScript source has circular ESM imports (e.g. `health-filtering.ts → cloister/config → …`). Bun tolerates these; Node.js strict ESM rejects them with "Cannot require() ES Module … in a cycle". You cannot run the dashboard with `tsx` under Node either — you must run the pre-built `dist/dashboard/server.js` which resolves circular deps at build time via tsdown/rolldown bundling.

**Rules:**

- `pan up` → always runs `node dist/dashboard/server.js` (Node 22).
- After changing dashboard server code: run `npm run build` before restarting.
- If `/ws/terminal` PTY exits with code 0, the server is running under Bun — stop and restart with Node 22.
