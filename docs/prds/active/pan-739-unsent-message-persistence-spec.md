# PAN-739: Unsent Message Persistence in Conversation History

## Problem Statement

Mission Control currently renders user prompts optimistically in the conversation view before the server confirms that the prompt was actually delivered to the Claude session. If delivery fails, the optimistic prompt disappears and the typed content is lost.

This is a real data-loss bug from the user's perspective. The user already expressed intent, saw the message appear in the conversation, and then loses both the message and the ability to recover it when the send fails.

The root problem is that the UI currently treats the Claude JSONL transcript as the only durable conversation history, while optimistic prompts exist only in ephemeral frontend state. When a prompt never reaches the JSONL, there is no durable local record of what the user tried to send.

Panopticon needs a first-class local-history layer for unsent and failed prompts so the conversation view can represent reality accurately:
- persisted remote history from the Claude session JSONL,
- plus local pending/failed user prompts that have not yet been accepted into that remote history.

## Requirements

### Must Have

- A user prompt that fails to send must remain visible in the conversation after the error.
- Failed prompts must preserve the full prompt text exactly as typed.
- Failed prompts must render with an explicit error state, not disappear silently.
- The UI must surface why the send failed when an error message is available.
- The system must support local conversation history that can diverge temporarily from the Claude session JSONL.
- Local-only unsent/failed prompt state must survive normal UI refresh/re-render paths rather than living only in component memory.
- New-conversation first prompts and existing-conversation follow-up prompts must both use the same durability model for unsent/failed state.
- Once a prompt is successfully persisted to the Claude session history, the corresponding local-only pending/failed entry must be reconciled away automatically.
- Conversation rendering must stop relying on message-count-based catch-up as the source of truth for optimistic reconciliation.

### Should Have

- Failed prompts should offer a clear recovery action such as Retry, Edit and resend, or Copy.
- Pending prompts should remain visually distinct from persisted prompts.
- The local-only prompt state should be available through the same conversation API the frontend already consumes, so the timeline is assembled in one place instead of split across ad hoc UI state.
- The design should make future offline drafting or outbox behavior possible without redoing the model.

### Out of Scope

- Full offline mode.
- Cross-device syncing of unsent prompts.
- Multi-user collaborative conflict resolution.
- Changing Claude Code JSONL format or treating it as anything other than the source of truth for accepted remote history.
- General chat composer redesign unrelated to failed-send recovery.

## Design

### User Experience

From the user's perspective, sending a prompt should have three visible states:

1. **Sending** — the prompt appears immediately in the conversation with a pending indicator.
2. **Failed** — if delivery fails, the prompt stays in place and clearly shows that it was not sent, along with the error if available.
3. **Sent / persisted** — once the prompt appears in the Claude-backed transcript, the local pending/failed version disappears and the normal persisted message remains.

The key UX rule is simple: once Panopticon shows a prompt in the conversation, it must not vanish because of transport failure.

For failed prompts, the user should be able to recover without retyping. At minimum, Panopticon should keep the text visible and recoverable. Ideally, it should provide direct retry/edit actions in the same message row.

### Technical Approach

Panopticon should treat conversation history as the merge of two sources:

1. **Remote accepted history** — messages parsed from the Claude session JSONL.
2. **Local outbox history** — prompts the user attempted to send that are still pending or failed locally.

The local outbox should be durable application state, not component-local React state.

#### Local outbox model

Add a local persistence layer for conversation prompt submissions with enough metadata to represent:
- prompt identity,
- conversation identity,
- exact text,
- created timestamp,
- delivery state (`sending`, `failed`, and optionally other explicit states if useful),
- last error text,
- reconciliation marker or correlation mechanism.

SQLite is the preferred home because Panopticon already persists conversation metadata there and this state must outlive component remounts and normal frontend refreshes.

#### Unified conversation API

The server should assemble the rendered conversation timeline by combining:
- parsed JSONL messages,
- local outbox entries for that conversation.

The frontend should not have to guess whether an optimistic message still exists. It should receive authoritative timeline data that already includes local pending/failed items.

#### Explicit reconciliation

Current optimistic reconciliation based on server message counts is not sufficient once local history can diverge from JSONL. Reconciliation must become identity-based rather than count-based.

The implementation should define an explicit way to match a local outbox entry with a successfully persisted JSONL user message so the outbox entry can be removed deterministically. The exact mechanism is an implementation detail for planning, but it must not depend solely on message counts.

#### Draft-mode parity

The first prompt of a newly created conversation must follow the same rules as later prompts in an existing conversation. The durability model should not depend on whether the send path is:
- create conversation + send first prompt, or
- send prompt to existing session.

A failure in either path must leave the user with a recoverable local record of the prompt.

### Constraints

- Claude session JSONL remains the source of truth for remote accepted history.
- Local-only unsent/failed entries must be clearly distinguishable from persisted transcript entries.
- The system must not duplicate successfully persisted user messages after reconciliation.
- The conversation timeline should stay understandable even while local and remote histories diverge temporarily.
- Error handling must preserve user text first; transport correctness comes second.
- The design should fit Panopticon's existing conversation architecture without introducing speculative frontend/backend rewrites outside this feature.

## References

- Related issue: PAN-739
- GitHub issue: eltmon/panopticon-cli#739
- Current optimistic state in frontend:
  - `src/dashboard/frontend/src/components/chat/ConversationPanel.tsx`
  - `src/dashboard/frontend/src/components/chat/ComposerFooter.tsx`
  - `src/dashboard/frontend/src/components/chat/DraftConversationPanel.tsx`
  - `src/dashboard/frontend/src/components/chat/MessagesTimeline.tsx`
  - `src/dashboard/frontend/src/components/MissionControl/index.tsx`
- Current server conversation history path:
  - `src/dashboard/server/routes/conversations.ts`
  - `src/dashboard/server/services/conversation-service.ts`
- Current persistent conversation metadata:
  - `src/lib/database/conversations-db.ts`
  - `src/lib/database/schema.ts`

## Open Questions

- What is the cleanest identity/correlation mechanism for matching a local outbox entry to the eventual JSONL user message?
- Should retry resend the same outbox item in place, or create a new attempt while preserving attempt history?
- Should failed prompts be editable inline, re-open in the composer, or both?
- Should local outbox entries be scoped only to conversations, or generalized for other optimistic UI operations later?
- Should the merged timeline be assembled entirely server-side, or should the API expose outbox entries separately and let the frontend merge them?