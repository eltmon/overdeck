## Problem

The merge-train (per-issue auto-merge toggle, conflict-aware order, reconciler, UAT candidate — [PAN-1691](https://github.com/eltmon/panopticon-cli/issues/1691)) is a **per-project pipeline** concern (how ready work *lands*), but it's currently presented as a **Flywheel** feature (which is really the *orchestrator* — keeping agents working). The Flywheel began as a Panopticon-dev tool; the merge-train is broadly useful to every project.

It's already ~80% structurally decoupled — the engine lives in `src/lib/` + `src/lib/cloister/`, and the reconciler fires from the **post-merge path** (`specialists.ts`), not the flywheel run loop. The remaining coupling is cosmetic/locational:

1. the flag is `flywheel.merge_train_enabled` (flywheel-namespaced);
2. `GET /api/flywheel/merge-queue` + `/uat-candidate` read `flywheel.activePipeline`, so they go empty when no flywheel run is live;
3. the UI lives only on the Flywheel page.

## Ask

Make the merge-train a first-class **per-project pipeline** feature, independent of any live flywheel run:

- Rename/move the flag (`merge_train.enabled` and/or per-project config) out of the `flywheel.*` namespace.
- Compute the merge queue / UAT candidate from the **review-status ready-set** (the pipeline), not `flywheel.activePipeline`.
- Surface the controls **per-project** — the project cockpit ([PAN-1693](https://github.com/eltmon/panopticon-cli/issues/1693)) and the Awaiting Merge page — with the Flywheel page becoming just one viewer.

## New capability this unlocks

A **multi-project merge view** with options like **selecting which projects are shown** (filter/pick projects), since the data no longer depends on a single flywheel run.

## Reference

`docs/MERGE-TRAIN.md` §7. **Low urgency** — the coupling is shallow — but do it before another project relies on the merge-train.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
