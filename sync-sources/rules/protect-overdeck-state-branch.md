---
scope: universal
---
### NEVER delete the `overdeck-state` branch

**Never delete the `overdeck-state` branch — not the local ref, not the remote.** This applies to every project, every harness, every role. Forbidden in all forms: `git branch -d/-D overdeck-state`, `git push origin --delete overdeck-state`, `git push origin :overdeck-state`, deleting it through the GitHub UI/API, and removing the state worktree at `${OVERDECK_HOME}/state/<project>/` to get the branch "unlocked" for deletion.

`overdeck-state` is the same-repo orphan branch holding the project's permanent pipeline state (PAN-2541): `records/`, `specs/`, `continues/`, `drafts/`, `.beads/`, and the migration-complete marker. It shares no history with `main` — deleting it destroys the canonical state plane, and no code branch can restore it. The branches also never merge in either direction; guards enforce that mechanically, so never bypass them with `--no-verify` or `--allow-unrelated-histories`.

If an operation seems to require deleting or recreating `overdeck-state`, stop and surface to the operator — there is no agent-side exception.
