---
specialist: review-agent
issueId: pan-705
outcome: changes-requested
timestamp: 2026-04-14T17:43:34Z
---

CODE REVIEW BLOCKED for pan-705:

PAN-705 structural blocker: the branch renames /api/workspaces/:id/review-status → /api/review/:id/status (and similar for approve/merge), but the dashboard running specialists is built from main and still serves the OLD routes. Branch review.md/test.md prompts point agents at the NEW routes → every specialist POST 404s → review/test verdicts never reach the pipeline. REQUIRED FIX: keep the old route paths as aliases that forward to the new handlers (dual-routes) on this branch so in-place specialist reviews work. Files to patch: src/dashboard/server/routes/workspaces.ts (add alias registrations for /api/workspaces/:issueId/review-status [GET+POST], /api/workspaces/:issueId/approve, /api/workspaces/:issueId/merge, /api/workspaces/:issueId/reviews), plus any others the dispatcher URLs touch. A follow-up issue can remove the aliases after merge. Also fix: src/cli/commands/admin/tracker-handler.ts:109 — @ts-ignore accessing client._client needs a null guard. Verification: after adding aliases, rebuild dashboard on main, re-run review — verdicts should land.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for pan-705 — this is an atomic task that runs pan work done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan work done has completed successfully.
