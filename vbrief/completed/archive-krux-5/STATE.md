# KRUX-5: Multi-pane UI — Planning State

## Decisions

### Resizable Panes
- **Library:** `allotment` — VS Code-style split panes with drag handles
- **Layout:** Nested L-shape with config overlay
  - **Outer Allotment** (horizontal): Transcript (50%) | Right Panel (50%)
  - **Inner Allotment** (vertical, inside Right Panel): Questions (50%) | Insights (50%)
  - **Config:** Slide-over overlay panel from the right, toggled by header button (not part of allotment)
- **Min sizes:** Transcript ~200px min, Questions/Insights ~120px min each
- **Default proportions:** 50/50 horizontal, 50/50 vertical within right panel

### Config Sidebar as Overlay
- **Current behavior preserved:** Toggle button in header shows/hides config
- **New behavior:** Config slides in from the right as an overlay panel (CSS transform + transition)
- **Overlay style:** Semi-transparent backdrop or drop-shadow, slides over content panes
- **Width:** ~280px (wider than current w-56/224px to accommodate controls comfortably)
- **Z-index:** Above allotment panes, below modals if any

### Auto-scroll Behavior
- **Pattern:** "Stick to bottom" — auto-scroll while user is at bottom, pause when user scrolls up
- **Resume:** Auto-scroll resumes when user scrolls back to bottom (or clicks a "Jump to latest" button)
- **Implementation:** Custom `useAutoScroll` hook using `scrollTop + clientHeight >= scrollHeight - threshold`

### Dismiss / Pin for Questions & Insights
- **UI:** Each InsightCard gets a pin icon (toggle) and dismiss (X) button in the card header
- **Dismiss animation:** Borrow from Mind Your Now's `task-completing-wavy` pattern:
  - Wavy strikethrough line draws left-to-right across card text
  - Text fades from normal color → muted gray at ~50% opacity
  - Card remains visible but clearly "struck through" — still legible
  - Duration: ~1.5s (slightly faster than MYN's 2s since cards are shorter)
  - Color: Use category color for the strikethrough (emerald for insights, blue for questions, amber for conflicts, purple for action items)
- **Pinned behavior:** Pinned items float to top of their list. Pin icon shows filled state.
- **State:** Managed in renderer via `useInsightActions` hook, persisted to disk via IPC

### Persistence
- **Format:** JSON file at `app.getPath('userData')/sessions/<session-id>.json`
- **Contents:** `{ pinned: string[], dismissed: string[] }` (arrays of InsightItem IDs)
- **IPC:** `insight-state:save` / `insight-state:load` channels
- **Lifecycle:** New file per session start, loaded when session begins, saved on each pin/dismiss action
- **Type name:** `InsightPersistence` (avoids conflict with existing `SessionState` type)

### Session Status Badge
- **Location:** Header bar, between app title and config toggle button
- **States:**
  - `idle` — hidden
  - `recording` — red pulsing dot + "Recording" label
  - `paused` — amber dot + "Paused" label
  - `stopping` / `stopped` — gray dot + "Stopped" label
  - `error` — red dot + "Error" label

### Transcript Timestamps
- **Current gap:** TranscriptPane shows speaker labels and text but no timestamps
- **Fix:** Display `HH:MM:SS` timestamp at the start of each entry using `entry.timestamp`

### Dark Theme
- Already in place from KRUX-1. No changes needed.

## Architecture

### Layout Diagram

```
┌─────────────────────────────────────────────────────┐
│ [Krux] AI Meeting Companion  ●Recording    [Config] │  ← Header with SessionBadge
├─────────────────────────┬───────────────────────────┤
│                         │       Questions           │
│                         │  (scrollable, pin/dismiss) │
│      Transcript         ├ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┤  ← Allotment vertical divider
│   (auto-scroll, HH:MM) │       Insights            │
│                         │  (scrollable, pin/dismiss) │
│         50%             │         50%               │
├─────────────────────────┴───────────────────────────┤
│  ← Outer Allotment horizontal divider               │
└─────────────────────────────────────────────────────┘

Config overlay (when toggled):
┌──────────────────────────────────────┬──────────────┐
│                                      │   Config     │
│         (content panes)              │  (slide-in)  │
│                                      │   ~280px     │
└──────────────────────────────────────┴──────────────┘
```

### Files to Create
| File | Purpose |
|------|---------|
| `src/renderer/hooks/useAutoScroll.ts` | Stick-to-bottom scroll behavior |
| `src/renderer/hooks/useInsightActions.ts` | Pin/dismiss state + IPC persistence |
| `src/renderer/components/SessionBadge.tsx` | Header status indicator |
| `src/renderer/components/ConfigOverlay.tsx` | Slide-over config panel |
| `src/main/session-store.ts` | Read/write insight state JSON files |
| `src/renderer/styles/dismiss-animation.css` | Wavy strikethrough + fade animation (adapted from MYN) |

### Files to Modify
| File | Changes |
|------|---------|
| `package.json` | Add `allotment` dependency |
| `src/renderer/App.tsx` | Replace flex layout with nested Allotment; add SessionBadge; extract config to overlay; wire useInsightActions; pass pin/dismiss to InsightCards |
| `src/renderer/components/TranscriptPane.tsx` | Add timestamps; integrate useAutoScroll; add "Jump to latest" button |
| `src/renderer/components/InsightCard.tsx` | Add pin/dismiss buttons; accept callbacks; apply dismiss animation classes |
| `src/shared/types.ts` | Add `InsightPersistence` type (pinned/dismissed arrays) |
| `src/preload/index.ts` | Add insight-state IPC channels |
| `src/main/index.ts` | Register insight-state IPC handlers |
| `src/renderer/index.css` | Import allotment CSS + dismiss-animation.css |

### Dismiss Animation Reference (from MYN)
Key CSS classes to adapt:
- `task-completing-wavy` → `insight-dismissing` — applies wavy SVG strikethrough + text fade
- `task-complete` → `insight-dismissed` — final state: line-through, opacity 0.5
- Animation: `@keyframes task-strikethrough-draw` (scaleX 0→1), `@keyframes task-text-fade` (color → gray)
- Wavy line via inline SVG data URI in `::after` pseudo-element
- Adapt stroke color per category (emerald/blue/amber/purple instead of green)

### Out of Scope
- Drag-to-reorder panes
- Named layout presets (save/restore)
- Export insights to file/clipboard
- Keyboard shortcuts for pane navigation
- Light theme
- These may be addressed in future KRUX issues

## Task Breakdown

| # | Bead ID | Task | Difficulty | Depends On |
|---|---------|------|------------|------------|
| 1 | krux-29 | Install allotment, import CSS | trivial | — |
| 2 | krux-30 | Nested resizable pane layout with allotment + config overlay | complex | 1 |
| 3 | krux-31 | Smart auto-scroll with "stick to bottom" | medium | — |
| 4 | krux-32 | Transcript timestamps (HH:MM:SS) | simple | — |
| 5 | krux-33 | Dismiss animation CSS + pin/dismiss UI on InsightCard | medium | — |
| 6 | krux-34 | Insight state persistence (main process + IPC) | medium | — |
| 7 | krux-35 | Wire pin/dismiss state through hooks + persistence | medium | 5, 6 |
| 8 | krux-36 | Session status badge in header | simple | — |
| 9 | krux-37 | Integration testing and polish | medium | 2, 3, 4, 7, 8 |

## Specialist Feedback

- **[2026-03-22T02:21Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/001-review-agent-changes-requested.md`
