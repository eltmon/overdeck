---
scope: universal
---
### Worktree discipline — never `checkout` inside a workspace

Panopticon workspaces are git worktrees on a feature branch named `feature/<issue-id-lowercase>`. A worktree is just a directory whose HEAD is checked out to that branch — it does NOT lock you to the branch. If HEAD drifts to `main` or becomes detached, subsequent commits land on the wrong branch.

**Rules:**

- Never run `git checkout <other-branch>` inside a workspace. This is the most common way a worktree drifts off its feature branch.
- Before your first edit in a session, and after any operation that could move HEAD (`git rebase`, `git pull --rebase`, a failed `pan sync-main`), verify your branch:
  ```bash
  git branch --show-current     # must match feature/<issue-id>
  git rev-parse --show-toplevel # must be workspaces/feature-<issue>/, not the primary repo
  ```
- If `git status` shows `HEAD detached at <sha>`, stop. Do not commit. A rebase or checkout aborted without restoring HEAD. Report it via `pan tell` — do not attempt to recover by editing.
- The primary project worktree (the repo root checked out on `main`) is shared across all sessions. Edits there bypass the review pipeline and land directly on `main`. If `git rev-parse --show-toplevel` returns the primary repo path instead of your `workspaces/feature-<issue>/` path, you are in the wrong place — stop and report.

**Why:** every commit and push relies on the current branch; no part of the pipeline auto-checks it. Only the agent's own pre-edit self-check catches drift before damage is done.
