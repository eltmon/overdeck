# Gemini 3.1 Pro Preview Work Type Fit Analysis

Research date: 2026-04-17

Evaluates Google's Gemini 3.1 Pro Preview against Panopticon's 23 work types. Still in preview (since Feb 19, 2026) with no announced GA date. Google states agentic workflow improvements are the primary focus before GA.

## Model Profile

| Spec | Value |
|------|-------|
| **Vendor** | Google DeepMind |
| **Release** | 2026-02-19 (preview) |
| **Architecture** | MoE (undisclosed parameter count) |
| **Context Window** | 1M tokens |
| **Max Output** | 64K tokens |
| **Knowledge Cutoff** | Not published |
| **Modalities** | Text + Image + Audio + Video + PDF input; Text output |
| **Reasoning** | "Deep Think" mode with chain-of-thought |
| **Pricing (input, 0-200K)** | $2.00/M |
| **Pricing (output)** | $12.00/M |
| **Pricing (input, >200K)** | $4.00/M |
| **Pricing (output, >200K)** | $18.00/M |
| **Cached input** | ~$0.50/M (75% discount) |
| **Speed** | ~130-142 tok/s output |
| **TTFT** | 28-38s (reasoning mode — expected for thinking models) |

**Cost comparison:**
- vs Opus 4.6 ($15/$75): **7.5x cheaper input, 6.25x cheaper output** (within 200K)
- vs GPT-5.4 ($2.50/$15): **Slightly cheaper** ($2 vs $2.50 input, $12 vs $15 output)
- vs Sonnet 4.6 ($3/$15): **1.5x cheaper input, 1.25x cheaper output**
- vs Kimi K2.5 ($0.60/$2.50): **3.3x more expensive**
- vs MiniMax M2.7 ($0.30/$1.20): **6.7x more expensive**

**Pricing cliff at 200K:** 2x input, 1.5x output above 200K tokens. The 1M context is available but expensive for full utilization.

## Key Benchmarks

| Benchmark | Gemini 3.1 Pro | Opus 4.6 | GPT-5.4 | GLM-5.1 | Kimi K2.5 | Qwen 3.6+ | M2.7 |
|-----------|---------------|----------|---------|---------|-----------|-----------|------|
| SWE-Bench Verified | 80.6% | 80.8% | 84.0% | 77.8% | 76.8% | 78.8% | 73.8% (ind.) |
| SWE-Bench Pro | 54.2% | ~57.3% | 57.7% | **58.4%** | 50.7% | 56.6% | 56.22% (self) |
| GPQA Diamond | **94.3%** | 91.3% | 92.8% | 86.0% | 87.6% | -- | 86.62% |
| MMLU-Pro | 90.8-92.6% | 91.7% | 93.0% | -- | 87.1% | -- | 80.43% |
| ARC-AGI-2 | **77.1%** | 69.2% | 73.3% | -- | -- | -- | -- |
| Terminal-Bench 2.0 | 68.5% | 65.4% | **75.1%** | ~54.9% | 50.8% | 61.6% | 47.19% (ind.) |
| BrowseComp | 85.9% | -- | 82.7% | -- | -- | -- | -- |
| MCP Atlas | 69.2% | -- | -- | **71.8%** | 29.5% | -- | -- |
| HumanEval | 89.2% | 90.4% | **93.1%** | -- | -- | -- | -- |
| Video-MME | **78.2%** | ~71% | -- | -- | 87.4% | 87.8% | -- |
| LiveCodeBench Pro Elo | **2887** | -- | -- | -- | -- | -- | -- |
| GDPval-AA | 1317 | 1606 | **1667** | -- | -- | -- | -- |

**Chatbot Arena Elo:** ~1493-1500 (#2-3, essentially tied with Opus 4.6 at ~1504)

## Standout Capabilities

1. **GPQA Diamond leader at 94.3%** — highest ever reported on PhD-level science reasoning. 3+ points ahead of GPT-5.4 (92.8%), 3+ ahead of Opus (91.3%). This is the single benchmark where Gemini has clear daylight.
2. **ARC-AGI-2 leader at 77.1%** — best abstract reasoning score. More than 2x Gemini 3 Pro's score. 4 points ahead of GPT-5.4 (73.3%), 8 ahead of Opus (69.2%).
3. **1M context window at $2/M** — largest context among frontier reasoning models at a reasonable price point. Enables full-codebase ingestion.
4. **Natively multimodal** — text, image, audio, video, PDF. Strongest video understanding (Video-MME 78.2%). No other Western frontier model matches the breadth.
5. **Speed** — 130-142 tok/s is 2-3x faster than Opus (~55 tok/s). Among the fastest reasoning models.
6. **Cost/quality ratio** — 7.5x cheaper than Opus while matching it on SWE-Bench Verified (80.6% vs 80.8%) and beating it on GPQA and ARC-AGI-2.
7. **BrowseComp 85.9%** — strong autonomous web research capability.
8. **Google ecosystem** — deep integration with AI Studio, Vertex AI, Gemini CLI, Android Studio, NotebookLM.

## Known Weaknesses

1. **Agentic execution reliability** — developers report it gets "stuck in loops," avoids text editors, uses "weird ways" to modify files, and loses context in multi-step workflows. Called "consistently the most frustrating model for development work" by a former Googler on HN.
2. **GDPval-AA enterprise gap** — 1317 vs Opus 1606, GPT-5.4 1667. Trails by ~300 points on practical enterprise tasks.
3. **Writing quality** — lowest of the three frontier models in blind evals (24% preference vs Claude 47%, GPT 29%).
4. **Thinking token opacity** — displays vague summaries like "I'm fully immersed in the problem" rather than transparent reasoning chains.
5. **Long session degradation** — quality declines after 8+ rounds of iterative debugging.
6. **Stability issues (preview)** — frequent 503 errors, latency spikes up to 104s, "429 Too Many Requests" even on paid tiers.
7. **Rate limits** — 250 requests/day on Tier 1 paid; free tier significantly cut.
8. **Shallow planning output** — produces ~2.5K token plans vs Opus's ~25K tokens for equivalent complex tasks.
9. **Code editing behavior** — sometimes starts editing code when asked conceptual questions, wasting context.
10. **SWE-Bench Pro gap** — 54.2% vs GLM-5.1's 58.4% and GPT-5.4's 57.7%. Trails on the hardest agentic coding benchmark.
11. **Benchmark cherry-picking** — Google marketed "13 out of 16 wins" while omitting Terminal-Bench, OSWorld, and GDPval-AA where it trails.

---

## Work Type Fit Assessment

### Excellent Fit

#### `issue-agent:exploration`
**Current default:** Claude Opus 4.6 | **Gemini 3.1 Pro fit:** Excellent

This is Gemini's strongest Panopticon use case. 1M context window enables full-codebase ingestion in a single pass. 130-142 tok/s is 2-3x faster than Opus for rapid scanning. GPQA 94.3% shows deep analytical capability for understanding unfamiliar code. 7.5x cheaper than Opus. Native multimodal means it can process architecture diagrams, screenshots, and PDFs alongside code.

**Concern:** The 200K pricing cliff means cost-efficient exploration stays under 200K. Above that, cost approaches Opus levels.

### Good Fit — Worth Benchmarking

#### `issue-agent:implementation`
**Current default:** Kimi K2.5 | **Gemini 3.1 Pro fit:** Good

SWE-Bench Verified 80.6% is competitive. 1M context helps with large refactors. 130 tok/s is much faster than Kimi (35 tok/s) and GLM-5.1 (40 tok/s). LiveCodeBench Pro Elo 2887 shows strong coding.

**Critical concern:** The agentic execution reliability weakness is directly relevant. "Gets stuck in loops" and "weird file editing" are exactly what Panopticon agents do for hours. This is the #1 blocker. Benchmark extensively before routing implementation work here.

#### `specialist-test-agent`
**Current default:** Claude Sonnet 4.6 | **Gemini 3.1 Pro fit:** Good

Strong reasoning (GPQA 94.3%) helps with root cause analysis. 1.5x cheaper than Sonnet. Speed advantage. Multimodal can process test output screenshots.

**Concern:** Agentic reliability issues may manifest in test-fix-retest loops.

#### `convoy:security-reviewer`
**Current default:** Claude Opus 4.6 | **Gemini 3.1 Pro fit:** Good

GPQA Diamond 94.3% (highest of any model) suggests best-in-class analytical reasoning for vulnerability detection. 7.5x cheaper than Opus. ARC-AGI-2 77.1% shows strong novel reasoning.

**Concern:** Writing quality weakness — security reviews need clear, precise prose. The shallow planning output tendency could produce superficial security analysis. Benchmark against Opus on real diffs.

#### `specialist-uat-agent`
**Current default:** Claude Sonnet 4.6 | **Gemini 3.1 Pro fit:** Good

Natively multimodal — can process screenshots, video, and audio. Video-MME 78.2% shows strong visual understanding. 1M context handles large test sessions.

**Concern:** Playwright MCP integration with Gemini hasn't been tested. The code-editing-when-asked-conceptual-questions behavior could interfere with UAT observation phases.

#### `convoy:correctness-reviewer`
**Current default:** Claude Sonnet 4.6 | **Gemini 3.1 Pro fit:** Good

GPQA 94.3% and ARC-AGI-2 77.1% are the strongest reasoning scores of any model. Edge case and logic review should benefit. 1.5x cheaper than Sonnet.

#### `convoy:performance-reviewer`
**Current default:** Claude Sonnet 4.6 | **Gemini 3.1 Pro fit:** Good

Strong analytical reasoning. 1M context enables system-wide performance analysis. 1.5x cheaper than Sonnet.

#### `specialist-review-agent`
**Current default:** Claude Opus 4.6 | **Gemini 3.1 Pro fit:** Moderate-Good

SWE-Bench Verified matches Opus (80.6% vs 80.8%). GPQA leads. 7.5x cheaper. However, the shallow planning output and writing quality weaknesses are concerning for a pre-merge quality gate that needs detailed, actionable review feedback.

#### `specialist-merge-agent`
**Current default:** Claude Sonnet 4.6 | **Gemini 3.1 Pro fit:** Good

Structured git operations. Speed + cost advantage over Sonnet. Merge procedures are constrained enough that agentic reliability concerns are less relevant.

#### `specialist-inspect-agent`
**Current default:** Claude Sonnet 4.6 | **Gemini 3.1 Pro fit:** Moderate-Good

Fast (130 tok/s) and cheaper than Sonnet. Good reasoning for spec-to-diff comparison. However, TTFT of 28-38s in reasoning mode is a problem for a work type that needs to be fast and runs frequently. Would need to use minimal thinking.

### Poor Fit — Do Not Route

#### `planning-agent`
**Current default:** Claude Opus 4.6 | **Gemini 3.1 Pro fit:** Poor

Despite best-in-class GPQA and ARC-AGI-2, the planning-specific weaknesses are disqualifying: shallow planning output (~2.5K tokens vs Opus's ~25K), writing quality ranked last among frontier models, and the thinking token opacity prevents interactive planning dialogue. Keep on Opus.

#### `convoy:requirements-reviewer`
**Current default:** Claude Opus 4.6 | **Gemini 3.1 Pro fit:** Poor

Requirements review needs detailed spec cross-referencing. Shallow output tendency and writing quality weakness work against this. Keep on Opus.

#### `issue-agent:documentation`
**Current default:** Claude Sonnet 4.6 | **Gemini 3.1 Pro fit:** Poor

Writing quality ranked lowest (24% preference). Documentation needs clear, well-structured prose. Gemini's strength is analysis, not writing.

#### `convoy:synthesis-agent`
**Current default:** Claude Sonnet 4.6 | **Gemini 3.1 Pro fit:** Poor

Synthesis needs concise, well-written integration of findings. Writing quality weakness is a direct liability.

#### `issue-agent:review-response`
**Current default:** Claude Sonnet 4.6 | **Gemini 3.1 Pro fit:** Moderate

Reading feedback is fine, but implementing fixes triggers the agentic reliability issues (stuck loops, weird file editing). Higher risk than implementation since review-response has tighter scope constraints.

#### All subagents
**Current defaults:** Haiku 4.5 / Sonnet 4.6 | **Gemini 3.1 Pro fit:** Poor

At $2/$12, too expensive for subagent work. Use Flash or Flash-Lite instead (see separate analyses).

#### `cli:interactive` and `cli:quick-command`
**Current defaults:** Sonnet 4.6 / Haiku 4.5 | **Gemini 3.1 Pro fit:** Poor

28-38s TTFT in reasoning mode is unacceptable for interactive use. Too expensive for quick commands.

---

## Preview Risk Assessment

Gemini 3.1 Pro is still in preview. For Panopticon:

- **503 errors and latency spikes** could cause agent timeouts and stuck detection false positives
- **Rate limits (250 req/day Tier 1)** may be insufficient for active development with multiple parallel agents
- **No SLA** means no reliability guarantees for production agent work
- **API stability** concerns — sudden degradation has been reported

**Recommendation:** Use for exploration and convoy review lanes (low blast radius). Do not route implementation or specialist agents until GA or stability improves.

---

## Summary

| Tier | Work Types | Rationale |
|------|-----------|-----------|
| **Deploy now** | `issue-agent:exploration` | 1M context + speed + multimodal. Best exploration candidate |
| **Benchmark next** | `convoy:security-reviewer`, `convoy:correctness-reviewer`, `convoy:performance-reviewer` | Best-in-class reasoning (GPQA 94.3%) at 7.5x cheaper than Opus |
| **Worth trying** | `specialist-test-agent`, `specialist-uat-agent`, `specialist-merge-agent`, `specialist-review-agent` | Cost savings + capabilities, but agentic reliability needs validation |
| **Wait for GA** | `issue-agent:implementation` | Agentic reliability issues + preview instability. Revisit after GA |
| **Never** | Planning (shallow output), documentation (writing quality), synthesis (writing quality), requirements review, subagents (too expensive), CLI modes (TTFT) |

## Integration Notes

- Google is already a configured provider in Panopticon
- Model ID: `gemini-3.1-pro-preview`
- Available via Google AI API (API key)
- Must handle 503s and rate limits gracefully in Cloister
- Suggested capability scores: code-generation 88, code-review 86, debugging 84, planning 76 (despite strong reasoning — shallow output hurts), documentation 68, testing 86, security 90, performance 86, synthesis 72, speed 78, context-length 98

## Sources

- [Google Blog: Gemini 3.1 Pro](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-1-pro/)
- [Google DeepMind Model Card](https://deepmind.google/models/model-cards/gemini-3-1-pro/)
- [Vertex AI Documentation](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-1-pro)
- [Artificial Analysis](https://artificialanalysis.ai/models/gemini-3-1-pro-preview)
- [SmartScope Benchmark Analysis](https://smartscope.blog/en/generative-ai/google-gemini/gemini-3-1-pro-benchmark-analysis-2026/)
- [MindStudio: GPT-5.4 vs Opus 4.6 vs Gemini 3.1 Pro](https://www.mindstudio.ai/blog/gpt-54-vs-claude-opus-46-vs-gemini-31-pro-benchmarks)
- [AI Magicx: April 2026 Comparison](https://www.aimagicx.com/blog/claude-opus-4-6-vs-gpt-5-4-vs-gemini-3-1-benchmark-comparison-april-2026)
- [HN Discussion](https://news.ycombinator.com/item?id=47074735)
- [OpenRouter](https://openrouter.ai/google/gemini-3.1-pro-preview)
