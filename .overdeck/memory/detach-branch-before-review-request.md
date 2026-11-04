---
type: feedback
description: "Handoff worktrees: push the feature branch, then git switch
  --detach before pan review request, or adoption silently fails"
updated: 2026-11-02
---

A supervised handoff that works in its own worktree must release the feature branch before asking for review: push, then 'git switch --detach' (keep the branch), then 'pan review request <id>'. While the branch is checked out in any worktree, Overdeck cannot create workspaces/feature-<id>, and nothing verifies or reviews the PR, even though pan review request prints a success message.

**Why:** PRs #4780 and #4783 (2026-11-02) sat unreviewed because hoff-merge-systems and hoff-merge-4750 held feature/pan-4750 and feature/pan-4772.

**How to apply:** after every push from a handoff worktree, detach, then request review; confirm workspaces/feature-<id> appears.
