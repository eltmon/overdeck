---
specialist: review-agent
issueId: MIN-708
outcome: changes-requested
timestamp: 2026-03-01T18:06:08Z
---

CODE REVIEW BLOCKED for MIN-708:

2 BLOCKING ISSUES: (1) No tests — auth change from hasRole(USER) to isAuthenticated() on 2 POST endpoints has zero test coverage. No HabitReminderController test file exists. (2) Security: No scope enforcement — any API key regardless of scopes can now trigger POST /calculate-smart-time (computation) and POST /test (sends push notification). Should add hasRequiredScopes() or coordinate with MIN-705 which adds scope infrastructure.

Fix these issues, commit and push, then RESUBMIT for review by running:
curl -X POST http://localhost:3011/api/workspaces/MIN-708/request-review -H "Content-Type: application/json" -d '{}'
Do NOT stop until review passes.
