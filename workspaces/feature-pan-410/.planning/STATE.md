# PAN-410: DAG Visualization — Match vBRIEF Studio Quality

## Status: Planning Complete

## Problem

The dashboard's DAG visualization in `PlanDAG.tsx` is functional but visually basic compared to vBRIEF Studio's rendering. Six specific gaps have been identified: missing edge labels, no status text badges, cryptic single-letter difficulty/priority indicators, plain edge styling, tight layout spacing, and a sparse metadata panel.

## Approach

All 6 improvements will be implemented as a single deliverable. The changes are concentrated in two files:

- **`src/dashboard/frontend/src/components/PlanDAG.tsx`** — custom node component, edge conversion, dagre layout config
- **`src/dashboard/frontend/src/components/BeadsTasksPanel.tsx`** — PlanItemDetail panel

### Task 1: Node Enhancements (PlanDAG.tsx)

**Status badges:** Add a colored pill/badge showing status text ("pending", "in progress", "completed", "blocked") inside each node. Use the existing `statusColors` palette for background/text colors. Replace the current implicit status-via-border-color with an explicit text badge.

**Difficulty/priority badges:** Expand the single-letter difficulty badge (T/S/M/C/E) to show the full word in a styled pill. Similarly, replace the 6px priority dot with a labeled badge showing "high", "medium", "low", etc.

**Node size:** Increase from 180×60 to ~220×80 to accommodate the additional badges without crowding.

### Task 2: Edge Enhancements (PlanDAG.tsx)

**Edge labels:** Add `label` property to ReactFlow edges with the edge type name ("blocks", "informs", "suggests", "invalidates"). Style labels with a small font, semi-transparent background for readability against the grid.

**Distinct edge colors:** Assign unique colors per edge type instead of the current near-identical grays:
- `blocks`: #ef4444 (red) — hard dependency, visually prominent
- `informs`: #3b82f6 (blue) — soft dependency
- `suggests`: #8b5cf6 (purple) — weak recommendation
- `invalidates`: #f59e0b (amber) — cancellation edge

**Arrow visibility:** Increase `markerEnd` arrow size. Ensure arrowhead color matches edge stroke color.

**Critical path:** Retain existing orange animation for critical path edges (overrides per-type colors).

### Task 3: Layout & Metadata Panel

**Dagre layout (PlanDAG.tsx):** Increase `nodesep` from 40→60 and `ranksep` from 60→100 to reduce visual crowding, especially with the larger nodes from Task 1.

**Metadata panel (BeadsTasksPanel.tsx):** Enrich the PlanItemDetail component:
- Show difficulty and priority as styled badges (matching node badges)
- Display all narrative fields (not just Action) — Problem, Constraint, etc. if present
- Show sub-item count and completion progress (e.g., "2/5 acceptance criteria met")
- Add edge context: list incoming/outgoing edges with their types and connected item titles

## Constraints

- Must use existing ReactFlow v11.11.4 and dagre — no new dependencies
- Dark theme only (existing color palette)
- Must not break real-time socket.io updates for status changes
- Critical path highlighting must be preserved
- Node click handler and detail panel must continue to work

## Risks

- **Node size increase may affect fit-view**: Mitigated by ReactFlow's `fitView` with padding — will auto-adjust zoom level
- **Edge labels may overlap on dense graphs**: Use small font (10-11px) with background, and keep labels short (single word)

## Alternatives Considered

- **Tooltip-only labels** (show edge type on hover): Rejected — Studio shows them always, and hover is not discoverable
- **Separate tasks per improvement**: Rejected — all changes are in 2 files and interdependent (e.g., node size affects layout spacing)
