---
specialist: test-agent
issueId: MIN-757
outcome: failed
timestamp: 2026-03-15T21:44:38Z
---

TESTS FAILED for MIN-757:

NEW regression in frontend-unit (vitest): src/contexts/__tests__/AuthContext.test.ts — new test file added by feature branch fails with: [vitest] No "atom" export is defined on the "jotai" mock. The vi.mock for jotai is incomplete and does not export the "atom" function. Fix: use importOriginal or add atom to the mock return. backend (maven): PASSED. frontend-lint: PASSED. frontend-e2e: pre-existing (ECONNREFUSED port 7000). Pre-existing failures on both branches: 87 other failing test files (same as main). usePaginatedSessions.test.tsx and usePomodoroSessions.test.tsx are renames of pre-existing .ts failures on main.

Fix the failing tests, commit and push, then RESUBMIT for review by running:
curl -X POST http://localhost:3011/api/workspaces/MIN-757/request-review -H "Content-Type: application/json" -d '{}'
Do NOT stop until review passes.
