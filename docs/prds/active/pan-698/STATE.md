# PAN-698: Dashboard Typography Cleanup — Planning State

## Problem

Panopticon's dashboard has three competing typography systems:

1. The intended canonical system (`tailwind.config.js`: `font-display` = Space Grotesk, `font-body` = DM Sans, `font-mono` = SF Mono stack; DM Sans set as `body` default in `index.css`).
2. Mission Control's local island in `mission-control.module.css` (`--mc-font-family` → Inter/SF Pro, `.chatMarkdown` → Segoe UI, list titles defaulting to mono).
3. Ad hoc `font-display` usage outside the sidebar wordmark (`AwaitingMergePage`, `MetricsSummaryRow`) and ad hoc mono stacks (`XTerminal`'s Menlo/Monaco/Courier New).

Result: visible inconsistency across nav, metrics, list views, and especially conversations. The current style guide is ambiguous enough ("use judgment if the heading has a g") that drift keeps returning.

## Policy (final, to be encoded everywhere)

- **DM Sans** — universal app sans for all non–God-View UI (body, headings, labels, nav, buttons, dialogs, tables, forms, metric values, conversation prose, list titles, metadata).
- **SF Mono** — code blocks, inline code, terminal output, command snippets, and identifiers presented as technical strings (session IDs, run IDs, file paths, env vars, hashes, model IDs, branch names, tool names, vBRIEF IDs).
- **Space Grotesk (`font-display`)** — **only** the upper-left `Panopticon` wordmark in `Sidebar.tsx`. No other non–God-View surface.
- **God View** (`src/dashboard/frontend/src/components/GodView/*`) — explicit, scoped typography exception. **Untouched** by this issue.

## Approach

### Token strategy: Tailwind utilities only
Use the existing `font-body` / `font-mono` / `font-display` utilities as the single source of truth. CSS-module custom properties (`--mc-font-family`, `--mc-font-mono`) will point to the same canonical stacks that Tailwind uses. No new semantic token layer — we just make the existing one enforceable.

### Conversation list titles → DM Sans prose
`.conversationName` drops mono styling. Titles are human-readable prose, not identifiers. Session IDs in metadata rows remain mono.

### Scope boundary
Everything in the PRD's implementation targets is in scope. God View is the only exception. The PRD's mention of Space Grotesk as a generic "display" font is corrected here: Space Grotesk applies **only** to the sidebar wordmark in non–God-View UI.

### Documentation
- `design/style-guide/STYLE-GUIDE.md` rewritten with crisp boundaries, no judgment-based heuristics.
- `docs/prds/active/pan-460/STATE.md` updated to match the final policy if it conflicts.
- `design/prd/PRD-REBRAND.md`, `docs/MISSION-CONTROL.md`, `docs/SETTINGS-UI-DESIGN.md` reviewed and corrected if they contradict the final rule.

## Decomposition

Fine-grained: ~12 beads. One bead per logical cluster so each lands as an independently reviewable diff. The foundation bead lands first (so downstream beads can reference canonical tokens), then file-scoped cleanups can run in parallel, then sweep + docs + verification.

## Verification

- **Static:** grep for non–God-View ad hoc sans stacks (`Inter`, `SF Pro`, `Segoe UI`, `-apple-system` raw stacks), ad hoc mono stacks (`Menlo`, `Monaco`, `Courier New`), and non–sidebar-wordmark `font-display` usage. All must return zero non–God-View hits.
- **Functional (Playwright, isolated browser/profile):** sidebar wordmark vs nav labels; conversation list vs conversation panel prose; inline + fenced code in assistant markdown; metrics row; awaiting-merge page; light + dark mode.
- **Gates:** `npm run typecheck`, `npm run lint`, `npm test` all pass before `pan done`.

## Playwright isolation

Any browser verification MUST use an isolated Playwright browser instance/profile. Do not reuse another agent's session or shared browser state. Login/setup, if required, must be reproducible inside the isolated session.

## Out of scope

- `src/dashboard/frontend/src/components/GodView/*` — untouched.
- No new font files, no new design tokens, no Tailwind config restructuring beyond what's needed to make the canonical stacks referenceable.
