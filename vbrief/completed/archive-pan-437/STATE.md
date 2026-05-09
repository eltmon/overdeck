# PAN-437: Instant Dashboard Startup via Persistent Projection Cache

## Status: Planning Complete

## Problem

Dashboard startup has a multi-second delay before data appears. The `IssueDataService.start()` method in `main.ts` awaits all API fetches (GitHub, Linear, Rally) before the server becomes ready, even though `loadCachedData()` already loads stale responses from SQLite L2 cache. The read model bootstrap happens after this blocking wait, so clients see nothing until all API calls complete.

## Decisions

1. **All 3 phases in scope** — cached bootstrap, persistent projection, client-side SWR
2. **Same DB, new table** — `projection_cache` table in `panopticon.db` (alongside events table)
3. **Full state projection** — persist entire DashboardSnapshot (agents, specialists, review statuses, issues), not just issues
4. **Staleness UX** — timestamp display ("Data from 2m ago" -> "Just now") when fresh snapshot arrives
5. **Target: under 200ms** — data visible within 200ms of server ready. Requires both server projection cache AND client localStorage cache.

## Architecture

### Current Flow (Slow)

```
main.ts: await startSharedIssueService()     ← BLOCKS until all API fetches complete (500ms-3s+)
  └─ IssueDataService.start()
     ├─ loadCachedData()                     ← instant (SQLite L2)
     ├─ await Promise.allSettled([           ← THE BOTTLENECK
     │    pollGitHub(),
     │    pollLinear(),
     │    pollRally()
     │  ])
     ├─ pushSnapshot()
     └─ scheduleNext() × 3
Effect server starts
  └─ ReadModelServiceLive bootstrap
     ├─ lazy imports
     ├─ parallel agent enrichment
     ├─ load agents/specialists/review from lib
     ├─ issueService.getIssues()             ← data already fetched, redundant wait
     └─ wire onIssuesChanged listener
Client connects → getSnapshot RPC → render
```

### Target Flow (Instant)

```
main.ts: startSharedIssueService()           ← NO await, fire and forget
Effect server starts
  └─ ReadModelServiceLive bootstrap
     ├─ TRY: load full DashboardSnapshot from projection_cache table  ← NEW
     │   └─ if found: use as initial state, skip lib calls
     ├─ FALLBACK: bootstrap from lib modules (existing path)
     ├─ wire onIssuesChanged listener
     └─ wire projection persistence on every applyEvent  ← NEW
Server ready in <200ms (from projection cache)
Client connects
  ├─ localStorage has cached snapshot? Render immediately  ← NEW (Phase 3)
  ├─ getSnapshot RPC → render (server has projection-cached data)
  └─ timestamp shows "Data from Xm ago"  ← NEW
Background: API fetches complete
  └─ domain events update read model
  └─ projection_cache updated
  └─ client receives incremental updates
  └─ timestamp updates to "Just now"
```

## Phase 1: Non-blocking IssueDataService Start

**Files:** `src/dashboard/server/main.ts`, `src/dashboard/server/services/issue-data-service.ts`

- Remove `await` from `startSharedIssueService()` in main.ts — let it run in background
- Split `IssueDataService.start()`: call `loadCachedData()` synchronously, then fire off API fetches without awaiting
- Call `pushSnapshot()` immediately after `loadCachedData()` (with stale cached data)
- API fetches complete in background → `pushUpdated()` → domain events → incremental client updates
- The `onIssuesChanged` callback in read-model.ts already handles this correctly

**Risk:** First snapshot will have stale issue data. Mitigated by Phase 3 timestamp display.

## Phase 2: Persistent Projection Cache (T3Code Pattern)

**Files:** `src/dashboard/server/event-store.ts` (DB schema), new `src/dashboard/server/services/projection-cache.ts`, `src/dashboard/server/read-model.ts`

### New `projection_cache` Table

```sql
CREATE TABLE IF NOT EXISTS projection_cache (
  key       TEXT PRIMARY KEY,
  data      TEXT NOT NULL,        -- JSON-serialized DashboardSnapshot
  sequence  INTEGER NOT NULL,     -- Last event sequence applied
  updated_at TEXT NOT NULL        -- ISO timestamp
);
```

Single row with `key = 'dashboard'`. Simple key-value pattern — no complex schema.

### ProjectionCacheService

- `load(): DashboardSnapshot | null` — read from SQLite, parse JSON, validate
- `save(snapshot: DashboardSnapshot, sequence: number): void` — serialize and upsert
- Debounced save (100ms) to avoid writing on every event during burst

### Read Model Changes

- On bootstrap: try `projectionCache.load()` first
  - If found and sequence > 0: use as initial state, skip all lib module calls
  - If not found: fall back to existing bootstrap (agents, specialists, review statuses from lib)
- After every `applyEvent()`: debounced `projectionCache.save(state, state.sequence)`
- On `syncSnapshot` (issues changed): also trigger save

### Freshness Tracking

- Store `updated_at` in projection cache
- On load, if `updated_at` is older than 5 minutes, still use it but log warning
- No hard expiry — stale data is better than no data

## Phase 3: Client-Side Stale-While-Revalidate

**Files:** `src/dashboard/frontend/src/lib/store.ts`, `src/dashboard/frontend/src/components/EventRouter.tsx`, new `src/dashboard/frontend/src/lib/snapshotCache.ts`, `src/dashboard/frontend/src/components/FreshnessIndicator.tsx`

### localStorage Snapshot Cache

- On every `syncSnapshot()`: serialize and save to `localStorage.setItem('pan-snapshot-cache', JSON.stringify({data, timestamp}))`
- On page load (before WebSocket connects): check localStorage for cached snapshot
- If found: call `store.syncSnapshot(cached)` immediately → UI renders with stale data
- Size limit: truncate if > 2MB (strip `agentOutputById` and `recentActivity` first)

### Freshness Indicator Component

- Small component in header area showing data freshness
- States:
  - "Data from 2m ago" (stale, from cache) — subtle muted text
  - "Updating..." (WebSocket connected, waiting for fresh snapshot) — subtle pulse
  - "Just now" (fresh data received) — fades away after 5 seconds
- Uses the snapshot `timestamp` field to compute staleness
- Positioned in header bar, non-intrusive

### EventRouter Changes

- On mount: check localStorage cache, render immediately if available
- Still connect to WebSocket and fetch fresh snapshot
- When fresh snapshot arrives: update store, update localStorage cache, update timestamp
- `bootstrapComplete` set to `true` from either localStorage cache OR fresh snapshot (whichever comes first)

## Files Changed (Summary)

| File | Change | Phase |
|------|--------|-------|
| `src/dashboard/server/main.ts` | Remove `await` from startSharedIssueService | 1 |
| `src/dashboard/server/services/issue-data-service.ts` | Split start() — cache first, fetch background | 1 |
| `src/dashboard/server/event-store.ts` | Add projection_cache table to DB schema | 2 |
| `src/dashboard/server/services/projection-cache.ts` | **NEW** — ProjectionCacheService | 2 |
| `src/dashboard/server/read-model.ts` | Bootstrap from projection cache, persist on event | 2 |
| `src/dashboard/frontend/src/lib/snapshotCache.ts` | **NEW** — localStorage cache helpers | 3 |
| `src/dashboard/frontend/src/components/EventRouter.tsx` | Load from localStorage on mount | 3 |
| `src/dashboard/frontend/src/lib/store.ts` | Save to localStorage on syncSnapshot | 3 |
| `src/dashboard/frontend/src/components/FreshnessIndicator.tsx` | **NEW** — timestamp display | 3 |
| `src/dashboard/frontend/src/components/Header.tsx` (or equivalent) | Add FreshnessIndicator | 3 |

## Edge Cases

- **Empty projection cache** (first boot): falls back to existing bootstrap path, slightly slower first time
- **Corrupted projection cache**: catch JSON parse errors, fall back to lib bootstrap, overwrite on next save
- **Stale localStorage** (old schema): version the cache key (`pan-snapshot-cache-v1`), ignore mismatched versions
- **Large localStorage**: strip output buffers before caching, enforce 2MB cap
- **Race condition** (localStorage render + WebSocket snapshot): second syncSnapshot overwrites first cleanly, React re-renders
- **Projection sequence drift**: if event store sequence > projection sequence, replay missing events on top of cached state

## Out of Scope

- IndexedDB (localStorage is sufficient for a single snapshot)
- Service workers / offline mode
- Projection cache for workspace detail views (only dashboard snapshot)
- Multi-tab coordination (each tab manages its own cache independently)

## Specialist Feedback

- **[2026-04-04T20:45Z] verification-gate → FAILED** — `.planning/feedback/001-verification-gate-failed.md`
- **[2026-04-04T20:54Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/002-review-agent-changes-requested.md`
- **[2026-04-04T21:06Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/003-review-agent-changes-requested.md`
