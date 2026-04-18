# PAN-446: Replace all sync filesystem calls in server code with async equivalents

## Status: Implementation Complete

## Current Phase
All beads complete. Ready to commit and submit for review.

## Completed Work
- [x] panopticon-cli-4vjm: Phase 1 - Converted agent-enrichment.ts 6 sync FS calls to async (commit: 174eaf9)
- [x] panopticon-cli-ed7o: Phase 2 - Converted read-model.ts and event-store.ts sync FS to async (commit: 3cc858f)
- [x] panopticon-cli-so8i: Phase 3 - Converted remaining server sync FS calls (commit: pending)

## Remaining Work
None

## Key Decisions
- D1: Using `fs/promises` directly rather than Effect FileSystem service to keep changes minimal and focused
- D2: `CacheService.mkdirSync` converted via static `initHome()` async method called from `main.ts` at startup (mirrors `initTrackerConfigCache()` pattern)
- D3: `readPackageVersion()` in misc.ts converted to async with top-level await at module scope
- D4: `rmSync` calls in issues.ts (abort-planning + reopen) replaced with `rm` from `fs/promises` inside existing `Effect.promise(async...)` wrappers

## Specialist Feedback
- **[2026-04-18T22:15Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/020-review-agent-changes-requested.md`
- **[2026-04-18T22:26Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/021-review-agent-changes-requested.md`
- **[2026-04-18T22:35Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/022-review-agent-changes-requested.md`
- **[2026-04-18T22:43Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/023-review-agent-changes-requested.md`
- **[2026-04-18T22:59Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/024-review-agent-changes-requested.md`
