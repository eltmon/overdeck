# PAN-866: Zone C-2: markdown / activity / costs / PR-diff / discussions tabs

## Status: Verification in progress

## Current Phase
Finishing review-driven fixes, rerunning focused tests, and validating the Zone C overview UI before re-submitting.

## Completed Work
- [x] Activity tab now reuses the existing `ActivityFeed` component.
- [x] Costs tab now uses the existing `useIssueCostStream` hook while preserving issue cost breakdowns.
- [x] Added explicit workspace markdown endpoints for `STATE.md` and `INFERENCE.md`.
- [x] Fixed specialist-context test mocking so stderr-warning cases return a digest correctly.
- [x] Made specialist handoff log parsing skip corrupted JSON lines and updated its test.

## Remaining Work
- [ ] Run final UI verification for Zone C tabs in the browser.
- [ ] Commit implementation changes.
- [ ] Invoke `/rebase-and-submit` for PAN-866.

## Key Decisions
- Reused existing dashboard components/hooks instead of introducing parallel implementations.
- Kept live cost streaming and aggregate issue-cost breakdowns together in the Costs tab.
- Added dedicated workspace markdown endpoints in `workspaces.ts` rather than overloading unrelated command-deck routes.

## Specialist Feedback
- **[2026-04-27T07:25Z] verification-gate → FAILED** — `.planning/feedback/001-verification-gate-failed.md`
  - Fixed the failing targeted tests and reran them locally.
- **[2026-04-27T07:29Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/002-review-agent-changes-requested.md`
  - Fixed the stale PAN-846 STATE header and completed the missing PAN-866 implementation changes in this workspace.
- **[2026-04-27T09:17Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/001-review-agent-changes-requested.md`
- **[2026-04-27T09:18Z] review-agent → COMMENTED** — `.planning/feedback/002-review-agent-commented.md`
- **[2026-04-27T09:29Z] verification-gate → FAILED** — `.planning/feedback/001-verification-gate-failed.md`
