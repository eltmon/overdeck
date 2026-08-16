---
name: pan-style-guide
description: >
  Overdeck dashboard UI style guide — canonical typography, color-signal
  semantics, badge formula, and color-restraint rules, for both the Ledger
  (legacy) and Broadsheet (default) themes. Use whenever writing, reviewing,
  or mocking up dashboard frontend UI (components, badges, colors, fonts,
  status indicators, kanban cards, tree rows). Prevents the common
  violations: Inter as a font, bold/semibold outside its weight tier, pill
  badges, decorative color, green "running" agents, cyan misuse.
triggers:
  - dashboard UI
  - frontend component
  - style guide
  - color system
  - badge
  - status indicator
  - mockup
  - kanban card
  - design tokens
allowed-tools:
  - Read
  - Bash
---

# Overdeck Style Guide (dev skill)

## Sources of truth — read in this order

1. **The law:** `design/style-guide/STYLE-GUIDE.md` (v2.0) — typography canon
   for both themes, color system, surfaces, radius/spacing scales, component
   specs, forbidden patterns. Everything below is a distillation; when in
   doubt, the guide wins.
2. **Visual reference:** `design/style-guide/mockups/system-map.html` — the
   PAN-1148 unified-redesign system map; open in a browser. Section
   **05 · Color discipline** is the signal-color table as live swatches;
   sections 02–03 show the surfaces and shared primitives composed. For the
   Broadsheet-specific vocabulary (display scale, chips, soft cards, keycap
   CTAs, dot-metadata lines), see
   `design/style-guide/mockups/style-guide-v2.html` — the working prototype
   the theme-scoped tokens and pattern recipes were ported from.
3. **Written tightening:** `docs/prds/planned/pan-dashboard-unified-redesign.md`
   §4.5 ("Color & Style Discipline") — the PAN-1148 "Always means / Never used
   for" table now folded into the guide.
4. **Tokens:** `src/dashboard/frontend/src/index.css` — the unscoped
   `:root`/`.dark` blocks (Ledger's untouched default), `@font-face`
   declarations, theme font tokens, the `.display-xl`/`.display-lg`/
   `.eyebrow` Broadsheet utilities, and, after `.dark` closes, the PAN-3706
   four-scope region carrying every color/surface/border/shadow/radius/
   type/motion token plus the `.chip`/`.soft-card`/`.large-cta`/`.keycap`/
   `.dot-metadata` component patterns — and `src/dashboard/frontend/
   tailwind.config.js` (`boxShadow`, `fontFamily.mono-ui`, and the
   `safelist` entries for classes not yet consumed by any `.tsx` file).
   Conformance is exercised by `tests/e2e/styleguide-conformance.spec.ts`.

## Themes: Ledger (legacy) vs. Broadsheet (default)

Overdeck ships two named design languages behind a single `ui.theme` setting
(`~/.overdeck/config.yaml`, default `broadsheet`) and a `data-theme` attribute
on `<html>` (independent of the `.dark` class, which carries light/dark
color-scheme — the two axes never interact). **Ledger** is the pre-PAN-3410
style — DM Sans, flat `font-medium` cap, cool blue-gray neutrals, no display
tier — now frozen: bug fixes only, never new patterns. **Broadsheet** is the
active theme: Geist/Geist Mono, a tiered weight system, a display scale, and
the new component vocabulary below — plus, as of PAN-3706, its own warm
neutral color ramp, stepped surfaces, opaque borders, a shadow/elevation
scale, a smaller base radius, 13px/1.6 body type, and an ambient-wash
background in place of Ledger's noise film. Before PAN-3706 the color/
surface/elevation/radius/texture system was accidentally shared between both
themes (a font-only migration); it is not anymore — see "Color, surface, and
elevation now differ by theme" below.

**The theme rule for new surfaces:** author against the Broadsheet
vocabulary (`.display-xl`, `.display-lg`, `.eyebrow`, chips, soft cards,
keycap CTAs, dot-metadata lines) using the class names as given. Never write
`if (theme === 'broadsheet')` or any other conditional-markup branch. This is
not optional — a component that branches on theme is a style-guide violation
regardless of which theme it produces correct output for.

Only three of those classes actually have a Ledger-safe fallback — they
resolve to a scaled-down value at `:root` instead of being conditionally
rendered, so a surface built from them degrades in scale and texture under
Ledger but never breaks:

| Broadsheet class | Ledger-safe fallback |
|---|---|
| `.display-xl` | `text-xl font-medium` |
| `.display-lg` | `text-lg font-medium` |
| `.eyebrow` | `text-xs uppercase tracking-wider font-medium` |

Chips, soft cards, keycap CTAs, and dot-metadata lines have **no** Ledger
fallback — no `:root` or `[data-theme="ledger"]` rule exists for them at all.
This is authoring discipline, not a CSS or runtime guard: nothing detects or
blocks their use under Ledger, they would just render unstyled (bare Tailwind
utilities, no theming) if reached while Ledger is active. A component built
with them is a Broadsheet-only component by construction; don't reach for
them on a surface that must still render under Ledger.

## Color, surface, and elevation now differ by theme (PAN-3706)

The color system is no longer identical between themes (it was, pre-PAN-3706
— see guide §2/§4). `:root`/`.dark` in `index.css` stay the untouched Ledger
default; Broadsheet's real values live in a later region that overrides them
per the four-scope contract below. What's still shared: signal-color
*semantics* (what `--destructive`/`--warning`/etc. mean) and the badge tint
*formula* (8%/32%). What now differs: the neutral ramp (warm HSL vs cool
gray), `--background`/`--card`/`--popover` step apart under Broadsheet
instead of collapsing to one flat color, `--border`/`--input` are opaque
under Broadsheet instead of near-invisible `color-mix()`, `--radius` itself
(10px Ledger / 6px Broadsheet — not just the badge tier), a role-named
`--shadow-sm/md/lg/xl/card/floating/overlay` scale that actually resolves to
something visible on dark surfaces, body type (13px/1.6/antialiased under
Broadsheet vs. browser default under Ledger), and the background treatment
(Ledger keeps the fractal-noise film; Broadsheet swaps it for an ambient
corner wash via a new `--wash` token — not a retargeted `--accent`, which
stays the hover-surface token in both themes). New tokens: `--primary-ink`
(text-safe accent), `--body-foreground`/`--faint-foreground` (rounding
`--foreground`/`--muted-foreground` out to a four-tier ramp), `--wash`, a
`--type-size-*`/`--type-leading-*`/`--type-tracking-*` vocabulary (defined,
not yet adopted by components), and `--ease-*`/`--duration-*` motion tokens
(same — defined, not yet wired into existing animations). `--font-mono-ui`
splits UI-chrome monospace (labels, IDs, timestamps) from `--font-mono`
(code + the eyebrow exception) — Ledger resolves both to the same SF Mono
stack, Broadsheet gives UI-mono a tighter system stack instead of Geist
Mono's code-tuned metrics.

**The four-scope selector contract** is what makes every one of those tokens
resolve correctly by theme. Because `.dark` and `data-theme` both live on
`<html>` at once, and because Settings → Appearance nests a `[data-theme]`
scope inside the ambient document for its comparison specimens, a
theme-varying token needs **four** blocks, placed after `:root`/`.dark` in
source order (equal-specificity attribute selectors win on source order, not
specificity):

```
[data-theme="ledger"]                                             — light, restate today's value
[data-theme="broadsheet"]                                          — light, new value
.dark[data-theme="ledger"], .dark [data-theme="ledger"]            — dark, restate today's value
.dark[data-theme="broadsheet"], .dark [data-theme="broadsheet"]    — dark, new value
```

Same-element (`.dark[data-theme=...]`) matches `<html>` itself; descendant
(`.dark [data-theme=...]`) matches a nested Appearance-picker specimen —
both are required or a nested specimen inherits the wrong theme. For a
non-color-token rule (a `body` background, a utility class), gate it on a
custom property with a `var()` fallback rather than a bare descendant
selector — `--badge-radius` and the `.display-xl`/`.display-lg`/`.eyebrow`
properties are the established examples; a descendant selector matches
through *any* ancestor with the attribute and breaks nesting, a custom
property cascades by DOM proximity and doesn't. Full mechanics: guide §4a.

## The rules agents violate most (memorize these)

### Typography — Ledger (legacy baseline, verbatim)

- **DM Sans** for ALL UI prose. Inter, SF Pro, Segoe UI, -apple-system are
  **deprecated — never reintroduce**.
- **SF Mono** (`font-mono`) ONLY for technical identifiers: code, paths,
  branch names, PR numbers, issue IDs, session/run IDs, model IDs, hashes,
  env vars. Never on titles, badge labels, or button text.
- **Space Grotesk** (`font-display`) ONLY for the sidebar "Overdeck"
  wordmark. Nowhere else (God View is the lone scoped exception).
- **`font-medium` (500) for everything.** No semibold, no bold. Hierarchy
  comes from size and color contrast, not weight.

### Typography — Broadsheet (tiered weights replace the flat cap)

- **Geist Variable** (`font-body`/`font-display`) for ALL UI prose and the
  sidebar wordmark. **Geist Mono Variable** (`font-mono`) for technical
  identifiers *and* the eyebrow pattern below — the one deliberate widening
  of the mono rule. All four families (Geist, Geist Mono, DM Sans, Space
  Grotesk) are self-hosted `woff2` — never a Google Fonts `<link>`, never a
  hardcoded font-family string in component code.
- **Weight tiers, not a flat cap:** body/UI 400–500, headings 500–600,
  **display tiers only 600–800** (`.display-xl` weight 750, `.display-lg`
  weight 680). Nothing outside `.display-xl`/`.display-lg` may exceed 600 —
  "no bold outside its tier" replaces Ledger's "no bold anywhere."
- **Display scale** (`.display-xl`, `.display-lg`) — page/section heroes and
  hero-editable titles only. One `.display-xl` per page.

### Signal colors — each token means exactly one thing

| Token | Always means | Never |
|---|---|---|
| `--destructive` (red) | Action required — broken, stuck, failed, urgent | decoration, label backgrounds |
| `--warning` (amber) | A **human** must act — In Review phase, awaiting approval, paused | machine activity, costs |
| `--info`/`--primary` (blue) | A **machine** is working — running agents, In Progress | static state |
| `--signal-review` (purple) | Specialist *activity* — review/ship/planning verbs, live convoys | the In Review *phase* (amber) |
| `--success` (emerald) | *Outcome* — merged, done, gates passing | running agents (blue!), idle, queued |
| `--signal-cost` (cyan) | Money only, tabular numerals | token counts or any non-currency metric |
| `--muted-foreground` | The rest state — labels, idle, Backlog/Todo | hiding live signals |

Mnemonic: **amber = human, blue = machine, emerald = outcome, red = broken,
purple = specialist verb, cyan = money, neutral = everything else.**

### Color restraint (data-dense views: kanban, trees, lists)

- **Maximum ONE colored signal per card/row.** When everything is colored,
  nothing is. Labels (bug/feature/frontend) are taxonomy → always neutral.
- Three-tier hierarchy: left border (priority/status) · column/group header ·
  at most one special-state badge. All else `text-muted-foreground`.
- Action links monochromatic; the only colored actions are the single primary
  CTA (`text-primary`) and the single destructive action.
- Exception: live, immediately-actionable agent-state badges (⚠ Stuck,
  ⏸ Paused + Unpause) may carry semantic color.

### Badges & indicators

- Tint formula: **8% background / 32% border**
  (`bg-{signal}/8 border-{signal}/32 text-{signal}-foreground`) — identical
  in both themes (D-11, unchanged). No pills (`rounded-full`) for status
  badges.
- Radius: `rounded-sm` under Ledger, `rounded-md` under Broadsheet — the one
  deliberate radius-*tier* change from PAN-3410, layered on top of PAN-3706's
  smaller Broadsheet base `--radius` (10px Ledger / 6px Broadsheet), which
  now also shrinks every other `rounded-*` utility computed from it (buttons,
  cards, dialogs — see "Color, surface, and elevation" above). Nothing else
  about the badge *formula* (8%/32% tint) differs between themes.
- Pick ONE indicator pattern per context — don't mix dots + badges + colored
  text for the same concept in one view.

### Broadsheet-only patterns (never under Ledger)

- **Eyebrow** — uppercase `font-mono`, `text-[11px]`, `tracking-[0.12em]`,
  `text-muted-foreground`. Category/kicker labels and quiet text-buttons.
- **Chip** — `rounded-lg h-9 border border-border`, leading 16px icon.
  Dashed variant (`border-dashed`) = additive/tentative action. Selected =
  `border-foreground/40 bg-muted`, never a color.
- **Soft card** — `rounded-xl bg-muted/50 p-5`, optional hairline border, no
  hard border by default. Suggestion/idea/preview content.
- **Keycap hint** — `rounded-md bg-foreground/8 px-1.5 font-mono text-xs`
  glyph (↵, ⌘L) inside or beside a large CTA button (`h-12 rounded-xl`).
  One CTA per view — same single-primary rule as ordinary buttons.
- **Dot-metadata line** — 6px status dot + `font-mono` quiet text, items
  joined by ` · `. Ambient state summaries only.

None of these exist under Ledger — don't backport them, and don't gate them
behind a theme conditional (see "The theme rule for new surfaces" above).

### Page-not-modal doctrine (theme-independent)

Major creation/composition flows (new project, new workspace, future
editors) are **routed pages**, not modals. Modals are reserved for
confirmations and forms of **4 fields or fewer**. This applies under either
theme — it is not a Broadsheet-only rule. If a diff adds a modal for a
flow with more than 4 fields or a genuine "create X" action, that's a
finding.

### Forbidden patterns (hard bans)

```
bg-gray-800 / text-white / border-gray-700   → bg-card / text-foreground / border-border
bg-blue-600 / text-blue-400                  → bg-primary / text-primary
hardcoded hex (#22c55e, #ef4444, …)          → semantic tokens
slate-* grays (cold)                         → neutral-* (warm) — everywhere
```

Surfaces: depth via tonal layering (`--card`, `--card-2`), not shadows —
shadows stay reserved for floating elements only (dialogs, dropdowns,
tooltips, popovers, dragged items), never inline cards/panels. Border/wash
values are theme-scoped and no longer share one description: Ledger keeps
low-alpha `color-mix()` borders (`white/6%` dark, `black/8%` light,
near-invisible by design, light-mode cards borderless with an ambient
shadow instead) and the noise-film texture; Broadsheet uses opaque HSL
borders and an ambient corner wash instead (see "Color, surface, and
elevation" above).

### Brand mark — the control ring (guide §19)

The Overdeck logo is the **control ring**: orbit ring + center hub + one agent
satellite on the ring (reads as the O of Overdeck). In-app, render it ONLY via
the `OverdeckMark` component (`src/dashboard/frontend/src/components/OverdeckMark.tsx`)
with `text-primary` — never inline a copy of the geometry, never use the lucide
Eye, the old stacked diamonds, or tan/copper colors. Canonical SVGs:
`/favicon.svg`, `logo/overdeck-{light,dark}.svg`, desktop icons in
`apps/desktop/resources/`. Two-tone indigo (#4f46e5 + #818cf8 light bg,
#6366f1 + #a5b4fc dark bg); minimum size 16px, mark-only below wordmark scale.

## Workflow

- Before styling anything new, open the system map mockup (or, for
  Broadsheet-specific patterns, `style-guide-v2.html`) and find the nearest
  existing primitive — match it, don't invent.
- For mockups: build with the real tokens — copy the `@font-face`
  declarations and the light/dark color blocks from `index.css`, self-hosted
  (never a Google Fonts `<link>`) — and state conformance deltas explicitly.
  Put mockups in `docs/design/`.
- Reviewing UI diffs: grep the diff for forbidden patterns above and for
  `font-bold|font-semibold` outside `.display-xl`/`.display-lg`, `Inter`,
  `rounded-full.*badge`, `slate-`, and any hardcoded `font-family:` string in
  component code (it should always be `font-body`/`font-display`/`font-mono`)
  — each hit is a finding.
