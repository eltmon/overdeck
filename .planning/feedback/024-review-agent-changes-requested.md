---
specialist: review-agent
issueId: PAN-457
outcome: changes-requested
timestamp: 2026-04-18T13:31:39Z
---

CODE REVIEW BLOCKED for PAN-457:

1. src/dashboard/frontend/src/components/conversations/ConversationsPage.tsx:93-130 fetches only the first 50 sessions and filters client-side, so search misses matches outside that page and never uses /api/discovered-sessions/search. 2. src/lib/conversations/enrichment/index.ts:80-88 ignores the requested tier when bulk-selecting sessions, so tier 2/3 bulk enrichment skips sessions already at level 1 instead of upgrading them. 3. src/lib/conversations/scanner.ts:263-266 treats watched mode with no watchDirs as all files, and src/dashboard/server/routes/discovered-sessions.ts:167-182 always passes watchDirs: [], so watched scans become unintended system scans. 4. src/lib/conversations/jsonl-async.ts:20-32 and 73-170 plus src/lib/conversations/scanner.ts:184-203 never capture/persist sessionId, leaving discovered_sessions.session_id null. 5. src/lib/database/discovered-sessions-db.ts:49-69 and 268-299 disagree with src/lib/conversations/__tests__/search.test.ts:121-141: tests pass tags to upsertDiscoveredSession, but the upsert type and SQL do not support tags. Also missing route/frontend coverage for src/dashboard/server/routes/discovered-sessions.ts and src/dashboard/frontend/src/components/conversations/*.tsx.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-457 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
