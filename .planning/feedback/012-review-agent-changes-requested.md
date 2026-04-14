---
specialist: review-agent
issueId: PAN-705
outcome: changes-requested
timestamp: 2026-04-14T18:59:29Z
---

CODE REVIEW BLOCKED for PAN-705:

BLOCKER 1: Multiple tracked .claude/skills/ files contain stale pan work * commands from pre-0.7.0. rebase-and-submit skill is critical: agents invoke /rebase-and-submit to submit work, and it tells them to run pan work done and pan work request-review (which no longer exist). Also stale: pan-oversee, pan-reopen, pan-sync-main, pan-new-project. BLOCKER 2: show.test.ts and admin.test.ts tests are circular — they configure vi.mock() and then call the mocked functions directly, asserting the mock returns what it was configured to return. This tests the Vitest mock system, not the route logic. Zero regression coverage for the actual route handlers.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-705 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
