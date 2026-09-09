# PAN-3730 round 2 — harness-aware heuristic fallback summary + custom_tool_call test

Follow-up to the landed-on-branch commit 66dff4d1e8 (see PAN-3730-BRIEF.md for round-1 context). Adversarial review found: `generateFallbackSummaryPromise` in `src/lib/conversations/summary-fork.ts:445` only understands Claude-shaped records (`entry.type === 'user'` / `'assistant'`), so a codex/pi/acp/kimi fork that hits the heuristic fallback (localSummaryOnly, or LLM-summary failure) gets a contextless summary scaffold.

## WI-3: Make the heuristic fallback harness-aware

File: `src/lib/conversations/summary-fork.ts`

1. Change `generateFallbackSummary(jsonlPath)` (line ~726) and `generateFallbackSummaryPromise(jsonlPath)` (line ~445) to accept an optional second parameter `harness?: RuntimeName` (type already imported in this file or import from `'../runtimes/types.js'`).
2. In `generateFallbackSummaryPromise`, branch at the top: resolve `const adapter = getTranscriptAdapter(harness)` (already imported at line 40). If `adapter.name !== 'claude-code'`, use a new non-claude path; otherwise keep the existing claude parsing byte-for-byte unchanged (an undefined harness resolves to the claude adapter — existing callers keep exact current behavior).
3. Non-claude path: `const serialized = await adapter.serializeTranscript(jsonlPath, { includeThinking: false })`. Split on `'\n\n'` into parts. Parts starting with `'[user]\n'` → user messages (strip the `[user]\n` prefix). Parts starting with `'[tool_use: '` → tool name = text between `'[tool_use: '` and the first `']'`. Leave filesModified empty (tool-arg mining is claude-specific; do not add per-harness arg parsing). Then build the SAME markdown scaffold the claude path builds (`## Conversation Summary Fork` header, `### User Messages:` capped at 10 × 200 chars, `### Tools Used:`, `FORK_WAIT_INSTRUCTION` footer). Factor the scaffold into a small shared helper so the two paths cannot drift; the claude path's output must remain byte-identical for existing inputs.
4. Thread the harness through the three call sites:
   - `src/lib/overdeck/conversation-forks.ts:449` and `:474` → `generateFallbackSummary(parentSessionFile, parentConv.harness ?? undefined)`
   - `src/lib/conversations/summary-fork.ts:438` → `generateFallbackSummary(sourceSessionFile, conv.harness ?? undefined)`
   Note `conv.harness` may be typed `string | null` — coerce with `?? undefined` and cast only if the existing code pattern does (check nearby `getTranscriptAdapter(conv.harness ?? undefined)` usages and mirror them exactly).

## WI-4: Tests

1. In `src/lib/conversations/__tests__/transcript-adapter.test.ts`, add a `custom_tool_call` case to the codex serializer test (or a sibling test): a line `{"type":"response_item","payload":{"type":"custom_tool_call","name":"apply_patch","input":"*** Begin Patch"}}` must serialize to a part starting `[tool_use: apply_patch]` containing the JSON-stringified input (assert with the actual production behavior — `JSON.stringify('*** Begin Patch')`).
2. Fallback-summary test — put it wherever this repo already tests summary-fork behavior (`summary-fork-handoff.test.ts` is the closest existing file; a new focused file `summary-fork-fallback.test.ts` in the same directory is also fine): write a codex-shaped rollout fixture to a temp file (reuse the shape from the round-1 codex serializer test, including a `custom_tool_call`), call `generateFallbackSummary(file, 'codex')` via `Effect.runPromise`, and assert the result contains the user message text under `### User Messages:` and the tool names under `### Tools Used:`. Also assert the claude path still works: run `generateFallbackSummary(claudeFixture)` with NO harness argument on a minimal claude-shaped fixture and assert user text appears (regression guard for the refactor).

## Verification gates (run all from the worktree root; paste tail outputs)

1. `npx vitest run --configLoader runner src/lib/conversations/__tests__/`
2. `npx vitest run --configLoader runner src/lib/overdeck/__tests__/`
3. `npx tsc --noEmit`
4. `npx eslint src/lib/conversations/summary-fork.ts src/lib/conversations/transcript-adapter.ts src/lib/conversations/__tests__/ --no-inline-config`

## Constraints

- Branch `feature/pan-3730`; verify with `git branch --show-current` first. No checkout/stash; never touch `/home/eltmon/Projects/overdeck`.
- Files you may change: `src/lib/conversations/summary-fork.ts`, `src/lib/overdeck/conversation-forks.ts` (the two call-site lines only), the test files named in WI-4, and `src/lib/conversations/__tests__/transcript-adapter.test.ts`. Nothing else.
- Do NOT commit — leave the changes staged-or-unstaged in the working tree; the coordinator commits after review. Do not commit or modify the BRIEF files.
- If a gate fails for reasons outside these files, report and stop.
