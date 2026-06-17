# First conversation message not visible until refresh — investigation findings

**Date:** 2026-06-16
**Symptom (reported):** "When I FIRST send text in a conversation, sometimes I don't
see the text back until I refresh the page." Intermittent; only the first message of a
fresh/cold conversation; subsequent messages stream fine.

## Root cause

A cold-start conversation's live transcript is delivered **only** by the WebSocket
stream once streaming turns on, and the HTTP poll that used to back it up is disabled in
that state. When the stream's first (snapshot) event is empty — which it can be even when
the JSONL already has bytes — there is no fallback to correct it, so the view stays on the
"How can I help you?" empty state until a manual refresh re-reads the transcript.

### The chain

1. **Streaming is gated on `sessionAlive`.**
   `shouldStreamConversationMessages` returns false until `conversation.sessionAlive` is
   true — `src/dashboard/frontend/src/components/chat/useConversationMessagesStream.ts:111-127`.
   A new conversation is created with `sessionAlive: false`
   (`src/dashboard/server/routes/conversations.ts:2609`) and only flips true when the
   conversations list re-polls — every 2s while a spawn is pending, else 10s —
   `src/dashboard/frontend/src/components/CommandDeck/ConversationList.tsx:193-198`.

2. **When streaming turns on, the HTTP poll/backfill turns off.**
   `src/dashboard/frontend/src/components/chat/ConversationPanel.tsx:229-230`:
   `enabled: !streamMessagesEnabled`,
   `refetchInterval: streamMessagesEnabled ? false : (conversation.sessionAlive ? 2000 : false)`.
   So once `streamMessagesEnabled` is true the WS stream is the *only* transcript source.

3. **The server can emit an empty snapshot it never corrects.**
   `src/dashboard/server/ws-rpc.ts:759-801` — the initial `parseConversationMessages` can
   return 0 messages even when `byteOffset > 0`. The comment says
   *"emitting empty snapshot (client HTTP backfill covers this)"* — but per step 2 there is
   no backfill while streaming. Because the file exists, `watchConversation`'s `fs.watch`
   succeeds (no ENOENT → no 500ms polling fallback —
   `src/dashboard/server/services/conversation-service.ts:1463-1487`) and the watcher
   starts at `byteOffset = full file size`. If no further *parseable* append fires a watch
   event, the empty snapshot stands forever.

4. **Client renders the empty/first-message state.**
   `applyConversationMessagesEvent` sets `discovering: false` on the empty snapshot, so
   `ConversationPanel.tsx:1255-1256` computes `isFirstMessage = true` and shows
   "How can I help you?" despite content on disk. Refresh re-subscribes / re-fetches and
   the full transcript appears.

### Empirical / log evidence
- `fs.promises.watch` on a *missing* file throws ENOENT → `watchConversation` falls back to
  500ms polling and self-heals (tested in Node 22). That is why the missing-file variant is
  NOT the permanent-stuck case; the **file-exists-but-parsed-0** window is.
- `~/.panopticon/logs/dashboard.log` contains a real occurrence:
  `[conv-stream] initial parse of 20260614-2698 yielded 0 messages despite byteOffset=2729
  — emitting empty snapshot (client HTTP backfill covers this)`.

## Why intermittent / first-message-only
The bad window requires the WS subscription to attach (sessionAlive just flipped true) at a
moment when the JSONL has bytes but parses to 0 messages, with no later parseable append to
nudge the watcher. Once any delta lands, the merge logic recovers, and all later messages
stream normally — so only the first message of a cold conversation is exposed.

## Recommended fix (root cause, not a bandaid)
The load-bearing flaw: **streaming fully disables the HTTP fallback, so any gap in the WS
stream has no recovery path.** Options (prefer the first):

1. **Keep the HTTP backfill alive while the streamed cache is empty.** Re-enable the HTTP
   query (or a one-shot fetch) whenever `streamMessagesEnabled && cachedMessages.length === 0`,
   so an empty snapshot is corrected within one poll — exactly what the stale ws-rpc.ts
   comment already assumes happens. This restores the documented invariant.
2. **Make the empty-snapshot case self-heal server-side:** when the initial parse yields 0
   messages but `byteOffset > 0`, start the 500ms polling loop (don't trust `fs.watch`-only),
   and/or re-parse from byteOffset 0 on the next event.

Either fixes the permanent-stuck case; (1) also covers the cold-start delay window.

## Live reproduction — CONFIRMED (2026-06-16, on pan.localhost)

Reproduced twice end-to-end via Playwright (test conversations stopped + archived after):

| Conv | session | user msg on disk | assistant reply on disk | live panel at +Ns |
| --- | --- | --- | --- | --- |
| 2999 | 20260617-7480 | 01:12:39.022Z | 01:12:41.634Z (2.6s) | stuck "Sending… / Working for 126s" |
| 3000 | 20260617-7778 | 01:17:04.682Z | 01:17:07.936Z (3.3s) | stuck "Sending… / Working for 58s" |

Both: the optimistic user message rendered ("Sending…") but the **echoed user message and
assistant reply never streamed into the live view** — even though both were on disk within
~3 seconds. A page reload (`/conv/2999`) immediately rendered the full transcript
("PONG-7480 · 2.6s"). This is exactly the reported symptom.

### Mechanism — bisected to "stream active, no fallback" (advisor's branch B)
Network capture for the stuck conv 3000 (`20260617-7778`): the client polled
`/api/conversations/20260617-7778/diffs` every ~2s but issued **zero**
`/api/conversations/20260617-7778/messages` requests. Zero `/messages` polls means the HTTP
query was disabled (`enabled: !streamMessagesEnabled`), i.e. **`streamMessagesEnabled` was
true** — the WS subscription was active. So the WS stream was the only transcript source,
it failed to deliver the first message's records, and there was no HTTP fallback. NOT the
`sessionAlive=false` dead zone.

Server log for both sessions showed full lifecycle (Creating → spawned → Claude ready →
title gen → `[hooks] Stop … waiting=false`) but **no `[conv-stream]` line at all** — the
subscription's initial parse did not hit the `byteOffset>0 && 0 messages` warning, consistent
with the subscription attaching while the JSONL had 0 bytes (empty initial snapshot), after
which the watcher's delta for the first write never reached the client.

### Fix (confirmed direction)
**Primary (client, robust):** do not fully disable the HTTP `/messages` query while
streaming when the streamed cache is still empty. Re-enable a poll/one-shot whenever
`streamMessagesEnabled && (cachedMessages?.length ?? 0) === 0`. This single change would have
surfaced the on-disk transcript within one 2s poll in both repros, regardless of why the WS
stream missed the first write. It also makes the stale ws-rpc.ts comment
("client HTTP backfill covers this") true again.

**Secondary (server, root of the WS miss):** make the cold-start subscription self-deliver —
when the initial parse is empty, ensure the watcher actually picks up the first write (don't
rely on `fs.watch` alone for a file that may be created/grow right after attach; the 500ms
polling fallback must engage and emit). Worth fixing so the WS path is correct on its own,
but the client fallback is the safety net that closes the user-visible bug.
