# PAN-905: Command Deck — Make Awaiting Merge the Canonical Final Merge Gate

## Status: In Progress

## Current Phase
Implementation in progress. Completed pan-l4wu (schema) and pan-91h1 (readyForMerge enrichment). Next up: pan-zg92 (webhook route), pan-vwrn (smee client), pan-4c7b (frontend types), pan-vb4m (GitHub app manifest), or pan-8wl8 (vision doc).

## Completed Work
- [x] pan-l4wu: Add blockerReasons[] column to review_status SQLite schema (commit: bcb7f958)
- [x] pan-91h1: Enrich readyForMerge to incorporate blockerReasons (commit: 5fcd1167)
- [x] Fixed inverted bead dependencies in beads database (all 17 deps reversed)

## Remaining Work
- [ ] pan-zg92: Add POST /api/webhooks/github route with HMAC-SHA256 verification
- [ ] pan-ygsc: Implement check_suite and check_run webhook event handlers
- [ ] pan-umby: Implement pull_request webhook event handler
- [ ] pan-kjni: Implement pull_request_review and review_thread webhook handlers
- [ ] pan-vwrn: Add smee-client dependency and process management
- [ ] pan-ktn2: Integrate smee-client lifecycle into pan up / pan down
- [ ] pan-vb4m: Update GitHub App manifest and create migration script for existing installs
- [ ] pan-267t: Add 4th Merge step to pipeline stepper in ReviewPipelineSection
- [ ] pan-2tfi: Show individual CI check sub-statuses in the Merge step
- [ ] pan-0pe6: Show mergeRetryCount and mergeNotes in the Merge step
- [ ] pan-cpp7: Show merge queue position in the pipeline stepper
- [ ] pan-3uwo: Add live specialist log link during active merge phase
- [ ] pan-fxfx: Rewrite Awaiting Merge filtering to exclude blocked issues
- [ ] pan-o32r: Surface exact GitHub-native blockers on Awaiting Merge page
- [ ] pan-4c7b: Update frontend ReviewStatusData type to include blockerReasons and new fields
- [ ] pan-8wl8: Document Panopticon product vision in project docs

## Key Decisions
- Bead dependencies were inverted in the beads database (all dependencies pointing backwards). Fixed by removing all incorrect deps and re-adding per vBRIEF plan edges.

## Specialist Feedback
- All feedback files in `.planning/feedback/` are for PAN-854 (approved issue), not PAN-905. No actionable feedback for PAN-905.
