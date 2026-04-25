# PAN-460: Dashboard Rebrand — Planning State

**Issue:** https://github.com/eltmon/panopticon-cli/issues/460
**Status:** Planning complete
**Date:** 2026-04-06

---

## Decisions Made

### 1. God View: Token foundation only
Replace hardcoded hex values in `GodView/theme.css` with scoped overrides on semantic tokens. Keep the cyberpunk aesthetic intact. Don't redesign God View's visual identity.

### 2. API rename: Full rename
Rename both frontend routes (`/mission-control` -> `/command-deck`) and server API endpoints (`/api/mission-control/*` -> `/api/command-deck/*`). Clean break, no legacy naming. Internal tool with one user — no backwards compat needed.

### 3. Chat components: Included in rebrand
All 9 chat/* component files get the full token migration treatment as part of Command Deck.

### 4. Sidebar: Custom component
Build `Sidebar.tsx` from scratch following T3Code's patterns (collapse, groups, localStorage persistence). No shadcn/ui dependency.

---

## Architecture Overview

### Token Migration Strategy
The root cause of broken light/dark mode is 292 hardcoded Tailwind color classes (e.g., `bg-gray-800`, `text-white`) across 54 component files. These ignore the CSS custom properties that already exist for theming.

**Fix:** Replace the current RGB-triplet token system in `index.css` with T3Code's semantic token architecture (OKLCH primary, `color-mix()` surfaces, `--alpha()` borders). Update `tailwind.config.js` to expose these tokens. Then mechanically migrate all 54 component files using the PRD's migration table.

### Layout Transformation
Current: 60px fixed horizontal header with 13 tab items.
New: Collapsible left sidebar (256px expanded / 48px collapsed) with grouped sections (Operations, Infrastructure, Observability, System). Minimal top bar for logo + breadcrumb + controls.

### Mission Control -> Command Deck
- Delete `mission-control.module.css` (1,829 lines of isolated Codex theme)
- Rename component directory `MissionControl/` -> `CommandDeck/`
- Rename server route file and all API endpoints
- Command Deck uses the same global token system as every other page (no more light-only island)

### Typography
- Body font: Noto Sans -> DM Sans (Google Fonts, variable weight 300-800)
- Display font: Space Grotesk (sidebar Panopticon wordmark ONLY — PAN-698)
- Code font: SF Mono stack
- Weight: `font-medium` (500) everywhere. No bold, no semibold.

### Visual Enhancements
- Fractal noise texture: `body::after` with SVG feTurbulence at 3.5% opacity
- Scrollbar styling: 6px width, opacity-based thumb colors
- Theme toggle transition suppression: `.no-transitions` class during toggle
- Cards: `rounded-2xl`, opacity-based borders, inner shadows
- Dialogs: viewport-centered, backdrop blur, scale animation

---

## Scope

### In Scope
- Complete semantic token architecture (light + dark)
- All 54 component files migrated to semantic tokens
- Sidebar navigation replacing horizontal nav
- Mission Control -> Command Deck (frontend + server API)
- Typography update (DM Sans body, font-medium everywhere)
- Fractal noise texture, scrollbar styling, transition suppression
- God View token foundation (scoped overrides, keep cyberpunk aesthetic)
- Dialog centering fix
- Chat component token migration

### Out of Scope
- God View visual redesign
- New feature development
- Backend logic changes (beyond route/endpoint renaming)
- Mobile-native responsive design (sidebar sheet for mobile is in scope)

---

## Risk Areas

1. **Token migration volume** — 292 occurrences across 54 files is mechanical but high-volume. Risk of missing spots that only show up in light mode.
2. **Mission Control CSS deletion** — 1,829 lines of CSS removed. Command Deck components must be verified to render correctly with global tokens.
3. **Sidebar layout shift** — Changing from top nav to side nav affects every page's available content width. May expose layout assumptions.
4. **God View scoped overrides** — Must verify cyberpunk colors still work when built on top of semantic token foundation.

---

## Key Files

### Must Create
- `src/dashboard/frontend/src/components/Sidebar.tsx` — New grouped sidebar navigation

### Must Delete
- `src/dashboard/frontend/src/components/MissionControl/styles/mission-control.module.css` — 1,829 lines of isolated Codex theme

### Must Rename
- `src/dashboard/frontend/src/components/MissionControl/` -> `CommandDeck/`
- `src/dashboard/server/routes/mission-control.ts` -> `command-deck.ts`

### Must Rewrite
- `src/dashboard/frontend/src/index.css` — New token architecture
- `src/dashboard/frontend/tailwind.config.js` — New color/font/radius config
- `src/dashboard/frontend/src/components/Header.tsx` — Minimal top bar
- `src/dashboard/frontend/src/App.tsx` — Sidebar + main content layout
- `src/dashboard/frontend/index.html` — Font preloads (DM Sans)

### Must Migrate (54 files)
All component files with hardcoded color classes — see PRD "Files That Must Change" section for complete list.

---

## Design References
- **PRD:** `design/prd/PRD-REBRAND.md`
- **Style Guide:** `design/style-guide/STYLE-GUIDE.md`
- **Mockups (preferred):** `design/stitch-exports/board-v2-t3-dark.html`, `board-v2-t3-light.html`
- **T3Code reference:** `/home/eltmon/Projects/t3code/apps/web/src/index.css`
- **Current screenshots:** `design/screenshots/`
