# PAN-460: Dashboard Rebrand

## Status: In Progress

## Current Phase
Bead ei5 complete. Moving to bead 5c9 (Rename Mission Control to Command Deck).

## Completed Work
- [x] feature-pan-489-ssn: Rewrote index.css with semantic token architecture (light/dark), DM Sans font, fractal noise, scrollbars, no-transitions. Updated tailwind.config.js with semantic color tokens + radius scale. Updated index.html with DM Sans preloads and `.dark` class flash prevention. Updated useTheme.ts to toggle `.dark` class with no-transitions suppression. (commit: 13ade5e)
- [x] feature-pan-489-hvv: Created Sidebar.tsx (grouped sidebar with collapse/expand, keyboard shortcut, mobile sheet, localStorage persistence). Replaced Header.tsx with Tab type only. Updated App.tsx to flex-row sidebar + main layout. Renamed mission-control Tab → command-deck. (commit: 51cc5c1)
- [x] feature-pan-489-azd: Migrated KanbanBoard.tsx (zero hardcoded colors), ActivityPanel, DialogProvider, PlanDialog, TerminalView, XTerminal, IssueAgentCard, SpecialistAgentCard to semantic tokens. Added badge-bg-signal-cost/badge-border-signal-cost utilities. Fixed useTheme tests (.dark class) and store tests (selectIssuesByCycle). (commit: 81d93a92)
- [x] feature-pan-489-ei5: Migrated all Settings components (SettingsPage, ProviderCard, AgentCard, ModelOverrideModal, OpenRouterPage, OpenRouterModelBrowser, WorkTypeTable, SmartSelectionExplainer), plus KanbanBoard feature group and XTerminal UI overlays to semantic tokens. Zero hardcoded Tailwind colors in scope. (commit: 855dcc96)

## Remaining Work
- [ ] feature-pan-489-5c9: Rename Mission Control to Command Deck (frontend + server API)
- [ ] feature-pan-489-n88: Migrate God View to scoped semantic token overrides
- [ ] feature-pan-489-27f: Unify card, badge, button, and dialog patterns across all views
- [ ] feature-pan-489-6kg: Migrate all remaining page and feature components to semantic tokens
- [ ] feature-pan-489-u07: Verify all pages in both themes, run quality gates

## Key Decisions
- D1: Switched from `.light` class system to `.dark` class system (dark is CSS default `:root`, `.dark` overrides). Aligns with Tailwind darkMode: 'class'. The old `.light` class had no effect on Tailwind `dark:` utilities.
- D2: Using Tailwind v3 (not v4) — so `var(--token)` in config without `<alpha-value>` support for surface tokens. Signal colors also use `var()` since `/opacity` syntax isn't needed for the initial migration.
- D3: Fractal noise z-index set to 9999 so it overlays all content without blocking pointer events.

## Specialist Feedback
(none yet)
