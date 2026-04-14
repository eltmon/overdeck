---
specialist: review-agent
issueId: PAN-705
outcome: changes-requested
timestamp: 2026-04-14T19:10:43Z
---

CODE REVIEW BLOCKED for PAN-705:

CRITICAL BUG 1: pan review request missing -m option. The rebase-and-submit skill, work.md, and verification-runner all tell agents to run `pan review request <id> -m "message"` but -m is not registered for the `review request` subcommand in src/cli/index.ts (line 157-160). Commander.js will reject -m as an unknown option, breaking all specialist feedback re-entry. CRITICAL BUG 2: pan done missing --force option. The done.ts implementation (line 284) tells users "Use --force to skip checks" when pre-flight checks fail, but --force is not registered for `pan done` in index.ts (lines 214-220). Users/agents have no way to bypass pre-flight checks.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-705 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
