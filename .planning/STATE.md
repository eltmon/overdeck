# PAN-858 — Command Deck project tree fit-and-finish

**Status:** In Progress
**Current Phase:** Implementation

## Completed Work

(none yet — beads created)

## Remaining Work

Six beads, one per problem area in the issue:

1. **Backend — phantom row root cause.** In `src/dashboard/server/routes/command-deck.ts` `fetchProjectTree`, validate that workspace dir names match `^feature-[a-z]+-\d+$` before treating them as features. Skip orphan dirs like `feature-800` at the data source, not at render time.
2. **Backend — hide stale legacy sessions.** Where session entries are emitted with `type: 'legacy'`, drop stopped legacy sessions older than 24h.
3. **Frontend — chevron indentation.** In `FeatureItem.tsx` + `command-deck.module.css`, move the indent from `.featureItem` padding-left onto `.featureItemRow` so the caret sits inside the tree.
4. **Frontend — derive session label.** In `SessionNode.tsx`, replace the raw `sessionId` text with a derived label (merge → "Merge agent", test → "Tests", work → `Work agent (${model})`, review/reviewer → `${role} reviewer`). Keep `sessionId` only in the `title` tooltip.
5. **Frontend — semantic status pill colors.** Map session status (`running`/`error`/`stopped`/`starting`) to semantic colors using existing `--mc-*` CSS vars. Reuse / extend `StatusDot` rather than introducing a parallel component.
6. **Frontend — fit & finish polish.** Row heights, ellipsis truncation with `title` tooltip, filter pill casing consistency, pill component reuse across the tree.

After all six: `npm run build`, capture before/after screenshots via Playwright, attach to PR, then `pan done PAN-858`.

## Key Decisions

- **`workspaces/feature-800` is NOT deleted.** It is an orphan worktree from prior work (last touched 2026-04-22). Per workspace-isolation rules we never wipe other workspaces. Fix is upstream input validation in `fetchProjectTree`.
- **Session label derivation is pure client-side.** No backend schema change; `sessionId` already flows through, we just stop rendering it as a column.
- **Legacy hiding belongs in the backend route**, where `type: 'legacy'` is assigned — not in the renderer (avoids "render-time filter" anti-pattern).

## Specialist Feedback

(none yet)
