# PAN-3730 — Register a real codex transcript adapter

Issue: https://github.com/eltmon/overdeck/issues/3730

## Glossary

- **Transcript adapter**: per-harness object in `src/lib/conversations/transcript-adapter.ts` implementing `resolveSessionFile`, `serializeTranscript`, `compactSummary`, plus the capability flags `supportsPlainForkAsSource` / `supportsSourceAuthoredHandoff`. Looked up via `getTranscriptAdapter(harness)`.
- **Codex rollout**: the transcript JSONL a codex-harness conversation writes under its per-agent CODEX_HOME: `~/.overdeck/agents/<tmuxSession>/codex-home/sessions/YYYY/MM/DD/rollout-<ts>-<threadId>.jsonl`.
- **`resolveCodexRolloutPath(tmuxSession)`**: existing resolver in `src/dashboard/server/routes/jsonl-resolver.ts` (thread-id fast path, latest-rollout fallback). Already imported from lib code (`src/lib/overdeck/conversation-forks.ts:70-73`), so the import direction is established.

## Root cause (context only — do not re-investigate)

`REGISTRY` at `src/lib/conversations/transcript-adapter.ts:480` maps `'codex': claudeCodeAdapter`. The claude adapter's `resolveSessionFile` (lines 105-109) only checks `~/.claude/projects/<cwd-slug>/<claudeSessionId>.jsonl`, which never exists for codex conversations. Every fork/handoff whose SOURCE is a codex conversation therefore 400s at the server gate (`src/lib/overdeck/conversation-forks.ts:689-692`) with "No session file found". The same throw exists at `src/lib/conversations/summary-fork.ts:582`. Fixing the registry entry fixes all call sites — they all dispatch through `getTranscriptAdapter`.

## Work items

### WI-1: Add `codexAdapter` in `src/lib/conversations/transcript-adapter.ts`

Add a new adapter next to the kimi adapter, following the file's existing style (short serializer, comments explaining skips):

- `name: 'codex'`
- `supportsPlainForkAsSource: false` — a plain fork copies raw Claude JSONL and spawns `claude --resume`; a codex rollout cannot be consumed that way. (The claude adapter's `true` was being wrongly inherited.)
- `supportsSourceAuthoredHandoff: true` — the source-authored handoff mechanism is `deliverAgentMessage` + file-sentinel wait (`src/lib/conversations/summary-fork.ts:334-366`), both harness-neutral and codex-supported.
- `resolveSessionFile(conv)`: `return resolveCodexRolloutPath(conv.tmuxSession)`. Import `resolveCodexRolloutPath` from `'../../dashboard/server/routes/jsonl-resolver.js'`. Do NOT add claude-path fallbacks.
- `serializeTranscript(sessionFile, options)`: parse the rollout inline (do NOT import from `src/dashboard/server/services/`). The rollout line shape is documented at the top of `src/dashboard/server/services/codex-conversation-parser.ts` — read that file (roughly lines 1-200) and mirror its field handling. Emit the same canonical text style as the pi/acp/kimi serializers in this file:
  - `type:'event_msg'` + `payload.type:'user_message'` → `[user]\n<payload.message>`
  - `type:'event_msg'` + `payload.type:'agent_message'` → `[assistant]\n<payload.message>`
  - `type:'response_item'` + `payload.type:'function_call'|'custom_tool_call'` → `[tool_use: <payload.name>]\n<args>` where args is `payload.arguments` (string) or `JSON.stringify(payload.input)`, truncated to 500 chars, `<unserializable>` on stringify failure.
  - Skip everything else: `session_meta`, `turn_context`, `token_count`, `function_call_output`, `custom_tool_call_output`, `response_item/message` (raw turn incl. injected AGENTS.md), `reasoning` (Codex encrypts it). Note: `includeThinking` has no effect for codex — reasoning is never available; say so in a comment.
  - Skip unparseable lines (try/catch per line), join parts with `\n\n` — same as the kimi serializer.
- `compactSummary(sessionFile, options)`: copy the kimi pattern exactly (serialize via this adapter, then `summarizeSerializedText`; empty serialized → `{ summary: '', summaryModel: null }`).
- Registry: change line 480 to `'codex': codexAdapter,`.
- Update the module header comment (lines ~1-23): the "Future harnesses (Codex, etc.)" sentence is now stale — list the codex rollout shape alongside the others.

### WI-2: Tests in `src/lib/conversations/__tests__/transcript-adapter.test.ts`

Extend the existing test file (read it first; match its mocking style):

1. `getTranscriptAdapter('codex')` returns the adapter named `'codex'` with `supportsPlainForkAsSource === false` and `supportsSourceAuthoredHandoff === true` (this is the regression test: before the fix it returned the claude adapter).
2. `serializeTranscript` over a fixture rollout written to a temp file. Fixture lines (one JSON object per line):
   - `{"type":"session_meta","payload":{"id":"t1"}}`
   - `{"type":"event_msg","payload":{"type":"user_message","message":"hello codex"}}`
   - `{"type":"response_item","payload":{"type":"reasoning","summary":[]}}`
   - `{"type":"response_item","payload":{"type":"function_call","name":"exec_command","arguments":"{\"cmd\":\"ls\"}"}}`
   - `{"type":"response_item","payload":{"type":"function_call_output","output":"file.txt"}}`
   - `{"type":"event_msg","payload":{"type":"agent_message","message":"done"}}`
   - `{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"total_tokens":10}}}}`
   - one garbage non-JSON line
   Assert output contains `[user]\nhello codex`, `[tool_use: exec_command]`, `[assistant]\ndone`; assert it does NOT contain `file.txt` (tool output skipped) or anything from reasoning/token_count; assert garbage line didn't throw.
3. `resolveSessionFile` delegates to `resolveCodexRolloutPath` with `conv.tmuxSession`: `vi.mock('../../dashboard/server/routes/jsonl-resolver.js', ...)` and assert the mocked path is returned.

No fake-timer needs here (no retry/delay logic). Do not add tests for the claude/pi/kimi adapters — surgical scope.

## Verification gates (run all; paste outputs in your final report)

From the worktree root `/home/eltmon/Projects/hoff-pan-3730`:

1. `npx vitest run --configLoader runner src/lib/conversations/__tests__/transcript-adapter.test.ts`
2. `npx vitest run --configLoader runner src/lib/overdeck/__tests__/ 2>&1 | tail -20` — if this directory doesn't exist, instead run the nearest fork-related test files you find via `git grep -l "conversation-forks" -- 'src/**/__tests__/**'`.
3. `npx tsc --noEmit` (root tsconfig; contracts dist is already built and symlinked).
4. `npx eslint src/lib/conversations/transcript-adapter.ts src/lib/conversations/__tests__/transcript-adapter.test.ts --no-inline-config`

## Constraints

- Branch: you are on `feature/pan-3730` in a git worktree. Verify with `git branch --show-current` before your first edit. Never `git checkout`, never `git stash`, never touch `/home/eltmon/Projects/overdeck` (the primary checkout).
- Touch ONLY the two files named in WI-1/WI-2. Every changed line must trace to this brief.
- Do NOT commit this brief file (`PAN-3730-BRIEF.md`) — leave it untracked.
- Commit when green, message: `fix(conversations): register a real codex transcript adapter (PAN-3730)` with a body summarizing WI-1/WI-2. Do not push.
- If a gate fails for a reason outside these two files (pre-existing breakage), report it and stop rather than widening the diff.
