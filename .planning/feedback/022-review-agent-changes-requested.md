---
specialist: review-agent
issueId: PAN-457
outcome: changes-requested
timestamp: 2026-04-15T22:50:21Z
---

CODE REVIEW BLOCKED for PAN-457:

Four bugs require fixes: (1) selectSessionsForEnrichment uses findDiscoveredSessions({limit:1,offset:0}) to look up specific IDs — will return null for almost every ID since it only fetches the first session; must use getDiscoveredSessionById. (2) filterByMode for watched/targeted modes compares projectDir (~/.claude/projects/<hash>/) against workspace dirs via startsWith — they never share a prefix, so watched/targeted scans always return 0 files. (3) Dead code in ConversationsPage.tsx lines 231-234: void BarChart2; void Zap; void RefreshCw suppresses unused imports instead of removing them. (4) enrich.ts --yes bypass is broken: the retry call still goes through enrichSessions() which re-throws CostThresholdError, making --yes non-functional.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-457 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
