# PAN-436: Dashboard shows zero stats on load — missing skeleton/loading states

## Status: Planning Complete

## Problem

When the dashboard loads, all event-sourced views (Kanban, Agents, GodView, sidebar counts) render immediately with empty store defaults (zero counts, empty arrays) while `getSnapshot` RPC completes (500-700ms+). The `selectIsBootstrapped` selector exists but no component checks it.

## Decision

**Skeleton placeholders with bootstrap gate** — a `<BootstrapGate>` wrapper component that checks `selectIsBootstrapped` and renders shimmer/pulse skeleton fallbacks until the initial snapshot loads.

### Scope

- **In scope:** BootstrapGate component, skeleton components for store-consuming views, wiring in App.tsx
- **Out of scope:** localStorage caching (stale-while-revalidate), progressive rendering, React Query loading states (these already have Loader2 spinners)

### Key Decisions

1. **Wrapper component pattern** — single `<BootstrapGate fallback={...}>` component wraps children, checks `selectIsBootstrapped`, renders fallback or children
2. **Shimmer/pulse animation** — `animate-pulse bg-surface-2 rounded` placeholder blocks matching the layout shape of real content
3. **Only gate store consumers** — React Query views (MissionControl, HandoffsPage, etc.) already have `isLoading` checks. Only event-sourced store consumers need the gate.

## Affected Components

| Component | Store Selectors Used | Skeleton Needed |
|-----------|---------------------|-----------------|
| `KanbanBoard.tsx` | `selectIssuesByCycle`, `selectAgentList`, `selectSpecialistList` | Yes — column layout with card placeholders |
| `AgentList.tsx` | `selectAgentList`, `selectSpecialistList` | Yes — list rows |
| `GodView/index.tsx` | `selectAgentList` | Yes — grid cards |
| `App.tsx` sidebar | `selectAgentList`, `selectIssues` | Yes — count badges show 0 |

## Architecture

```
App.tsx
├── EventRouter (unchanged — sets bootstrapComplete on snapshot)
├── Header (sidebar counts from store)
│   └── BootstrapGate fallback={<HeaderSkeleton />}
├── activeTab === 'kanban'
│   └── BootstrapGate fallback={<KanbanSkeleton />}
│       └── KanbanBoard
├── activeTab === 'agents'
│   └── BootstrapGate fallback={<AgentListSkeleton />}
│       └── AgentList
└── activeTab === 'god-view'
    └── BootstrapGate fallback={<GodViewSkeleton />}
        └── GodView
```

## Files to Create

1. `src/dashboard/frontend/src/components/BootstrapGate.tsx` — wrapper component
2. `src/dashboard/frontend/src/components/skeletons/KanbanSkeleton.tsx` — kanban column layout
3. `src/dashboard/frontend/src/components/skeletons/AgentListSkeleton.tsx` — agent row list
4. `src/dashboard/frontend/src/components/skeletons/GodViewSkeleton.tsx` — grid cards
5. `src/dashboard/frontend/src/components/skeletons/HeaderSkeleton.tsx` — nav tab count badges (or inline in Header)

## Files to Modify

1. `src/dashboard/frontend/src/App.tsx` — wrap store-consuming tab views with BootstrapGate
2. Possibly `Header.tsx` — gate sidebar agent/issue counts

## Difficulty: medium
Standard React component patterns, 6-8 files, clear approach, no architectural risk.

## Specialist Feedback

- **[2026-04-04T20:08Z] verification-gate → FAILED** — `.planning/feedback/001-verification-gate-failed.md`
- **[2026-04-04T20:15Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/002-review-agent-changes-requested.md`
