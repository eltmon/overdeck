# PAN-859: Command Deck: clicking work-agent row in tree doesn't show terminal pane until second click

## Status: Implementation Complete

## Current Phase
Resubmitting PAN-859 after tightening the CommandDeck regression tests per review feedback.

## Completed Work
- [x] context-recovery: Recovered PAN-859 requirements from GitHub because `.planning/` artifacts were missing at workspace start (commit: pending)
- [x] selection-fix: Updated `src/dashboard/frontend/src/components/CommandDeck/index.tsx` so session-pane selection subscribes to `selectedSessionByIssue` directly instead of using a selector closed over `selectedFeature` (commit: pending)
- [x] regression-test: Added a regression test in `src/dashboard/frontend/src/components/CommandDeck/CommandDeck.test.tsx` covering the first session click when no feature is already selected (commit: pending)
- [x] focused-tests: Ran `npm test -- --run src/dashboard/frontend/src/components/CommandDeck/CommandDeck.test.tsx src/dashboard/frontend/src/components/CommandDeck/__tests__/IssueWorkbench.test.tsx src/dashboard/frontend/src/components/CommandDeck/ProjectTree/FeatureItem.test.tsx` and got 31 passing tests across 3 files (commit: pending)
- [x] playwright-pan-859: Verified in Playwright that clicking the PAN-859 work-agent row opens the agent pane on the first click and that a second click is idempotent; screenshot saved as `pan-859-first-click.png` (commit: pending)
- [x] review-nit: Removed the duplicate Google Fonts Material Symbols stylesheet include from `docs/design/mockups/command-deck-terminology-map.html` per approved review feedback (commit: pending)
- [x] test-hardening: Reset the CommandDeck selection store in `beforeEach` and added an explicit second-click idempotency regression test in `CommandDeck.test.tsx` (commit: pending)

## Remaining Work
- [x] cross-session-verification: Verified the same first-click session-row behavior on PAN-855's work session in the live tree; screenshot saved as `pan-859-cross-session-verification.png` (commit: pending)
- [x] final-quality-gates: Passed `npm run typecheck`, `npm run lint`, and `npm test` (327 files / 3983 tests passed, 4 files / 48 tests skipped) (commit: pending)
- [x] commit-and-finish: Committed the PAN-859 changes, pushed `feature/pan-859`, and ran the issue completion flow with `pan done PAN-859` (commit: 0db98231)

## Key Decisions
- Subscribe to the full `selectedSessionByIssue` map in `CommandDeck/index.tsx` instead of selecting through a closure over `selectedFeature`; this addresses the root cause where feature selection and session selection changed in the same click but the component did not reliably observe the session-slice update.
- Added the regression at the CommandDeck integration level rather than only in store tests because the bug was in the React subscription/render path, not the pure selection helper.

## Specialist Feedback
- [2026-04-27T21:31:00Z] Playwright verification → passed — `pan-859-first-click.png`
- [2026-04-27T21:35:00Z] Playwright cross-session verification → passed — `pan-859-cross-session-verification.png`
- **[2026-04-27T21:45Z] review-agent → APPROVED** — `.planning/feedback/001-review-agent-approved.md`
- **[2026-04-27T21:45Z] review-agent → COMMENTED** — `.planning/feedback/002-review-agent-commented.md`
- **[2026-04-27T21:54Z] review-agent → APPROVED** — `.planning/feedback/001-review-agent-approved.md`
- **[2026-04-27T21:54Z] review-agent → COMMENTED** — `.planning/feedback/002-review-agent-commented.md`
- **[2026-04-27T22:02Z] review-agent → APPROVED** — `.planning/feedback/001-review-agent-approved.md`
- **[2026-04-27T22:02Z] review-agent → COMMENTED** — `.planning/feedback/002-review-agent-commented.md`
- **[2026-04-27T22:08Z] review-agent → APPROVED** — `.planning/feedback/003-review-agent-approved.md`
- **[2026-04-27T22:15Z] review-agent → APPROVED** — `.planning/feedback/004-review-agent-approved.md`
- **[2026-04-27T22:15Z] review-agent → COMMENTED** — `.planning/feedback/005-review-agent-commented.md`
- **[2026-04-27T22:46Z] review-agent → APPROVED** — `.planning/feedback/006-review-agent-approved.md`
- **[2026-04-27T22:46Z] review-agent → APPROVED** — `.planning/feedback/006-review-agent-approved.md`
- **[2026-04-27T22:52Z] review-agent → APPROVED** — `.planning/feedback/007-review-agent-approved.md`
