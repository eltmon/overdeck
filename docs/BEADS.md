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

You may include additional local `.beads` stores with a repeatable `--store
<name>=<path>` flag — for example, `--store frontend=/path/to/frontend --store
api=/path/to/api`. Each named store is read with `bd list --all --json` from the
given path and compared as an additional source. Reserved names (`local-dolt`,
`remote-dolt`, `state-jsonl`) are rejected.

If `refs/dolt/data` has not been published for the project, the remote Dolt
source is recorded as 0 records with a `refs/dolt/data not published` note
instead of failing the reconcile. This lets you audit local and extra stores
before the first push.

For the schema transition, unify the local home first. On exactly one designated
migrator run `BD_ALLOW_REMOTE_MIGRATE=1 bd migrate`, then publish the reviewed
result with `bd dolt push`. Other machines adopt the remote schema with
`bd bootstrap`; they never migrate independent clones. This operational step is
operator-run and is not part of application installation or tests.

### `updated_at` mass-reset (2026-07-12)

The v53 schema migration executed on 2026-07-12 rewrote every migrated bead's
`updated_at` field to the migration timestamp. Recency-based analysis on bead
`updated_at` — for example, signals that infer "active in pipeline" from the
most recent bead update — must treat values at or before 2026-07-12 as
migration noise, not as activity. The reconcile comparator's `metadata-drift`
classification exists for the same reason: a record whose only difference across
sources is `updated_at` is reported as metadata drift, not a real conflict. See
[PAN-2602](https://github.com/eltmon/overdeck/issues/2602) for the read-model
rollup work that consumes this caveat.

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
