---
specialist: review-agent
issueId: PAN-462
outcome: changes-requested
timestamp: 2026-04-07T18:59:16Z
---

CODE REVIEW BLOCKED for PAN-462:

REVIEW — PAN-462 — 4 blocking issues:

1. **SYNC FS VIOLATION** `src/dashboard/server/routes/issues.ts:51,955` — `sessionExists()` uses `execSync` in route handler. Must use `sessionExistsAsync()` via `yield* Effect.promise()`. Same bug as PAN-511/PAN-464.

2. **SYNC FS VIOLATION** `src/dashboard/server/routes/specialists.ts:338-345` — `updateSpecialistHandoffStatus()` called from route handler uses `readFileSync` and `writeFileSync` internally (specialist-handoff-logger.ts:256,288). These block the event loop while reading/writing the entire JSONL log. Either make updateSpecialistHandoffStatus async (use fs/promises) or move the call to a fire-and-forget async task.

3. **PLACEHOLDER** `src/lib/cloister/specialists.ts:792` — `PAN-XXX` placeholder in comment.

4. **DEAD CODE** `src/dashboard/frontend/src/components/AgentOutputPanel.tsx` — `terminalFailed` state never set to true. `onDisconnect` not passed to `<XTerminal>`. Fallback UI unreachable.

PAN-462-specific feature code (handoff logger updates, live queue depth, today-scoped escalations, MetricsSummary changes) is well-designed. Missing test coverage for `updateSpecialistHandoffStatus` (~40 lines of JSONL rewrite logic) and `getLiveQueueDepth` — add tests to specialist-handoff-logger.test.ts.

## REQUIRED: Fix ALL issues above BEFORE resubmitting

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests to verify your fixes
4. Commit and push ALL changes
5. ONLY THEN resubmit:
curl -X POST http://localhost:3011/api/workspaces/PAN-462/request-review -H "Content-Type: application/json" -d '{}'

Do NOT run the curl command until steps 1-4 are complete. Do NOT stop until review passes.
