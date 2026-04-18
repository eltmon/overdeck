---
specialist: review-agent
issueId: PAN-457
outcome: changes-requested
timestamp: 2026-04-18T14:33:08Z
---

CODE REVIEW BLOCKED for PAN-457:

1. src/lib/conversations/search.ts:229-253 and 283-317 return truncated totals for FTS-backed searches because searchFts() is capped to limit*3/limit*5 and total is derived from that capped candidate set. The UI/API reports incorrect result counts as soon as there are more matches than the over-fetch cap, and there is no regression test for FTS/semantic pagination totals. 2. src/cli/commands/conversations/scan.ts:44-48 passes watchDirs: [] for every mode, so `pan conversations scan --mode watched` always scans zero files instead of reading config.conversations.watchDirs. That violates the documented watched-mode behavior and there is no CLI regression test covering it.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-457 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
