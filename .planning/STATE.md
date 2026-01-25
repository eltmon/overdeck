# PAN-76: Done Column Time Filtering

**✅ COMPLETE** - All implementation tasks finished and committed.

The Done column in the Kanban board shows all completed issues, creating visual clutter. Old completed items aren't relevant to current work.

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Filter location | Server-side | More efficient, also allows GitHub fetch optimization |
| Time window | Fixed 24 hours | Simplicity - no UI controls needed |
| Canceled items | Same 24h filter | Consistent treatment with done items |
| GitHub fetch | Last 24h only | Don't fetch ancient closed issues from GitHub |
| User controls | None | Keep it simple - 24h default, no settings |

## Changes Made

1. ✅ Added `completedAt?: string` field to Issue interface (types.ts:25)
2. ✅ Added `completedAt` to Linear GraphQL query (server/index.ts:1083)
3. ✅ Optimized GitHub fetch to only get issues closed in last 24 hours (server/index.ts:860-870)
4. ✅ Added `completedAt` mapping from GitHub's closedAt field (server/index.ts:934)
5. ✅ Implemented server-side filtering to exclude done/canceled items older than 24h (server/index.ts:1200-1220)
6. ✅ Documented filtering behavior in README.md (README.md:929-937)

## Code Review Fixes

1. ✅ Extracted `getOneDayAgo()` helper function to eliminate code duplication
2. ✅ Fixed type safety: replaced `any` with `Issue` type in filter logic
3. ✅ Added comprehensive tests for 24-hour filtering logic (12 tests)
4. ✅ Added tests for completedAt field handling (9 tests)

## Acceptance Criteria

- [x] Done column only shows items completed in last 24 hours
- [x] Count badge reflects filtered count
- [x] GitHub fetch optimized to only get recently closed issues
- [x] README documents the filtering behavior
- [x] Canceled items follow same 24h filter
