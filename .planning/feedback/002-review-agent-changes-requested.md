---
specialist: review-agent
issueId: PAN-464
outcome: changes-requested
timestamp: 2026-04-07T18:57:30Z
---

CODE REVIEW BLOCKED for PAN-464:

REVIEW — PAN-464 — 3 blocking issues (same bugs fixed in PAN-511 commit 900f8bc9 but not present on this branch):

1. **SYNC FS VIOLATION** `src/dashboard/server/routes/issues.ts:51,955` — `sessionExists()` uses `execSync` internally via the sync `sessionExists` function from tmux.ts. Used in route handler at line 955: `const workAgentAlreadyRunning = sessionExists(workAgentSession)`. This blocks the event loop. Fix: add `sessionExistsAsync()` to tmux.ts (async version using `execAsync`) and use `yield* Effect.promise(() => sessionExistsAsync(workAgentSession))` in the route handler. See PAN-511 commit 900f8bc9 for the exact fix.

2. **PLACEHOLDER** `src/lib/cloister/specialists.ts:792` — Comment contains `PAN-XXX` placeholder: `ephemeral test specialists got empty prompts (PAN-XXX)`. Replace with actual issue number (PAN-511) or remove the reference.

3. **DEAD CODE / UNREACHABLE FALLBACK** `src/dashboard/frontend/src/components/AgentOutputPanel.tsx` — `terminalFailed` state is initialized to false but `setTerminalFailed(true)` is never called. The `onDisconnect` callback is not passed to `<XTerminal>` at line ~75 (renders `<XTerminal sessionName={agentId} />` without onDisconnect), making the specialist log fallback UI unreachable. Fix: pass `onDisconnect={() => setTerminalFailed(true)}` to `<XTerminal>`.

PAN-464-specific code (container health monitoring in deacon.ts + tests) is well-implemented: exponential backoff, burst window reset, max restart limit, agent alerting, orphaned process cleanup, comprehensive tests (7 test cases). No issues with the PAN-464 feature itself.

## REQUIRED: Fix ALL issues above BEFORE resubmitting

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests to verify your fixes
4. Commit and push ALL changes
5. ONLY THEN resubmit:
curl -X POST http://localhost:3011/api/workspaces/PAN-464/request-review -H "Content-Type: application/json" -d '{}'

Do NOT run the curl command until steps 1-4 are complete. Do NOT stop until review passes.
