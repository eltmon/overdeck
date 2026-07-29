# Workspaces and Projects (PAN-1990)

Overdeck manages multiple projects and, per project, multiple git worktrees —
the workspaces where planning, work, review, and scratch sessions actually
run. Before PAN-1990 this state was scattered across `projects.yaml`,
directory scraping, and issue-keyed memory paths, with no single table
answering "what workspaces exist for this project, and which one is this
conversation running in?" The `projects`/`workspaces`/`project_targets`/
`pinned_docs` tables are that single source of truth, reached through exactly
two doors.

## The two doors

Every read of these four tables goes through `src/lib/workspaces/resolver.ts`;
every write goes through `src/lib/workspaces/writer.ts`. No other module,
route, or script may touch them directly —
`scripts/guard-workspace-doors.sh` (wired into `npm run lint`) greps `src/**`
and `scripts/**` for a `FROM|INTO|UPDATE|DELETE FROM` immediately followed by
one of the four table names outside those two files (or their own tests) and
fails the build on a match. This is the same two-doors tenet
`docs/PIPELINE-MEMBERSHIP.md` and the project's single-source-of-truth rule
apply to every other domain: one canonical resolver, one canonical writer, no
parallel path.

Representative exports:

- **Reads** (`resolver.ts`): `getWorkspaceById`, `getWorkspaceByName`,
  `getWorkspaceForIssue`, `getMainWorkspace`, `listWorkspaces`,
  `getProjectByKey`, `getProjectByPath`, `listProjects`, `listProjectTargets`,
  `listPinnedDocs`, `resolveWorkspaceForCwd`.
- **Writes** (`writer.ts`): `upsertProjectFromConfig`, `addProjectTarget`,
  `createWorkspace`, `touchWorkspaceAccessed`, `updateWorkspaceLayout`,
  `setWorkspaceFavorite`, `archiveWorkspace`, `unarchiveWorkspace`,
  `deleteWorkspace`, `pinDoc`, `unpinDoc`.

## Tables

| Table | Row type | Purpose |
|---|---|---|
| `projects` | `ProjectRow` (`id`, `name`, `primaryPath`, `createdAt`, `lastAccessedAt`, `isSystem`) | One row per registered `projects.yaml` entry, keyed by its YAML key. |
| `workspaces` | `WorkspaceRow` (`id`, `projectId`, `kind`, `name`, `path`, `branchName`, `parentBranch`, `parentBranchGuessed`, `isGitRepository`, `issueId`, `layoutConfig`, `isFavorite`, `isArchived`, `title`, `createdAt`, `lastAccessedAt`) | One row per git worktree Overdeck knows about. |
| `project_targets` | `ProjectTargetRow` (`projectId`, `path`, `isPrimary`, `createdAt`, `lastUsedAt`) | Secondary target paths for a project (e.g. a mirror or secondary checkout) — exactly one `isPrimary` at a time. |
| `pinned_docs` | `PinnedDocRow` (`id`, `scope`, `scopeId`, `docPath`, `createdAt`) | Docs injected under the knowledge budget at prompt time, pinned at `project` or `workspace` scope. |

## Kinds and cardinalities

`WorkspaceRow.kind` is `'main' | 'issue' | 'scratch'`:

- **`main`** — the project's primary checkout. Exactly one per project;
  `createWorkspace()` enforces the singleton (throws if a `main` row already
  exists) and `archiveWorkspace()`/`deleteWorkspace()` both refuse
  `kind === 'main'`. Resolved or lazily created via `getMainWorkspace()` /
  `pan workspace main`.
- **`issue`** — one worktree per tracked issue, at most one non-archived row
  per `(projectId, issueId)` (`getWorkspaceForIssue()` queries
  `kind='issue' AND issue_id=? AND is_archived=0`). This is the workspace a
  planning/work/review agent runs in.
- **`scratch`** — any number per project, not tied to an issue. Created
  shared-directory by default (same worktree as `main`, no new branch) or
  `--isolated` for a dedicated git worktree (`pan workspace new`).

A pin (`pinned_docs`) is scoped independently: `scope='project'` pins survive
every workspace under that project; `scope='workspace'` pins are deleted when
their workspace is (`deleteWorkspace()` cascades workspace-scoped pins and
nulls `conversations.workspace_id` for that workspace, but never touches
project-scoped pins for the same project).

## Memory homes

Memory storage is keyed by **workspace UUID**, not issue id:
`~/.overdeck/memory/{projectId}/{workspaceId}/{observations,pending,status.json,summaries,archive}`.
A conversation with no spawned agent (a main/scratch workspace turn) still
gets a `MemoryIdentity` — `issueId` is `Schema.NullOr(IssueId)` and
`agentRole` includes the `'conversation'` literal (`MemoryAgentRole` in
`packages/contracts/src/memory.ts`) precisely so a non-issue turn has
somewhere to attribute its observations. `writeWorkspaceIdentity()` /
`readWorkspaceIdentity()` (`src/lib/memory/identity-record.ts`) mirror a
`metadata.json` recovery hint into each workspace's memory root on
create/archive — this is **not** canonical state (the `workspaces` row is),
only a rebuild aid; see `rebuildMainAndScratchWorkspaces()` below.

Durable memory artifacts (daily summaries, pin descriptors — never rolling
observations, `pending/`, or `status.json`) additionally mirror onto the
project's `overdeck-state` branch under a `memory/` domain
(`STATE_BRANCH_PATHS` in `src/lib/state-plane.ts`), through
`src/lib/memory/state-mirror.ts`'s `writeMemoryStateMirror`/
`removeMemoryStateMirror`, which reject any path under `observations/` or
`pending/`.

## Rebuild

`pan admin db rebuild-workspaces` (`src/cli/commands/db.ts`, handler
`rebuildWorkspacesCommand`) reconstructs the four tables from git truth, the
same "disposable cache, rebuilt from sources of truth" pattern
`docs/AGENT-STATE-PLANES.md` documents for `rebuild-agents`. In order:

1. `seedProjectsFromYaml()` — upserts every `projects.yaml` entry as a
   `projects` row.
2. `backfillIssueWorkspaces()` — scans each project's workspace directory for
   existing `feature-*` worktrees and creates a `kind='issue'` row for any
   that don't already have one.
3. `rebuildMainAndScratchWorkspaces()` — scans each project's memory home
   (`~/.overdeck/memory/{projectId}/{workspaceId}/metadata.json`, the
   identity mirror from `writer.createWorkspace`/`archiveWorkspace`) and
   recreates any missing `main`/`scratch` row, preserving the original id.
4. `migrateMemoryHomesToWorkspaces()` — moves legacy issue-keyed memory homes
   (`memory/{projectId}/{issueId}/`, from before PAN-1990) onto their
   workspace UUID and re-points `memory_fts.workspace_id` by issue id.

`--dry-run` only previews step 3 (the memory-home scan) — steps 1, 2, and 4
are idempotent upserts with no dry-run mode of their own. `--verbose` logs
each processed workspace.

## Wrapper-repo git posture (polyrepo projects)

For a `workspace.type: polyrepo` project (PAN-2948), the workspace *root* is a
one-commit wrapper repo whose `.gitignore` excludes the real code sub-repos
(e.g. `fe/`, `api/`) — no review-path git operation may run at that root
(`docs/REVIEW-AGENT-ARCHITECTURE.md`, "Polyrepo workspaces (PAN-2948)"). The
wrapper's HEAD never moves, so anything that snapshots it as a verdict anchor
reports "no drift" forever — this is exactly the MIN-901 incident (PAN-3254):
a deacon patrol compared a polyrepo composite `reviewedAtCommit` against a
bare wrapper-HEAD snapshot and cycled review→test 426 times in 19.5 hours
before the anchor-shape mismatch was caught (`git-utils.ts`'s
`snapshotWorkspaceHeadsPromise` doc comment; `project-repos.ts`'s
`degradedPolyrepo` field). The invariant this domain's `workspaces.path`
column must respect: **the wrapper repo's HEAD is workspace metadata (where
the worktree lives on disk), never a verdict anchor** — drift/reviewedAtCommit
comparisons belong to the composite sub-repo snapshot, not to the wrapper.
`WorkspaceRow.isGitRepository`/`branchName`/`parentBranch` describe the
workspace root as Overdeck sees it on disk; they are not, and must never be
promoted to, a review-verdict signal for a polyrepo project.

## No-loss discipline

This domain was built additively alongside the pre-existing PAN-428
issue/git-worktree lifecycle (`pan workspace create/migrate/ssh/…`,
`src/dashboard/server/routes/workspaces.ts` at `/api/workspaces/*`) — a
*different* "workspace" concept that already owned that name. The new REST
API lives at `/api/workspace-registry/*`
(`src/dashboard/server/routes/workspace-registry.ts`) specifically to avoid
colliding with it, and the new CLI subcommands (`new`, `main`, `get`,
`activate`, `archive`) sit alongside the older ones under the same
`pan workspace` command rather than replacing them. See
`docs/audits/pan-1990-surface-inventory.md` and
`tests/unit/dashboard/no-loss-audit.test.ts` for the mechanical gate that
locks every pre-PAN-1990 dashboard affordance in place.
