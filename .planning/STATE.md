# PAN-503 — Planning agent: ActivityView in detail pane, XTerminal in dialog

## Problem

The planning agent currently surfaces as a raw `XTerminal` (tmux attach) in
**both** places it appears in the dashboard:

1. **PlanDialog** (`components/PlanDialog.tsx` ~L900) — the modal launched from
   "Spawn Planning Agent". This is the *live-watch* context where raw terminal
   fidelity is appropriate.
2. **Workspace/agent detail pane** — currently rendered via `TerminalPanel`
   (`components/TerminalPanel.tsx` L135) inside `DetailPanelLayout`, and via
   `AgentOutputPanel` (`components/AgentOutputPanel.tsx` L130-142) in the
   Agents tab. These are *review* contexts where structured conversation is
   easier to skim.

`AgentOutputPanel` already wires work agents (`agent-<prefix>-<n>`) to
`ActivityView` via `deriveWorkAgentIssueId`. Planning agent ids
(`planning-<prefix>-<n>`) fall through that regex and either land on "No issue
associated with this session" (AgentOutputPanel) or render a raw XTerminal
(TerminalPanel).

## Data path already in place

- Backend: `GET /api/command-deck/activity/:issueId`
  (`routes/mission-control.ts` L108-205) already iterates
  `[planning-<issueLower>, agent-<issueLower>]` and emits a `planning` section
  when a planning agent state dir exists, synthesising one from `STATE.md` if
  the agent is down.
- Frontend: `ActivityView` (`components/MissionControl/ActivityView/`) already
  consumes that endpoint and renders `planning` sections alongside work
  sections. No backend or ActivityView changes needed.

The gap is purely in the two shell components that host planning agent output
in non-dialog contexts.

## Proposal

**Conditional by render site, not by user toggle** (per issue acceptance note):

1. **`TerminalPanel`** (workspace detail pane):
   - If `agent.agentPhase === 'planning'` (or `agent.id` starts with
     `planning-`) and an issueId is derivable, render
     `<ActivityView issueId={issueId} />` instead of
     `<XTerminal sessionName={agent.id} />`.
   - Keep the pop-out / close header. Drop the stopped-agent "Last output"
     fallback for planning agents — ActivityView already handles the
     down-agent case via the synthetic STATE.md section in the activity
     endpoint, and it's a better UX than raw tail.
   - Non-planning agents are unchanged.

2. **`AgentOutputPanel`** (Agents tab):
   - Extend `deriveWorkAgentIssueId` (or add a sibling `deriveAgentIssueId`)
     to also match `^planning-([a-z]+)-(\d+)$`. Rename accordingly so the
     function name no longer implies "work-only".
   - The existing Activity/Terminal toggle is retained for planning agents:
     Activity → `ActivityView`, Terminal → `XTerminal`. This is consistent
     with work agents and preserves power-user access to the raw tmux view
     without making it the default.

3. **`PlanDialog`** is untouched. It continues to render `XTerminal` for the
   live planning session.

4. **Tests**:
   - Extend `TerminalPanel` test (if present) with a planning-agent case
     asserting `ActivityView` renders and `XTerminal` does not. If no test
     file exists, add one alongside the sibling `InspectorPanel.test.tsx`
     conventions.
   - Add a planning-id case to `deriveAgentIssueId` coverage in
     `AgentOutputPanel` tests. `StandaloneTerminal.test.tsx` covers XTerminal
     directly and need not change.

## Non-goals

- No change to the planning agent's tmux session naming, state dir, or
  lifecycle.
- No change to `PlanDialog` behavior.
- No change to the `/api/command-deck/activity/:issueId` endpoint.
- No new user toggle or setting.

## Risks / edge cases

- **Planning agent with no issueId resolvable** — fall back to rendering the
  existing XTerminal rather than the "No issue associated" placeholder, so we
  never hide output entirely.
- **Selected-agent switching** — `AgentOutputPanel` already resets
  `viewMode` to `'activity'` on id change; planning agents inherit that.
- **Popout button** (`TerminalPanel` L103) opens a raw terminal window; it
  should be hidden when the panel is showing ActivityView since there is no
  terminal to pop out. Replace with a "no-op / hidden" branch for planning.

## Files touched

- `src/dashboard/frontend/src/components/TerminalPanel.tsx` — conditional
  ActivityView rendering for planning agents.
- `src/dashboard/frontend/src/components/AgentOutputPanel.tsx` — extend agent
  id → issueId derivation to cover `planning-` prefix.
- `src/dashboard/frontend/src/components/TerminalPanel.test.tsx` (new or
  extended) — planning-agent render assertion.
- Possibly `src/dashboard/frontend/src/components/__tests__/…` — tests for
  AgentOutputPanel derivation if present.

## Difficulty

Medium. Two components, narrow surface area, existing tests as templates.
Sonnet is appropriate.
