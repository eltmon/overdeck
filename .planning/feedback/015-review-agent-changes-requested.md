---
specialist: review-agent
issueId: PAN-705
outcome: changes-requested
timestamp: 2026-04-14T19:42:00Z
---

CODE REVIEW BLOCKED for PAN-705:

Two mandatory-requirement violations found:

1. removeLegacySkills070() in src/lib/sync.ts — new exported function with no tests. Every new function requires tests (happy path AND error cases) per review policy.

2. /api/show/:issueId/tldr in src/dashboard/server/routes/show.ts — stub route registered as a live endpoint but ALWAYS returns { available: false, reason: "Use pan admin tldr" } regardless of actual TLDR daemon state. The route has no callers (no CLI flag, no frontend call), no test coverage, and provides incorrect data. This is dead code with a misleading name. Either delete it from showRouteLayer or implement it properly to call getTldrDaemonService like the admin route does.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-705 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
