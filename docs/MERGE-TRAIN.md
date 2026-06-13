# Merge Train — design, status & remaining-work PRD

> **⚠️ SUPERSEDED (2026-06-10).** The merge-model described here — the disjoint-only
> "UAT candidate" with a manual *Assemble* / *Ship batch* control — was replaced by
> **UAT batch trains** ([PAN-1737](https://github.com/eltmon/panopticon-cli/issues/1737)):
> auto-assembled rolling generations that resolve cross-feature conflicts *inside*
> the batch, with "promote the batch" as the merge and on-demand live UAT stacks.
> **For the current model see [`UAT-BATCH-TRAINS.md`](./UAT-BATCH-TRAINS.md).**
> This document is retained as the historical PAN-1691 decision record (the engine,
> the tri-state auto-merge policy, and the reconciler it describes still underpin
> the batch trains). The verb-contract gap noted in §7 was fixed in
> [PAN-1736](https://github.com/eltmon/panopticon-cli/issues/1736). The
> Flywheel-coupling gap noted in §7 was resolved by
> [PAN-1696](https://github.com/eltmon/panopticon-cli/issues/1696) in 2026-06.

> Mind-dump / handoff for PAN-1691 and friends, written 2026-06-09 because the
> implementing session is near compaction. This is the single source of truth
> for what's done, what's left, every decision made, and the file map. Read this
> first to continue the work.

## 1. The problem (why this exists)

When one feature merges to `main`, **every other ready feature is now behind main**.
In Panopticon today they go stale / `CONFLICTING` and strand — nobody re-rebases
them. That stranding is the root cause of the cascade bugs **PAN-1240, PAN-1215,
PAN-1213, PAN-1658**. The expensive part isn't the rebase, it's the forced
**re-verification** after each rebase. The fix is a conflict-aware **merge train**
+ a per-issue **auto-merge policy** + a post-merge **reconciler**.

## 2. Issues

| Issue | Scope | State |
| --- | --- | --- |
| PAN-1691 | Conflict-aware merge train (engine) | **DONE** — engine + git last-mile (assemble/merge-next) shipped; only live-cascade validation (5d) remains |
| PAN-1692 | Per-issue auto-merge toggle UI (4 placements) | **DONE** |
| PAN-1693 | Project-settings panel | **DONE** — `ProjectSettingsSection` in the project cockpit + `GET/POST /api/projects/:key/auto-merge-default` |
| PAN-1694 | Flywheel page redesign | **DONE** — full v3 layout shipped (commit `6dcff1983`) |
| PAN-1695 | Per-project auto-merge default | **DONE** (config + resolver + cockpit UI) |
| PAN-1696 | Decouple merge-train from the Flywheel | filed as future follow-up (see §7) |
| PAN-1240/1215/1213/1658 | Cascade bugs | NOT closed — fixed only when the reconciler flag is on + validated (5d) |

## 3. Decisions made (do not re-litigate)

- **Tri-state `autoMerge`** on `ReviewStatus`: `undefined` = follow default, `true` = auto-merge (fast lane), `false` = hold for UAT (manual lane).
- **Resolution order**: per-issue `autoMerge` → per-project `auto_merge_default` (`'auto'|'hold'`) → global `flywheel.require_uat_before_merge`. Implemented in `shouldHoldForUat()`.
- **Disjoint branches batch** (merge together, one verification pass); **conflicting branches serialize broadest-file-footprint first** (the rest rebase once onto the worst offender).
- **Conflicts are resolved by an AGENT, never a human.** On a sibling rebase conflict the reconciler dispatches a `work` agent with the just-merged issue as context; the agent must reconcile *both* features' intent. Who resolves (work vs merge agent) is secondary; understanding both changesets is the firm requirement.
- **Merge train is behind a default-OFF flag** `flywheel.merge_train_enabled` (it mutates git). Inert until an operator enables it.
- **Idempotency is structural, not a prompt.** The post-merge re-entry guard is `createInFlightGuard()` locked by `in-flight-guard.test.ts` (replaced the CLAUDE.md "never delete this" note). Adding to the post-merge path is fine as long as that test stays green.
- **UAT candidate naming**: **codename + short date**, e.g. `uat/pan-otter-0609` (random word + MMDD). User-approved. Generator needs a small wordlist + collision-check vs existing `uat/` branches.
- **UAT bundle shown once**: the bundled issues render as members grouped *under* the candidate header; serial items sit below — never a "bundles X,Y" line AND a separate queue list.
- **Project-settings panel placement**: the **project cockpit view** (when you click a project in Command Deck).
- **Flywheel redesign = v3** (`.tmp/flywheel-redesign-mockup-v3.html`, approved): slim **header bar** holds flywheel-level controls (flywheel Pause + the config toggles + stats); a **collapsible control rail** (Merge policy / Merge queue+UAT / Pending / Suggestions); a **conversation column** whose control bar holds agent-level controls — Conversation/Terminal tabs + run meta (`RUN-x · model · effort · ctx%`), **Pause/Resume** primary, **⋯ More** overflow (New Run, Write Report, Open Run Report, Pop out, Configure), **Abort** red + isolated. Nothing dropped — reorganized.

## 4. DONE (committed to `main`, all green)

Engine (pure + tested):
- `src/lib/flywheel-merge-order.ts` — `computeMergeQueue` (now conflict-aware, has `batchGroup`), `orderMergeCandidates`, `planMergeTrain` (batch/serialize), `planUatCandidate` (branch name + bundled).
- `src/lib/cloister/in-flight-guard.ts` — `createInFlightGuard` (idempotency primitive).
- `src/lib/cloister/merge-train-reconciler.ts` — `reconcileStaleSiblings` (pure orchestrator).
- `src/lib/cloister/merge-train.ts` — `runMergeTrainReconcile` (flag-gated entry, lazy-loads real deps).
- `src/lib/cloister/merge-train-deps.ts` — real git rebase/force-push + `spawnRun` for re-review & conflict resolution (only runs with flag on).
- `src/lib/cloister/merge-batch.ts` — `shipMergeBatch` (sequential merge, stop-on-failure; engine for ship-candidate / merge-next-N).
- `src/lib/cloister/auto-merge-policy.ts` — `shouldHoldForUat` (3-tier), `getProjectAutoMergeDefault`.

Flag + data:
- `src/lib/database/app-settings.ts` — `isMergeTrainEnabled` / `setMergeTrainEnabled` (`flywheel.merge_train_enabled`, default false).
- `src/lib/review-status.ts` — `autoMerge` field + `setAutoMerge` (emits `status_changed`).
- `src/lib/database/review-status-db.ts` — `auto_merge` column, **schema v50** migration.
- `packages/contracts/src/types.ts` — `ReviewStatusSnapshot.autoMerge`; `src/dashboard/server/read-model.ts` maps it.
- `src/lib/projects.ts` — `auto_merge_default?: 'auto'|'hold'` on `ProjectConfig`.

Server routes:
- `src/dashboard/server/routes/workspaces.ts` — `POST /api/workspaces/:id/auto-merge`.
- `src/dashboard/server/routes/flywheel.ts` — config carries `merge_train_enabled`; tri-state gate in `postAutoMergeSchedulePayload` (uses `shouldHoldForUat`); `GET /api/flywheel/uat-candidate`; merge-queue carries `batchGroup`.
- `src/dashboard/server/routes/specialists.ts` — `firePostMergeLifecycle` uses `postMergeGuard` and calls `runMergeTrainReconcile(issueId)` after `postMergeLifecycle`.

Frontend (4 toggle placements + flag UI + viz):
- `AutoMergeToggle.tsx` (segmented + badge, hovertip resolves the default), `AwaitingMergePage.tsx`, `CommandDeck/SessionView/IssueHeader.tsx`, `primitives/IssueRow.tsx` (`trailingBadge`), `Pipeline/PipelineView.tsx`, `MergePolicySection.tsx`, `pages/FlywheelPage.tsx` (merge-train config toggle), `flywheel/FlywheelConversationPane.tsx` (batch/serial chips + UAT-candidate line).

Tests: `tests/unit/lib/flywheel-merge-order.test.ts`, `tests/unit/lib/cloister/{in-flight-guard,merge-train,merge-train-reconciler,merge-batch,auto-merge-policy}.test.ts`, `src/dashboard/server/routes/__tests__/flywheel.test.ts`, `tests/unit/lib/database/review-status-db.test.ts`, `src/lib/cloister/__tests__/auto-merge-eligibility.test.ts`.

## 5. REMAINING WORK (the plan)

> **Status (2026-06-09):** 5a, 5b, 5c are **DONE, committed, pushed, built, reloaded, and visually verified**. Only **5d** remains, and it is blocked on a *live* merge an operator must trigger — it cannot be synthesized.

### 5a. UAT git-execution (PAN-1691 last mile) — ✅ DONE
1. **Codename generator** — `src/lib/cloister/uat-candidate-name.ts`: random word from `UAT_CODENAMES` + `MMDD`, collision-checked vs existing `uat/*` branches. Pure core + injected date/wordlist. ✅
2. **UAT branch assembly** — `uat-assemble.ts` + `uat-assemble-deps.ts`: create `uat/<codename>-<MMDD>` off `origin/main`, merge each bundled feature branch, report conflicts. On-demand git-deps factory. ✅
3. **Ship batch / merge-next-N endpoint** — `POST /api/flywheel/merge-next { n }` and `POST /api/flywheel/assemble-uat`. `defaultGetOrderedIssueIds` runs the real `computeMergeQueue`; `defaultMergeOne` wraps the real per-issue merge (`triggerMerge` in `workspaces.ts`). ✅
4. **UI** — `FlywheelConversationPane.tsx`: batch/serial chips, grouped UAT-candidate line with **Assemble** button, and a **merge next [N] · Ship** stepper. Optimistic + toast. ✅

### 5b. Project-settings panel (PAN-1693) — ✅ DONE
- **Location**: `ProjectSettingsSection` inside `CommandDeck/ProjectOverview.tsx` (the project cockpit), threaded `projectKey` from `Stage/ProjectHome.tsx` + `CommandDeck/index.tsx`.
- **Endpoint**: `GET/POST /api/projects/:key/auto-merge-default` reading/writing the `projects.yaml` entry via `getProjectSync` / `setProjectAutoMergeDefaultSync`.
- **UI**: segmented auto / hold / default control. (Endpoint scoped to `auto_merge_default`; a broader `/settings` surface can expand later.)

### 5c. Flywheel redesign (PAN-1694 — v3) — ✅ DONE (commit `6dcff1983`)
Full v3 layout in `pages/FlywheelPage.tsx`: slim flywheel-level header bar (title, run pill, docs link, config toggles, inline stats), a control rail hosting `PendingAutoMergesBanner` + `MergePolicySection` + Status/State/Stats tabs, and the conversation column with the full agent control bar. Nothing lost; 12 FlywheelPage tests green.

### 5d. Reconciler validation → close cascade bugs — ⛔ BLOCKED on a live merge
Turn `merge_train_enabled` ON, observe ONE real cascade (a merge → siblings rebase, a conflict → agent dispatched), confirm `in-flight-guard` test stays green and no loop. THEN close PAN-1240/1215/1213/1658 with evidence. **This is the only open item — it requires an operator to flip the flag and let one real merge happen; it cannot be synthesized in code.**

## 6. Patterns / rules for the remaining work
- **Orchestrator pattern**: pure DI orchestrator (tested) + flag-gated/on-demand entry + lazy-loaded real git/spawn deps (isolated, not unit-tested). See merge-train.ts / merge-train-deps.ts.
- **Commit subjects MUST be lowercase** (commitlint `subject-case` rejects PascalCase/UPPER). Scopes: `cloister|dashboard|db|cli|review|...`.
- Work on `main`, commit each green slice, push. **Never touch** the pre-existing dirty churn files (`.pan/continues/*`, `TEST.MD`) — `git add` only your files.
- Anything git-mutating or agent-spawning goes behind a flag or an explicit user action.
- `pan reload` to make server changes live (frontend is also live via build); verify with Playwright over `https://pan.localhost` (Playwright blocks `file://` — serve over http for mockups).

## 7. Future: decouple merge-train from the Flywheel? — resolved by PAN-1696 (2026-06)

The Flywheel began as a Panopticon-dev tool (keep agents working, surface holes the
deacon alone can't). The merge-train is broadly useful — and it's **already mostly
structurally decoupled**: the engine lives in `src/lib/` + `src/lib/cloister/`, the
reconciler fires from the **post-merge path** (`specialists.ts`), not the flywheel
run loop, and the per-issue/per-project policy works whether or not a flywheel run
is active.

The original coupling was cosmetic/locational:
1. the flag is `flywheel.merge_train_enabled` (flywheel-namespaced),
2. `GET /api/flywheel/merge-queue` + `/uat-candidate` read `flywheel.activePipeline`, so they're empty when no flywheel run is live,
3. the UI lives on the Flywheel page.

**Resolved by PAN-1696 (2026-06):** the merge-train is now a **per-project
pipeline** feature, not a flywheel-run feature. The global flag moved to
`merge_train.enabled` with a per-project `merge_train` override, ready sets come
from review-status records grouped by project instead of `activePipeline`, the
Awaiting Merge page and project cockpit expose the primary controls, and the
Flywheel page is just one viewer.
