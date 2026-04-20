---
specialist: review-agent
issueId: PAN-653
outcome: changes-requested
timestamp: 2026-04-18T16:26:46Z
---

CODE REVIEW BLOCKED for PAN-653:

1. src/dashboard/server/routes/metrics.ts:153 — GET /api/metrics/stuck still returns status.summary.stuck, so persistent review_status.stuck workspaces are omitted from this endpoint even though /api/metrics/summary was updated to union inactivity-stuck and persistent-stuck. That leaves dashboard/API consumers with inconsistent stuck counts.
2. src/dashboard/frontend/src/components/KanbanBoard.tsx:2018-2023 — DivergedBadge emits a synthetic review.status_changed event with sequence: 0 for its optimistic update. Domain events are sequence-ordered elsewhere, and injecting a fake zero-sequence event bypasses that contract and risks incorrect store/event ordering behavior. Update the store directly for optimistic UI, or wait for the real pipeline event instead of fabricating a DomainEvent.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-653 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
