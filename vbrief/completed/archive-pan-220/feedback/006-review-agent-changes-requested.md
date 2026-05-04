---
specialist: review-agent
issueId: PAN-220
outcome: changes-requested
timestamp: 2026-02-21T14:11:48Z
---

CODE REVIEW BLOCKED for PAN-220:

1 BLOCKING ISSUE:

1. [BLOCK] src/dashboard/server/index.ts:11570-11587 — Duplicated index stats logic. The getIndexStats() helper (line 11430) is defined INSIDE the /api/services/tldr/status route handler, making it inaccessible to the /api/workspaces/:issueId/tldr endpoint (line 11570). The per-workspace endpoint duplicates 17 lines of identical index stats code inline. Fix: hoist getIndexStats() to module level and call getIndexStats(workspacePath, false) in the per-workspace endpoint instead of duplicating.

Fix these issues, commit and push, then RESUBMIT for review by running:
curl -X POST http://localhost:3011/api/workspaces/PAN-220/request-review -H "Content-Type: application/json" -d '{}'
Do NOT stop until review passes.
