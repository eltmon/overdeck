---
specialist: review-agent
issueId: PAN-705
outcome: changes-requested
timestamp: 2026-04-14T17:32:29Z
---

CODE REVIEW BLOCKED for PAN-705:

Critical issues found: (1) work.md NOT updated — still contains pan work done/request-review commands that no longer exist after the v0.7.0 work/ directory removal, breaking ALL work agent completions; (2) deacon.ts NOT updated — nudge/poke messages at lines 1749,1757,1896,1897,2055,2160 still reference pan work done and pan work request-review; (3) verification-runner.ts NOT updated — line 244 feedback message tells agents to use pan work request-review; (4) review.md API URLs not updated — 4 instances of /api/workspaces/ISSUE_ID/review-status should be /api/review/ISSUE_ID/status; (5) test.md API URLs not updated — 3 instances of same stale endpoint; (6) workspaces.ts:3786 internal approve-to-merge forwarding uses old URL /api/workspaces/ISSUE_ID/merge which is now /api/issues/ISSUE_ID/merge; (7) workspaces.ts:3899-3907 inline review prompt string uses old URL in 3 places; (8) specialist-workflow.spec.ts:96 test calls /api/workspaces/TEST_ISSUE_ID/approve but route is now /api/issues/TEST_ISSUE_ID/approve; (9) tracker-handler.ts:109 uses @ts-ignore to access private Linear SDK client._client with no guard if undefined

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-705 — this is an atomic task that runs pan work done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan work done has completed successfully.
