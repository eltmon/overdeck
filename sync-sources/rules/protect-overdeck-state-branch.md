---
scope: universal
---
### NEVER delete the `overdeck-state` branch

**Never delete the `overdeck-state` branch — not the local ref, not the remote.** This applies to every project, every harness, every role. Forbidden in all forms: `git branch -d/-D overdeck-state`, `git push origin --delete overdeck-state`, `git push origin :overdeck-state`, and deleting it through the GitHub UI/API.

The branch is archived, tagged `state-final`, and kept as history. Overdeck no longer reads or writes it — planning artifacts, specs, and task state now live under `.pan/` in the project repo. Deleting the archived branch would still destroy that history for no operational benefit.

If an operation seems to require deleting `overdeck-state`, stop and surface to the operator — there is no agent-side exception.
