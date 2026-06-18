## Problem

The **Flywheel page** has had many features bolted on piecemeal — status header + config toggles, suggestions list, "Pending auto-merges" banner, the new "Merge policy" roster, the conversation pane, and the activity feed — and the result is a dense, stacked, hard-to-read page. It needs an information-architecture pass, not another bolt-on.

## Ask

Redesign the Flywheel page with a clear visual hierarchy. Treat the existing sections as content to re-organize, not preserve as-is (no actions/data should be lost — reorganize, don't drop).

## Requirements to fold in

- **Clear hierarchy / breathing room** — the current stacked banners read as a glob.
- **Surface merge-train state** (relates to [PAN-1691](https://github.com/eltmon/overdeck/issues/1691)):
  - For the on-demand **UAT-candidate branch** (the auto-merge-OFF mode that bundles several ready features for one UAT session): show **which features are bundled on it** and the **branch's name**. Today there's no visual indication of either.
  - The merge-queue batch/serialize plan and the per-issue **Merge policy** roster should fit cleanly, not as stacked banners.

## Relates

- [PAN-1691](https://github.com/eltmon/overdeck/issues/1691) — conflict-aware merge train (the UAT-candidate branch + plan this page should visualize).
- [PAN-1661](https://github.com/eltmon/overdeck/issues/1661) — Command Deck issue-view remodel (same IA-cleanup spirit; keep consistent).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
