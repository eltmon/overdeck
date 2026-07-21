---
name: pan-hygiene
description: "pan hygiene [options] — audit whether orchestration work is committed, pushed, mergeable, live, and clean"
triggers:
  - hygiene check
  - merge state check
  - audit my orchestration
  - are we all pushed
  - anything stale
allowed-tools:
  - Bash
---

# Orchestration hygiene

Run `pan hygiene` when the operator wants one end-to-end audit of local commits,
the worktree, pull requests, agent/tmux consistency, merged branches, stale
workspaces, and disk headroom. Findings are reported without mutation.

Use `pan hygiene --json` for automation and `pan hygiene --strict` when findings
should fail a gate. `pan hygiene --fix-safe` may delete only branches confirmed
merged by GitHub; under disk pressure it may remove only terminal worktrees that
have no branch, open PR, live session, or uncommitted work. Adjust that cleanup
floor with `pan hygiene --fix-safe --fix-disk-pressure-floor 25`.

Never substitute stash, force-delete, reset, or force-push cleanup. If safe
cleanup reports no eligible candidates, surface the findings to the operator.
