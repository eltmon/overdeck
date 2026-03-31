# PAN-395: Inspector panel flash of stale action buttons

## Current Status
Implementation complete.

## What Was Done
- Added `reviewStatusLoading` prop to `ActionsSection` component
- When `reviewStatus` is still loading (initial fetch), ActionsSection renders a loading skeleton (3 pulsing gray bars) instead of action buttons
- Extracted `isLoading` from the `useQuery` hook for `reviewStatus` in `InspectorPanel.tsx` and passed it through
- Added test for the loading skeleton state

## Files Changed
- `src/dashboard/frontend/src/components/InspectorPanel.tsx` — extract `isLoading` from reviewStatus query, pass as `reviewStatusLoading` prop
- `src/dashboard/frontend/src/components/inspector/ActionsSection.tsx` — add `reviewStatusLoading` prop to interface, render skeleton when loading
- `src/dashboard/frontend/src/components/inspector/ActionsSection.test.tsx` — add test for loading skeleton

## Remaining Work
None — implementation complete.
