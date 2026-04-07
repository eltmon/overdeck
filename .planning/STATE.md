# PAN-462: Dashboard header metrics frozen — Handoffs, Escalations, Queue Depth

## Status: In Progress

## Current Phase
Implementing bead feature-pan-489-dpu: Today-scoped escalation count + UI label clarification

## Completed Work
- [x] feature-pan-489-arq: Fixed queueDepth in getSpecialistHandoffStats() to use live hook queues (commit: 7e1b79fa)
- [x] feature-pan-489-8ks: Added updateSpecialistHandoffStatus + wired to specialists/done (commit: TBD)

## Remaining Work
- [ ] feature-pan-489-dpu: Add today-scoped escalation count, clarify UI label

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
