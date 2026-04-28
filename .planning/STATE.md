# PAN-905: Command Deck — Make Awaiting Merge the Canonical Final Merge Gate

## Status: Complete

## Current Phase
All frontend and backend work for PAN-905 is finished. The Awaiting Merge page is now the canonical final merge gate.

## Completed Work
- [x] pan-l4wu: Add blockerReasons[] column to review_status SQLite schema (commit: bcb7f958)
- [x] pan-91h1: Enrich readyForMerge to incorporate blockerReasons (commit: 5fcd1167)
- [x] pan-zg92: Add POST /api/webhooks/github route with HMAC-SHA256 verification (commit: 57b86e20)
- [x] pan-4c7b: Update frontend ReviewStatusData type to include blockerReasons and new fields (commit: 2f430c3c)
- [x] Fixed inverted bead dependencies in beads database (all 17 deps reversed)
- [x] pan-vwrn: Add smee-client dependency and process management
- [x] pan-ygsc: Implement check_suite and check_run webhook event handlers
- [x] pan-umby: Implement pull_request webhook event handler
- [x] pan-kjni: Implement pull_request_review and review_thread webhook handlers
- [x] pan-ktn2: Integrate smee-client lifecycle into pan up / pan down
- [x] pan-vb4m: Update GitHub App manifest and create migration script for existing installs
- [x] pan-267t: Add 4th Merge step to pipeline stepper in ReviewPipelineSection
- [x] pan-2tfi: Show individual CI check sub-statuses in the Merge step
- [x] pan-0pe6: Show mergeRetryCount and mergeNotes in the Merge step
- [x] pan-cpp7: Show merge queue position in the pipeline stepper
- [x] pan-3uwo: Add live specialist log link during active merge phase
- [x] pan-fxfx: Rewrite Awaiting Merge filtering to exclude blocked issues
- [x] pan-o32r: Surface exact GitHub-native blockers on Awaiting Merge page
- [x] pan-8wl8: Document Panopticon product vision in project docs

## Key Decisions
- Bead dependencies were inverted in the beads database (all dependencies pointing backwards). Fixed by removing all incorrect deps and re-adding per vBRIEF plan edges.
- Prop drilling for `onViewMergeLog` was chosen over context because `ReviewPipelineSection` is deeply nested inside `ActionsSection` → `InspectorPanel` → `DetailPanelLayout`, and the callback only makes sense at the layout level where terminal state lives.
- Explicit `blockerReasons` filtering in `selectAwaitingMerge` and `AwaitingMergePage` provides defense-in-depth: even if `readyForMerge` normalization on the server has a bug, the frontend will never show blocked issues in the merge queue.

## Specialist Feedback
- All feedback files in `.planning/feedback/` are for PAN-854 (approved issue), not PAN-905. No actionable feedback for PAN-905.
- **[2026-04-28T18:29Z] verification-gate → FAILED** — `.planning/feedback/008-verification-gate-failed.md`
- **[2026-04-28T18:31Z] verification-gate → FAILED** — `.planning/feedback/009-verification-gate-failed.md`
- **[2026-04-28T19:05Z] review-agent → COMMENTED** — `.planning/feedback/010-review-agent-commented.md`
- **[2026-04-28T19:26Z] verification-gate → FAILED** — `.planning/feedback/011-verification-gate-failed.md`
- **[2026-04-28T20:16Z] review-agent → COMMENTED** — `.planning/feedback/012-review-agent-commented.md`
- **[2026-04-28T22:33Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/013-review-agent-changes-requested.md`
- **[2026-04-28T23:10Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/014-review-agent-changes-requested.md`
- **[2026-04-28T23:39Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/015-review-agent-changes-requested.md`
