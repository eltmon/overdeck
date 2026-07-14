# Agent State Planes

Overdeck separates durable facts, host runtime state, and liveness so no cache
or workspace can silently become canonical.

## Permanent plane — `overdeck-state`

Durable portable state is committed through domain writers to the orphan
`overdeck-state` branch in a dedicated worktree at
`${OVERDECK_HOME}/state/<projectKey>`:

- `specs/` — immutable vBRIEF content; only lifecycle status changes.
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
Task reads resolve the vBRIEF plus issue-record task state through the canonical
read door; agents mutate that state only through `pan task …`.

## Runtime plane — local SQLite

`~/.overdeck/overdeck.db` contains machine-local projections: agents, review
status, lifecycle events, and conversations. It is a disposable cache rebuilt
from Git state, JSONL transcripts, tracker data, and tmux through the canonical
domain resolvers.

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
