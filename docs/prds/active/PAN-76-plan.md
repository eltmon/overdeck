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

## Acceptance Criteria

- [ ] Done column only shows items completed in last 24 hours
- [ ] Count badge reflects filtered count (automatic - uses grouped array length)
- [ ] GitHub fetch optimized to only get recently closed issues
- [ ] README documents the filtering behavior
- [ ] Canceled items follow same 24h filter

## Testing Notes

To verify:
1. Check the Done column count matches actual visible items
2. Complete an issue, verify it appears in Done
3. Wait 24+ hours (or adjust filter temporarily), verify it disappears
4. Check network tab - GitHub fetch should have date filter in search query
