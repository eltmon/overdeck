---
specialist: review-agent
issueId: PAN-905
outcome: changes-requested
timestamp: 2026-04-28T23:10:35Z
---

# Verdict: CHANGES_REQUESTED

## Summary
PAN-905 implements GitHub webhook-driven merge gating (CI checks, PR state, review threads), SQLite-backed blocker-reason persistence, the Awaiting Merge canonical final gate UI, and smee.io client integration. All 18 requirements are implemented except `webhook-route.ac3` (missing dev-mode secret bypass). Three findings block this PR: (1) cross-repository webhook trust allows any repo with the GitHub App installed to mutate local review state by using a matching branch name, (2) the webhook route hard-rejects with 401 instead of bypassing signature verification in dev mode when the secret is absent, and (3) a severe N+1 SQLite regression in bulk review-status loads affects dashboard startup, snapshot builds, specialist routes, metrics, and Deacon patrol. Two high-priority findings also warrant attention before merge.

## Blockers (MUST fix before merge)

### 1. Cross-repository webhook trust allows unrelated repos to mutate local review state — `src/lib/webhook-handlers.ts:39` — `!`
**Raised by**: security
**Why it blocks**: Handlers derive the local issue ID solely from branch name (`feature/pan-<id>`) and ignore `payload.repository.full_name`. Any repository where the GitHub App is installed can send valid signed webhooks for a branch named `feature/pan-905` and flip local blocker state, undermining access controls.

**Fix:**
```typescript
function isTrackedRepository(fullName: string | undefined): boolean {
  if (!fullName) return false;
  const config = getGitHubConfig();
  return !!config?.repos.some(({ owner, repo }) =>
    `${owner}/${repo}`.toLowerCase() === fullName.toLowerCase()
  );
}

export function handlePullRequest(payload: WebhookPayload): void {
  if (!isTrackedRepository(payload.repository?.full_name)) return;
  // existing logic...
}
```
Apply `isTrackedRepository` guard to all five handlers (`handleCheckSuite`, `handleCheckRun`, `handlePullRequest`, `handlePullRequestReview`, `handlePullRequestReviewThread`). Add tests covering signed events from a non-tracked repo with a matching `feature/pan-*` branch.

### 2. Webhook route hard-rejects when secret is missing instead of dev-mode bypass — `src/dashboard/server/routes/webhooks.ts:119-120` — `!`
**Raised by**: requirements
**Why it blocks**: `webhook-route.ac3` explicitly requires "logs warning, skips verification in dev" when the webhook secret is absent. The current implementation returns 401 and rejects all events, making real-time GitHub blocker updates unavailable in development without a secret file.

**Fix:**
```typescript
if (!secret) {
  console.warn('[webhooks] No webhook secret configured — skipping HMAC verification (dev mode)');
  // continue to event dispatch without signature check
} else {
  // existing HMAC verification
}
```

### 3. N+1 SQLite queries in bulk review-status load — `src/lib/database/review-status-db.ts:150` — `⊗`
**Raised by**: performance
**Why it blocks**: `getAllReviewStatusesFromDb()` executes 1+N queries (one per issue via `getHistoryFromDb()`). At 200 issues this is 201 round-trips on every dashboard snapshot build, startup repair pass, specialist route, metrics query, and Deacon patrol cycle — a must-not regression on hot paths.

**Fix:**
```typescript
const rows = db.prepare('SELECT * FROM review_status ORDER BY updated_at DESC').all();
const historyRows = db.prepare(`
  SELECT issue_id, type, status, timestamp, notes
  FROM status_history ORDER BY issue_id, timestamp ASC
`).all();

const historyByIssue = new Map<string, StatusHistoryEntry[]>();
for (const row of historyRows) {
  const bucket = historyByIssue.get(row.issue_id) ?? [];
  bucket.push({ type: row.type, status: row.status, timestamp: row.timestamp, ...(row.notes ? { notes: row.notes } : {}) });
  historyByIssue.set(row.issue_id, bucket);
}

const result: Record<string, ReviewStatus> = {};
for (const row of rows) {
  result[row.issue_id] = rowToReviewStatus(row, historyByIssue.get(row.issue_id) ?? []);
}
```
This collapses N+1 → 2 queries. Apply the same pattern to any other bulk read paths.

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. `unresolved_conversations` blocker removed on any single thread resolve — `src/lib/webhook-handlers.ts:195` — `~`
**Raised by**: correctness
**Why it blocks**: Resolving one of multiple unresolved threads removes the blocker entirely. The `removeBlocker` function has no per-thread accounting.

**Fix:** Query the GitHub API to count unresolved threads before removing:
```typescript
if (thread.resolved === true) {
  const { countUnresolvedReviewThreads } = await import('./github-app.js');
  const remaining = await countUnresolvedReviewThreads(prOwner, prRepo, prNumber);
  if (remaining === 0) {
    removeBlocker(issueId, 'unresolved_conversations');
  }
}
```

### 2. PR polling starts for every inspector render even when merge details are not shown — `src/dashboard/frontend/src/components/inspector/ReviewPipelineSection.tsx:37` — `~`
**Raised by**: performance
**Why it blocks**: `usePrQuery(issueId ?? '')` polls every 30 seconds whenever `issueId` is truthy, but the data is only consumed during merge states (`queued|merging|verifying|failed`).

**Fix:** Add an `enabled` guard:
```typescript
const { data: prData } = usePrQuery(issueId ?? '', {
  enabled: mergeState === 'queued' || mergeState === 'merging' ||
           mergeState === 'verifying' || mergeState === 'failed'
});
```

## Nits (advisory — safe to defer)

- `src/lib/webhook-handlers.ts:116-126` — `?` — Redundant `else if (!pr.draft)` is tautological. Simplify to `else`.
- `src/dashboard/server/routes/webhooks.ts:32-48` — `?` — Webhook secret loaded at module init, never re-read. Consider caching with periodic reload or admin reload endpoint.
- `src/lib/smee.ts:99-106` — `?` — Potential duplicate SmeeClient on self-reconnect after `onerror`. Consider checking `activeClient` before scheduling restart.
- `src/lib/webhook-handlers.ts:129-141` — `?` — `dirty` excluded from `not_mergeable` blocker with no comment. Add `// 'dirty' excluded — handled by merge_conflict blocker below`.
- `src/lib/webhook-handlers.ts:93-102` — `?` — `failing_checks` removal relies solely on `check_suite` success; smee disconnect could leave stale blockers. Consider periodic reconciliation or rely on partial coverage from `status` event handler.

## Cross-cutting groups

**Webhook handler repository validation** (shared root cause: no repo allowlist check):
- [blocker-1] Cross-repository webhook trust
- [nit-4] `dirty` state comment clarification

**Bulk DB query optimization** (shared root cause: N+1 in `getAllReviewStatusesFromDb`):
- [blocker-3] N+1 history queries
- The pattern extends to any other `getHistoryFromDb` call in bulk paths

## What's good
- All 17 of 18 vBRIEF requirements fully implemented with high-quality evidence traces
- BlockerReasons schema, serialization, and enrichment logic are correct end-to-end
- Defense-in-depth filtering (server-side `readyForMerge` override + frontend `blockerReasons` check) properly implemented
- 4-step pipeline stepper with CI sub-statuses, retry count, merge notes, queue position, and live log link fully delivered
- Blocked issues display with distinct icons and expandable details on Awaiting Merge page works correctly
- smee-client lifecycle integrated with `pan up`/`pan down`/`pan doctor`; auto-restart on unexpected exit

## Review stats
- Blockers: 3   High: 2   Medium: 0   Nits: 5
- By reviewer: correctness=6, security=3, performance=2, requirements=4
- Files touched: 52   Files with findings: 9

## Appendix: individual reviews

See individual reviewer output files:
- `correctness.md`
- `security.md`
- `performance.md`
- `requirements.md`

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-905 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

