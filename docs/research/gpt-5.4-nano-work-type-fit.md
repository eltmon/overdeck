# GPT-5.4 Nano Work Type Fit Analysis

Research date: 2026-04-17

Evaluates OpenAI's GPT-5.4 Nano against Panopticon's 23 work types. Nano is the smallest, cheapest, and fastest GPT-5.4 variant — positioned for classification, routing, and lightweight subagent work.

## Model Profile

| Spec | Value |
|------|-------|
| **Vendor** | OpenAI |
| **Release** | 2026-03-17 |
| **Architecture** | MoE (subset of params active per inference), undisclosed total size |
| **Context Window** | 400K tokens |
| **Max Output** | 128K tokens |
| **Knowledge Cutoff** | August 31, 2025 |
| **Modalities** | Text + Image input; Text output |
| **Reasoning** | Supported (reasoning parameter available) |
| **Pricing (input)** | $0.20/M |
| **Pricing (cached input)** | $0.02/M |
| **Pricing (output)** | $1.25/M |
| **Speed** | ~155-200 tok/s |
| **TTFT** | ~0.48s (no reasoning) to ~3.5-4.4s (with reasoning) |
| **Fine-tuning** | Not supported |
| **Distillation** | Supported |

**Cost comparison:**
- vs Haiku 4.5 ($1/$5): **5x cheaper input, 4x cheaper output**
- vs GPT-5.4 Mini ($0.75/$4.50): **3.75x cheaper input, 3.6x cheaper output**
- vs MiniMax M2.7 ($0.30/$1.20): **1.5x cheaper input, comparable output**
- vs Gemini Flash Lite ($0.25/$1.50): **Slightly cheaper input, slightly cheaper output**

**Cached input at $0.02/M is the cheapest cache rate of any model evaluated.** Enables near-free repeated context.

## Key Benchmarks

| Benchmark | GPT-5.4 Nano | GPT-5.4 Mini | Haiku 4.5 | Notes |
|-----------|-------------|-------------|-----------|-------|
| SWE-Bench Pro | 52.4% | 54.4% | ~45-50% | Impressively close to Mini |
| Terminal-Bench 2.0 | 46.3% | 60.0% | -- | Significant gap to Mini |
| GPQA Diamond | 82.8% | 88.0% | ~73% | +9.8% over Haiku |
| OSWorld-Verified | 39.0% | 72.1% | -- | **Massive gap** — Nano's biggest weakness |
| Tau2-Bench (telecom) | 92.5% | 93.4% | -- | Near-Mini on domain tool use |
| MCP-Atlas | 56.1% | 57.7% | -- | Nearly matches Mini |
| Toolathon | 35.5% | 42.9% | -- | Weaker tool use |
| Artificial Analysis Index | 44/100 (#2/143) | -- | -- | "Amongst the leading models" for its class |

**Key insight:** Nano's SWE-Bench Pro (52.4%) at $0.20/M input is extraordinary value. It matches or beats many full-size models from 6 months ago. The quality cliff is on computer use (OSWorld 39% vs Mini's 72%) and complex multi-step reasoning.

## Standout Capabilities

1. **SWE-Bench Pro 52.4% at $0.20/M** — better than Kimi K2.5 (50.7%) at 3x lower cost. Outperforms previous-gen GPT-5 Mini (45.7%).
2. **Near-Mini tool use** — Tau2-Bench 92.5% and MCP-Atlas 56.1% nearly match Mini. Strong at domain-specific tool orchestration.
3. **Speed** — 155-200 tok/s is among the fastest models available. Sub-second TTFT in no-reasoning mode.
4. **$0.02/M cached input** — cheapest cache rate evaluated. Enables very high-volume repetitive work at near-zero context cost.
5. **400K context** — large window for a model at this price point.
6. **GPQA Diamond 82.8%** — solid reasoning for its class, beating Haiku 4.5 by ~10 points.

## Known Weaknesses

1. **Computer use cliff** — OSWorld 39% vs Mini's 72.1%. Almost half. Cannot reliably interact with GUIs.
2. **Complex multi-step reasoning** — fails on deep "understand + reason + decide" chains. Cannot solve spatial logic problems that Mini handles.
3. **Complex tool calling** — higher rate of incorrect function calls with nested parameters or context-dependent tool choices.
4. **Complex structured output** — works for 3-4 fields, but complex schemas produce errors and omissions.
5. **Instruction following on edge cases** — more likely to miss edge cases, apply rules inconsistently, or default to most common interpretation.
6. **Long context retrieval degradation** — quality drops more noticeably on very long inputs than Mini.
7. **No fine-tuning** — distillation only.

## OpenAI's Positioning

Explicitly designed for:
- Classification (binary and multi-class)
- Data extraction (simple schemas)
- Ranking and scoring
- Routing decisions
- Lightweight subagent execution
- Format normalization
- High-volume summarization of short inputs
- Pre-filtering operations

NOT designed for: complex reasoning, computer use, deep agentic workflows, or fine-grained spatial/visual understanding.

---

## Work Type Fit Assessment

### Excellent Fit

#### `subagent:bash`
**Current default:** Claude Haiku 4.5 | **GPT-5.4 Nano fit:** Excellent

Shell execution is procedural and well-structured. Nano's Tau2-Bench 92.5% shows strong domain tool use. At 5x cheaper than Haiku and 155-200 tok/s, this is a clear upgrade for simple shell tasks. The weakness in complex tool calling doesn't matter for straightforward bash subagents.

#### `subagent:explore`
**Current default:** Claude Haiku 4.5 | **GPT-5.4 Nano fit:** Excellent

Fast codebase scanning. Nano at 155-200 tok/s with 400K context is faster and cheaper than Haiku with comparable or better understanding (GPQA 82.8% vs ~73%). Perfect for "find where X is defined" style exploration.

#### `cli:quick-command`
**Current default:** Claude Haiku 4.5 | **GPT-5.4 Nano fit:** Excellent

One-shot utility commands need speed above all. Nano at 0.48s TTFT (no reasoning) and 155-200 tok/s is one of the fastest options available. 5x cheaper than Haiku. Ideal for `pan status`, `pan show`, and similar quick commands.

### Good Fit — Worth Benchmarking

#### `subagent:plan`
**Current default:** Claude Haiku 4.5 | **GPT-5.4 Nano fit:** Good

Quick planning sketches. GPQA 82.8% is sufficient for basic approach breakdowns. Not for deep architectural planning, but subagent plans are inherently lightweight.

#### `subagent:general-purpose`
**Current default:** Claude Sonnet 4.6 | **GPT-5.4 Nano fit:** Moderate

Mixed tasks. SWE-Bench Pro 52.4% is decent but this work type currently defaults to Sonnet for a reason — general-purpose tasks vary in complexity. Nano handles the simple end well but will fail on harder tasks. Consider Mini instead.

#### `specialist-inspect-agent`
**Current default:** Claude Sonnet 4.6 | **GPT-5.4 Nano fit:** Moderate

Per-bead inspection is fast and structured — which plays to Nano's strengths. However, the instruction-following weakness on edge cases is concerning for a quality gate. At 155-200 tok/s and $0.20/M, the cost/speed is compelling. Benchmark on real beads to see if the quality cliff manifests.

### Poor Fit — Do Not Route

#### All implementation work types
`issue-agent:implementation`, `issue-agent:testing`, `issue-agent:review-response`, `issue-agent:documentation`

Nano's complex reasoning weakness and instruction-following edge cases make it unsuitable for any sustained implementation work. Use Mini or Standard.

#### All specialist agents (except inspect)
`specialist-review-agent`, `specialist-test-agent`, `specialist-merge-agent`, `specialist-uat-agent`

Review and test agents need deeper reasoning and reliable tool orchestration. UAT needs computer use (39% OSWorld is disqualifying). Merge needs reliable multi-step execution.

#### All convoy reviewers
`convoy:security-reviewer`, `convoy:performance-reviewer`, `convoy:correctness-reviewer`, `convoy:requirements-reviewer`, `convoy:synthesis-agent`

Review work needs reasoning depth that Nano lacks. GPQA 82.8% is insufficient for security and correctness gates.

#### `planning-agent`
Planning requires top-tier reasoning. Nano's complex reasoning cliff is disqualifying.

#### `cli:interactive`
Interactive sessions vary in complexity. Nano will fail on harder queries. Mini is a better fit.

#### `issue-agent:exploration`
Exploration needs synthesis capability to map unfamiliar codebases. Nano's long-context retrieval degradation and reasoning limits make Standard or Qwen Plus better choices.

---

## Nano's Niche: The Panopticon Routing Layer

Beyond work types, Nano has a potential role in Panopticon's infrastructure:

1. **Smart model selection routing** — Nano could classify incoming tasks by complexity and route to appropriate models, replacing hard-coded rules in `smart-model-selector.ts`.
2. **Bead complexity scoring** — evaluate bead descriptions and estimate which model tier they need.
3. **Log classification** — categorize agent output for health monitoring and stuck detection.
4. **Intent detection** — classify user commands in `cli:quick-command` to route to the right handler.

At $0.02/M cached input, these routing/classification calls would add negligible cost to the pipeline.

---

## Summary

| Tier | Work Types | Rationale |
|------|-----------|-----------|
| **Deploy now** | `subagent:bash`, `subagent:explore`, `cli:quick-command` | Faster and cheaper than Haiku with better quality |
| **Benchmark next** | `subagent:plan`, `specialist-inspect-agent` | Promising but quality cliff needs validation |
| **Infrastructure** | Model routing, bead scoring, log classification | $0.02/M cached input makes routing calls nearly free |
| **Never** | All implementation, review, test, merge, UAT, convoy, planning, documentation, interactive CLI |

## Integration Notes

- OpenAI already configured in Panopticon
- Model ID: `gpt-5.4-nano`
- Available via OpenAI API and CLIProxyAPI sidecar
- Suggested capability scores: code-generation 76, code-review 68, debugging 72, planning 60, documentation 58, testing 74, security 62, performance 66, synthesis 64, speed 96, context-length 85

## Sources

- [OpenAI: Introducing GPT-5.4 Mini and Nano](https://openai.com/index/introducing-gpt-5-4-mini-and-nano/)
- [OpenAI API Docs](https://developers.openai.com/api/docs/models/gpt-5.4-nano)
- [Artificial Analysis](https://artificialanalysis.ai/models/gpt-5-4-nano)
- [DataCamp: GPT-5.4 Mini and Nano](https://www.datacamp.com/blog/gpt-5-4-mini-nano)
- [AI Cost Check](https://aicostcheck.com/blog/gpt-5-4-mini-nano-pricing-benchmarks)
- [OpenRouter](https://openrouter.ai/openai/gpt-5.4-nano)
- [Simon Willison on Mini and Nano](https://simonwillison.net/2026/Mar/17/mini-and-nano/)
- [MindStudio: Mini vs Nano Subagent Comparison](https://www.mindstudio.ai/blog/gpt-5-4-mini-vs-nano-sub-agent-comparison)
- [HN Discussion](https://news.ycombinator.com/item?id=47415441)
- [Microsoft Azure Blog](https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/introducing-openai%E2%80%99s-gpt-5-4-mini-and-gpt-5-4-nano-for-low-latency-ai/4500569)
