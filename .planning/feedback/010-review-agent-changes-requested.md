---
specialist: review-agent
issueId: pan-705
outcome: changes-requested
timestamp: 2026-04-14T18:45:19Z
---

CODE REVIEW BLOCKED for pan-705:

Two blocking issues found:

1. STRAY SEMICOLON — src/dashboard/server/routes/show.ts:21 has a bare `;` empty statement after the last import. Dead code that should not have been committed.

2. SYNC-COSTS ALIAS NOT DROPPED — The PRD explicitly mandates "pan sync-costs → pan cost sync only (drop the alias)" and the acceptance criteria requires "pan --help output matches the target surface from QUICK-REFERENCE.md". QUICK-REFERENCE.md does NOT list sync-costs in the target surface (only in the migration table as a legacy command). But src/cli/index.ts still registers sync-costs as a top-level command (lines 779-785) and the pan-help.txt fixture was updated to capture this broken behavior instead of enforcing the PRD intent. Fix: remove the sync-costs command block from index.ts and regenerate the fixture.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for pan-705 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
