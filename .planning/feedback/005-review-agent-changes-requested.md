---
specialist: review-agent
issueId: PAN-895
outcome: changes-requested
timestamp: 2026-04-28T01:08:05Z
---

# Verdict: CHANGES_REQUESTED

## Summary
PAN-895 unifies cost display between Zone A and the Overview tile by centralizing aggregate + live cost resolution in `issue-cost-resolver.ts` and wiring `resolvedTotalCost` through both the activity endpoint and the costs endpoint. All 3 requirements are implemented and requirements coverage is complete. However, 2 correctness regressions introduced by the PR are blockers: the specialist session name computation dropped `issueId` (3-arg → 2-arg `getTmuxSessionName`), causing a mismatch with where `specialists.ts` actually names sessions, making all running specialists appear "ended" in the activity feed. Separately, the specialist `sessionId` was changed from the real tmux session name to a synthetic ID, which re-introduces a previously-fixed bug where the Conversation panel cannot locate JSONL transcripts for test/merge sessions. These two bugs are in the same file and share the same root cause (session name computation for specialists); fix them together.

## Blockers (MUST fix before merge)

### 1. Specialist tmux session name mismatch — running specialists always show as "ended"
**Raised by**: correctness
**Why it blocks**: The PR changed `getTmuxSessionName` for specialists from a 3-argument call (including `issueId`) to a 2-argument call, but `specialists.ts:815` still uses the 3-argument form. This produces different session names (`specialist-panopticon-cli-test-agent` vs `specialist-panopticon-cli-pan-895-test-agent`), so `tmuxSessionNames.has(tmuxSessionName)` always returns `false` for running test/merge specialists. The `specialistPresence` is always computed as `'ended'` even when the specialist is actively running.

**Fix** (`src/dashboard/server/routes/command-deck.ts:517-518`): restore the 3-argument call with `issueId`:
```typescript
tmuxSessionName = getTmuxSessionName(specialistType as never, resolved?.projectKey, issueId);
```

### 2. Specialist sessionId regression — JSONL conversation broken for test/merge sessions
**Raised by**: correctness
**Why it blocks**: The specialist `sessionId` was changed from the real tmux session name to a synthetic `specialist-<type>-<startedAt>` ID. `resolveJsonlPath` looks up `~/.panopticon/agents/<sessionId>/session.id` — with the synthetic ID, no agent directory exists, so `hasJsonl` is always `false` and the Conversation panel shows "No conversation data available" for ALL specialist sessions. This re-introduces a previously-fixed bug (the old synthetic ID approach was explicitly documented as broken).

**Fix** (`src/dashboard/server/routes/command-deck.ts:525`): use the real tmux session name as `sessionId`:
```typescript
const specialistSessionId = tmuxSessionName;
const specialistJsonlPath = await resolveJsonlPath(specialistSessionId, workspacePath);
```
Note: this fix depends on fixing Blocker #1 first, since `tmuxSessionName` must be correct for the lookup to succeed.

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. Duplicate syncCache + uncached listRunningAgentsAsync on a polled dashboard route
**Raised by**: performance
**Why it matters**: `GET /api/issues/:id/costs` calls `syncCache()` directly, then calls `getCostsForIssue()` which calls `syncCache()` again internally, and then calls `listRunningAgentsAsync()` without any TTL cache. Every 30-second poll pays for two sync passes and a full agent scan. At scale this adds measurable filesystem and tmux overhead. This is on a dashboard polling path, not a public API hot path, but the fix is low-cost.

**Fix** (`src/dashboard/server/routes/issues.ts:3086`): remove the outer redundant `syncCache()` and rely on `getCostsForIssue()` once. Wire `listRunningAgentsAsync()` through the existing TTL cache used by `command-deck.ts`:
```typescript
const issueData = getCostsForIssue(id);
const agents = yield* Effect.promise(() => getCachedRunningAgents(id));
```

### 2. runningAgentsCache stores full agents list per issueId — O(N) duplication
**Raised by**: correctness
**Why it matters**: `listRunningAgentsAsync()` returns ALL agents across ALL issues, but the result is stored under a per-issue cache key. With N open issues, the same full agents array is stored N times. A single global cache entry avoids this redundancy without changing behavior.

**Fix** (`src/dashboard/server/routes/command-deck.ts:129-140`): use a single global cache key instead of per-issue keys:
```typescript
const GLOBAL_KEY = '__all_agents__';
async function getCachedRunningAgents() {
  sweepExpired(runningAgentsCache, RUNNING_AGENTS_CACHE_TTL_MS);
  const cached = runningAgentsCache.get(GLOBAL_KEY);
  if (cached && cached.timestamp > Date.now() - RUNNING_AGENTS_CACHE_TTL_MS) {
    return cached.agents;
  }
  const agents = await listRunningAgentsAsync();
  runningAgentsCache.set(GLOBAL_KEY, { timestamp: Date.now(), agents });
  return agents;
}
```

## Nits (advisory — safe to defer)

- `src/dashboard/server/services/issue-cost-resolver.ts:22` — `~` — `normalizePositiveCost` treats `$0` as `null`. The requirements say "show nothing, not $0.00" when no data exists, but this conflates "no data" with "data says $0". If a cost is genuinely `$0.00` (free-tier model, free API calls), the UI suppresses it entirely rather than showing `$0.00`. This is a design choice — confirm with the team whether showing `$0.00` is desired.
- `src/dashboard/server/routes/command-deck.ts:317` — `?` — Status derivation simplified; the presence-based "running" fallback was removed. A genuinely-running agent could briefly appear as "completed" if its runtime state update is delayed. Minor timing concern, not a bug.
- `src/dashboard/frontend/src/components/CommandDeck/index.tsx:422` — `?` — Session lookup handlers (`handleViewTerminal`, `handleViewJsonl`) linearly scan all projects/features. Fine at current scale; O(N) map would help only at much larger project counts.

## Cross-cutting groups

**Specialist session naming** (both blockers share the same root cause — specialist session name computation in `command-deck.ts`):
- [blocker-1] `getTmuxSessionName` called with 2 args instead of 3 (missing `issueId`)
- [blocker-2] `sessionId` changed from real tmux session name to synthetic ID

**Cache inefficiency on polling paths** (same underlying pattern: no TTL cache for listRunningAgentsAsync):
- [high-1] `GET /api/issues/:id/costs` — redundant syncCache + uncached agent scan
- [high-2] `runningAgentsCache` — per-issue storage of full agents list

## What's good
- All 3 requirements implemented and verified by requirements reviewer — REQ-1 (unified cost), REQ-2 (show nothing vs $0.00), REQ-3 (max aggregate/live) all have complete evidence
- Cost resolution centralized in `issue-cost-resolver.ts` with clear single responsibility
- Security reviewer found no injection, authz bypass, XSS, or sensitive-data exposure issues in the changed code
- Dashboard polling path already uses TTL caches for cost and running-agent lookups in the activity endpoint

## Review stats
- Blockers: 2   High: 2   Medium: 0   Nits: 3
- By reviewer: correctness=2 blockers + 2 warnings, security=0, performance=1 high + 1 optimization, requirements=PASS
- Files touched: 14 source files + feedback artifacts   Files with findings: 4

## Appendix: individual reviews

See individual reviewer output files:
- `correctness.md` — 2 critical regressions (session name mismatch, synthetic sessionId), 2 warnings, 2 suggestions
- `security.md` — no findings
- `performance.md` — 1 high (duplicate syncCache + uncached agents on polling path), 1 optimization (session lookup O(N))
- `requirements.md` — PASS, all 3 requirements implemented

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-895 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

