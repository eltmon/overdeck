---
scope: universal
---
### Stash discipline — agents never `git stash`

**Agents never run `git stash`.** This applies to every project, every harness, every role. If you find your worktree dirty when you need it clean, the correct moves are:

1. **Commit** the changes (with a meaningful message)
2. **Discard** them via the project's discard primitive (e.g. `pan workspace discard --confirm` for Panopticon projects) — destructive, requires typed confirmation
3. **Surface to the user** if neither commit nor discard is appropriate — let the human decide

Never `git stash push`, `git stash save`, or any other stash creation. Stashes are silent state movement: dirty work goes into `refs/stash` where it is hard to find later and easy to lose. Explicit commit/discard/surface is the only acceptable disposition.

The single exception is the `salvageable:` stash kind, which is reserved for *humans* preserving uncommitted work they want to recover later. Agents do not create these — only humans, only via explicit project tooling. The deacon's stash janitor recognises `salvageable:*` and leaves it alone forever.

**Why:** PR #1537 (PAN-1531) collapsed the historical four-kind stash taxonomy (`pre-merge:`, `pre-spawn:`, `review-temp:`, `salvageable:`) down to one. Panopticon code now creates **only** `salvageable:*` stashes, and only on explicit human action. Silent agent-side stashing burned an entire day debugging a "missing work" incident before this rule was enforced.
