# Claude Opus 4.6 Work Type Fit Analysis

Research date: 2026-04-17

Evaluates Anthropic's Claude Opus 4.6 against Panopticon's 23 work types. Opus 4.6 is Panopticon's current default for quality-critical work types (planning, review, security). Now superseded by Opus 4.7 (April 16, 2026) but remains the incumbent baseline.

## Model Profile

| Spec | Value |
|------|-------|
| **Vendor** | Anthropic |
| **Release** | 2026-02-05 |
| **Model ID** | `claude-opus-4-6` |
| **Architecture** | Undisclosed parameter count |
| **Context Window** | 1M tokens (~750K words) |
| **Max Output** | 128K tokens (300K via Batch API with beta header) |
| **Knowledge Cutoff** | May 2025 (reliable), August 2025 (training data) |
| **Modalities** | Text + Image input; Text output |
| **Reasoning** | Extended Thinking + Adaptive (low/medium/high/max) |
| **Pricing (input)** | $5.00/M |
| **Pricing (output)** | $25.00/M |
| **Batch API** | 50% off ($2.50/$12.50) |
| **Cache hit** | $0.50/M (90% discount) |
| **Fast Mode** | $30/$150 (6x standard) |
| **Speed** | ~40.6 tok/s (#86/132 on Artificial Analysis) |
| **TTFT** | ~16-20s |

**Cost comparison:**
- vs GPT-5.4 ($2.50/$15): **2x more expensive input, 1.67x more expensive output**
- vs Gemini 3.1 Pro ($2/$12): **2.5x more expensive input, 2.1x more expensive output**
- vs Sonnet 4.6 ($3/$15): **1.67x more expensive input, 1.67x more expensive output**
- vs Kimi K2.5 ($0.60/$2.50): **8.3x more expensive input, 10x more expensive output**

## Key Benchmarks

| Benchmark | Opus 4.6 | GPT-5.4 | Gemini 3.1 Pro | Sonnet 4.6 |
|-----------|----------|---------|----------------|------------|
| SWE-Bench Verified | 80.8% | **84.0%** | 80.6% | 79.6% |
| SWE-Bench Pro | 57.5% | **57.7%** | 54.2% | ~43.6% |
| GPQA Diamond | 91.3% | 92.8% | **94.3%** | 74.1% |
| Terminal-Bench 2.0 | 65.4% | **75.1%** | 68.5% | 59.1% |
| ARC-AGI-2 | 68.8% | 73.3% | **77.1%** | 58.3% |
| OSWorld-Verified | 72.7% | **75.0%** | -- | 72.5% |
| MCP-Atlas | 60.3% | -- | 69.2% | **61.3%** |
| HumanEval | 90.4% | **93.1%** | 89.2% | 98.0% |
| BrowseComp | **84.0%** | 82.7% | -- | -- |
| GDPval-AA Elo | **1606** | 1462 | 1317 | **1633** |
| MMMLU | 91.1% | -- | -- | 89.3% |
| BigLaw Bench | 90.2% | -- | -- | -- |

**Chatbot Arena Elo:** ~1496 overall, 1547 coding, 1537 hard prompts, 1510 multi-turn

## Standout Capabilities

1. **Professional knowledge work leader** — GDPval-AA Elo 1606 (144 points above GPT-5.2, 190 above Opus 4.5). Strongest on finance, legal, and enterprise tasks.
2. **Agentic coding pioneer** — SWE-Bench Verified 80.8%, Terminal-Bench 65.4%. The model that established Claude's agentic coding reputation.
3. **Abstract reasoning jump** — ARC-AGI-2 68.8%, nearly doubling Opus 4.5's 37.6%. One of the largest single-generation improvements.
4. **Long-context reliability** — 76% on MRCR v2 at 1M context vs Sonnet 4.5's 18.5%. First Opus with 1M context.
5. **Web research** — BrowseComp 84.0%, a 16.2-point jump from Opus 4.5.
6. **Writing quality** — Consistently rated highest among frontier models for prose quality, adherence, and coherence.
7. **Legal reasoning** — BigLaw Bench 90.2%. Strong professional domain performance.
8. **Extended Thinking** — Full thinking chain support with adaptive effort scaling.
9. **128K output** — Largest output window among Claude models at time of release.
10. **Prompt caching** — $0.50/M cache hits enable efficient agentic loops with repeated context.

## Known Weaknesses

1. **Speed** — 40.6 tok/s is slow. Ranked #86/132. GPT-5.4 is ~2x faster, Sonnet 4.6 ~1.3x faster.
2. **Cost** — $5/$25 is premium pricing. 2x GPT-5.4, 2.5x Gemini 3.1 Pro, 8.3x Kimi K2.5.
3. **Verbosity** — 160M tokens during evaluation vs 35M median (~4.6x). Inflates effective costs significantly.
4. **Terminal-Bench gap** — 65.4% vs GPT-5.4's 75.1%. Nearly 10-point deficit on complex terminal operations.
5. **SWE-Bench plateau** — 80.8% vs Opus 4.5's 80.9%. Essentially flat on coding benchmarks.
6. **MCP-Atlas regression** — Dropped from 62.3% to 60.3% on multi-tool coordination. Sonnet 4.6 actually beats it (61.3%).
7. **GPQA gap to Gemini** — 91.3% vs Gemini 3.1 Pro's 94.3%. Not the science reasoning leader.
8. **Rate limits** — Operational friction on non-enterprise plans.
9. **Now superseded** — Opus 4.7 released April 16, 2026. Opus 4.6 is now legacy.

---

## Work Type Fit Assessment

### The Incumbent

Opus 4.6 is Panopticon's current quality anchor. It defaults on the work types where wrong answers have the highest blast radius: planning, pre-merge review, security review, requirements review. The question is no longer "is Opus 4.6 good enough" but "should it be replaced by Opus 4.7 or something cheaper."

### Excellent Fit (Current Defaults)

#### `planning-agent`
**Current default:** Claude Opus 4.6 | **Fit:** Excellent

Planning needs maximum reasoning depth, writing quality, and the ability to produce detailed, structured plans. Opus 4.6 delivers ~25K token plans vs Gemini 3.1 Pro's ~2.5K. GDPval-AA 1606 shows strong professional judgment. Writing quality is best-in-class.

**Cost concern:** Planning runs once per issue, so the premium pricing is amortized. Not a high-volume work type.

#### `specialist-review-agent`
**Current default:** Claude Opus 4.6 | **Fit:** Excellent

Pre-merge quality gate. GPQA 91.3% + writing quality + detailed output make it ideal for thorough, actionable review feedback. This is the last line of defense before code merges.

**Alternative:** Sonnet 4.6 at 60% cost delivers 79.6% SWE-Bench Verified (vs 80.8%). Close, but the reasoning gap (GPQA 74.1% vs 91.3%) matters for catching subtle logic errors.

#### `convoy:security-reviewer`
**Current default:** Claude Opus 4.6 | **Fit:** Excellent

Security review is safety-critical. GPQA 91.3% and strong professional reasoning (GDPval-AA 1606) are essential. The cost of a missed vulnerability exceeds the cost of Opus pricing.

#### `convoy:requirements-reviewer`
**Current default:** Claude Opus 4.6 | **Fit:** Excellent

Requirements cross-referencing needs detailed spec analysis and writing quality. Opus 4.6's verbose output is actually an advantage here — thoroughness matters more than brevity.

### Good Fit (Current Defaults)

#### `issue-agent:exploration`
**Current default:** Claude Opus 4.6 | **Fit:** Good

1M context + strong reasoning for mapping unfamiliar codebases. ARC-AGI-2 68.8% shows strong abstract pattern recognition.

**Alternative:** Gemini 3.1 Pro is 2.5x cheaper with 1M context, GPQA 94.3%, and 130 tok/s (3x faster). Strong candidate to replace Opus here. But agentic reliability issues ("stuck in loops") are a concern.

### Moderate Fit — Overqualified

#### `convoy:correctness-reviewer`
**Current default:** Claude Sonnet 4.6 | **Opus 4.6 fit:** Overqualified

Sonnet 4.6 handles correctness review well at 60% the cost. Opus 4.6 would be better but the marginal quality gain doesn't justify the price increase for this lane.

#### `convoy:performance-reviewer`
**Current default:** Claude Sonnet 4.6 | **Opus 4.6 fit:** Overqualified

Same reasoning as correctness reviewer. Sonnet 4.6 is sufficient.

### Poor Fit — Too Expensive

#### All implementation work types
`issue-agent:implementation`, `issue-agent:testing`, `issue-agent:review-response`, `issue-agent:documentation`

At $5/$25, Opus 4.6 is 8-10x more expensive than Kimi K2.5 and 2x more expensive than GPT-5.4 for implementation work that runs for hours with dozens of tool calls. The marginal quality over Sonnet 4.6 (1.2% SWE-Bench) doesn't justify the cost for high-volume coding.

#### All specialist agents (except review)
`specialist-test-agent`, `specialist-merge-agent`, `specialist-inspect-agent`, `specialist-uat-agent`

These need speed and cost-efficiency. Opus 4.6's 40.6 tok/s and $5/$25 pricing make it unsuitable for high-frequency specialist work.

#### All subagents
`subagent:explore`, `subagent:bash`, `subagent:plan`, `subagent:general-purpose`

Subagents are high-volume, speed-sensitive. Opus is far too expensive and slow.

#### CLI modes
`cli:interactive`, `cli:quick-command`

16-20s TTFT is too slow for interactive use. Quick commands need sub-second response.

---

## Opus 4.6 vs Opus 4.7: Should You Upgrade?

Opus 4.7 improves across the board:
- SWE-Bench Verified: 80.8% → 87.6% (+6.8)
- SWE-Bench Pro: 57.5% → 64.3% (+6.8)
- GPQA Diamond: 91.3% → 94.2% (+2.9)
- Terminal-Bench: 65.4% → 69.4% (+4.0)
- Vision: 54.5% → 98.5% accuracy
- Tool errors: ~1/3 of Opus 4.6
- Speed: 40.6 → ~81 tok/s (2x faster)

**But:** New tokenizer inflates token count 1-1.35x, partially offsetting the same $5/$25 pricing. Breaking API changes (no budget_tokens, no sampling params) require code updates.

**Verdict:** Yes, upgrade. The improvements are substantial across every dimension that matters for Panopticon's quality-critical work types.

---

## Summary

| Tier | Work Types | Rationale |
|------|-----------|-----------|
| **Current default** | `planning-agent`, `specialist-review-agent`, `convoy:security-reviewer`, `convoy:requirements-reviewer` | Quality anchor for high-stakes decisions |
| **Good default** | `issue-agent:exploration` | 1M context + reasoning, but Gemini 3.1 Pro is a strong alternative |
| **Overqualified** | `convoy:correctness-reviewer`, `convoy:performance-reviewer` | Sonnet 4.6 is sufficient at 60% cost |
| **Never** | Implementation, specialists (except review), subagents, CLI | Too expensive and too slow for high-volume work |

## Integration Notes

- Anthropic is the primary provider in Panopticon
- Model ID: `claude-opus-4-6`
- Superseded by `claude-opus-4-7` as of April 16, 2026
- Suggested capability scores: code-generation 86, code-review 92, debugging 88, planning 96, documentation 88, testing 84, security 94, performance 86, synthesis 90, speed 42, context-length 98
- **Status:** Legacy — migrate quality-critical work types to Opus 4.7

## Sources

- [Anthropic: Introducing Claude Opus 4.6](https://www.anthropic.com/news/claude-opus-4-6)
- [Anthropic Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- [Anthropic Models Overview](https://platform.claude.com/docs/en/about-claude/models/overview)
- [Artificial Analysis: Opus 4.6](https://artificialanalysis.ai/models/claude-opus-4-6-adaptive)
- [MorphLLM: Claude Benchmarks 2026](https://www.morphllm.com/claude-benchmarks)
- [Vellum: Opus 4.6 Benchmarks](https://www.vellum.ai/blog/claude-opus-4-6-benchmarks)
- [BenchLM: Opus 4.6](https://benchlm.ai/models/claude-opus-4-6)
- [MindStudio: GPT-5.4 vs Opus 4.6 vs Gemini 3.1 Pro](https://www.mindstudio.ai/blog/gpt-54-vs-claude-opus-46-vs-gemini-31-pro-benchmarks)
- [PricePerToken: Opus 4.6](https://pricepertoken.com/pricing-page/model/anthropic-claude-opus-4.6)
