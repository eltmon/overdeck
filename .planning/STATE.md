# PAN-73: Dashboard Issue Search with Command Palette

## Current Status

**Status**: ✅ Implementation Complete - Rebased & Ready for Review

All components have been implemented and verified:
- ✅ Installed cmdk dependency
- ✅ Created useSearch hook with debounced search and relevance scoring
- ✅ Created SearchModal component with filter toggles
- ✅ Created SearchResults component with grouping and external links
- ✅ Integrated search into App.tsx with global '/' keyboard shortcut
- ✅ Build successful with no TypeScript errors
- ✅ Fixed vitest config to exclude Playwright E2E tests
- ✅ Rebased onto main (was 34 commits behind, resolved STATE.md conflict)
- ✅ All 28 unit tests passing after rebase

Ready for test-agent review.

## Summary

Add a search feature to the Panopticon dashboard using the `cmdk` library for a command palette UI. Search will filter issues client-side from the React Query cache, respecting current board filters.

## Decisions Made

### 1. Data Sources
**Decision**: Search all issues displayed on the dashboard (Linear + GitHub + Rally)

The `/api/issues` endpoint already aggregates issues from all configured sources. Search will operate on whatever issues are currently loaded in the TanStack Query cache.

### 2. UI Library
**Decision**: Use `cmdk` library

- Standard command palette UX with built-in keyboard navigation
- Well-maintained, lightweight dependency
- Consistent with MYN's approach

### 3. Search Strategy
**Decision**: Client-side filtering

- Filter issues already in React Query cache
- Instant results, no network latency
- No backend changes needed
- Suitable for typical issue counts (< 1000)

### 4. Result Behavior
**Decision**: Click selects on board + link icon opens external URL

- Clicking a result: closes search modal, highlights the issue card on kanban board
- Link icon: opens issue URL in new tab (Linear/GitHub/Rally)
- Provides both quick navigation and external access

### 5. Search Fields
**Decision**: Title + identifier by default, with toggle for description

- Default: search `title` and `identifier` fields (fast, low noise)
- Optional "Deep search" toggle: also includes `description` field
- Configurable in the search UI

### 6. Filter Scope
**Decision**: Respect current board filters

- Search operates within what's visible on the board
- Honors current cycle, project, and "include completed" filters
- Consistent mental model with the board view

### 7. Search Filters in Command Palette
**Decision**: Source + Status filters

- Source toggle: Linear / GitHub / Rally (show/hide by source)
- Status toggle: show/hide completed issues
- Clean UI, most useful filters without clutter

## Technical Approach

### Files to Create

1. **`src/dashboard/frontend/src/components/search/SearchModal.tsx`**
   - Command palette modal using `cmdk`
   - Keyboard shortcut: `/` to open
   - Filter toggles for source and status
   - "Deep search" toggle for description search

2. **`src/dashboard/frontend/src/components/search/SearchResults.tsx`**
   - Result list with grouping by source
   - Shows: identifier, title, status badge, priority indicator
   - Click handler for board selection
   - External link icon

3. **`src/dashboard/frontend/src/hooks/useSearch.ts`**
   - Custom hook for search logic
   - Filters issues from React Query cache
   - Relevance scoring (identifier match > title match > description match)
   - Debounced input handling

### Files to Modify

1. **`src/dashboard/frontend/src/App.tsx`**
   - Add global keyboard listener for `/` key
   - Render SearchModal component
   - Pass board state (selected issue, filters) to search

2. **`src/dashboard/frontend/package.json`**
   - Add `cmdk` dependency

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `/` | Open search modal (from anywhere) |
| `Esc` | Close search modal |
| `↑`/`↓` | Navigate results |
| `Enter` | Select result (closes modal, highlights on board) |
| `⌘+Enter` | Open external URL in new tab |

### Search Algorithm

1. Get issues from React Query cache (`queryKey: ['issues']`)
2. Apply board filters (cycle, project, completed)
3. Apply search filters (source, status)
4. Text match against title + identifier (+ description if deep search)
5. Score and sort results:
   - Exact identifier match: score 100
   - Identifier starts with query: score 80
   - Title contains query: score 50
   - Description contains query: score 20
6. Return top 20 results

### UI Layout

```
┌─────────────────────────────────────────┐
│ 🔍 Search issues...               [⌘K] │
├─────────────────────────────────────────┤
│ Filters: [Linear] [GitHub] [✓ Open]     │
│          [□ Deep search]                │
├─────────────────────────────────────────┤
│ Linear                                  │
│ ┌─────────────────────────────────────┐ │
│ │ PAN-73  Add issue search to dash   │ │
│ │ Todo • Priority 3           [↗]    │ │
│ └─────────────────────────────────────┘ │
│ ┌─────────────────────────────────────┐ │
│ │ PAN-72  Fix merge detection        │ │
│ │ Done • Priority 2           [↗]    │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ GitHub                                  │
│ ┌─────────────────────────────────────┐ │
│ │ #73  Dashboard search feature      │ │
│ │ Open • Priority 3           [↗]    │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

## Acceptance Criteria

- [ ] `/` opens search modal from anywhere in dashboard
- [ ] Search filters issues by title and identifier
- [ ] "Deep search" toggle includes description in search
- [ ] Results grouped by source (Linear, GitHub, Rally)
- [ ] Results show identifier, title, status, priority
- [ ] Clicking result closes modal and selects issue on board
- [ ] Link icon opens external URL in new tab
- [ ] Source and status filter toggles work correctly
- [ ] Search respects current board filters
- [ ] ESC closes modal
- [ ] Debounced input (no excessive re-renders)
- [ ] Minimum 2 characters before search triggers

## Out of Scope

- Server-side search endpoint (not needed with current data volume)
- Full-text search with ranking algorithms (simple substring matching is sufficient)
- Search history / recent searches
- Saved searches / bookmarks
- Fuzzy matching (may add later if requested)

## Dependencies to Install

```bash
npm install cmdk
```

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Large issue count slows search | React 18's `useDeferredValue` for non-blocking renders |
| cmdk styling conflicts | Use Tailwind classes, override defaults |
| Keyboard shortcut conflicts | `/` is standard; disable when input is focused |
