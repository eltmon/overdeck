# Overdeck — Architecture Map

Overdeck is a multi-agent orchestrator for AI coding work: a CLI (`pan`), a
dashboard (Effect.js HTTP server + React frontend), and a supervisor daemon
(the Deacon/Cloister) that drives issues through plan → work → review → test →
merge.

## Top-level layout

- `src/cli/` — `pan` CLI commands (thin; delegates to `src/lib/`).
- `src/lib/` — shared domain logic: agents, planning, cloister (deacon patrols,
  verification gates, merge lifecycle), vbrief, tmux, channels, pan-dir.
- `src/dashboard/server/` — Effect HTTP server. `main.ts` (entry, dual-runtime),
  `server.ts` (routes + layers), `routes/*.ts` (12 route modules),
  `services/*.ts` (read model, event store, enrichment, resource discovery),
  `read-model.ts` (in-memory snapshot).
- `src/dashboard/frontend/` — React + Zustand + React Query. Issue cockpit under
  `src/components/Stage/cockpit/` (IssueMissionControl, AgentsLane,
  HappenedFeed, StatusNarrative); Command Deck under `src/components/CommandDeck/`.
- `packages/contracts/` — shared types (SessionNode etc.) + store reducers.
- `sync-sources/` — bundled rules, hooks (e.g. `ask-user-question-hook`), skills
  distributed to harness context via `pan sync`.
- `roles/` — role instruction files (plan.md, work.md, review.md, test.md).

## State planes (PAN-1908 / PAN-2541)

1. **Permanent** — git orphan branch `overdeck-state`, checked out at
   `${OVERDECK_HOME}/state/<project>/`: `records/`, `specs/`, `continues/`,
   `drafts/` (`.beads/` is dead — beads removed, PAN-2648).
2. **Runtime** — SQLite `~/.overdeck/overdeck.db` (`agents` table is the
   authoritative runtime registry; `state.json` per agent dir is a
   rebuild source). `getAgentStateSync` returns the DB row.
3. **Liveness** — tmux on socket `-L overdeck` (sessions: `agent-<issue>`,
   `planning-<issue>`, `strike-<issue>`, `agent-<issue>-plan` via spawnRun,
   `conv-*`).

Single-source-of-truth tenet: one resolver (read door) and one writer
(write door) per domain; no direct store access outside them.

## Issue-view data flow (cockpit)

- Sessions: `GET /api/session-trees` (`routes/projects.ts`,
  `collectSessionTreeNodes`) is primary; `GET /api/command-deck/activity/:id`
  (`routes/command-deck.ts`) is the fallback; both scan
  `~/.overdeck/agents/<candidate>/` state via `getAgentStateSync` plus tmux
  presence.
- Feature identity: `GET /api/issues/resource-allocated`
  (`services/resource-discovery.ts`).
- Pending input (AUQ): PreToolUse deny hook writes a marked tool_result into
  the session JSONL; `scanPendingInputsPromise` (`src/lib/agent-enrichment.ts`)
  detects it; enrichment service polls; read-model → frontend modal
  (`usePendingInputDialogs`) and needs-you (`pipeline-helpers.ts`).

## Pipeline

`pan start` is the paved road (auto-plans if needed). Planning writes workspace
`.overdeck/spec.vbrief.json`; `pan plan finalize` promotes the spec to
`specs/` on `overdeck-state` and transitions the issue. Work agents claim and
complete vBRIEF items via `pan task` (beads removed, PAN-2648); verification
gate runs quality gates; review convoy +
test role; server-side rebase/readyForMerge; human or flywheel merges;
`postMergeLifecycle` → close-out owns teardown.

<!-- last-verified: 2026-08-01 -->
