# PAN-288: Dashboard — Separate canceled issues from Done, add Canceled filter view

## Status: PLANNING COMPLETE

## Problem

Canceled issues (Canceled, Duplicate, Won't Do) are currently lumped into the Done column on the kanban board via `groupByStatus()` line 192. This makes Done misleading — it shows issues that were never actually completed.

## Decisions

1. **Canceled = fully independent filter view** — not part of Done, not part of Backlog, not toggled by "Include closed-out". Canceled issues *only* appear in the Canceled filter view.
2. **Grouped by project** — consistent with Backlog view UX pattern.
3. **Visual treatment** — dimmed opacity + strikethrough on titles to make terminal state obvious.

## Architecture

### Files to Modify

| File | Change | Risk |
|------|--------|------|
| `src/dashboard/frontend/src/components/KanbanBoard.tsx` | Add `'canceled'` to `CycleFilter` type, update filter bar UI, add canceled list view, stop pushing canceled into `grouped.done` | Medium — largest change, but follows existing patterns |
| `src/dashboard/server/services/issue-data-service.ts` | Add `cycle === 'canceled'` filter branch in `getIssues()` | Low — mirrors existing `backlog` branch |

### No changes needed in:
- `types.ts` — `CanonicalState` already has `'canceled'`, `STATUS_LABELS` already maps correctly
- `server/index.ts` — `/api/issues` endpoint already passes `cycle` param through

### Detailed Changes

#### 1. KanbanBoard.tsx — `CycleFilter` type (line 678)

```typescript
// Before:
type CycleFilter = 'current' | 'all' | 'backlog';

// After:
type CycleFilter = 'current' | 'all' | 'backlog' | 'canceled';
```

#### 2. KanbanBoard.tsx — `groupByStatus()` (lines 191-193)

Stop pushing canceled issues into Done. Filter them out entirely (they live in the Canceled view now).

```typescript
// Before:
if (status === 'canceled') {
  grouped.done.push(issue);
}

// After:
if (status === 'canceled') {
  // Canceled issues excluded from kanban — shown in Canceled filter view
  continue;
}
```

#### 3. KanbanBoard.tsx — Filter bar UI (around line 1042)

Add `'canceled'` to the cycle filter button array:

```typescript
{(['current', 'all', 'backlog', 'canceled'] as CycleFilter[]).map((cycle) => (
  // ... existing button markup
  {cycle === 'current' ? 'Current' : cycle === 'all' ? 'All' : cycle === 'backlog' ? 'Backlog' : 'Canceled'}
))}
```

#### 4. KanbanBoard.tsx — Canceled list view

Add a new conditional branch for `cycleFilter === 'canceled'` in the render section (alongside the existing `all` and `backlog` branches). Uses `groupByProject()` to match Backlog's visual pattern. Apply dimmed opacity and strikethrough styling to issue rows.

The structure mirrors the existing backlog view:
```tsx
cycleFilter === 'canceled' ? (
  <div className="space-y-6 overflow-y-auto pb-4">
    {groupedByProject.map((group) => (
      // Same structure as backlog, but ListIssueRow items get
      // opacity-60 and line-through styling on titles
    ))}
    {groupedByProject.length === 0 && (
      <div className="text-center py-12 text-content-subtle">
        No canceled issues
      </div>
    )}
  </div>
)
```

#### 5. issue-data-service.ts — `getIssues()` (around line 223)

Add canceled filter alongside existing backlog filter:

```typescript
} else if (cycle === 'canceled') {
  allIssues = allIssues.filter(issue => {
    const canonical = getCanonicalStatus(issue.status);
    return canonical === 'canceled';
  });
}
```

Also update `current` filter to exclude canceled issues (in addition to backlog):

```typescript
if (cycle === 'current') {
  allIssues = allIssues.filter(issue => {
    const canonical = getCanonicalStatus(issue.status);
    return canonical !== 'backlog' && canonical !== 'canceled';
  });
}
```

### Visual Styling for Canceled View

In the canceled list view, each `ListIssueRow` wrapper gets:
- `opacity-60` — dims the entire row
- The title text gets `line-through` decoration

This can be done by wrapping `ListIssueRow` in a styled div, or by passing a `className` prop — whichever is cleaner at implementation time.

## Acceptance Criteria

- [x] Plan: Canceled issues no longer appear in the Done column
- [x] Plan: New "Canceled" filter option in the cycle filter bar
- [x] Plan: Canceled view shows issues in a list with dimmed/strikethrough styling
- [x] Plan: "Include closed-out" toggle does NOT resurface canceled issues in Done
- [x] Plan: Existing Done column only shows truly completed issues

## Estimate

**Overall difficulty: medium** — 2 files, follows existing patterns closely, main complexity is ensuring the new filter view integrates cleanly with the existing conditional rendering chain.
