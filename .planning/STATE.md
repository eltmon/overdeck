# PAN-76: Done Column Time Filtering

## Problem Statement

The Done column in the Kanban board shows all completed issues, creating visual clutter. Old completed items aren't relevant to current work.

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Filter location | Server-side | More efficient, also allows GitHub fetch optimization |
| Time window | Fixed 24 hours | Simplicity - no UI controls needed |
| Canceled items | Same 24h filter | Consistent treatment with done items |
| GitHub fetch | Last 24h only | Don't fetch ancient closed issues from GitHub |
| User controls | None | Keep it simple - 24h default, no settings |

## Technical Approach

### 1. Add `completedAt` Field to Issue Type

**Frontend** (`src/dashboard/frontend/src/types.ts`):
```typescript
export interface Issue {
  // ... existing fields
  completedAt?: string;  // NEW: ISO timestamp when issue was completed
}
```

### 2. Update Linear GraphQL Query

**Server** (`src/dashboard/server/index.ts`):
- Add `completedAt` to the GraphQL query
- Linear provides this field natively

### 3. Update GitHub Issue Fetching

**Server** (`src/dashboard/server/index.ts`):
- Add `--search` filter to `gh issue list` to only fetch recently closed
- Map `closedAt` field to `completedAt`
- Use GitHub's search syntax: `closed:>=2024-01-22` (24h ago)

### 4. Filter Completed Issues Server-Side

**Server** (`src/dashboard/server/index.ts`):
- When formatting issues, filter out done/canceled items older than 24h
- Apply to both Linear and GitHub issues
- The `includeCompleted` param already exists; this adds the time filter

### 5. Update README Documentation

**README.md** - Add to Dashboard section:
- Linear shows current cycle issues only
- Done column shows items completed in last 24 hours
- This applies to both Linear and GitHub issues

## Files to Modify

| File | Changes |
|------|---------|
| `src/dashboard/frontend/src/types.ts` | Add `completedAt?: string` to Issue interface |
| `src/dashboard/server/index.ts` | 1. Add `completedAt` to Linear GraphQL<br>2. Optimize GitHub fetch to last 24h<br>3. Filter done items by completedAt |
| `README.md` | Document issue filtering behavior |

## Out of Scope

- UI controls for changing time window
- localStorage persistence of preferences
- Different treatment for canceled vs done
- Rally integration (follows same pattern if needed later)

## Current Status

**COMPLETED** - All changes implemented, code review feedback addressed, tests added.

### Changes Made

1. ✅ Added `completedAt?: string` field to Issue interface (types.ts:25)
2. ✅ Added `completedAt` to Linear GraphQL query (server/index.ts:1083)
3. ✅ Optimized GitHub fetch to only get issues closed in last 24 hours (server/index.ts:860-870)
4. ✅ Added `completedAt` mapping from GitHub's closedAt field (server/index.ts:934)
5. ✅ Implemented server-side filtering to exclude done/canceled items older than 24h (server/index.ts:1200-1220)
6. ✅ Documented filtering behavior in README.md (README.md:929-937)

### Code Review Fixes (Round 2)

1. ✅ Extracted `getOneDayAgo()` helper function to eliminate code duplication (server/index.ts:33-37)
2. ✅ Fixed type safety: replaced `any` with `Issue` type in filter logic (server/index.ts:1210)
3. ✅ Added comprehensive tests for 24-hour filtering logic (tests/dashboard/issue-filtering.test.ts)
   - 12 tests covering all edge cases: active issues, recent/old done, recent/old canceled, missing completedAt
4. ✅ Added tests for completedAt field handling (tests/dashboard/completedAt-field.test.ts)
   - 9 tests covering Linear/GitHub mapping, missing values, date parsing

## Acceptance Criteria

- [x] Done column only shows items completed in last 24 hours
- [x] Count badge reflects filtered count (automatic - uses grouped array length)
- [x] GitHub fetch optimized to only get recently closed issues
- [x] README documents the filtering behavior
- [x] Canceled items follow same 24h filter

## Testing Notes

To verify:
1. Check the Done column count matches actual visible items
2. Complete an issue, verify it appears in Done
3. Wait 24+ hours (or adjust filter temporarily), verify it disappears
4. Check network tab - GitHub fetch should have date filter in search query

**Ready for:** Testing, commit, and merge.
