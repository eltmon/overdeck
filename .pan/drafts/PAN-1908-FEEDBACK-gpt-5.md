# Feedback on PAN-1908 from gpt-5

## Blocking feedback

1. Resolve the `channelsEnabled` contradiction before implementation.

   The main schema and routing sections say `channelsEnabled` is intentionally omitted from the `agents` table and only flagged for later removal (`PAN-1908.md:175`, `PAN-1908.md:198`). Appendix A says the opposite: it is still written and read, and should be migrated as a boolean until Channels is retired (`PAN-1908.md:413`, `PAN-1908.md:428`). Current code backs Appendix A: `deliverAgentMessage` reads `state.channelsEnabled` (`src/lib/agents.ts:1522`), the Channels decision comment says the caller mutates it (`src/lib/agents.ts:1976`), and spawn writes it before saving state (`src/lib/agents.ts:3727`).

   Pick one executable path:
   - keep `channels_enabled INTEGER` in `agents` and mark it deprecated, or
   - explicitly retire the Channels opt-in in WI-11 and list every code path to delete/update.

   As written, a lower-capability executor will likely omit the column while leaving live delivery code depending on it.

2. Resolve the `review_status` durable-vs-ephemeral split conflicts.

   Section 5.3 classifies `merge_step` and `inspect_bead_id` as durable git-record fields (`PAN-1908.md:204`), but Appendix A classifies both as ephemeral SQLite-only fields (`PAN-1908.md:440`). Section 5.3 also says working `*_notes` stay ephemeral (`PAN-1908.md:205`), while Appendix A puts `review_notes`, `test_notes`, `verification_notes`, `inspect_notes`, and `merge_notes` in the durable source-of-truth bucket (`PAN-1908.md:437`).

   This needs a single source-of-truth table with every column, destination, migration action, and deletion action. Otherwise WI-7 and WI-11 can implement mutually incompatible schemas while still claiming to follow the PRD.

3. Define the missing event contract for crash/orphan replacement.

   Section 6.1 says `recoverOrphanedAgents` should react to `agent.crashed` / session-end events (`PAN-1908.md:221`), but the current event contract has `agent.stopped` and `agent.heartbeat_dead`, not `agent.crashed` (`packages/contracts/src/events.ts:47`, `packages/contracts/src/events.ts:56`). Either add `agent.crashed` to `packages/contracts/src/events.ts` with payload shape, reducer handling, and emit sites, or change the PRD to use the existing event names consistently.

   This matters because the event-driven migration is the core of the PRD; ambiguous event names will leave the deacon replacement under-specified.

4. Specify the transactional boundary for event-driven `agents` projection.

   The PRD says the `agents` table is updated by lifecycle events (`PAN-1908.md:212`) and AC-3 only tests "emit event -> row reflects it" (`PAN-1908.md:297`). That is not enough for a big-bang registry cutover. The implementation needs to know whether lifecycle writes:
   - append the event and update `agents` in one SQLite transaction,
   - append events first and replay/project them synchronously,
   - or use events as notification only while the accessor write updates `agents`.

   Without that decision, a failed subscriber, async queue failure, or process crash between append and projection can make the new authoritative registry stale in exactly the way `state.json` is stale today. Add a WI-3 subtask and AC covering atomicity/replay/idempotency for `agent.started`, `agent.status_changed`, `agent.stopped`, and `agent.heartbeat_dead`.

5. Make the "no scanning" rule explicitly allow migration and recovery paths.

   Section 6 says no code path enumerates agent directories (`PAN-1908.md:212`), but Section 8 requires a one-time backfill from existing `state.json` files and tmux reconciliation (`PAN-1908.md:273`). That exception is reasonable, but it must be named as a migration-only path with guards so AC-2 does not fail itself.

   Suggested wording: production steady-state code must not scan agent dirs for enumeration/status; the only allowed directory enumeration is the versioned migration/backfill command, and tests must prove it is not called by dashboard/deacon hot paths.

## High-value tightening

1. Split WI-14 out of the storage-plane implementation or make it an explicit post-merge operator runbook.

   Closing and relabeling 17 tracker issues (`PAN-1908.md:260`) is operationally different from landing the storage migration. It also has external side effects and depends on the final PR URL. If this stays in the PRD, add an explicit "after merge only" gate and commands that are not run by implementation agents before the change is merged.

2. Add a concrete rollback plan for the big-bang cutover.

   The PRD intentionally rejects dual-write (`PAN-1908.md:271`), so it needs the compensating safety net: backup location, migration idempotency, how to rebuild `agents` from `state.json`/tmux/git records, and how to disable the new event-driven deacon if the dashboard wedges.

3. Narrow the close-out usage query.

   WI-8 says aggregate `cost_events` by `session_type, provider, model` (`PAN-1908.md:254`), but the close-out record is per issue. State the query must filter by `issue_id = ?`, and define behavior for rows with missing/wrong `session_type`.

4. Add payload requirements for the events that feed the `agents` table.

   `agent.stopped` currently carries only `agentId`, `issueId`, and optional `sessionId` (`packages/contracts/src/events.ts:52`), while the `agents` row contains many lifecycle and retry fields. WI-3 should list the exact payload fields per event, and the projection should define how partial events merge with existing rows.

5. Make CP-3 less open-ended if owner-URI is part of FR-5.

   The PRD requires owner-URI lease blocks in the permanent record, but CP-3 leaves reclaim timeout/heartbeat mostly undecided (`PAN-1908.md:312`). For single-machine correctness, at least specify owner format, claim precondition, stale-owner behavior, and what command/operator action transfers ownership.
