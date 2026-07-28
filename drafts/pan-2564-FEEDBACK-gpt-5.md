# PAN-2564 PRD feedback — GPT-5

**Reviewed:** `drafts/pan-2564.md` on `overdeck-state`, authored 2026-07-12  
**Verdict:** **Changes requested — foundational decisions remain unresolved, and the current plan cannot mechanically satisfy its central write-door guarantee.**

The PRD is unusually strong in organization: it starts with a glossary, carries numbered requirements through work items and acceptance criteria, preserves the original migration safety gate, names concrete files, includes before/after code for one representative read, restates relevant repository rules, and makes the Machine A→B→C outcome mechanically testable. The strategic direction—Dolt canonical, `refs/dolt/data` as transport, JSONL derived—is correct.

The blockers below must be resolved in the document before an implementation agent receives it. They are design issues, not implementation details the executor should invent.

## Blocking findings

### 1. The proposed write door does not cover the writes that matter most

**Affected:** D4, FR-3, WI-3, AC-3, Machine A→B→C requirement.

Work agents currently mutate beads by invoking raw CLI commands from their sessions. The shipped work prompt explicitly tells them:

```text
bd update <bead-id> --status in_progress
bd close <bead-id>
```

See `/home/eltmon/Projects/overdeck/src/lib/cloister/prompts/work.md` (search for `bd update <bead-id>`) and the verification retry instruction in `/home/eltmon/Projects/overdeck/src/lib/cloister/verification-runner.ts` (search for `Close every completed bead`). Bundled beads skills also teach direct `bd` mutation.

Refactoring TypeScript mutation sites into `src/lib/beads/writer.ts` does not intercept a shell command run by an agent. Machine B could still close five beads directly in its local Dolt database, bypassing pull/commit/push and leaving Machine C stale—the exact failure this issue exists to eliminate.

The PRD must choose and specify a mechanically enforced mutation surface. For example:

1. Add `pan beads claim|update|close|create|dep|delete` commands backed by the writer.
2. Change all prompts, skills, hooks, lifecycle code, and operator docs to use those commands.
3. Prevent supervised work agents from performing raw mutating `bd` commands. Specify the enforcement mechanism, not merely a rule: e.g. a scoped `bd` wrapper/PATH shim that permits read verbs but rejects mutation verbs and directs the agent to `pan beads …`, while the writer invokes the real binary by resolved absolute path; or an equivalent capability boundary.
4. Add a CI/no-loss audit enumerating every supported mutating bead action and proving each has a home in the new surface.
5. Test that raw `bd close` from a work-agent environment is rejected and that the supported wrapper performs pull→mutation→commit→push.

Without this, D4 is aspirational rather than structural.

### 2. The canonical local database location is undefined, and the repository is already split

**Affected:** D1, D4, FR-2–FR-4, WI-2–WI-4, WI-9.

The PRD repeatedly says “the local Dolt database” but never decides its physical home. Today there can be distinct databases under:

- `<project>/.beads/embeddeddolt/`;
- `${OVERDECK_HOME}/state/<project>/.beads/embeddeddolt/`; and
- a workspace-local `.beads/` unless `.beads/redirect` is correct.

On this machine, the main Overdeck checkout and its `overdeck-state` worktree already contain separate Dolt layouts. A resolver rooted by `cwd` can therefore read a different database depending on whether it runs from main, the state worktree, or a workspace.

Add an explicit decision and implementation map:

- Name the one physical local Dolt home per project.
- Define how main, every worktree, `overdeck-state`, remote workspaces, dashboard routes, CLI commands, and spawned agents resolve to it.
- Define the redirect files that must exist and which directories must never initialize their own DB.
- Add startup/doctor checks that detect multiple populated databases and block instead of choosing silently.
- Add a test with main + state worktree + feature worktree proving all three resolve the same database identity/head.

This decision must precede resolver/writer work; otherwise the new doors can faithfully synchronize the wrong local store.

### 3. C1 is a prerequisite architecture decision, not a late implementation checkpoint

**Affected:** D6, FR-3, NFR-1, WI-3, WI-12, AC-12.

The PRD does not yet know whether `bd dolt pull` safely merges divergent writes. Its fallback—“keep the single-writer invariant so cross-machine writes … are serialized through one host”—contradicts the stated Machine A/B flow, in which multiple machines are allowed to write. It also names no coordinator, lease, fencing token, availability behavior, or routing mechanism that could enforce a cross-machine single writer.

Run the scratch-repository experiment before finalizing the PRD and record the observed `bd 1.0.4` behavior. Then choose one complete model:

- **Distributed writers:** define pull/merge/push retry semantics, row conflicts, dependency/comment conflicts, retry bounds, and what remains locally durable after a rejected push.
- **Single writer service:** define the authoritative host/service, request protocol, fencing/leadership, offline behavior, and how Machine B sends mutations to it.

Do not leave this choice to the implementation agent. “Surface divergence” is safe but does not satisfy the requirement that routine A→B→C progress works.

### 4. The migration refusal gate can never become passable as written

**Affected:** FR-1, WI-1, WI-12, AC-1.

WI-1 refuses migration whenever `.beads/embeddeddolt/` or another Dolt marker exists. Under beads 1.0.4, every initialized project has such a marker. The error says to run the PAN-2564 cutover first, but after cutover the marker still exists, so migration will continue to refuse forever.

Specify the state machine:

- Before Dolt cutover: refuse and mutate nothing.
- After a reviewed reconciliation and a durable remote has been established: migrate only the allowed derived/config files, explicitly excluding the DB/runtime directories.
- Record a verifiable cutover marker containing at least the remote URL, remote Dolt head, local reconciled head, reconciliation report path/hash, and completion time.
- Make the gate validate that marker and the remote ref rather than infer safety from directory shape alone.

Add tests for both pre-cutover refusal and post-cutover successful state migration with zero Dolt bytes staged.

### 5. The reconciliation method is not full-fidelity and does not explain how to inspect the remote safely

**Affected:** D7, FR-7, WI-7, AC-7.

`bd export --all` is still an export representation, not a Dolt database snapshot. The PRD requires preservation of all fields, comments, dependencies, record types, and canonical state, but does not define the tables/schema being audited or how Dolt history/working-set state is accounted for. It also says “fetch + export” for `refs/dolt/data` without specifying a scratch clone; fetching/pulling into the live local DB would violate the requirement that reconciliation mutates no source.

Revise WI-7 to:

- Take the safety exports/snapshots before any cutover action, as required by the repo rule.
- Clone `refs/dolt/data` into an isolated temporary database, never pull it into the live database during audit.
- Inventory the exact Dolt tables and columns used by beads 1.0.4 and Overdeck.
- Compare normalized issue rows plus labels, dependencies, comments, configuration/non-issue records, and relevant Dolt heads/history metadata.
- Distinguish “missing because export scope excludes this record type” from actual absence.
- Verify snapshot row counts and sample resolution before handing off the cutover.
- Define the review/approval artifact that unlocks the cutover marker.

The measured 3,291-vs-3,214 comparison should be described as evidence of divergence requiring audit, not as proof that JSONL is “lossy relative to Dolt”; part of the difference may be the `--all` record universe versus an older/default issue-only export.

### 6. D8 invents an operator directive and makes completion impossible for the implementation agent

**Affected:** D8, WI-12, AC-12.

“Everything ships in one delivery (operator directive)” is not supported by the issue or the conversation that created it. The user asked to update PAN-2564 and then requested a PRD review; no directive required one indivisible delivery.

WI-12 says operational cutover is executed by the orchestrating conversation, not the agent, while AC-12 requires all projects—including krux and lexerra—to be cut over before the issue can pass. That leaves the executor unable to satisfy its own acceptance criteria and couples a risky multi-project data migration to a very large code change.

Remove D8. Define staged, independently gated delivery inside the same strategic issue or as child issues:

1. safety gate + reconciliation tooling;
2. canonical local home + read/write doors + enforcement;
3. sync/freshness and multi-clone proof;
4. per-project operator-reviewed cutovers.

Code completion must not falsely imply operational cutover. Each project cutover should have a separately recorded review gate and rollback/recovery procedure.

### 7. The Fly fallback violates normative requirements

**Affected:** D3, D4, FR-2, FR-4, NFR-2, WI-4, AC-2.

C2 falls back to a JSONL-seeded Fly database. That conflicts with:

- FR-2: all live production reads use the synchronized canonical Dolt resolver;
- D3: JSONL is not a live read source; and
- FR-4: a new machine hydrates from `refs/dolt/data`.

“Read-only/stale-marked” does not make a JSONL-seeded production agent canonical, and a work agent cannot be read-only if it must claim/close beads.

Choose one of these explicit outcomes:

- Provision authenticated Dolt-remote access before allowing remote work; or
- Mechanically block remote work for migrated projects until remote mutation routing exists.

The second matches the current PAN-2541 remote-work guard and is safer than keeping a parallel legacy authority. Do not include a fallback that violates the normative requirements.

### 8. Mutation batching and atomicity are unspecified

**Affected:** FR-3, WI-3, `createBeadsFromVBrief`.

“Pull→mutate→commit→push after every mutation” is not sufficient for multi-command operations. Planning creates several beads and then adds dependencies; repair paths may delete partially-created beads. Pulling/pushing each low-level command exposes incomplete plans remotely and multiplies contention.

Define the writer API as a transaction/unit-of-work boundary, not merely a command wrapper. For example:

```ts
writer.runMutationBatch({ project, reason }, async (bd) => {
  // create all beads, add dependencies, validate result
})
```

The batch acquires the project lock once, pulls once, performs/validates all operations, commits once, exports once, and pushes once. Single-bead claim/close can use a one-operation batch. Specify failure cleanup and whether partially-mutated Dolt working sets are committed, reverted, or blocked for operator recovery.

### 9. The export verification algorithm compares mismatched record universes and cites uncertain commands

**Affected:** FR-6, WI-6, AC-6.

The installed `bd export` defaults to regular issues and requires `--all` to include infrastructure/templates/gates/memories. `bd list` and `bd count` have their own filters. “Verify line count + ID set against `bd count`/`bd list --json`” will produce false mismatches unless every command uses one explicitly defined record universe.

Also, `bd context --json` reports backend/config identity but is not documented as the Dolt HEAD source; the PRD offers `bd vc log`, but the installed `bd vc` help exposes commit/merge/status and no `log` subcommand. Verify the exact supported command or SQL query for local and remote Dolt hashes and write it into the PRD.

Define:

- whether the recovery JSONL is issue-only or `--all`;
- the exact commands/flags used for export and verification;
- normalization for ordering and non-semantic/generated fields;
- how a genuinely empty new project is distinguished from corruption without a vague “sentinel says so.”

### 10. The read/write inventory is incomplete and needs a mechanical no-loss audit

**Affected:** §5, WI-2, WI-3, AC-2.

The repository currently contains over 100 TypeScript/TSX references to `issues.jsonl`, plus direct `bd` calls in source, generated prompts, bundled skills, extensions, remote flows, and tests. Section 5 is a useful sample but not an exhaustive classified inventory. It also identifies `GodView/BeadsKanban.tsx`, whereas the screenshot-driving issue rail is `src/dashboard/frontend/src/components/Stage/cockpit/BeadsRail.tsx`, backed by `/api/issues/:id/beads` in `src/lib/overdeck/issue-reads.ts`.

Add an appendix/table enumerating every production read, mutation, export/import, presence check, cache invalidation, prompt/skill instruction, remote path, and UI consumer, with its destination under the new design. Back it with a focused CI guard that rejects:

- direct production JSONL reads outside an explicit recovery/diagnostic allowlist;
- direct mutating `bd` invocations outside the writer and its real-binary adapter; and
- new `issues.jsonl` presence checks used as beads-existence truth.

This is the required no-loss audit for an existing surface.

## Important non-blocking corrections

### 11. Correct or source the auto-export statement

The glossary claims a verbatim default auto-export after every write, throttled to 60 seconds, and names `export.auto`. Current beads configuration documentation emphasizes Dolt-native backup and does not list `export.auto` among supported settings. The installed `bd export` help describes explicit export for migration/interoperability. Verify this statement against the exact pinned `bd 1.0.4` binary/source and either cite its location or remove it.

### 12. Specify background-sync ownership and lifecycle

WI-5 says “per active project” but does not define which process owns the loop, startup/shutdown behavior, throttle interval, jitter, lock timeout, backoff, or how multiple dashboard instances avoid redundant pulls. Define one owner and use fake timers in all interval/backoff tests. A local pull must run under the same project lock as reads/writes.

### 13. Do not promise frontend query invalidation from a server process without a transport

The server cannot directly invalidate a browser's TanStack Query cache. Specify the actual mechanism: WebSocket/domain event received by the frontend and handled with `queryClient.invalidateQueries(['beads', issueId])`, or rely on the existing 10-second refetch after the local DB advances. Name the event schema and consumer.

### 14. Make version support a range/policy, not a second drifting literal

Before adding `src/lib/beads/version.ts`, find the existing installation/version checks and define one resolver. A new constant plus package/install scripts risks two pins. State whether the policy is exact `1.0.4`, a minimum compatible version, or a tested range, and test all consumers against the one source.

### 15. Add performance budgets

The design adds pull/head checks, locks, export validation, and pushes to high-frequency paths. Define budgets for:

- local resolver latency;
- dashboard poll latency;
- background head-check/pull frequency;
- per-bead close durability; and
- batch plan finalization.

The repository already documents severe bd lock starvation. The PRD must ensure freshness does not recreate that failure with network operations inside a globally contended lock.

## Required revision summary

Before approval, revise the PRD to:

1. Choose and mechanically enforce the agent-facing mutation door.
2. Choose the one physical local Dolt home and specify every redirect/resolver.
3. Resolve divergent-writer semantics before implementation; remove the undefined single-writer fallback.
4. Make the migration gate passable after a verified cutover marker.
5. Make reconciliation isolated and full-fidelity.
6. Remove the unsupported one-delivery directive and separate code delivery from operator-reviewed project cutovers.
7. Block remote work rather than fall back to live JSONL authority.
8. Define mutation batches and failure atomicity.
9. Verify exact bd commands and consistent export record scope.
10. Add the exhaustive, mechanically enforced no-loss audit.

After those changes, the remaining work items and acceptance criteria provide a solid implementation skeleton.
