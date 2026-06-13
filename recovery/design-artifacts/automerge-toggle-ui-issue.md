## Summary

Surface a **per-issue auto-merge toggle** across the dashboard. This is the concrete UI for the `autoMerge` routing bit introduced by PAN-1691: **⚡ Auto-merge** (ride the train, ship when green) vs **🔒 Hold for UAT** (wait for human batch review).

Mockup (clickable): `.tmp/automerge-toggle-mockup.html`.

## The one bit, four render sites

There is no persistent per-issue auto-merge flag today (auto-merge is a transient per-PR schedule). Add `autoMerge: boolean` to `ReviewStatus` (`src/lib/review-status.ts`), persist it, expose one shared endpoint `POST /api/flywheel/issues/:id/auto-merge`, and render it in four places. It is one flag with four call sites, not four features.

### A · Issue slide-out — **primary**
Inline segmented `⚡ Auto / 🔒 Hold for UAT` control in the header strip (with gates/PR/cost), **below** the tabs so it is visible regardless of active tab. NOT a new tab (a tab is a heavyweight view; this is a one-bit setting).

### B · Flywheel page — "Merge policy" section — **bulk control**
New roster section listing every pipeline issue with a per-row switch and a live `N auto · M hold` summary. Set policy for the whole pipeline at a glance.

### C · Pipeline page — row badge — **lightweight**
A click-to-flip `⚡auto`/`🔒hold` chip in the existing per-issue row. Zero layout cost.

### D · Awaiting Merge page — **highest impact**
The toggle next to the Merge button (where the bit actually fires), alongside the PAN-1691 "merge next N" control.

## Data + API

- `ReviewStatus.autoMerge?: boolean` (default depends on project config; absent = follow project default).
- DB: column on the review-status store (`src/lib/database/review-status-db.ts`).
- `POST /api/flywheel/issues/:id/auto-merge { autoMerge: boolean }` — single endpoint all four surfaces call; emits a domain event so all open views update live.
- The flag is the routing key for PAN-1691's fast-lane (auto) vs UAT-lane (hold).

## Components

- `src/dashboard/frontend/src/components/flywheel/` — new "Merge policy" roster (B).
- Issue slide-out / detail panel — header-strip segmented control (A).
- `src/dashboard/frontend/src/components/Pipeline/` — row badge (C).
- `src/dashboard/frontend/src/components/AwaitingMergePage.tsx` — per-row toggle + merge-next-N (D).
- Shared `AutoMergeToggle` component reused by all four.

## Relates

Implements the UI/routing-key half of PAN-1691.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
