# PAN-493: Cloister restart leaves verificationStatus stuck in 'running'

## Status: Implementation Complete

## Current Phase
Complete — fix committed and pushed.

## Completed Work
- [x] panopticon-o2g: Added orphaned verificationStatus cleanup on Cloister startup — resets 'running' → 'pending' for all stale states (commit: TBD)

## Remaining Work
None

## Key Decisions
- D1: Added cleanup in `start()` after DB initialization but before specialists/deacon — ensures DB is ready before reading review statuses
- D2: Wrapped in try/catch so a DB error at startup doesn't prevent Cloister from starting
- D3: Used existing `loadReviewStatuses()` + `setReviewStatus()` rather than direct DB access — preserves dual-write behavior (SQLite + JSON)

## Specialist Feedback
None yet
