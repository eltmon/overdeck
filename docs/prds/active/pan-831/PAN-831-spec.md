# PAN-831: Refinish Dashboard Rebrand

**Status:** In Progress  
**Base:** `main` (work directly on main)  
**Design Reference:** `design/style-guide/STYLE-GUIDE.md` v1.1 + T3Code (`/home/eltmon/Projects/t3code/apps/web/src/index.css`)

---

## Objective

Close the remaining gaps from PAN-460 and PAN-698 so the dashboard actually matches the canonical design system. The codebase currently has a dual token vocabulary (canonical semantic tokens + an extended non-standard layer), leftover `text-white`, unrenamed `MissionControl` artifacts, and an outdated `DialogProvider`.

## Scope

### 1. Eliminate Extended Token Layer

The codebase has an extended token vocabulary that is **not in the style guide** and does not exist in T3Code. Remove these definitions and migrate all usages to canonical tokens.

**Definitions to remove from `index.css`:**
- `--surface`, `--surface-raised`, `--surface-2`, `--surface-active`, `--surface-hover`, `--surface-overlay`, `--surface-emphasis`
- `--divider`, `--divider-strong`, `--divider-focus`
- `--content`, `--content-body`, `--content-muted`, `--content-subtle`
- `--input-bg`

**Definitions to remove from `tailwind.config.js`:**
- `surface`, `surface-raised`, `surface-2`, `surface-active`, `surface-hover`, `surface-overlay`, `surface-emphasis`
- `divider`, `divider-strong`, `divider-focus`
- `input-bg`

**Migration map:**

| Extended Token | Canonical Replacement |
|---|---|
| `bg-surface` | `bg-background` or `bg-card` (use judgment: page-level = background, card-level = card) |
| `bg-surface-raised` | `bg-card` |
| `bg-surface-2` | `bg-muted` |
| `bg-surface-active` | `bg-accent` |
| `bg-surface-hover` | `bg-accent` |
| `bg-surface-overlay` | `bg-popover` |
| `bg-surface-emphasis` | `bg-card` |
| `border-divider` | `border-border` |
| `border-divider-strong` | `border-border` |
| `border-divider-focus` | `border-ring` |
| `text-content` | `text-foreground` |
| `text-content-body` | `text-foreground` |
| `text-content-muted` | `text-muted-foreground` |
| `text-content-subtle` | `text-muted-foreground` |
| `bg-input-bg` | `bg-background` |

### 2. Replace `text-white` with Semantic Foreground Tokens

Find all occurrences outside GodView. On colored button backgrounds, use the matching foreground token:

| Background | Foreground Replacement |
|---|---|
| `bg-primary` | `text-primary-foreground` |
| `bg-success` | `text-success-foreground` |
| `bg-warning` | `text-warning-foreground` |
| `bg-destructive` | `text-destructive-foreground` |
| `bg-signal-review` | `text-signal-review-foreground` |
| `bg-signal-cost` | `text-signal-cost-foreground` |
| Neutral surfaces | `text-foreground` or `text-card-foreground` |

### 3. Rename Mission Control → Command Deck

- `src/dashboard/frontend/src/components/MissionControl/` → `CommandDeck/`
- `src/dashboard/server/routes/mission-control.ts` → `command-deck.ts`
- Update all imports, route registrations, and string references

### 4. Delete Isolated Codex Theme

- Delete `src/dashboard/frontend/src/components/MissionControl/styles/mission-control.module.css`
- Migrate any remaining necessary styles into global tokens or Tailwind utilities
- Verify Command Deck renders without the module

### 5. Upgrade DialogProvider

Match the PRD spec:
- Backdrop: `bg-black/32 backdrop-blur-sm`
- Panel: `bg-popover text-popover-foreground rounded-2xl border border-border shadow-lg/5`
- Animation: `scale-[0.98] opacity-0 → scale-100 opacity-100`, 200ms ease-in-out
- Center on viewport, never anchor to trigger
- Nested dialogs: `scale-[calc(1-0.1*var(--nested-dialogs))]`

### 6. Align `index.css` with T3Code Formulas

Replace raw hex/rgba in token definitions with the proper T3Code-style formulas:
- `--background: #ffffff` → `--background: var(--color-white)`
- `--foreground: #1f2937` → `--foreground: var(--color-neutral-800)`
- `--card: #ffffff` → `--card: var(--color-white)`
- `--secondary: rgba(0,0,0,0.04)` → `--secondary: --alpha(var(--color-black) / 4%)`
- `--muted: rgba(0,0,0,0.04)` → `--muted: --alpha(var(--color-black) / 4%)`
- `--accent: rgba(0,0,0,0.04)` → `--accent: --alpha(var(--color-black) / 4%)`
- `--border: #ebebeb` → `--border: --alpha(var(--color-black) / 8%)`
- `--input: #e5e5e5` → `--input: --alpha(var(--color-black) / 10%)`
- Dark mode: raw hex → `color-mix()` and `--alpha()` equivalents

## Out of Scope

- **God View** (`src/dashboard/frontend/src/components/GodView/*`) — untouched
- No new features
- No backend logic changes beyond route rename

## Acceptance Criteria

- [ ] `MissionControl` directory does not exist; `CommandDeck` does
- [ ] `mission-control.ts` server route does not exist; `command-deck.ts` does
- [ ] `mission-control.module.css` deleted
- [ ] Zero `text-white` outside GodView
- [ ] Zero extended token usages (`bg-surface`, `border-divider`, `text-content`, etc.)
- [ ] `index.css` uses T3Code-style formulas (`--alpha()`, `color-mix()`, `var(--color-*)`)
- [ ] `tailwind.config.js` contains only canonical tokens
- [ ] DialogProvider matches PRD spec
- [ ] `npm run typecheck`, `npm run lint`, `npm test` pass
- [ ] Dashboard renders in both light and dark mode
