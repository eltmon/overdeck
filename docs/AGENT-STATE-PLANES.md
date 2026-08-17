# Agent State Planes

Overdeck separates durable facts, host runtime state, and liveness so no cache
or workspace can silently become canonical.

## Permanent plane — `overdeck-state`

Durable portable state is committed through domain writers to the orphan
`overdeck-state` branch in a dedicated worktree at
`${OVERDECK_HOME}/state/<projectKey>`:

- `specs/` — canonical xBRIEF content. Work and task operations change only lifecycle status; explicit re-planning may replace the document at its stable filename through the spec writer.
- `drafts/` — PRD narrative.
- `records/` and `continues/` — per-issue decisions, hazards, progress,
  verdicts, ownership, and close-out.
- `review/`, `test/`, and `feedback/` — durable specialist artifacts.
- `backlog/` and `notes/` — sequencing and preserved operator notes.
- `specs/` plus each issue record's `tasks` block — the canonical checklist and its
  runtime claim/completion state, read and written through the task state doors.

The per-issue record under `records/` is also the permanent home for swarm
durable state: `swarm.hold`, `swarm.interventions`,
`swarm.completionObservations`, `swarm.slotCompletions`, `swarm.finalizedAt`,
`swarm.failedMergeBlocks`, `swarm.slotAssignments`, `swarm.supersededAttempts`,
and `swarm.reclaimedItems` all live there rather than in a
sidecar runtime file. The workspace record door resolves the record through the
canonical, migration-aware paths — one record, read through the per-domain
resolver and written through the single record writer — so a slot's durable
completion is never silently lost to a stale workspace-local copy.

Record writes hold the per-issue fs lock across the state-worktree commit and
push, bounded by `OVERDECK_RECORD_DURABILITY_BUDGET_MS` (default 30s,
PAN-2989): on expiry the writer rejects with `RecordDurabilityTimeoutError`
and releases the lock, keeps the mutation in the local record (no
restore-on-timeout — the raced flush may still land), and never aborts the
shared-gitRoot flush of peer writers. A verdict write that cannot take the
lock in time falls back to `<workspace>/.overdeck/pipeline-verdict.json`;
`drainWorkspaceVerdictFallback()` folds that fallback into the canonical
record (newer-wins on ISO `updatedAt`) and deletes it, triggered after every
landed journal write for the issue and on unref'd 5s/30s/120s retries after a
fallback write.

Remote-ref races on record pushes follow the merge-based conflict and escalation
policy in [State-Plane Commit Policy](STATE-PLANE-COMMIT-POLICY.md#write-policy):
record mirrors reconcile automatically, non-record conflicts abort, three
consecutive failures produce an operator-facing error, and `pan doctor` reports
state-branch divergence.

During a push-race reconciliation, `reconcileStatePush()` checks the state worktree before every reconcile attempt. If every dirty path is under one of the canonical `STATE_BRANCH_PATHS` directories, it adopts those writer-owned changes in a `chore(state): adopt orphaned write before state reconcile (PAN-3296)` commit, emits a `[record-update] adopted orphaned state write(s)` warning that lists the paths, and then merges. A dirty path outside the canonical state plane fails closed with an error naming the unowned path, so reconciliation never stages operator or unrelated state. Merge conflicts outside `records/` still abort and surface; adoption never chooses a side for conflicting drafts, specs, or other canonical state.

PAN-3092 hardened that path against verdict loss, because `pipeline.updatedAt`
is stamped on every status write and so cannot by itself distinguish
write-recency from verdict-truth:

- **The record write door's pipeline merge is verdict-aware.**
  `mergePipelineVerdictAware()` (`src/lib/pan-dir/pipeline-verdict-merge.ts`,
  behind `pickNewerPipeline`) keeps newer-wins for every non-verdict field but
  never lets a verdict-free write from the same review cycle displace a terminal
  verdict. Only a strictly newer `reviewSpawnedAt` (a new cycle) or a newer
  terminal verdict supersedes one.
- **The drain's supersede check is content-aware.** A fallback is deleted as
  superseded only when `pipelineCoversFallbackVerdicts()` confirms the journal
  carries the same terminal value for every gate the fallback holds one for, or
  belongs to a newer cycle. A newer-but-verdict-free journal no longer consumes
  an unlanded verdict. When the two hold *different* terminal values for one
  gate, `findFallbackVerdictConflicts()` sees it: nothing can order two written
  verdicts from a whole-pipeline timestamp that bookkeeping restamps, so the
  drain withholds the fold, keeps the fallback, and lets the sweep put the
  conflict in front of an operator. That state is permanent by design — every
  later drain withholds the same fold — so the sweep reports it under its own
  `verdict-fallback-conflict` recovery path, naming every conflicting gate and
  both written values and saying plainly that it will not clear on its own. The
  `verdict-fallback-contention` path is reserved for an actual write failure,
  which does clear when the lock frees.

  The conflict message deliberately does **not** hand out a `pan admin
  specialists done` command. That command is not a general resolver: `merge`
  takes `passed|failed` and maps them to `merged|failed`, `inspect` requires an
  `--item` a pipeline-level conflict cannot identify, `review` does not accept
  `skipped`, verification has no specialist, re-signalling the value already in
  the journal writes no replacement fallback (so the conflict survives), and a
  conflict can span several gates at once. A strictly newer review cycle is the
  only instruction correct for every gate, so that is what the operator is told.
  A resolve-this-generation operation through the verdict write door — accepting
  the exact fallback generation plus per-gate choices and consuming only that
  generation — would let an operator adopt a specific written verdict; it does
  not exist yet and is tracked as follow-up work.
- **Every merge-gating verdict is projected durably.** `uatStatus`/`uatNotes`
  join the pipeline block, `projectPipeline()`, and `durableSubset()` — UAT
  gates merge eligibility, so a contended UAT verdict that the fallback silently
  dropped would leave that gate stale.
- **Terminal verdict writes back off in-process.** A write introducing a NEW
  terminal verdict retries `updateIssueRecordForIssue` on
  `OVERDECK_VERDICT_BACKOFF_DELAYS_MS` (default 2s/5s/10s/20s/40s/80s) before
  any fallback is written; `pan admin specialists done` awaits it through
  `flushReviewStatusJournalWrites()` and then prints a do-not-re-run notice if a
  fallback remains. Bookkeeping writes stay single-shot.
- **A deacon patrol owns the long tail.** `sweepStrandedVerdictFallbacks()`
  (`src/lib/cloister/deacon-verdict-fallback-sweep.ts`) drains every pending
  fallback each patrol cycle — the retry a short-lived CLI's unref'd timers can
  never provide — and opens exactly one needs-you per contention episode once a
  fallback stays undrained past 10 minutes, naming the current lock owner. The
  activity warning is emitted before, and independently of, the recovery-trip
  write: that write goes through the very lock whose contention is being
  reported, so it is best-effort and retried on later patrols. Once the trip is
  durably open the sweep skips the write entirely — an open trip's mutator
  returns the record unchanged but the write door still takes the lock, and a
  retained conflict is permanent, so that would be a no-op record write every
  patrol forever on the lock under repair.

  The warning goes through `emitActivityEntryOnce()`, keyed by recovery path +
  issue + fallback generation, which delegates to the event store's
  `appendOnce(event, idempotencyKey)`. That claims the key in `event_idempotency`
  (PRIMARY KEY) and inserts the event in ONE transaction, publishes to
  subscribers only when it actually appended, and returns `appended | duplicate`
  after the transaction settles — or throws. Two properties matter and neither is
  available any other way:

  - **A reused payload id is not enough.** The `activity.entry` reducer replaces
    the projected row, but the event is still appended, re-published to every
    connected client, and re-dated to the front of the feed — a second warning.
  - **Neither `append` path can report durability.** The Deacon runs as a child
    process (`startDeaconChild()` → `deacon.js`), so its provider is the HTTP
    `createDeaconEventClient()`, whose `appendAsync` resolves on local enqueue
    before any request; and the in-process store resolves a failed batch with
    sequence `0` rather than rejecting. Both would report success for an event
    that never persisted. The client therefore gets its own `appendOnce()` that
    POSTs `/api/internal/events/append-once` and awaits the server's settled
    outcome instead of queueing — under a 10s `AbortSignal` deadline
    (`appendOnceTimeoutMs`) covering both the response headers and the body
    read. The patrol awaits this inline, so an accepted-but-hanging connection
    would otherwise stall every later issue and every later patrol phase while
    the patrol heartbeat kept reporting the Deacon healthy. Timing out after a
    server commit is safe: retrying the same key returns `duplicate`. The sweep
    additionally bounds warning delivery for the whole sweep, because a
    per-request deadline alone still multiplies by the number of stranded
    fallbacks. The sweep runs in three phases: drain everything and collect
    candidates, fan every candidate's warning out **concurrently under one shared
    deadline**, then write the durable trips. Concurrency is what keeps it fair —
    spending a shared budget in issue order let the first hanging episode consume
    all of it every patrol, and iteration order is stable, so later episodes were
    silently dropped forever without ever attempting their warning. Each request
    is idempotent by episode key, so fanning out cannot duplicate a warning, and
    an attempt abandoned at the deadline is retried next patrol. The budget is
    derived from the resolved `patrolIntervalMs` (half of it) rather than
    assuming 60s. Trips come last so a slow record-lock write can never delay the
    operator-visible warning.

  The claim table lives in `overdeck.db` — created by
  `drizzle/overdeck/0000_overdeck_init.sql` on a fresh database and by an
  idempotent top-up in `ensureRuntimeIndexesSync()` for existing ones, since the
  init migration short-circuits once `agents` exists.

  Idempotency keys age out with the events they guard — `compact()` deletes
  claims past the same 7-day retention, so the table cannot grow forever and an
  orphaned key cannot permanently suppress a warning whose event is gone.

  The sweep marks an episode warned only on `appended`/`duplicate`. `failed`
  wrote nothing, and `unconfirmed` — returned when a wired store exposes no
  `appendOnce` at all (narrow test doubles, early-boot stubs) — means delivery is
  unknown; neither is evidence the operator was told, so both leave the episode
  eligible for the next patrol. The in-process set is an optimisation, never the
  dedupe of record.
- **A frozen test agent escalates.** A live, idle test session that was already
  nudged and wrote no `.pan/test/result.json` now yields `escalate` from
  `decideUnsignaledTestAction()` instead of being ignored forever; the deacon
  opens one needs-you per test dispatch generation. Nothing fabricates a verdict.

Lock-owner attribution is truthful: the spawned dashboard
server never inherits `OVERDECK_AGENT_ID`/`OVERDECK_ISSUE_ID`/
`OVERDECK_SESSION_TYPE` (the spawner's identity is preserved as
`OVERDECK_DASHBOARD_SPAWNED_BY` for the PAN-2322 port guard), so server-side
record writes are attributed `process-<pid>@<hostname>`.

`migration-complete.json` at the remote branch tip proves cutover. `pan sync`,
dashboard coordinator startup, and work startup reconcile every registered
project automatically before pipeline writes are allowed. The migrator carries
tracked and untracked legacy `.pan/` payloads forward, then removes them from
`main` with an ordinary commit. Afterward, legacy paths are fallback reads only
and their recreation trips Doctor/Deacon diagnostics.

### Path authority

All canonical `specs/` and `drafts/` directory derivation goes through
`getProjectPanPaths(projectRoot)` in `src/lib/pan-dir/paths.ts`. It resolves the
`overdeck-state` worktree for migrated projects and `<projectRoot>/.pan/` only
for unmigrated projects. PAN-3165 and PAN-3230 both came from callers deriving
these paths independently, so `scripts/lint-state-paths.sh` blocks new direct
legacy spec or draft directory joins outside the audited migration and path-door
modules.

For polyrepo projects, `pan_records.repo` designates the infra/state-host
sub-repository. `resolveInfraRepo()` places `overdeck-state` on that repository,
not on the project root; migration can still read legacy `.pan/` from a non-Git
project root during cutover.

## Code-owned context and workspace runtime

Project context is reviewed with code on `main` at
`<projectRoot>/.overdeck/context/`; `.pan/context/` remains a read fallback.
Workspace-local runtime files use `<workspace>/.overdeck/` and are gitignored.
Task reads resolve the xBRIEF plus issue-record task state through the canonical
read door; agents mutate that state only through `pan task …`.

## Runtime plane — local SQLite

`~/.overdeck/overdeck.db` contains machine-local projections: agents, review
status, lifecycle events, conversations, and — since PAN-1990 — the
`projects`/`workspaces`/`project_targets`/`pinned_docs` tables (one row per
registered project and per git worktree Overdeck knows about; see
`docs/WORKSPACES-AND-PROJECTS.md`). It is a disposable cache rebuilt from Git
state, JSONL transcripts, tracker data, and tmux through the canonical domain
resolvers — for the workspaces/projects domain, that's
`src/lib/workspaces/resolver.ts` (read) and `src/lib/workspaces/writer.ts`
(write), the same two-doors shape every other table in this plane follows.

`pan admin db rebuild-workspaces` reconstructs the `projects`/`workspaces`
tables the same way `pan admin db rebuild-agents` reconstructs `agents`:
re-seeding from `projects.yaml`, backfilling `issue`-kind rows from existing
`feature-*` worktrees, recreating `main`/`scratch` rows from their memory-home
identity mirrors, and migrating pre-PAN-1990 issue-keyed memory homes onto
their workspace UUID.

### Bounded review-status history (PAN-3253)

The `review.status_changed` event payload embeds a **bounded** `status.history` array (≤20 entries, ≤500-char notes per entry) for replay.
Uncapped history arrays caused database bloat (one machine's event store was 80% review events).
All four enforcement points apply identical bounds to prevent silent drift:

- **Composition limit** (20 entries, 500-char notes): `review-status.ts` truncates notes when transitions are recorded
- **Hydration limit** (20 entries, 500-char notes): `src/lib/overdeck/review-status-sync.ts` (canonical owner) truncates notes when loading from `status_history` table via SQL bounds
- **Persistence limit** (20 entries, 500-char notes): `event-store.ts` bounds payloads in `append()`, `appendAsync()`, `appendOnce()` before persistence
- **Boot-time migration** (20 entries, 500-char notes): `event-store.ts` trims historical oversized rows with `trimReviewStatusHistoryPayloads()`

The canonical limits live in `src/lib/review-status-limits.ts` to ensure all enforcement points use identical values.
The raw `status_history` table intentionally retains the full unbounded record for archival; only in-memory objects and event payloads are bounded.

### Agent spawn provenance

Agent state records two complementary provenance fields:

- `flywheelRunId` is the active `RUN-…` identity when a Flywheel run owns the spawn. Spawn options and the inherited Flywheel environment feed it into `state.json` and the agents-table `flywheel_run_id` column.
- `startedBy` identifies the immediate launch path. Stable values include operator CLI/dashboard starts, `flywheel:<runId>`, planning auto-handoff, orphan reconciliation, reactive lifecycle dispatch, Deacon resume/crash recovery, handoff, and merge strike. It persists in `state.json` and the agents-table `started_by` column.

Browser dashboard requests receive server-derived `operator:dashboard` provenance; request bodies cannot impersonate autonomous origins. Internal-token callers may select only registered internal origins such as `planning-auto-handoff`, `orphan-proposed-reconciler`, and `operator:cli:pan-start`. Detached `pan start` children receive the validated token through `OVERDECK_AGENT_STARTED_BY`; direct CLI invocation defaults to `operator:cli:pan-start`. Planning routes apply the same boundary and persist the validated token on planning-agent state. Fresh launch option types require `startedBy`, so a new production spawn path that omits provenance fails typecheck.

### Agents-table event invariant

The agents table is the authoritative runtime registry, but event-derived
projections consume the event log independently. Every agents-table status
transition, including boot backfill reconciliation, must persist a matching
`agent.status_changed` or `agent.stopped` event during the same boot; otherwise
stale events can produce phantom running agents (PAN-3183). The agents-table
rule in `scripts/lint-state-writes.sh` enforces the boundary around
`src/lib/overdeck/{agents,agent-state-sync,agent-record-sync,reconstruction}.ts`,
`src/lib/database/{agents-db,agent-backfill,schema}.ts`, and
`src/dashboard/server/services/agent-projection.ts`. During bootstrap/seed, a
table row that is stopped with no live tmux session overrides a newer
running/starting event projection; a live tmux session still wins.

### Stopped but session-alive (PAN-3338)

`status` in the agents table is the durable record — written at finalize or
stop, never inferred from process liveness. `hasLiveTmuxSession` is the
liveness signal, sourced from the tmux oracle below. The read model must agree
with the durable record; the single resolver for whether a stopped-but-alive
agent gets rewritten back to `running` is `shouldResurrectStoppedAgent()` in
`src/dashboard/server/services/agent-enrichment-service.ts`.

Interactive roles — `plan` agents and `conv-*` conversation sessions — are
exempt. For them, sitting stopped with a live tmux session is the deliberate
post-completion steady state: a planning session that finalized with
`skipKill` stays alive so the operator can inspect it, and a conversation sits
idle at a live prompt between turns. `shouldResurrectStoppedAgent()` never
rewrites these back to `running`; the shared predicate is
`isInteractiveRoleAgent()` in `src/lib/agent-enrichment.ts`. Every other role
(work, review, test, ship) keeps the PAN-1419 crash-recovery reconcile
unchanged: a stopped-but-tmux-alive agent there is a transitional state
following a crash or restart, and the poller rewrites it to `running`.

## Liveness oracle — tmux

A session on the `overdeck` tmux socket is the physical liveness authority.
Lifecycle events project status, while the Deacon keeps a thin patrol as a
dropped-event safety net. A global Deacon pause gates every patrol and recovery
path.

Codex app-server sessions keep the same liveness oracle. The tmux pane hosts
Overdeck's Codex app-server host process, which owns the `codex app-server`
child over stdio and renders a readable event feed into the pane. Deacon still
patrols the tmux session; it does not treat the Codex child process as a
separate liveness source.

### Transcript retention

Agent-state cleanup goes through `removeAgentStateDir()` in
`src/lib/agents/state-dir-removal.ts`. The door deletes runtime residue but
preserves every nested `*.jsonl` transcript in place; the lint guard rejects
new direct agent-directory removals outside that door.

Transcripts are retained forever by default. A positive
`retention.transcript_days` enables the dedicated Deacon sweep, which deletes
only JSONL files older than the configured age from ended agent state dirs and
never touches a live tmux session. Terminal agent GC removes runtime residue
through the same door but retains the registry row while any JSONL remains; the
row preserves the agent-to-issue link needed to read the durable closed-out
verdict on a later sweep. The row's `phase` becomes `retained-transcripts`, and
a matching `.retained-transcripts` marker prevents generic GC from resolving
or walking that transcript-only tree. Disk-only cleanup reconstructs this
minimal tombstone from `state.json` before removing runtime residue, or fails
closed when no identity can be recovered. The explicit expiry sweep
removes the marker, directory, and row after the final JSONL reaches its cutoff.
When the setting is absent,
the sweep is not called and does not traverse the filesystem.

`conv-*` directories remain excluded from automatic agent-state cleanup because
they are the canonical transcript home for Codex and Pi conversations. The
explicit transcript sweep may enter one only when the conversation read door
reports it ended or archived and no live tmux session exists.

## Transcript-verified resumability (PAN-3194)

A stored Claude session ID is resumable only when its JSONL transcript exists at
`sessionFilePath(workspace, sessionId)`. Every resume probe uses
`claudeSessionTranscriptExists()` from `src/lib/paths.ts` for this check.

The check applies at three surfaces:

- `pan start` uses `work-agent-lifecycle.ts` before refusing a fresh start.
- `/api/agents/:id/has-session` and the stopped-agent listing expose the result
  through `canResumeSession` and `buildStoppedAgentLifecycle()`.
- Deacon auto-resume reaches `resumeAgent()`, whose spawn plan decides between
  the saved session and a fresh launch.

When the transcript is missing, the probes report the session as non-resumable
and route the agent to a fresh launch. Read paths never clear session pointers;
`resumeAgent()` owns that recovery mutation through
`clearAgentSessionPointers()` before it starts the replacement session.

## Resume classifier and intent policy

`getAgentResumeGateBlockReason()` is the only classifier for `paused`, `troubled`,
`stoppedByUser`, and failure backoff. `decideResumeGate(block, intent)` is the
only policy function; autonomous recovery additionally passes through
`decideAutonomousRedrive()`, which reads the cached memory verdict.

| Gate | autonomous | operator-start | message-delivery |
|---|---|---|---|
| paused / scheduler-yielded | defer; explicit `pan unpause` required | block; start does not unpause | delivery allowed without resuming |
| troubled | block; needs-you | block; explicit `pan untroubled` required | delivery allowed |
| stopped-by-user, no completed handoff | block; one durable needs-you trip | clear the flag and start | delivery allowed |
| stopped-by-user, completed handoff owing rework | clear the historical flag and re-drive | clear and start | delivery allowed |
| failure backoff | defer | override with a logged warning | delivery allowed |

### Who may set `stoppedByUser` (PAN-3324)

The `stopped-by-user` gate exists to stop autonomous machinery from overriding a
deliberate human stop, so only a human stop may arm it. `stopAgent()`,
`stopAgentSync()`, and `markAgentStoppedState()` each take an `AgentStopCause`:

- `'operator'` sets `stoppedByUser`. Passed by `pan kill`, `pan pause`, the
  dashboard stop/delete and pause routes, and `pan flywheel stop|pause|abort`
  (plus their dashboard equivalents). Nothing else passes it.
- `'system'` — the default — clears `stoppedByUser`. Every machinery-initiated
  stop uses it: memory-governor shedding, the concurrency-ceiling brake,
  scheduler preemption, health force-kills, stalled-review-parent reaping,
  signature-corruption recovery, close-out, and reconciling a process the OOM
  killer already took.

The default is `'system'` on purpose: a caller that omits the cause produces a
recoverable stop, never a permanent stall. Before this, an OOM-killed review
agent was recorded as `stopped_by_user = 1`, which latched the gate and left the
issue waiting on a human — the failure that motivated the split.

Durable breaker identity is `{ issue, recoveryPath, obligationGeneration,
tripCount }`. Restart cannot duplicate an open trip; acknowledgement or a
successful explicit recovery resets it, and a later obligation generation may
trip independently.

## Migration and recovery

Automatic reconciliation uses a cross-process lock, stable source SHA,
source/destination mode-size-hash manifest, workspace redirect rewrite,
completion marker, and atomic push of `main` plus `overdeck-state`. Operators
can still run `pan admin state migrate <project> --dry-run` to preview a blocked
cutover. Recovery never deletes a remote state branch or rewrites history.
