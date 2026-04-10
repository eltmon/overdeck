---
specialist: review-agent
issueId: PAN-505
outcome: changes-requested
timestamp: 2026-04-10T19:41:18Z
---

CODE REVIEW BLOCKED for PAN-505:

## Code Review — PAN-505

### Issue 1 (CRITICAL): execSync in dashboard server route handler

**File:** `src/dashboard/server/routes/issues.ts:955`

`sessionExists()` from `src/lib/tmux.ts` uses `execSync` internally. It is called directly in the `complete-planning` route handler. This **violates the project rule against blocking calls in dashboard server code** (PAN-70, PAN-446). It blocks the Node.js event loop, freezing all HTTP requests and WebSocket connections.

**Fix:** Create an async variant (`sessionExistsAsync`) using `execAsync` and use that in the route handler instead.

### Issue 2 (Minor): Dead code — terminalFailed fallback never triggers

**File:** `src/dashboard/frontend/src/components/AgentOutputPanel.tsx:27`

`terminalFailed` state is created and checked, but **never set to `true`** anywhere. The XTerminal component has no callback to signal connection failure. The specialist log fallback (lines 50-70) is unreachable dead code.

**Fix:** Either wire up a failure callback from XTerminal (e.g. `onConnectionFailed`) or remove the dead fallback code.

### Observations (non-blocking)

- CI lint job no longer has explicit `setup-node` — relies on runner default Node. Works today but fragile if GitHub changes runner defaults.
- merge-agent conflict handling simplified to abort-only (no manual resolution). Good safety improvement.
- specialist queue-on-busy pattern is consistently applied across all dispatch points. Clean.
- `skipDeploy` option in `postMergeLifecycle` correctly prevents infinite rebuild loop from pending-lifecycle.
- Store filter change (keep done, only filter canceled) aligns with updated test expectations.

## REQUIRED: Fix ALL issues above BEFORE resubmitting

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests to verify your fixes
4. Commit and push ALL changes
5. ONLY THEN resubmit:
curl -X POST http://localhost:3011/api/workspaces/PAN-505/request-review -H "Content-Type: application/json" -d '{}'

Do NOT run the curl command until steps 1-4 are complete. Do NOT stop until review passes.
