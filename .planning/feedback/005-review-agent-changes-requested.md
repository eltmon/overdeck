---
specialist: review-agent
issueId: PAN-705
outcome: changes-requested
timestamp: 2026-04-14T17:42:31Z
---

CODE REVIEW BLOCKED for PAN-705:

Fresh review found 4 real bugs. Prior 9 findings were stale (already fixed by agent). ACTUAL BLOCKERS: (1) show.ts:44-45 — default `pan show <id>` only calls shadowCommand despite comment saying "run all views in order for a compact summary"; cv, health, context are never shown in the default path. (2) issues.ts:222-242 — `--shadow-only` flag does not filter the main display: all issues are printed first (lines 222-225), then the shadow-only subset is appended below. Two outputs rendered when only one is expected. (3) index.ts:168-172 — `pan review reset --session` calls ONLY resetSessionCommand, skipping resetReviewCommand. The flag description says "Also clear saved Claude session" ("also" implies review reset always happens) but the code skips it. (4) index.ts:167 — `--cycles` option is registered on `pan review reset` but silently ignored — no distinct code path from the default. Either remove the option or implement it. MISSING TESTS: showCommand, listCommand shadow-only path, and review reset option combinations have no unit tests.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-705 — this is an atomic task that runs pan work done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan work done has completed successfully.
