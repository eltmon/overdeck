# PAN-511: Cloister stops mid-dispatch leaving reviewStatus: reviewing with no task created

## Status: In Progress

## Current Phase
Implementing bead feature-pan-489-6t6 (fix atomicity: reviewStatus=reviewing only after dispatch)

## Completed Work
(none yet — first bead in progress)

## Remaining Work
- [ ] feature-pan-489-6t6: Fix atomicity — set reviewStatus=reviewing only after specialist dispatch in /review and /request-review routes
- [ ] feature-pan-489-d8c: Add startup recovery — re-dispatch orphaned reviewStatus=reviewing issues on Cloister start
- [ ] feature-pan-489-1nf: Fix stale specialist state — handle active-but-not-running specialist in spawnEphemeralSpecialist

## Key Decisions
- D1: In /review route, the initial reviewReset uses 'pending' not 'reviewing'; 'reviewing' is set in the background task after successful dispatch or queuing.
- D2: In /request-review route, same pattern — 'pending' initially, 'reviewing' after dispatch/queue.
- D3: All three issue root causes must be fixed: atomicity + startup recovery + stale state detection.

## Specialist Feedback
(none yet)
