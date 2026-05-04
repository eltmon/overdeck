# PAN-426: Tasks Panel and DAG — AC Subtask Toggle

## Decisions

1. **DAG AC display: Inline checklist** — When the "Show AC" toggle is on, each DAG node expands vertically to show AC items as a mini checklist inside the node (green check / yellow dot / gray circle). Node height is dynamic based on AC count.

2. **DAG AC badge: Always visible** — A compact AC progress badge (e.g., "2/4 AC") appears on DAG nodes regardless of toggle state. Gives at-a-glance progress without expanding.

3. **List view: Expand/collapse per bead** — Each bead row gets a chevron toggle and an AC count badge (e.g., "2/3"). Click to expand shows AC items as a checklist underneath. Collapsed by default.

4. **Three AC status states** — Green check (completed), yellow dot (in_progress), gray circle (pending/blocked). Matches the issue description.

5. **Real-time AC updates via socket.io** — New `plan:subitem-status-changed` event wired up server→frontend for live AC status updates without polling.

## Architecture

### Data Flow

The `plan.vbrief.json` is already fetched by both `BeadsTasksPanel` (via `useQuery(['plan', issueId])`) and `PlanDAGViewer`. AC data lives in `plan.items[].subItems[]` where `metadata.kind === 'acceptance_criterion'`. No new API endpoints needed.

### Files to Modify

**Frontend (3 files):**
- `src/dashboard/frontend/src/components/PlanDAG.tsx` — Add "Show AC" toggle, AC badge on nodes, inline checklist rendering, dynamic node height, listen to `plan:subitem-status-changed`
- `src/dashboard/frontend/src/components/BeadsTasksPanel.tsx` — Add expand/collapse AC sections under TaskItem, AC count badge, match beads to plan items for AC data, listen to `plan:subitem-status-changed`

**Server (2 files):**
- `src/dashboard/server/index.ts` — Emit `plan:subitem-status-changed` socket event when subitem status changes (parallel to existing `plan:item-status-changed`)
- `src/lib/vbrief/io.ts` — No changes needed (already has `updateSubItemStatus`)

### Key Implementation Details

**Bead-to-plan-item matching:** `PlanItemDetail` already matches beads to plan items using `"{plan.id}: {item.title}".toLowerCase()`. The list view will reuse this same pattern to look up AC data for each bead.

**DAG node sizing:** Currently fixed at `NODE_WIDTH=220, NODE_HEIGHT=80`. When AC toggle is on, compute height dynamically: `80 + (acCount * 18)` for nodes with ACs. The dagre layout must re-run when the toggle changes.

**Socket event shape:**
```typescript
{
  issueId: string;
  itemId: string;
  subItemId: string;
  status: VBriefItemStatus;
}
```

**React Query cache update:** Same pattern as the existing item-status handler — `setQueryData` to update the specific subItem in-place.

## Scope

- IN: Tasks panel AC expand/collapse, DAG inline checklist toggle, AC badge on nodes, socket.io subitem events
- OUT: No API changes, no new endpoints, no changes to AC extraction logic

## Specialist Feedback

- **[2026-04-03T19:44Z] verification-gate → FAILED** — `.planning/feedback/001-verification-gate-failed.md`
