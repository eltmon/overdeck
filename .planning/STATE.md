# PAN-103: Dashboard UI — Progressive Disclosure with Resizable Inspector and Terminal Panels

## Status: IMPLEMENTATION COMPLETE

## Remaining Work

None — all 10 tasks implemented and committed.

## Implementation Summary

Completed all planned work:
1. Design system: Stitch colors (#101622 bg, #161b26 panels, #232f48 borders, #2769ec primary, #92a4c9 text-secondary), Space Grotesk + Noto Sans fonts, Material Symbols icons
2. Installed react-resizable-panels v4.6.5
3. Created Header.tsx — horizontal navbar with logo, CloisterStatusBar, nav items, search, theme toggle
4. Created MetricsSummaryRow.tsx — compact 6-metric row (Cost, Agents, Stuck, Handoffs, Escalations, Queue)
5. Created InspectorPanel.tsx — full inspector sidebar extracted from WorkspacePanel with all agent info, git status, actions, mutations
6. Created TerminalPanel.tsx — terminal logs + status tab + chat input
7. Created DetailPanelLayout.tsx — orchestrates Inspector + Terminal with react-resizable-panels Group/Panel/Separator
8. Updated App.tsx — uses new Header and DetailPanelLayout, replaced old WorkspacePanel + resize logic
9. Updated KanbanBoard.tsx — Stitch card colors (#232f48 bg), column headers with Space Grotesk font
10. All tests pass (60 frontend, same pre-existing 3 backend failures)

## Summary

Redesign the Panopticon dashboard to use progressive disclosure with a persistent kanban board, sliding Inspector panel, and expandable Terminal panel. Adopt the full Stitch design system including colors, typography, and component styling.

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Kanban behavior when panels open | Push layout — narrows but stays interactive | Consistent with current behavior; DnD and action buttons remain usable |
| Design system | Full Stitch adoption | New colors, fonts (Space Grotesk + Noto Sans), Material Symbols icons |
| WorkspacePanel refactor | Full decomposition | Split into InspectorPanel, TerminalPanel, DetailPanelLayout |
| Resize implementation | `react-resizable-panels` library | Battle-tested, accessible, handles edge cases |
| Header | Redesign to match Stitch | Horizontal navbar with logo, status pills, agent health dots |
| Metrics row | Include | 6-metric summary above kanban board |
| State persistence | Per-agent in localStorage | Remember inspector width, terminal open/closed per agent |
| Animations | CSS transitions | Slide-in for panel open, smooth width changes |

## Architecture

### Layout Structure

```
┌─────────────────────────────────────────────────────────────┐
│ Header (60px) — Logo | Status | Nav | Search | Avatar       │
├─────────────┬───────────────┬───────────────────────────────┤
│             │               │                               │
│  Kanban     │  Inspector    │  Terminal                     │
│  (flex)     │  (360px,      │  (flex-1,                     │
│             │   resizable)  │   #0d1117)                    │
│  Metrics    │               │                               │
│  Filter Bar │  Agent Info   │  Logs/Status tabs             │
│  Columns    │  Git Status   │  Timestamped output           │
│             │  Services     │  Chat input                   │
│             │  Containers   │                               │
│             │  Actions      │                               │
│             │               │                               │
├─────────────┴───┬───────────┴───────────────────────────────┤
                  ↑ drag handle (react-resizable-panels)
```

### Panel States

```
State: closed            → Full-width kanban
State: inspector-only    → Kanban (flex) | Inspector (360px)
State: inspector+terminal → Kanban (flex) | Inspector (resizable) | Terminal (flex-1)
```

### Component Tree

```
App.tsx
├── Header.tsx (NEW — replaces tab navigation)
├── MainLayout.tsx (NEW — manages kanban + panels)
│   ├── KanbanBoard.tsx (MODIFIED — receives width constraints)
│   │   ├── MetricsSummaryRow.tsx (NEW)
│   │   ├── FilterBar.tsx (EXISTS — may need updates)
│   │   └── KanbanCard.tsx (MODIFIED — Stitch card designs)
│   └── DetailPanelLayout.tsx (NEW — coordinates panels)
│       ├── InspectorPanel.tsx (NEW — extracted from WorkspacePanel)
│       └── TerminalPanel.tsx (NEW — extracted from WorkspacePanel)
```

### New Components

1. **Header.tsx** — Top navigation bar matching Stitch design
   - Logo + "Panopticon" title
   - Cloister status pill with health dots
   - Horizontal nav items (Board, Agents, Convoys, Logs, Settings)
   - Search button, user avatar

2. **MetricsSummaryRow.tsx** — 6-metric grid above kanban
   - Cost, Agents, Stuck, Handoffs, Runtime, Efficiency
   - Data from existing API endpoints

3. **DetailPanelLayout.tsx** — Panel orchestration
   - Uses `react-resizable-panels` for Inspector ↔ Terminal split
   - Manages panel state machine: closed → inspector-only → inspector+terminal
   - Animated slide-in/out transitions
   - Per-agent state persistence in localStorage

4. **InspectorPanel.tsx** — Agent metadata and actions
   - Agent details (model, runtime, uptime)
   - Git status with branch and uncommitted file count
   - Service links (frontend, API)
   - Container status pills
   - Attach command (copyable)
   - Action buttons: Merge, Review, Stop, Close Panel
   - Collapsible via chevron/collapse button

5. **TerminalPanel.tsx** — Logs and messaging
   - Tab bar: Logs | Status
   - Timestamped, role-colored log output
   - Chat input with send button
   - Own close button (returns to inspector-only)

### Modified Components

6. **App.tsx** — Replace tab-based layout with Header + MainLayout
7. **KanbanBoard.tsx** — Updated card designs, width-aware layout
8. **tailwind.config.js** — Stitch design tokens
9. **index.css** — Font imports, new CSS variables, scrollbar styles

### Design System Changes

**New Colors:**
| Token | Hex | Usage |
|-------|-----|-------|
| `primary` | `#2769ec` | Buttons, active states, links |
| `background-dark` | `#101622` | Page background |
| `panel-left` | `#161b26` | Inspector sidebar |
| `panel-right` | `#0d1117` | Terminal pane |
| `border-color` | `#232f48` | Borders and dividers |
| `text-secondary` | `#92a4c9` | Labels, secondary text |

**Fonts:**
| Role | Font | Source |
|------|------|--------|
| Display/Headings | Space Grotesk | Google Fonts |
| Body text | Noto Sans | Google Fonts |
| Monospace | Space Grotesk | Reused from display |

**Icons:** Google Material Symbols Outlined (loaded via CDN or npm)

### State Management

```typescript
// Per-agent panel state — stored in localStorage
interface PanelState {
  panelMode: 'closed' | 'inspector-only' | 'inspector+terminal';
  inspectorWidth: number; // px, default 360, min 200, max 500
  inspectorCollapsed: boolean;
}

// localStorage key: `pan-panel-state-${agentId}`
// Global fallback: `pan-panel-state-default`
```

### Animation Strategy

- Panel open: `transform: translateX(0)` with `transition: transform 200ms ease-out`
- Panel close: `transform: translateX(100%)` with `transition: transform 150ms ease-in`
- Width changes: `transition: width 200ms ease` (disabled during drag resize)

## Risks

| Risk | Mitigation |
|------|------------|
| Full Stitch adoption causes visual regression | Apply Stitch tokens first, then update components incrementally. Test dark/light modes. |
| WorkspacePanel decomposition breaks functionality | Extract one section at a time. Keep existing component as reference until new panels are verified. |
| react-resizable-panels SSR issues | Dashboard is client-only React; no SSR concerns. |
| Large scope (header + metrics + panels + design system) | Task ordering allows incremental delivery; design system first, then components. |
| Kanban performance with narrow width | Cards already responsive; test at 300px minimum kanban width. |

## Out of Scope

- Light mode redesign (focus on dark mode, light mode follow-up)
- Mobile/tablet responsive layouts
- Keyboard shortcuts for panel navigation
- Agent log streaming performance optimization
- Filter bar redesign (keep existing, style updates only)

## Task Sequence

See beads for detailed tasks with dependencies. High-level order:

1. Design system foundation (tailwind config, fonts, icons)
2. Install react-resizable-panels
3. Header redesign
4. Metrics summary row
5. InspectorPanel extraction
6. TerminalPanel extraction
7. DetailPanelLayout (requires 5, 6)
8. App.tsx integration (requires 3, 4, 7)
9. Kanban card Stitch styling
10. Polish and cleanup

## Specialist Feedback

- **[2026-02-24T05:35Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/006-review-agent-changes-requested.md`
- **[2026-02-24T05:43Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/007-review-agent-changes-requested.md`
