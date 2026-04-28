---
specialist: review-agent
issueId: PAN-895
outcome: changes-requested
timestamp: 2026-04-28T00:02:46Z
---

# Verdict: CHANGES_REQUESTED

## Summary
PAN-895 unifies cost display between Zone A and the Overview tile by introducing a shared `issue-cost-resolver.ts` service that returns `resolvedTotalCost = max(aggregateCost, liveCost)`. All 3 requirements pass coverage review. However, two related performance findings on the interactive dashboard polling path must be addressed before merge: IssueHeader polls heavyweight endpoints every 30s instead of using the new lightweight summary endpoints introduced by this PR, and the activity endpoint calls `listRunningAgentsAsync()` on every poll to resolve live agent costs — creating filesystem I/O that compounds with multiple connected clients.

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. IssueHeader polls heavyweight endpoints instead of lightweight summary endpoints — `~`
**Raised by**: performance
**Why it blocks**: Every 30s poll from IssueHeader re-fetches full transcript/artifact/cost payloads via `/api/command-deck/activity/:issueId` and `/api/command-deck/planning/:issueId` when this PR already introduced `?summary=1` lightweight paths that return only badges/counts/progress. Multiple concurrent dashboard clients amplify this waste.

**Fix instruction**: Have IssueHeader use the same shared summary query keys and `?summary=1` endpoints that this PR added to `ZoneCOverviewTabs/queries.ts`. Reserve the full (non-summary) endpoints for on-demand fetches when the user explicitly opens transcript/PRD bodies. The query keys are already centralized — import and reuse them.

### 2. `listRunningAgentsAsync()` called on every activity poll without TTL cache — `≉`
**Raised by**: correctness
**Affected by**: performance (same execution path)
**Why it blocks**: `command-deck.ts:556` calls `listRunningAgentsAsync()` (which scans `~/.panopticon/agents/` via readdir + per-file reads) on every 5-second activity poll. This is filesystem I/O that is not guarded by any TTL cache and compounds per connected client. The root cause is that the activity endpoint needs live agent costs for the header badge.

**Fix instruction**: The fix for finding #1 also addresses this: if IssueHeader switches to the lightweight `?summary=1` path, the activity endpoint's live-cost resolution path is no longer polled on the header cadence. Alternatively or additionally, cache the agents list with a short TTL (2–3 s) inside the activity endpoint alongside the existing `costCache`.

## Nits (advisory — safe to defer)

- `src/dashboard/server/routes/conversations.ts:340` — `?` — Dead `return { ok: false, error: 'Missing origin' }` after exhaustive early-return chain. Remove the unreachable statement. (correctness)
- `src/dashboard/server/services/issue-cost-resolver.ts:22` — `?` — `normalizePositiveCost` treats `0` as null. Design choice (UI hides `$0.00`), but worth confirming with the team. (correctness)
- `src/dashboard/frontend/src/components/CommandDeck/SessionView/IssueHeader.tsx:228` — `?` — IssueHeader reads cost from activity endpoint while OverviewTab reads from costs endpoint. Dual resolution path adds fragility even though both now return `resolvedTotalCost`. Consider aligning to the same query + fallback pattern. (correctness)
- `src/dashboard/frontend/src/components/CommandDeck/SessionView/IssueHeader.tsx:396,407,420,434` — `?` — Artifact viewers use `window.alert()` for PRD/STATE/discussions/transcripts. Not XSS but fragile for large user-authored content. Prefer a bounded in-app modal as this area evolves. (security)

## Cross-cutting groups

**Header polling architecture** (fix together — both stem from IssueHeader polling on 30s interval):
- [high-1] IssueHeader polls heavyweight endpoints instead of lightweight summary endpoints
- [high-2] `listRunningAgentsAsync()` called on every activity poll without TTL cache

## What's good
- Shared `issue-cost-resolver.ts` cleanly unifies `max(aggregateCost, liveCost)` for both Zone A and Overview tile
- All 3 requirements fully implemented and verified with tests
- CSRF relaxation for safe same-origin GET/HEAD requests is correctly scoped
- Lightweight `?summary=1` endpoints introduced alongside the fix provide the right architectural foundation for the polling optimization

## Review stats
- Blockers: 0   High: 2   Medium: 0   Nits: 4
- By reviewer: correctness=5, security=1, performance=2, requirements=0
- Files touched: 14   Files with findings: 7

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the Synthesis Context above. Those files contain full per-reviewer detail; this synthesis is the policy layer.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-895 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

