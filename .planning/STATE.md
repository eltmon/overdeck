# PAN-869: Awaiting Merge lane misses PRs with COMMENTED reviews + green CI

## Status: Ready for Merge

## Current Phase
Fixing review issues found by correctness reviewer, then re-submitting

## Completed Work
- [x] reviewResultToReviewStatus fix: COMMENTED (success=true) → 'passed' (commit: 76b35b0a)
- [x] review-run.ts: pass full ReviewResult to reviewResultToReviewStatus (commit: 76b35b0a)
- [x] Add fixStuckCommentedReviews backfill (commit: 76b35b0a)
- [x] Call fixStuckCommentedReviews on dashboard startup (commit: 76b35b0a)
- [x] Update tests for new function signature (commit: 76b35b0a)
- [x] Fix mapToExitCode to respect success flag for COMMENTED (commit: TBD)
- [x] Fix backfill to check status='failed' instead of 'commented' (commit: TBD)

## Remaining Work
- Commit fixes, push, re-submit

## Key Decisions
- D1: COMMENTED (success=true) = review passed with no blockers → maps to 'passed' so readyForMerge=true
- D2: COMMENTED (success=false) = synthesis/protocol failure → keeps as 'failed' so deacon retries
- D3: Backfill uses status='failed' + testStatus='passed' as signal (old COMMENTED was stored as 'failed')

## Specialist Feedback
- **[2026-04-27T02:57Z] review-agent → COMMENTED** — correctness reviewer found:
  - `fixStuckCommentedReviews` backfill checked `status: 'commented'` but history stores `'failed'` → DEAD CODE (fixed)
  - `mapToExitCode` returns 2 for all COMMENTED regardless of success → INCONSISTENT (fixed)
