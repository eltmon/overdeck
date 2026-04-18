# Claude Haiku 4.5 Work Type Fit Analysis

Research date: 2026-04-17

Evaluates Anthropic's Claude Haiku 4.5 against Panopticon's 23 work types. Haiku 4.5 is Panopticon's current default for lightweight subagent and CLI work — the fastest and cheapest Claude model.

## Model Profile

| Spec | Value |
|------|-------|
| **Vendor** | Anthropic |
| **Release** | 2025-10-15 |
| **Model ID** | `claude-haiku-4-5-20251001` |
| **Architecture** | Undisclosed parameter count |
| **Context Window** | 200K tokens |
| **Max Output** | 64K tokens |
| **Knowledge Cutoff** | July 1, 2025 |
| **Modalities** | Text + Image input; Text output |
| **Reasoning** | Extended Thinking supported |
| **Pricing (input)** | $1.00/M |
| **Pricing (output)** | $5.00/M |
| **Batch API** | 50% off ($1.00/$2.50) |
| **Cache hit** | $0.10/M (90% discount) |
| **Speed** | ~92 tok/s (#11/67 on Artificial Analysis) |
| **TTFT** | ~0.80s |

**Cost comparison:**
- vs Sonnet 4.6 ($3/$15): **3x cheaper input, 3x cheaper output**
- vs GPT-5.4 Nano ($0.20/$1.25): **5x more expensive input, 4x more expensive output**
- vs GPT-5.4 Mini ($0.75/$4.50): **1.33x more expensive input, 1.11x more expensive output**
- vs Gemini Flash-Lite ($0.25/$1.50): **4x more expensive input, 3.3x more expensive output**
- vs Gemini 3 Flash ($0.50/$3): **2x more expensive input, 1.67x more expensive output**

**Key:** Haiku 4.5 is no longer the budget leader. GPT-5.4 Nano and Gemini Flash-Lite are 4-5x cheaper with comparable or better benchmarks.

## Key Benchmarks

| Benchmark | Haiku 4.5 | GPT-5.4 Nano | GPT-5.4 Mini | Gemini Flash-Lite |
|-----------|-----------|-------------|-------------|-------------------|
| SWE-Bench Verified | **73.3%** | -- | -- | -- |
| SWE-Bench Pro | 39.5% | **52.4%** | **54.4%** | -- |
| GPQA Diamond | ~73% | 82.8% | **88.0%** | **86.9%** |
| Computer Use | **50.7%** | 39.0% (OSWorld) | 72.1% (OSWorld) | -- |
| AA Intelligence Index | 31/100 | **44/100** | -- | 34/100 |
| Speed (tok/s) | 92.0 | 155.9 | -- | **381.9** |
| Context Window | 200K | **400K** | **400K** | **1M** |

**The uncomfortable truth:** GPT-5.4 Nano is smarter (Index 44 vs 31), faster (155.9 vs 92 tok/s), cheaper (5x input, 4x output), has 2x the context window, and scores higher on GPQA Diamond (82.8% vs ~73%) and SWE-Bench Pro (52.4% vs 39.5%). Haiku 4.5's remaining advantages are SWE-Bench Verified (73.3% — strong), computer use (50.7%), and Anthropic ecosystem integration.

## Standout Capabilities

1. **SWE-Bench Verified 73.3%** — Exceptional for its price tier. On par with Sonnet 4.0, beats GPT-5.1. This is Haiku's strongest benchmark.
2. **Computer use** — 50.7% beats Sonnet 4.0 (42.2%). Only GPT-5.4 Mini (72.1%) significantly exceeds it in this class.
3. **Speed** — 92 tok/s with 0.80s TTFT. Fast enough for interactive use.
4. **Extended Thinking** — Supports thinking mode, which significantly boosts coding and reasoning.
5. **Context awareness** — Built-in token tracking; proactively shortens outputs as context fills.
6. **Anthropic ecosystem** — Native Claude Code compatibility, prompt caching, consistent API.
7. **Agentic coding** — Described as ~90% of Sonnet 4.5's agentic coding capability at a fraction of the cost.
8. **Batch pricing** — $1.00/$2.50 batch pricing is competitive for bulk operations.

## Known Weaknesses

1. **Budget tier displacement** — GPT-5.4 Nano is 5x cheaper with better benchmarks on most dimensions. Haiku is no longer the cost-effective choice for most tasks.
2. **Context window** — 200K is half of Nano's 400K and 1/5 of Flash-Lite's 1M. Limits full-codebase ingestion.
3. **GPQA Diamond ~73%** — Middling reasoning. Well below Nano (82.8%), let alone frontier models (91%+).
4. **Intelligence Index 31** — Ranked #19/67. "Above average" but not exceptional.
5. **SWE-Bench Pro 39.5%** — Significant gap to Nano (52.4%) on the hardest coding benchmark. Haiku struggles with complex multi-step coding.
6. **Price increase** — 25% more expensive than Haiku 3.5 ($0.80/$4.00), narrowing the cost advantage.
7. **Verbosity** — 8.3M output tokens in evals vs 7.2M median. Tends to over-generate.
8. **Knowledge cutoff** — July 2025 is the oldest of any model in Panopticon's roster.

---

## Work Type Fit Assessment

### The Fading Default

Haiku 4.5 has been Panopticon's lightweight workhorse since launch. But the budget tier has evolved dramatically — GPT-5.4 Nano, Gemini Flash-Lite, and Gemini 3 Flash all offer better value propositions. Haiku 4.5 remains a safe, proven choice within the Anthropic ecosystem, but it's no longer the obvious default for any work type.

### Good Fit (Current Defaults)

#### `cli:quick-command`
**Current default:** Claude Haiku 4.5 | **Fit:** Good

Quick commands need speed (92 tok/s, 0.80s TTFT) and low cost ($1/$5). Haiku delivers both.

**Alternative:** GPT-5.4 Nano at $0.20/$1.25 (5x cheaper) with 155.9 tok/s (1.7x faster) and 0.48s TTFT (1.7x faster). Nano is objectively better on every dimension for quick commands.

#### `subagent:explore`
**Current default:** Claude Haiku 4.5 | **Fit:** Moderate

Fast scanning with decent code comprehension (SWE-Bench Verified 73.3%). But 200K context limits how much code can be ingested per pass.

**Alternative:** GPT-5.4 Nano with 400K context (2x more), or Gemini 3 Flash with 1M context at $0.50/$3 and significantly stronger intelligence (Index 71 vs 31).

#### `subagent:bash`
**Current default:** Claude Haiku 4.5 | **Fit:** Moderate

Shell execution is procedural. Haiku handles straightforward commands.

**Alternative:** GPT-5.4 Nano with Tau2-Bench 92.5% (strong tool use) at 5x cheaper.

#### `subagent:plan`
**Current default:** Claude Haiku 4.5 | **Fit:** Moderate

Quick planning sketches. GPQA ~73% is marginal for even lightweight planning.

**Alternative:** GPT-5.4 Nano with GPQA 82.8% at 5x cheaper.

### Moderate Fit

#### `cli:interactive`
**Current default:** Claude Sonnet 4.6 | **Haiku 4.5 fit:** Poor

Interactive sessions need reasoning depth that Haiku lacks. GPQA ~73% is insufficient for complex developer queries. Keep on Sonnet.

#### `specialist-inspect-agent`
**Current default:** Claude Sonnet 4.6 | **Haiku 4.5 fit:** Poor

Inspection needs code comprehension beyond Haiku's capability. SWE-Bench Pro 39.5% is too low for reliable quality checks.

### Poor Fit — Do Not Route

All other work types. Haiku 4.5's Intelligence Index of 31, GPQA ~73%, and SWE-Bench Pro 39.5% make it unsuitable for:

- **Implementation** — coding quality insufficient for sustained autonomous work
- **Testing** — root cause analysis needs stronger reasoning
- **Review** (any type) — quality gates need GPQA 85%+ minimum
- **Planning** — reasoning too shallow
- **Documentation** — stronger models write better prose at only marginally higher cost
- **Merge** — reliability concerns at this intelligence level
- **UAT** — despite decent computer use (50.7%), reasoning too weak for UI analysis
- **Synthesis** — needs stronger analytical capability

---

## Should Haiku 4.5 Be Replaced?

### By GPT-5.4 Nano (for subagent/CLI work)
**Yes, for most use cases.** Nano is 5x cheaper, 1.7x faster, smarter (Index 44 vs 31), with 2x context. The only things Haiku does better are SWE-Bench Verified (strong coding for its tier) and computer use. For pure subagent and CLI work, Nano wins.

**Concern:** Nano's complex structured output weakness (works for 3-4 fields, struggles with complex schemas). If subagents need to emit structured output, benchmark before switching.

### By Gemini 3 Flash (for subagent:explore)
**Yes.** Flash at $0.50/$3 with 1M context and Intelligence Index 71 is dramatically better for exploration. 91% hallucination rate is a concern, but for exploration (where output is independently verifiable), it's manageable.

### Keep Haiku for:
- **Anthropic-only deployments** where provider diversity isn't desired
- **Batch API work** at $1.00/$2.50 where pricing is competitive
- **Computer use tasks** where 50.7% is needed and Mini (72.1%) is too expensive

---

## Summary

| Tier | Work Types | Rationale |
|------|-----------|-----------|
| **Adequate but outclassed** | `cli:quick-command`, `subagent:explore`, `subagent:bash`, `subagent:plan` | Proven and safe, but GPT-5.4 Nano is objectively better on every dimension |
| **Never** | All implementation, review, test, merge, UAT, convoy, planning, documentation, interactive CLI | Intelligence too low, context too small, better options at every price point |

## Integration Notes

- Anthropic is the primary provider in Panopticon
- Model ID: `claude-haiku-4-5-20251001`
- Suggested capability scores: code-generation 72, code-review 64, debugging 68, planning 56, documentation 62, testing 68, security 58, performance 62, synthesis 60, speed 82, context-length 72
- **Status:** Still the Anthropic budget option, but strongly consider GPT-5.4 Nano as the new default for subagent and CLI work
- **Knowledge cutoff warning:** July 2025 is the oldest cutoff in Panopticon's roster. May miss awareness of recent frameworks, APIs, or language features.

## Sources

- [Anthropic: Introducing Claude Haiku 4.5](https://www.anthropic.com/news/claude-haiku-4-5)
- [Anthropic: Claude Haiku Product Page](https://www.anthropic.com/claude/haiku)
- [Anthropic Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- [Artificial Analysis: Haiku 4.5](https://artificialanalysis.ai/models/claude-4-5-haiku)
- [MorphLLM: Claude Benchmarks 2026](https://www.morphllm.com/claude-benchmarks)
- [DataCamp: Claude Haiku 4.5 Features](https://www.datacamp.com/blog/anthropic-claude-haiku-4-5)
- [Galaxy.ai: Haiku 4.5 vs GPT-5 Nano](https://blog.galaxy.ai/compare/claude-haiku-4-5-vs-gpt-5-nano)
- [Caylent: Haiku 4.5 Deep Dive](https://caylent.com/blog/claude-haiku-4-5-deep-dive-cost-capabilities-and-the-multi-agent-opportunity)
- [Respan: Fast Model Comparison](https://www.respan.ai/blog/fast-model-comparison)
- [PricePerToken: Haiku 4.5](https://pricepertoken.com/pricing-page/model/anthropic-claude-haiku-4.5)
