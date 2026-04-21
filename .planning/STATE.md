# PAN-698: Dashboard Typography Cleanup — Planning State

## Status: In Progress

## Current Phase
Implementing bead pan-569-sqg (eliminate Mission Control typography island) — mission-control.module.css

## Completed Work
- [x] pan-569-a5u: Normalize typography foundation stacks (commit: 1b790fa7)
  - tailwind.config.js: cleaned fontFamily.body/mono stacks
  - index.css: aligned body and .terminal-output with canonical stacks
- [x] pan-569-sqg: Eliminate Mission Control typography island (commit: 22d4bf02)
  - mission-control.module.css: --mc-font-family → DM Sans, --mc-font-mono → canonical SF Mono
  - Removed .chatMarkdown hardcoded Segoe UI stack
  - Converted .conversationName and .conversationNameInput from mono to DM Sans prose
  - Added comments to all remaining mono rules

## Remaining Work
- [ ] pan-569-z1o: Convert conversation list titles to DM Sans prose
- [ ] pan-569-nar: Normalize chat message prose to DM Sans, mono for code only
- [ ] pan-569-il0: Restrict Sidebar font-display to Panopticon wordmark only
- [ ] pan-569-4km: Convert AwaitingMergePage title from font-display to DM Sans
- [ ] pan-569-f03: Convert MetricsSummaryRow values from font-display to DM Sans
- [ ] pan-569-ces: Replace XTerminal ad hoc mono stack with canonical SF Mono
- [ ] pan-569-l9t: Repo-wide sweep: remove remaining non–God-View font drift
- [ ] pan-569-uf4: Rewrite STYLE-GUIDE.md typography section with crisp boundaries
- [ ] pan-569-jp1: Align related PRDs/docs with final typography policy
- [ ] pan-569-882: Playwright visual verification of non–God-View typography surfaces
- [ ] pan-569-ugd: Pass typecheck, lint, and test gates

## Key Decisions
- D1: Canonical stacks defined in foundation files only:
  - body: `"DM Sans", system-ui, sans-serif`
  - mono: `"SF Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace`
  - display: `"Space Grotesk", system-ui, sans-serif` (sidebar wordmark only)
- D2: No ad hoc platform fonts (-apple-system, BlinkMacSystemFont, Segoe UI, Inter, SF Pro, Menlo, Monaco, Courier New) anywhere in non–God-View UI

## Specialist Feedback
- None
