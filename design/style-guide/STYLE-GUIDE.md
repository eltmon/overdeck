# Overdeck Style Guide

**Version:** 2.1
**Issue:** PAN-460 (v1.1) · PAN-1148 (v1.2 signal-semantics tightening) · v1.3 control-ring brand mark · PAN-3410 (v2.0 — Broadsheet theme, Ledger legacy) · PAN-3706 (v2.1 — Broadsheet color, surface, elevation, radius, body-type, and texture tokens; §4a four-scope selector contract)
**Last Updated:** 2026-08-14
**Design Reference:** T3Code (`/home/eltmon/Projects/t3code/apps/web/src/index.css`)

---

This is the canonical reference for all Overdeck dashboard UI decisions. Every new feature and every existing component must conform to this guide. If something isn't covered here, look at T3Code's implementation first, then ask.

**Visual reference:** [`design/style-guide/mockups/system-map.html`](mockups/system-map.html) — the PAN-1148 unified-redesign system map. Section **05 · Color discipline** renders the signal-color table below as live swatches with where-used examples; sections 03 (shared primitives) and 02 (the five surfaces) show the components of this guide composed in context. The written counterpart of section 05 is [`docs/prds/planned/pan-dashboard-unified-redesign.md`](../../docs/prds/planned/pan-dashboard-unified-redesign.md) §4.5 "Color & Style Discipline". Conformance is exercised by `tests/e2e/styleguide-conformance.spec.ts`. The Broadsheet mockup lives at [`design/style-guide/mockups/style-guide-v2.html`](mockups/style-guide-v2.html) — the working prototype the theme-scoped tokens and pattern recipes below are ported from.

---

## 1. Design Philosophy

**Quiet precision.** The dashboard exists to surface signal from noise — AI agent status, costs, progress, problems. Every visual element must earn its place. If it's not conveying information, it should be recessive.

**Core principles:**
- Depth through tonal shifts, not borders or shadows
- Color means something — never decorative
- Typography carries hierarchy, not size alone
- Motion is functional (feedback, state transitions), never gratuitous
- Both light and dark modes are first-class citizens
- Both **Ledger** and **Broadsheet** design languages are first-class citizens (§2) — the choice between them is a setting, not a migration

---

## 2. Themes

Overdeck ships two complete, named design languages, selectable via the **Overdeck Theme** setting rather than migrated wholesale. Every rule in this guide from here on applies to **Broadsheet** (the default) unless explicitly marked **Ledger**. Ledger is the frozen legacy baseline: the current, pre-PAN-3410 style, kept working and documented, but receiving bug fixes only.

### The Two Themes

| | Ledger | Broadsheet |
|---|---|---|
| Status | **Legacy** — bug fixes only, no new patterns | **Default** — active development, receives all new patterns |
| Typefaces | DM Sans (UI prose), Space Grotesk (sidebar wordmark only) | Geist Variable (UI prose + display + wordmark token), Geist Mono Variable (identifiers + eyebrows) |
| Weight | Flat `font-medium` (500) cap everywhere | Tiered: body/UI 400–500, headings 500–600, display-tier-only 600–800 |
| Vocabulary | Panels, badges, dense tables — no display tier | + hero placeholders, eyebrows, chips, soft cards, keycap CTAs, dot-metadata lines |
| Badge radius | `rounded-sm` (unchanged) | `rounded-md` (texture consistency, see §6) |

### Configuration

`ui.theme` in `~/.overdeck/config.yaml` — enum `ledger | broadsheet`, default `broadsheet` when unset. An invalid value fails loudly at config resolution with a clear error naming the field and the allowed values — never a silent fallback (consistent with the no-hardcoded-fallback rule). Settings → Appearance carries a two-card **Overdeck Theme** picker: each card shows the theme name, a one-line description, and a live mini-specimen rendered in that theme's own fonts. Selecting a card writes through the existing settings write door and flips the theme live — no reload, no rebuild, no network fetch beyond the settings write itself.

### Theme Scope

A single `data-theme="ledger"` or `data-theme="broadsheet"` attribute on `<html>` carries the theme, alongside the independent `.dark` class that carries light/dark color-scheme (§12 — the two axes never interact). Every theme-varying token — font-family CSS variables, the display-scale utilities' custom properties, and (as of PAN-3706) the full color/surface/elevation/type/motion vocabulary in §4-§4a — is defined per-scope: Ledger's values are declared on **both** `:root`/`.dark` (the document-level default, unscoped) **and** `[data-theme="ledger"]`/its `.dark` combination explicitly, and the `[data-theme="broadsheet"]` forms override them. Declaring Ledger's values a second time, on the attribute selector and not just `:root`/`.dark`, is what makes nesting work: a component that sets its own `data-theme` attribute on a container (e.g. a side-by-side theme specimen) re-declares — and so resets — every token underneath it at that DOM level, independently of the document root, regardless of which theme the ancestor document is in. This is how the Settings → Appearance picker renders both mini-specimens in their own fonts and colors simultaneously, in either direction (Ledger nested in Broadsheet, or Broadsheet nested in Ledger). Relying on `:root`/`.dark` alone would only reset the tokens for the true document root, not for a nested scope. The exact four-scope mechanics — and why a token-level PAN-3706 change now needs four blocks instead of two — are spelled out in the new §4a "The Four-Scope Selector Contract" below; see `src/dashboard/frontend/src/index.css`'s `:root, [data-theme="ledger"] { ... }` for the font-token instance of the pattern and §4a's block for the color-token instance.

### Ledger-Safe Fallbacks

Three utilities — the §3 "Display Scale" pair and §8's Eyebrow — are never conditionally rendered. Instead, each one resolves to a Ledger-safe fallback value at `:root` and is overridden only under `[data-theme="broadsheet"]`:

| Utility | Ledger-safe fallback (`:root` default) | Broadsheet value |
|---|---|---|
| `.display-xl` | `text-xl font-medium` (today's page-title size) | `clamp(48px, 7vw, 72px)`, tracking-tight, weight 750 |
| `.display-lg` | `text-lg font-medium` | ~40px, weight 680, tracking -0.025em |
| `.eyebrow` | `text-xs uppercase tracking-wider font-medium` | 11px Geist Mono, uppercase, `tracking-[0.12em]`, `text-muted-foreground` |

The other four §8 pattern recipes — Chips, Soft Card, Large CTA + Keycap, and Dot-Metadata Line — have no Ledger-safe fallback: no `:root` or `[data-theme="ledger"]` rule exists for `.chip`/`.soft-card`/`.keycap`/`.dot-metadata` at all. **The contract for these four is authoring discipline, not a CSS or runtime guard:** nothing detects or blocks their use under Ledger. If one of these classes is ever reached while Ledger is active, it renders with no themed styling — bare Tailwind-utility output, not a designed fallback — because none was written. They are adopted feature-by-feature on new, Broadsheet-first surfaces (New Workspace page first, per Governance's mechanical-migration rule below); an existing Ledger-reachable surface must simply never call them.

A surface written *only* against the three utilities in the table above (`.display-xl`, `.display-lg`, `.eyebrow`) degrades in scale and texture under Ledger automatically, via CSS token scope — it never breaks and never needs a theme conditional. A surface that also reaches for chips, soft cards, the keycap CTA, or dot-metadata lines is a Broadsheet-only surface by construction, full stop — the "never breaks" guarantee does not extend to it.

### Governance

- **Components never write `if (theme === 'broadsheet')` branches.** For the three utilities with a real Ledger fallback (`.display-xl`, `.display-lg`, `.eyebrow`), this holds unconditionally — the same class names resolve to the fallback values automatically via CSS token scope, never component logic. For the four fallback-less patterns (chips, soft cards, keycap CTA, dot-metadata), the rule is narrower: don't write a theme conditional *to work around the missing fallback* — instead, simply don't put those classes on a surface Ledger can reach. See "Ledger-Safe Fallbacks" above for the exact mechanism (or lack of one) each utility gets.
- **New patterns are Broadsheet-only, forever, and unenforced by CSS.** Hero placeholders, eyebrows, chips, soft cards, the large CTA + keycap, and dot-metadata lines (§8) are not backported to Ledger — Ledger receives bug fixes only, never new visual vocabulary. Enforcement is authoring/review discipline: nothing at runtime stops one of these classes from being used on a Ledger-reachable surface, it would simply render unstyled if it were.
- **The mechanical migration is bounded to Broadsheet.** Font-family and weight-utility changes land entirely inside the `[data-theme="broadsheet"]` scope. Ledger rendering stays byte-for-byte identical to today's styles — no font swap, no weight change, no utility change. Component-by-component adoption of the new patterns happens per-feature (New Workspace page first), not as part of the base migration.
- **Both docs move together.** This law file and its distilled agent-facing form (`sync-sources/dev-skills/pan-style-guide/SKILL.md`) must describe both themes consistently — same tier table, same pattern names, same governance. `pan sync` distributes the skill to every harness.

### What Does NOT Change (both themes)

PAN-3410 was scoped as a typography/texture/scale revision only, and left the entire color, surface, elevation, radius, body-text-size, and background-texture system on Ledger's values under Broadsheet too. PAN-3706 closed that gap: as of this revision, **the neutral ramp, surfaces, borders, elevation (shadows), radius, body type size, and the background wash/noise treatment are theme-scoped and differ between Ledger and Broadsheet.** The carve-out below is what's left unchanged — it is deliberately narrower than the old v1 statement, so don't assume the color system is off-limits the way it used to be.

Unchanged from v1, identically under both themes:

> Semantic tokens only (never hardcoded hex, never decorative color); color restraint (one colored signal per card/row; amber=human, blue=machine, emerald=outcome, red=broken, purple=specialist verb, cyan=money); the signal-color **semantics** table in §4 (`--destructive`/`--warning`/`--info`/`--success`/`--signal-review`/`--signal-cost`, what each always means and never means); the badge tint **formula** — 8% background / 32% border color-mix — is the same math in both themes, only the badge **radius** moves (`rounded-sm` Ledger → `rounded-md` Broadsheet, §6, still the one deliberate radius change to the *badge* component specifically, not to `--radius` overall — see §6).

What changed, and is documented in the new §4a and the F-1..F-11 references throughout this guide: the neutral hue and lightness ramp (§4, F-1/F-2/F-3), the shadow/elevation scale (§5, F-4), the ambient background wash replacing the fractal-noise film (§10, F-5), body font-size/line-height/smoothing and the type-scale token vocabulary (§3, F-6), `--radius` itself — not just the badge (§6, F-7), `--primary-ink` and the four-tier text ramp (§4, F-8), the easing/duration motion vocabulary (§13, F-9), the split code/UI mono role (§3, F-10), and the four previously-unauthored §8 patterns — Chips, Soft Card, Large CTA + Keycap, Dot-Metadata Line (§8, F-11). Every one of these values differs by theme through the four-scope selector contract in §4a; none of them is a hardcoded literal in component code.

---

## 3. Typography

### Font Stack

Each font-family CSS variable resolves differently per theme. Components reference the variable (via the `font-body`/`font-display`/`font-mono` Tailwind utilities) — never a hardcoded font name.

| CSS variable | Tailwind utility | Ledger value (`:root`) | Broadsheet value (`[data-theme="broadsheet"]`) |
|---|---|---|---|
| `--font-sans` | `font-body` | `"DM Sans", system-ui, sans-serif` | `"Geist Variable", system-ui, sans-serif` |
| `--font-display` | `font-display` | `"Space Grotesk", system-ui, sans-serif` | `"Geist Variable", system-ui, sans-serif` |
| `--font-mono` | `font-mono` | `"SF Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace` | `"Geist Mono Variable", "SF Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace` |
| `--font-mono-ui` (PAN-3706 F-10) | `font-mono-ui` | `"SF Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace` (same as `--font-mono`) | `"SFMono-Regular", "SF Mono", ui-monospace, Menlo, Monaco, Consolas, monospace` |

### Why These Fonts

- **Geist Variable** — Vercel's open-source (SIL OFL 1.1) variable grotesque, weights 100–900 in one file. Broadsheet's UI sans and display face: its wider weight range is what makes the 400–800 tier system (below) possible without a second family.
- **Geist Mono Variable** — Geist's monospace companion, same OFL license, weights 100–900. Broadsheet's `--font-mono` face: reserved for **code** (terminal output, log panes, fenced code blocks) plus the eyebrow-label pattern (§3 "Mono Rule"), which deliberately borrows the code face rather than the UI one. Chrome that happens to be monospaced but isn't the eyebrow pattern — plain labels, IDs, timestamps — instead uses the separate `--font-mono-ui` role (F-10, below), a tighter system UI-monospace stack that reads better at small sizes without code-face ligatures. Ledger never had this split: its `--font-mono` and `--font-mono-ui` resolve to the identical SF Mono stack, so nothing changes there.
- **Space Grotesk** — geometric, technical, tight apertures. Under Ledger, reserved exclusively for the "Overdeck" sidebar wordmark (the single approved non–God-View display-font exception). Under Broadsheet, the wordmark uses the `font-display` token like everything else (Geist Variable) — Space Grotesk remains defined and self-hosted for Ledger only.
- **DM Sans** — clean geometric sans with a distinctive single-story "g" (open tail). Variable weight gives fine typographic control. Ledger's universal default for all non–God-View UI text.
- **SF Mono** — the standard for terminal and code rendering. Falls back gracefully across platforms. Remains the trailing fallback in the mono stack under both themes, and is Ledger's mono face outright.

### Font Loading (self-hosted)

All four families are self-hosted as variable `woff2` files under `src/dashboard/frontend/public/fonts/` with an `OFL-<Family>.txt` SIL Open Font License beside each — combined payload stays within a ~500KB budget (NFR-2). There is **no Google Fonts `<link>`, no CDN preconnect, and no external font request in either theme.**

```css
/* src/dashboard/frontend/src/index.css */
@font-face {
  font-family: 'Geist Variable';
  font-style: normal;
  font-display: swap;
  font-weight: 100 900;
  src: url('/fonts/Geist-Variable.woff2') format('woff2-variations'), url('/fonts/Geist-Variable.woff2') format('woff2');
}

@font-face {
  font-family: 'Geist Mono Variable';
  font-style: normal;
  font-display: swap;
  font-weight: 100 900;
  src: url('/fonts/GeistMono-Variable.woff2') format('woff2-variations'), url('/fonts/GeistMono-Variable.woff2') format('woff2');
}

@font-face {
  font-family: 'DM Sans';
  font-style: normal;
  font-display: swap;
  font-weight: 100 1000;
  src: url('/fonts/DMSans-Variable.woff2') format('woff2-variations'), url('/fonts/DMSans-Variable.woff2') format('woff2');
}

@font-face {
  font-family: 'Space Grotesk';
  font-style: normal;
  font-display: swap;
  font-weight: 300 700;
  src: url('/fonts/SpaceGrotesk-Variable.woff2') format('woff2-variations'), url('/fonts/SpaceGrotesk-Variable.woff2') format('woff2');
}
```

### Theme Font Tokens

```css
/* :root carries Ledger's exact values as the document-level default.
   [data-theme="ledger"] restates the same values explicitly — not just
   relying on :root — so a Ledger scope NESTED inside a Broadsheet
   document (e.g. the Settings -> Appearance comparison specimens)
   resets these variables at that DOM level instead of inheriting
   Broadsheet's from an outer ancestor. [data-theme="broadsheet"]
   overrides both. */
:root,
[data-theme="ledger"] {
  --font-sans: "DM Sans", system-ui, sans-serif;
  --font-display: "Space Grotesk", system-ui, sans-serif;
  --font-mono: "SF Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  --font-mono-ui: "SF Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace;
}

[data-theme="broadsheet"] {
  --font-sans: "Geist Variable", system-ui, sans-serif;
  --font-display: "Geist Variable", system-ui, sans-serif;
  --font-mono: "Geist Mono Variable", "SF Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  --font-mono-ui: "SFMono-Regular", "SF Mono", ui-monospace, Menlo, Monaco, Consolas, monospace;
}
```

`--font-mono-ui` (PAN-3706 F-10) follows the same two-scope shape as its siblings, not the four-scope color-token contract in §4a — font tokens have never had a light/dark distinction in this file (no `--font-*` is redeclared inside `.dark`), so there's no dark-mode pair to restate.

```js
// tailwind.config.js
fontFamily: {
  display: ['var(--font-display)', 'system-ui', 'sans-serif'],
  body: ['var(--font-sans)', 'system-ui', 'sans-serif'],
  mono: ['var(--font-mono)', '"SF Mono"', '"SFMono-Regular"', 'Consolas', '"Liberation Mono"', 'monospace'],
}
```

### Body Typography (PAN-3706 F-6)

`body`'s font-size, line-height, and font-smoothing are theme-scoped custom properties, consumed with an `inherit`/`auto` fallback so an unscoped context (SSR, a detached node, `data-theme` absent) degrades to the browser default rather than an invalid value:

```css
/* src/dashboard/frontend/src/index.css, @layer base body rule */
body {
  font-size: var(--body-font-size, inherit);
  line-height: var(--body-line-height, inherit);
  -webkit-font-smoothing: var(--body-font-smoothing, auto);
  -moz-osx-font-smoothing: var(--body-font-smoothing-moz, auto);
}
```

| Token | Ledger | Broadsheet |
|---|---|---|
| `--body-font-size` | `initial` (falls back to `inherit` → browser/Tailwind default, 16px) | `13px` |
| `--body-line-height` | `initial` (falls back to `inherit`) | `1.6` |
| `--body-font-smoothing` | `initial` (falls back to `auto`) | `antialiased` |
| `--body-font-smoothing-moz` | `initial` (falls back to `auto`) | `grayscale` |

Ledger explicitly sets its own tokens to `initial` rather than leaving them undeclared — see §4a for why an explicit `initial` restatement, not silence, is what makes this degrade correctly when nested inside a Broadsheet document.

### Type Scale Token Vocabulary (PAN-3706 F-6)

A font-size / line-height / letter-spacing token scale exists in both themes as a **vocabulary for future component adoption** — landing the tokens does not, by itself, rewire any existing component to consume them (the same "tokens now, adoption later" shape as the motion tokens in §13). Ledger's scope restates the identical values so a component that does start consuming these tokens renders the same under both themes today; Broadsheet is free to diverge later without a second migration.

| Token | Value | Token | Value |
|---|---|---|---|
| `--type-size-11` | `0.6875rem` (11px) | `--type-leading-tight` | `1.3` |
| `--type-size-13` | `0.8125rem` (13px) | `--type-leading-snug` | `1.45` |
| `--type-size-14` | `0.875rem` (14px) | `--type-leading-normal` | `1.55` |
| `--type-size-15` | `0.9375rem` (15px) | `--type-leading-relaxed` | `1.6` |
| `--type-size-16` | `1rem` (16px) | `--type-tracking-tight` | `-0.012em` |
| `--type-size-18` | `1.125rem` (18px) | `--type-tracking-normal` | `0em` |
| `--type-size-20` | `1.25rem` (20px) | `--type-tracking-wide` | `0.01em` |
| `--type-size-24` | `1.5rem` (24px) | | |

### Type Scale (both themes, UI text)

Use Tailwind's default scale. Recommended pairings — these are unchanged by the theme revision; they describe body/UI text, not the new display tier (see below):

| Element | Size | Weight | Font |
|---------|------|--------|------|
| Page title | `text-xl` (20px) | `font-medium` (500) | `font-body` |
| Section heading | `text-lg` (18px) | `font-medium` (500) | `font-body` |
| Card title | `text-sm` (14px) | `font-medium` (500) | `font-body` |
| Column heading | `text-base` (16px) | `font-medium` (500) | `font-body` |
| Body text | `text-sm` (14px) | `font-normal` (400) | `font-body` (default) |
| Small labels | `text-xs` (12px) | `font-medium` (500) | `font-body` |
| Tiny badges | `text-[.625rem]` (10px) | `font-medium` (500) | `font-body` |
| Stat values | `text-sm` (14px) | `font-medium` (500) | `font-body` |
| Nav items | `text-sm` (14px) | `font-medium` (500) | `font-body` |
| Nav group labels | `text-xs` (12px) | `font-medium` (500) | `font-body`, `uppercase tracking-wider` |
| Buttons | `text-sm` (14px) | `font-medium` (500) | `font-body` |
| Badge text | `text-[10px]` | `font-medium` (500) | `font-body` |
| Action links | `text-[10px]` | `font-medium` (500) | `font-body`, `uppercase tracking-widest` |

### Weight Tiers

**Ledger: flat `font-medium` (500) for everything.** No `font-semibold`, no `font-bold`, anywhere. Hierarchy comes from size and color contrast, not weight variation. This is the entire Ledger weight rule — unchanged from v1.

**Broadsheet: a tiered hierarchy replaces the flat cap.**

| Tier | Weight range | Applies to |
|------|---------------|------------|
| Body / UI | 400–500 | Body text, buttons, labels, nav, badges |
| Headings | 500–600 | Section headings, card titles, column headers |
| Display (tier-only) | 600–800 | `.display-xl`, `.display-lg` **only** — see below |

The old rule "no bold anywhere" becomes, under Broadsheet, **"no bold outside its tier."** Weights above 600 may only appear on the two display utilities; nothing else escalates past 600. Intermediate weights (e.g. 480, 650, 680, 750) are set via `font-weight` on the named utility class only — never as an ad-hoc `font-[650]` on an arbitrary element.

Both tiers additionally obey rule 2 below: **Skip at least one scale step** between heading and subheading (e.g., `text-xl` with `text-sm`, not `text-lg` with `text-base`). **Don't use 100% black text** — use `text-foreground` for an ink-on-paper feel.

### Display Scale (Broadsheet only)

Broadsheet adds two display-tier utilities for page-level typography — a vocabulary Ledger never had:

```css
.display-xl {
  @apply text-xl font-medium;          /* Ledger-safe fallback: today's page-title size */
}
.display-lg {
  @apply text-lg font-medium;          /* Ledger-safe fallback */
}

[data-theme="broadsheet"] .display-xl {
  font-family: var(--font-display);
  font-size: clamp(3rem, 7vw, 4.5rem); /* clamp(48px, 7vw, 72px) */
  font-weight: 750;
  letter-spacing: -0.03em;
  line-height: 1.02;
}

[data-theme="broadsheet"] .display-lg {
  font-family: var(--font-display);
  font-size: 2.5rem;                   /* 40px */
  font-weight: 680;
  letter-spacing: -0.025em;
  line-height: 1.05;
}
```

- **`display-xl`** — page heroes, hero-editable titles (see §8 "Hero Placeholder"). One per page.
- **`display-lg`** — section heroes, large sub-headings within a page.
- Neither is defined as an ad-hoc arbitrary value (`text-[72px]`) — both are Tailwind `@layer components` classes so every consumer gets the identical recipe and the identical Ledger-safe fallback for free.

### Mono Rule (rewritten for Broadsheet)

**Rule 2 (both themes): `font-mono` is for code and technical identifiers.** Use it for code blocks, terminal output, command snippets, session/run IDs, file paths, env vars, hashes, model IDs, branch names, tool names, xBRIEF/issue IDs shown as identifiers — any string presented as a technical token rather than human-readable prose.

**Broadsheet widens this by one sanctioned use: the eyebrow label (§8 "Eyebrow").** `font-mono` (resolving to Geist Mono Variable) is also used for uppercase category/kicker labels and quiet text-buttons (e.g. `CANCEL`). This is the one deliberate exception to "mono is identifiers-only," and it does not apply under Ledger — Ledger's `.eyebrow` fallback uses `font-body`, not mono (see the Ledger-Safe Fallbacks table in §2).

**Rule 2a (Broadsheet only, PAN-3706 F-10): `font-mono-ui` is for monospaced chrome that is not code and not the eyebrow pattern.** Use the `font-mono-ui` Tailwind utility (`--font-mono-ui`, Broadsheet: `"SFMono-Regular", "SF Mono", ui-monospace, Menlo, Monaco, Consolas, monospace`) for run-of-the-mill monospaced UI text — a session ID chip, a timestamp column, a tabular numeral — where you want the tighter system UI-monospace metrics rather than Geist Mono's code-tuned ligatures and larger x-height. `font-mono` stays reserved for actual code and the eyebrow exception above. Ledger has no such distinction: `--font-mono-ui` resolves to the same SF Mono stack as `--font-mono` there, so a call site using either utility renders identically under Ledger.

**Rule 3 (Ledger): `font-display` is ONLY for the sidebar "Overdeck" wordmark.** No other non–God-View Ledger surface uses `font-display` — this is what keeps Space Grotesk exclusive to the wordmark under Ledger (§3 "Why These Fonts"). **Under Broadsheet this exclusivity is relaxed by design:** `--font-display` resolves to the same Geist Variable family as `--font-sans`, so the wordmark (§9) and the two display-tier utilities (`.display-xl`, `.display-lg`, above) both use `font-display` — there is no separate "display font" to protect once Ledger's Space-Grotesk-vs-DM-Sans distinction no longer applies.

**Rule 4 (both themes): God View has its own scoped typography system** (`src/dashboard/frontend/src/components/GodView/*`) and is the only deliberate exception to Rules 1–3.

**Rule 1 (both themes): the body font (`font-body`) is the universal default for all non–God-View UI.** Body text, headings, labels, nav, buttons, dialogs, tables, forms, metric values, conversation prose, list titles, metadata — everything not explicitly covered by Rule 2, 3, or 4 uses `font-body` (DM Sans under Ledger, Geist Variable under Broadsheet).

### Conversation Typography

Conversation UI (Command Deck chat, messages, composer) follows Rule 1 + Rule 2, both themes:
- **Prose** (user messages, assistant markdown paragraphs, headings, lists, tables, blockquotes) — `font-body`
- **Code** (inline `<code>`, fenced `<pre><code>`) — `font-mono`
- **Technical identifiers** in metadata (session IDs, run IDs, model IDs) — `font-mono`
- **Conversation titles** — `font-body` (titles are human-readable prose, not identifiers)

### Deprecated Patterns (DO NOT USE)

These patterns have been eliminated from the codebase. Do not reintroduce them:
- `-apple-system`, `BlinkMacSystemFont`, `"Segoe UI"` in font stacks
- `"Inter"`, `"SF Pro"` as primary fonts
- `Menlo`, `Monaco`, `"Courier New"` in mono stacks
- Hardcoded font-family literals (`"DM Sans"`, `"Geist Variable"`) in component code — always go through `font-body`/`font-display`/`font-mono`, never a literal string, so the theme token actually takes effect
- A CDN `<link>` for any font, in either theme
- `font-mono` on conversation titles, badge labels, button text, or any other UI prose that isn't Rule 2's identifiers or Broadsheet's eyebrow exception

---

## 4. Color System

### Architecture

Colors are defined as CSS custom properties on `:root` (light) and via `@variant dark` / `.dark` class (dark). Components reference these tokens via Tailwind utility classes. **No component may use hardcoded color values** like `bg-gray-800` or `text-white`.

**As of PAN-3706, the color system is theme-scoped — it is no longer identical between Ledger and Broadsheet.** `:root` and `.dark` below remain the unscoped document-level default (Ledger's own values, byte-for-byte unchanged from before PAN-3706) — read by anything that never sets `data-theme`. Broadsheet's actual values live in a second, later region of `index.css` (§4a below) that overrides `:root`/`.dark` via the four-scope selector contract. Signal-color **semantics** (what `--destructive`/`--warning`/`--info`/`--success`/`--signal-review`/`--signal-cost` mean) and the badge tint **formula** are unchanged in both themes (§2) — only the neutral/surface/border tokens and their derived text-tier tokens differ.

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

  /* Overdeck-specific */
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
3. **Opacity-based borders** — `white/6%` in dark, `black/5%` in light. These are barely visible but architecturally meaningful. They define structure without creating visual noise.
4. **Semantic signals are the same hue** in both modes — only the foreground (text) variant shifts for contrast. `--success` is always emerald-500; `--success-foreground` shifts from emerald-700 (light) to emerald-400 (dark).
5. **Warm neutrals, not cold slate** — use `neutral-*` (warm gray), NEVER `slate-*` (blue-cold gray). Slate creates a harsh, clinical feel. Neutral creates the warm, premium, T3Code-like quality. This applies to ALL text colors, backgrounds, and borders in both modes.
6. **Light mode cards are borderless** — in light mode, cards get their definition from a tiny ambient shadow (`0_1px_2px rgba(0,0,0,0.04)`) against the slightly off-white page background, NOT from explicit borders. This is the single biggest difference between "warm and premium" vs "cold and boxy".

### Signal Color Usage

Tightened in PAN-1148 (see the system-map visual reference, section 05: "Color always means
the same thing"). Each token has exactly one meaning and an explicit never-list:

| Token | Color | Always means | Never used for |
|-------|-------|--------------|----------------|
| `--destructive` | Red | Action required — broken, stuck, failed gate, urgent priority | Decoration; label backgrounds |
| `--warning` | Amber | A **human** needs to do something (In Review phase, awaiting approval, paused-for-operator) | Machine activity; cost figures |
| `--info` / `--primary` | Blue | A **machine** is actively doing something (running/working agents, In Progress) | Static state; secondary actions |
| `--signal-review` | Purple | Review / ship / planning **specialist activity** (the verbs, live convoy work) | The In Review *phase* (that's amber — a human gate); general-purpose accents |
| `--success` | Emerald | Done — merged, completed, verification passing | Idle agents; queued items; *running* agents (running = blue) |
| `--signal-cost` | Cyan | Money — runtime spend, model cost, fleet totals. Always tabular numerals | Anything that isn't currency (token counts and other metrics are neutral) |
| `--muted-foreground` | Neutral | No live signal — the rest state (labels, idle, queued, Backlog/Todo) | Active signals masquerading as neutral |

> **v1.1 → v1.2 deltas** (for components written against the old table): "running/healthy"
> moved from emerald to blue — emerald is *outcome*, blue is *activity*. `--signal-review`
> no longer describes the In Review phase — that phase is an amber human-gate; purple marks
> specialist/ship/planning activity. `--signal-cost` narrowed to currency only.

### Color Restraint (Data-Dense Views)

In dense views like the Kanban board, uncontrolled color usage creates noise that degrades signal clarity. When every element is colored, nothing is colored.

**Maximum one colored signal per card.** Each card communicates ONE primary status signal through color. All other elements default to neutral (`text-muted-foreground`, `border-border`).

**Three-tier signal hierarchy:**

| Tier | Element | Color source | Purpose |
|------|---------|-------------|---------|
| 1 | Left border (`border-l-4`) | Priority heat-map | Urgent=red, High=amber, Medium=gray, Low=invisible |
| 2 | Column top border (4px) | Pipeline state | Idle=neutral, Active=primary, Review=warning, Done=success |
| 3 | Special-state badge only | Semantic token | `READY TO MERGE`, `MERGED`, `STUCK` — genuine exceptions |

**Labels: always neutral.** Category labels (bug, enhancement, planning) use `badge-bg-muted` / `text-muted-foreground`. Labels are taxonomy, not status. Coloring them creates false signals.

**Action links: always monochromatic.** The footer row of card actions (Plan, Tasks, xBRIEF, Reset, Cancel, etc.) uses `text-muted-foreground hover:text-foreground`. Only two exceptions are allowed:
- Primary CTA (Start Agent / Resume Agent): `text-primary` — it's the single most important action
- Destructive action (Kill / Wipe): `text-destructive-foreground` — there is at most one per card

**Exception — live agent-state badges:** Inline badges reflecting real-time agent state (`⊙ Input`, `✦ Planning`, `⚠ Stuck`) may use semantic color because they represent live, immediately actionable conditions requiring user response.

**Badge opacity: 8% background, 32% border.** Use `badge-bg-{signal}` (8% color-mix) and `badge-border-{signal}` (32% color-mix). Higher opacity backgrounds create too much noise in a list of many cards.

### Column Semantic Colors (Kanban Pipeline)

Column top borders communicate pipeline state, not arbitrary decoration:

| Column | Border class | Color | Signal |
|--------|-------------|-------|--------|
| Backlog / To Do | `border-divider-strong` | Neutral | Queued — no action needed |
| In Progress | `border-primary` | Blue | Machine actively working |
| In Review | `border-warning` | Amber | Waiting for human action |
| Ship (PAN-1148 IA) | `border-signal-review` | Purple | Specialist pipeline activity (ship/planning verbs) |
| Done | `border-success` | Green | Work complete |

This means amber always means "a human needs to do something." Blue means "a machine is doing something." This mapping must be consistent across all views.

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

### Broadsheet Color, Surface, and Text-Tier Values (PAN-3706 F-1/F-2/F-3/F-8)

Ledger's neutrals are Tailwind's cool blue-gray scale (`--foreground: #1f2937`, `--background: #ffffff`/`#080b10`). Broadsheet replaces the neutral ramp with warm-hue (30–35) HSL values, steps `--background`/`--card`/`--popover` apart instead of collapsing them to one flat color, and makes `--border`/`--input` opaque instead of a near-invisible `color-mix()` overlay:

| Token | Ledger light | Broadsheet light | Ledger dark | Broadsheet dark |
|---|---|---|---|---|
| `--background` | `#ffffff` | `hsl(0 0% 96.5%)` | `#080b10` | `hsl(0 0% 12.5%)` |
| `--foreground` | `#1f2937` | `hsl(35 10% 14%)` | `#e5e7eb` | `hsl(30 8% 94%)` |
| `--card` / `--popover` | `#ffffff` | `hsl(30 8% 94.5%)` | `#0c1018` | `hsl(0 0% 17%)` / `hsl(0 0% 18%)` |
| `--secondary` / `--muted` | `black 4% color-mix` | `hsl(30 8% 94.5%)` | `white 6%`/`4% color-mix` | `hsl(0 0% 17.3%)` / `hsl(0 0% 15%)` |
| `--muted-foreground` | `#6b7280` | `hsl(35 5% 42%)` | `#9ca3af` | `hsl(30 2% 66%)` |
| `--border` / `--input` | `black 8%`/`10% color-mix` (near-invisible) | `hsl(30 4% 88.5%)` (opaque) | `white 6%`/`8% color-mix` | `hsl(0 0% 22.7%)` (opaque) |

`--primary` itself is unchanged in this revision — both themes keep Overdeck's blue (`oklch(0.488 0.217 264)` light / `oklch(0.588 0.217 264)` dark). Adopting Subspace's lime accent is an explicitly deferred decision (PAN-3706 non-goals), not part of this token set.

F-8 adds two things Ledger never had, both new tokens rather than retargeted existing ones:

- **A four-tier text ramp** — `--foreground` > `--body-foreground` > `--muted-foreground` > `--faint-foreground`, each step lighter, approaching `--background`. Ledger gets the same four tokens, derived from its existing gray scale (e.g. light `--body-foreground: #4b5563` sits between `--foreground`'s gray-800 and `--muted-foreground`'s gray-500) so a shared component consuming the ramp resolves to an in-family value under either theme instead of an unset color.
- **`--primary-ink`** — a darkened/lightened, text-safe variant of `--primary` (hue 264 unchanged, only lightness/chroma drop) for accent-colored text and borders that would be unreadable at `--primary`'s full chroma. Both themes get a `--primary-ink` (Ledger: `oklch(0.42 0.19 264)` light / `oklch(0.7 0.19 264)` dark) — it did not exist before PAN-3706 in either theme.

`--wash` (F-5) is a new, Broadsheet-only standalone token for the ambient corner-gradient background — **not** a retargeting of `--accent`, which stays Overdeck's subtle hover-surface token in both themes (§4a explains why a new token was introduced rather than reusing `--accent`). See §10 for the wash/noise-suppression mechanism itself.

---

## 4a. The Four-Scope Selector Contract

This is the mechanism that makes every PAN-3706 color, surface, and elevation token differ correctly by theme — it is now the load-bearing pattern for the whole theme system, not just the font tokens and display-scale utilities that introduced it in PAN-3410.

### Why four scopes, not two

Both the dark-mode class and the theme attribute live on `<html>` simultaneously: `useTheme.ts` toggles `.dark` on `document.documentElement`, and `useDesignLanguage.ts` sets `document.documentElement.dataset.theme` to `'ledger'` or `'broadsheet'` (default `'broadsheet'` when unset). A token that varies by *both* axes — which every PAN-3706 color token does — needs one block per combination of {theme} × {light/dark}, and each block needs both a same-element and a descendant form:

```css
[data-theme="ledger"]     { /* today's light value, restated verbatim */ }
[data-theme="broadsheet"] { /* new light value */ }
.dark[data-theme="ledger"],
.dark [data-theme="ledger"]     { /* today's dark value, restated verbatim */ }
.dark[data-theme="broadsheet"],
.dark [data-theme="broadsheet"] { /* new dark value */ }
```

- **Both `[data-theme="ledger"]` and `[data-theme="broadsheet"]` are needed**, not just the latter, because these are equal-specificity attribute selectors: whichever one appears **later in source order** wins the cascade for a given element, regardless of which theme is "the new one." Placing a bare `[data-theme="broadsheet"]` block after `.dark` without also restating `[data-theme="ledger"]` would let Broadsheet's declaration beat `.dark`'s declaration even while the document is Ledger-themed, because attribute selectors don't lose to class selectors on specificity alone — only source order decides between two selectors of equal specificity. Restating Ledger's value explicitly, in its own block placed in the same source-order neighborhood, is what keeps Ledger's declaration winning under Ledger.
- **Both the same-element form (`.dark[data-theme="ledger"]`) and the descendant form (`.dark [data-theme="ledger"]`) are needed** because Settings → Appearance renders a *nested* `[data-theme]` scope for each theme-comparison specimen card (`AppearanceSection.tsx`) — a `[data-theme="ledger"]` div sitting inside the ambient `[data-theme="broadsheet"]` document, or vice versa. The same-element form matches `<html>` itself (theme attribute and `.dark` class on the same node); the descendant form matches the nested specimen card (theme attribute on a descendant of the `.dark` node). Without both forms, a nested specimen in dark mode would inherit the *ambient* document's theme values instead of its own, because a same-element-only selector never matches a descendant.

### Placement rule

All four-scope blocks for a given token MUST be placed **after** `:root` and `.dark` in `index.css` — the unscoped blocks stay first, as the untouched document-level default, and the four scoped blocks come after so equal-specificity attribute selectors win on source order rather than relying on specificity tricks. `index.css` marks the boundary with a banner comment (`PAN-3706 — Broadsheet completion: surface, shape, and type tokens`) immediately after the `.dark` block closes.

### The custom-property technique — preferred over descendant-selector overrides

For a *non-custom-property* rule (a `body` background, a utility class body, an `@font-face`-adjacent declaration), prefer gating it on a custom property with a `var()` fallback over writing `[data-theme="broadsheet"] .some-class { ... }` directly. Two existing examples in `index.css` establish this pattern:

- **`--badge-radius`** — `[class*="badge-bg-"] { border-radius: var(--badge-radius, var(--radius-sm)); }`, with `--badge-radius: var(--radius-md)` set only under `[data-theme="broadsheet"]` and `--badge-radius: initial` under `[data-theme="ledger"]`.
- **The display-scale utilities** (`.display-xl`/`.display-lg`/`.eyebrow`) — each property (`font-family`, `font-size`, `font-weight`, `letter-spacing`, `line-height`) is read via `var(--display-xl-size, <Ledger literal>)`, with the custom property itself set per-scope.

The reason to prefer this over a bare descendant-selector override (`[data-theme="broadsheet"] .display-xl { font-size: ...; }`) is nesting: a descendant selector matches through **any** ancestor carrying that attribute, so a nested `[data-theme="ledger"]` specimen inside a `[data-theme="broadsheet"]` document would still match the outer document's descendant rule and inherit its value. A custom property instead cascades by DOM proximity — `[data-theme="ledger"]` on the nested node sets (or invalidates, via `initial`) the property at that exact scope, and the consuming rule's `var()` picks up whatever is nearest, regardless of nesting depth or direction. `--wash` (F-5) and the shadow scale (F-4) both follow this same shape: `[data-theme="ledger"] { --wash: initial; }` so `var(--wash)` at that scope resolves to nothing rather than leaking Broadsheet's gradient into a nested Ledger specimen.

### Ledger's four-scope blocks restate, they never invent

Every `[data-theme="ledger"]`/`.dark[data-theme="ledger"]` block introduced by PAN-3706 restates a value that already existed on the corresponding unscoped `:root`/`.dark` block, byte-for-byte — this is the no-loss invariant for the whole revision (see the guide's own no-loss-audit discipline). Where a token is genuinely new (`--body-foreground`, `--faint-foreground`, `--primary-ink`, `--wash`, the shadow/type/motion scales), Ledger's four-scope block still declares *something* — either a derived in-family value (e.g. `--body-foreground` from Ledger's own gray scale) or an explicit `initial` — rather than leaving the token silently undeclared under Ledger, which would resolve to an invalid/inherited value at any consuming call site.

---

## 5. Surfaces & Depth

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

### Shadow Scale (PAN-3706 F-4)

Prior to PAN-3706, `index.css` defined **zero** shadow custom properties, so every `shadow-sm`/`md`/`lg`/`xl` call site resolved to Tailwind's stock scale — values tuned for a white page that are close to invisible against a dark surface. PAN-3706 adds a role-named, seven-token, dark-mode-aware shadow scale, wired into `tailwind.config.js`'s `boxShadow` extension as `var(--shadow-*, <stock-or-new literal fallback>)`:

```css
--shadow-sm / --shadow-md / --shadow-lg / --shadow-xl   /* override Tailwind's stock keys */
--shadow-card     /* subtle 1px card lift — one call site today, SimpleQuestionCard.tsx */
--shadow-floating /* dropdowns, small popovers */
--shadow-overlay  /* dialogs, large menus, sheets */
```

Both themes redefine all seven for dark mode at roughly 3–4× the light-mode alpha, so a shadow still reads against a dark card instead of disappearing into it — the same "redefine, don't just darken the background" idiom Subspace uses. `[data-theme="ledger"]`'s four scopes restate Tailwind v3's literal stock `sm`/`md`/`lg`/`xl` values verbatim (so those four keep rendering byte-identical to pre-PAN-3706 under Ledger); `--shadow-card`/`floating`/`overlay` get the same numeric values under both themes since neither theme had a prior rendered value to preserve. The identical stock `sm`/`md`/`lg`/`xl` values are also declared once more, unscoped, on `:root` — a CSS-only fallback so the ~120 existing `shadow-*` call sites don't break if `data-theme` is ever absent (SSR, a detached node, a failed hook) before `useDesignLanguage.ts`'s JS side effect has run.

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

## 6. Border Radius Scale

Based on T3Code's 10px base radius, with the rest of the scale computed from it:

```css
--radius: 0.625rem;  /* 10px, Ledger — see the per-theme table below */
--radius-sm:  calc(var(--radius) - 4px);   /*  6px at Ledger's --radius */
--radius-md:  calc(var(--radius) - 2px);   /*  8px at Ledger's --radius */
--radius-lg:  var(--radius);               /* 10px at Ledger's --radius */
--radius-xl:  calc(var(--radius) + 4px);   /* 14px at Ledger's --radius */
--radius-2xl: calc(var(--radius) + 8px);   /* 18px at Ledger's --radius */
--radius-3xl: calc(var(--radius) + 12px);  /* 22px at Ledger's --radius */
--radius-4xl: calc(var(--radius) + 16px);  /* 26px at Ledger's --radius */
```

**As of PAN-3706 (F-7), `--radius` itself is theme-scoped and no longer identical between themes:**

| | Ledger | Broadsheet |
|---|---|---|
| `--radius` | `0.625rem` (10px) | `0.375rem` (6px) |

`--radius-sm` and `--radius-md` are declared once, in `:root`, as the `calc(var(--radius) - 4px)` / `calc(var(--radius) - 2px)` chain above — they are **not** redeclared inside the four-scope `--radius` blocks in §4a. A custom property holding a `var()` reference resolves lazily against whatever `--radius` is cascaded on that same element, so `--radius-sm`/`--radius-md` — and every Tailwind `rounded-*` utility built from them via `tailwind.config.js`'s `borderRadius` extension — follow `--radius`'s theme automatically. The badge-radius token (`--badge-radius: var(--radius-md)`, below) follows the same way: it now resolves to a proportionally smaller badge corner under Broadsheet without any change to the badge-radius block itself.

### Component Mapping

The Tailwind utility a component reaches for never changes by theme — only the pixel value that utility computes to, because `--radius` itself is now theme-scoped (F-7, above). The "Radius" column below is Ledger's computed value; Broadsheet's is smaller across the board since it computes off a 6px base instead of 10px.

| Component | Tailwind | Ledger computed | Broadsheet computed |
|-----------|----------|------------------|----------------------|
| Badges, small pills | `rounded-sm` (Ledger) / `rounded-md` (Broadsheet) | 6px | 4px (§4, D-11 — the one deliberate *tier* change, on top of the smaller base) |
| Inline code blocks | `rounded-md` | 8px | 4px |
| Buttons, inputs, selects, toggles | `rounded-lg` | 10px | 6px |
| Large interactive elements | `rounded-xl` | 14px | 10px |
| Cards, dialogs, panels | `rounded-2xl` | 18px | 14px |
| Hero sections, God View cards | `rounded-3xl` | 22px | 18px |
| Full-page overlays | `rounded-4xl` | 26px | 22px |
| Circular elements (avatars, dots) | `rounded-full` | 50% | 50% (unaffected by `--radius`) |

Before PAN-3706, the badge `rounded-sm` → `rounded-md` bump was the *only* radius change in the whole theme revision — `--radius` itself was untouched. **That is no longer true.** PAN-3706 (F-7) drops Broadsheet's base `--radius` to `0.375rem`, which cascades through the whole computed scale above (badges, buttons, cards, dialogs, hero sections — everything in the Component Mapping table) via the `calc()` chain, not just the badge. The badge's `rounded-sm`→`rounded-md` swap is still a real, separate, deliberate change layered on top of the smaller base radius — Broadsheet badges get both a smaller `--radius` *and* the one-step-larger `--radius-md` instead of `--radius-sm` — but it is no longer the only radius delta between the two themes. Ledger keeps every radius value byte-for-byte identical to before PAN-3706.

---

## 7. Spacing & Sizing

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

## 8. Components

### Cards

```
Container:
  bg-card text-card-foreground
  rounded-2xl
  border border-border
  Pseudo-element inner shadow (see Section 5)

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

Broadsheet's large CTA is a distinct tier, not a bigger variant of this table — see "Large CTA + Keycap" below.

### Badges

```
Base:
  rounded-sm border border-transparent font-medium   (Ledger)
  rounded-md border border-transparent font-medium   (Broadsheet — §6, the one deliberate radius change)

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

The `/8` opacity background with `/32` opacity border creates a subtle tinted badge that communicates status without visual heaviness — identical formula in both themes (§2, §4).

### Hero Placeholder (Broadsheet only) — D-4

An editable page title renders its **placeholder** at full display size, chromeless at rest — the empty state itself communicates that this is a page, not a form field.

```
Recipe:
  <input
    class="display-xl bg-transparent border-0 outline-none
           placeholder:text-muted-foreground/40 w-full"
    placeholder="Untitled workspace"
  />
```

**Canonical example:** the New Workspace page's title field (PAN-3411) — a chromeless input at `display-xl` size; the giant placeholder communicates scale before the user has typed anything. Under Ledger the same markup renders at the `display-xl` fallback (`text-xl font-medium`) — still a usable title field, just page-scaled rather than hero-scaled.

### Eyebrow (Broadsheet only, with a Ledger fallback) — D-5

Uppercase mono micro-label used as a category/kicker above a title, or as a quiet text-button.

```
Recipe:
  <p class="eyebrow">Category label</p>
```

**Canonical example:** a soft card's category ("PROJECT", "TEMPLATE") rendered above its title. Broadsheet renders it in Geist Mono at 11px with `tracking-[0.12em]`; Ledger's `.eyebrow` already has its own base rule (`text-xs uppercase tracking-wider font-medium`, `font-body`) so the pattern degrades in scale/texture but never disappears (§2, §3 "Mono Rule").

### Chips (Broadsheet only) — D-6

A bordered, `rounded-lg` pill-adjacent button with a leading icon, for additive/selectable actions.

```
Recipe:
  Base:      rounded-lg h-9 px-3 border border-border
             inline-flex items-center gap-1.5 text-sm font-medium
  Icon:      leading, 16px

  Dashed:    + border-dashed         (additive/tentative action, e.g. "+ Add repo")
  Selected:  border-foreground/40 bg-muted   (replaces the base border — no color)
  Hover:     bg-muted/50 fill only — never a color change
```

**Canonical example:** the New Workspace page's target-directory chip row — one dashed "+ Add path" chip alongside solid selected/unselected chips for existing targets. Broadsheet only; Ledger has no chip pattern.

### Soft Card (Broadsheet only) — D-7

A muted-fill card for suggestion/idea/preview content, distinct from the bordered `Cards` recipe above.

```
Recipe:
  rounded-xl bg-muted/50 p-5
  Border: optional hairline (border border-border/50)
  Title:  text-sm font-medium (400–500)
  Eyebrow: optional, see "Eyebrow" above
```

**Canonical example:** a suggestion or idea preview card — soft fill, generous padding, no hard border, an optional eyebrow above the title. The sanctioned pattern for this content going forward, Broadsheet only.

### Large CTA + Keycap (Broadsheet only) — D-8

A new button tier for one prominent action per view, with an optional inline keyboard-shortcut hint.

```
Recipe:
  Button:  h-12 rounded-xl px-5 text-base font-medium
           Rest:        bg-primary/10 text-primary
           Hover/focus: solid bg-primary text-primary-foreground
  Keycap:  rounded-md bg-foreground/8 px-1.5 font-mono text-xs
           (e.g. ↵, ⌘L)
```

**Canonical example:** "Create Workspace ⏎" — one CTA per view, same single-primary rule as the Buttons section above. Broadsheet only; Ledger keeps the existing button scale (`xs`–`xl`) with no `cta` tier.

### Dot-Metadata Line (Broadsheet only) — D-9

Ambient state summaries as a single quiet line: a small status dot per item, separated by middle dots.

```
Recipe:
  <span class="inline-flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
    <span class="h-1.5 w-1.5 rounded-full bg-{signal-color}" /> Memory enabled
  </span>
  <!-- repeat, joined with " · " -->
```

**Canonical example:** "● Memory enabled · Files shared · 3 agents active" beneath a workspace card title. Broadsheet only; Ledger uses the existing Status Indicators pattern below for equivalent information.

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

**Page-Not-Modal Doctrine (D-10, theme-independent).** Major creation/composition flows — new project, new workspace, and future editors — render as **routed full pages**, not modals. Modals are reserved for:
- Confirmations (delete, discard, force actions)
- Quick forms of **4 fields or fewer**

This doctrine applies dashboard-wide under either theme; it is not a Broadsheet-only pattern. `NewProjectModal.tsx` and `NewWorkspaceModal.tsx` (PAN-3330) predate this rule — the New Workspace flow's page migration is PAN-3411, and migrating `NewProjectModal` to a routed page is tracked as [PAN-3469](https://github.com/eltmon/overdeck/issues/3469), not something this guide lets you silently skip.

For dialogs that remain modals (confirmations, short forms), the recipe is unchanged in both themes:

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
  Title: font-body text-lg font-medium
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

## 9. Navigation (Sidebar)

### Structure

```
Sidebar
├── Logo section (Overdeck control-ring mark + text)
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
  Logo shows icon only (OverdeckMark)

Toggle:
  Click collapse button in footer
  Keyboard shortcut: [ (left bracket)
  State persisted to localStorage('overdeck.ui.sidebarCollapsed')

Mobile:
  Sidebar becomes Sheet (slide from left)
  Triggered by hamburger button in top bar
  backdrop-blur-sm bg-black/32 overlay
```

---

## 10. Fractal Noise Texture

Ledger's signature visual detail: a barely-visible noise pattern overlaid on the entire viewport, giving the UI a tactile, printed quality. **As of PAN-3706 (F-5), this is Ledger-only** — Broadsheet replaces it with an ambient corner-gradient wash instead (see below); the two themes now use opposite background treatments rather than sharing the noise film.

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
- **Broadsheet suppresses this entirely** — `[data-theme="broadsheet"] body::after { content: none; }` fully de-generates the pseudo-element (rather than merely hiding it) in favor of the ambient wash below. Ledger's `body::after` rule itself is not edited, so Ledger's noise stays byte-for-byte untouched.

### Ambient Corner Wash (Broadsheet only, PAN-3706 F-5)

Subspace paints a soft radial light in the top-left corner instead of a noise film — Broadsheet ports that treatment:

```css
[data-theme="broadsheet"] body {
  background:
    radial-gradient(130% 190% at 0% 0%, var(--wash) 0%, transparent 55%),
    var(--background);
}
```

`--wash` is a standalone token (§4), not a retargeted `--accent` — Overdeck's `--accent` is the subtle hover-surface token and must keep that meaning in both themes, and Subspace's own `hsl(var(--accent) / .55)` trick doesn't translate anyway since Overdeck's color tokens are hex/oklch literals rather than bare H-S-L triplets that `var()` could partially substitute into. `--wash` uses `color-mix()` for its alpha, the same idiom `--secondary`/`--accent` already use. Ledger has no wash concept — its four-scope blocks set `--wash: initial`, so a nested Ledger specimen inside a Broadsheet document renders no gradient rather than inheriting the ambient one.

Because the dashboard shell renders a single opaque `bg-background` div as `#root`'s only child, `body`'s background is otherwise invisible — Broadsheet also clears that shell's `background-color` (targeting "the lone direct child of `#root`" structurally, not by class name, so the rule survives a future className change) so the wash actually reaches the screen.

---

## 11. Scrollbars

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

## 12. Theme Toggle (Light / Dark)

This section covers the **light/dark color-scheme** toggle, an axis entirely independent of the Overdeck Theme (Ledger/Broadsheet) setting in §2 — the two never interact and are carried by different attributes (`.dark` class vs. `data-theme`).

### Implementation

- Store theme in `localStorage('overdeck.ui.theme')` — values: `'light'` | `'dark'`
- Toggle by adding/removing `.dark` class on `<html>`
- Default: dark mode

### Flash Prevention

Apply theme before React mounts (in `index.html`), alongside the equivalent `data-theme` flash-prevention script for the Overdeck Theme (§2):

```html
<script>
  (function() {
    var theme = localStorage.getItem('overdeck.ui.theme') || 'dark';
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    }
  })();
</script>
<script>
  (function() {
    var designLanguage = localStorage.getItem('overdeck.ui.designLanguage');
    document.documentElement.dataset.theme = designLanguage === 'ledger' ? 'ledger' : 'broadsheet';
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

## 13. Animation & Motion

### Motion Token Vocabulary (PAN-3706 F-9)

Prior to PAN-3706 there were no easing or duration custom properties — every animation in `index.css` and `tailwind.config.js` hardcoded its own timing keyword or number. PAN-3706 lands an easing/duration token vocabulary, theme-scoped through the same four-scope contract as every other PAN-3706 token, but **as tokens only** — landing them does not itself rewire any existing `@keyframes` or `animation` shorthand to consume them; that is deliberately left for a follow-on adoption task (the same "vocabulary now, adoption later" shape as the type-scale tokens in §3).

| Token | Ledger | Broadsheet |
|---|---|---|
| `--ease-out` | `ease-out` | `cubic-bezier(.16, 1, .3, 1)` |
| `--ease-notion` | `ease-out` | `cubic-bezier(.16, 1, .3, 1)` |
| `--ease-in-out` | `ease-in-out` | `cubic-bezier(.65, 0, .35, 1)` |
| `--ease-spring` | `ease-out` (no spring/overshoot curve in use today) | `cubic-bezier(.34, 1.56, .64, 1)` |
| `--duration-instant` | `80ms` | `50ms` |
| `--duration-fast` | `120ms` | `.1s` |
| `--duration-normal` | `200ms` | `.15s` |
| `--duration-slow` | `300ms` | `.2s` |
| `--duration-enter` | `200ms` | `.2s` |
| `--duration-exit` | `200ms` | `.15s` |

Ledger's values restate timing already hardcoded in the file today (e.g. `--duration-instant: 80ms` matches the existing context-menu-out exit; `--duration-normal: 200ms` matches `.anim-error-shake` and `tailwind.config.js`'s `slide-in-right`/`slide-out-right`) rather than inventing new numbers — so, per the no-loss invariant, nothing about Ledger's actual rendered motion changes. Motion doesn't vary between light and dark mode, so each theme's `.dark`-prefixed scope restates its own light-scope values verbatim.

The PAN-3706 audit (F-9) separately flagged that Overdeck runs continuous ambient motion — pulsing "alive" dots, badge shimmer, a stuck-shake animation — that reads fidgety next to Subspace's settled surfaces. Landing the token vocabulary does not address that; auditing which ambient animations earn their motion remains follow-through work, not part of this token change.

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

## 14. Icons

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

## 15. Accessibility

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

## 16. Page-Specific Notes

### Board (Kanban)

See Section 4 "Color Restraint" for the core color philosophy. Implementation details:

**Columns**
- Column wrapper: `border-t-4 {COLUMN_COLOR} bg-card rounded-xl`
- Column header: `text-base font-medium text-foreground` (`font-body`, not `font-display` — "g" in "In Progress")
- Column count badge: `text-xs text-muted-foreground`
- Column accent colors follow pipeline semantics — see "Column Semantic Colors" in Section 4

**Cards**
- Card container: `rounded-xl border border-border bg-card border-l-4 {PRIORITY_COLOR}`
- Priority left borders (heat-map): urgent=`border-l-destructive`, high=`border-l-warning`, medium=`border-l-muted-foreground`, low/none=`border-l-border`
- Card title: `text-sm font-medium text-foreground`
- Issue ID / external link: `text-xs text-muted-foreground`
- Cost display: `text-xs text-signal-cost` (cyan — always uses signal-cost for money)

**Labels (taxonomy tags)**
- Always: `badge-bg-muted text-muted-foreground border border-border`
- No semantic color regardless of label value. Labels describe type, not urgency.

**Agent-state badges (live status)**
- `READY TO MERGE`: `badge-bg-success badge-border-success text-success-foreground uppercase tracking-wide`
- `MERGED`: `badge-bg-success text-success-foreground uppercase tracking-wide`
- `STUCK`: `badge-bg-destructive badge-border-destructive text-destructive-foreground`
- `⊙ Input` / `✦ Planning`: semantic color appropriate to state — these require human or system action

**Card footer actions**
- Default link: `text-muted-foreground hover:text-foreground transition-colors`
- Primary CTA (Start Agent / Resume Agent): `text-primary hover:text-primary/80 transition-colors`
- Single destructive (Kill / Wipe): `text-destructive-foreground hover:text-destructive transition-colors`
- Rule: one primary, one destructive — everything else is neutral

**Filter bar**
- Cycle buttons (Current / All / Backlog / Canceled): inactive=`bg-background text-foreground/70 hover:text-foreground hover:bg-accent`, active=`bg-primary text-primary-foreground`
- Project pills: rounded-full with `border border-foreground/15`; selected=`bg-accent text-foreground border-foreground/20`; deselected=`opacity-50`
- Labels: `text-muted-foreground font-medium`

**Metrics row (stat tiles)**
- Container: `bg-card border border-border` — inherits theme, never hardcoded colors
- Icon colors: Cost=`text-success`, Agents=`text-primary`, Stuck=`text-destructive` (if >0) else `text-muted-foreground`, Handoffs=`text-signal-cost`, Escalations=`text-signal-review`, Queue=`text-warning`
- Label: `text-xs text-muted-foreground`
- Value: `text-sm font-medium text-foreground` (`font-body`)

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
- **Appearance section**: the Overdeck Theme two-card picker (§2) lives above the existing preference toggles — see the Settings → Appearance component for the live mini-specimen recipe.

---

## 17. File Organization

```
design/
├── prd/
│   └── PRD-REBRAND.md              ← This rebrand's PRD
├── style-guide/
│   ├── STYLE-GUIDE.md               ← This file (canonical reference)
│   └── mockups/
│       ├── system-map.html          ← PAN-1148 unified-redesign system map
│       └── style-guide-v2.html      ← PAN-3410 Broadsheet working prototype
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

## 18. Quick Reference Card

For developers implementing components, this is the TL;DR:

```
SURFACES:      bg-background → bg-card → bg-accent (darker to lighter)
TEXT:          text-foreground / text-body-foreground / text-muted-foreground / text-faint-foreground (F-8 four-tier ramp)
BORDERS:       border-border (always — never hardcode gray)
PRIMARY:       bg-primary / text-primary (blue, unchanged both themes) / text-primary-ink (text-safe accent, F-8)
SIGNALS:       success/warning/destructive/info + signal-review/signal-cost — semantics identical both themes
BADGE BG:      badge-bg-{signal} (8% color-mix) + badge-border-{signal} (32%) — formula identical both themes
CARDS:         rounded-2xl border border-border bg-card p-6
BUTTONS:       rounded-lg h-9 px-3 text-sm font-medium
DIALOGS:       rounded-2xl bg-popover shadow-lg centered on viewport
RADIUS:        --radius = 10px (Ledger) / 6px (Broadsheet) — scale is sm=r-4 md=r-2 lg=r xl=r+4 2xl=r+8 3xl=r+12 4xl=r+16, computed off --radius so it now differs per theme (§6, F-7)
SHADOWS:       shadow-sm/md/lg/xl (override Tailwind stock) + shadow-card/floating/overlay, theme- and dark-mode-scoped (§5, F-4) — no longer the invisible stock Tailwind shadows
THEME:         ui.theme = ledger | broadsheet (default), data-theme attribute, Settings → Appearance
FONT BODY:     font-body → DM Sans (Ledger) / Geist Variable (Broadsheet), 13px/1.6 antialiased under Broadsheet (F-6)
FONT DISPLAY:  font-display → Space Grotesk (Ledger, wordmark ONLY) / Geist Variable (Broadsheet)
FONT CODE:     font-mono → SF Mono (Ledger) / Geist Mono Variable (Broadsheet) — code + eyebrows only
FONT UI-MONO:  font-mono-ui → SF Mono both themes (Ledger) / tighter system ui-monospace stack (Broadsheet) — chrome that isn't code or eyebrows (F-10)
DISPLAY SCALE: display-xl / display-lg (Broadsheet only; Ledger-safe fallback = text-xl|text-lg font-medium)
BROADSHEET-ONLY: .chip / .soft-card / .keycap / .dot-metadata (F-11) — no Ledger fallback, authoring discipline only
BACKGROUND:    Ledger = fractal-noise film (body::after, 3.5% opacity); Broadsheet = ambient corner wash via --wash, noise suppressed (F-5)
MOTION:        --ease-* / --duration-* token vocabulary exists (F-9); not yet wired into existing keyframes/animations
SCROLLBAR:     6px wide, transparent track, 10-15% opacity thumb
TRANSITIONS:   200ms ease-in-out (default)

COLOR RESTRAINT (dense views):
  Max 1 colored signal per card
  Labels: always neutral (badge-bg-muted)
  Action links: always muted-foreground (1 primary CTA + 1 destructive max)
  Column colors: neutral=idle, primary=machine working, warning=human needed, success=done
  Priority border: destructive=urgent, warning=high, muted-foreground=medium, border=low
```

---

## 19. Brand Mark (Control Ring)

The Overdeck mark is the **control ring**: an orbit ring with a center hub and
one agent satellite sitting on the ring. It reads as the O of Overdeck, the
orchestrator hub, and an agent in its orbit. It replaced the stacked-diamond
"deck" mark and the lucide Eye (v1.3, 2026-07-06).

### Canonical geometry (32×32 viewBox)

```
Ring:       circle cx=16 cy=16 r=12.5, stroke-width 4
Hub:        circle cx=16 cy=16 r=4.5, filled
Satellite:  circle cx=26.8 cy=9.2 r=3.4, filled (center sits ON the ring)
```

### Canonical assets — edit these, never fork the geometry

```
/favicon.svg                                    root favicon (Mintlify docs)
src/dashboard/frontend/public/favicon.svg      dashboard favicon
logo/overdeck-light.svg                        mark + wordmark, light backgrounds
logo/overdeck-dark.svg                         mark + wordmark, dark backgrounds
apps/desktop/resources/icon.png / icon.ico     desktop app (mark on #0f1117 disc)
src/.../components/OverdeckMark.tsx            in-app React component (sidebar logo)
```

### Colors

Two-tone indigo, aligned with `--primary`:

```
Light backgrounds:  ring/hub #4f46e5, satellite #818cf8
Dark backgrounds:   ring/hub #6366f1, satellite #a5b4fc
In-app:             OverdeckMark is monochrome currentColor (use text-primary);
                    the satellite is mask-punched out of the ring instead of
                    being a second tone, so it works at any theme color.
```

### Rules

- Never recolor the mark outside the palettes above (in-app currentColor via
  `OverdeckMark` is the one sanctioned exception).
- Never re-add the eye, the stacked diamonds, or any tan/copper (#D4A27F-era)
  branding.
- Minimum size 16px; at that size use the mark alone, never mark + wordmark.
- The wordmark stays Space Grotesk in the sidebar under Ledger (PAN-698); under
  Broadsheet it uses the `font-display` token (Geist Variable). The
  `logo/*.svg` wordmark files use system-ui for portable rendering (README,
  docs site) regardless of theme.
