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
