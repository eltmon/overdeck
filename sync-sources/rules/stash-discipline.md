---
scope: universal
---
### Stash discipline — agents never `git stash`

**Agents never run `git stash`.** This applies to every project, every harness, every role. If you find your worktree dirty when you need it clean, the correct moves are:

1. **Commit** the changes (with a meaningful message)
2. **Discard** them via the project's discard primitive (e.g. `pan workspace discard --confirm` for Panopticon projects) — destructive, requires typed confirmation
3. **Surface to the user** if neither commit nor discard is appropriate — let the human decide

Never `git stash push`, `git stash save`, `git stash apply`, `git stash pop`, or any other stash operation. Stashes are silent state movement: dirty work goes into `refs/stash` where it is hard to find later and easy to lose. Explicit commit/discard/surface is the only acceptable disposition.

There is no agent-side exception. If a human operator chooses to preserve work using Git directly, that is outside the agent workflow and must be treated as human-owned state; agents still do not create, apply, pop, or drop it.

**Why:** PR #1537 (PAN-1531) removed Panopticon's silent stash flows. Silent agent-side stashing burned an entire day debugging a "missing work" incident before this rule was enforced.
