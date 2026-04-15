# PAN-711: Remove stale transitional route alias follow-ups

## Status: In Progress

## Current Phase
Updating `.planning/STATE.md` and closing bead `panopticon-cli-fwo3` after replacing stale live-doc references to renamed review/merge endpoints.

## Completed Work
- [x] panopticon-cli-fwo3: Updated stale alias-path references in `docs/TESTING.md`, `docs/PRD-CLOISTER.md`, `docs/FIX-ALL-PRD.md`, and `docs/prds/active/pan-509/STATE.md` (commit: pending)

## Remaining Work
- [ ] panopticon-cli-q2vn: Add a Vitest regression guard that fails if deleted alias route literals reappear under `src/`

## Key Decisions
- PAN-711 remains a follow-up issue even though PAN-705 already removed the runtime alias routes on `main`; the remaining work is only a regression guard test plus live-doc cleanup.
- Historical incident logs and completed PRD archives stay untouched; only living reference docs are updated because changing historical records would falsify prior state.

## Specialist Feedback
- None.
