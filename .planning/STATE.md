# PAN-331: Port PAN-103 progressive disclosure UI to current codebase

## Current Status: REOPENED

## What Was Done (keep — already on main)
- Component structure: Header, InspectorPanel, TerminalPanel, DetailPanelLayout, MetricsSummaryRow
- react-resizable-panels wired up
- Tailwind config with pan-* tokens defined
- Basic layout working

## Remaining Work

### Task 1: Replace hardcoded hex with Stitch tokens in InspectorPanel
- 25 hardcoded hex colors need to become pan-* Tailwind tokens
- 0 pan-* tokens currently used in InspectorPanel.tsx

### Task 2: Split InspectorPanel into sub-components
- Currently 1,344 lines — split into <300 line components
- Extract: AgentInfoSection, GitStatusSection, ContainerSection, ReviewPipelineSection, ActionsSection

### Task 3: Apply Stitch styling to KanbanBoard
- Only 4 pan-* references currently — needs full Stitch treatment
- Done column styling uses generic Tailwind instead of design system

### Task 4: Consult Stitch mockups and match design
- Screen IDs: fd5bece5206f48cea74e13d745522659, 9777134c06e0443b9b92eb26dc90dded
- Use /stitch-react-components skill or mcp__stitch__get_screen

### Task 5: Address improvement checklist
- [ ] Use shadcn confirm() instead of native confirm()
- [ ] Remove unused Material Symbols font import
- [ ] Remove or use slide-in/slide-out animations
- [ ] Add font preloading for Space Grotesk / Noto Sans

## Files to Modify
- src/dashboard/frontend/src/components/InspectorPanel.tsx (split + tokens)
- src/dashboard/frontend/src/components/KanbanBoard.tsx (Stitch styling)
- src/dashboard/frontend/index.html (font preloading)
