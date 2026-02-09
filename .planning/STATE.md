# PAN-128: Add timestamps to specialist status reports

## Issue Summary

Add relative timestamps next to review/test status in the dashboard, highlight stale status, and store status transition history.

**Issue URL:** https://github.com/eltmon/panopticon-cli/issues/128
**Branch:** feature/pan-128

---

## Current Status

### Implementation: COMPLETE

All acceptance criteria implemented and tested:

### 1. Backend: Status History Tracking ✅
- Extracted review-status logic into `src/dashboard/server/review-status.ts` (testable module)
- Added `StatusHistoryEntry` interface: `{ type, status, timestamp, notes? }`
- Added `history` field to `ReviewStatus` interface (last 10 entries)
- `setReviewStatus()` detects review/test/merge status changes and appends to history
- History capped at 10 entries (oldest removed when exceeded)
- Notes included in history entries when provided

### 2. Frontend: Timestamps & Stale Warnings ✅
- Added `formatRelativeTime()` helper: "just now", "3m ago", "2h ago", "1d ago"
- Added `isStale()` helper (>30 min threshold)
- Review/test status lines now show relative timestamps ("3m ago")
- Stale status (>30 min) highlighted with amber border and warning icon
- Warning text: "Status may be stale (45m ago)"

### 3. Frontend: Status History Panel ✅
- Added `StatusHistory` component with expandable toggle
- Shows "▸ History (N)" that expands to show all transitions
- Each entry shows: relative time, type (review/test/merge), status, notes preview
- Color-coded: review=blue, test=purple, merge=green; status colors match pass/fail
- Most recent entries shown first

### 4. Interface Consistency ✅
- Updated `ReviewStatus` interface in all locations:
  - `src/dashboard/server/review-status.ts` (canonical)
  - `src/dashboard/server/index.ts` (imports from module)
  - `src/dashboard/frontend/src/components/WorkspacePanel.tsx`
  - `src/cli/commands/specialists/done.ts`

### Files Changed
- `src/dashboard/server/review-status.ts` — NEW: Extracted review-status module (testable)
- `src/dashboard/server/index.ts` — Refactored to import from review-status module
- `src/dashboard/frontend/src/components/WorkspacePanel.tsx` — Timestamps, stale warnings, history panel
- `src/cli/commands/specialists/done.ts` — Updated interface with history field
- `tests/dashboard/review-status.test.ts` — NEW: 15 tests (all passing)

### Test Results
- 15 new tests: ALL PASSING
- Full suite: 17 pre-existing failures (same as main), 0 new failures
- TypeScript: clean compilation

---

## Remaining Work

None - All acceptance criteria implemented and tested.
