---
specialist: review-agent
issueId: PAN-705
outcome: changes-requested
timestamp: 2026-04-14T20:19:02Z
---

CODE REVIEW BLOCKED for PAN-705:

CHANGES_REQUESTED — 3 blockers:

1. docs/SPECIALIST_WORKFLOW.md:660-662 and :721 — stale legacy API route references in a file that IS in the diff. The API table at lines 660-662 still documents `POST /api/workspaces/:id/request-review`, `POST /api/workspaces/:id/review`, and `GET /api/workspaces/:id/review-status` — none of these routes exist anymore. They must be updated to the new routes: `POST /api/review/:id/request`, `POST /api/review/:id/trigger`, and `GET /api/review/:id/status`. Line 721 also shows the old `POST /api/workspaces/:issueId/sync-main` — should be `POST /api/issues/:issueId/sync-main`. This file was partially updated but the API reference table and the sync-main section were missed.

2. src/dashboard/frontend/src/components/upgrade-announcement/UpgradeAnnouncement.tsx — no unit tests. New component with localStorage read/write logic and dismiss behavior. App.test.tsx only mocks it as () => null — that does not test the component behavior. Required tests: (a) renders migration table when localStorage key not set, (b) does not render when localStorage key is set to 1, (c) clicking dismiss writes key to localStorage and removes component.

3. src/cli/index.ts:783 — sync-costs alias not removed. PRD explicitly states under Key Collapses: pan sync-costs → pan cost sync only (drop the alias). Design principle: No muscle-memory aliases. Clean break. The alias at line 783 was not removed; the pan-help.txt fixture was even updated to include it with (alias for: pan cost sync) description. This contradicts the documented design decision. Remove the sync-costs command registration and regenerate the fixture.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-705 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
