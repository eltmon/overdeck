# PAN-699 — Conversation view renders tool calls out of terminal order

## Problem

`parseConversationMessages` in `src/dashboard/server/services/conversation-service.ts` walks the JSONL file and appends entries in file-read order without ever sorting. With parallel tool calls, buffered writes, or compact boundaries, the dashboard's conversation view shows tool calls and messages in an order that doesn't match what actually happened in the terminal.

Concrete symptoms:
1. Entries rendered in parse order; `entry.timestamp` captured for `createdAt` but never used as a sort key.
2. `pendingToolUse` only resolves forward — if a `tool_result` appears before its `tool_use`, the pair is orphaned and the `tool_use` flushes as unpaired.
3. No tiebreaker when timestamps collide at second/microsecond precision.
4. `pendingToolUse` is rebuilt per incremental `parseConversationMessages` call (keyed on byteOffset), so a `tool_use` in batch N and its `tool_result` in batch N+1 currently cannot pair regardless of ordering. This is a latent bug beyond the ordering issue.

## Approach (chosen)

Mirror the t3code pattern (`compareActivitiesByOrder`): sort by `(createdAt, sequence)` server-side after a two-pass walk, and propagate `sequence` through the wire type so the client has a stable tiebreaker.

### Changes

1. **Contract (`packages/contracts/src/rpc.ts`)** — add optional `sequence: number` to both `ChatMessage` and `WorkLogEntry`.
2. **Parser (`conversation-service.ts`)**
   - Maintain a monotonic `sequence` counter (per JSONL line) and stash it on every emitted message / work log entry.
   - Build an `unresolvedResults: Map<tool_use_id, {result, isError, sequence, createdAt}>` alongside `pendingToolUse`. On `tool_result`, if the matching `tool_use` hasn't been seen, stash in `unresolvedResults`. On `tool_use`, check `unresolvedResults` for a pre-arrived result and merge immediately.
   - After the walk, sort `messages` and `workLog` independently by `(createdAt, sequence)` before returning.
   - **Persist cross-call state**: `parseConversationMessages` returns `pendingToolUse`, `unresolvedResults`, and `lastSequence` as part of `ParseResult`; callers (watcher, route handlers) pass the prior state back in on the next incremental call. Flushing of unpaired `tool_use` entries only happens in the `summarize` / non-incremental entry points, not mid-stream.
3. **Route (`routes/agents.ts`)** — include `sequence` in the `messages` / `workLog` wire shape; thread the parser's persistent state through whatever caller owns `byteOffset` today.
4. **Client (`MessagesTimeline.tsx`)** — defensive `.toSorted((a,b) => a.createdAt.localeCompare(b.createdAt) || (a.sequence ?? 0) - (b.sequence ?? 0))` on the combined stream before render. Server is authoritative; client sort is a cheap second belt.
5. **Compact boundary** (`parseFromLastCompactBoundary`) — unchanged as a slicing strategy, but the post-walk sort covers any non-atomic marker write.

## Out of scope

- Replacing incremental parsing with full re-parse. Cross-call state persistence is sufficient.
- Changing Claude Code's JSONL write ordering (upstream, not ours).
- Touching the RPC snapshot/domain-event path — this is purely about the JSONL-derived conversation view.
- Re-designing `WorkLogEntry` tool pairing to use `turnId` like t3code. We keep `tool_use_id` pairing; we just fix its direction and persistence.

## Testing

- **Unit tests (vitest)** — synthetic JSONL fixtures in a new `conversation-service.test.ts`:
  - Parallel tool calls in one assistant turn (two `tool_use`, two `tool_result`, ordering scrambled).
  - `tool_result` arriving before its `tool_use` in the file.
  - Incremental parse: `tool_use` in read-1, `tool_result` in read-2 — must pair after state persistence.
  - Identical timestamps across three entries — `sequence` provides the tiebreaker.
  - Compact boundary mid-turn — ordering stable on both sides.
- **Regression fixture** — snapshot test from a real broken JSONL (captured during planning or handed to work agent). Commit as a frozen fixture under `src/dashboard/server/services/__fixtures__/`.
- **Playwright UAT** — isolated browser session; open a known session in the dashboard, assert the rendered conversation matches expected order. Use an isolated browser profile (no shared state with other agents).

## Files touched

- `packages/contracts/src/rpc.ts`
- `src/dashboard/server/services/conversation-service.ts`
- `src/dashboard/server/routes/agents.ts`
- `src/dashboard/frontend/src/components/chat/MessagesTimeline.tsx`
- `src/dashboard/server/services/conversation-service.test.ts` (new)
- `src/dashboard/server/services/__fixtures__/*.jsonl` (new)
- UAT spec under the existing dashboard Playwright harness (new)

## Acceptance summary

Dashboard conversation view renders messages + tool calls in strict terminal order across: parallel tool calls, out-of-order JSONL writes, incremental parse boundaries, compact boundaries, and timestamp ties. No orphaned tool calls. No regressions in cost calculation, streaming detection, or `summarizeConversationActivity`.
