---
specialist: review-agent
issueId: PAN-504
outcome: changes-requested
timestamp: 2026-04-07T19:03:37Z
---

CODE REVIEW BLOCKED for PAN-504:

REVIEW — PAN-504 — 3 blocking issues in shared base code (PAN-504's only unique commit is planning artifact cleanup — no feature code):

1. **SYNC FS VIOLATION** `src/dashboard/server/routes/issues.ts:51,955` — `sessionExists()` uses `execSync` in route handler. Must use `sessionExistsAsync()` via `yield* Effect.promise()`.

2. **PLACEHOLDER** `src/lib/cloister/specialists.ts:792` — `PAN-XXX` placeholder in comment.

3. **DEAD CODE** `src/dashboard/frontend/src/components/AgentOutputPanel.tsx` — `terminalFailed` never set to true. `onDisconnect` not passed to `<XTerminal>`. Fallback UI unreachable.

Note: PAN-504's feature work (terminal feedback improvements) was implemented in prior shared commits already on this branch. The only PAN-504-specific commit (2c2a589a) is planning artifacts.

## REQUIRED: Fix ALL issues above BEFORE resubmitting

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests to verify your fixes
4. Commit and push ALL changes
5. ONLY THEN resubmit:
curl -X POST http://localhost:3011/api/workspaces/PAN-504/request-review -H "Content-Type: application/json" -d '{}'

Do NOT run the curl command until steps 1-4 are complete. Do NOT stop until review passes.
