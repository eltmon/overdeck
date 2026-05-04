# PAN-440: Agent Enrichment Missing from Effect Server

## Status: Planning Complete

## Problem

The Effect server migration (PAN-428) dropped agent enrichment fields that the frontend depends on. The old Express `/api/agents` endpoint computed `agentPhase`, `hasPendingQuestion`, `pendingQuestionCount`, `resolution`, and `resolutionCount` by scanning JSONL session files and runtime.json. The new RPC snapshot only returns basic `AgentSnapshot` fields.

**Broken UI features:** INPUT badge, Watch Planning button, Done/Stuck/Blocked badges, planning input toast.

## Decisions

1. **Approach: Background poller + domain events** — A new `AgentEnrichmentService` polls agent state every ~3s, diffs against last known enrichment, and emits `agent.enrichment_changed` domain events. This matches the Effect event-driven pattern (T3Code style).

2. **Add `'planning'` to `AgentPhase` enum** — The frontend checks `agentPhase === 'planning'` but the contracts enum doesn't include it. Adding it is the clean fix.

3. **Extend `AgentSnapshot` in contracts** — Add the 5 missing fields directly to the schema so they flow through the existing RPC snapshot pipeline without frontend changes.

4. **Scope: Enrichment only** — Terminal scroll history (item 5 in issue) is excluded as a separate concern.

## Architecture

### Data Flow

```
AgentEnrichmentService (3s poll)
  ├─ For each running agent:
  │   ├─ Read runtime.json → resolution, resolutionCount
  │   ├─ Scan JSONL → hasPendingQuestion, pendingQuestionCount
  │   └─ Infer agentPhase from agent id prefix + state.phase
  ├─ Diff against last known enrichment per agent
  └─ If changed → eventStore.append({ type: 'agent.enrichment_changed', ... })
         │
         ▼
  Event reducer (shared contracts)
  ├─ Merges enrichment fields into agentsById[agentId]
  └─ Both server read model + frontend Zustand store apply same reducer
         │
         ▼
  Frontend renders badges, buttons, toasts (no changes needed)
```

### Bootstrap

During `ReadModelServiceLive` bootstrap, compute enrichment inline for each agent (same logic as poller) so the initial snapshot is already enriched. This prevents a 3s gap where badges are missing after page load.

### Key Design Choices

- **Poller interval: 3 seconds** — Matches the existing issue polling cadence. JSONL scanning is I/O but files are local and typically small (<1MB). Runtime.json is a single small file per agent.
- **Diff before emit** — Only emit events when enrichment actually changes, avoiding unnecessary re-renders.
- **Reuse existing JSONL scanning logic** — The `getPendingQuestions()` function in `src/dashboard/server/routes/agents.ts` already implements the algorithm. Extract it to a shared utility.
- **No specialist check** — The old code suppressed `hasPendingQuestion` when `hasActiveSpecialist` was true. This should be preserved — check if any specialist has `currentIssue` matching the agent's `issueId`.

## Files to Modify

### Contracts Package (`packages/contracts/src/`)
1. **`types.ts`** — Add `'planning'` to `AgentPhase` enum. Add `agentPhase`, `hasPendingQuestion`, `pendingQuestionCount`, `resolution`, `resolutionCount` to `AgentSnapshot`.
2. **`events.ts`** — Add `AgentEnrichmentChangedEvent` schema. Add to `DomainEvent` union.
3. **`event-reducers.ts`** — Add `agent.enrichment_changed` case to `applyEvent()` that merges enrichment fields into the agent entry.

### Server (`src/dashboard/server/`)
4. **New: `services/agent-enrichment-service.ts`** — Background poller. Imports `getPendingQuestions` (extracted), reads runtime.json, diffs, emits events. Exports `start()`/`stop()` lifecycle.
5. **`read-model.ts`** — During bootstrap, compute enrichment for each agent inline. Start the enrichment service after bootstrap.

### Shared Utility
6. **Extract `getPendingQuestions()` and `getAgentJsonlPath()`** from `src/dashboard/server/routes/agents.ts` into a shared module (e.g., `src/lib/agent-enrichment.ts`) so both the old REST endpoint and the new poller can use it.

### Frontend (verify only)
7. **No changes expected** — The frontend `Agent` type already has all 5 fields. The Zustand store applies shared reducers. Once events flow, badges should render. Verify by testing.

## Out of Scope

- Terminal scroll history after PTY reconnect (separate issue)
- Removing the old Express `/api/agents` enrichment (can be done later once Effect path is proven)
- Cost tracking enrichment (already handled by `cost.event_recorded` events)

## Risks

- **JSONL scanning performance** — If an agent's JSONL grows very large (>10MB), scanning every 3s could be slow. Mitigation: track file size + mtime, skip scan if unchanged. Could also read from end of file.
- **Race with agent stop** — Agent may stop between enrichment scan start and event emit. Mitigation: the reducer ignores enrichment events for agents not in `agentsById`.

## Specialist Feedback

- **[2026-04-04T18:43Z] verification-gate → FAILED** — `.planning/feedback/001-verification-gate-failed.md`
- **[2026-04-04T18:45Z] verification-gate → FAILED** — `.planning/feedback/002-verification-gate-failed.md`
- **[2026-04-04T19:02Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/004-review-agent-changes-requested.md`
