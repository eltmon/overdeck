# B (wave 3) — Decompose `KanbanBoard.tsx` (frontend god component)

**Epic:** B · **Branch:** `codebase-health/kanban-decomp` (off `main`) · **Executor:** GPT-5.5 (handoff), supervised by conv #182
**Mode:** orchestrated handoff — **do NOT run `pan done`, do NOT open a PR.** Commit per seam; the orchestrator reviews + merges.

---

## Goal
Behavior-preserving decomposition of `src/dashboard/frontend/src/components/KanbanBoard.tsx` (~3,017 lines) into utils + sub-components + a hook. Extract the seams below **safest-first**, **commit per seam**, verify after each. Partial is fine if context runs low — stop after the last committed seam and report.

## Seams (recommended order: 1 → 2 → 3 → 4 → 5 → 6)
| # | New file(s) | What moves | Risk |
|---|---|---|---|
| 1 | `KanbanBoard/kanban-utils.ts` | pure helpers + constants: `formatCost`/`getCostColor`/`formatRuntime`/`cardAvatarInitials`/`avatarGradient`, `groupByStatus/Labels/Project/CanceledType`, `buildHierarchy`, `applyReviewStateToIssue`, badge-predicate helpers, `generateMockRallyData`, color/title consts (~500 lines) | LOW |
| 2 | `KanbanBoard/badges/*.tsx` | `DivergedBadge`, `ReviewInfraStuckBadge`, `DeaconIgnoreButton`, `DifficultyBadge`, `TrackerShadowBadges` (each keeps its own store mutation, isolated) | MED |
| 3 | `KanbanBoard/dialogs/*.tsx` | `AgentWarningDialog`, `SyncPromptDialog`, `UndoToast`, `BeadsDialog` (dumb presenters; callbacks stay in parent) | LOW |
| 4 | `KanbanBoard/hooks/useDragDrop.ts` | sensors + drag state (`activeDragIssue`/`activeDragStatus`/`activeOverId`) + `handleDragStart/Over/End` (wrap handlers in useCallback; takes `issues` + mutation/undo callbacks) | MED |
| 5 | `KanbanBoard/cards/*.tsx` + `KanbanBoard/columns/ColumnContent.tsx` | `IssueCard`, `FeatureCard`, `CompactChildCard`, `ListIssueRow`, `DraggableCardWrapper`, `DragOverlayCard`, `ColumnContent` (preserve exact prop contracts) | MED |
| 6 | `KanbanBoard/views/KanbanFilterBar.tsx` | cycle/project filters + refresh + include-closed-out + expand/collapse + count (pure UI; state stays in parent) | LOW |

(The full analysis with prop interfaces + gotchas was produced by the codebase analysis — follow its prop contracts. Keep dual-mode external state, undo history, dialog choreography, and memoized groupings owned by `KanbanBoard`; extracted cards/badges/dialogs receive data + callbacks as props. Preserve issue-id case-sensitivity in key lookups.)

## Requirements
**FR-1** Each seam in its own file(s); `KanbanBoard` imports + uses them; the board renders/behaves identically (cards, drag-drop, dialogs, filters).
**FR-2** Each seam a separate commit (`refactor(dashboard): extract <seam> from KanbanBoard`).
**FR-3** After each seam: `npm run build` + `npm run lint` pass; Kanban frontend tests pass.

**NFR-1** Behavior-preserving only — no logic/UX change, no renames.
**NFR-2** A1 ratchet: no NEW `any`; moved `any` → add new file(s) to `eslint-any-allowlist.json` (don't convert).
**NFR-3** File-size guard: every new file < 1,000 lines (split cards into separate files as listed).
**NFR-4** React hook rules; drag-drop sensor identity stable (useSensors/useCallback) so DnD keeps working.

## Verification (after EACH seam)
```
npm run build && npm run lint
npm --prefix src/dashboard/frontend run test -- $(grep -rl -i kanban src/dashboard/frontend/src/__tests__ 2>/dev/null | tr '\n' ' ')
```
Sanity: after seam 4 (drag-drop) and seam 5 (cards), confirm a drag still moves a card and a card still opens — the analysis flagged these as the touchiest.

## Acceptance criteria
- Seams extracted safest-first (as many as context allows); `KanbanBoard.tsx` materially smaller (seam 1 alone ≈ −500 lines, seam 5 ≈ −850).
- `npm run build` + `npm run lint` exit 0; Kanban tests green.
- Each seam's diff is a behavior-preserving move (+ allowlist entries for moved `any`).
- If stopped early, note done vs remaining.

## Intersecting rules (restated)
No bandaids; surgical/behavior-preserving; A1 ratchet (moved `any` → allowlist); file-size guard (<1000/new file); React hook rules; worktree discipline (branch = `codebase-health/kanban-decomp`; never `git checkout <branch>`/`git stash`); conventional commits (lowercase subject), never `--no-verify`; **do NOT run `pan done` or open a PR** — report blockers/early-stop to the orchestrator.

## Out of scope
Any UX/logic change; bulk-operations + view-mode-switch logic (leave in `KanbanBoard` unless a clean seam emerges).
