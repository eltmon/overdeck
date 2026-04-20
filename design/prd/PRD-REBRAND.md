# PRD: Panopticon Dashboard Rebrand

**Issue:** PAN-460
**Author:** Ed Becker
**Date:** 2026-04-05
**Status:** Planning

---

## Executive Summary

Full visual rebrand of the Panopticon dashboard: rename "Mission Control" to "Command Deck", unify the design system around a T3Code-inspired aesthetic, fix the completely broken light/dark mode, replace the overcrowded horizontal nav with a grouped sidebar, update typography, and establish an official style guide for all current and future UI work.

## Motivation

### Problems with the current UI

1. **"Mission Control" name collision** — at least one competing AI agent orchestrator uses this name. The term is also overloaded across aerospace, gaming, and enterprise software.

2. **Three incompatible visual languages** — the main dashboard uses a blue-gray dark theme, Mission Control uses a warm cream Codex light theme (never supports dark mode), and God View uses a cyberpunk neon theme. These feel like three different products.

3. **Light mode is completely broken** — toggling to light mode produces white text on white backgrounds, invisible headings, dark nav bar with light content areas. Root cause: most components hardcode Tailwind color classes (`bg-gray-800`, `text-white`) instead of using the semantic CSS variable tokens defined in `index.css`.

4. **Overcrowded navigation** — 13+ items crammed into a single horizontal bar. Items get cut off at smaller viewports. No grouping or hierarchy — Board, Agents, Resources, Metrics, Skills, and Settings all have equal visual weight.

5. **No brand identity** — the current look is functional but generic. Standard gray panels, basic blue accent, nothing distinctive. A tool this powerful deserves a premium feel.

6. **Dialog positioning bugs** — the Plan dialog anchors to the right edge and gets cut off at many viewport widths (confirmed via Playwright screenshots).

### Design reference: T3Code

T3Code (`/home/eltmon/Projects/t3code`) is our primary design reference. Its design system demonstrates the quality bar we're targeting:

- **Fractal noise texture** — SVG `feTurbulence` noise at 3.5% opacity on `body::after`, giving the entire UI a subtle tactile quality
- **Tonal layering** — depth through background shifts, not heavy borders. Dark mode uses `color-mix()` for computed surfaces instead of flat hex values
- **Opacity-based borders** — borders at `white/6%` (dark) and `black/8%` (light), barely visible but architecturally meaningful
- **OKLCH color space** — perceptually uniform primary colors that look correct across both themes
- **Subtle inner shadows** — cards get `0_1px black/4%` (light) or `0_-1px white/6%` (dark)
- **DM Sans** body font — clean, modern, excellent at small sizes with variable weights 300-800
- **Rounded-2xl cards** (18px), rounded-lg buttons (10px) — generous but not playful

---

## Scope of Changes

### 1. Rename: Mission Control → Command Deck

**What changes:**
- Navigation label and icon (keep Compass icon)
- Route: `/mission-control` → `/command-deck`
- Page heading: "Mission Control" → "Command Deck"
- Component directory: `MissionControl/` → `CommandDeck/`
- CSS module: `mission-control.module.css` → integrated into global token system (kill the isolated Codex theme)
- All references in docs, server routes, API endpoints

**Why "Command Deck":**
- Fits the surveillance/oversight metaphor of "Panopticon"
- Not used by any competing AI orchestration tool
- Short, punchy, immediately understood
- Works as noun ("the Command Deck") and destination ("go to Command Deck")

**Candidates rejected:**
- "Watchtower" — feels static, passive
- "Bridge" — overloaded (network bridge, API bridge, Kubernetes Helm)
- "Nexus" — used by Sonatype, Google, etc.
- "Helm" — major Kubernetes tool

### 2. Navigation: Horizontal Bar → Grouped Sidebar

**Current:** 13 items in a single horizontal `<nav>` bar with icons + text labels. Items overflow at narrow viewports.

**New:** Collapsible left sidebar with grouped sections.

```
[Eye icon] Panopticon           [<< collapse]

OPERATIONS
  Command Deck     (Compass)
  Board            (LayoutGrid)    ← active: blue left accent
  Agents           (Bot)

INFRASTRUCTURE
  Resources        (Server)
  Convoys          (Network)
  Handoffs         (ArrowRightLeft)

OBSERVABILITY
  Activity         (Terminal)
  Metrics          (BarChart3)
  Costs            (DollarSign)
  Health           (HeartPulse)

SYSTEM
  Skills           (Cpu)
  Settings         (Settings)
  God View         (Zap)

──────────────────
[Avatar] eltmon               [Sun/Moon]
```

**Specs:**
- Expanded width: `256px` (matches T3Code's `--sidebar-width: 16rem`)
- Collapsed width: `48px` (icon-only, matches T3Code's `--sidebar-width-icon: 3rem`)
- Toggle: click collapse button or keyboard shortcut `[`
- Persist state: `localStorage.setItem('panopticon.ui.sidebarCollapsed', 'true')`
- Background: `var(--card)` (slightly lighter than page background)
- Group labels: `text-xs uppercase tracking-wider text-muted-foreground` with `mb-1 mt-4` spacing
- Active item: `2px left border-primary`, `bg-accent` background, `text-accent-foreground`
- Hover: `bg-accent` (white/4% overlay in dark, black/4% in light)
- Mobile: sidebar becomes a sheet (slide-in from left) triggered by hamburger button

**Components to modify:**
- `Header.tsx` — gut the horizontal nav, replace with sidebar trigger for mobile
- New: `Sidebar.tsx` — the sidebar component (reference T3Code's `sidebar.tsx`)
- `App.tsx` — update layout from `flex-col` to `flex-row` with sidebar + main area

### 3. Color System: Semantic Token Architecture

**Root cause of broken light mode:** Components use hardcoded Tailwind classes like `bg-gray-800`, `text-white`, `border-gray-700` instead of the semantic tokens defined in `index.css`. The CSS custom properties for light mode exist and are correct — they just aren't used by 90% of components.

**Fix strategy:** Replace ALL hardcoded color classes with semantic token classes. This is the single largest change in this PRD and touches every component.

**Token definitions** (modeled on T3Code's proven system):

```css
:root {
  color-scheme: light;
  --radius: 0.625rem; /* 10px base */

  /* Surfaces */
  --background: var(--color-white);
  --foreground: var(--color-neutral-800);
  --card: var(--color-white);
  --card-foreground: var(--color-neutral-800);
  --popover: var(--color-white);
  --popover-foreground: var(--color-neutral-800);

  /* Interactive */
  --primary: oklch(0.488 0.217 264);         /* blue */
  --primary-foreground: var(--color-white);
  --secondary: --alpha(var(--color-black) / 4%);
  --secondary-foreground: var(--color-neutral-800);
  --accent: --alpha(var(--color-black) / 4%);
  --accent-foreground: var(--color-neutral-800);

  /* Muted */
  --muted: --alpha(var(--color-black) / 4%);
  --muted-foreground: color-mix(in srgb, var(--color-neutral-500) 90%, var(--color-black));

  /* Borders & inputs */
  --border: --alpha(var(--color-black) / 8%);
  --input: --alpha(var(--color-black) / 10%);
  --ring: oklch(0.488 0.217 264);

  /* Semantic signal colors */
  --destructive: var(--color-red-500);
  --destructive-foreground: var(--color-red-700);
  --info: var(--color-blue-500);
  --info-foreground: var(--color-blue-700);
  --success: var(--color-emerald-500);
  --success-foreground: var(--color-emerald-700);
  --warning: var(--color-amber-500);
  --warning-foreground: var(--color-amber-700);

  /* Panopticon-specific signal colors */
  --signal-review: var(--color-purple-500);
  --signal-review-foreground: var(--color-purple-700);
  --signal-cost: var(--color-cyan-500);
  --signal-cost-foreground: var(--color-cyan-700);
}
```

**Dark mode** (applied via `@variant dark` or `.dark` class):

```css
@variant dark {
  color-scheme: dark;
  --background: color-mix(in srgb, var(--color-neutral-950) 95%, var(--color-white));
  --foreground: var(--color-neutral-100);
  --card: color-mix(in srgb, var(--background) 98%, var(--color-white));
  --card-foreground: var(--color-neutral-100);
  --popover: color-mix(in srgb, var(--background) 98%, var(--color-white));
  --popover-foreground: var(--color-neutral-100);
  --primary: oklch(0.588 0.217 264);
  --primary-foreground: var(--color-white);
  --secondary: --alpha(var(--color-white) / 4%);
  --secondary-foreground: var(--color-neutral-100);
  --accent: --alpha(var(--color-white) / 4%);
  --accent-foreground: var(--color-neutral-100);
  --muted: --alpha(var(--color-white) / 4%);
  --muted-foreground: color-mix(in srgb, var(--color-neutral-500) 90%, var(--color-white));
  --border: --alpha(var(--color-white) / 6%);
  --input: --alpha(var(--color-white) / 8%);
  --ring: oklch(0.588 0.217 264);
  --destructive: color-mix(in srgb, var(--color-red-500) 90%, var(--color-white));
  --destructive-foreground: var(--color-red-400);
  --info-foreground: var(--color-blue-400);
  --success-foreground: var(--color-emerald-400);
  --warning-foreground: var(--color-amber-400);
  --signal-review-foreground: var(--color-purple-400);
  --signal-cost-foreground: var(--color-cyan-400);
}
```

**Migration rules for every component:**

| Old (hardcoded)       | New (semantic)              |
|-----------------------|-----------------------------|
| `bg-gray-900`         | `bg-background`             |
| `bg-gray-800`         | `bg-card`                   |
| `bg-gray-700`         | `bg-accent` or `bg-muted`   |
| `text-white`          | `text-foreground`           |
| `text-gray-300`       | `text-foreground`           |
| `text-gray-400`       | `text-muted-foreground`     |
| `text-gray-500`       | `text-muted-foreground`     |
| `border-gray-700`     | `border-border`             |
| `border-gray-600`     | `border-border`             |
| `bg-blue-600`         | `bg-primary`                |
| `text-blue-400`       | `text-primary`              |
| `bg-green-*`          | `bg-success/8` (badge bg)   |
| `text-green-*`        | `text-success-foreground`   |
| `bg-red-*`            | `bg-destructive/8`          |
| `text-red-*`          | `text-destructive-foreground`|
| `bg-amber-*`          | `bg-warning/8`              |
| `text-amber-*`        | `text-warning-foreground`   |
| `bg-purple-*`         | `bg-signal-review/8`        |
| `text-purple-*`       | `text-signal-review-foreground` |
| `text-cyan-*`         | `text-signal-cost-foreground`|

### 4. Typography Update

**Current:** Space Grotesk (display) + Noto Sans (body)
**New:** DM Sans (universal body) + Space Grotesk (sidebar wordmark ONLY) + SF Mono (code / technical identifiers)

**Why DM Sans over Noto Sans:**
- DM Sans is what T3Code uses — proven in a similar dashboard context
- Variable weight support (300-800) gives more typographic control
- Better at small sizes (data-dense dashboards need this)
- More distinctive character than Noto Sans

**Font loading** (update `index.html`):
```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="preload" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=DM+Sans:ital,opsz,wght@0,9..40,300..800;1,9..40,300..800&display=swap" as="style" />
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=DM+Sans:ital,opsz,wght@0,9..40,300..800;1,9..40,300..800&display=swap" rel="stylesheet" />
```

**Tailwind config:**
```js
fontFamily: {
  display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
  body: ['"DM Sans"', 'system-ui', 'sans-serif'],
  mono: ['"SF Mono"', '"SFMono-Regular"', 'Consolas', '"Liberation Mono"', 'monospace'],
}
```

**Body default:**
```css
body {
  font-family: "DM Sans", system-ui, sans-serif;
}
```

**CRITICAL: The Four Canonical Typography Rules (PAN-698)**

These rules are absolute. There are no exceptions outside God View.

1. **DM Sans is the universal default for all non–God-View UI.** Body text, headings, labels, nav, buttons, dialogs, tables, forms, metric values, conversation prose, list titles, metadata — everything uses DM Sans unless explicitly covered by Rule 2 or 3.

2. **SF Mono is ONLY for code and technical identifiers.** Code blocks, terminal output, command snippets, session IDs, run IDs, file paths, env vars, hashes, model IDs, branch names, tool names, vBRIEF IDs.

3. **Space Grotesk (`font-display`) is ONLY for the sidebar "Panopticon" wordmark.** No other non–God-View surface uses `font-display`. Page titles, section headings, nav labels, stat values, card titles — all DM Sans.

4. **God View uses its own scoped typography system.** God View (`src/dashboard/frontend/src/components/GodView/*`) is the only deliberate exception to Rules 1–3.

See `design/style-guide/STYLE-GUIDE.md` Section 2 for the full specification.

### 5. Fractal Noise Texture Overlay

Borrowed directly from T3Code. Adds a subtle tactile quality to the entire UI.

**Add to `index.css`:**
```css
body::after {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  opacity: 0.035;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  background-repeat: repeat;
  background-size: 256px 256px;
}
```

This single addition dramatically changes the feel from "generic SaaS dashboard" to "premium desktop application."

### 6. Component Unification

All components must follow the same design language. No more isolated theme islands (Codex light for Mission Control, cyberpunk for God View).

**Cards:**
```
Background: bg-card
Border: border border-border (opacity-based, barely visible)
Radius: rounded-2xl (18px)
Inner shadow (light): before:shadow-[0_1px_theme(--color-black/4%)]
Inner shadow (dark): before:shadow-[0_-1px_theme(--color-white/6%)]
Padding: p-6 (24px) default, p-4 (16px) compact
Status accent: 2px left border in signal color
Hover: bg-accent transition-colors duration-200
```

**Buttons:**
```
Primary: bg-primary text-primary-foreground rounded-lg shadow-xs/5
Secondary: bg-secondary text-secondary-foreground rounded-lg
Ghost: hover:bg-accent text-foreground rounded-lg
Destructive: bg-destructive/8 text-destructive-foreground rounded-lg
Sizes: h-7 (xs), h-8 (sm), h-9 (default), h-10 (lg), h-11 (xl)
Focus: ring-[3px] ring-ring/24
Pressed: inset-shadow-[0_1px_theme(--color-black/8%)]
```

**Badges:**
```
Base: rounded-sm (6px) font-medium text-xs
Default: bg-primary text-primary-foreground
Semantic: bg-{color}/8 text-{color}-foreground border border-{color}/32
Sizes: h-5 (sm), h-5.5 (default), h-6.5 (lg)
```

**Dialogs:**
```
Backdrop: bg-black/32 backdrop-blur-sm
Panel: bg-popover text-popover-foreground rounded-2xl border shadow-lg/5
Animation: scale-98 → scale-100, opacity-0 → opacity-100, duration-200
Nested: scale down by 10% per nesting level
MUST center on viewport — NOT anchor to card position (fixes current bug)
```

**Status indicators:**
```
Dot: 8px filled circle in signal color (inline)
Badge: pill with semantic bg at /8 opacity
Consistent across ALL views — no mixing dot + badge + colored-text for same concept
```

### 7. Scrollbar Styling

Borrow T3Code's minimal scrollbar:

```css
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.15); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: rgba(0, 0, 0, 0.25); }
.dark ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); }
.dark ::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.18); }
```

### 8. Theme Toggle Transition Suppression

Prevent flash of unstyled transitions during theme changes (from T3Code):

```css
.no-transitions,
.no-transitions *,
.no-transitions *::before,
.no-transitions *::after {
  transition-duration: 0s !important;
  animation-duration: 0s !important;
}
```

Apply `.no-transitions` to `<html>` briefly during theme toggle, then remove.

### 9. Kill the Mission Control Codex Theme

The `mission-control.module.css` file (1211 lines) defines an entirely separate design language with its own color variables (`--mc-bg-main`, `--mc-text-primary`, etc.). This must be deleted entirely.

The Command Deck component should use the same global token system as every other page. The comment in the CSS file says "Mission Control always uses its own Codex light theme — no dark mode overrides. This is intentional" — this is no longer intentional. It was a quick-ship decision that created a maintenance burden and a broken user experience.

### 10. God View: Keep But Integrate

God View is intentionally a "cinematic mode" — it should feel different. But it should still use the same token foundation and simply override specific values in its scoped CSS. The current approach of a completely separate `theme.css` with hardcoded hex values (#0a0e1a, #00d4ff, etc.) should be replaced with scoped overrides on the semantic tokens.

---

## Border Radius Scale

Adopt T3Code's radius scale based on a 10px base:

| Token | Value | Use |
|-------|-------|-----|
| `--radius-sm` | 6px | Badges, small elements |
| `--radius-md` | 8px | Inline code blocks |
| `--radius-lg` | 10px | Buttons, inputs, selects, toggles |
| `--radius-xl` | 14px | Larger interactive elements |
| `--radius-2xl` | 18px | Cards, dialogs, panels |
| `--radius-3xl` | 22px | Hero sections |
| `--radius-4xl` | 26px | Full-page overlays |

---

## Asset Generation Strategy

### Stitch (Google AI Design Tool)

**Stitch project:** `projects/4014658539033902919` ("Panopticon Dashboard Rebrand")
**Design systems created:**
- "Obsidian & Signal" (`assets/14564320821242961935`) — original proposal
- "Panopticon — T3Code-Inspired" (`assets/1053371932029435838`) — refined version

**Screens generated (all in `design/stitch-exports/`):**
- `board-view-dark.png/.html` — Original dark board
- `command-deck-dark.png/.html` — Command Deck view
- `agents-view-dark.png/.html` — Agents list view
- `board-view-light.png/.html` — Light mode board
- `board-v2-t3-dark.png/.html` — T3Code-inspired board (latest, preferred)

**Use Stitch for:** Prototyping new views, generating component variants, iterating on layout before coding.

### Nano Banana (Gemini Image Generation)

**What it is:** Google Gemini's native image generation (`gemini-2.5-flash-image`, `gemini-3.1-flash-image-preview`, `gemini-3-pro-image-preview`).

**Use for:** Generating custom background textures, decorative SVG patterns, splash/hero images, and marketing assets. The fractal noise overlay is a CSS-only solution borrowed from T3Code, but Nano Banana can generate more sophisticated tileable textures if we want to go beyond the basic noise.

**NOT needed for initial implementation** — the fractal noise texture from T3Code is sufficient and requires zero external assets (it's an inline SVG data URI).

---

## Files That Must Change

### Core styling files
- `src/dashboard/frontend/src/index.css` — Complete rewrite: new token definitions, noise texture, scrollbar, transitions
- `src/dashboard/frontend/tailwind.config.js` — Update color tokens, font families, radius scale, remove old `pan-*` color definitions

### Layout & navigation
- `src/dashboard/frontend/src/components/Header.tsx` — Replace horizontal nav with minimal top bar (logo + breadcrumb + controls)
- NEW: `src/dashboard/frontend/src/components/Sidebar.tsx` — Collapsible grouped sidebar
- `src/dashboard/frontend/src/App.tsx` — Restructure layout: sidebar + main content area

### Rename Mission Control → Command Deck
- `src/dashboard/frontend/src/components/MissionControl/` → `CommandDeck/`
- `src/dashboard/frontend/src/components/MissionControl/styles/mission-control.module.css` — DELETE entirely
- `src/dashboard/server/routes/mission-control.ts` — Rename route
- All imports referencing MissionControl

### Every component using hardcoded colors
- `src/dashboard/frontend/src/components/KanbanBoard.tsx`
- `src/dashboard/frontend/src/components/AgentList.tsx`
- `src/dashboard/frontend/src/components/HealthDashboard.tsx`
- `src/dashboard/frontend/src/components/MetricsPage.tsx`
- `src/dashboard/frontend/src/components/CostsPage.tsx`
- `src/dashboard/frontend/src/components/SettingsPage.tsx`
- `src/dashboard/frontend/src/components/GodView/` (partial — keep scoped overrides)
- `src/dashboard/frontend/src/components/DetailPanelLayout.tsx`
- `src/dashboard/frontend/src/components/inspector/`
- `src/dashboard/frontend/src/components/search/`
- `src/dashboard/frontend/src/components/vbrief/`
- `src/dashboard/frontend/src/components/XTerminal.tsx`
- `src/dashboard/frontend/src/components/Settings/`
- `src/dashboard/frontend/src/components/skeletons/`
- `src/dashboard/frontend/src/pages/SpecialistDetail.tsx`
- `src/dashboard/frontend/src/pages/SpecialistRunLog.tsx`

### Theme system
- `src/dashboard/frontend/src/hooks/useTheme.ts` — Update to add no-transitions class during toggle
- `src/dashboard/frontend/index.html` — Update font preloads, flash prevention script

### Dialog system
- `src/dashboard/frontend/src/components/DialogProvider.tsx` — Center dialogs on viewport

---

## Current State Screenshots

All captured via Playwright and stored in `design/screenshots/`:

| Screenshot | Description | Key Issues |
|------------|-------------|------------|
| `01-landing.png` | Board view, dark mode | Overcrowded nav, generic look |
| `02-mission-control.jpeg` | Mission Control, dark mode | Completely different visual language (Codex) |
| `03-agents.jpeg` | Agents page, dark mode | Functional but plain |
| `04-settings.jpeg` | Settings page, dark mode | Decent, could be more polished |
| `06-board-light.jpeg` | Board view, light mode | **Completely broken** — white on white |
| `08-settings-light.jpeg` | Settings, light mode | Headings invisible, provider cards unreadable |
| `09-plan-dialog.jpeg` | Planning dialog | Right-anchored, gets cut off |

---

## Implementation Notes

### This is a single feature delivery

Per CLAUDE.md: "Unless explicitly asked to break work into phases, deliver the entire feature in a single issue." This PRD describes one cohesive feature — a complete visual rebrand. All sections must be implemented together. Partial delivery (e.g., "just the sidebar" or "just the token migration") provides zero value because the visual inconsistency would be worse than the current state.

### Testing strategy

1. **Playwright visual regression** — screenshot every page in both light and dark mode before and after
2. **Manual verification** — check every page, dialog, and interactive state in both themes
3. **Responsive** — verify sidebar collapse/expand at various viewport widths
4. **Accessibility** — WCAG AA contrast ratios for all text-on-background combinations

### No backwards compatibility needed

The dashboard is an internal tool with one user. There are no third-party consumers of the CSS classes or component APIs. This means we can make sweeping changes without migration shims.

---

## Design References

| Reference | Location | What to borrow |
|-----------|----------|----------------|
| T3Code design system | `/home/eltmon/Projects/t3code/apps/web/src/index.css` | Token architecture, noise texture, scrollbars, color-mix(), OKLCH |
| T3Code card component | `/home/eltmon/Projects/t3code/apps/web/src/components/ui/card.tsx` | Inner shadows, radius, padding |
| T3Code button component | `/home/eltmon/Projects/t3code/apps/web/src/components/ui/button.tsx` | Size scale, variant pattern, pressed states |
| T3Code badge component | `/home/eltmon/Projects/t3code/apps/web/src/components/ui/badge.tsx` | Semantic color at /8 opacity |
| T3Code dialog component | `/home/eltmon/Projects/t3code/apps/web/src/components/ui/dialog.tsx` | Backdrop blur, scale animation, nested scaling |
| T3Code sidebar | `/home/eltmon/Projects/t3code/apps/web/src/components/ui/sidebar.tsx` | Width specs, collapse behavior, resize |
| Stitch mockups | `design/stitch-exports/board-v2-t3-dark.html` | Layout composition, sidebar grouping |
| Current screenshots | `design/screenshots/` | Before state for comparison |

---

## Style Guide

The official Panopticon style guide lives at `design/style-guide/STYLE-GUIDE.md` and is the canonical reference for all UI decisions. Every new feature and every existing component must conform to it after this rebrand.
