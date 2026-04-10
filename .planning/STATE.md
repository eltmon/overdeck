# PAN-462: Dashboard header metrics frozen — Handoffs, Escalations, Queue Depth

## Status: Implementation Complete

## Current Phase
Implementation complete — all beads closed

## Completed Work
- [x] feature-pan-489-arq: Fixed queueDepth in getSpecialistHandoffStats() to use live hook queues (commit: 7e1b79fa)
- [x] feature-pan-489-8ks: Added updateSpecialistHandoffStatus + wired to specialists/done (commit: cccb5eac)
- [x] feature-pan-489-dpu: Added todayEscalations to handoff stats, updated UI (commit: 43446c30)

## Remaining Work
(none)

## Status: Implementation Complete

## Key Decisions

### D1: Queue Depth — use live hooks, not JSONL log
`specialist-handoff-logger.ts` is append-only. Status fields never update. Fix: compute
queueDepth from live hook.json files per specialist (review-agent, test-agent, merge-agent,
inspect-agent) via getHook() from hooks.ts. This gives real-time queue depth.

### D2: Success Rate — add updateSpecialistHandoffStatus()
Add a function to rewrite the JSONL entry in-place when a specialist completes.
Call from /api/specialists/done route. Match by issueId + toSpecialist (most recent record).

### D3: Escalations — add todayCount to handoff stats
getHandoffStats() currently returns lifetime total with no time filter.
Add todayEscalations field scoped to today. Update MetricsSummaryRow to show
today's count with "(today)" label text instead of lifetime total.

## Specialist Feedback
(none yet)
- **[2026-04-07T04:52Z] verification-gate → FAILED** — `.planning/feedback/001-verification-gate-failed.md`
- **[2026-04-07T18:59Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/002-review-agent-changes-requested.md`
- **[2026-04-10T19:45Z] verification-gate → FAILED** — `.planning/feedback/003-verification-gate-failed.md`
- **[2026-04-10] All issues resolved** — fixed test isolation (temp AGENTS_DIR), async violations (sessionExistsAsync, updateSpecialistHandoffStatus async), placeholder, dead code (onDisconnect wired)
