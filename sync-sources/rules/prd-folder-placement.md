---
scope: dev
---
### Place draft PRDs on the state branch

Write draft PRDs to `drafts/<issue>.md` on `overdeck-state`, where `<issue>` is
the lowercase issue ID. On disk, that is
`${OVERDECK_HOME}/state/<project>/drafts/<issue>.md`. Do not place PRDs in
ad-hoc locations in the code checkout.

The state worktree is the canonical home for permanent planning artifacts
(drafts, specs, and continue state). For an unmigrated project only, the legacy
fallback remains `<projectRoot>/.pan/drafts/<issue>.md` until its migration
marker lands on `origin/overdeck-state`.
