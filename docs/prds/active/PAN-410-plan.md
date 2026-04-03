# PAN-410: DAG Visualization — Match vBRIEF Studio Quality

## Status: Planning Complete

## Problem

The dashboard's DAG visualization in `PlanDAG.tsx` is functional but visually basic compared to vBRIEF Studio's rendering. Six specific gaps have been identified: missing edge labels, no status text badges, cryptic single-letter difficulty/priority indicators, plain edge styling, tight layout spacing, and a sparse metadata panel.

## Approach

All 6 improvements will be implemented as a single deliverable. The changes are concentrated in two files:

- **`src/dashboard/frontend/src/components/PlanDAG.tsx`** — custom node component, edge conversion, dagre layout config
- **`src/dashboard/frontend/src/components/BeadsTasksPanel.tsx`** — PlanItemDetail panel

### Task 1: Node Enhancements (PlanDAG.tsx)

**Current state:** Nodes are 180x60, status shown only via border color, difficulty as single letter (T/S/M/C/E), priority as 6px dot.

**Changes:**
- Add a colored pill badge showing status text ("pending", "in progress", "completed", "blocked") below the title
- Expand difficulty to full word in a styled pill (same position, wider)
- Replace priority dot with a labeled badge ("high", "medium", "low")
- Increase `NODE_WIDTH` to 220 and `NODE_HEIGHT` to 80 to accommodate badges
- Status badge uses existing `STATUS_COLORS` palette for bg/text

### Task 2: Edge Enhancements (PlanDAG.tsx)

**Current state:** Edges have no labels, near-identical grays, 14x14 arrows.

**Changes:**
- Add `label` property to ReactFlow edges with edge type name
- Style labels: 10px font, `#111827` bg with 80% opacity, `#d1d5db` text, rounded
- Distinct colors per edge type:
  - `blocks`: #ef4444 (red)
  - `informs`: #3b82f6 (blue)
  - `suggests`: #8b5cf6 (purple)
  - `invalidates`: #f59e0b (amber)
- Increase arrow size to 20x20, color-match to edge stroke
- Critical path retains orange (#f97316) override + animation

### Task 3: Layout & Metadata Panel

**Layout (PlanDAG.tsx):**
- Increase dagre `nodesep` from 40→60, `ranksep` from 60→100

**Metadata panel (BeadsTasksPanel.tsx PlanItemDetail):**
- Show all narrative fields (Problem, Constraint, Risk, etc.) — not just Action
- Add sub-item completion progress counter ("2/5 criteria met")
- Add edge context: list all incoming/outgoing edges with types and connected item titles (not just `blocks` edges)

## Constraints

- Must use existing ReactFlow v11.11.4 and dagre — no new dependencies
- Dark theme only (existing color palette)
- Must not break real-time socket.io updates for status changes
- Critical path highlighting must be preserved
- Node click handler and detail panel must continue to work

## Risks

- **Node size increase may affect fit-view**: Mitigated by ReactFlow's `fitView` with padding
- **Edge labels may overlap on dense graphs**: Small font (10px) with background, single-word labels

## Decisions

- Keep all 6 improvements in one deliverable — they touch 2 files and are interdependent
- Use inline ReactFlow edge labels (not custom edge components) — simpler, sufficient for single-word labels
- Node badges use the same color palette as existing STATUS_COLORS/PRIORITY_DOT — no new colors
