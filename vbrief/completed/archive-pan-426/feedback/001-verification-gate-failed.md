---
specialist: verification-gate
issueId: PAN-426
outcome: failed
timestamp: 2026-04-03T19:44:14Z
---

VERIFICATION FAILED for PAN-426 (attempt 1/3):

Failed check: vbrief-ac

Acceptance criteria check FAILED — 13/13 AC incomplete:

### Add expand/collapse AC sections to list view TaskItem (4/4 incomplete)
  - [ ] Each bead row shows AC count badge (e.g., '2/4 AC') when the bead has AC subtasks
  - [ ] Clicking chevron expands/collapses AC checklist under the bead row, collapsed by default
  - [ ] AC items render with three visual states: green check (completed), yellow dot (in_progress), gray circle (pending/blocked)
  - [ ] Beads are correctly matched to plan items using the '{planId}: {itemTitle}' title convention

### Add always-visible AC progress badge to DAG nodes (2/2 incomplete)
  - [ ] DAG nodes with AC subtasks display a compact progress badge (e.g., '2/4 AC') in the badge row
  - [ ] AC badge is visible even when the Show AC toggle is off

### Add Show AC toggle with inline checklist in DAG nodes (4/4 incomplete)
  - [ ] A 'Show AC' / 'Hide AC' toggle button is visible in the DAG header or controls area
  - [ ] When toggled on, nodes with AC subtasks expand to show inline checklist with status indicators
  - [ ] Node height adjusts dynamically based on number of AC items; dagre layout re-runs correctly
  - [ ] Toggle is off by default — current compact node behavior preserved

### Wire up socket.io event for real-time AC subitem status changes (3/3 incomplete)
  - [ ] Server emits 'plan:subitem-status-changed' event with {issueId, itemId, subItemId, status} when AC status changes
  - [ ] PlanDAGViewer listens for the event and updates React Query cache in-place for the matching subItem
  - [ ] Both list view and DAG view reflect subitem status changes in real-time without page refresh

## REQUIRED: Complete all acceptance criteria BEFORE resubmitting

1. Review the incomplete AC above
2. Implement the missing requirements and write tests
3. Update plan.vbrief.json subItem statuses to 'completed'
4. Commit and push ALL changes
5. ONLY THEN resubmit:
curl -X POST http://localhost:3011/api/workspaces/PAN-426/request-review -H "Content-Type: application/json" -d '{}'

Do NOT resubmit until all AC are completed.
