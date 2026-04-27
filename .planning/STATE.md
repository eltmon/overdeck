# PAN-846: Reviewer and specialist tmux sessions leak after completion (RAM accumulation)

## Status: Implementation Complete

## Current Phase
All beads implemented. Running final quality gates before calling pan done.

## Completed Work
- [x] pan-rnrs: Add reviewer session cleanup in runParallelReview finally block (commit: 61a1d09f)
- [x] pan-utvf: Add specialist tmux session cleanup after completion signaling (commit: d7839034)
- [x] pan-gbwm: Add deacon janitor for orphan reviewer/specialist sessions (commit: a3a85e7a)
- [x] pan-j98b: Integration test asserting reviewer sessions don't outlive runParallelReview (commit: 48da097b)

## Remaining Work
(none)

## Key Decisions
- Reviewer sessions are killed when runParallelReview finishes (via finally block). Next dispatch spawns fresh sessions.
- Specialist sessions are killed in /api/specialists/done after setting state to idle.
- The deacon janitor is a safety net for crashes where cleanup didn't run.

## Specialist Feedback
- **[2026-04-26T19:03Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/001-review-agent-changes-requested.md`
  - Fixed: narrowed `isSpecialist` prefix match to avoid killing unrelated sessions
  - Fixed: added NaN guard on `parseInt(session_created)`
  - Fixed: replaced redundant `sessionExistsAsync` with Set membership check
  - Fixed: parallelized `killAllReviewerSessions` with `Promise.all`
- **[2026-04-27T06:45Z] review-agent → APPROVED** — `.planning/feedback/001-review-agent-approved.md`
- **[2026-04-27T06:45Z] review-agent → COMMENTED** — `.planning/feedback/002-review-agent-commented.md`
