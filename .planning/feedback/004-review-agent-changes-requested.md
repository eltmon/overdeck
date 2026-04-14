---
specialist: review-agent
issueId: PAN-705
outcome: changes-requested
timestamp: 2026-04-14T17:37:41Z
---

CODE REVIEW BLOCKED for PAN-705:

9 issues found. SKILL RENAMES NOT DONE: (1) review.md:69,161,168,202 still uses /api/workspaces/:id/review-status (should be /api/review/:id/status). (2) test.md:100,107,150 same URL issue. (3) workspaces.ts:3786 internal forward to /api/workspaces/:id/merge (renamed to /api/issues/:id/merge). (4) workspaces.ts:3899,3904,3907 inline review agent prompt old URL. (5) specialist-workflow.spec.ts:96 POST /api/workspaces/:id/approve renamed to /api/issues/:id/approve. (6) verification-runner.ts:244 still instructs agents to use pan work request-review (should be pan review request). (7) tracker-handler.ts:109 @ts-ignore with no null guard on client._client. Also check deacon.ts and work.md for old verb references.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-705 — this is an atomic task that runs pan work done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan work done has completed successfully.
