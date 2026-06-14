# Panopticon AI model call inventory

This document is a grep-verified audit of every AI model invocation in Panopticon. It lists the default model for each call site, how to configure it, whether the call is gated by a Settings toggle, and the cost-ledger tag it writes. The goal is to make expensive or hidden defaults visible at a glance.

**Legend**

- **Call site** — the subsystem or role that initiates the model call.
- **What it does** — a one-line description of the call's purpose.
- **File:line** — the exact source location for the default model or the call itself.
- **Default model** — the concrete model id used when no override is set. `workhorse:*` refs are resolved to the current default workhorse slot values.
- **Configurable?** — the config key(s) that can change the model, and any notes about indirect resolution (workhorse slots, provider fallback, etc.).
- **Cost-ledger tag** — the `source` field written to the cost event (`cost` JSONL). Calls that write no cost event are called out.
- **In Settings?** — whether the toggle/model is exposed in the dashboard Settings UI.

---

## A. Pipeline / role agents

These are the live, agent-spawning calls that drive plan/work/review/test/ship/flywheel. Defaults are defined in `src/lib/config-yaml.ts` and resolved through `resolveModel()` (`src/lib/config-yaml.ts:1576`) and `determineModel()` (`src/lib/agents.ts:2676`).

| Call site | What it does | File:line | Default model | Configurable? (key/where) | Cost-ledger tag | In Settings? |
|---|---|---|---|---|---|---|
| `plan` role | Planning agent (vBRIEF/PRD authoring) | `src/lib/config-yaml.ts:369` → `src/lib/config-yaml.ts:381` | `claude-opus-4-8` | `roles.plan.model` (defaults to `workhorse:expensive`) | session cost parser tags by harness/model | Yes (Roles panel) |
| `work` role | General implementation agent | `src/lib/config-yaml.ts:387` → `src/lib/config-yaml.ts:381` | `claude-sonnet-4-6` | `roles.work.model` (defaults to `workhorse:mid`) | session cost parser tags by harness/model | Yes (Roles panel) |
| `work.inspect` sub-role | Fast per-bead inspection | `src/lib/config-yaml.ts:393` → `src/lib/config-yaml.ts:381` | `claude-haiku-4-5` | `roles.work.sub.inspect.model` (defaults to `workhorse:cheap`) | session cost parser tags by harness/model | Yes (Roles panel) |
| `work.inspect-deep` sub-role | Deeper inspection for complex diffs | `src/lib/config-yaml.ts:394` → `src/lib/config-yaml.ts:381` | `claude-sonnet-4-6` | `roles.work.sub.inspect-deep.model` (defaults to `workhorse:mid`) | session cost parser tags by harness/model | Yes (Roles panel) |
| `review` role | Code review orchestrator | `src/lib/config-yaml.ts:399` → `src/lib/config-yaml.ts:381` | `claude-opus-4-8` | `roles.review.model` (defaults to `workhorse:expensive`) | session cost parser tags by harness/model | Yes (Roles panel) |
| `review.security` sub-role | Security-focused review | `src/lib/config-yaml.ts:401` → `src/lib/config-yaml.ts:381` | `claude-opus-4-8` | `roles.review.sub.security.model` (defaults to `workhorse:expensive`) | session cost parser tags by harness/model | Yes (Roles panel) |
| `review.correctness` sub-role | Logic/behavior review | `src/lib/config-yaml.ts:402` → `src/lib/config-yaml.ts:381` | `claude-sonnet-4-6` | `roles.review.sub.correctness.model` (defaults to `workhorse:mid`) | session cost parser tags by harness/model | Yes (Roles panel) |
| `review.performance` sub-role | Performance/scalability review | `src/lib/config-yaml.ts:403` → `src/lib/config-yaml.ts:381` | `claude-sonnet-4-6` | `roles.review.sub.performance.model` (defaults to `workhorse:mid`) | session cost parser tags by harness/model | Yes (Roles panel) |
| `review.requirements` sub-role | Acceptance-criteria / vBRIEF coverage | `src/lib/config-yaml.ts:404` → `src/lib/config-yaml.ts:381` | `claude-sonnet-4-6` | `roles.review.sub.requirements.model` (defaults to `workhorse:mid`) | session cost parser tags by harness/model | Yes (Roles panel) |
| `review.synthesis` sub-role | Combines reviewer findings into verdict | `src/lib/config-yaml.ts:405` → `src/lib/config-yaml.ts:381` | `claude-opus-4-8` | `roles.review.sub.synthesis.model` (defaults to `workhorse:expensive`) | session cost parser tags by harness/model | Yes (Roles panel) |
| `test` role | Test/verification specialist | `src/lib/config-yaml.ts:408` → `src/lib/config-yaml.ts:381` | `claude-sonnet-4-6` | `roles.test.model` (defaults to `workhorse:mid`) | session cost parser tags by harness/model | Yes (Roles panel) |
| `ship` role | Ship/merge specialist | `src/lib/config-yaml.ts:409` → `src/lib/config-yaml.ts:381` | `claude-sonnet-4-6` | `roles.ship.model` (defaults to `workhorse:mid`) | session cost parser tags by harness/model | Yes (Roles panel) |
| `strike` role | Precision merge-to-main (skips review pipeline) | `src/lib/config-yaml.ts:413` → `src/lib/config-yaml.ts:381` | `claude-opus-4-8` | `roles.strike.model` (defaults to `workhorse:expensive`) | session cost parser tags by harness/model | Yes (Roles panel) |
| `flywheel` role | Fix-All Flywheel orchestrator | `src/lib/config-yaml.ts:415` | `claude-opus-4-8` | `roles.flywheel.model` (hardcoded `claude-opus-4-8`, `effort: high`) | session cost parser tags by harness/model | Yes (Roles panel) |
| Default workhorse `expensive` | Resolves `workhorse:expensive` refs | `src/lib/config-yaml.ts:381` | `claude-opus-4-8` | `workhorses.expensive` | — (slot, not a call) | Yes (Roles panel) |
| Default workhorse `mid` | Resolves `workhorse:mid` refs | `src/lib/config-yaml.ts:382` | `claude-sonnet-4-6` | `workhorses.mid` | — (slot, not a call) | Yes (Roles panel) |
| Default workhorse `cheap` | Resolves `workhorse:cheap` refs | `src/lib/config-yaml.ts:383` | `claude-haiku-4-5` | `workhorses.cheap` | — (slot, not a call) | Yes (Roles panel) |

**Notes on pipeline costs:** Pipeline agents run inside Claude Code / Pi / Codex harnesses. Their spend is captured by the per-harness cost parsers (`src/lib/cost-parsers/*`) and recorded with the model id as the source, not a `background:` tag.

---

## B. Background / silent AI calls

These are the 8 features in the canonical registry (`src/lib/background-ai/registry.ts`) plus silent calls outside the registry. Most record cost via `recordBackgroundAiCost()` (`src/lib/background-ai/cost.ts:56`) under the `background:<feature>` tag.

| Call site | What it does | File:line | Default model | Configurable? (key/where) | Cost-ledger tag | In Settings? |
|---|---|---|---|---|---|---|
| `conversationTitles` | Auto-title a conversation from its first user message | `src/lib/conversations/transcript-summary.ts:31` | `claude-haiku-4-5-20251001` | `conversations.titleModel` (falls back to module constant) | `background:conversationTitles` | Yes (Background AI) |
| `titleRefinement` | Regenerate title after first assistant reply | `src/lib/conversations/transcript-summary.ts:230` | `claude-haiku-4-5-20251001` | Same as `conversationTitles` (`conversations.titleModel`) | `background:titleRefinement` | Yes (Background AI) |
| `conversationAbout` | Generate the "About" drawer summary | `src/lib/conversations/transcript-summary.ts:235` | `claude-haiku-4-5-20251001` | Same as titles (`conversations.titleModel`) | `background:conversationTitles` (caller omits feature override) | No dedicated toggle |
| `memoryExtraction` | Extract structured observations from agent transcripts | `src/lib/memory/providers/anthropic.ts:13` | `claude-haiku-4-5-20251001` | `memory.extraction.model`, `memory.extraction.provider`, env `PANOPTICON_MEMORY_MODEL`/`PANOPTICON_MEMORY_PROVIDER` | `memory-extraction` (legacy; see Gaps) | Partial (Background AI gate only) |
| `memoryQueryExpansion` | Expand memory search queries into related terms | `src/lib/memory/query-expansion.ts` (uses `extractWithProviderPolicy`) | `claude-haiku-4-5-20251001` (inherits extraction provider default) | Inherited from `memory.extraction.*` settings | `memory-extraction` (via extraction provider; see Gaps) | Partial (Background AI gate only) |
| `conversationEnrichment` L1 | Quick summary/tags for short sessions | `src/lib/model-fallback.ts:277` → `src/lib/conversations/enrichment/enrich-session.ts:331` | `claude-haiku-4-5-20251001` | `conversations.enrichment.quick_model` / normalized `quickModel` | `background:conversationEnrichment` | Yes (Background AI) |
| `conversationEnrichment` L2/L3 | Deep summary/tags for longer sessions | `src/lib/model-fallback.ts:278` → `src/lib/conversations/enrichment/enrich-session.ts:331` | `claude-sonnet-4-6` | `conversations.enrichment.deep_model` / normalized `deepModel` | `background:conversationEnrichment` | Yes (Background AI) |
| `sessionEmbeddings` | Embed sessions for semantic conversation search | `src/lib/conversations/embeddings/index.ts:133` | `text-embedding-3-small` (OpenAI), `voyage-code-3` (Voyage), `nomic-embed-text` (Ollama) | `conversations.embedding_provider`, `conversations.embedding_model` | `background:sessionEmbeddings` | Yes (Background AI) |
| `summaryFork` / smart compaction | Chunked transcript summary for compaction/forks | `src/lib/conversations/smart-compaction.ts:49` | `claude-haiku-4-5-20251001` | `conversations.compaction_model` | `background:summaryFork` | Yes (Background AI) |
| `summaryFork` / fork summary | One-shot fork summary when no model override given | `src/lib/conversations/summary-fork.ts:687` | `claude-sonnet-4-6` | `options.model` / `conv.model` | `background:summaryFork` (when JSON envelope has usage) | Yes (Background AI) |
| `summaryFork` / handoff author | External handoff document author | `src/lib/conversations/summary-fork.ts:185` | `claude-sonnet-4-6` | `options.handoffAuthorModel` | `background:summaryFork` (when JSON envelope has usage) | Yes (Background AI) |
| `ttsSummarizer` | Narrate recent dashboard activity | `src/lib/config-yaml.ts:1112` → `src/dashboard/server/services/tts-summarizer.ts:159` | `gpt-5.4-mini` | `tts.summarizer.model` | `background:ttsSummarizer` | Yes (Background AI) |
| Docs-corpus embeddings | Embed docs/skills/rules/PRDs for RAG | `src/lib/config-yaml.ts:1021` → `src/lib/docs/index-builder.ts:258` | `gte-small` (local, `Xenova/gte-small`) | `docs.embedding.provider` (`local`/`openai`), `docs.embedding.model` | **None** | No |
| Conversation-search embeddings | Embed conversation JSONL chunks | `src/lib/config-yaml.ts:1033` → `src/lib/conversation-search/embedding-provider.ts:51` | `text-embedding-3-small` | `conversationSearch.model` | **None** (only cost estimate UI) | Yes (disabled by default) |

---

## ⚠ Misconfiguration suspects

Defaults that are pricier than their job suggests, with per-1M-token cost from `src/lib/model-capabilities.ts`.

| Suspect | Default model | Cost / 1M tokens | Why it stands out | Suggested fix |
|---|---|---|---|---|
| `summaryFork` handoff author | `claude-sonnet-4-6` | `$9.00` | Background handoff-authoring job defaults to Sonnet; the similar compaction task uses Haiku (`$4.00`) | Default to `claude-haiku-4-5` or `claude-haiku-4-5-20251001` unless user overrides |
| `summaryFork` fork summary (no override) | `claude-sonnet-4-6` | `$9.00` | `generateSummaryForFork()` falls back to Sonnet when no model is passed; the chunked smart-compaction default is Haiku | Use the configured `compaction_model` or Haiku default |
| `conversationEnrichment` L2/L3 | `claude-sonnet-4-6` | `$9.00` | Tier-2/3 enrichment runs on every discovered session by default; only tier-1 uses Haiku (`$4.00`) | Consider Haiku for L2, reserve Sonnet for L3, or expose per-tier models |
| `flywheel` role | `claude-opus-4-8` | `$45.00` | Hardcoded Opus 4.8 for the Fix-All Flywheel orchestrator; not routed through workhorse slots | Document and gate; consider `workhorse:expensive` so users can downgrade |
| `plan` / `review` / `strike` / `review.synthesis` | `claude-opus-4-8` | `$45.00` | Defaults to `workhorse:expensive` = Opus 4.8; intentional for precision roles but expensive | Ensure `workhorses.expensive` is deliberately set |

---

## Gaps

1. **Docs-corpus embeddings are untracked and ungated.** `buildDocsIndex()` in `src/lib/docs/index-builder.ts` runs whenever docs indexing is triggered, uses `docs.embedding.provider` / `docs.embedding.model`, and writes no cost event. It is also not exposed in dashboard Settings.

2. **Memory extraction uses a legacy cost tag.** `recordExtractionCost()` (`src/lib/memory/providers/types.ts:91`) writes `source: 'memory-extraction'` / `sessionType: 'memory-extraction'`, not `background:memoryExtraction`. This means memory extraction and memory query expansion costs do **not** roll up under the background-AI cost source and are easy to miss.

3. **Conversation-search embeddings have no cost-ledger write.** `src/lib/conversation-search/embedding-provider.ts` embeds via `@ai-sdk/openai` but the indexer only surfaces a cost estimate in the UI; actual reindex spend is not recorded in the cost ledger.

4. **`conversationAbout` shares the `conversationTitles` cost tag.** `summarizeTranscriptAbout()` calls `invokeClaudeStructured()` without overriding the feature parameter, so its spend is recorded as `background:conversationTitles` even though it is not gated by that toggle.

5. **Handoff-author cost attribution is conditional.** `authorHandoffExternal()` goes through `runModelSummary()`, which records cost only when the `claude -p --output-format json` envelope contains `result` and usage. If the model emits the doc on stdout instead of using the Write tool, the cost may not be captured.

6. **Background AI defaults are ON for most features.** `registry.ts` defaults `conversationTitles`, `titleRefinement`, `memoryExtraction`, `memoryQueryExpansion`, `conversationEnrichment`, and `summaryFork` to enabled, but the master `backgroundAi.cheapMode` default is `true` in `DEFAULT_CONFIG` (`src/lib/config-yaml.ts:1044`), so out-of-the-box behavior depends on whether cheap mode is flipped off.

---

*Generated by grep audit. Every model claim should be verifiable by checking the cited `file:line`.*
