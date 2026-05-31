# PAN-1395 — Planning Decisions

> Ctrl+K palette: semantic conversation search with excerpts (Phase 2)
> Planning session 2026-05-30. **No vBRIEF or beads were created** — operator
> chose to capture decisions only. This file is the handoff to the work agent.

## The four operator decisions

| # | Decision | Choice |
| --- | --- | --- |
| 1 | **Storage & vectors** | **SQLite BLOB + brute-force cosine.** New per-message chunk table storing Float32 BLOB vectors; reuse existing `cosineSimilarity` / `topKCosine` helpers. No native dep (no sqlite-vec). |
| 2 | **Indexing trigger** | **Lazy / on first search.** Index a conversation's message chunks the first time it is searched (or via a periodic sweep). NOT an eager batch backfill at startup. Still per-message chunks, idempotent on `byteOffset`. |
| 3 | **Embed provider** | **Config-driven across openai / voyage / ollama**, OpenAI `text-embedding-3-small` as default. Reuse the existing `embed()` provider abstraction. |
| 4 | **Open-at-message** | **Deep-link + scroll to matched message.** Navigate to `/conv/:id` and scroll to the matched message via `sequence`/`byteOffset` (parser already emits both). |

## Why these matter together
- **Lazy indexing (2)** means there is no heavy startup job — the first search of a
  conversation triggers chunk + embed + store, then subsequent searches hit the
  cache. Idempotency keyed on `byteOffset` lets appended JSONL be re-indexed
  cheaply. Note this diverges from the issue body's "incremental watcher /
  batch backfill" wording — **lazy is the chosen approach**, update the spec
  accordingly when one is written.
- **Config-driven provider (3)** must NOT assume OpenAI is always available; the
  search path needs a graceful disabled/empty state when no provider/API key is
  configured.

## Existing infrastructure to REUSE (do not rebuild)
Phase 1 of the palette already shipped in this branch (commit `77e0943c5
feat(palette): unified Ctrl+K search`). `PAN-1394` is an unrelated title-button
bug, NOT Phase 1.

- **Palette UI:** `src/dashboard/frontend/src/components/CommandPalette.tsx` (uses
  `cmdk`, Ctrl/Cmd+K). Add a `Conversations` result group here.
- **Palette endpoint:** `GET /api/palette/search?q=&limit=` currently returns
  `{ memory, observations, summaries }` — extend with a `conversations` array.
  (Route module: `src/dashboard/server/routes/palette.ts`.)
- **Embedding providers:** `src/lib/conversations/embeddings/providers.ts` —
  `embed(provider, {text, model, apiKey})` → openai | voyage | ollama; L2-normalized.
- **Cosine + search composer:** `src/lib/conversations/search.ts` —
  `cosineSimilarity()`, `searchSessions()`. Vector helpers + existing
  `session_embeddings` table live in `src/lib/database/discovered-sessions-db.ts`
  (`loadEmbeddings`, `getEmbedding`, `topKCosine`) and schema in
  `src/lib/database/schema.ts`.
- **Config:** `src/lib/config-yaml.ts` / `src/lib/config.ts` already expose
  `conversations.embeddings`, `embeddingProvider`, `embeddingModel`, `apiKeys`.

## The actual gap (new work for PAN-1395)
Existing embeddings are **session-level** (one vector per conversation, built from
summary/tags via `buildEmbeddingText()`) — they **cannot** produce per-message
excerpts. PAN-1395 must add the **chunk level**:

1. **Chunker** — stream a JSONL session message-by-message (split long messages on
   ~512-token windows w/ overlap), emit `{ sessionId, role, ts, byteOffset, charLength, text }`.
   JSONL parsing already exists: `src/lib/conversations/jsonl-async.ts` and
   `parseConversationMessages()` in `src/dashboard/server/services/conversation-service.ts`
   (emits `sequence` + byte offsets).
2. **Chunk table + embeddings** — new SQLite table (BLOB Float32), lazy-populated,
   idempotent on `byteOffset`.
3. **Search** — embed query → brute-force cosine over chunk vectors → group hits by
   conversation, return excerpt with the `⦇…⦈` marker convention used by memory
   excerpts (so the frontend highlights without injecting HTML).
4. **Palette wiring** — `Conversations` group in `CommandPalette.tsx`, reuse the
   existing excerpt-segment renderer.
5. **Open-at-message** — `/conv/:id` deep-link + scroll target via `sequence`/`byteOffset`
   honored by `ConversationPanel` / `MessagesTimeline`.
6. **Settings + cost guard** — Conversation Search section (provider/model/key,
   enable toggle, last-indexed); estimate token cost and confirm if a (lazy) bulk
   index would exceed ~$1. Disabling semantic search entirely must be supported.

## Acceptance criteria (from the issue — unchanged)
- Ctrl+K phrase returns conversation hits even when exact words aren't present, with
  excerpts pointing to the matched region.
- Selecting a result opens its drawer scrolled to the matching message.
- Indexing is lazy/incremental; restarting the dashboard does not re-embed everything.
- Settings switch provider/model and can disable semantic search.
- Full-(re)index cost is shown before running.
- No regressions in Phase 1 palette groups (commands / memory / observations / issues).
