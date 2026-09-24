---
scope: dev
paths:
  - "src/lib/tmux.ts"
---
### Prefer async tmux primitives — sync versions are legacy debt

In `src/lib/tmux.ts`, the `*Sync` functions block the event loop and are legacy debt — do not add new sync tmux functions or callers. Server-reachable code never calls one.

New tmux interaction uses the async or Effect variants. To deliver text, use `sendKeys` (Effect: load-buffer + paste with verification); `sendKeysAsync` sends one raw key.

Outside tmux, a `*Sync` twin exists only where its header names a synchronous caller; server-reachable code never calls a `*Sync` that blocks on a child process.
