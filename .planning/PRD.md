# PRD: Command Deck Sidebar Density Optimization

**Issue:** PAN-647
**Author:** Ed Becker (with Claude Opus 4.6)
**Created:** 2026-04-11
**Status:** Ready for Implementation

## Executive Summary

The Command Deck sidebar uses too much horizontal space and has low information density at smaller resolutions (~1366x768). Compared to T3 Code's sidebar, Panopticon wastes space with oversized defaults, generous padding, and large font sizes. This issue tightens every spacing value in the sidebar to match T3 Code's density.

## Problem Statement

**Current behavior:** The sidebar defaults to 600px wide with generous padding (8-16px) on all elements. At laptop resolutions, this leaves less than half the viewport for the main content area. The left nav (Sidebar.tsx, 256px expanded) plus Command Deck sidebar (600px) consumes 856px — on a 1366px screen that leaves only 510px for content.

**Desired behavior:** The sidebar defaults to 320px with tighter padding throughout. Combined with the left nav, this gives ~790px to content — a 55% improvement.

**Impact:** Every Panopticon user on a laptop or non-ultrawide monitor loses significant workspace. The dashboard is the primary interface for monitoring agents, so this directly impacts daily usability.

## Functional Requirements

### FR1: Default Sidebar Width
- FR1.1: Default width changes from 600px to 320px for new users (no localStorage value)
- FR1.2: Max resize width capped at 500px (down from 600px)
- FR1.3: Min resize width stays at 240px
- FR1.4: Existing localStorage-persisted widths are respected (no forced reset)

### FR2: Sidebar Header Compaction
- FR2.1: Title ("Command Deck") font size: `var(--mc-font-size-md)` (16px) → `13px`
- FR2.2: Header padding: `var(--mc-space-3) var(--mc-space-4)` (12px 16px) → `var(--mc-space-2) var(--mc-space-3)` (8px 12px)
- FR2.3: Segment button padding: `var(--mc-space-1) var(--mc-space-2)` (4px 8px) → `2px 6px`

### FR3: List Item Density
- FR3.1: Conversation item padding: `8px 8px 8px 32px` → `4px 8px 4px 24px`
- FR3.2: Conversation item gap: `8px` → `6px`
- FR3.3: Feature item padding: `8px 16px 8px 32px` → `4px 8px 4px 24px`
- FR3.4: Feature item gap: `8px` → `6px`
- FR3.5: Project header padding: `8px 16px` → `6px 12px`

### FR4: Footer Compaction
- FR4.1: Footer padding: `8px 16px` → `4px 12px`

## Non-Functional Requirements

- No visual regressions in dark mode
- No layout shifts or overflow at minimum sidebar width (240px)
- No impact on content area styling
- Conversation names must still truncate with ellipsis (no overflow)

## Technical Design

### Files to Modify

1. **`src/dashboard/frontend/src/components/MissionControl/index.tsx`**
   - Line 73: Change default width `600` → `320`
   - Line 227: Change max resize `600` → `500`

2. **`src/dashboard/frontend/src/components/MissionControl/styles/mission-control.module.css`**
   - `.sidebarHeader` padding (line ~95)
   - `.sidebarTitle` font-size (line ~115)
   - `.segmentButton` padding (line ~141)
   - `.projectHeader` padding (line ~189)
   - `.featureItem` padding + gap (line ~229)
   - `.sidebarFooter` padding (line ~1038)
   - `.conversationItem` padding + gap (line ~1175)

### No Files to Create or Delete

This is purely a CSS + one JS constant change.

## Acceptance Criteria

- [ ] Default sidebar width is 320px (verified by clearing localStorage and reloading)
- [ ] Sidebar cannot be resized beyond 500px
- [ ] Title font is 13px, not 16px
- [ ] Header padding is 8px 12px
- [ ] Segment buttons have 2px 6px padding
- [ ] Conversation items have 4px vertical padding and 24px left indent
- [ ] Feature items have 4px vertical padding and 24px left indent
- [ ] Project headers have 6px 12px padding
- [ ] Footer has 4px 12px padding
- [ ] All spacing works correctly in dark mode
- [ ] No overflow/clipping at 240px minimum width
- [ ] TypeScript compiles cleanly
- [ ] Lint passes

## Risks and Mitigations

**Risk:** Users with existing localStorage width of 600px will still see wide sidebar.
**Mitigation:** This is acceptable — they chose that width. The default only affects new users or cleared storage.

**Risk:** Tighter spacing might feel cramped on large monitors.
**Mitigation:** The sidebar is resizable. Users on large screens can drag wider. The tighter defaults serve the more constrained case.
