---
specialist: review-agent
issueId: PAN-709
outcome: changes-requested
timestamp: 2026-04-18T15:06:14Z
---

CODE REVIEW BLOCKED for PAN-709:

1. src/lib/cloister/flywheel-daemon.ts:197-198 archives every processed retro, but runSynthesis() marks all read retros as processed (including below-threshold watchlist signals and no-op retros at src/lib/flywheel/synthesis.ts:58-59,219-301). This violates the design that watchlist retros must remain in the main retros directory to accumulate future signals, so the daemon destroys the evidence needed to ever reach the 3-signal threshold. 2. Missing regression tests for the new archiving/report/issue-filing flow: there are no tests covering src/lib/flywheel/retro-archiver.ts, src/lib/flywheel/flywheel-report.ts, or src/lib/flywheel/issue-filer.ts, despite these being new functionality and the first bug living exactly in that path. Fix the processed-vs-triggering retro contract and add regression tests for watchlist retention and filing/report behavior.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-709 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
