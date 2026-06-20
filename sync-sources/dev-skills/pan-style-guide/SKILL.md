---
name: pan-style-guide
description: >
  Overdeck dashboard UI style guide — canonical typography, color-signal
  semantics, badge formula, and color-restraint rules. Use whenever writing,
  reviewing, or mocking up dashboard frontend UI (components, badges, colors,
  fonts, status indicators, kanban cards, tree rows). Prevents the common
  violations: Inter/bold fonts, pill badges, decorative color, green "running"
  agents, cyan misuse.
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

1. **The law:** `design/style-guide/STYLE-GUIDE.md` (v1.2) — typography canon,
   color system, surfaces, radius/spacing scales, component specs, forbidden
   patterns. Everything below is a distillation; when in doubt, the guide wins.
2. **Visual reference:** `design/style-guide/mockups/system-map.html` — open in a
   browser. Section **05 · Color discipline** is the signal-color table as live
   swatches; sections 02–03 show the surfaces and shared primitives composed.
3. **Written tightening:** `docs/prds/planned/pan-dashboard-unified-redesign.md`
   §4.5 ("Color & Style Discipline") — the PAN-1148 "Always means / Never used
   for" table now folded into the guide.
4. **Tokens:** `src/dashboard/frontend/src/index.css` (light + dark blocks) and
   `src/dashboard/frontend/tailwind.config.js`. Conformance is exercised by
   `tests/e2e/styleguide-conformance.spec.ts`.

## The rules agents violate most (memorize these)

### Typography (PAN-698 canon — absolute)

- **DM Sans** for ALL UI prose. Inter, SF Pro, Segoe UI, -apple-system are
  **deprecated — never reintroduce**.
- **SF Mono** (`font-mono`) ONLY for technical identifiers: code, paths,
  branch names, PR numbers, issue IDs, session/run IDs, model IDs, hashes,
  env vars. Never on titles, badge labels, or button text.
- **Space Grotesk** (`font-display`) ONLY for the sidebar "Overdeck"
  wordmark. Nowhere else (God View is the lone scoped exception).
- **`font-medium` (500) for everything.** No semibold, no bold. Hierarchy
  comes from size and color contrast, not weight.

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

- `rounded-sm`, h-5, `font-medium`; tint formula: **8% background / 32%
  border** (`bg-{signal}/8 border-{signal}/32 text-{signal}-foreground`).
  No pills (`rounded-full`) for status badges.
- Pick ONE indicator pattern per context — don't mix dots + badges + colored
  text for the same concept in one view.

### Forbidden patterns (hard bans)

```
bg-gray-800 / text-white / border-gray-700   → bg-card / text-foreground / border-border
bg-blue-600 / text-blue-400                  → bg-primary / text-primary
hardcoded hex (#22c55e, #ef4444, …)          → semantic tokens
slate-* grays (cold)                         → neutral-* (warm) — everywhere
```

Surfaces: depth via tonal layering (`--card`, `--card-2`), not shadows;
borders `white/6%` dark, `black/5%` light; light-mode cards are borderless
(ambient shadow instead).

## Workflow

- Before styling anything new, open the system map mockup and find the
  nearest existing primitive — match it, don't invent.
- For mockups: build with the real tokens (copy the dark/light blocks from
  `index.css`), DM Sans via Google Fonts, and state conformance deltas
  explicitly. Put mockups in `docs/design/`.
- Reviewing UI diffs: grep the diff for forbidden patterns above and for
  `font-bold|font-semibold|Inter|rounded-full.*badge|slate-` — each hit is a
  finding.
