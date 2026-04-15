# PAN-711: Remove stale transitional route alias follow-ups

## Status: Ready for Merge

## Current Phase
Finalizing PAN-711 after both beads closed and verification passed; next step is `pan done` to hand off for review.

## Completed Work
- [x] panopticon-cli-fwo3: Updated stale alias-path references in `docs/TESTING.md`, `docs/PRD-CLOISTER.md`, `docs/FIX-ALL-PRD.md`, and `docs/prds/active/pan-509/STATE.md` (commit: 81b0cdf0)
- [x] panopticon-cli-q2vn: Added `tests/unit/dashboard/no-alias-routes.test.ts` to fail if deleted workspace alias routes reappear under `src/` (commit: e85b3c22)
- [x] verification: Ran `npm run typecheck`, `npm run lint`, `npm run build`, and `npm test`; build was required because CLI fixture and option-parsing tests execute `dist/cli/index.js` (commit: pending)

## Remaining Work
- [ ] Push branch and signal completion with `pan done`

## Key Decisions
- PAN-711 remains a follow-up issue even though PAN-705 already removed the runtime alias routes on `main`; the remaining work is only a regression guard test plus live-doc cleanup.
- Historical incident logs and completed PRD archives stay untouched; only living reference docs are updated because changing historical records would falsify prior state.

## Specialist Feedback
- None.
