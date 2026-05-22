---
name: myn-standards
description: >
  Mind Your Now coding standards, design system, and component patterns.
  Auto-applied when writing or reviewing MYN code.
triggers:
  - myn component
  - mind your now
  - myn styling
  - myn design
  - myn frontend
  - myn ui
  - notification toast
  - task card
  - briefing
---

# Mind Your Now Design System & Coding Standards

## Brand Identity

### Brand Colors

| Name | Hex | Tailwind Token | Usage |
|------|-----|----------------|-------|
| All-Knowing Blu | `#00AEEF` | `brand-blue` | Primary brand, links, CTAs |
| Yours Truly Blu | `#80D7F7` | `brand-blue-light` | Hover states, light accents |
| Golden Hour Yellow | `#FFC60B` | `brand-yellow` | Accent, highlights, "now" in wordmark |
| Midnight Blue | `#0C4064` | `brand-dark` | Headings on light backgrounds |

### Brand Wordmark

```tsx
<h1>
  <span className="text-blue-800">mind</span>
  <span className="font-thin text-blue-200">your</span>
  <span className="text-yellow-500">now</span>
</h1>
```

### Logo

- Asset: `/images/logo-no-text.png` (sun-burst motif)
- Always paired with the wordmark on splash/auth screens

## Color System

### Semantic Colors

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `semantic-success` | `#22C55E` | `#4ADE80` | Completed, positive |
| `semantic-warning` | `#F59E0B` | `#FBBF24` | Attention needed |
| `semantic-error` | `#EF4444` | `#F87171` | Errors, overdue |
| `semantic-info` | `#3B82F6` | `#60A5FA` | Informational |

### Priority Colors

| Priority | Hex | Token |
|----------|-----|-------|
| Critical | `#EF4444` | `priority-critical` |
| High | `#F97316` | `priority-high` |
| Medium | `#EAB308` | `priority-medium` |
| Low | `#22C55E` | `priority-low` |
| None | `#6B7280` | `priority-none` |

### MYN Task Type Colors (Methodology)

| Type | Hex | Token |
|------|-----|-------|
| Parking Lot | `#F04F23` | `taskType-parkinglot` |
| Over the Horizon | `#F9913B` | `taskType-overthehorizon` |
| Critical Now | `#0C803D` | `taskType-critical` |
| Opportunity Now | `#107CC4` | `taskType-opportunitynow` |
| Tomorrow | `#854EB1` | `taskType-tomorrow` |

### Shadcn/UI Semantic Tokens (CSS Variables)

```
--background       Page background (white / slate-950)
--foreground       Primary text (slate-950 / slate-50)
--card             Card backgrounds (white / slate-900)
--muted            Muted backgrounds (slate-100 / slate-800)
--muted-foreground Secondary text (slate-500 / slate-400)
--border           Borders (slate-200 / slate-700)
--primary          Primary actions (blue-600 / blue-500)
--destructive      Destructive actions (red-600 / red-500)
--ring             Focus rings (blue-500 / blue-400)
```

### App Background

- Light: `#eff6ff` (blue-50)
- Dark: `#0f172a` (slate-900)
- Surfaces: `#1e293b` dark, `#334155` elevated dark

## Typography

### Font Stack

- **Primary**: Inter (all UI text)
- **Monospace**: SF Mono, Monaco, Cascadia Code
- **Accessibility**: Tiresias Infofont, OpenDyslexic3 (user-selectable)
- All legacy font aliases (Roboto, Lato, Montserrat, SF Pro) map to Inter

### Type Scale

| Token | Size | Weight | Letter Spacing | Usage |
|-------|------|--------|----------------|-------|
| `display` | 2.441rem (39px) | 700 | -0.02em | Hero headlines |
| `h1` | 1.953rem (31px) | 700 | -0.01em | Page titles |
| `h2` | 1.563rem (25px) | 600 | -0.01em | Section headers |
| `h3` | 1.25rem (20px) | 600 | -- | Card headers |
| `body-lg` | 1.125rem (18px) | 400 | -- | Large body text |
| `body` | 1rem (16px) | 400 | -- | Default body text |
| `body-sm` | 0.875rem (14px) | 400 | -- | Compact text, task titles |
| `caption` | 0.75rem (12px) | 400 | -- | Labels, hints |
| `overline` | 0.625rem (10px) | 600 | 0.1em | Category labels |

### Text Colors

```
text-foreground         Primary text
text-muted-foreground   Secondary text, labels, icons
text-primary            Links, emphasis
text-destructive        Errors
text-card-foreground    Text on cards
```

## Spacing & Layout

### Spacing Scale

Standard Tailwind 4px base: `1`=4px, `2`=8px, `3`=12px, `4`=16px, `6`=24px, `8`=32px

### Common Patterns

```tsx
// Page container
<div className="max-w-[1320px] mx-auto pt-4 px-3 sm:px-4 lg:px-6">

// Two-column grid (sidebar visible at xl)
<div className="grid gap-7 xl:grid-cols-[minmax(0,820px)_420px]">

// Card padding
p-3   // Compact
p-4   // Standard
p-5   // Spacious

// Section gaps
mt-3  // Between compact sections
mt-4  // Between standard sections
gap-2 // Icon + text
gap-3 // Form elements
```

### Breakpoints

| Token | Width | Usage |
|-------|-------|-------|
| `xxs` | 350px | Small phones |
| `sm` | 640px | Small tablets |
| `md` | 768px | Tablets |
| `lg` | 1024px | Small desktops |
| `xl` | 1280px | Desktop (sidebar visible) |

## Border & Shadow

### Border Radius

```
rounded-md   (6px)  Buttons, inputs, small cards
rounded-lg   (8px)  Cards, panels
rounded-xl   (12px) Large cards, modals
rounded-full        Pills, avatars
```

### Shadows

```
shadow-sm   Sidebar cards, secondary
shadow-md   Main cards, primary content
shadow-lg   Dropdowns, modals
shadow-xl   Popovers, overlays
shadow-2xl  Dialogs
```

### Opacity Modifiers

```tsx
bg-muted/40         // Very subtle containers
border-border/50    // Container borders (default)
border-border/60    // Button/input borders
ring-ring/40        // Focus state ring
```

## Component Patterns

### Buttons

| Size | Height | Padding | Icon | Usage |
|------|--------|---------|------|-------|
| xs | `h-7` | `px-2` | `h-3.5 w-3.5` | Inline actions |
| sm | `h-8` | `px-3` | `h-4 w-4` | Secondary actions |
| md | `h-9` | `px-3` | `h-4 w-4` | Icon buttons |
| lg | `h-10` | `px-4` | `h-5 w-5` | Primary actions |

```tsx
// Primary
"h-10 px-4 rounded-md bg-primary text-primary-foreground hover:opacity-90"

// Secondary
"h-10 px-4 rounded-md border border-border/60 bg-card hover:bg-muted"

// Ghost
"h-9 px-3 rounded-md hover:bg-muted"

// Icon
"h-9 w-9 rounded-md hover:bg-muted text-muted-foreground"
```

### Cards

```tsx
// Main card (primary, higher elevation)
<Card className="bg-card text-card-foreground rounded-lg shadow-md">

// Sidebar card (secondary, lower)
<Card className="bg-card text-card-foreground rounded-lg shadow-sm">

// Subtle container
<div className="rounded-md border border-border/50 bg-muted/40 px-3 py-2">
```

### Frosted Glass (Auth/Splash Screens)

```tsx
// Blue gradient background
style={{ background: 'linear-gradient(to bottom, rgb(56, 189, 248), rgb(37, 99, 235))' }}

// Frosted glass card
<Card className="bg-white/90 backdrop-blur-sm border-blue-200 hover:shadow-lg transition-all duration-300">
```

### Toast Notifications

Current implementation uses Radix UI `@radix-ui/react-toast` with CVA variants:

```tsx
// Variants: default, destructive, success, error, warning, info
// Base style:
"rounded-lg border-2 p-5 pr-7 shadow-xl backdrop-blur-sm"

// Each variant has light/dark mode colors:
// success: border-green-300 bg-green-50/95 text-green-900
// error:   border-red-300 bg-red-50/95 text-red-900
// warning: border-amber-300 bg-amber-50/95 text-amber-900
// info:    border-blue-300 bg-blue-50/95 text-blue-900

// Viewport: bottom-right on desktop, top on mobile
// Max width: 420px
// Animations: slide-in-from-top (mobile), slide-in-from-bottom (desktop)
// Hover: shadow-2xl + translate-y-0.5 lift
// Icons: Lucide (CheckCircle2, AlertCircle, AlertTriangle, Info) in rounded-full bg
// Close: absolute top-right, visible on hover
```

### Form Controls

```tsx
// Input
"h-10 rounded-md border border-border/60 bg-card px-3 text-sm focus:ring-2 focus:ring-ring/40"

// Textarea
"rounded-md border border-border/60 bg-card p-3 text-sm min-h-[80px] focus:ring-2 focus:ring-ring/40"
```

## Animation System

### Tailwind Keyframes

| Name | Duration | Usage |
|------|----------|-------|
| `wiggle` | 1s infinite | Playful attention |
| `fade-in` | 0.5s ease-out | Element entrance (translateY 10px) |
| `spin-slow` | 3s linear infinite | Loading states |
| `pulse-subtle` | 2s infinite | Gentle pulse (opacity 1→0.9) |
| `shimmer` | 2s linear infinite | Loading skeleton |
| `bounce-once` | 1s ease | Single bounce |

### Framer Motion (Auth/Splash)

```tsx
// Container: stagger children by 0.1s
const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.1 } },
}

// Items: spring up from 20px below
const itemVariants = {
  hidden: { y: 20, opacity: 0 },
  visible: { y: 0, opacity: 1, transition: { type: 'spring', stiffness: 50 } },
}
```

### Task Completion

- Wavy green SVG strikethrough line + text fade
- 2s animation duration
- Do NOT modify sort logic in `sortTasksAndEvents.js`

## Design Principles

1. **Neutral Over Saturated** -- Use muted backgrounds, subtle borders. No saturated gradients for secondary elements.
2. **Elevation Hierarchy** -- Primary content gets `shadow-md`, secondary gets `shadow-sm`.
3. **Progressive Disclosure** -- Hide secondary actions until hover/focus.
4. **Density Over Chrome** -- Tight padding, compact buttons, reduce visual noise.

## Tech Stack

- **Framework**: React 19, Vite 7, TypeScript
- **State**: Jotai (client) + TanStack Query (server)
- **UI**: shadcn/ui (new-york style) + Material-UI (legacy, migrating away)
- **Styling**: Tailwind CSS with custom design tokens
- **Icons**: Lucide (primary), FontAwesome (legacy, GettingStarted only)
- **Animation**: Framer Motion (auth flows), Tailwind keyframes (in-app)
- **Mobile**: Capacitor for iOS/Android
- **Dark Mode**: `class` strategy via Tailwind `darkMode: 'class'`

## File Structure

```
src/
  styles/
    design-tokens.css        CSS custom properties (brand, semantic, priority, task type)
    notification-animations.css  Toast animation keyframes
    globals.css              shadcn/ui CSS variables
  components/
    ui/                      shadcn/ui base components (toast, card, button, etc.)
    auth/                    Auth flows (GettingStarted, EmailForm)
    notifications/           NotificationItem, notification panels
  lib/
    utils.ts                 cn() helper (clsx + tailwind-merge)
```

## Key Files

- `tailwind.config.js` -- All design tokens, type scale, colors, animations
- `src/styles/design-tokens.css` -- CSS custom properties with dark mode overrides
- `docs/technical/frontend/UI-DESIGN-SYSTEM.md` -- Full design system documentation
