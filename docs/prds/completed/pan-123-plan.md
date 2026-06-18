# PAN-123: Kanban Drag and Drop

## Issue Summary

Add drag-and-drop functionality to the Kanban board so users can move issue cards between columns to change their shadow status.

**Issue URL:** https://github.com/eltmon/overdeck/issues/123
**Blocked by:** PAN-28 (Shadow mode) - **Implemented**

---

## Decisions Made

### 1. DnD Library: `@dnd-kit/core`
- Modern, actively maintained
- Lightweight (~10kb)
- Excellent TypeScript support
- Accessible by default (keyboard navigation, screen reader support)

### 2. Visual Feedback: Full
- Ghost card following cursor during drag
- Drop zone highlighting on columns
- Smooth animations for card movement
- Cursor changes (grab/grabbing)

### 3. Undo Mechanism: Both Toast + Keyboard
- Toast notification with "Undo" button (5-10 second window)
- Ctrl+Z / Cmd+Z keyboard shortcut
- Requires undo history stack implementation

### 4. Drop Rules: Allow Any Column
- No workflow restrictions
- Users can move cards freely between any status
- Maximum flexibility for personal organization

### 5. Agent Conflict Handling: Allow with Warning
- Cards with active agents can be dragged
- Show warning dialog before completing the drop
- User can cancel or proceed

### 6. Done Column Behavior: Prompt to Sync
- Moving to "Done" shows prompt asking if user wants to sync to Linear
- Keeps shadow-first philosophy but offers quick sync option

### 7. MVP Scope: Single Card Drag Only
- One card at a time
- No multi-select drag
- No reordering within columns (future enhancement)

---

## Architecture

### Frontend Changes

**KanbanBoard.tsx modifications:**
```
1. Add @dnd-kit providers (DndContext, DragOverlay)
2. Wrap columns with useDroppable
3. Wrap cards with useDraggable
4. Add DragOverlay for ghost card
5. Add undo history state + toast component
6. Add agent warning dialog
7. Add "sync to tracker" prompt for Done column
```

**New Components:**
- `DraggableCard` - Wrapper around IssueCard with drag hooks
- `DroppableColumn` - Wrapper around column with drop zone
- `UndoToast` - Toast notification with undo action
- `AgentWarningDialog` - Confirmation for moving cards with agents
- `SyncPromptDialog` - Prompt when moving to Done

**State Management:**
- Undo history stack in component state (or zustand if needed)
- Optimistic updates with rollback on error

### Backend Changes

**New endpoint: `POST /api/issues/:id/move-status`**
```typescript
{
  targetStatus: CanonicalState,  // 'backlog' | 'todo' | 'planning' | 'in_progress' | 'in_review' | 'done'
  syncToTracker?: boolean        // If true, also update Linear
}
```

**Behavior:**
1. Update shadow state via `updateShadowState()`
2. If `syncToTracker: true`, also call Linear API
3. Return updated issue state

### Integration Points

**Shadow State (`src/lib/shadow-state.ts`):**
- Already has `updateShadowState(issueId, newStatus, triggeredBy)`
- Will be called with `triggeredBy: 'dashboard-drag-drop'`

**Linear API:**
- Existing pattern: fetch issue → get team states → find target state → update
- Reuse patterns from `/api/issues/:id/reopen` endpoint

---

## File Impact Analysis

| File | Change Type | Complexity |
|------|-------------|------------|
| `frontend/src/components/KanbanBoard.tsx` | Major | Medium |
| `frontend/package.json` | Add dependency | Trivial |
| `server/index.ts` | Add endpoint | Simple |
| `src/lib/shadow-state.ts` | No changes needed | None |
| New: `UndoToast.tsx` | New component | Simple |
| New: `DragOverlayCard.tsx` | New component | Simple |

---

## Out of Scope

- Multi-select drag (drag multiple cards at once)
- Reordering cards within the same column
- Cross-board drag (if we ever have multiple boards)
- Auto-syncing all moves to Linear (only Done prompts)

---

## Testing Strategy

1. **Unit tests:** Drop zone logic, status mapping
2. **Integration tests:** API endpoint, shadow state updates
3. **Manual testing:** Drag interactions, animations, keyboard nav
4. **Accessibility testing:** Screen reader, keyboard-only usage

---

## Implementation Tasks

See beads for task breakdown with dependencies:
- `bd list -l PAN-123`
