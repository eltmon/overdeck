# PAN-331: Progressive Disclosure UI with Stitch Design System

## Current Status: COMPLETE

## Summary

Implemented the full Stitch design system UI for the Panopticon dashboard.

## Implementation

### Task 1: Foundation (panopticon-viqj) ✓
- Added react-resizable-panels ^4.6.5 to package.json
- Added pan-* Stitch color tokens and Space Grotesk/Noto Sans font families to tailwind.config.js
- Added Google Fonts preconnect + Space Grotesk/Noto Sans import in index.html
- Removed Material Symbols import
- Added slide-in/out animations to tailwind keyframes

### Task 2: Header component (panopticon-hvdj) ✓
- Created `src/components/Header.tsx` — standalone header with Stitch styling
- Props: activeTab, onTabChange, onSearchOpen
- Includes CloisterStatusBar, all 12 tabs, search button with "/" shortcut, theme toggle
- Space Grotesk title font, pan-primary (#2769ec) active tab

### Task 3: TerminalPanel component (panopticon-g2bk) ✓
- Created `src/components/TerminalPanel.tsx`
- Two tabs: Logs (auto-scroll + message input) and Status (agent summary)
- Stitch styling: pan-panel-right bg, pan-border borders
- Props: { agent: Agent; onClose: () => void }

### Task 4: MetricsSummaryRow (panopticon-nuem) ✓
- Created `src/components/MetricsSummaryRow.tsx`
- 6 compact metric tiles: Cost Today, Agents, Stuck, Handoffs, Escalations, Queue Depth
- MetricTile sub-component with icon, label, value, subtext, color
- Same API queries as MetricsSummary

### Task 5: KanbanBoard Stitch styling (panopticon-wco2) ✓
- DroppableColumn: flex-1 min-w-[200px] (was fixed w-80)
- Column container: bg-pan-panel-left
- Column header: border-pan-border + bg-pan-panel-left
- IssueCard: border-pan-border, pan-panel-right background

### Task 6: DetailPanelLayout (panopticon-db5b) ✓
- Created `src/components/DetailPanelLayout.tsx`
- 3 states: closed, inspector-only, inspector+terminal
- react-resizable-panels v4 (Panel, Group, Separator) for inner split
- Outer drag handle for panel width resize
- localStorage persistence per issueId
- Width bounds: inspector-only 280-1200px (default 360), with-terminal 480-1200px (default 760)

### Task 7: InspectorPanel (panopticon-wfkx) ✓
- Created `src/components/InspectorPanel.tsx` — full replacement for WorkspacePanel
- All WorkspacePanel features preserved + Stitch styling
- Added: verificationStatus display, reopen mutation, resetReview mutation, byStage cost breakdown
- Uses useConfirm for all confirmation dialogs (no native confirm())
- onOpenTerminal prop for DetailPanelLayout integration

### Task 8: App.tsx integration (panopticon-f8er) ✓
- Replaced inline header with <Header> component
- Replaced MetricsSummary with MetricsSummaryRow
- Replaced WorkspacePanel + manual resize logic with DetailPanelLayout
- Removed: panelWidth, isResizing, isExpanded, containerRef, mouse handlers
- Cleaned up unused imports

## Files Changed
- `src/dashboard/frontend/package.json` — react-resizable-panels dependency
- `src/dashboard/frontend/tailwind.config.js` — Stitch tokens + fonts
- `src/dashboard/frontend/index.html` — Google Fonts
- `src/dashboard/frontend/src/App.tsx` — final integration
- `src/dashboard/frontend/src/components/Header.tsx` — NEW
- `src/dashboard/frontend/src/components/TerminalPanel.tsx` — NEW
- `src/dashboard/frontend/src/components/MetricsSummaryRow.tsx` — NEW
- `src/dashboard/frontend/src/components/DetailPanelLayout.tsx` — NEW
- `src/dashboard/frontend/src/components/InspectorPanel.tsx` — NEW
- `src/dashboard/frontend/src/components/KanbanBoard.tsx` — Stitch styling

## Tests
- 135/135 tests pass
- TypeScript: no errors
- Build: successful (vite production build)

## Remaining Work
None
