# KRUX-6: Analysis Pipeline — Transcript Batching and AI Invocation Loop

## Overview

Connect the live Deepgram transcript stream to the AI analysis pipeline with smart batching, conversation history management, and continuous insight accumulation.

## Architecture

```
DeepgramService                    AIService
  │                                  │
  │ onTranscript(entry)              │
  ├─────────────────────────────────►│ appendTranscript(entry)
  │                                  │   └─ accumulates TranscriptEntry[]
  │                                  │
  │                      Timer tick  │
  │                      (10s default)│
  │                                  ├─ Content gate: new entries since last analysis?
  │                                  │   NO → skip
  │                                  │   YES ↓
  │                                  ├─ Build prompt:
  │                                  │   ├─ System prompt (with dedup + summary instructions)
  │                                  │   ├─ Context documents
  │                                  │   ├─ Running summary (of older conversation)
  │                                  │   ├─ Raw transcript (sliding window, ~4000 tokens)
  │                                  │   ├─ Previous insights (for dedup)
  │                                  │   └─ NEW transcript text (since last analysis)
  │                                  │
  │                                  ├─ Call provider.analyze()
  │                                  │   ├─ Stream chunks → IPC → renderer (append)
  │                                  │   └─ Complete → extract summary + insights
  │                                  │
  │                                  ├─ Store running summary for next batch
  │                                  ├─ Store insights for dedup prompt
  │                                  └─ Advance cursor (lastAnalyzedIndex)
  │
  │                      On error:   │
  │                                  ├─ Log + notify renderer
  │                                  └─ Failed text rolls into next batch (cursor not advanced)
```

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Transcript accumulation | Main process | DeepgramService already emits to main. No round-trip through renderer. |
| History management | Hybrid | Token-based sliding window (~4000 tokens raw) + AI-generated summary of older content. Best fidelity. |
| Summary generation | Same API call | Extend `report_insights` tool schema with `conversationSummary` field. One call = insights + summary. |
| Deduplication | Prompt-based | Send previous insights in prompt, instruct AI to only surface NEW observations. |
| Trigger mechanism | Timer + content gate | Fire every N seconds (configurable, default 10s) but only if new transcript text exists. |
| Error handling | Skip + next batch | On failure, notify renderer, don't advance cursor. Failed batch text rolls into next batch automatically. |
| Significance threshold | Prompt-only | Existing prompt instruction ("only genuinely meaningful") is sufficient. No code filter needed. |
| Sliding window size | Token-based (~4000 tokens) | Predictable budget regardless of speaking pace. Reuse existing token estimation from context-formatter. |

## Implementation Tasks

### Task 1: Extend tool schemas and prompt for summary + dedup (medium)

**Files to modify:**
- `src/main/prompts.ts` — add `conversationSummary` field to both tool schemas; update system prompt
- `src/shared/types.ts` — add `AnalysisResult` type (StructuredInsights + summary)
- `src/main/providers/types.ts` — update `AnalysisRequest` to include `previousInsights` and `runningSummary`; change return type
- `src/main/providers/anthropic.ts` — extract summary from tool response
- `src/main/providers/moonshot.ts` — extract summary from tool response
- `src/main/providers/normalize.ts` — parse `conversationSummary` field

**Changes:**
1. Add `conversationSummary` (string) to `report_insights` tool schema in both Anthropic and OpenAI formats
2. Update system prompt to:
   - Instruct AI to produce a running summary of the full conversation so far (~200 words)
   - Include dedup instruction: "You will receive previous insights — do NOT re-surface them, only report NEW observations"
   - Accept `[PREVIOUS INSIGHTS]` and `[CONVERSATION SUMMARY]` sections in the user message
3. Add `AnalysisResult` type: `StructuredInsights & { conversationSummary: string }`
4. Update `AnalysisRequest` to include `previousInsights?: StructuredInsights` and `runningSummary?: string`
5. Update providers to extract `conversationSummary` from the parsed tool response
6. Update `normalize.ts` to include `conversationSummary` in parsed output

**Dependencies:** None

---

### Task 2: Implement transcript batching and analysis pipeline (complex)

**Files to modify:**
- `src/main/ai-service.ts` — major refactor: transcript accumulation, smart loop, history management
- `src/main/index.ts` — wire DeepgramService transcript events to AIService

**Changes:**

1. **Transcript accumulation:**
   - Add `appendTranscript(entry: TranscriptEntry)` method
   - Store entries in array with cursor tracking (`lastAnalyzedIndex`)
   - Remove `MOCK_TRANSCRIPT` import and default value
   - Remove `setTranscript(text)` method (replaced by entry-based accumulation)
   - Add helper to build text from TranscriptEntry[] (join final entries with speaker labels)

2. **Smart analysis loop (replaces `setAutoAnalyze`):**
   - Timer fires every `intervalMs` (default 10000ms)
   - Content gate: check if `transcriptEntries.length > lastAnalyzedIndex`
   - If no new content → skip silently
   - If already analyzing → skip (existing guard)

3. **Prompt assembly:**
   - Token-based sliding window: keep last ~4000 tokens of raw transcript text
   - Prepend running summary (from previous analysis) for content outside the window
   - Append "NEW (since last analysis):" section with just the new entries
   - Include previous `StructuredInsights` formatted as text for dedup
   - Combine with context from `currentContext`

4. **Post-analysis state update:**
   - Store `conversationSummary` from response as `runningSummary`
   - Store `StructuredInsights` as `previousInsights` for next batch's dedup prompt
   - Advance `lastAnalyzedIndex` to current transcript length

5. **Error handling:**
   - On API error: log, notify renderer via callback, do NOT advance cursor
   - Failed batch's new entries stay in the "new" bucket for next tick
   - No retry — next timer tick will include the accumulated text

6. **Wire in `index.ts`:**
   - In `setupSessionIPC`, when creating DeepgramService, add `onTranscript` callback that also calls `aiService.appendTranscript(entry)` (only for final entries)
   - Remove `session:transcript-text` IPC handler (no longer needed)

**Token estimation:** Reuse the simple `chars / 4` heuristic from `context-formatter.ts` for the sliding window budget.

**Dependencies:** Task 1 (needs updated types and schemas)

---

### Task 3: Update renderer for continuous insight accumulation (medium)

**Files to modify:**
- `src/renderer/hooks/useAIAnalysis.ts` — accumulate across batches
- `src/preload/index.ts` — may need new IPC event for batch vs. full analysis

**Changes:**

1. **Accumulation mode in `useAIAnalysis`:**
   - When auto-analyze is active, `analysis-complete` should MERGE new insights (append), not replace
   - Stream-chunk events already append incrementally — this is correct for continuous mode
   - On `analysis-complete` in auto mode: just update status, don't replace insights (stream-chunks already added them)
   - On manual "Analyze" button: clear all insights first, then accumulate fresh (existing behavior)

2. **Distinguish batch from manual analysis:**
   - Add a flag to `analysis-complete` event: `{ result, isBatch: boolean }`
   - `isBatch: true` → don't replace insights
   - `isBatch: false` → replace (manual full analysis)
   - Update AIService to send this flag
   - Update preload if needed for the new event shape

3. **Remove `session:transcript-text` from preload** (moved to main-process-only path)

**Dependencies:** Task 2

---

### Task 4: Tests for analysis pipeline (medium)

**Files to modify:**
- `src/test/ai-service.test.ts` — update and expand

**Test cases:**
1. `appendTranscript` accumulates entries correctly
2. Content gate: analysis skips when no new entries since last analysis
3. Content gate: analysis fires when new entries exist
4. Sliding window: old entries excluded when transcript exceeds token budget
5. Running summary: stored from analysis result and included in next batch
6. Previous insights: included in analysis request for dedup
7. Error recovery: cursor not advanced on failure, failed text included in next batch
8. Manual analyze still works (no content gate, uses full transcript)

**Dependencies:** Tasks 1-3

## Out of Scope

- Confidence-based filtering of insights (deferred)
- Configurable sliding window size in UI (hardcode ~4000 tokens for now)
- Separate summarization API call (using same call)
- Client-side fuzzy dedup (prompt-based only)
- Persistence of conversation summary across app restarts
- Rate limiting / cost controls for API calls

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Token budget overflow (context + summary + transcript + insights) | Enforce hard budget: context gets its existing budget, transcript window is capped at ~4000 tokens, summary ~500 tokens, previous insights ~1000 tokens. Total well within 128k window. |
| AI ignores dedup instructions | Acceptable for v1. Users can dismiss repeated insights. Can add client-side filtering later. |
| Summary quality degrades over long meetings | Summary is regenerated each batch, incorporating the previous summary. Quality should stay reasonable. Can tune prompt if needed. |
| Auto-analyze fires during manual analysis | Existing `analyzing` mutex prevents concurrent calls. Timer tick skips if already analyzing. |

## Specialist Feedback

- **[2026-03-22T02:56Z] review-agent → VERIFICATION-FAILED** — `.planning/feedback/001-review-agent-verification-failed.md`
- **[2026-03-22T03:01Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/002-review-agent-changes-requested.md`
