# The unified pending-input subsystem (PAN-1520)

Every surface where an agent or conversation session blocks on the operator is
detected, indicated, notified, and answerable through **one** subsystem. This
supersedes the AUQ-only framing of
[ASKUSERQUESTION-DASHBOARD.md](ASKUSERQUESTION-DASHBOARD.md) (still the
debugging field guide for the AUQ pipeline specifically).

## The kinds

`pendingInputKinds` (on agents via enrichment, merged with permission requests
at read time) enumerates the active blocking surfaces. Labels live in one map:
`src/dashboard/frontend/src/lib/pendingInput.ts`.

| Kind | Detected from | Payload | Responder |
| --- | --- | --- | --- |
| `askUserQuestion` | JSONL tool_use + PAN-1520 deny-hook tool_result | `pendingAskUserQuestion` (questions/options) | `AskUserQuestionDialog` → `POST /api/agents/:id/answer-question` (agents) / conversation message (convs) |
| `exitPlanMode` | JSONL `ExitPlanMode` tool_use without tool_result | `pendingProposedPlan { toolUseId, askedAt, plan }` | `PlanApprovalDialog` → `POST /api/agents/:id/plan-action` (agents) / `POST /api/conversations/:name/plan-action` (convs) — native plan-menu keystrokes |
| `enterPlanMode` | JSONL `EnterPlanMode` without a subsequent `ExitPlanMode` | — (plan being drafted) | none — informational until `exitPlanMode` fires |
| `permissionRequest` | Channel permission event stream (server-side), merged at read time by `selectPendingInputSubjects` / `selectPendingPermissionAgentIds` | request details | `ChannelPermissionDialog` → permission response route |
| `sessionResume` | Pane pattern detection | — | terminal only |
| `rateLimit` | Pane pattern detection (PAN-1834) | — | auto-dismissed by the deacon modal handler; terminal otherwise |

## The surfaces

- **Indicator** — `AwaitingInputIndicator` (pulsing amber triangle), driven by
  `isAwaitingInput(agent, pendingPermissionAgentIds)`. The permission set comes
  from the shared `selectPendingPermissionAgentIds` selector — card surfaces
  (AgentCard, FleetAgentsView, DrawerActiveAgent, SessionPanel) must pass it,
  because permission requests live in a different store slice than the
  enrichment-owned snapshot fields.
- **Modals** — priority order: `ChannelPermissionDialog` >
  `AskUserQuestionDialog` > `PlanApprovalDialog` (`App.tsx`). Backdrop click and
  Minimize never resolve anything — the subject stays in "Needs you".
- **Needs you** — `NeedsYouSection` in the activity sidebars
  (`SessionFeedSidebar.tsx`), fed by `selectPendingInputSubjects`. Clicking an
  entry calls `requestReopen(subjectId)`; the reopen effect in
  `usePendingInputDialogs.ts` **routes by what is actually pending** — a
  plan-only subject opens the plan dialog, an AUQ subject the AUQ dialog
  (AUQ wins if both are pending).
- **Notification** — pending AUQs *and* pending plans fire the same toast +
  desktop notification; clicking re-opens the correct dialog via the same
  reopen routing.

## Invariants

- **NFR-1: nothing is ever auto-answered.** The AUQ deny hook prevents
  upstream option-#1 fabrication; the plan dialog only ever sends the
  operator's explicit keystroke choice.
- **FR-7: out-of-band resolution clears the UI.** Approving in the terminal
  writes the tool_result; the next enrichment poll / feed poll drops the
  payload and the reconcile effect prunes optimistic/dismissed marks.
- **Stale clicks can't inject keystrokes.** `POST /api/agents/:id/plan-action`
  409s unless the agent's JSONL still shows a pending `ExitPlanMode`.
- **PAN-2633: liveness-gated wipe.** Pending-input payloads survive agent
  status flaps while the agent's tmux session is alive. The
  `agent.status_changed` reducer wipes them only when a stop-shaped event does
  not assert `hasLiveTmuxSession: true` (origin PAN-1520). This prevents an
  idle-alive agent (registry status `stopped` but pane still live and showing
  an AskUserQuestion) from losing its needs-you entry and modal.
- **PAN-2633: ≤10s convergence.** If a stop-shaped status event ever wipes the
  read model's pending payload for a tmux-alive waiting agent, the enrichment
  poller re-emits it on the next poll (~10s), so the read model converges
  without a page refresh. The poller's `lastEnrichment` cache is intentionally
  not cleared, preserving the PAN-1834 awaiting-input rising edge as a
  single-shot activity entry + TTS notification.

## Data flow (plan approval)

```
ExitPlanMode tool_use (input.plan)
  → scanPendingInputsPromise → pendingProposedPlan          (src/lib/agent-enrichment.ts)
  → AgentEnrichment → agent.enrichment_changed event        (agent-enrichment-service.ts)
  → contracts reducer → agentsById[..].pendingProposedPlan  (event-reducers.ts)
  → selectAgentsWithPendingProposedPlan                     (frontend store)
  → usePendingInputDialogs → PlanApprovalDialog             (App.tsx)
  → POST /api/agents/:id/plan-action → keystroke '2'/'4'    (routes/agents/permissions.ts →
                                                             deliverPlanActionToSession)
Conversations take the same shape through GET /api/conversations/pending-input
(pendingProposedPlan on each row) and POST /api/conversations/:name/plan-action.
```
