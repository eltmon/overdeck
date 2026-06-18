---
scope: dev
---

### Commit often when working directly on main (Overdeck dev only)

When developing Overdeck itself, agents frequently work **directly on the
primary `main` worktree** rather than in an isolated feature workspace. On
`main` there is no review/merge pipeline to checkpoint your work, and other
agents (or the deacon's janitors) may be operating in the same repo at the
same time. An uncommitted working tree is the single most loss-prone state:
a rogue `git stash`, a `git checkout`, or a failed rebase elsewhere can
silently move or discard it.

**Therefore, on `main`, commit early and commit often.** Do not let a large
uncommitted change accumulate across many edits.

- Commit each coherent unit of work as soon as it builds, with a meaningful
  message — don't batch a whole session into one final commit.
- If you must pause mid-change, commit a WIP checkpoint rather than leaving
  the tree dirty (you can amend or squash later).
- Never rely on the working tree as storage between steps. The only durable
  state is a commit.
- This complements — does not replace — the stash-discipline rule: agents
  still never `git stash`. Commit, discard, or surface; never stash.

This rule is **Overdeck-development-specific** (`scope: dev`). It folds into
the global managed region only on a overdeck source checkout, so it
never ships to projects that merely *use* Overdeck — their agents work in
feature workspaces behind the review pipeline and don't need it.
