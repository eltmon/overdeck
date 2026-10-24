---
type: feedback
description: The Flywheel merges approved, green, mergeable Overdeck PRs itself
  via POST /api/issues/:id/merge when main is green; operator granted 2026-10-24
updated: 2026-10-24
---

The Flywheel loop may merge a PR itself, without asking, when the PR is approved at its head, every check is green, GitHub reports it MERGEABLE/CLEAN, and the newest completed CI run on main succeeded. Merge through Overdeck's own door, POST /api/issues/<id>/merge (the Merge button's route; it runs the merge gate and the post-merge lifecycle), never gh pr merge and never an admin bypass. Then deploy with pan reload once CI on the merge commit is green, and close out with pan close <id> --force.

**Why:** on 2026-10-24 the operator said "I should not have to leave overdeck for the merge" and "you can do the merging!" after the Flywheel kept parking approved PRs as needs-you.

**How to apply:** still never merge while main is red, never merge a PR with changes requested, a held-for-UAT label (hold-for-uat) or a vetoed issue, and never add or remove the operator-only labels (released, auto-merge, hold-for-uat, vetoed). This overrides the pan-flywheel skill's 'merges stay explicit' rail for approved green PRs only.
