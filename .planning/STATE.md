# PAN-511: Cloister stops mid-dispatch leaving reviewStatus: reviewing with no task created

## Status: Implementation Complete

## Current Phase
All beads complete — running tests and finalizing

## Completed Work
- [x] feature-pan-489-6t6: Fix atomicity — set reviewStatus=reviewing only after specialist dispatch in /review and /request-review routes (commit: 4e637b79)
- [x] feature-pan-489-d8c: Startup recovery — re-dispatch orphaned reviewStatus=reviewing issues on Cloister start (commit: efb84d19)
- [x] feature-pan-489-1nf: Fix stale specialist state — handle active-but-not-running specialist in spawnEphemeralSpecialist + startup cleanup (commit: 1993e105)

## Remaining Work
(none)

## Key Decisions
- D1: In /review route, the initial reviewReset uses 'pending' not 'reviewing'; 'reviewing' is set in the background task after successful dispatch or queuing.
- D2: In /request-review route, same pattern — 'pending' initially, 'reviewing' after dispatch/queue.
- D3: All three issue root causes must be fixed: atomicity + startup recovery + stale state detection.
- D4: Startup cleanup now also handles state='active' specialists that aren't actually running (crash recovery), not just idle ones.

## Specialist Feedback
(none yet)
- **[2026-04-07T04:40Z] verification-gate → FAILED** — `.planning/feedback/001-verification-gate-failed.md`
