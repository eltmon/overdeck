# PAN-869: Awaiting Merge lane misses PRs with COMMENTED reviews + green CI

## Status: Merged (PR #870), follow-up in PR #876

## Summary
- PAN-869 PR #870 was merged to main
- Follow-up fix (verificationStatus check) is in PR #876

## Completed Work
- [x] reviewResultToReviewStatus fix: COMMENTED (success=true) → 'passed'
- [x] review-run.ts: pass full ReviewResult to reviewResultToReviewStatus
- [x] Add fixStuckCommentedReviews backfill
- [x] Call fixStuckCommentedReviews on dashboard startup
- [x] Update tests for new function signature
- [x] Fix mapToExitCode to respect success flag for COMMENTED
- [x] Fix backfill to check status='failed' instead of 'commented'
- [x] Add verificationStatus !== 'failed' check to backfill

## Follow-up
- PR #876: fix backfill false-positive on verification-failed issues (already committed on feature/pan-869)
