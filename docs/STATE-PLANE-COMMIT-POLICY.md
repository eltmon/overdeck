# State-Plane Commit Policy

Permanent pipeline state lives on the same repository's orphan branch
`overdeck-state`, checked out at `${OVERDECK_HOME}/state/<projectKey>`. Its
tree is flat: `records/`, `continues/`, `specs/`, `drafts/`, `review/`,
`test/`, `feedback/`, `backlog/`, `notes/`, and `.beads/`.

The completion marker `migration-complete.json` at the tip of
`origin/overdeck-state` is the only migration authority. A missing branch or
an unmarked branch is legacy/in-progress; reads continue through the legacy
`.pan/` fallback and writes remain on the legacy surface until cutover.

## Write policy

- Domain writers are the only write door. They fetch first and perform locked
  read-modify-write operations with domain semantics: field-aware record merge,
  immutable-spec conflict rejection, and append/deduplicate for append-only data.
- The paths-only auto-commit queue stages concrete writer results on
  `overdeck-state`; it never rebases or replays a mutation it cannot understand.
- Every state commit asserts that the dedicated worktree is on
  `overdeck-state`. A missing/wrong/dirty worktree is surfaced, never discarded.
- `pan admin state migrate` owns a cross-process project lock. All write doors
  refuse visibly while it flushes, freezes, manifests, verifies, and cuts over.
- Code branches may delete legacy state during migration but may never add or
  modify state paths. `overdeck-state` may never contain source code.

Workspace runtime files are separate and gitignored under `.overdeck/` in the
workspace. Project context is code-owned at `.overdeck/context/` on `main`.
Neither belongs to `overdeck-state`.

## Legacy compatibility

The old permanent locations (`.pan/records/`, `.pan/continues/`,
`.pan/specs/`, `.pan/drafts/`, and project `.beads/`) are read-only fallbacks
during migration. Doctor and the Deacon flag their recreation after the marker
lands because that indicates a stray writer. They report the data and never
delete it.
