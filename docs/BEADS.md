# Beads authority and synchronization

Beads is a separate state domain from `overdeck-state`. Its canonical durable
history is Dolt at `refs/dolt/data` on the project's git remote. The
`overdeck-state` branch stores the derived `.beads/issues.jsonl` recovery export,
reconciliation reports, and the cutover marker; it never stores Dolt database
directories or runtime files.

Supported `bd` releases follow a minimum-compatible-version policy, currently
`bd >= 1.1.0`; this is not an exact version pin. The migration-fork guard and
cascade-repair pull behavior are required by the canonical Dolt design.

## Local topology

`bd` normally runs in embedded mode: an in-process Dolt engine stores its local
working copy under `.beads/embeddeddolt/`. Overdeck gives each project exactly
one physical local home at `${OVERDECK_HOME}/state/<project>/.beads/`. Main,
feature worktrees, and workspaces contain `.beads/redirect` files pointing to
that home. Server mode (`dolt sql-server`, `.beads/dolt/`) is not used.

Redirects are always one hop: `bd` refuses redirect chains and falls back to the
redirect target's own directory, so a redirect must never point at another
redirecting directory. Worktree creation writes the canonical home path directly
into `.beads/redirect`; post-Dolt-cutover the project root `.beads/` is itself a
redirect, and pointing a worktree at it would create a chain. During close-out,
the `teardown:sync-beads` step validates and refreshes the recovery export from
that canonical home, not from inside the workspace.

All reads use the beads resolver. All writes use `runMutationBatch`, exposed to
agents as `pan beads …`. A mutation batch acquires the project lock, bootstraps,
pulls, applies all operations in Dolt batch mode, commits once, validates one
`--all` JSONL recovery export, and pushes once. A rejected push is a typed
conflict; Overdeck never force-pushes Dolt history.

## Machine A → B → C

1. Machine A creates beads with `pan beads create`; the writer publishes the
   resulting Dolt commit to `refs/dolt/data`.
2. Machine B runs `pan sync` or the resolver. `bd bootstrap` hydrates the
   canonical local home, then the writer pulls before B closes work.
3. The dashboard on Machine C runs the single-owner background pull service.
   When its local head advances, `/ws/rpc` emits `beads.freshness_changed`; the
   Beads rail invalidates its query and displays the last sync time. A pull or
   schema failure produces an explicit stale badge instead of fabricated zero.

The 10-second rail poll is a local read only. It never performs a network pull.

## Cutover and reconciliation

Run `pan admin beads reconcile <project>` before enabling a project. It first
takes a validated local safety export, clones `refs/dolt/data` into an isolated
temporary database, and compares local Dolt, remote Dolt, and derived JSONL. It
does not import, push, delete, or select a winner. Review and approve the report
before writing `beads-cutover.json`.

For the schema transition, unify the local home first. On exactly one designated
migrator run `BD_ALLOW_REMOTE_MIGRATE=1 bd migrate`, then publish the reviewed
result with `bd dolt push`. Other machines adopt the remote schema with
`bd bootstrap`; they never migrate independent clones. This operational step is
operator-run and is not part of application installation or tests.

### Scratch multi-clone proof

`tests/integration/beads-cross-machine.test.ts` creates a temporary bare git
remote and three disposable clones. It proves A→B bootstrap, five B→C closures,
push rejection for a divergent writer, and convergence after `bd dolt pull`.
The test never points at a registered project or the production state home.

## Derived export

`.beads/issues.jsonl` is recovery/interoperability output, not a read or write
authority. The exporter uses `bd export --all`, verifies count and ID equality
against `bd list --all --json`, records the `bd vc status` commit in
`export-state.json`, and refuses empty-over-nonempty replacement. Line union is
forbidden.

## Access-surface audit

The exhaustive production read/write/export/prompt inventory is maintained by
WI-15 below and enforced by `scripts/lint-beads-access.sh`. New live reads belong
in `src/lib/beads/resolver.ts`; new mutations belong in
`src/lib/beads/writer.ts` and the `pan beads` agent surface.

### No-loss inventory

| Old surface class | Exhaustive production sites audited | Destination / retained reason |
| --- | --- | --- |
| Issue reads and counts | `src/lib/beads-query.ts`; `src/cli/commands/start.ts`; `src/lib/work/done-preflight.ts`; `src/lib/cloister/orphan-proposed-reconciler.ts`; `src/lib/cloister/triggers.ts`; `src/lib/backlog/backlog-input.ts`; `src/lib/backlog/lookups.ts`; `src/dashboard/server/routes/backlog.ts`; `src/lib/cloister/flywheel.ts`; `src/lib/vbrief/beads.ts`; `src/dashboard/server/routes/workspaces/merge-ops.ts` | `BeadsResolver` over canonical-home `bd --json`; failures are stale/unknown, never zero-from-JSONL. |
| Existence and allocation checks | `src/dashboard/server/services/resource-discovery.ts`; backlog trio; flywheel; start 422 gate | `issueHasBeads` / `getBeadsForIssue`; an export file or redirect is not evidence that an issue has beads. |
| Mutations | `src/lib/vbrief/beads.ts`; `src/cli/commands/start.ts`; `src/cli/commands/workspace-beads.ts`; `src/cli/commands/beads.ts`; `src/lib/lifecycle/compact-beads.ts`; work/verification prompts | `runMutationBatch` and `BdMutationClient`; agent-facing verbs are `pan beads claim/update/close/create/dep/delete`. |
| Agent enforcement | `src/lib/agents/spawn.ts`; `src/lib/beads/bd-shim.ts`; `src/lib/cloister/prompts/work.md`; `src/lib/cloister/verification-runner.ts`; bundled beads skill entrypoints | Work-agent PATH rejects raw mutation verbs; reads pass to the real binary and mutations use `pan beads`. |
| Export and state commits | `src/lib/beads/export.ts`; `src/lib/pan-dir/auto-commit.ts`; `src/lib/lifecycle/teardown-workspace.ts` | Validated derived `--all` export only; auto-commit transports the export and metadata, never Dolt runtime bytes. |
| Recovery and diagnostics allowlist | `src/lib/beads/reconcile.ts`; `src/cli/commands/doctor.ts`; `src/lib/beads/export.ts`; `src/lib/pan-dir/auto-commit.ts` | May inspect the derived export to reconcile, validate, diagnose, or commit it; never serves a live application read. |
| Remote legacy compatibility | `src/lib/remote-workspace.ts`; `src/lib/remote/fly-provider.ts` | Reachable only for unmigrated projects. Migrated projects fail before JSONL transfer because authenticated `refs/dolt/data` routing is not yet available on Fly. |
| Synchronization and cache invalidation | `src/dashboard/server/services/beads-sync-service.ts`; `src/dashboard/server/services/beads-freshness-bus.ts`; `src/dashboard/server/ws/rpc/beads-freshness.ts`; `src/lib/cloister/triggers.ts` | Background pull head changes publish freshness events; trigger reads single-flight through the resolver rather than JSONL mtime. |
| Dashboard/UI consumers | issue beads API; `BeadsRail.tsx`; `BeadsKanban.tsx`; resource discovery; PR-body merge operations | API returns Dolt-backed records plus freshness/stale metadata; UI invalidates on the freshness event and keeps the safety poll. |
| Configuration/bootstrap/version | `src/lib/beads/home.ts`; `src/lib/beads/bootstrap.ts`; `src/lib/beads/config-standardize.ts`; `src/lib/beads/version.ts`; workspace init/sync/doctor/install | One physical home, idempotent remote/bootstrap, `dolt.auto-push=false`, and the single `bd >= 1.1.0` policy. |

The CI allowlist is intentionally identical to the recovery/diagnostic and
legacy-unmigrated rows above. `npm run lint:beads-access` plants no behavioral
exceptions for application reads or agent mutations.

## Terminal-issue bead sweep

A terminal issue — one that is merged or closed on the tracker — must never carry
open beads. Overdeck enforces this invariant in two places:

- **Merge time:** `postMergeLifecycle` sweeps any remaining `open` or
  `in_progress` beads with the reason `issue merged; remaining open beads swept`.
- **Close-out time:** `closeOut` sweeps orphaned beads before workspace teardown.

The sweep reasons are categorical. A reason ending in `...orphaned bead swept`
denotes work that was overtaken by the issue's terminal transition; a reason
ending in `...bead cancelled` denotes work that is no longer planned.

For backfills and ad-hoc cleanup, use `pan beads sweep`:

```bash
pan beads sweep --all-closed              # enumerate and sweep closed issues
pan beads sweep --all-closed --dry-run    # preview, do not mutate
pan beads sweep PAN-1234 PAN-1235         # sweep specific issues
pan beads sweep PAN-1234 --reason "custom reason"
```

`--all-closed` performs exactly one `getAllBeads()` read, groups beads by issue
label, checks tracker state through the same `gh issue view` door used by
`pan close`, and sweeps only GitHub-closed issues. GitHub-open issues with
orphaned beads are skipped and listed as `Open with orphaned beads` so they can
be routed back into the pipeline rather than silently closed.

The default close reason derives from the GitHub close state:

| Tracker close state | Default reason |
| --- | --- |
| completed | `issue closed (completed); orphaned bead swept` |
| not_planned | `issue closed (not planned); bead cancelled` |

## Verification gate open-beads check

Before a work agent can advance to review, the verification gate reads the
issue's open beads through the canonical resolver. If any open beads remain, or
if the resolver cannot answer within its timeout, verification fails with
`failedCheck: 'open-beads'`. The feedback names the open bead ids and instructs
the agent to close each one with `pan beads close <id> --reason <reason>` before
re-requesting review.

This check is intentionally placed **after** the vBRIEF acceptance-criteria gate
and **before** the empty-changeset guard. A timeout is treated as unknown, not
proof of zero open beads, so the gate fails closed per PAN-1812.

## Dashboard bead signals

The Command Deck surfaces beads as resource signals alongside branches, workspaces,
and sessions. The dashboard does not read beads directly from Dolt; it consumes
the same resolver through a background rollup service.

- **`beadTotals`** — `BeadsRollupService` computes a per-project snapshot of total,
  closed, and in-progress bead counts and caches it in memory. Resource discovery
  attaches the relevant row to each issue. `BeadsRail` and the issue resource strip
  display this as a `beads` icon plus counts.
- **`branchAheadOfMain`** — When a `feature/*` or `bypass/*` branch is not an
  ancestor of `main`, resource discovery sets `branchAheadOfMain: true`. This is
  one of the artifact signals used to decide whether an issue has unmerged work.
- **`conversation` resource source** — Non-archived conversations linked to an issue
  (`loadConversations`) are treated as a live resource signal independent of tmux
  or agent sessions. They keep an issue visible in the Command Deck even when no
  agent is running.
- **`stalled` bucket** — Pipeline grouping uses the artifact signals above (ahead
  branch, linked conversations, in-progress beads, or partially-closed beads) plus
  the absence of a live agent and 14 days of inactivity to place an issue in the
  `stalled` bucket. Stalled issues are shown after `needs-you` and are excluded
  from ordinary phase buckets.

The rollup service refreshes on a background interval and on `beads.freshness_changed`
events, so the Command Deck stays consistent with the canonical Dolt state without
issuing a resolver call per rendered issue.
