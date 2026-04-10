---
specialist: review-agent
issueId: PAN-509
outcome: changes-requested
timestamp: 2026-04-07T19:01:15Z
---

CODE REVIEW BLOCKED for PAN-509:

REVIEW — PAN-509 — 3 blocking issues + 1 advisory:

1. **SYNC FS VIOLATION** `src/dashboard/server/routes/issues.ts:51,955` — `sessionExists()` uses `execSync` in route handler. Must use `sessionExistsAsync()` via `yield* Effect.promise()`. Same fix as PAN-511 commit 900f8bc9.

2. **PLACEHOLDER** `src/lib/cloister/specialists.ts:792` — `PAN-XXX` placeholder in comment.

3. **DEAD CODE** `src/dashboard/frontend/src/components/AgentOutputPanel.tsx` — `terminalFailed` never set to true. `onDisconnect` not passed to `<XTerminal>`. Fallback UI unreachable.

4. **MISSING TESTS (advisory)** — `src/dashboard/frontend/src/components/inspector/phase-utils.ts` is a pure utility module (~100 lines) with `detectPhase`, `getActiveSession`, `getProjectKey`, `getSpecialistSessionName` — all easily unit-testable. Add tests to cover phase detection logic and session name derivation.

PAN-509-specific feature code (pipeline phase indicator in InspectorPanel, tab strip in TerminalPanel, auto/pinned session switching, phase-utils.ts) is well-structured with clean separation of concerns.

## REQUIRED: Fix ALL issues above BEFORE resubmitting

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests to verify your fixes
4. Commit and push ALL changes
5. ONLY THEN resubmit:
curl -X POST http://localhost:3011/api/workspaces/PAN-509/request-review -H "Content-Type: application/json" -d '{}'

Do NOT run the curl command until steps 1-4 are complete. Do NOT stop until review passes.
