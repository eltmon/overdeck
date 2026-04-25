# PAN-826: Conversation/Terminal Integration Refactor

Tracking issue: [eltmon/panopticon-cli#826](https://github.com/eltmon/panopticon-cli/issues/826)

Closes when complete: #691, #696, #612, #823, #739

## Problem Statement

The Mission Control conversation viewer is meant to be a faithful, structured rendering of what is happening inside the agent's terminal. Over the last several weeks we have closed a string of bugs in this surface (PAN-441, PAN-451, PAN-473, PAN-699, PAN-795), but the experience still has five distinct rough edges that share enough underlying machinery to be solved together rather than ticket-by-ticket:

1. **Out-of-order tool calls and dropped tool activities** in incremental parses (#691). Pending parser state is rebuilt on every poll, so a `tool_result` arriving in a later poll than its `tool_use` is silently orphaned. Several sort sites still use lexicographic `createdAt.localeCompare()` instead of the new `(createdAt, sequence)` tiebreaker, leaving non-deterministic interleaving for parallel tool calls. Specialist `compact_boundary` offset hides pre-compact tool history.

2. **Duplicate assistant message rows with overlapping/garbled text** (#696). The fix to key by `entry.uuid ?? message.id` landed but has no regression test and no audit of other id-keyed code paths.

3. **The new-conversation startup dance.** Clicking `+` opens a draft composer and does nothing else. Only after the user submits a first message does `POST /api/conversations` spawn tmux, return 201 *before* Claude is alive, kick a background task that polls `waitForClaudeReady` for up to 30s, paste the queued message via `sendKeysAsync`, and rely on a 30s `sessionAlive` grace window to cover the gap. The frontend then polls `/messages` until the message appears. This is five layers of polling, deferral, and grace windows for a flow that should be instantaneous.

4. **Thinking-block resilience and UX.** Thinking blocks render inline as `WorkLogEntry` rows but cannot be expanded to read the full reasoning the way Bash entries can be expanded to read the full output. Separately (#612, #823), thinking-block cryptographic signatures are corrupted by compaction and by cross-model forks, leaving sessions permanently un-resumable until manually wiped.

5. **Failed user sends silently disappear** (#739). Optimistic prompts vanish on send error, taking the typed text with them.

Underneath all five, the chat module's structure has drifted from T3Code's. We borrow from T3Code regularly, and every drift makes the next port more expensive.

## Goals

- Eliminate every reproducible "conversation view doesn't match the terminal" symptom.
- Make new-conversation creation instantaneous and dance-free.
- Make thinking blocks first-class: expandable in the UI, resilient through compaction and forks.
- Stop losing user-typed text on send failure.
- Realign the chat module's filenames, component names, type names, and CSS class names with T3Code so future ports are mechanical.

## Non-Goals

- No changes to the Claude Code JSONL format itself; it remains the source of truth for accepted remote history.
- No Mission Control layout redesign outside the conversation pane.
- No change to Markdown / Shiki rendering behavior — only class-name alignment.
- No new dashboard pages, panels, or routes.

## Requirements

### Must Have

**Instant-start**

- Clicking `+` mounts a live conversation (terminal pane + transcript) within 1s, with no draft state in the UI tree and no queued-message logic in the API.
- `POST /api/conversations` returns only after the tmux session exists and Claude has reached its prompt; the response body is the live conversation record.
- The `sessionAlive` 30s grace window for newly-created conversations is removed.
- The frontend never polls `/messages` to detect first-message arrival; the live `/ws/rpc` stream and `/ws/terminal` PTY are sufficient.
- The `DraftConversationPanel` component and its supporting state are deleted.

**Parser correctness (closes #691, #696)**

- `pendingToolUse` and `pendingAssistant` parser state in `conversation-service.ts` persists across incremental parses for the lifetime of the conversation.
- Every sort site in the conversation pipeline (server and frontend) uses the `(createdAt, sequence)` tiebreaker. No lexicographic `createdAt` comparisons remain.
- Specialist `compact_boundary` offset is handled so pre-compact tool calls remain visible in the rendered transcript.
- Every site that previously keyed by `message.id` is audited and switched to `entry.uuid ?? message.id`.
- Regression tests use the captured fixture `~/.claude/projects/-home-eltmon-Projects/2d5ba448-3625-4e7f-beb4-0295ebf654b2.jsonl` to assert no duplicate rows render.
- A Playwright UAT spawns an agent, fires three parallel tool calls plus a thinking block across an incremental-parse boundary, and asserts the rendered transcript order matches terminal scrollback exactly.

**Thinking blocks**

- `tone: 'thinking'` rows in `WorkLogEntryRow` (renamed `SimpleWorkEntryRow`) are expandable with the same affordance Bash entries use today (the `isTerminal` toggle pattern).
- Expanded thinking shows the full reasoning text with appropriate styling.

**Thinking-signature resilience (closes #612, #823)**

- Deacon patrol detects "Invalid signature in thinking block" in agent output, auto-clears the corrupted JSONL, restarts the agent fresh, and surfaces the recovery as a dashboard event. The agent recovers via STATE.md + beads.
- Specialists always launch with `--no-resume`.
- `copySessionFromCompactBoundary()` in `src/lib/conversations/summary-fork.ts` strips `signature` fields from thinking blocks.
- `localSummaryOnly` and `includeThinkingInSummary` are wired through the API and `ForkModal.tsx` as user-facing options.
- A model-switch warning appears in `ForkModal` when a plain fork would change the launch model.
- `docs/FORKS.md` is refreshed with summary-vs-plain semantics, thinking-block behavior, and token-cost guidance. `docs/MISSION-CONTROL.md` gains a fork section.

**Unsent message persistence (closes #739)**

- A user prompt that fails to send remains visible in the conversation with an explicit error state, retry, edit, copy, and discard controls.
- Failed-prompt local state survives normal UI re-render paths.
- Once a prompt is accepted into the Claude JSONL, the local-only entry reconciles away automatically.
- This applies equally to the first message of a new conversation and to follow-ups in an existing one.

**Conversation list — favorite icon position**

- The favorited star (rendered when `conv.isFavorited`) currently lives inline in the meta row alongside `lastAttachedAt` and `totalCost`, so its horizontal position drifts based on which meta items are present. The hover-only "favorite this" star already lives in the right-aligned `.conversationActions` group.
- Render the favorited star in the same right-aligned slot as the hover star so the icon stays in a fixed position regardless of favorited state. The hover-only fade behavior should not apply to the persistent star — it remains visible when the row is not hovered, but in the same column.
- File: `src/dashboard/frontend/src/components/MissionControl/ConversationList.tsx` (lines ~524–583); CSS in the colocated module.

**T3Code structural alignment**

- Split `src/dashboard/frontend/src/components/chat/session-logic.ts` into `MessagesTimeline.logic.ts` matching T3Code's filename.
- Rename `WorkLogEntryRow` → `SimpleWorkEntryRow`.
- Adopt the `MessagesTimelineRow` discriminated-union row model (`kind: 'message' | 'work' | 'proposed-plan' | 'working'`).
- Align CSS class names: `.chat-markdown`, `.chat-markdown-codeblock`, `.chat-markdown-copy-button`, `.chat-markdown-shiki`.
- Keep our existing `tone` system (already matches T3Code).
- Reference: `/home/eltmon/Projects/t3code/apps/web/src/components/chat/`.
- No Panopticon feature is removed or downgraded to match T3Code; alignment is structural only.

### Should Have

- Recovery action UI on failed prompts is inline (Retry / Edit / Copy / Discard), not hidden behind a menu.
- Pending prompts are visually distinct from persisted prompts.
- Failed-prompt state is exposed through the same conversation API the frontend already consumes, so the timeline assembles in one place.
- Deacon's recovery event includes which session was reset and why, surfaced in the workspace inspector.

### Out of Scope

- Full offline mode.
- Cross-device sync of unsent prompts.
- Multi-user collaborative conflict resolution.
- Composer redesign beyond what failed-send recovery requires.
- Replacing Shiki or the Markdown renderer.

## Design

### Instant-start flow

Today's flow:

```
click + → DraftConversationPanel mounts → user types first message → submit
       → POST /api/conversations { message, model, effort }
       → spawnConversationSession() (async, fire-and-forget)
       → 201 returned BEFORE Claude is alive
       → background: waitForClaudeReady (poll 500ms, 30s timeout)
                   → sendKeysAsync(queuedMessage)
                   → generate AI title (async)
       → frontend: poll /messages every ~2s until first message appears
       → conversation list: poll /conversations every 10s, sessionAlive grace = 30s
```

Target flow:

```
click + → POST /api/conversations { model, effort }
       → spawnConversationSession() awaits tmux create + waitForClaudeReady
       → 201 returned with the live conversation record
       → frontend mounts XTerminal (/ws/terminal) and transcript (/ws/rpc subscription)
       → composer is empty, focus is in the input, user types whenever they want
```

Deletions:

- `DraftConversationPanel.tsx` and `draftKey` state in `MissionControl/index.tsx`.
- `handleDraftCreated` and the `isDraft` branching.
- Background `void` task in `routes/conversations.ts` that paste-buffers a queued message.
- `sessionAlive` 30s grace window in the conversations route.
- Frontend message-arrival polling for new conversations.

The synchronous spawn is bounded by `waitForClaudeReady`'s existing 30s timeout. If Claude fails to come up within that window, return a 504 with the partial conversation record so the user can retry or inspect tmux.

### Parser state persistence

`parseConversationMessages` in `src/dashboard/server/services/conversation-service.ts` is invoked incrementally as new JSONL bytes land. Today the function constructs `pendingToolUse` and `pendingAssistant` maps locally, so any `tool_result` whose matching `tool_use` lives in a prior poll's output has nothing to pair with and is dropped.

Move these maps to a per-conversation parser-state struct cached in the conversation service alongside the conversation record. Each incremental parse:

1. Loads the cached state.
2. Processes the new entries, mutating the state.
3. Persists the updated state.

Two-pass pairing (already in place from #699) continues to handle the case where `tool_result` is lexically *earlier* than `tool_use` within a single poll.

### Sort consistency

Audit every `.sort(` site in:

- `src/dashboard/server/services/conversation-service.ts`
- `src/dashboard/frontend/src/components/chat/MessagesTimeline.logic.ts` (after split)
- `src/dashboard/frontend/src/components/chat/MessagesTimeline.tsx`
- Any other timeline-adjacent module surfaced by `git grep 'createdAt' src/dashboard/`

Replace lexicographic `localeCompare` with a comparator that breaks ties on the monotonic `sequence` field.

### Compact-boundary offset

When a specialist hits `compact_boundary`, the post-compact JSONL begins with a synthetic summary entry whose timestamp resets the apparent ordering. Detect compact-boundary entries during parse and propagate an `offset` field on subsequent entries so the renderer can preserve pre-compact tool history rather than hiding it behind the new low-timestamp summary.

### Duplicate-id audit (#696)

`git grep` for sites that key by `message.id`, `msg.id`, or `id` derived from a JSON message envelope. Switch each to `entry.uuid ?? message.id ?? <synthetic>`. Add a unit test using the captured fixture (~6.8MB JSONL with known duplicate `message.id` values) that asserts the parser produces N distinct rows for N distinct entries.

### Thinking-block expansion

`SimpleWorkEntryRow` (renamed from `WorkLogEntryRow`) already handles per-row toggle state for the `isTerminal` branch. Extend the toggle to `tone === 'thinking'`, render the expanded body with the same `pre`-style container Bash uses, but with prose styling appropriate to reasoning text. Persist expansion state via the same `expandedWorkGroups` mechanism if T3Code does; otherwise per-row local state.

### Thinking-signature resilience

**Deacon detector** — In the patrol loop (`src/deacon/patrol.ts` or equivalent), scan recent agent output for the literal "Invalid signature in thinking block" error. On detection:

1. Emit a `recovery.signature_corruption` event.
2. Stop the agent.
3. Move the corrupted JSONL aside (rename, do **not** delete — JSONL is sacred per CLAUDE.md).
4. Restart the agent without `--resume`. The agent picks up STATE.md + beads naturally.
5. Surface the event in the dashboard workspace inspector.

**Specialists** — review-agent, test-agent, merge-agent, and any other specialist spawn paths set `--no-resume` unconditionally. They always start fresh.

**Fork sanitization** — In `copySessionFromCompactBoundary()`, walk message content arrays and strip `signature` fields from any `type: 'thinking'` blocks before writing the fork's JSONL. This is the canonical fix for cross-model fork failures.

**Fork options** —

- `localSummaryOnly`: when true, the fork uses only the local summary and skips re-uploading the source transcript. Wire through API and `ForkModal.tsx` checkbox.
- `includeThinkingInSummary`: when true (default off), the fork's summary message includes thinking content. Wire identically.

**Model-switch warning** — When the user selects a plain fork and the launch model differs from the source conversation's model, `ForkModal` shows an inline warning explaining the implication.

**Docs** — Rewrite `docs/FORKS.md`:

- Summary fork vs. plain fork: behavior, when to use each.
- Thinking-block behavior across forks.
- Token cost implications.
- Cross-model gotchas (signatures, capability mismatches).

Add a "Forks" section to `docs/MISSION-CONTROL.md` linking out.

### Unsent message persistence

Treat conversation history as a merge of two sources:

1. The Claude JSONL (source of truth for accepted history).
2. A local-only outbox of pending and failed user prompts.

The conversation API returns both layers. The frontend timeline assembles them with the same sort comparator as the rest of the pipeline. On successful round-trip, the local entry is reconciled away by matching on prompt text + timestamp window.

Failed prompts render with:

- The full original prompt text.
- An error indicator and the error message if available.
- Inline actions: Retry, Edit, Copy, Discard.

### T3Code structural alignment

| Today | After |
|-------|-------|
| `session-logic.ts` | `MessagesTimeline.logic.ts` |
| `WorkLogEntryRow` | `SimpleWorkEntryRow` |
| Ad-hoc row branching | `MessagesTimelineRow` discriminated union |
| Mixed CSS class naming | `.chat-markdown*` aligned with T3Code |
| `tone` system | unchanged (already aligned) |
| `ChatMessage`, `WorkLogEntry` types | unchanged (already aligned) |

The goal is that a future T3Code update touching `MessagesTimeline.tsx` can be diffed against ours and ported by a person reading the diff, not reverse-engineering naming conventions.

## Acceptance Criteria

- Clicking `+` in Mission Control opens a live conversation with terminal + transcript visible in under 1s; no draft state exists in the codebase (`git grep -i draft src/dashboard/frontend/src/components/chat/` returns nothing).
- `POST /api/conversations` does not return until tmux is up and Claude is at its prompt; the background queued-message task no longer exists.
- The `sessionAlive` 30s grace window is removed from the conversations route.
- Playwright UAT: spawn agent, fire three parallel tool calls plus a thinking block across an incremental-parse boundary; rendered transcript order matches terminal scrollback exactly.
- Regression test loading the captured duplicate-id JSONL fixture renders no duplicate rows.
- `git grep 'localeCompare' src/dashboard/` returns no hits in timeline code.
- `WorkLogEntryRow` is renamed to `SimpleWorkEntryRow`; `session-logic.ts` is split into `MessagesTimeline.logic.ts`.
- Thinking blocks expand and collapse with the same affordance as Bash entries.
- A cross-model fork with thinking blocks completes end-to-end without signature errors.
- Deacon recovers a corrupted-signature session within one patrol cycle; the recovery event is visible in the dashboard.
- A failed user send remains visible in the conversation with retry / edit / copy / discard controls; reload preserves the failed entry.
- The favorited star icon in the conversation list sits in the same horizontal position as the hover-only favorite-this star; toggling favorited state does not shift the star left or right.
- `docs/FORKS.md` and `docs/MISSION-CONTROL.md` are updated; this PRD is referenced from issue #826.
- `npm run typecheck`, `npm run lint`, and `npm test` pass.

## Implementation Notes

- Per CLAUDE.md, do not introduce blocking calls in dashboard server code. The synchronous-spawn change must use `execAsync` and async PTY waits, not `execSync`.
- Per CLAUDE.md, JSONL files are sacred. The deacon recovery flow renames corrupted JSONL aside; it never deletes.
- Per CLAUDE.md, deliver this as a single complete feature. Do not ship the instant-start change without the parser-correctness work, etc.
- The dashboard runs under Node 22 from `dist/`; `npm run build` before exercising the changes via `pan up`.
- T3Code reference paths assume `/home/eltmon/Projects/t3code/apps/web/src/components/chat/`. Cross-check before borrowing patterns; prefer reading the file over recalling structure.

## Open Questions

- Should the failed-prompt outbox live in SQLite (durable across server restarts) or in-process (simpler, lost on restart)? Default to SQLite unless we find a strong reason otherwise.
- Should deacon's auto-recovery require user acknowledgment in the dashboard before restarting, or fully automatic with a notification after the fact? Default to fully automatic; the user can stop the agent if they disagree.
- Are there other JSONL-replay surfaces (terminal scrollback, conversation export) that also assume `message.id` uniqueness? The audit step should answer this; track findings in the issue thread.
