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
durable state: `slotCompletions`, `finalizedAt`, `failedMergeBlock`,
`slotAssignments`, and `supersededAttempts` all live there rather than in a
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
  has settled every gate the fallback holds a terminal verdict for, or belongs
  to a newer cycle. A newer-but-verdict-free journal no longer consumes an
  unlanded verdict.
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
  fallback stays undrained past 10 minutes, naming the current lock owner.
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
status, lifecycle events, and conversations. It is a disposable cache rebuilt
from Git state, JSONL transcripts, tracker data, and tmux through the canonical
domain resolvers.

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
