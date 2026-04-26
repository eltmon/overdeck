# PAN-858 — Command Deck project tree fit-and-finish

**Status:** In Progress
**Current Phase:** Implementation

## Completed Work

All six beads merged on this branch:

1. ✓ `pan-x0rp` — backend: skip orphan `feature-<bad>` workspace dirs in `fetchProjectTree` (root cause for phantom 800/800 row).
2. ✓ `pan-k3w7` — backend: hide stopped legacy sessions older than 24h in `fetchProjectSessionTree`; same orphan-dir validation applied here.
3. ✓ `pan-l32w` — frontend: chevron indent moved onto `.featureItemRow` so caret sits inside the tree.
4. ✓ `pan-zrhf` — frontend: derive session label (`Merge agent`, `Tests`, `${Role} reviewer`, `Work agent (${model})`); raw `sessionId` now lives only in the row tooltip.
5. ✓ `pan-7ekv` — frontend: status pill rendered with semantic colors (running/error/starting/stopped) using existing `--mc-success`/`--mc-error`/`--mc-warning` tokens.
6. ✓ `pan-yb9y` — frontend: feature label tooltip on truncate, session row indent re-anchored to new feature row indent, tree filter buttons promoted to a CSS class.

Quality gates: typecheck, lint, build, full test suite (3889 tests) all passing.

## Remaining Work

- Capture before/after Playwright screenshots and attach them to the PR description per the issue's acceptance criteria.
- Then `pan done PAN-858`.

## Key Decisions

- **`workspaces/feature-800` is NOT deleted.** It is an orphan worktree from prior work (last touched 2026-04-22). Per workspace-isolation rules we never wipe other workspaces. Fix is upstream input validation in `fetchProjectTree`.
- **Session label derivation is pure client-side.** No backend schema change; `sessionId` already flows through, we just stop rendering it as a column.
- **Legacy hiding belongs in the backend route**, where `type: 'legacy'` is assigned — not in the renderer (avoids "render-time filter" anti-pattern).

## Specialist Feedback

(none yet)
