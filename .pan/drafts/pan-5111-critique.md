plan-digest: 5690bd6582ab515d19b5d7ca083229a183154727d997b46be61c509374328525

## blocks-the-design: Agent answer can be recorded after failed delivery

The PRD's WI-3 wrapper records an answer whenever `handlePostAgentAnswerQuestion` returns a status below 300 (`.pan/drafts/pan-5111.md`, lines 368-378). The existing plain AskUserQuestion branch awaits `deliverAgentMessage` but discards its `{ ok: false }` result and returns success (`src/dashboard/server/routes/agents/permissions.ts`, lines 197-206); that result is a real failure mode (`src/lib/agents/delivery.ts`, lines 441-454). The planned wrapper would then mark a push **Answered** although no answer reached the agent. Make the handler return a failure on `!delivery.ok`, and test that this path leaves no answer note.

## blocks-the-design: Caller IDs are not checked against the answered question

WI-3 notes the caller-supplied `toolUseId` or `answersToolUseId` after a successful HTTP response (`.pan/drafts/pan-5111.md`, lines 373-385). For ordinary agent questions, `handlePostAgentAnswerQuestion` falls back to `pendingQuestions[0]` when a supplied ID does not match; only operator-decision and Deft IDs get a stale-ID rejection (`src/dashboard/server/routes/agents/permissions.ts`, lines 158-169). The conversation `/message` handler has no `answersToolUseId` check and can deliver any valid message (`src/lib/overdeck/conversation-message.ts`, lines 408-427 and 606-696). A stale answer request can therefore mark a different, already withdrawn push **Answered**. Bind the note to the actual pending question ID at the delivery door and reject or ignore a stale/mismatched ID; add a stale-ID test for each door.

## blocks-the-design: Repeated keys can consume the wrong answer note

The PRD says keys repeat after a re-push (`.pan/drafts/pan-5111.md`, lines 102-105), but WI-2 stores one consumable note per key (lines 326-345), and WI-4 consumes it only when each push's 10-second departure timer fires (lines 434-446). If a key leaves, reappears, and the second push is answered before the first timer fires, the first resolution consumes the note. The second push is then labeled **Answered or withdrawn** despite receiving the answer. Associate notes with a push generation or otherwise match the answer to the correct departure, and test the leave → re-push → answer sequence.

## blocks-the-design: A restart labels unresolved pushes withdrawn

D-8 and WI-1 map any unresolved entry absent from the running dispatcher's `trackedIds()` to `resolved-without-answer` (`.pan/drafts/pan-5111.md`, lines 128-131 and 310-312). WI-5 supplies an empty set when the service is stopped or newly started (lines 478-482); the service creates a fresh dispatcher on start (`src/dashboard/server/services/needs-you-push-service.ts`, lines 141-149). Thus a restart immediately labels a still-pending question **Answered or withdrawn**. It also loses an answer noted during the 10-second grace because WI-4 clears timers on dispose (lines 441-446). Keep unresolved entries indeterminate until current pending state is reconciled after restart, or persist enough state to classify them correctly; test restart with a pending question and during the grace period.

## blocks-the-design: Losing all targets stops withdrawal detection

WI-4 records a resolution only when `observeSubject` sees a key depart (`.pan/drafts/pan-5111.md`, lines 434-445). The conversation scan returns before reading the feed whenever `hasTargets()` is false (`src/dashboard/server/services/needs-you-push-service.ts`, lines 87-105). If the last phone/subscription is removed after a push and that conversation's question later leaves, the history row remains **Waiting** indefinitely. Keep observing departures for previously pushed conversation keys even when there is no current push target, without treating newly seen keys as sent; test removal of the last target followed by departure.

## blocks-the-design: Raw provider errors can reach the history file

NFR-2 promises no provider secret in history (`.pan/drafts/pan-5111.md`, line 191), but WI-4 copies rejection `errorMessage(reason)` into a delivery and WI-1 only truncates `detail` to 200 characters (lines 424-429 and 303-307). Existing providers already pass raw fetch or request error messages through `detail` (`src/lib/push/webpush-provider.ts`, lines 65-77 and 152-155; `src/lib/push/ntfy-provider.ts`, lines 50-57). Truncation cannot remove a token or URL embedded in an error, and the extensible `PushProvider` type permits arbitrary detail (`src/lib/push/types.ts`, lines 29-43). Persist only a fixed reason/status or a scrubbed, explicitly safe detail; test with a provider error containing a sentinel secret.
