---
specialist: review-agent
issueId: MIN-708
outcome: changes-requested
timestamp: 2026-03-01T18:21:21Z
---

CODE REVIEW BLOCKED for MIN-708:

2 BLOCKING ISSUES (same root cause): (1) Scope check format bug (HabitReminderController:51): uses scope.getValue() returning habits:reminders but auth system stores SCOPE_HABITS_REMINDERS. Scope check will NEVER match in production — API keys with correct scope always get 403. Fix: change scope.getValue() to SCOPE_ + scope.name(). (2) Tests (lines 173, 215) set authority as habits:reminders matching wrong controller code. Should be SCOPE_HABITS_REMINDERS to match real auth system.

Fix these issues, commit and push, then RESUBMIT for review by running:
curl -X POST http://localhost:3011/api/workspaces/MIN-708/request-review -H "Content-Type: application/json" -d '{}'
Do NOT stop until review passes.
