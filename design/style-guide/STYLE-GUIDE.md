# Panopticon Style Guide

**Version:** 1.0
**Issue:** PAN-460
**Last Updated:** 2026-04-05
**Design Reference:** T3Code (`/home/eltmon/Projects/t3code/apps/web/src/index.css`)

---

This is the canonical reference for all Panopticon dashboard UI decisions. Every new feature and every existing component must conform to this guide. If something isn't covered here, look at T3Code's implementation first, then ask.

---

## 1. Design Philosophy

**Quiet precision.** The dashboard exists to surface signal from noise — AI agent status, costs, progress, problems. Every visual element must earn its place. If it's not conveying information, it should be recessive.

**Core principles:**
- Depth through tonal shifts, not borders or shadows
- Color means something — never decorative
- Typography carries hierarchy, not size alone
- Motion is functional (feedback, state transitions), never gratuitous
- Both light and dark modes are first-class citizens

---

## 2. Typography

### Font Stack

| Role | Font | Weights | Fallbacks |
|------|------|---------|-----------|
| **Display / Headings** | Space Grotesk | 400, 500, 600, 700 | system-ui, sans-serif |
| **Body / UI** | DM Sans | 300–800 (variable) | -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif |
| **Code / Terminal** | SF Mono | 400, 500 | SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace |

### Why These Fonts

- **Space Grotesk** — geometric, technical, tight apertures. Conveys precision and monitoring. Used for page titles, section headings, nav labels, stat values.
- **DM Sans** — clean geometric sans with a distinctive single-story "g" (open tail). Variable weight (300–800) gives fine typographic control. Excellent legibility at small sizes in data-dense layouts. Proven in T3Code's dashboard context.
- **SF Mono** — the standard for terminal and code rendering. Falls back gracefully across platforms.

### Font Loading

```html
<!-- index.html -->
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=DM+Sans:ital,opsz,wght@0,9..40,300..800;1,9..40,300..800&display=swap"
  rel="stylesheet"
/>
```

### Tailwind Config

```js
fontFamily: {
  display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
  body: ['"DM Sans"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'system-ui', 'sans-serif'],
  mono: ['"SF Mono"', '"SFMono-Regular"', 'Consolas', '"Liberation Mono"', 'Menlo', 'monospace'],
}
```

### CSS Default

```css
body {
  font-family: "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
}

pre, code, textarea.code, input.code {
  font-family: "SF Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
}
```

### Type Scale

Use Tailwind's default scale. Recommended pairings:

| Element | Size | Weight | Font |
|---------|------|--------|------|
| Page title | `text-xl` (20px) | `font-semibold` (600) | Space Grotesk (`font-display`) |
| Section heading | `text-lg` (18px) | `font-semibold` (600) | Space Grotesk |
| Card title | `text-base` (16px) | `font-semibold` (600) | Space Grotesk |
| Body text | `text-sm` (14px) | `font-normal` (400) | DM Sans (default) |
| Small labels | `text-xs` (12px) | `font-medium` (500) | DM Sans |
| Tiny badges | `text-[.625rem]` (10px) | `font-medium` (500) | DM Sans |
| Stat values | `text-xl` (20px) | `font-semibold` (600) | Space Grotesk |
| Nav items | `text-sm` (14px) | `font-medium` (500) | DM Sans |
| Nav group labels | `text-xs` (12px) | `font-medium` (500) | DM Sans, `uppercase tracking-wider` |

### Typography Rules

1. **Never use `font-bold` (700) for body text.** Reserve 700 for page titles and stat values only.
2. **Skip at least one scale step** between heading and subheading (e.g., `text-xl` with `text-sm`, not `text-lg` with `text-base`).
3. **Don't use 100% black text.** Use `text-foreground` (neutral-800 light / neutral-100 dark) for an ink-on-paper feel.
4. **Monospace font is only for code, terminal output, and issue IDs.** Never for UI labels.

---

## 3. Color System

### Architecture

Colors are defined as CSS custom properties on `:root` (light) and via `@variant dark` / `.dark` class (dark). Components reference these tokens via Tailwind utility classes. **No component may use hardcoded color values** like `bg-gray-800` or `text-white`.

### Light Mode Tokens

```css
:root {
  color-scheme: light;

  /* Surfaces */
  --background: var(--color-white);
  --foreground: var(--color-neutral-800);
  --card: var(--color-white);
  --card-foreground: var(--color-neutral-800);
  --popover: var(--color-white);
  --popover-foreground: var(--color-neutral-800);

  /* Primary */
  --primary: oklch(0.488 0.217 264);
  --primary-foreground: var(--color-white);

  /* Secondary / Accent / Muted — opacity overlays */
  --secondary: --alpha(var(--color-black) / 4%);
  --secondary-foreground: var(--color-neutral-800);
  --accent: --alpha(var(--color-black) / 4%);
  --accent-foreground: var(--color-neutral-800);
  --muted: --alpha(var(--color-black) / 4%);
  --muted-foreground: color-mix(in srgb, var(--color-neutral-500) 90%, var(--color-black));

  /* Borders & Inputs */
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

  /* Panopticon-specific */
  --signal-review: var(--color-purple-500);
  --signal-review-foreground: var(--color-purple-700);
  --signal-cost: var(--color-cyan-500);
  --signal-cost-foreground: var(--color-cyan-700);
}
```

### Dark Mode Tokens

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

### Key Principles

1. **OKLCH for primaries** — perceptually uniform. The primary blue is the same perceived brightness in both light and dark, just adjusted lightness (0.488 → 0.588).
2. **`color-mix()` for dark surfaces** — not flat hex values. `neutral-950 at 95% + white` creates a near-black that's warmer and more natural than pure `#000000`.
3. **Opacity-based borders** — `white/6%` in dark, `black/8%` in light. These are barely visible but architecturally meaningful. They define structure without creating visual noise.
4. **Semantic signals are the same hue** in both modes — only the foreground (text) variant shifts for contrast. `--success` is always emerald-500; `--success-foreground` shifts from emerald-700 (light) to emerald-400 (dark).

### Signal Color Usage

| Token | Color | Meaning |
|-------|-------|---------|
| `--info` / `--primary` | Blue | Primary actions, active state, info |
| `--success` | Emerald | Healthy, running, completed, merged |
| `--warning` | Amber | Planning, in-progress, needs attention |
| `--destructive` | Red | Error, stuck, dead, failed |
| `--signal-review` | Purple | In review, specialist activity |
| `--signal-cost` | Cyan | Cost figures, token counts, metrics |

### Forbidden Patterns

```
NEVER: bg-gray-800, bg-gray-900, bg-gray-700
USE:   bg-background, bg-card, bg-muted

NEVER: text-white, text-gray-300, text-gray-400
USE:   text-foreground, text-card-foreground, text-muted-foreground

NEVER: border-gray-700, border-gray-600
USE:   border-border

NEVER: bg-blue-600, text-blue-400
USE:   bg-primary, text-primary

NEVER: #22c55e, #ef4444, #f59e0b (hardcoded hex in components)
USE:   text-success, text-destructive, text-warning (semantic tokens)
```

---

## 4. Surfaces & Depth

### Tonal Layering (not shadows)

Depth is expressed through background value shifts, not drop shadows. This is the single most important aesthetic principle.

```
Level 0 (Page):     bg-background     — the deepest surface
Level 1 (Sidebar):  bg-card           — slightly lighter
Level 2 (Cards):    bg-card           — same as sidebar (lifted by context)
Level 3 (Popover):  bg-popover        — same value, but uses shadow for floating elements
Level 4 (Hover):    bg-accent         — subtle highlight (4% overlay)
```

### When to Use Shadows

Shadows are reserved for **floating elements only** — elements that overlap other content:

- Dialogs/modals
- Dropdown menus
- Tooltips
- Popovers
- Dragged items (kanban card being moved)

**Never use shadows on inline cards, panels, or layout sections.** These get their lift from tonal contrast with their parent surface.

### Shadow Scale

```css
shadow-xs/5    — buttons, inputs (barely visible)
shadow-sm/5    — floating badges, small popovers
shadow-md/5    — tooltips, small menus
shadow-lg/5    — dialogs, large menus, sheets
```

The `/5` suffix means 5% opacity — shadows should be subtle.

### Inner Shadows (Cards)

Cards get a 1px inner shadow to create a subtle bevel effect:

```css
/* Light mode: top edge highlight */
before:shadow-[0_1px_theme(--color-black/4%)]

/* Dark mode: bottom edge highlight */
before:shadow-[0_-1px_theme(--color-white/6%)]
```

This is applied via a `::before` pseudo-element.

---

## 5. Border Radius Scale

Based on T3Code's 10px base radius with computed scale:

```css
--radius: 0.625rem;  /* 10px */
--radius-sm:  calc(var(--radius) - 4px);   /*  6px */
--radius-md:  calc(var(--radius) - 2px);   /*  8px */
--radius-lg:  var(--radius);               /* 10px */
--radius-xl:  calc(var(--radius) + 4px);   /* 14px */
--radius-2xl: calc(var(--radius) + 8px);   /* 18px */
--radius-3xl: calc(var(--radius) + 12px);  /* 22px */
--radius-4xl: calc(var(--radius) + 16px);  /* 26px */
```

### Component Mapping

| Component | Radius | Tailwind |
|-----------|--------|----------|
| Badges, small pills | 6px | `rounded-sm` |
| Inline code blocks | 8px | `rounded-md` |
| Buttons, inputs, selects, toggles | 10px | `rounded-lg` |
| Large interactive elements | 14px | `rounded-xl` |
| Cards, dialogs, panels | 18px | `rounded-2xl` |
| Hero sections, God View cards | 22px | `rounded-3xl` |
| Full-page overlays | 26px | `rounded-4xl` |
| Circular elements (avatars, dots) | 50% | `rounded-full` |

---

## 6. Spacing & Sizing

### Spacing Scale

Use Tailwind's default 4px-based scale. Common patterns:

| Pattern | Value | Use |
|---------|-------|-----|
| `gap-1` | 4px | Between badge items, tight groups |
| `gap-1.5` | 6px | Between small elements |
| `gap-2` | 8px | Between list items, icon + text |
| `gap-3` | 12px | Between card sections |
| `gap-4` | 16px | Between cards, major sections |
| `gap-6` | 24px | Page-level spacing |
| `p-4` | 16px | Compact card padding |
| `p-6` | 24px | Default card padding |
| `px-3` | 12px | Button horizontal padding |

### Height Scale (Interactive Elements)

| Size | Height | Use |
|------|--------|-----|
| `xs` | `h-7` (28px) | Tiny actions, inline badges |
| `sm` | `h-8` (32px) | Compact buttons, small inputs |
| `default` | `h-9` (36px) | Standard buttons, inputs |
| `lg` | `h-10` (40px) | Prominent buttons |
| `xl` | `h-11` (44px) | Touch-friendly, hero CTAs |

---

## 7. Components

### Cards

```
Container:
  bg-card text-card-foreground
  rounded-2xl
  border border-border
  Pseudo-element inner shadow (see Section 4)

Card with status accent:
  Add: border-l-2 border-l-{signal-color}

Padding:
  Default: p-6
  Compact: p-4

Hover (when interactive):
  hover:bg-accent
  transition-colors duration-200
```

### Buttons

```
Base:
  rounded-lg border font-medium text-sm
  transition-shadow duration-200
  focus-visible:ring-[3px] focus-visible:ring-ring/24 focus-visible:ring-offset-1

Variants:
  Primary:     bg-primary text-primary-foreground shadow-xs/5
               active:inset-shadow-[0_1px_theme(--color-black/8%)]
  Secondary:   bg-secondary text-secondary-foreground
  Ghost:       bg-transparent hover:bg-accent text-foreground
  Outline:     border border-input bg-background hover:bg-accent
  Destructive: bg-destructive text-white
  Link:        text-primary underline-offset-4 hover:underline

Sizes:
  xs:      h-7  px-2  text-xs
  sm:      h-8  px-3  text-sm
  default: h-9  px-3  text-sm
  lg:      h-10 px-4  text-base
  xl:      h-11 px-5  text-base

Icon buttons:
  icon-sm: size-8    (32px square)
  icon:    size-9    (36px square)
  icon-lg: size-10   (40px square)

Icon sizing within buttons:
  Default: 18px (w-[18px] h-[18px])
  Small:   16px (w-4 h-4)
  Apply -mx-0.5 to icons for optical alignment
```

### Badges

```
Base:
  rounded-sm border border-transparent font-medium

Sizes:
  sm:      h-5    min-w-5    text-xs   px-1
  default: h-5.5  min-w-5.5  text-sm   px-1
  lg:      h-6.5  min-w-6.5  text-base px-1.5

Variants:
  Default:     bg-primary text-primary-foreground
  Outline:     border-input bg-background
  Info:        bg-info/8 text-info-foreground border-info/32
  Success:     bg-success/8 text-success-foreground border-success/32
  Warning:     bg-warning/8 text-warning-foreground border-warning/32
  Error:       bg-destructive/8 text-destructive-foreground border-destructive/32
  Review:      bg-signal-review/8 text-signal-review-foreground border-signal-review/32
  Cost:        bg-signal-cost/8 text-signal-cost-foreground border-signal-cost/32
```

The `/8` opacity background with `/32` opacity border creates a subtle tinted badge that communicates status without visual heaviness.

### Status Indicators

```
Status dot (inline):
  w-2 h-2 rounded-full bg-{signal-color}
  Use next to text, not as standalone element.

Status badge (labeled):
  Use Badge component with semantic variant (see above).

RULE: Pick ONE pattern per context. Don't mix dots + badges + colored text
      for the same concept in the same view.
```

### Dialogs / Modals

```
Backdrop:
  fixed inset-0 bg-black/32 backdrop-blur-sm
  z-50

Panel:
  bg-popover text-popover-foreground
  rounded-2xl border border-border
  shadow-lg/5
  max-w-lg mx-auto  (CENTERED on viewport — never anchored to trigger element)
  p-6

Animation:
  Enter: scale-[0.98] opacity-0  →  scale-100 opacity-100
  Exit:  scale-100 opacity-100   →  scale-[0.98] opacity-0
  Duration: 200ms ease-in-out

Nested dialogs:
  Each nesting level scales down by 10%:
  scale-[calc(1-0.1*var(--nested-dialogs))]

Header:
  flex items-center gap-3 mb-4
  Icon (if present): size-10 rounded-xl bg-primary/10 text-primary
  Title: font-display text-lg font-semibold
  Description: text-sm text-muted-foreground

Footer:
  flex justify-end gap-2 mt-6
  Primary action on right, cancel on left
```

### Inputs

```
Container:
  h-9 rounded-lg border border-input bg-background shadow-xs/5
  px-3 text-sm text-foreground
  placeholder:text-muted-foreground/72

Focus:
  ring-[3px] ring-ring/24 border-ring

Invalid:
  border-destructive/36 ring-destructive/16

Sizes:
  sm:      h-7.5  (30px)
  default: h-8.5  (34px)
  lg:      h-9.5  (38px)

Labels:
  text-xs font-medium text-muted-foreground
  mb-1.5 (6px above input)
```

### Tooltips

```
Popup:
  rounded-md border border-border bg-popover shadow-md/5
  text-xs text-popover-foreground
  px-2 py-1

Animation:
  scale-[0.98] opacity-0 → scale-100 opacity-100
  Duration: 150ms
```

### Switches / Toggles

```
Track:
  Unchecked: bg-input
  Checked:   bg-primary
  rounded-full
  transition-colors duration-150

Thumb:
  bg-white rounded-full shadow-sm/5
  Size: 20px (default), 16px (small)
  Translate on check
```

### Select / Dropdown

```
Trigger:
  Same as Input styling (rounded-lg, border-input)
  Chevron icon: ChevronsUpDown (16-18px), text-muted-foreground

Popup:
  rounded-lg border border-border bg-popover shadow-lg/5
  p-1

Item:
  rounded-md px-2 py-1.5 text-sm
  hover:bg-accent
  Selected: bg-accent text-accent-foreground
```

### Alerts

```
Base:
  rounded-xl border px-3.5 py-3 text-sm

Variants:
  Default: border-border bg-transparent
  Info:    border-info/32 bg-info/4
  Success: border-success/32 bg-success/4
  Warning: border-warning/32 bg-warning/4
  Error:   border-destructive/32 bg-destructive/4

Icon: size matches line-height, w-4
```

### Skeleton Loading

```
Base:
  rounded-sm bg-muted animate-skeleton

Animation:
  @keyframes skeleton {
    to { background-position: -200% 0; }
  }
  animate-skeleton: skeleton 2s -1s infinite linear

  Creates a subtle shimmer effect via gradient translation.
```

---

## 8. Navigation (Sidebar)

### Structure

```
Sidebar
├── Logo section (Panopticon eye + text)
├── Group: OPERATIONS
│   ├── Command Deck (Compass icon)
│   ├── Board (LayoutGrid icon)
│   └── Agents (Bot icon)
├── Group: INFRASTRUCTURE
│   ├── Resources (Server icon)
│   ├── Convoys (Network icon)
│   └── Handoffs (ArrowRightLeft icon)
├── Group: OBSERVABILITY
│   ├── Activity (Terminal icon)
│   ├── Metrics (BarChart3 icon)
│   ├── Costs (DollarSign icon)
│   └── Health (HeartPulse icon)
├── Group: SYSTEM
│   ├── Skills (Cpu icon)
│   ├── Settings (Settings icon)
│   └── God View (Zap icon)
└── Footer (avatar + theme toggle + collapse)
```

### Specs

```
Expanded width:  256px  (16rem)
Collapsed width:  48px  (3rem)
Background:      bg-card
Border:          border-r border-border (right edge only)

Group label:
  text-xs uppercase tracking-wider text-muted-foreground font-medium
  px-3 mt-5 mb-1

Nav item:
  flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium
  text-muted-foreground
  hover:bg-accent hover:text-accent-foreground
  transition-colors duration-200

Active nav item:
  bg-accent text-foreground
  border-l-2 border-l-primary (left accent bar)

Collapsed mode:
  Show icons only, centered
  Tooltip on hover showing full label
  Group labels hidden
  Logo shows icon only (eye)

Toggle:
  Click collapse button in footer
  Keyboard shortcut: [ (left bracket)
  State persisted to localStorage('panopticon.ui.sidebarCollapsed')

Mobile:
  Sidebar becomes Sheet (slide from left)
  Triggered by hamburger button in top bar
  backdrop-blur-sm bg-black/32 overlay
```

---

## 9. Fractal Noise Texture

The signature visual detail. A barely-visible noise pattern overlaid on the entire viewport gives the UI a tactile, printed quality.

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

- **3.5% opacity** — visible on careful inspection, felt subconsciously
- **Fixed position** — doesn't scroll with content
- **pointer-events: none** — doesn't interfere with interactions
- **No external asset** — the SVG is inlined as a data URI
- **256px tile** — small enough to not create visible patterns, stitched seamlessly

---

## 10. Scrollbars

Minimal, unobtrusive scrollbars:

```css
::-webkit-scrollbar {
  width: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.15);
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.25);
}

.dark ::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
}

.dark ::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.18);
}
```

---

## 11. Theme Toggle

### Implementation

- Store theme in `localStorage('panopticon.ui.theme')` — values: `'light'` | `'dark'`
- Toggle by adding/removing `.dark` class on `<html>`
- Default: dark mode

### Flash Prevention

Apply theme before React mounts (in `index.html`):

```html
<script>
  (function() {
    var theme = localStorage.getItem('panopticon.ui.theme') || 'dark';
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    }
  })();
</script>
```

### Transition Suppression

Suppress all transitions during theme switch to prevent a flash of intermediate states:

```css
.no-transitions,
.no-transitions *,
.no-transitions *::before,
.no-transitions *::after {
  transition-duration: 0s !important;
  animation-duration: 0s !important;
}
```

In the toggle handler:

```typescript
function toggleTheme() {
  document.documentElement.classList.add('no-transitions');
  // ... apply theme change ...
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.documentElement.classList.remove('no-transitions');
    });
  });
}
```

The double `requestAnimationFrame` ensures the browser has painted with the new theme before re-enabling transitions.

---

## 12. Animation & Motion

### Standard Timing

```
Duration: 200ms (default for all state transitions)
Easing:   ease-in-out (default)
Fast:     150ms (tooltips, small state changes)
Slow:     300ms (page transitions, large modals)
```

### Patterns

```
Hover highlight:   transition-colors duration-200
Card hover lift:   transition-transform duration-200 hover:-translate-y-px
Dialog open:       scale-[0.98] → scale-100, opacity-0 → 1, duration-200
Tooltip:           scale-[0.98] → scale-100, opacity-0 → 1, duration-150
Sidebar collapse:  transition-[width] duration-200
```

### Rules

1. **Never animate layout properties** (width, height, margin) on elements with complex children — use `transform` instead.
2. **No bounce, elastic, or spring animations.** This is a precision tool, not a toy.
3. **Loading states use skeleton shimmer**, not spinners (except for inline actions where a spinner is appropriate).
4. **Prefer CSS transitions over JS animation libraries** for simple state changes.

---

## 13. Icons

Use **lucide-react** for all icons. No mixing icon libraries.

### Sizing

```
Default:  18px (w-[18px] h-[18px])
Small:    16px (w-4 h-4)
Large:    20px (w-5 h-5)

In buttons: apply -mx-0.5 for optical alignment
```

### Color

Icons inherit text color by default (`currentColor`). Never apply a color to an icon that differs from its adjacent text unless the icon IS the status indicator (e.g., a colored dot).

### Nav Icons

Each nav section has assigned icons from lucide-react:

```
Command Deck:  Compass
Board:         LayoutGrid
Agents:        Bot
Resources:     Server
Convoys:       Network (or Users)
Handoffs:      ArrowRightLeft
Activity:      Terminal
Metrics:       BarChart3
Costs:         DollarSign
Health:        HeartPulse
Skills:        Cpu
Settings:      Settings
God View:      Zap
```

---

## 14. Accessibility

### Contrast Ratios

All text-on-background combinations must meet **WCAG AA** (4.5:1 for normal text, 3:1 for large text).

The token system is designed to meet this:
- `text-foreground` on `bg-background` — passes in both modes
- `text-muted-foreground` on `bg-background` — passes (neutral-500 mix)
- Signal colors on their `/8` opacity backgrounds — passes

### Focus Indicators

All interactive elements must have visible focus indicators:

```
focus-visible:ring-[3px] focus-visible:ring-ring/24 focus-visible:ring-offset-1
```

This creates a soft blue glow around focused elements — visible but not jarring.

### Touch Targets

Minimum interactive element size: **32px** (h-8). Prefer **36px** (h-9) for primary actions.

### Keyboard Navigation

- `Tab` / `Shift+Tab` — navigate between interactive elements
- `Enter` / `Space` — activate buttons and toggles
- `Escape` — close dialogs, menus, popovers
- `[` — toggle sidebar collapse
- `/` — open search

---

## 15. Page-Specific Notes

### Board (Kanban)

- Column headers: `font-display text-sm font-semibold text-muted-foreground uppercase tracking-wider`
- Column count badge: `text-xs text-muted-foreground ml-1`
- Cards use left accent border for status (see Cards section)
- Stats bar at top uses compact card variant with `p-3`
- Filter pills: `bg-secondary rounded-full text-xs px-2 py-0.5`

### Command Deck (formerly Mission Control)

- Two-pane layout using `react-resizable-panels`
- Left pane: project tree with collapsible sections
- Right pane: feature detail with tabbed content
- **Uses the global token system** — no isolated Codex theme

### Agents

- Cloister Deacon card at top: use standard card with `bg-card`
- Agent list rows: subtle `border-b border-border` separators (or use spacing, no borders)
- Status dot + agent name + runtime info + cost (cyan) + duration

### God View

- Allowed to override specific tokens for its scoped cinematic feel
- But must still USE the token system (override values, don't hardcode hex)
- Background can be deeper than `--background`
- Can use additional glow/neon effects via scoped CSS

### Settings

- Provider cards: standard card component
- Toggle switches: standard switch component
- API key inputs: standard input with `type="password"`

---

## 16. File Organization

```
design/
├── prd/
│   └── PRD-REBRAND.md              ← This rebrand's PRD
├── style-guide/
│   └── STYLE-GUIDE.md              ← This file (canonical reference)
├── tokens/
│   └── (future: exported design tokens as JSON)
├── assets/
│   └── (generated images, textures)
├── stitch-exports/
│   ├── board-view-dark.png/.html    ← Original dark board mockup
│   ├── board-v2-t3-dark.png/.html   ← T3Code-inspired board (preferred)
│   ├── command-deck-dark.png/.html  ← Command Deck mockup
│   ├── agents-view-dark.png/.html   ← Agents mockup
│   └── board-view-light.png/.html   ← Light mode board mockup
└── screenshots/
    └── (current state screenshots for before/after comparison)
```

---

## 17. Quick Reference Card

For developers implementing components, this is the TL;DR:

```
SURFACES:     bg-background → bg-card → bg-accent (darker to lighter)
TEXT:         text-foreground / text-muted-foreground / text-card-foreground
BORDERS:     border-border (always — never hardcode gray)
PRIMARY:     bg-primary / text-primary (blue)
SIGNALS:     success/warning/destructive/info + signal-review/signal-cost
BADGE BG:    bg-{signal}/8 text-{signal}-foreground border-{signal}/32
CARDS:       rounded-2xl border border-border bg-card p-6
BUTTONS:     rounded-lg h-9 px-3 text-sm font-medium
DIALOGS:     rounded-2xl bg-popover shadow-lg/5 centered on viewport
RADIUS:      sm=6 md=8 lg=10 xl=14 2xl=18 3xl=22 4xl=26
FONT DISPLAY: Space Grotesk
FONT BODY:    DM Sans
FONT CODE:    SF Mono
NOISE:       body::after with feTurbulence at 3.5% opacity
SCROLLBAR:   6px wide, transparent track, 10-15% opacity thumb
TRANSITIONS: 200ms ease-in-out (default)
```
