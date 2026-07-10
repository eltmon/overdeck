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
- `.beads/` — the shared beads database/export surface.

`migration-complete.json` at the remote branch tip proves cutover. Before that
marker exists, read doors use the legacy project `.pan/` and `.beads/` layout.
Afterward, legacy paths are fallback reads only and their recreation trips
Doctor/Deacon diagnostics.

## Code-owned context and workspace runtime

Project context is reviewed with code on `main` at
`<projectRoot>/.overdeck/context/`; `.pan/context/` remains a read fallback.
Workspace-local runtime files use `<workspace>/.overdeck/` and are gitignored.
Workspace beads resolve the permanent database through an actively maintained
`.beads/redirect`.

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

Run `pan admin state migrate <project> --dry-run` first. The real command uses
a cross-process lock, stable source SHA, source/destination mode-size-hash
manifest, workspace redirect rewrite, completion marker, and atomic push of
`main` plus `overdeck-state`. It never deletes a remote state branch as
automated recovery.
