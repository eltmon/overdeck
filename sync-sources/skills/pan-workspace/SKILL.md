---
name: pan-workspace
description: "pan workspace new/main/get/activate/archive/relocate — the PAN-1990 projects/workspaces domain: kinds, doors, memory homes"
triggers:
  - pan workspace new
  - pan workspace main
  - pan workspace relocate
  - scratch workspace
  - workspace kind
allowed-tools:
  - Bash
  - Read
---

# Pan Workspace (PAN-1990 domain)

`pan workspace` is overloaded — it also carries the older PAN-428 issue/git-worktree
lifecycle (`create`, `migrate`, `ssh`, `destroy`, …), which this skill does **not**
cover. This skill wraps only the newer projects/workspaces domain: every registered
project has exactly one `main` workspace plus any number of `issue` (one per tracked
issue) and `scratch` (ad-hoc, unattached to an issue) workspaces, all rows in the
`workspaces` table read through `src/lib/workspaces/resolver.ts` and written through
`src/lib/workspaces/writer.ts` — see `docs/WORKSPACES-AND-PROJECTS.md` for the full
model.

## Commands

```bash
pan workspace new <name> [--project <key>] [--isolated] [--parent-branch <branch>] [--target-path <dir>] [--dry-run]
pan workspace main [--project <key>]
pan workspace get <ws>
pan workspace activate <ws>
pan workspace archive <ws>
pan workspace relocate <ws> --path <dir> [--force]
pan workspace list [--kind <main|issue|scratch>] [--archived] [--json] [--all]
```

## Notes

- `new <name>` creates a **scratch** workspace. By default it shares the project's
  primary directory (same worktree, no new branch); pass `--isolated` to create a
  separate git worktree instead, with `--parent-branch` overriding the inferred
  parent (defaults to the project's current branch).
- `--target-path <dir>` points the scratch workspace at any existing directory
  instead of the project's primary path — this is how a workspace becomes a
  long-lived lens onto an arbitrary repo, independent of `--isolated`'s
  worktree-per-branch model. Mutually exclusive with `--isolated`; the path must
  already exist. `is_git_repository` is detected from `<dir>/.git`. If the
  resolved directory isn't the project's primary path or a path registered via
  `pan project add-target`, the command still creates the row but prints an
  informational note suggesting `pan project add-target`.
- `--dry-run` prints the resolved intent (`projectId`, `kind`, `name`, `path`,
  `branchName`, `parentBranch`, `parentBranchGuessed`, `isGitRepository`,
  `wouldCreateWorktree`) as JSON and returns before any worktree is created or
  workspace row is written — no DB row, no worktree, no memory home.
- `main [--project <key>]` resolves the project's singleton main workspace, creating
  it if it doesn't exist yet. There is exactly one `main` workspace per project —
  `archive` refuses to touch it.
- `--project <key>` on `new`/`main` defaults to the sole registered project, or the
  one resolved from the current working directory, when omitted.
- `get <ws>` prints the full row (id, kind, project, path, branch, issue, archived,
  favorite, lastAccess) plus `memoryHome` — the workspace's memory-home directory
  (`resolveWorkspaceMemoryRoot`), keyed by workspace id and stable across relocation.
- `activate <ws>` bumps `lastAccessedAt` (drives most-recent-first ordering in the
  Sidebar and Cmd-K switcher) and prints a hint to restore `layoutConfig` if the
  workspace has a saved dashboard pane arrangement.
- `archive <ws>` is reversible and refuses `kind=main`.
- `relocate <ws> --path <dir>` (Subspace `workspaces update --relocate` parity) points
  an existing workspace at a new path: updates the `path` column, re-detects
  `is_git_repository` from `<dir>/.git`, touches `lastAccessedAt`, and re-writes the
  memory-home `metadata.json` recovery hint — the memory home itself never moves,
  since it's keyed by workspace id, not path. `<ws>` accepts an id or a name
  (ambiguous names across projects error out asking for the id). Refuses
  `kind=issue` (pipeline-owned) and archived workspaces; `kind=main` requires
  `--force` since it diverges the row from projects.yaml's primary path.
- **The dashboard does the same thing through the same code (PAN-3330).** The
  New Workspace dialog (sidebar WORKSPACES `+`, the `New workspace…` palette
  action, or a project overview's button) and `new`/`main` both call
  `src/lib/workspaces/create.ts`, so a workspace created either way is
  identical. The dialog's live preview is a server-side dry run of that same
  resolution — the UI equivalent of `--dry-run`. `WorkspaceView`'s header
  offers Favorite/Relocate/Archive for `main` and `scratch`, matching
  `relocate`/`archive` and their refusals; destroying a workspace and purging
  memory stay CLI-only.
- `list --kind <kind>` reads through the resolver the same way the dashboard does;
  add `--archived` to include archived rows (only meaningful together with `--kind`).
