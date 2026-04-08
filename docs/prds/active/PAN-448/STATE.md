# PAN-448: Start Agent confirmation timeout too short

## Status: Planning Complete

## Problem
The "Start Agent" button uses a timeout-based two-click confirm pattern. The timeout (currently 7s after being bumped from 6s) races against the user — the button reverts before they can click "Confirm". Increasing the timeout is a bandaid; the root issue is the time-based dismiss.

## Decision
Replace the `setTimeout` auto-reset with a proper dismiss pattern:
- Confirmation stays visible indefinitely until explicitly dismissed
- Dismiss triggers: click outside the button, press Escape
- Follows existing pattern in `ContainerSection.tsx:38-44` (mousedown + ref)

## Scope
- **Single file**: `src/dashboard/frontend/src/components/KanbanBoard.tsx`
- Remove `confirmingStartTimer` ref and `setTimeout` call
- Add a `startButtonRef` to the confirm button
- Add `useEffect` with `mousedown` (click-outside) and `keydown` (Escape) listeners when `confirmingStart` is true
- Clean up timer ref on unmount (existing) → replace with effect cleanup

## Out of Scope
- Other confirm patterns in the dashboard (deep-wipe has its own modal)
- Adding a dismiss timeout as a fallback
- Changing the visual appearance of the confirm state

## Acceptance Criteria
1. Clicking "Start Agent" shows "Click to confirm" — it stays visible indefinitely
2. Clicking the button again triggers the agent start
3. Clicking anywhere outside the button dismisses the confirm state
4. Pressing Escape dismisses the confirm state
5. No `setTimeout` in the confirm flow
