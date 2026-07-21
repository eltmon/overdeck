---
scope: universal
---
### Let the state write door commit and push `overdeck-state`

Update permanent pipeline state only through its canonical `pan` command or domain writer. The writer immediately commits and pushes its concrete file changes from the dedicated `overdeck-state` worktree; routine state persistence is automatic and must not be replaced with manual `git add`, `git commit`, or `git push`, or an operator approval request.

If the writer reports dirty unknown files or a failed push, investigate the ownership or transport failure. Do not stage unrelated files, bypass the write door, or ask the operator to approve a routine state push.
