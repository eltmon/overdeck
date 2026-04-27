# PAN-869: Awaiting Merge lane misses PRs with COMMENTED reviews + green CI

## Status: Ready for Merge

## Current Phase
Work complete - commits pushed, GitHub PR created

## Completed Work
- [x] fix reviewResultToReviewStatus in review-agent.ts to return 'passed' for COMMENTED when success=true (commit: 76b35b0a)
- [x] Update review-run.ts to pass full ReviewResult object instead of just reviewResult string (commit: 76b35b0a)
- [x] Add backfill function fixStuckCommentedReviews in review-status.ts to fix existing stuck COMMENTED records (commit: 76b35b0a)
- [x] Call fixStuckCommentedReviews on dashboard startup in main.ts (commit: 76b35b0a)
- [x] Update tests in review-agent.test.ts to use new function signature (commit: 76b35b0a)

## Remaining Work
- None - waiting for review approval

## Key Decisions
- D1: COMMENTED (success=true) = review passed with no blockers → maps to 'passed' so readyForMerge=true
- D2: COMMENTED (success=false) = synthesis/protocol failure → keeps as 'failed' so deacon retries
- D3: Backfill conservative approach: only fix records where last review history entry is 'commented' type

## Specialist Feedback
- (none yet)
