# Dashboard API Caching & Real-Time Push Architecture

The dashboard uses a multi-layer caching system with real-time push to minimize external API usage and provide instant page loads.

## Problem

Without caching, the frontend polls `/api/issues` every 5 seconds. Each call triggers fresh API calls to GitHub, Linear, and Rally. GitHub's GraphQL rate limit (5,000/hour) gets exhausted within an hour, and dashboard loads feel slow (3-5s waiting for all trackers).

## Architecture Overview

```
Frontend (TanStack Query)
  |
  |-- socket.io (primary, real-time push)
  |-- HTTP /api/issues (60s fallback poll)
  |
Dashboard Server (Express)
  |
  |-- IssueDataService (background poller)
  |     |-- Polls each tracker on its own schedule
  |     |-- Detects changes, pushes via socket.io
  |     |-- Adaptive backoff on rate limit pressure or unchanged data
  |
  |-- CacheService (two-layer)
  |     |-- L1: In-memory Map (hot, 10s TTL, 50 entries max)
  |     |-- L2: SQLite (persistent, survives restarts)
  |
  |-- GitHub (REST + ETags, 304s are FREE)
  |-- Linear (GraphQL + incremental updatedAt)
  |-- Rally (TTL-based caching)
```

## Key Components

### CacheService (`src/dashboard/server/services/cache-service.ts`)

Two-layer cache backed by SQLite (at `~/.overdeck/cache.db`):

- **L1 (In-Memory)**: Map with 10s TTL, 50 entries max. Serves hot reads without hitting disk.
- **L2 (SQLite)**: Persistent storage that survives server restarts. Uses WAL mode for concurrent reads.

SQLite schema:

| Table | Purpose |
|-------|---------|
| `api_cache` | Stores tracker responses with ETags, TTLs, and timestamps |
| `rate_limits` | Tracks per-tracker rate limit remaining/total/reset |

Key methods:

| Method | Description |
|--------|-------------|
| `get(tracker, key)` | Read from L1 then L2, returns null if expired |
| `getStale(tracker, key)` | Read even if expired (serve while re-fetching) |
| `set(tracker, key, data, opts)` | Write to both layers with optional ETag/TTL |
| `getEtag(tracker, key)` | Get stored ETag for conditional requests |
| `shouldBackoff(tracker)` | Check if remaining < 10% of total |
| `getBackoffMs(tracker, base)` | Calculate adaptive backoff delay |
| `invalidate(tracker)` | Clear all cache entries for a tracker |

### IssueDataService (`src/dashboard/server/services/issue-data-service.ts`)

Central orchestrator that replaces the inline `/api/issues` handler. Responsibilities:

1. **Background polling** per tracker on independent timers
2. **Change detection** via length + newest `updatedAt`
3. **Socket.io push** when data changes
4. **Adaptive backoff** when rate limits are low or nothing changed
5. **Instant serve** from in-memory cache

#### Poll Intervals

| Tracker | Default | Min (backoff) | Max (backoff) |
|---------|---------|---------------|---------------|
| GitHub  | 30s     | 15s           | 300s          |
| Linear  | 30s     | 15s           | 300s          |
| Rally   | 120s    | 60s           | 600s          |

#### Backoff Strategy

When rate limits are under pressure, poll intervals increase automatically:

| Remaining % | Multiplier |
|-------------|------------|
| > 50%       | 1x (normal) |
| 25-50%      | 2x |
| 10-25%      | 5x |
| < 10%       | 10x |

The result is clamped to the tracker's min/max. When the quota is exhausted, the tracker is
suspended until the rate-limit reset (capped at 1 hour), past the max. While the PAT REST
bucket is paused (PAN-4264), the GitHub poll waits for the pause end.

#### Unchanged backoff (GitHub)

Each scheduled GitHub poll that returns unchanged data (every repo answered 304, so the issue
count and newest `updatedAt` are the same) doubles the next interval, up to the max
(PAN-4507, `src/dashboard/server/services/poll-cadence.ts`):

| Consecutive unchanged polls | Next interval |
|-----------------------------|---------------|
| 0                           | 30 s          |
| 1                           | 60 s          |
| 2                           | 120 s         |
| 3                           | 240 s         |
| 4 or more                   | 300 s         |

The delay combines in this order:

1. `max(unchanged backoff, rate-limit backoff)` — the longer delay wins; a tie is reported as rate-limit backoff.
2. A rate-limit suspension replaces that delay.
3. A PAT REST quota pause can only lengthen it.

Only scheduled polls move the streak. The startup poll and the poll inside `invalidateTracker`
do not, and a skipped poll (quota pause, no GitHub config) or a failed poll leaves it as it is.
Linear and Rally keep a streak of 0, so their cadence is unchanged.

These events return GitHub to the 30 s cadence:

- A scheduled poll that returns changed data.
- `POST /api/trackers/refresh` (the Kanban Refresh button) and every other `invalidateTracker` caller (issue transitions, close-out).
- `POST /api/cache/clear` (`clearCacheAndRefresh()`).
- `GET /api/issues`.
- A verified GitHub `issues` webhook from a tracked repo.

The last two use `IssueDataService.resetPollCadence(tracker)`. It zeroes the streak and re-arms
the timer at the default interval only when the armed poll is further away than that, so
repeated resets never postpone a poll that is already due. A cadence reset never polls and
never deletes cache rows, so the stored ETags keep the next conditional request free. Under
rate-limit pressure the re-armed delay is the rate-limit-adjusted interval, not 30 s.

> **GitHub App setup:** the webhook reset fires only if the GitHub App subscribes to **Issues**
> events: GitHub → Settings → Developer settings → GitHub Apps → the Overdeck app →
> Permissions & events → Subscribe to events → Issues. This is app configuration, not code.
> Without the subscription the poller still works, but an issue edited on GitHub can take up
> to 300 s to appear while the poller is backed off.

### Tracker-Specific Strategies

#### GitHub: REST + ETags

Switched from `gh` CLI (GraphQL) to `@octokit/rest` (REST API). GitHub REST supports conditional requests via ETags:

- First request returns data + `ETag` header
- Subsequent requests send `If-None-Match: <etag>`
- If nothing changed, GitHub returns `304 Not Modified` which is **FREE** (doesn't count against rate limit)
- This means ~95% of polls cost zero rate limit points

#### Linear: Incremental `updatedAt`

- Stores the most recent `updatedAt` timestamp from cached issues
- Subsequent polls add `updatedAt: { gt: lastUpdatedAt }` filter to only fetch changed issues
- Merges incremental results into the full cached list by identifier
- Full refresh every 5 minutes as a safety net

#### Rally: TTL Caching

Rally has no conditional request or incremental fetch support:
- Wraps existing `RallyTracker.listIssues()` call with TTL check (120s default)
- Only fetches when cache entry is stale
- After fetch, `computeDerivedFeatureStatus()` derives Feature status from child stories (any in-progress → Feature in-progress, all done → Feature done)
- Raw Rally state (`rawState`) is preserved through the pipeline as `rawTrackerState` for UI display
- Shadow state merging adds `shadowTrackerStatus` when shadow state diverges from tracker state

### Socket.io Push (`useSocketIssues` hook)

Frontend hook at `src/dashboard/frontend/src/hooks/useSocketIssues.ts`:

- Connects to server via socket.io on `/socket.io` path
- Receives `issues:snapshot` on initial connect
- Receives `issues:updated` when server detects changes
- Injects data directly into TanStack Query cache via `setQueriesData`
- On tab re-focus, emits `issues:request-snapshot` for catch-up

#### Socket Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `issues:snapshot` | Server -> Client | Full issue list (on connect) |
| `issues:updated` | Server -> Client | Full issue list (after change detected) |
| `issues:meta` | Server -> Client | Rate limit and diagnostics info |
| `issues:request-snapshot` | Client -> Server | Request fresh snapshot (e.g., tab re-focus) |

### TrackerConfig (`src/dashboard/server/services/tracker-config.ts`)

Extracted config readers for reuse:

| Function | Description |
|----------|-------------|
| `getLinearApiKey()` | Read from `~/.overdeck.env` or `$LINEAR_API_KEY` |
| `getGitHubConfig()` | Read token + repos from `~/.overdeck.env` |
| `getRallyConfig()` | Read API key + optional server/workspace/project |

## Mutation Cache Invalidation

When the dashboard performs mutations (move-status, close, reset, reopen), the affected tracker's cache is invalidated and an immediate re-poll is triggered:

```typescript
await issueDataService.invalidateTracker('github'); // or 'linear'
```

Endpoints with cache invalidation:
- `POST /api/issues/:id/move-status`
- `POST /api/issues/:issueId/close`
- `POST /api/issues/:id/reset`
- `POST /api/issues/:id/reopen`

## API Endpoints

### `GET /api/issues`

Returns issues from cache (instant). Query parameters unchanged:
- `cycle`: `'current'` (default) | `'all'` | `'backlog'`
- `includeCompleted`: `'true'` | `'false'` (default)

### `GET /api/cache-status`

Diagnostics endpoint returning per-tracker cache health:

```json
{
  "github": {
    "remaining": 4800,
    "total": 5000,
    "backoffMs": 0,
    "suspendedUntil": null,
    "rateLimited": false,
    "pollInterval": 120000,
    "pollIntervalReason": "unchanged-backoff",
    "unchangedStreak": 2,
    "nextPollAt": "2026-02-08T12:02:00.000Z",
    "lastFetched": "2026-02-08T12:00:00.000Z",
    "lastError": null,
    "issueCount": 42
  },
  "linear": { ... },
  "rally": { ... }
}
```

`pollInterval` is the delay of the armed poll timer. `nextPollAt` is when it fires, or `null`
when no timer is armed (polling not started, or a poll is in flight). `pollIntervalReason`
names the term that set the delay:

| Reason | Meaning |
|--------|---------|
| `default` | No backoff applies; the tracker's default interval. |
| `unchanged-backoff` | Consecutive unchanged GitHub polls lengthened the interval (`unchangedStreak` counts them). |
| `rate-limit-backoff` | Low remaining quota lengthened the interval (`backoffMs`), at least as much as the unchanged backoff. |
| `rate-limit-suspended` | The quota is exhausted; the poll waits for the rate-limit reset (capped at 1 hour). |
| `quota-pause` | The PAT REST bucket is paused (PAN-4264); the GitHub poll waits for the pause end. |

## Frontend Query Intervals

| Component | Query | Previous | Current | Reason |
|-----------|-------|----------|---------|--------|
| Default (main.tsx) | all queries | 5s | 60s | Socket handles real-time |
| App.tsx | issues | 5s | 60s (default) | Socket handles real-time |
| App.tsx | confirmations | 2s | 2s | Local data, no external API |
| App.tsx | agents | 5s | 5s | Local data, no external API |
| KanbanBoard | issues | 5s | 60s (default) | Socket handles real-time |
| KanbanBoard | specialists | 5s | 5s | Local data |
| ActivityPanel | activity | 1s | 2s | Bootstrap fallback only — primary flow is WebSocket events |

`staleTime` increased from 2s to 30s. `refetchIntervalInBackground` set to `false`.

## Expected Impact

| Metric | Before | After |
|--------|--------|-------|
| GitHub API rate limit burn | ~720 calls/hr (all count) | ~720 calls but ~700+ return 304 (FREE) |
| Linear API calls/hr | ~720 | ~120 (server polls every 30s) |
| Rally API calls/hr | ~720 | ~30 (server polls every 2min) |
| Frontend HTTP polls/hr (issues) | ~720 | ~60 (fallback only) |
| Dashboard cold load | 3-5s | <100ms (from SQLite) |
| Dashboard restart recovery | Full re-fetch | Instant (SQLite persists) |

## Verification

1. **Rate limit**: After 10 minutes, verify `gh api graphql -f query='{rateLimit(dryRun:true){used remaining resetAt}}'` shows `remaining` near 5000 (PAN-4291: REST `/rate_limit`'s GraphQL bucket does not track this)
2. **Cache persistence**: Start dashboard, see issues, stop, restart — issues appear instantly
3. **Real-time push**: Open dashboard, create GitHub issue in another tab, see it appear within 30s
4. **Backoff**: Artificially set rate limit remaining to 100, verify poll interval increases
5. **Mutation invalidation**: Drag issue in Kanban, verify cache refreshes and socket pushes update
6. **Diagnostics**: Hit `GET /api/cache-status` and verify per-tracker health

## Files

### New
| File | Purpose |
|------|---------|
| `src/dashboard/server/services/cache-service.ts` | SQLite + in-memory two-layer cache |
| `src/dashboard/server/services/issue-data-service.ts` | Background poller, change detection, socket.io push |
| `src/dashboard/server/services/poll-cadence.ts` | Poll intervals and the pure poll-delay math (unchanged + rate-limit backoff, suspension, quota pause) |
| `src/dashboard/server/services/issue-status-mapping.ts` | Raw tracker status → canonical state and display label |
| `src/dashboard/server/services/tracker-config.ts` | Extracted config readers |
| `src/dashboard/frontend/src/hooks/useSocketIssues.ts` | Socket.io client hook |

### Modified
| File | Changes |
|------|---------|
| `src/dashboard/server/index.ts` | Socket.io server, IssueDataService, simplified `/api/issues`, `/api/cache-status`, mutation invalidation |
| `src/dashboard/frontend/src/main.tsx` | QueryClient defaults (staleTime 30s, refetchInterval 60s) |
| `src/dashboard/frontend/src/App.tsx` | `useSocketIssues()` hook |
| `src/dashboard/frontend/src/components/ActivityPanel.tsx` | Poll reduced from 1s to 2s |
| `src/dashboard/frontend/vite.config.ts` | `/socket.io` proxy |
