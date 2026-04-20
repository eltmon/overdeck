---
specialist: review-agent
issueId: PAN-709
outcome: changes-requested
timestamp: 2026-04-18T16:43:39Z
---

CODE REVIEW BLOCKED for PAN-709:

BLOCKED: (1) Flywheel retro provenance endpoint cannot return provenance for flywheel-change issues. src/dashboard/frontend/src/components/FlywheelChangesTab.tsx fetches /api/flywheel/retros/:issueId using the flywheel-change issue ID, but src/dashboard/server/routes/flywheel.ts only matches retros whose filenames start with that same issue ID. Retros are written for merged source issues, not the later flywheel-change issue, so the UI will always show zero retros. (2) src/lib/flywheel/issue-filer.ts records issueNumber from tracker.createIssue().id, but the GitHub tracker normalizes id to GitHub internal issue id while the visible issue number lives in ref/url. This writes wrong issue numbers into flywheel results/reporting and lacks a regression test for id != issue number.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-709 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
