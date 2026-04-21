# PAN-699: Conversation view renders tool calls out of terminal order

## Status: In Progress

## Current Phase
Implementing bead pan-569-f4a: Playwright UAT — all implementation beads complete

## Completed Work
- [x] pan-569-lkq: Add optional `sequence` field to ChatMessage and WorkLogEntry contracts (commit: 03a1e68d)
- [x] pan-569-qb5: Emit monotonic sequence on every parsed message and workLog entry (commit: 964a3bd4)
- [x] pan-569-lnv: Two-pass pairing: handle tool_result that arrives before tool_use (commit: 2433b8b8)
- [x] pan-569-8f8: Persist pendingToolUse, unresolvedResults, and sequence across incremental parse calls (commit: 904b5435)
- [x] pan-569-4tp: Sort messages and workLog by (createdAt, sequence) before returning (commit: 2266cb6b)
- [x] pan-569-5a3: Thread sequence through the agents.ts conversation response (no commit — satisfied by prior beads)
- [x] pan-569-2rt: MessagesTimeline defensive client-side sort by (createdAt, sequence) (commit: 51c8e313)
- [x] pan-569-5uz: Unit tests for conversation-service ordering and pairing (commit: 238949b7)
- [x] pan-569-4ez: Regression fixture from a real mis-ordered session (commit: c45defed)
- [x] pan-569-f4a: Playwright UAT: conversation view renders in terminal order (commit: 88ec9fd0)

## Remaining Work
(none — all beads complete)

## Key Decisions
- Mirror t3code pattern (`compareActivitiesByOrder`): sort by `(createdAt, sequence)` server-side after two-pass walk
- Cross-call state persistence: `parseConversationMessages` returns `pendingToolUse`, `unresolvedResults`, and `lastSequence` as part of `ParseResult`
- Client-side defensive sort in `deriveTimelineEntries` as a second belt (server is authoritative)

## Specialist Feedback
(none yet)
- **[2026-04-20T23:04Z] verification-gate → FAILED** — `.planning/feedback/001-verification-gate-failed.md`
- **[2026-04-21T04:24Z] verification-gate → FAILED** — `.planning/feedback/002-verification-gate-failed.md`
- **[2026-04-21T04:26Z] review-agent → COMMENTED** — `.planning/feedback/003-review-agent-commented.md`
- **[2026-04-21T04:29Z] review-agent → COMMENTED** — `.planning/feedback/004-review-agent-commented.md`
- **[2026-04-21T04:31Z] review-agent → COMMENTED** — `.planning/feedback/005-review-agent-commented.md`
- **[2026-04-21T04:33Z] review-agent → COMMENTED** — `.planning/feedback/006-review-agent-commented.md`
- **[2026-04-21T04:34Z] review-agent → COMMENTED** — `.planning/feedback/007-review-agent-commented.md`
- **[2026-04-21T04:35Z] review-agent → COMMENTED** — `.planning/feedback/008-review-agent-commented.md`
- **[2026-04-21T04:47Z] review-agent → COMMENTED** — `.planning/feedback/009-review-agent-commented.md`
- **[2026-04-21T04:49Z] verification-gate → FAILED** — `.planning/feedback/010-verification-gate-failed.md`
- **[2026-04-21T04:54Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/011-review-agent-changes-requested.md`
- **[2026-04-21T05:06Z] review-agent → COMMENTED** — `.planning/feedback/012-review-agent-commented.md`
- **[2026-04-21T05:07Z] review-agent → COMMENTED** — `.planning/feedback/013-review-agent-commented.md`
- **[2026-04-21T05:08Z] review-agent → COMMENTED** — `.planning/feedback/014-review-agent-commented.md`
- **[2026-04-21T05:09Z] review-agent → COMMENTED** — `.planning/feedback/015-review-agent-commented.md`
- **[2026-04-21T05:10Z] review-agent → COMMENTED** — `.planning/feedback/016-review-agent-commented.md`
- **[2026-04-21T05:14Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/017-review-agent-changes-requested.md`
- **[2026-04-21T05:18Z] review-agent → COMMENTED** — `.planning/feedback/018-review-agent-commented.md`
- **[2026-04-21T05:21Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/019-review-agent-changes-requested.md`
- **[2026-04-21T05:45Z] review-agent → COMMENTED** — `.planning/feedback/020-review-agent-commented.md`
- **[2026-04-21T05:48Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/021-review-agent-changes-requested.md`
