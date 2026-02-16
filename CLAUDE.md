# Panopticon CLI - Development Guidelines

## CRITICAL: No execSync in Dashboard Server Code

**NEVER use `execSync` in any code reachable from the dashboard server** (Express routes, Socket.io handlers, Cloister specialists, deacon, or any module imported by `src/dashboard/server/index.ts`).

`execSync` blocks the Node.js event loop, freezing all HTTP requests, WebSocket connections, and polling. This was a major issue tracked in PAN-70 (15 commits to fix).

**Rules:**
- Dashboard server code: use `execAsync` (promisified `exec`) or `spawn` with async handling
- tmux message delivery: use `sendKeysAsync()` from `src/lib/tmux.ts`
- CLI commands only: `execSync` and sync `sendKeys()` are acceptable since they run in their own process
- `sleep` via `execSync('sleep 0.3')` is NEVER acceptable in server code — use `await new Promise(r => setTimeout(r, 300))`

**Files that import from tmux.ts in server context MUST use `sendKeysAsync`, not `sendKeys`:**
- `src/dashboard/server/index.ts`
- `src/lib/agents.ts`
- `src/lib/cloister/merge-agent.ts`
- `src/lib/cloister/specialists.ts`
- `src/lib/runtimes/claude-code.ts`

## Project Structure

- **Stack**: TypeScript, Node.js 22+, React dashboard, SQLite, Socket.io
- **Build**: `npm run build` (esbuild for server, vite for frontend)
- **Dev**: `npm run dev` (tsx watch)
- **Dashboard**: Must use Node 22 — `node dist/dashboard/server.js` from repo root
- **Issue tracking**: GitHub Issues (PAN-XXX prefix), NOT Linear

## tmux Message Delivery

Use `load-buffer` + `paste-buffer` pattern (NOT raw `send-keys` for text):
```typescript
// Correct (in sendKeysAsync):
writeFileSync(tmpFile, keys);
await execAsync(`tmux load-buffer ${tmpFile}`);
await execAsync(`tmux paste-buffer -t ${session}`);
await new Promise(r => setTimeout(r, 300));  // Let text render
await execAsync(`tmux send-keys -t ${session} C-m`);  // Enter
```

Raw `tmux send-keys "text"` followed immediately by `C-m` is unreliable — Enter arrives before text is processed.
