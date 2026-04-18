# Claude Sonnet 4.6 Work Type Fit Analysis

Research date: 2026-04-17

Evaluates Anthropic's Claude Sonnet 4.6 against Panopticon's 23 work types. Sonnet 4.6 is Panopticon's current workhorse — the default for the largest number of work types (testing, documentation, review-response, convoy reviewers, and most specialist agents).

## Model Profile

| Spec | Value |
|------|-------|
| **Vendor** | Anthropic |
| **Release** | 2026-02-17 |
| **Model ID** | `claude-sonnet-4-6` |
| **Architecture** | Undisclosed parameter count |
| **Context Window** | 1M tokens (~750K words) |
| **Max Output** | 64K tokens (300K via Batch API with beta header) |
| **Knowledge Cutoff** | August 2025 (reliable), January 2026 (training data) |
| **Modalities** | Text + Image input; Text output |
| **Reasoning** | Extended Thinking + Adaptive |
| **Pricing (input)** | $3.00/M |
| **Pricing (output)** | $15.00/M |
| **Batch API** | 50% off ($1.50/$7.50) |
| **Cache hit** | $0.30/M (90% discount) |
| **Speed** | ~50-55 tok/s |
| **TTFT** | ~0.73s standard; ~101.7s at max-effort reasoning |

**Cost comparison:**
- vs Opus 4.6 ($5/$25): **1.67x cheaper input, 1.67x cheaper output** (60% of Opus cost)
- vs GPT-5.4 ($2.50/$15): **1.2x more expensive input, same output**
- vs GPT-5.4 Mini ($0.75/$4.50): **4x more expensive input, 3.3x more expensive output**
- vs Gemini 3 Flash ($0.50/$3): **6x more expensive input, 5x more expensive output**
- vs Kimi K2.5 ($0.60/$2.50): **5x more expensive input, 6x more expensive output**

## Key Benchmarks

| Benchmark | Sonnet 4.6 | Opus 4.6 | GPT-5.4 | GPT-5.4 Mini | Gemini 3 Flash |
|-----------|------------|----------|---------|-------------|----------------|
| SWE-Bench Verified | 79.6% | 80.8% | **84.0%** | -- | 78.0% |
| SWE-Bench Pro | ~43.6% | 57.5% | **57.7%** | 54.4% | -- |
| GPQA Diamond | 74.1% | **91.3%** | 92.8% | 88.0% | 90.4% |
| Terminal-Bench 2.0 | 59.1% | 65.4% | **75.1%** | 60.0% | 38.6% |
| OSWorld-Verified | 72.5% | 72.7% | **75.0%** | 72.1% | -- |
| MCP-Atlas | **61.3%** | 60.3% | -- | 57.7% | -- |
| HumanEval | **98.0%** | 90.4% | 93.1% | -- | -- |
| ARC-AGI-2 | 58.3% | **68.8%** | 73.3% | -- | -- |
| LiveCodeBench | 80% | -- | -- | -- | **90.8%** |
| GDPval-AA Elo | **1633** | 1606 | 1462 | -- | -- |
| MMMLU | 89.3% | **91.1%** | -- | -- | -- |
| Finance Agent | **63.3%** | 60.1% | -- | -- | -- |
| AA Intelligence Index | 52/100 (#5) | -- | 57/100 (#2) | -- | 71/100 |

**Chatbot Arena:** Preferred over Sonnet 4.5 70% of the time, over Opus 4.5 59% of the time.

## Standout Capabilities

1. **Near-Opus coding at 60% cost** — SWE-Bench Verified 79.6% vs Opus 4.6's 80.8%. Only 1.2 points behind at 60% the price.
2. **Best-in-class tool use** — MCP-Atlas 61.3% actually beats Opus 4.6 (60.3%). Critical for Panopticon's tool-heavy agent workflows.
3. **Best-in-class enterprise tasks** — GDPval-AA Elo 1633, ahead of every model including Opus 4.6 (1606) and GPT-5.4 (1462).
4. **1M context at $3/M** — Full codebase loading without long-context surcharge. Cheaper than Opus for the same context window.
5. **Speed** — 50-55 tok/s is substantially faster than Opus 4.6 (~40 tok/s). Sub-second TTFT in standard mode.
6. **HumanEval 98%** — Highest raw code generation score of any model evaluated.
7. **Extended + Adaptive Thinking** — Can scale reasoning effort per-request, from lightweight to deep.
8. **Strong instruction following** — Optimized for "reliable, token-efficient outputs for multi-step agentic pipelines."
9. **OSWorld 72.5%** — Strong computer use, nearly matching Opus 4.6 (72.7%).
10. **Prompt caching** — $0.30/M cache hits enable efficient agentic loops.

## Known Weaknesses

1. **Deep reasoning gap** — GPQA Diamond 74.1% vs Opus 4.6's 91.3%. A 17-point gap on PhD-level science. Not suited for the deepest analytical tasks.
2. **Verbosity** — 4.5x more tokens than Sonnet 4.5 on GDPval-AA (280M vs 58M). Inflates effective output costs, potentially approaching Opus levels on verbose tasks.
3. **Quality regression reports** — GitHub issue #46935 documents quantified quality degradation starting March 9, 2026. 1,400+ frustration events across 50 sessions.
4. **SWE-Bench Pro gap** — ~43.6% vs Opus 4.6's 57.5% and GPT-5.4's 57.7%. Significant 14-point gap on the hardest agentic coding benchmark.
5. **ARC-AGI-2 gap** — 58.3% vs Opus 4.6's 68.8%. Abstract reasoning is notably weaker.
6. **No video processing** — Text + image only. Gemini 3 Flash handles video at 6x cheaper.
7. **Security/IAM reasoning** — Opus "pulls away significantly" on security policy evaluation tasks.

---

## Work Type Fit Assessment

### The Workhorse

Sonnet 4.6 is Panopticon's volume model — it handles the largest number of work types because it balances quality, speed, and cost better than any other model. It's not the best at any single dimension, but it's good enough at everything to be the safe default.

### Excellent Fit (Current Defaults)

#### `issue-agent:testing`
**Current default:** Claude Sonnet 4.6 | **Fit:** Excellent

Test writing and repair loops need speed + coding quality. SWE-Bench Verified 79.6% is strong. 50-55 tok/s keeps iteration fast. MCP-Atlas 61.3% shows reliable tool orchestration for test frameworks.

**Alternative:** GPT-5.4 Mini at $0.75/$4.50 (4x cheaper) with Terminal-Bench 60% and Tau2-Bench 93.4%. Worth benchmarking, but Sonnet's broader coding strength keeps it as default.

#### `issue-agent:documentation`
**Current default:** Claude Sonnet 4.6 | **Fit:** Excellent

Documentation needs clear, well-structured prose + code understanding. Sonnet's instruction following and GDPval-AA 1633 (enterprise writing) make it strong here. No competitor at a lower price point matches writing quality.

#### `issue-agent:review-response`
**Current default:** Claude Sonnet 4.6 | **Fit:** Excellent

Reading feedback and implementing fixes. SWE-Bench Verified 79.6% for code changes, MCP-Atlas 61.3% for tool use, and good speed for tight turnaround.

#### `specialist-test-agent`
**Current default:** Claude Sonnet 4.6 | **Fit:** Excellent

Root cause analysis + fix loops. Same reasoning as `issue-agent:testing`. Speed and tool reliability are the critical dimensions.

**Alternative:** Gemini 3 Flash at $0.50/$3 (6x cheaper) with SWE-Bench 78% and LiveCodeBench 90.8%. Strong candidate, but 91% hallucination rate is concerning for test root cause analysis.

#### `specialist-inspect-agent`
**Current default:** Claude Sonnet 4.6 | **Fit:** Good

Per-bead inspection needs speed and runs frequently. 50-55 tok/s is acceptable. SWE-Bench 79.6% ensures quality code comprehension.

**Alternative:** GPT-5.4 Mini at $0.75/$4.50 (4x cheaper) with 150-190 tok/s (3x faster). Strong candidate for this high-frequency work type.

#### `specialist-merge-agent`
**Current default:** Claude Sonnet 4.6 | **Fit:** Good

Merge operations are procedural. Sonnet is more than capable. Speed and reliability matter most.

**Alternative:** GPT-5.4 Mini or Gemini 3 Flash at significant cost savings. Merge is constrained enough that cheaper models work.

### Good Fit (Current Defaults)

#### `convoy:correctness-reviewer`
**Current default:** Claude Sonnet 4.6 | **Fit:** Good

Logic and edge case review. GPQA 74.1% is adequate for most correctness issues, though Opus 4.6/4.7 would catch more subtle problems.

#### `convoy:performance-reviewer`
**Current default:** Claude Sonnet 4.6 | **Fit:** Good

Performance analysis benefits from code comprehension (SWE-Bench 79.6%) and the 1M context window for system-wide analysis.

#### `convoy:synthesis-agent`
**Current default:** Claude Sonnet 4.6 | **Fit:** Good

Combining review findings into a unified verdict. GDPval-AA 1633 shows strong structured writing. Verbosity is a concern — synthesis should be concise.

#### `specialist-uat-agent`
**Current default:** Claude Sonnet 4.6 | **Fit:** Good

OSWorld 72.5% shows strong computer use. Image input for screenshot analysis. But no video processing limits multimedia testing.

**Alternative:** Opus 4.7 with 98.5% vision accuracy is a strong upgrade if cost allows. Gemini 3 Flash with Agentic Vision is cheaper but less reliable.

### Moderate Fit

#### `subagent:general-purpose`
**Current default:** Claude Sonnet 4.6 | **Fit:** Moderate — Consider downgrade

General-purpose subagents are high-volume. At $3/$15, Sonnet is expensive for helper tasks. GPT-5.4 Mini at $0.75/$4.50 or Gemini 3 Flash at $0.50/$3 offer 4-6x savings with comparable capability.

### Poor Fit — Wrong Tier

#### `planning-agent`
**Current default:** Claude Opus 4.6 | **Sonnet 4.6 fit:** Poor

GPQA 74.1% is too low for deep architectural planning. The 17-point gap to Opus is exactly the kind of reasoning depth planning requires.

#### `specialist-review-agent`
**Current default:** Claude Opus 4.6 | **Sonnet 4.6 fit:** Moderate

SWE-Bench 79.6% is close to Opus 4.6's 80.8%, but the GPQA gap (74.1% vs 91.3%) means Sonnet may miss subtle logic issues. Acceptable as a cost-saving measure for non-critical reviews.

#### `convoy:security-reviewer`
**Current default:** Claude Opus 4.6 | **Sonnet 4.6 fit:** Poor

Security review needs maximum reasoning depth. The 17-point GPQA gap is disqualifying for safety-critical analysis.

#### `convoy:requirements-reviewer`
**Current default:** Claude Opus 4.6 | **Sonnet 4.6 fit:** Poor

Requirements cross-referencing needs the kind of deep analytical reasoning where Opus excels.

#### All subagents (except general-purpose)
`subagent:explore`, `subagent:bash`, `subagent:plan`

At $3/$15, too expensive for high-volume subagent work. Haiku 4.5 ($1/$5), GPT-5.4 Nano ($0.20/$1.25), or Gemini Flash-Lite ($0.25/$1.50) are better fits.

#### `cli:quick-command`
**Current default:** Claude Haiku 4.5 | **Sonnet 4.6 fit:** Overqualified

Quick commands need speed and low cost. Sonnet is overkill at 3x Haiku's price.

---

## Summary

| Tier | Work Types | Rationale |
|------|-----------|-----------|
| **Keep as default** | `issue-agent:testing`, `issue-agent:documentation`, `issue-agent:review-response`, `specialist-test-agent` | Best balance of quality + speed + cost for these work types |
| **Keep but benchmark alternatives** | `specialist-inspect-agent`, `specialist-merge-agent`, `convoy:correctness-reviewer`, `convoy:performance-reviewer`, `convoy:synthesis-agent`, `specialist-uat-agent` | Strong fit but cheaper alternatives (GPT-5.4 Mini, Gemini 3 Flash) should be tested |
| **Consider downgrade** | `subagent:general-purpose` | 4-6x cheaper alternatives with comparable capability |
| **Never** | Planning, security review, requirements review, subagents (bash/explore/plan), CLI quick-command | Either wrong quality tier or wrong cost tier |

## Integration Notes

- Anthropic is the primary provider in Panopticon
- Model ID: `claude-sonnet-4-6`
- Suggested capability scores: code-generation 84, code-review 82, debugging 80, planning 72, documentation 84, testing 82, security 74, performance 80, synthesis 78, speed 68, context-length 98
- **Verbosity warning:** Monitor output token usage — Sonnet 4.6's verbosity can make effective costs approach Opus levels on some tasks. Consider prompt engineering to constrain output length.
- **Quality regression:** Monitor for the reported quality degradation (GitHub #46935). May need Anthropic-side fix.

## Sources

- [Anthropic Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- [Anthropic Models Overview](https://platform.claude.com/docs/en/about-claude/models/overview)
- [NxCode: Sonnet 4.6 Complete Guide](https://www.nxcode.io/resources/news/claude-sonnet-4-6-complete-guide-benchmarks-pricing-2026)
- [Artificial Analysis: Sonnet 4.6](https://artificialanalysis.ai/models/claude-sonnet-4-6-adaptive)
- [MorphLLM: Claude Benchmarks 2026](https://www.morphllm.com/claude-benchmarks)
- [Vellum: LLM Leaderboard 2026](https://www.vellum.ai/llm-leaderboard)
- [Latent Space: Sonnet 4.6 AINews](https://www.latent.space/p/ainews-claude-sonnet-46-clean-upgrade)
- [GitHub Issue #46935: Quality Regression](https://github.com/anthropics/claude-code/issues/46935)
- [NxCode: Sonnet 4.6 vs Gemini 3 Flash](https://www.nxcode.io/resources/news/claude-sonnet-4-6-vs-gemini-3-flash-ai-model-comparison-2026)
- [BuildFastWithAI: Best AI Models April 2026](https://www.buildfastwithai.com/blogs/best-ai-models-april-2026)
