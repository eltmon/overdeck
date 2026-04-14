---
specialist: review-agent
issueId: PAN-705
outcome: changes-requested
timestamp: 2026-04-14T18:23:20Z
---

CODE REVIEW BLOCKED for PAN-705:

CRITICAL: pan plan <id> is broken. planCmd.command("<id>") on src/cli/index.ts:174 creates a Commander.js subcommand literally named "<id>" — running pan plan PAN-123 returns "error: unknown command PAN-123". The fix requires planCmd.argument("<id>") or restructuring. HIGH: dead code issuePrefix variable in show.ts:87 (computed, never used). Misleading comment in admin.ts:8 claims GET /api/admin/fpp/:issueId is implemented but it is not. Missing tests for new server routes show.ts and admin.ts.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-705 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
