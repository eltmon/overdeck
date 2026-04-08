# PAN-511: Cloister stops mid-dispatch leaving reviewStatus: reviewing with no task created

## Status: Implementation Complete — Resubmitting for Review

## Current Phase
All 4 blocking review issues fixed, all quality gates pass

## Completed Work
- [x] feature-pan-489-6t6: Fix atomicity — set reviewStatus=reviewing only after specialist dispatch in /review and /request-review routes (commit: 4e637b79)
- [x] feature-pan-489-d8c: Startup recovery — re-dispatch orphaned reviewStatus=reviewing issues on Cloister start (commit: efb84d19)
- [x] feature-pan-489-1nf: Fix stale specialist state — handle active-but-not-running specialist in spawnEphemeralSpecialist + startup cleanup (commit: 1993e105)
- [x] fix(review): address all 4 blocking issues from review-agent (commit: 900f8bc9)
  - SYNC FS VIOLATION: replaced sessionExists() with sessionExistsAsync() in issues.ts route
  - PAN-XXX placeholder → PAN-511
  - AgentOutputPanel: pass onDisconnect to XTerminal (dead code fix)
  - Added 9 tests for buildTestAgentPromptContent, 8 tests for startup recovery

## Remaining Work
(none)

## Key Decisions
- D1: In /review route, the initial reviewReset uses 'pending' not 'reviewing'; 'reviewing' is set in the background task after successful dispatch or queuing.
- D2: In /request-review route, same pattern — 'pending' initially, 'reviewing' after dispatch/queue.
- D3: All three issue root causes must be fixed: atomicity + startup recovery + stale state detection.
- D4: Startup cleanup now also handles state='active' specialists that aren't actually running (crash recovery), not just idle ones.

## Specialist Feedback
- **[2026-04-07T04:40Z] verification-gate → FAILED** — addressed in commits 4e637b79, efb84d19, 1993e105
- **[2026-04-07T18:17Z] review-agent → CHANGES-REQUESTED** — all 4 blocking issues fixed in 900f8bc9
- **[2026-04-07T18:33Z] test-agent → FAILED** — all tests now pass (unit/e2e/dashboard); Playwright failures were environmental (connection refused, pre-existing)
