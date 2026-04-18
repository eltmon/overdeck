---
specialist: review-agent
issueId: PAN-704
outcome: changes-requested
timestamp: 2026-04-18T14:52:27Z
---

CODE REVIEW BLOCKED for PAN-704:

Missing required regression coverage for the new PlanningChips extraction. The change introduces new fetch-driven behavior in src/dashboard/frontend/src/components/PlanningChips.tsx:29-160, including /planning-state queries, /generate-tasks mutation success handling, and error handling, but src/dashboard/frontend/src/components/KanbanBoard.test.tsx only covers the FeatureCard happy path and active-planning path. There are no tests for TasksChip generating tasks when beadsCount is 0, no test that refreshDashboardState/invalidateQueries runs after generation, and no test for the generate-tasks error path showing the failure alert. Under this repo’s review rules, new functionality and bug-fix behavior require happy-path and error-path tests, so this cannot be approved.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-704 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
