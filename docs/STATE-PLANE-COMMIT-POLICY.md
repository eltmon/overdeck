# State-Plane Commit Policy

Permanent pipeline state lives on the same repository's orphan branch
`overdeck-state`, checked out at `${OVERDECK_HOME}/state/<projectKey>`. Its
tree is flat: `records/`, `continues/`, `specs/`, `drafts/`, `review/`,
`test/`, `feedback/`, `backlog/`, `notes/`, and `.beads/`.

The completion marker `migration-complete.json` at the tip of
`origin/overdeck-state` is the only migration authority. A missing branch or
an unmarked branch is legacy/in-progress. `pan sync`, dashboard coordinator
startup, and work startup automatically attempt the cutover; pipeline startup
is blocked if its no-loss gates cannot complete, so new writes do not extend
the legacy surface.

## Write policy

- Domain writers are the only write door. They fetch first and perform locked
  read-modify-write operations with domain semantics: field-aware record merge,
  immutable-spec conflict rejection, and append/deduplicate for append-only data.
- The paths-only auto-commit queue stages concrete writer results on
  `overdeck-state`; it never rebases or replays a mutation it cannot understand.
- Each queued result is committed and pushed on the next timer turn by default;
  there is no shipped batching delay. `OVERDECK_STATE_FLUSH_WINDOW_MS` is an
  explicit operator override that trades durability latency for fewer commits.
  A failed origin push is logged and returned as `pushed: false`, never reported
  as fully durable success.
- Spec lifecycle transitions are stricter: the transition does not return
  success until its `plan.status` update has passed through the state writer's
  commit-and-push flush. A configured origin that rejects the push fails the
  transition instead of leaving an apparently successful local-only status.
- Every Deacon patrol reconciles pre-existing dirty `specs/` and `records/`
  paths through the same writer. It never stages source files or unrelated
  operator changes.
- Every state commit asserts that the dedicated worktree is on
  `overdeck-state`. A missing/wrong/dirty worktree is surfaced, never discarded.
- `pan admin state migrate` owns a cross-process project lock. All write doors
  refuse visibly while it flushes, freezes, manifests, verifies, and cuts over.
- Automatic migration is single-flight within a process and uses that same
  cross-process lock. It overlays current tracked and untracked state onto the
  state branch before verification, including pipeline artifacts an agent may
  already have committed to `main`.
- Code branches may delete legacy state during migration but may never add or
  modify state paths. `overdeck-state` may never contain source code.

Workspace runtime files are separate and gitignored under `.overdeck/` in the
workspace. Project context is code-owned at `.overdeck/context/` on `main`.
Neither belongs to `overdeck-state`.

## Deletion protection

The branch must never be deleted — it is the sole home of permanent state and
shares no history with any code branch. For this repository the protection is
layered (added 2026-07-10):

- GitHub ruleset `protect-overdeck-state` blocks deletion and force pushes of
  `refs/heads/overdeck-state`, with no bypass actors.
- `.husky/pre-push` refuses to push a deletion of the branch.
- The dedicated state worktree keeps the branch checked out, so git refuses a
  local `git branch -D`.
- The universal bundled rule `sync-sources/rules/protect-overdeck-state-branch.md`
  forbids agents from deleting it in any form, on every machine and project.

The ruleset and hook cover this repository only; each migrated project needs
its own remote-side rule (see the migration runbook).

## Legacy compatibility

The old permanent locations (`.pan/records/`, `.pan/continues/`,
`.pan/specs/`, `.pan/drafts/`, and project `.beads/`) are read-only fallbacks
during migration. Doctor and the Deacon flag their recreation after the marker
lands because that indicates a stray writer. They report the data and never
delete it.

## Migration runbook

The Overdeck/panopticon-cli cutover completed on 2026-07-09 after eight
resume-safe attempts. Its valid marker is at the tip of
`origin/overdeck-state`, and `main` contains zero permanent-state paths. Apply
these operational lessons to the remaining projects: mind-your-now, krux,
lexerra, and tindra.

1. Start from a porcelain-clean code checkout and a clean, correctly attached
   state worktree. Dirty source or destination state is a pre-mutation failure,
   not something the migrator cleans up.
2. Run `pan admin state migrate <project> --dry-run` first. Inspect the manifest
   and resolve every reported safety gate before the real invocation. The
   migration is intentionally resumable; interruption checks may stop several
   attempts as repository state changes.
3. Do not push interim migration-fix commits to `main` while a real migration
   attempt is between cleanup and its final marker commit. That creates a
   transient remote state where `main` is clean but no authoritative marker
   exists, so every reader correctly remains in legacy mode with no legacy
   paths to read. Finish or safely resume the migration before publishing code
   changes that expose that window.
4. The ancestry guard introduced by `fa07e26a4e` rejects any code branch whose
   history contains the orphan root of `overdeck-state`; path cleanliness alone
   is insufficient because merging that ancestry would join the state and code
   histories.
5. Marker validation uses the semantics fixed by `2fde45421e`: the
   `stateBranchSha` recorded in `migration-complete.json` must be an ancestor of
   (or equal to) the current `origin/overdeck-state` tip. It must not be required
   to equal the tip's immediate parent, because ordinary post-cutover state
   commits advance the branch without invalidating migration.
6. After cutover, rebuild the Beads database in the state worktree with
   `bd init --prefix <project-prefix>` followed by `bd import`. This remains a
   manual post-migration step until PAN-2551 automates it. Verify `bd` resolves
   against `${OVERDECK_HOME}/state/<project>/.beads/`, not the code checkout.
7. Confirm the remote marker, validate its recorded ancestry, verify `main`
   carries zero state paths, and run Doctor. Only then treat the project as
   migrated; a branch without a valid marker remains migration-in-progress and
   all readers continue to resolve legacy state.
8. Protect the new branch on the remote: block deletion and force pushes of
   `overdeck-state` (GitHub: a repository ruleset targeting the branch, as this
   repository has; GitLab: a protected-branch entry). Deleting the state branch
   destroys the canonical state plane, and no code branch can restore it.
