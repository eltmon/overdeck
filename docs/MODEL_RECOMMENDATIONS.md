# Panopticon Model Recommendations

**Last updated: 2026-05-23.** Previous revision was 2026-04-20 — see "Stale from prior version" below for the diff.

This doc recommends models for each Panopticon agent role and documents the pricing and benchmark data the recommendations are derived from. Every figure carries a confidence label (**H**igh / **M**edium / **L**ow) and the URL it came from. **UNVERIFIED** means we searched and could not find a credible source — we do not substitute plausible guesses for those.

## Summary

| Role | Default model | Why | Alt (cost-down) |
|---|---|---|---|
| `plan` (exploration + planning) | **claude-opus-4-7** | 87.6% SWE-Bench Verified, 1M ctx, mature tool-use stack | gemini-3.1-pro-preview |
| `work` (implementation + testing) | **claude-sonnet-4-6** | 79.6% SWE-Bench Verified, 1M ctx beta, 1/5 the cost of Opus | minimax-m2.7, kimi-k2.6 |
| `review.security` | **claude-opus-4-7** | Safety-critical; tool-use schema reliability matters most here | — |
| `review.{correctness,performance,requirements}` | **claude-sonnet-4-6** | Near-Opus quality on practical review tasks at 1/5 cost | gemini-3.1-pro-preview |
| `test` | **claude-sonnet-4-6** | Test generation needs strong reasoning, not bleeding-edge | gemini-3-flash-preview |
| `ship` (rebase/verify/push) | **claude-haiku-4-5** | Fast, cheap, low-risk; structured tool-use stack is mature | gemini-3-flash-preview |
| `subagent:explore` + `subagent:bash` | **claude-haiku-4-5** | Speed-critical scanning, 73.3% SWE-Bench is plenty | gemini-3-flash-preview, glm-4.7-flash |
| Orchestrator (flywheel inventory, ranked suggestions) | **gemini-3-flash-preview** | High-frequency, mid-complexity, JSON-shaped output — best quality/$ | minimax-m2.7, claude-haiku-4-5 |
| CLI quick commands | **claude-haiku-4-5** | Speed > quality for these | — |

## Stale from prior version (2026-04-20)

Mark the following as wrong or outdated:

- **Claude family generation:** the old doc recommended `claude-opus-4-6` and `claude-sonnet-4-5`. **Replaced** with `claude-opus-4-7` (released 2026-02, 87.6% SWE-Bench Verified, 1M ctx) and `claude-sonnet-4-6` (79.6% SWE-Bench Verified, 1M ctx beta).
- **Pricing table:** Opus listed at $5/$25 was for Opus 4.6 — pricing held flat at $5/$25 for 4.7 per Anthropic's pricing page, but the new 4.7 tokenizer can emit ~35% more tokens for the same text, so effective per-request cost rises (source: finout.io).
- **"Sonnet 4.5 with parallel attempts 82% SWE-Bench"** — that figure is Sonnet 4.5 specifically, not 4.6. Sonnet 4.6 single-run is 79.6% per multiple sources; the parallel-attempts methodology was not separately reproduced for 4.6 in published data.
- **"GPT-4o ~68%"** and **"Kimi K2 ~65%"** SWE-Bench rows — both superseded. GPT-5.5 (2026-04-23) reports 88.7% SWE-Bench Verified. Kimi K2.6 (2026-04-20) reports 80.2%.
- **"Gemini 2.5 Pro 63.2%"** — superseded by Gemini 3.1 Pro Preview at 80.6% SWE-Bench Verified.
- **Speed rankings** (Gemini 2.0 Flash, GLM-4 Flash) — outdated. Use Gemini 3 Flash Preview, GLM-4.7 Flash, or MiniMax M2.7 Highspeed as the new fast-tier references; no current published latency benchmark covers the 2026 fleet uniformly, so we don't rank them numerically here.
- **Monthly cost estimates** — kept as a rough order-of-magnitude only. Actual cost moved with new tokenizers, prompt caching defaults, and the broader provider mix.
- **Sources list** — the 2025-era articles linked at the bottom are largely superseded; updated source URLs are inline per row in the per-model tables below.
- **OpenAI catalog (2026-05-23 addendum, PAN-1122):** trimmed to match the Codex CLI published list. Kept: `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.3-codex`, `gpt-5.3-codex-spark`, `gpt-5.2`. Dropped: `gpt-5.5-pro`, `gpt-5.4-pro`, `gpt-5.5-mini`, `gpt-5.5-nano`, `gpt-5.4-nano`, `o3`, `o4-mini`, `gpt-4o`, `gpt-4o-mini`. Saved configs referencing dropped IDs are migrated by `MODEL_DEPRECATIONS` in `src/lib/model-capabilities.ts` and warned at settings-load. `gpt-5.5-pro` is OUT of consideration for any role going forward.
- **Sonnet 4.6 + Opus 4.7 capability notes already current.** No further Claude family changes in this revision.

## Performance benchmarks — what's verified

Confidence column: **H** = vendor page + ≥1 corroborating source. **M** = single reputable secondary source. **—** = UNVERIFIED.

### SWE-Bench Verified

| Model | Score | Confidence | Source |
|---|---|---|---|
| gpt-5.5 | 88.7% | H | openai.com/index/introducing-gpt-5-5, tokenmix |
| claude-opus-4-7 | 87.6% | H | vellum.ai, anthropic news |
| gpt-5.3-codex | 85.0% | M | marc0.dev/en/leaderboard (May 2026) |
| gemini-3.1-pro-preview | 80.6% | H | smartchunks.com, vellum.ai |
| kimi-k2.6 | 80.2% | H | benchlm.ai, automatio.ai |
| gpt-5.2 | 80.0% (Thinking) | H | vellum.ai/blog/gpt-5-2-benchmarks, marc0.dev |
| claude-sonnet-4-6 | 79.6% | H | digitalapplied.com, nxcode.io, rootly.com |
| mimo-v2.5-pro | 78.9% | M | buildfastwithai |
| gemini-3-flash-preview | 78% | H | blog.google flash announcement |
| minimax-m2.7 | 78% | M | thomas-wiegold.com, wavespeed.ai |
| claude-haiku-4-5 | 73.3% | H | llm-stats, medium leucopsis |
| glm-4.7-flash | 59.2% | M | deepinfra |
| gpt-5.3-codex-spark | — | — | research preview; benchmark "coming soon" per benchlm.ai |
| gpt-5.4 | — | — | not separately published |
| gpt-5.4-mini | — | — | SWE-Bench Pro 54.4% reported, Verified not split out |
| gemini-3.1-flash-lite-preview | — | — | not separately published |
| glm-5.1 | — | — | SWE-Bench Pro 58.4% (SOTA), Verified not separately published |
| minimax-m2.7-highspeed | — | — | shares weights with base, no separate eval |

### GPQA-Diamond

| Model | Score | Confidence | Source |
|---|---|---|---|
| gemini-3.1-pro-preview | 94.3% | H | DeepMind model card |
| claude-opus-4-7 | 94.2% | H | vellum.ai, anthropic announcement |
| gpt-5.2 | 92.4% (Thinking) | H | vellum.ai |
| gemini-3-flash-preview | 90.4% | H | blog.google flash announcement |
| kimi-k2.6 | 90.5% | H | benchlm.ai |
| minimax-m2.7 | 87.4% | M | wavespeed.ai |
| gemini-3.1-flash-lite-preview | 86.9% | M | benchlm.ai, layerlens.ai |
| glm-5.1 | 86.2% | M | benchlm.ai |
| glm-4.7-flash | 75.2% | M | deepinfra |
| claude-sonnet-4-6 | 74.1% | M | digitalapplied.com |
| mimo-v2.5-pro | 66.7% | M | buildfastwithai |
| claude-haiku-4-5 | — | — | "middling" per vals.ai, no exact score |
| gpt-5.5 | — | — | not separately published |
| gpt-5.4 | — | — | not separately published |
| gpt-5.4-mini | — | — | conflicting secondary numbers, none confirmed |
| gpt-5.3-codex | — | — | pricepertoken lists "GPQA 91.5" but does not clarify Diamond subset |
| gpt-5.3-codex-spark | — | — | no published score (research preview) |
| minimax-m2.7-highspeed | — | — | no separate eval |

### MMLU-Pro

| Model | Score | Confidence | Source |
|---|---|---|---|
| gemini-3.1-pro-preview | 90.99% | H | vals.ai leaderboard |
| claude-opus-4-7 | 89.87% | M | llm-stats.com / vellum aggregation |
| kimi-k2.6 | 84.6% | M | kimi-k2.org analysis |
| gemini-3.1-flash-lite-preview | 83.0% | M | benchlm.ai, layerlens.ai |
| claude-haiku-4-5 | 76.8% | M | llm-stats.com |
| All others | — | — | not separately published |

### Aider Polyglot

Only two 2026 models have a third-party Aider Polyglot number we could verify. The aider.chat leaderboard itself hasn't been refreshed past the GPT-5 baseline (88.0%).

| Model | Score | Confidence | Source |
|---|---|---|---|
| claude-opus-4-7 | 87.6% | M | vellum.ai best-llm-for-coding (2026-03-23) |
| gemini-3.1-pro-preview | 68.3% | M | aimagicx.com roundup |
| All others | — | — | not on current leaderboard |

### HumanEval+ — UNVERIFIED across the board

Multiple sources note frontier scores are saturated at 94-95% on plain HumanEval and `+`-variant numbers are not being published model-by-model anymore. Treat HumanEval+ as not actionable for current model selection.

### Berkeley Function-Calling Leaderboard (BFCL)

**UNVERIFIED for every 2026 model in this list.** The Gorilla leaderboard has not been refreshed with the 2026 fleet. Older snapshots: GLM 4.5 led BFCL v3 at 76.7%; Sonnet 4.5 family showed strong tool-use. Do not extrapolate from those to 4.6/4.7/3.x/5.x.

### Structured-output (JSON-mode) reliability — UNVERIFIED

No public JSONSchemaBench results for any 2026 model. Vendor claims only:

- **Anthropic** — Tool-use JSON Schema with strict mode; mature ecosystem.
- **OpenAI (GPT-5.x)** — Strict structured outputs (`response_format: json_schema`); function-calling guaranteed-schema mode.
- **Google (Gemini 3.x)** — Native `response_schema` with enums; the JSONSchemaBench paper noted Gemini had gaps on complex schemas in older versions.
- **Moonshot, Zhipu, MiniMax, Xiaomi MiMo** — OpenAI-compatible JSON mode / tool calling; vendor-claimed only.

For Panopticon's flywheel orchestrator (which depends on schema-clean output), we recommend the verified-strict-mode providers — Anthropic, OpenAI, Google — over the OpenAI-compatible non-strict vendors until third-party JSON evals exist.

### Effective context (RULER / NIAH long-context retrieval) — UNVERIFIED across the board

No vendor publishes effective-context retrieval scores for the 2026 fleet. Third-party RULER runs for these specific model versions weren't found within the research window. Advertised context windows are listed in the per-model tables; treat any "effective context is X%" claim as unverified.

## Cost — verified pricing per 1M tokens (USD)

| Model | Input | Output | Cached / batch notes |
|---|---|---|---|
| claude-opus-4-7 | $5.00 | $25.00 | 50% batch; 90% cache reads; 1-hr cache write 2x |
| claude-sonnet-4-6 | $3.00 | $15.00 | 50% batch; 90% cache reads |
| claude-haiku-4-5 | $1.00 | $5.00 | 50% batch; 90% cache reads |
| gpt-5.5 | $5.00 | $30.00 | 50% batch/flex; cached input $0.50; Priority 2.5x; >272k input 2x in / 1.5x out |
| gpt-5.4 | UNVERIFIED | UNVERIFIED | Vendor pricing page didn't separate gpt-5.4 base from the family in retrievable excerpts |
| gpt-5.4-mini | $0.75 | $4.50 | Cached input $0.075 (90% off); batch discount likely but not separately quoted |
| gpt-5.3-codex | $1.75 | $14.00 | Cached input $0.175 (90% off); Priority 2.5x ($3.50/$28.00); batch UNVERIFIED |
| gpt-5.3-codex-spark | n/a (API) | n/a (API) | ChatGPT-Pro-only research preview; routed via Codex CLI subscription auth through CLIProxy, not raw API. Headline rate card matches the family when reachable. |
| gpt-5.2 | $1.75 | $14.00 | Cached input $0.175 (90% off); batch UNVERIFIED |
| gemini-3.1-pro-preview | $2.00 (≤200k) / $4.00 (>200k) | $12.00 / $18.00 | 50% batch; context cache $0.20/1M ≤200k |
| gemini-3-flash-preview | $0.50 | $3.00 | 50% batch; context caching available |
| gemini-3.1-flash-lite-preview | $0.25 | $1.50 | 50% batch; context cache; flat across thinking levels |
| kimi-k2.6 | $0.60 (Moonshot direct) / $0.95 (OpenRouter) | $2.50 / $4.00 | Cached input $0.16/1M (~83% off) |
| glm-5.1 | $0.98 (Z.ai direct) / $1.40 (Puter) | $3.08 / $4.40 | Cached rate UNVERIFIED |
| glm-4.7-flash | $0.06 | $0.40 | Free tier for registered users; cached rate UNVERIFIED |
| minimax-m2.7 | $0.28 | $1.20 | Auto-cache reads $0.06/1M (no config needed) |
| minimax-m2.7-highspeed | $0.60 | $2.40 | Cached rate UNVERIFIED |
| mimo-v2.5-pro | $1.00 (Xiaomi direct) / $0.80 (GMI) | $3.00 | Cached rate UNVERIFIED |

## Context windows — advertised

| Model | Window | Max output |
|---|---|---|
| claude-opus-4-7 | 1,000,000 | 128,000 |
| claude-sonnet-4-6 | 1,000,000 (1M beta) | — |
| claude-haiku-4-5 | 200,000 | — |
| gpt-5.5 | 1,050,000 | 128,000 |
| gpt-5.4 | 1,050,000 | 128,000 |
| gpt-5.4-mini | 400,000 | 128,000 |
| gpt-5.3-codex | 400,000 | UNVERIFIED |
| gpt-5.3-codex-spark | 128,000 | UNVERIFIED |
| gpt-5.2 | 400,000 | 128,000 |
| gemini-3.1-pro-preview | 1,000,000 | — |
| gemini-3-flash-preview | 1,000,000 | — |
| gemini-3.1-flash-lite-preview | 1,048,576 | 64,000 |
| kimi-k2.6 | 256,000 | — |
| glm-5.1 | 203,000 | — |
| glm-4.7-flash | 202,752 | 16,384 |
| minimax-m2.7 | 205,000 | — |
| minimax-m2.7-highspeed | 205,000 | 131,000 |
| mimo-v2.5-pro | 1,000,000 | — |

**Effective context (the point where retrieval accuracy degrades) is UNVERIFIED for every model in this list.** Vendors don't publish it; third-party RULER runs for these specific versions weren't found. Default to <128k of meaningful context-window utilization when the workload depends on retrieval accuracy.

## Detailed role recommendations

### `plan` (exploration + planning)
**claude-opus-4-7.** Architectural decisions, multi-system impact, security-relevant choices. Opus 4.7's 87.6% SWE-Bench Verified and 94.2% GPQA-Diamond make it the most reliable for plans that downstream agents will execute without re-litigation. The 1M context window matters when the planner has to read large existing codebases. Cost ($5/$25) is justified because planning is a small fraction of total tokens and a bad plan costs more downstream than the price difference.

**Alternative:** `gemini-3.1-pro-preview` ($2/$12, 1M ctx, 80.6% SWE-Bench, 94.3% GPQA) when budget is the binding constraint and the project doesn't carry sensitive security or data-handling decisions. Native JSON schema mode is strong but JSONSchemaBench results UNVERIFIED.

### `work` (implementation + testing)
**claude-sonnet-4-6.** 79.6% SWE-Bench Verified single-run; near-Opus on practical enterprise tasks at 1/5 the cost. Default model for the implementation pipeline. The 1M ctx beta lets it carry the whole spec + relevant code without trimming.

**Alternatives:**
- `gpt-5.3-codex` ($1.75/$14.00, 400k ctx, 85.0% SWE-Bench Verified) — coding-optimized OpenAI flagship. Strong default when the operator wants ChatGPT subscription auth via Codex CLI / CLIProxy instead of an Anthropic key. Higher per-token output cost than Sonnet 4.6 but the cached-input rate ($0.175/1M, 90% off) makes long-running implementation loops competitive.
- `minimax-m2.7` ($0.28/$1.20, 78% SWE-Bench Verified, 87.4% GPQA, auto-cache $0.06/1M) — cheapest verified high-quality coder. Best for high-volume work where cache reuse dominates cost. Tradeoff: smaller (205k) context; OpenAI-compatible JSON mode but no third-party reliability eval.
- `kimi-k2.6` ($0.60/$2.50, 80.2% SWE-Bench Verified, 256k ctx) — strong middle ground. Open-weight with native INT4; agent-swarm primitive built in.

#### `work.inspect` (high-volume code scanning, follow-up issue)
**`gpt-5.3-codex-spark`** — ultra-fast (1000+ tok/sec) coding variant. ChatGPT-Pro-only research preview, no raw API; reachable through Codex CLI subscription auth via CLIProxy when a Pro account is configured. Right shape for short, code-touching scans that benefit from very low TTFT. The `work.inspect` sub-role itself is not yet implemented — see the follow-up issue for the work.* subtype taxonomy.

### `review.security`
**claude-opus-4-7.** Don't compromise here. Mature tool-use schema, best published reliability profile, highest GPQA. Security bugs are 10-100x more expensive to fix later than the model spend on review.

### `review.correctness` / `review.performance` / `review.requirements`
**claude-sonnet-4-6.** Quality bar met by a Sonnet-class model on practical review tasks. Same reasoning as `work`: cost-effective without giving up reliability.

### `test`
**claude-sonnet-4-6.** Test generation needs careful edge-case reasoning, not absolute frontier capability. Sonnet has the right balance.

**Alternative:** `gemini-3-flash-preview` ($0.50/$3.00, 78% SWE-Bench) — viable for high-volume test generation where reliability bar is "tests compile and pass" rather than "tests catch subtle edge cases."

### `ship` (rebase + verify + push)
**claude-haiku-4-5.** Mechanical workflow that benefits from a fast, cheap, reliable model with mature tool-use. The decisions are small (resolve a conflict, decide whether to retry CI) — Haiku is right-sized.

### `subagent:explore` and `subagent:bash`
**claude-haiku-4-5.** Speed-critical scanning. 73.3% SWE-Bench is plenty for "find me the file that defines X." 2x faster than Sonnet, 1/3 the cost.

**Alternative:** `glm-4.7-flash` ($0.06/$0.40) — when you want to push the cost floor lower and the task is dominated by I/O (large `ls`/`grep`/`find` sweeps).

### Flywheel orchestrator (continuously inventory issues, diagnose pipeline state, emit ranked JSON suggestions)

The Panopticon flywheel is high-frequency, stateless, schema-strict, and cost-sensitive. Per-poll work is: read N open issues, classify, rank, emit JSON. It is **not** a long-running agent workflow — each invocation is bounded.

**Top 3** ranked by `(quality × speed) / cost`, restricted to models with verified pricing AND verified core benchmarks:

1. **gemini-3-flash-preview** — $0.50/$3.00, 1M ctx, SWE-Bench 78%, GPQA 90.4%. Best quality-per-dollar for a high-frequency loop. Native JSON schema mode (`response_schema` with enums). Lowest latency in the top tier.
2. **minimax-m2.7** — $0.28/$1.20, 205k ctx, SWE-Bench 78%, GPQA 87.4%. Cheapest verified high-quality option. Auto-cache at $0.06/1M makes the per-loop cost of re-feeding issue state nearly free. Tradeoff: non-US vendor with shallower docs; OpenAI-compatible JSON mode with UNVERIFIED strict-schema reliability.
3. **claude-haiku-4-5** — $1.00/$5.00, 200k ctx, SWE-Bench 73.3%. More expensive than the other two, but with the most mature tool-use / structured-output stack and lowest tail-risk on schema adherence. Worth the premium when the flywheel is the single point of decision for downstream agents.

#### Why not `gpt-5.2` (the addendum specifically asked)

**Verdict: overkill for the flywheel as currently scoped.** Reasoning:

- **Cost:** $1.75 in / $14.00 out per 1M tokens — 5-50x the per-call cost of Flash/Haiku/MiniMax. Even with 90% cache-read discount on input, the output side dominates a polling workload that emits N ranked suggestions per call.
- **Latency:** 0.70s median TTFT, 64 tok/sec — middling. Flash/Haiku-tier models routinely hit <300ms TTFT and 150+ tok/sec.
- **Structured output:** standard OpenAI strict mode. No advantage over Anthropic / Google strict modes that Haiku and Flash already have.
- **"Long-running agents" positioning:** real, but mis-targeted at this workload. OpenAI sells gpt-5.2 on multi-step tool-use chains and stateful "deep deliberation" — which a stateless polling loop emitting bounded JSON is not. The value prop doesn't apply.
- **Where gpt-5.2 *would* be correct:** if the flywheel evolves into a stateful orchestrator that owns multi-step debugging sessions across many tool calls per invocation (e.g. autonomously triaging a failing PR end-to-end, calling git, ci, and test tools in sequence within a single agent loop), revisit gpt-5.2 then. Today it is the wrong instrument for the job.

**Excluded from the top 3:** `claude-opus-4-7` is too expensive for continuous polling; `gpt-5.5-pro` is dropped from the catalog regardless; `gemini-3.1-pro-preview` is strong but ~4x the cost of flash-preview with proportional quality gain only on hard tasks; `mimo-v2.5-pro` has the right price but GPQA 66.7% is well below the others; `kimi-k2.6` and `glm-5.1` are competitive but have UNVERIFIED structured-output reliability — risky for a role that emits JSON consumed by the dashboard.

## Cost distribution (approximate)

These are order-of-magnitude planning numbers, not contracts. Actual cost depends on prompt caching hit rate, batch usage, and per-role traffic distribution.

| Tier | Share | Models | Use cases |
|---|---|---|---|
| Premium | ~5% | claude-opus-4-7 | Planning, security review |
| Workhorse | ~35% | claude-sonnet-4-6 | Implementation, test, non-security review |
| Volume | ~60% | claude-haiku-4-5, gemini-3-flash-preview, minimax-m2.7, glm-4.7-flash | Subagents, ship, orchestrator, CLI |

## Optimization strategies

### 1. Prompt caching
Anthropic and Google both offer 90% cache-read discounts; MiniMax auto-caches at $0.06/1M with no config. The flywheel orchestrator, planning runs that re-load the same vBRIEF, and review agents that re-read the same diff are all near-ideal cache candidates.

### 2. Batch processing
50% off for non-urgent work across most vendors. Documentation generation, bulk test generation, and overnight review batches are obvious fits.

### 3. Cascade
Fast/cheap pass first, escalate to Sonnet/Opus on flagged items. Haiku for the initial code-review scan; Opus only on subagent-flagged files.

### 4. Parallel verification on critical decisions
Run Opus and Sonnet in parallel on security review or merge-conflict resolution and only ship when both agree (or escalate to a human when they disagree).

## What's UNVERIFIED — read before relying on this doc

Highlights of what we searched for and could not verify within the research window:

- **Effective context (RULER / NIAH)** — UNVERIFIED for every model.
- **HumanEval+** — UNVERIFIED for every model (frontier saturated, vendors stopped publishing).
- **BFCL v3/v4** — UNVERIFIED for every 2026 model (leaderboard not refreshed).
- **JSONSchemaBench** — UNVERIFIED for every 2026 model.
- **Per-model pricing variance** — kimi-k2.6, glm-5.1, mimo-v2.5-pro have different prices between vendor-direct and OpenRouter / GMI / Puter providers. We list both. Check the route you're actually using.
- **gpt-5.4-mini and gemini-3.1-flash-lite-preview** SWE-Bench Verified — UNVERIFIED.
- **minimax-m2.7-highspeed** benchmarks — UNVERIFIED (assumed same as base but not separately evaluated).

When this doc says **UNVERIFIED**, do not treat the absence as "probably the same as the prior generation." Re-verify before committing the org to that model for a critical role.

## Sources

Per-row sources are inline in the tables above. Primary vendor pricing pages:

- Anthropic: [anthropic.com/pricing](https://www.anthropic.com/pricing)
- OpenAI: [openai.com/pricing](https://openai.com/pricing) / [developers.openai.com](https://developers.openai.com)
- Google: [ai.google.dev/gemini-api/docs/pricing](https://ai.google.dev/gemini-api/docs/pricing)
- Moonshot: [platform.moonshot.ai](https://platform.moonshot.ai)
- Zhipu: [docs.z.ai](https://docs.z.ai), [docs.bigmodel.cn](https://docs.bigmodel.cn)
- MiniMax: [platform.minimax.io](https://platform.minimax.io)
- Xiaomi MiMo: [platform.xiaomimimo.com](https://platform.xiaomimimo.com)

Benchmark aggregators referenced:

- [vellum.ai best-llm-for-coding leaderboard](https://www.vellum.ai/llm-leaderboard)
- [vals.ai MMLU-Pro leaderboard](https://www.vals.ai)
- [llm-stats.com](https://llm-stats.com)
- [aider.chat/docs/leaderboards](https://aider.chat/docs/leaderboards) — not refreshed past GPT-5 baseline
- [gorilla.cs.berkeley.edu/leaderboard](https://gorilla.cs.berkeley.edu/leaderboard) — not refreshed past Sonnet 4.5 family
- [benchlm.ai](https://benchlm.ai), [smartchunks.com](https://smartchunks.com), [artificialanalysis.ai](https://artificialanalysis.ai)
