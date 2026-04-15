# PAN-711: Remove stale transitional route alias follow-ups

## Status: In Progress

## Current Phase
Updating `.planning/STATE.md` and closing bead `panopticon-cli-q2vn` after adding the alias-route regression guard test and verifying it passes.

## Completed Work
- [x] panopticon-cli-fwo3: Updated stale alias-path references in `docs/TESTING.md`, `docs/PRD-CLOISTER.md`, `docs/FIX-ALL-PRD.md`, and `docs/prds/active/pan-509/STATE.md` (commit: 81b0cdf0)
- [x] panopticon-cli-q2vn: Added `tests/unit/dashboard/no-alias-routes.test.ts` to fail if deleted workspace alias routes reappear under `src/` (commit: pending)

## Remaining Work
- [ ] Run full verification gates (`npm run typecheck`, `npm run lint`, `npm test`), then signal completion with `pan done`

## Key Decisions
- PAN-711 remains a follow-up issue even though PAN-705 already removed the runtime alias routes on `main`; the remaining work is only a regression guard test plus live-doc cleanup.
- Historical incident logs and completed PRD archives stay untouched; only living reference docs are updated because changing historical records would falsify prior state.

## Specialist Feedback
- None.
