---
scope: dev
paths:
  - "src/dashboard/**"
  - "src/lib/cloister/**"
---
### No `execSync` in dashboard server code

NEVER use `execSync` in dashboard server code or any code reachable from it — it blocks the Node.js event loop, freezing all HTTP requests, WebSocket connections, and polling.

Use `execAsync` (promisified `exec`) or `spawn` with async handling instead. For sleep/delay, use `await new Promise(r => setTimeout(r, ms))` — never `execSync('sleep …')`.

Reference: PAN-70 (15 commits to fix ~70 blocking execSync calls).
