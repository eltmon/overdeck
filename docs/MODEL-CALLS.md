# Overdeck AI model call inventory

This document is a grep-verified audit of every AI model invocation in Overdeck. It lists the default model for each call site, how to configure it, whether the call is gated by a Settings toggle, and the cost-ledger tag it writes. The goal is to make expensive or hidden defaults visible at a glance.

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

These are the live, agent-spawning calls that drive plan/work/review/test/ship/flywheel. Defaults are defined in `DEFAULT_ROLES` / `DEFAULT_WORKHORSES` (`src/lib/config-yaml/roles.ts:33-68`) and resolved through `resolveModel()` (`src/lib/config-yaml/roles.ts:118`); a role agent's spawn goes through `determineModel()` (`src/lib/agents/provider-env.ts:311`), which calls `resolveModel(role, undefined, …)`.

| Call site | What it does | File:line | Default model | Configurable? (key/where) | Cost-ledger tag | In Settings? |
|---|---|---|---|---|---|---|
| `plan` role | Planning agent (xBRIEF/PRD authoring) | `src/lib/config-yaml/roles.ts:40` → `src/lib/config-yaml/roles.ts:118` | `claude-opus-4-8` | `roles.plan.model` (defaults to `workhorse:expensive`) | session cost parser tags by harness/model | Yes (Roles panel) |
| `work` role | General implementation agent | `src/lib/config-yaml/roles.ts:41` → `src/lib/config-yaml/roles.ts:118` | `claude-sonnet-5` | `roles.work.model` (defaults to `workhorse:mid`) | session cost parser tags by harness/model | Yes (Roles panel) |
| `review` role | Review parent: the whole review in `quick` mode, the synthesis of the lane findings in `full` mode. Spawned by `spawnRun(issueId, 'review')` (`src/lib/cloister/review-agent.ts:569`) | `src/lib/config-yaml/roles.ts:43` → `src/lib/config-yaml/roles.ts:118` | `claude-opus-4-8` | `roles.review.model` (defaults to `workhorse:expensive`) | session cost parser tags by harness/model | Yes (Roles panel) |
| `review.security` sub-role | Security review lane (`full` mode only) | `src/lib/config-yaml/roles.ts:46` → `src/lib/cloister/review-convoy.ts:160` | `claude-opus-4-8` | `roles.review.sub.security.model` (defaults to `workhorse:expensive`; set it to `parent` to use `roles.review.model`) | session cost parser tags by harness/model | Yes (Roles panel) |
| `review.correctness` sub-role | Logic/behavior review lane (`full` mode only) | `src/lib/config-yaml/roles.ts:47` → `src/lib/cloister/review-convoy.ts:160` | `claude-sonnet-5` | `roles.review.sub.correctness.model` (defaults to `workhorse:mid`; set it to `parent` to use `roles.review.model`) | session cost parser tags by harness/model | Yes (Roles panel) |
| `review.performance` sub-role | Performance/scalability review lane (`full` mode only) | `src/lib/config-yaml/roles.ts:48` → `src/lib/cloister/review-convoy.ts:160` | `claude-sonnet-5` | `roles.review.sub.performance.model` (defaults to `workhorse:mid`; set it to `parent` to use `roles.review.model`) | session cost parser tags by harness/model | Yes (Roles panel) |
| `review.requirements` sub-role | Acceptance-criteria / xBRIEF coverage lane (`full` mode only) | `src/lib/config-yaml/roles.ts:49` → `src/lib/cloister/review-convoy.ts:160` | `claude-sonnet-5` | `roles.review.sub.requirements.model` (defaults to `workhorse:mid`; set it to `parent` to use `roles.review.model`) | session cost parser tags by harness/model | Yes (Roles panel) |
| Review synthesis | Combines lane findings into the verdict (`full` mode). The review parent writes it, so it runs on the `review` role's model | `src/lib/cloister/review-agent.ts:569` → `src/lib/agents/provider-env.ts:311` | `claude-opus-4-8` | `roles.review.model`. `roles.review.sub.synthesis.model` (`src/lib/config-yaml/roles.ts:50`) is accepted and shown in the Roles panel, but no spawn reads it | session cost parser tags by harness/model | Yes (Roles panel, as `review`) |
| `test` role | Test/verification specialist | `src/lib/config-yaml/roles.ts:53` → `src/lib/config-yaml/roles.ts:118` | `claude-sonnet-5` | `roles.test.model` (defaults to `workhorse:mid`) | session cost parser tags by harness/model | Yes (Roles panel) |
| `ship` role | Ship/merge specialist | `src/lib/config-yaml/roles.ts:54` → `src/lib/config-yaml/roles.ts:118` | `claude-sonnet-5` | `roles.ship.model` (defaults to `workhorse:mid`) | session cost parser tags by harness/model | Yes (Roles panel) |
| `strike` role | Precision fix opened as a PR against main (skips review pipeline) | `src/lib/config-yaml/roles.ts:57` → `src/lib/config-yaml/roles.ts:118` | `claude-opus-4-8` | `roles.strike.model` (defaults to `workhorse:expensive`) | session cost parser tags by harness/model | Yes (Roles panel) |
| `flywheel` role | Fix-All Flywheel orchestrator | `src/lib/config-yaml/roles.ts:61` | `claude-opus-4-8` | `roles.flywheel.model` (hardcoded `claude-opus-4-8`, `effort: high`) | session cost parser tags by harness/model | Yes (Roles panel) |
| Remote (Fly) work agent | Work agent spawned on a Fly VM by `pan start --remote`, the dashboard start route, and `POST /api/remote/workspaces/:issueId/agent/start` | `src/lib/remote/remote-agents.ts:563` → `src/lib/agents/provider-env.ts:311` | `claude-sonnet-5` (the `work` role) | `--model` / request `model`; else `roles.work.model` through `determineModel()`. Previously fell back to a literal `claude-sonnet-4-6` when no model was passed (#4160); now it routes like a local spawn and fails loudly when routing cannot resolve | session cost parser tags by harness/model | Yes (Roles panel, as `work`) |
| Default workhorse `expensive` | Resolves `workhorse:expensive` refs | `src/lib/config-yaml/roles.ts:34` | `claude-opus-4-8` | `workhorses.expensive` | — (slot, not a call) | Yes (Roles panel) |
| Default workhorse `mid` | Resolves `workhorse:mid` refs | `src/lib/config-yaml/roles.ts:35` | `claude-sonnet-5` | `workhorses.mid` | — (slot, not a call) | Yes (Roles panel) |
| Default workhorse `cheap` | Resolves `workhorse:cheap` refs | `src/lib/config-yaml/roles.ts:36` | `claude-haiku-4-5` | `workhorses.cheap` | — (slot, not a call) | Yes (Roles panel) |

**Notes on pipeline costs:** Pipeline agents run inside Claude Code / Pi / Codex harnesses. Their spend is captured by the per-harness cost parsers (`src/lib/cost-parsers/*`) and recorded with the model id as the source, not a `background:` tag.

Operator-initiated planning through `pan plan`, dashboard planning, or `pan start` auto-planning uses the ordinary `roles.plan.model` resolution above. A fresh autonomous planning dispatch from the reactive lifecycle scheduler uses a separate, fail-closed chain: the model recorded on the current plan agent, then the legacy planning agent, then the optional scalar `roles.plan.autonomousModel`. If none resolves, the scheduler refuses the spawn and records a needs-you trip; it never falls through to `roles.plan.model` or its `workhorse:expensive` default.

---

## B. Background / silent AI calls

These are the 8 features in the canonical registry (`src/lib/background-ai/registry.ts`) plus silent calls outside the registry. Most record cost via `recordBackgroundAiCost()` (`src/lib/background-ai/cost.ts:56`) under the `background:<feature>` tag.

The Claude-backed ones spawn `claude -p` from the empty scratch cwd `${OVERDECK_HOME}/tmp/background-ai` (`backgroundAiScratchCwd()`, `src/lib/conversations/transcript-summary.ts`), so Claude Code writes a session transcript for each call under `~/.claude/projects/<encoded-scratch-cwd>/`. Those transcripts are Overdeck's own prompts, carrying verbatim excerpts of whatever conversation they were summarizing. **Conversation search excludes that project dir** (`isExcludedProjectDir()`, `src/lib/conversation-search/indexer.ts`) in the directory sweep, in the per-file path the watcher uses, and in the prune pass — otherwise search returns a machine-made shadow copy of a conversation, attributed to a session no surface can open.

| Call site | What it does | File:line | Default model | Configurable? (key/where) | Cost-ledger tag | In Settings? |
|---|---|---|---|---|---|---|
| `conversationTitles` | Auto-title a conversation from its first user message | `src/lib/conversations/transcript-summary.ts:31` | `claude-haiku-4-5-20251001` | `conversations.titleModel` (falls back to module constant) | `background:conversationTitles` | Yes (Background AI) |
| `titleRefinement` | Regenerate title after first assistant reply | `src/lib/conversations/transcript-summary.ts:230` | `claude-haiku-4-5-20251001` | Same as `conversationTitles` (`conversations.titleModel`) | `background:titleRefinement` | Yes (Background AI) |
| `conversationAbout` | Generate the "About" drawer summary | `src/lib/conversations/transcript-summary.ts:235` | `claude-haiku-4-5-20251001` | Same as titles (`conversations.titleModel`) | `background:conversationTitles` (caller omits feature override) | No dedicated toggle |
| `memoryExtraction` | Extract structured observations from agent transcripts | `src/lib/memory/providers/anthropic.ts:13` | `claude-haiku-4-5-20251001` | `memory.extraction.model`, `memory.extraction.provider`, env `OVERDECK_MEMORY_MODEL`/`OVERDECK_MEMORY_PROVIDER` | `memory-extraction` (legacy; see Gaps) | Partial (Background AI gate only) |
| `memoryQueryExpansion` | Expand memory search queries into related terms | `src/lib/memory/query-expansion.ts` (uses `extractWithProviderPolicy`) | `claude-haiku-4-5-20251001` (inherits extraction provider default) | Inherited from `memory.extraction.*` settings | `memory-extraction` (via extraction provider; see Gaps) | Partial (Background AI gate only) |
| `conversationEnrichment` L1 | Quick summary/tags for short sessions | `src/lib/model-fallback.ts:296` → `src/lib/conversations/enrichment/enrich-session.ts:331` | `claude-haiku-4-5-20251001` | `conversations.enrichment.quick_model` / normalized `quickModel` | `background:conversationEnrichment` | Yes (Background AI) |
| `conversationEnrichment` L2/L3 | Deep summary/tags for longer sessions | `src/lib/model-fallback.ts:297` → `src/lib/conversations/enrichment/enrich-session.ts:331` | `claude-sonnet-5` | `conversations.enrichment.deep_model` / normalized `deepModel` | `background:conversationEnrichment` | Yes (Background AI) |
| Provider-disabled substitute | When an enrichment model's provider is disabled, `applyFallback()` swaps in an Anthropic equivalent from `FALLBACK_MAP`; a model with no entry there (e.g. any OpenRouter `org/model`) gets this configured model | `src/lib/config-yaml/defaults.ts:58` → `src/lib/model-fallback.ts:465` (read in `src/lib/conversations/enrichment/enrich-session.ts:381`) | `claude-sonnet-5` | `models.provider_fallback_model`. Previously a private `DEFAULT_FALLBACK` literal in `model-fallback.ts` (#4160) | Recorded under the calling feature's tag (`background:conversationEnrichment`) | No |
| `sessionEmbeddings` | Embed sessions for semantic conversation search | `src/lib/conversations/embeddings/index.ts:133` | `text-embedding-3-small` (OpenAI), `voyage-code-3` (Voyage), `nomic-embed-text` (Ollama) | `conversations.embedding_provider`, `conversations.embedding_model` | `background:sessionEmbeddings` | Yes (Background AI) |
| `summaryFork` / smart compaction | Chunked transcript summary for compaction/forks | `src/lib/conversations/smart-compaction.ts:49` | `claude-haiku-4-5-20251001` | `conversations.compaction_model` | `background:summaryFork` | Yes (Background AI) |
| `summaryFork` / fork summary | One-shot fork summary when no model override given | `src/lib/conversations/summary-fork.ts:687` | `claude-sonnet-4-6` | `options.model` / `conv.model` | `background:summaryFork` (when JSON envelope has usage) | Yes (Background AI) |
| `summaryFork` / handoff author | External handoff document author | `src/lib/conversations/summary-fork.ts:223` | **None — required** | `options.handoffAuthorModel` (`--author-model`), else `conversations.handoff_author_model` (PAN-3860; previously an unconfigurable literal, `claude-sonnet-4-6`). Neither set → `pan handoff` fails loudly with `HandoffAuthorModelNotConfiguredError` instead of silently picking a model | `background:summaryFork` (when JSON envelope has usage) | Yes (Background AI) |
| `ttsSummarizer` | Narrate recent dashboard activity | `src/lib/config-yaml/defaults.ts:209` → `src/dashboard/server/services/tts-summarizer.ts:159` | `gpt-5.4-mini` | `tts.summarizer.model` | `background:ttsSummarizer` | Yes (Background AI) |
| Docs-corpus embeddings | Embed docs/skills/rules/PRDs for RAG | `src/lib/config-yaml/defaults.ts:115` → `src/lib/docs/index-builder.ts:258` | `gte-small` (local, `Xenova/gte-small`) | `docs.embedding.provider` (`local`/`openai`), `docs.embedding.model` | **None** | No |
| Conversation-search embeddings | Embed conversation JSONL chunks for Ctrl+K palette search | `src/lib/config-yaml/defaults.ts:129` → `src/lib/conversation-search/embedding-provider.ts:51` | `text-embedding-3-small` | `conversationSearch.model` | **None** (only cost estimate UI) | Yes (enabled by default; toggle in Settings → Conversation Search) |

---

## ⚠ Misconfiguration suspects

Defaults that are pricier than their job suggests, with per-1M-token cost from `src/lib/model-capabilities.ts`.

| Suspect | Default model | Cost / 1M tokens | Why it stands out | Suggested fix |
|---|---|---|---|---|
| `summaryFork` handoff author | **none — required** | n/a | PAN-3860 removed the hardcoded `claude-sonnet-4-6` fallback entirely; `pan handoff` now fails loudly if neither `--author-model` nor `conversations.handoff_author_model` is set. Whatever model the operator configures here is a deliberate cost/quality choice, not an unaudited default | Set `conversations.handoff_author_model` in `config.yaml`; `claude-haiku-4-5` (`$4.00`/1M) is cheaper than `claude-sonnet-5`/`claude-sonnet-4-6` (`$9.00`/1M) if the cheaper model produces acceptable handoff docs |
| `summaryFork` fork summary (no override) | `claude-sonnet-4-6` | `$9.00` | `generateSummaryForFork()` falls back to Sonnet when no model is passed; the chunked smart-compaction default is Haiku | Use the configured `compaction_model` or Haiku default |
| `conversationEnrichment` L2/L3 | `claude-sonnet-5` | `$9.00` | Tier-2/3 enrichment runs on every discovered session by default; only tier-1 uses Haiku (`$4.00`) | Consider Haiku for L2, reserve Sonnet for L3, or expose per-tier models |
| `flywheel` role | `claude-opus-4-8` | `$45.00` | Hardcoded Opus 4.8 for the Fix-All Flywheel orchestrator; not routed through workhorse slots | Document and gate; consider `workhorse:expensive` so users can downgrade |
| `plan` / `review` / `strike` / `review.security` | `claude-opus-4-8` | `$45.00` | Defaults to `workhorse:expensive` = Opus 4.8; intentional for precision roles but expensive | Ensure `workhorses.expensive` is deliberately set |

---

## Gaps

1. **Docs-corpus embeddings are untracked and ungated.** `buildDocsIndex()` in `src/lib/docs/index-builder.ts` runs whenever docs indexing is triggered, uses `docs.embedding.provider` / `docs.embedding.model`, and writes no cost event. It is also not exposed in dashboard Settings.

2. **Memory extraction uses a legacy cost tag.** `recordExtractionCost()` (`src/lib/memory/providers/types.ts:91`) writes `source: 'memory-extraction'` / `sessionType: 'memory-extraction'`, not `background:memoryExtraction`. This means memory extraction and memory query expansion costs do **not** roll up under the background-AI cost source and are easy to miss.

3. **Conversation-search embeddings have no cost-ledger write.** `src/lib/conversation-search/embedding-provider.ts` embeds via `@ai-sdk/openai` but the indexer only surfaces a cost estimate in the UI; actual reindex spend is not recorded in the cost ledger.

4. **`conversationAbout` shares the `conversationTitles` cost tag.** `summarizeTranscriptAbout()` calls `invokeClaudeStructured()` without overriding the feature parameter, so its spend is recorded as `background:conversationTitles` even though it is not gated by that toggle.

5. **Handoff-author cost attribution is conditional.** `authorHandoffExternal()` goes through `runModelSummary()`, which records cost only when the `claude -p --output-format json` envelope contains `result` and usage. If the model emits the doc on stdout instead of using the Write tool, the cost may not be captured.

6. **Background AI defaults are ON for most features.** `registry.ts` defaults `conversationTitles`, `titleRefinement`, `memoryExtraction`, `memoryQueryExpansion`, `conversationEnrichment`, and `summaryFork` to enabled, but the master `backgroundAi.cheapMode` default is `true` in `DEFAULT_CONFIG` (`src/lib/config-yaml/defaults.ts:146`), so out-of-the-box behavior depends on whether cheap mode is flipped off.

---

*Generated by grep audit. Every model claim should be verifiable by checking the cited `file:line`.*
