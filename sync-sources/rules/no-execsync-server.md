---
scope: dev
paths:
  - "src/dashboard/**"
  - "src/lib/cloister/**"
---
NEVER use `execSync` in this code — it blocks the Node.js event loop, freezing all HTTP requests, WebSocket connections, and polling.

Use `execAsync` (promisified `exec`) or `spawn` with async handling instead.

For sleep/delay, use `await new Promise(r => setTimeout(r, ms))` — never `execSync('sleep ...')`.

Reference: PAN-70 (15 commits to fix ~70 blocking execSync calls).
