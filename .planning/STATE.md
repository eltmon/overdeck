# PAN-869: Awaiting Merge lane misses PRs with COMMENTED reviews + green CI

## Status: In Review

## Current Phase
Addressing reviewer feedback - added verificationStatus check to backfill

## Completed Work
- [x] reviewResultToReviewStatus fix: COMMENTED (success=true) → 'passed'
- [x] review-run.ts: pass full ReviewResult to reviewResultToReviewStatus
- [x] Add fixStuckCommentedReviews backfill
- [x] Call fixStuckCommentedReviews on dashboard startup
- [x] Update tests for new function signature
- [x] Fix mapToExitCode to respect success flag for COMMENTED
- [x] Fix backfill to check status='failed' instead of 'commented'
- [x] Add verificationStatus !== 'failed' check to backfill (fixes false-positive risk)

## Remaining Work
- None - waiting for review pipeline

## Key Decisions
- D1: COMMENTED (success=true) = review passed with no blockers → maps to 'passed' so readyForMerge=true
- D2: COMMENTED (success=false) = synthesis/protocol failure → keeps as 'failed' so deacon retries
- D3: Backfill uses status='failed' + testStatus='passed' + verificationStatus!='failed' as signal

## Specialist Feedback
- **[2026-04-27T02:57Z] review-agent → COMMENTED** — correctness reviewer found:
  - `fixStuckCommentedReviews` backfill checked `status: 'commented'` but history stores `'failed'` → DEAD CODE (fixed)
  - `mapToExitCode` returns 2 for all COMMENTED regardless of success → INCONSISTENT (fixed)
- **[2026-04-27T03:12Z] verification-gate → FAILED** — intermittent race condition in effect-patterns.test.ts reading 111 agent state files; re-requested review
- **[2026-04-27T04:06Z] review-agent → COMMENTED** — correctness reviewer found:
  - Backfill could false-positive on verification-failed issues → added verificationStatus !== 'failed' check (fixed)
