# Unified pending input in the dashboard

This documents PAN-1520's unified "agent awaiting input" subsystem: how an
operator-blocking surface becomes visible in the dashboard, which payloads are
actionable, and where to debug when an indicator, modal, notification, or
"Needs you" row is missing.

The original version of this doc covered only AskUserQuestion (AUQ). AUQ is now
one source in a broader pending-input system that also covers plan approval,
plan drafting, channel permission requests, session-resume waits, and known
interactive harness modals.

## TL;DR

- `pendingInputKinds` is the shared vocabulary for blocking surfaces:
  `askUserQuestion`, `permissionRequest`, `exitPlanMode`, `enterPlanMode`,
  `sessionResume`, and `rateLimit`.
- `pendingAskUserQuestion` is an actionable AUQ payload used by
  `AskUserQuestionDialog`. Do not treat it as the whole pending-input system.
- `pendingProposedPlan` is the actionable plan-approval payload for unresolved
  `ExitPlanMode` plans. It carries `toolUseId`, `plan`, optional
  `planFilePath`, and `createdAt`.
- Agent rows get pending input from enrichment events and the channel-permission
  stream. Conversation rows use the lightweight
  `GET /api/conversations/pending-input` feed.
- The feed intentionally scans only tmux-alive conversations. Do not replace it
  with full conversation-list enrichment or non-live transcript scans.
- The "Needs you" list and unified indicator must be kind-agnostic. They should
  recover dismissed AUQs, plan approvals, permission requests, and pane-detected
  waits.

## Vocabulary

`src/dashboard/frontend/src/lib/pendingInput.ts` owns UI labels for
pending-input kinds. Keep new labels there so AgentCard, ConversationRow,
notifications, and tooltips do not drift.

| Kind | Meaning | Primary source |
| --- | --- | --- |
| `askUserQuestion` | Agent asked the operator a structured question. | JSONL AUQ scan |
| `permissionRequest` | Runtime channel permission needs approval or denial. | channel-permission event stream |
| `exitPlanMode` | Agent proposed a plan and waits for approval/rejection. | JSONL `ExitPlanMode` / conversation parser |
| `enterPlanMode` | Agent is in plan mode and still drafting a plan. | JSONL `EnterPlanMode` tail scan |
| `sessionResume` | A live session is waiting for resume/continuation input. | runtime/pane detection |
| `rateLimit` | A known harness modal asks the operator to keep or switch model. | pane detection |

Use `isAwaitingInput(agent)` for compact UI indicators. Use
`selectPendingInputSubjects` for actionable "Needs you" rows because it merges
JSONL-derived agent kinds with channel permission requests at read time.

## Agent Flow

```
agent reaches a blocking surface
        |
        +-- JSONL-derived surface
        |     scanPendingInputsPromise(jsonl)
        |       - AskUserQuestion
        |       - EnterPlanMode
        |       - ExitPlanMode pending tool_result
        |
        +-- pane/runtime-derived surface
        |     detectAwaitingInputFromPaneSync(...)
        |       - rateLimit
        |       - sessionResume / runtime waiting-on-human
        |
        v
computeAgentEnrichment(agentId)
        |
        v
agent.enrichment_changed
        |
        v
read-model reducer writes:
        - hasPendingQuestion
        - pendingInputCount
        - pendingInputKinds
        - pendingAskUserQuestion, when present
        |
        v
frontend store selectors:
        - isAwaitingInput for indicators
        - selectPendingInputSubjects for Needs you
        - selectAgentsWithPendingAskUserQuestion for AUQ modal subjects
```

Channel permission requests are deliberately separate from enrichment. The
permission stream owns the request payloads, while `selectPendingInputSubjects`
adds `permissionRequest` to the subject kinds for any agent with outstanding
permission requests. Do not bake permission kinds into enrichment output; each
poll would overwrite that state.

## Conversation Flow

Conversations do not have agent enrichment events, and polling the full
conversation list just to find pending input was too expensive. PAN-1705 added:

```
GET /api/conversations/pending-input
```

The route is implemented through `getConversationsPendingInputFeed` in
`src/lib/overdeck/conversation-reads.ts`. Its contract:

- list conversations only as metadata candidates;
- intersect them with `listSessionNames()` and keep only tmux-alive sessions;
- resolve and scan JSONL only for those live sessions;
- return only rows that currently need input;
- do not call full-list enrichment or scan non-alive conversations.

Rows may carry:

```ts
{
  name: string;
  title: string | null;
  issueId: string | null;
  pendingAskUserQuestion: PendingAskUserQuestionSnapshot | null;
  pendingProposedPlan: PendingProposedPlan | null;
}
```

`pendingProposedPlan` is derived from the conversation parser's `ProposedPlan`
only while `status === 'pending'`. A matching `tool_result` for the
`ExitPlanMode` tool use removes it from the feed on the next poll.

## AskUserQuestion Details

AUQ is special because a native AUQ renders its choice menu in the agent's TUI
but does not append the `tool_use` to JSONL until it is answered. Without PAN-1520
hook handling, the dashboard cannot detect it.

The PreToolUse hook at `sync-sources/hooks/ask-user-question-hook` denies AUQ and
writes a tool_result containing the literal `PAN-1520`. The scanner treats that
marker as "still pending" because the upstream tool was denied only to make the
question visible. The operator's next plain-text user turn, whether typed in the
terminal, sent from the conversation composer, or delivered by the dashboard
answer route, clears the denied-awaiting-user state.

If you reword the hook reason, keep the `PAN-1520` marker or AUQ detection will
silently stop working.

### Historical AUQ Outage

Two bugs fixed on 2026-05-31 caused every AUQ popup to disappear:

1. `listRunningAgents()` checked tmux liveness against `getAgentSessions()`,
   which returned only `agent-*` sessions. Planning, conversation, and strike
   sessions were never scanned. The fix was to compare against the unfiltered
   tmux session list.
2. The enrichment poller `await`ed Effect values instead of running them with
   `Effect.runPromise(...)`. The diagnostic was values like
   `{ _id: 'Effect', op: 'Async' }` where numbers or enrichment objects were
   expected.

Keep those failure modes in mind when all pending-input fields are suddenly
empty for every agent.

## Needs You Recovery

The "Needs you" section in `SessionFeedSidebar` is the recovery surface for any
actionable pending input, not just AUQ. It exists because dismissing a modal
should not strand the operator: a still-pending item must remain clickable until
the underlying wait clears server-side.

For AUQ, clicking a row calls
`useAskUserQuestionUiStore.requestReopen(subjectId)`, which un-dismisses and
focuses that subject so `AskUserQuestionDialog` opens again.

For non-AUQ kinds, the row should route the operator to the relevant live
surface: a plan approval dialog, a permission dialog, or the terminal/session
where a harness modal is visible. A row without a concrete kind is not
actionable and should not be shown.

## Notifications

`agent-enrichment-service.ts` tracks each agent's previous `pendingInputCount`.
On a rising edge from zero to non-zero, it emits one `activity.entry` and one
priority-1 `activity.tts` notification naming the pending kind(s). It should not
repeat notifications while the same wait remains pending.

This notification path is kind-agnostic. Adding a pending-input kind means the
rising-edge notification should work without a new bespoke notifier.

## Local Verification

### AUQ Modal

Inject a synthetic AUQ into the browser store. The dialog should open; ESC should
dismiss it; the "Needs you" row should remain; clicking the row should reopen it.

```js
const store = window.useDashboardStore
store.setState((p) => ({
  agentsById: {
    ...p.agentsById,
    'test-auq-agent': {
      id: 'test-auq-agent',
      issueId: 'ZZTESTAUQ',
      status: 'running',
      role: 'plan',
      pendingInputCount: 1,
      pendingInputKinds: ['askUserQuestion'],
      pendingAskUserQuestion: {
        toolUseId: 't1',
        askedAt: new Date().toISOString(),
        questions: [{
          question: 'verify?',
          header: 'Q',
          multiSelect: false,
          options: [{ label: 'Yes' }, { label: 'No' }],
        }],
      },
    },
  },
}))
```

Match `button[title="Re-open this question"]` specifically in Playwright; a loose
text match can hit an issue card instead.

### Conversation Plan Feed

For `GET /api/conversations/pending-input`, use a tmux-alive conversation JSONL
with an unresolved `ExitPlanMode` tool_use. The response should include
`pendingProposedPlan.toolUseId` and `pendingProposedPlan.plan`. After a matching
`tool_result` appears, the next response should omit `pendingProposedPlan`.

The regression test for that contract is
`tests/unit/lib/overdeck/conversations-pending-input-feed.test.ts`.

## Debugging Checklist

- If every agent lacks pending input, verify the enrichment poller is running
  Effects with `Effect.runPromise(...)`.
- If planning or conversation waits do not surface, verify tmux liveness uses the
  unfiltered live-session list.
- If AUQ never appears, verify the hook deny still includes `PAN-1520` and that
  `scanPendingInputsPromise` sees the JSONL tail.
- If channel permissions light one surface but not another, check
  `selectPendingInputSubjects`; permission requests live outside enrichment.
- If conversation waits are missing, check
  `GET /api/conversations/pending-input` before the full conversation list.
- If a "Needs you" row says nothing is waiting when clicked, the row likely came
  from a fuzzy `hasPendingQuestion` without a concrete kind. Require actionable
  `pendingInputKinds`.
- Dashboard server changes require build/restart of `node dist/dashboard/server.js`.
  Frontend-only changes hot-reload under Vite.
