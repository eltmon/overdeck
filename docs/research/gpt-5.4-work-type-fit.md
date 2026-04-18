# GPT-5.4 Work Type Fit Analysis

Research date: 2026-04-17

Evaluates OpenAI's GPT-5.4 (standard variant) against Panopticon's 23 work types.

## Model Profile

| Spec | Value |
|------|-------|
| **Vendor** | OpenAI |
| **Release** | 2026-03-05 |
| **Architecture** | Dense (NOT MoE), multimodal, undisclosed parameter count |
| **Context Window** | 272K standard, up to 1.05M in Codex mode |
| **Max Output** | 128K tokens |
| **Knowledge Cutoff** | August 31, 2025 |
| **Modalities** | Text + Image input; Text output. Native computer use (screenshots + mouse/keyboard) |
| **Reasoning Modes** | `none`, `low`, `medium`, `high`, `xhigh` (adjustable per request) |
| **Pricing (input)** | $2.50/M |
| **Pricing (output)** | $15.00/M |
| **Pricing (cached input)** | $1.25/M |
| **Extended context (>272K)** | 2x input ($5.00/M), 1.5x output ($22.50/M) |
| **Speed** | ~72-85 tok/s |
| **TTFT** | ~450ms (no reasoning) to 205s+ (xhigh reasoning) |

**Cost comparison:**
- vs Opus 4.6 ($15/$75): **6x cheaper input, 5x cheaper output**
- vs Sonnet 4.6 ($3/$15): **Comparable** (slightly cheaper input, same output)
- vs Gemini 3.1 Pro ($1.25/$5): **2x more expensive**
- vs Kimi K2.5 ($0.60/$2.50): **4x more expensive**
- vs MiniMax M2.7 ($0.30/$1.20): **8x more expensive**

## Key Benchmarks

| Benchmark | GPT-5.4 | Opus 4.6 | Gemini 3.1 Pro | GLM-5.1 | Kimi K2.5 | Qwen 3.6+ | M2.7 |
|-----------|---------|----------|----------------|---------|-----------|-----------|------|
| SWE-Bench Verified | **84.0%** | 80.8% | 80.6% | 77.8% | 76.8% | 78.8% | 73.8% (ind.) |
| SWE-Bench Pro | 57.7% | ~57.3% | 54.2% | **58.4%** | 50.7% | 56.6% | 56.22% (self) |
| Terminal-Bench 2.0 | **75.1%** | 65.4% | -- | ~54.9% | 50.8% | 61.6% | 47.19% (ind.) |
| GPQA Diamond | 92.8% | 91.3% | **94.1%** | 86.0% | 87.6% | -- | 86.62% |
| MMLU-Pro | **93.0%** | 82.0% | -- | -- | 87.1% | -- | 80.43% |
| ARC-AGI-2 | 73.3% | 69.2% | **84.6%** | -- | -- | -- | -- |
| OSWorld-Verified | **75.0%** | 72.7% | -- | -- | -- | -- | -- |
| LiveCodeBench | 84.0% | 76.0% | -- | -- | **85.0%** | -- | -- |
| SimpleQA | **97.0%** | 72.0% | -- | -- | -- | -- | -- |
| GDPval | **1667** | 1606 | -- | -- | -- | -- | -- |

## Standout Capabilities

1. **SWE-Bench Verified leader at 84.0%** — highest of any model on the standard software engineering benchmark. Incorporates GPT-5.3-Codex capabilities natively.
2. **Terminal-Bench 2.0 leader at 75.1%** — dramatically ahead of Opus (65.4%) and all Chinese models. Best at real terminal/CLI agent work.
3. **Native computer use** — 75% OSWorld, surpassing human expert baseline (72.4%). First general-purpose model with built-in GUI interaction via screenshots + mouse/keyboard.
4. **Tool search** — loads tool definitions on demand, reducing token usage by 47% in tool-heavy workflows while maintaining accuracy. Critical for agentic efficiency.
5. **Knowledge work dominance** — MMLU-Pro 93%, SimpleQA 97%, GDPval 1667. Strongest broad knowledge model.
6. **Factual accuracy** — 33% fewer false claims than GPT-5.2; 18% fewer error-containing responses.
7. **Adjustable reasoning** — five reasoning levels let you trade cost/latency for quality per-request. Can run cheap (`none`) or deep (`xhigh`).
8. **Unified model** — absorbs Codex coding capabilities, no separate model needed.

## Known Weaknesses

1. **Agentic coding gap vs Claude on SWE-Bench Pro** — 57.7% vs reported ~74% for Opus 4.6 (varies by source). Claude preferred for multi-file refactoring and sustained agentic loops.
2. **Over-refactoring** — tends to change nearby code not part of the request. Generates weak test assertions. Import-cycle risks.
3. **Long session degradation** — loses track of earlier instructions after 20+ messages.
4. **Non-deterministic** — temperature 0.0 is not deterministic across requests.
5. **Tool behavior bug (unresolved)** — ignores built-in tools when custom function tools are present (GitHub issue #13773). Critical for Panopticon's tool-heavy agents.
6. **Hallucinations persist** — still fabricates citations. Deep Research misses contradictions.
7. **No multi-agent orchestration** — lacks built-in agent team coordination.
8. **ARC-AGI-2 gap** — 73.3% vs Gemini's 84.6%. Behind on novel reasoning tasks.

---

## Work Type Fit Assessment

### Excellent Fit

#### `issue-agent:implementation`
**Current default:** Kimi K2.5 | **GPT-5.4 fit:** Excellent

Terminal-Bench 75.1% and SWE-Bench Verified 84% are both best-in-class. Native tool search reduces token costs by 47% in tool-heavy workflows. Adjustable reasoning lets you run `medium` for routine beads and `high` for complex ones. At $2.50/$15, it's 6x cheaper than Opus while leading on most coding benchmarks.

**Concerns:** Over-refactoring tendency, long session degradation, and the tool behavior bug (ignoring built-in tools when custom functions present) could cause real issues in Panopticon's multi-tool agent environment. The bug needs investigation before deployment.

#### `specialist-review-agent`
**Current default:** Claude Opus 4.6 | **GPT-5.4 fit:** Good-Excellent

MMLU-Pro 93% and strong code comprehension make it effective for code review. At 6x cheaper than Opus, significant cost savings for a high-quality gate. Adjustable reasoning: run at `high` for thorough review without paying `xhigh` latency.

**Concern:** The over-refactoring tendency suggests it may flag non-issues. Claude's more conservative judgment may be preferable for a pre-merge gate.

#### `specialist-test-agent`
**Current default:** Claude Sonnet 4.6 | **GPT-5.4 fit:** Excellent

Strong tool use (Toolathlon 54.6%), terminal operations (Terminal-Bench 75.1%), and native shell access. At comparable pricing to Sonnet ($2.50 vs $3.00 input) but significantly better Terminal-Bench score (75.1% vs ~59%), this is a clear upgrade path.

### Good Fit — Worth Benchmarking

#### `issue-agent:exploration`
**Current default:** Claude Opus 4.6 | **GPT-5.4 fit:** Good

1.05M context in Codex mode enables full-codebase ingestion. Tool search reduces context waste. SimpleQA 97% means strong factual accuracy for codebase analysis. 6x cheaper than Opus.

**Concern:** Extended context pricing doubles cost. The long session degradation weakness is concerning for exploration that needs to maintain context over many files.

#### `specialist-uat-agent`
**Current default:** Claude Sonnet 4.6 | **GPT-5.4 fit:** Good

Native computer use (75% OSWorld) is the standout. Can interact with GUIs via screenshots + mouse/keyboard + Playwright. This directly maps to browser-based UAT. Stronger vision understanding than Sonnet for visual regression detection.

**Concern:** Playwright MCP integration with GPT-5.4's computer use needs validation in Panopticon.

#### `convoy:security-reviewer`
**Current default:** Claude Opus 4.6 | **GPT-5.4 fit:** Moderate-Good

GPQA Diamond 92.8% shows strong analytical reasoning. MMLU-Pro 93% covers broad security knowledge. At 6x cheaper than Opus, significant savings for a convoy lane. However, the hallucination and over-flagging tendencies are concerning for security review accuracy.

#### `convoy:correctness-reviewer`
**Current default:** Claude Sonnet 4.6 | **GPT-5.4 fit:** Good

Strong reasoning (GPQA 92.8%) and knowledge (MMLU-Pro 93%) for logic and edge case review. Comparable pricing to Sonnet with better reasoning scores.

#### `convoy:performance-reviewer`
**Current default:** Claude Sonnet 4.6 | **GPT-5.4 fit:** Good

Code comprehension + knowledge base for identifying performance anti-patterns. Terminal-Bench leadership suggests understanding of system-level performance.

#### `specialist-merge-agent`
**Current default:** Claude Sonnet 4.6 | **GPT-5.4 fit:** Good

Structured git operations. Strong tool use reliability. Comparable pricing to Sonnet. Adjustable reasoning lets you run `low` for simple merges, `high` for conflict resolution.

#### `issue-agent:testing`
**Current default:** Claude Sonnet 4.6 | **GPT-5.4 fit:** Good

Similar to specialist-test-agent. Strong terminal and tool use. LiveCodeBench 84% shows competitive test/algorithm capability.

#### `issue-agent:review-response`
**Current default:** Claude Sonnet 4.6 | **GPT-5.4 fit:** Good

Reading review feedback and implementing fixes. Strong code generation. The over-refactoring tendency is a risk here — may change more than what the review requested.

#### `specialist-inspect-agent`
**Current default:** Claude Sonnet 4.6 | **GPT-5.4 fit:** Moderate-Good

Per-bead inspection needs to be fast. GPT-5.4 at 72-85 tok/s is faster than Opus but slower than Mini. Run at reasoning `low` for quick inspections. Comparable pricing to Sonnet.

### Poor Fit — Do Not Route

#### `planning-agent`
**Current default:** Claude Opus 4.6 | **GPT-5.4 fit:** Moderate

ARC-AGI-2 gap (73.3% vs Gemini 84.6%, Opus 69.2%) and long session degradation are concerns for extended planning sessions. However, MMLU-Pro 93% and GDPval 1667 show strong knowledge work. Keep on Opus for now, but worth benchmarking for planning on well-specified issues.

#### `convoy:requirements-reviewer`
**Current default:** Claude Opus 4.6 | **GPT-5.4 fit:** Moderate

Strong knowledge base but planning-heavy work type. The long session degradation weakness is less relevant for single-burst convoy work. Worth benchmarking.

#### `issue-agent:documentation`
**Current default:** Claude Sonnet 4.6 | **GPT-5.4 fit:** Moderate

Strong knowledge (SimpleQA 97%) but known for over-generating and weak prose compared to Claude. Developers report Claude is preferred for writing quality (47% vs 29% preference in blind evals).

#### `convoy:synthesis-agent`
**Current default:** Claude Sonnet 4.6 | **GPT-5.4 fit:** Moderate

Synthesis needs concise output. GPT-5.4 tends to be verbose and over-generate.

#### All subagents (`explore`, `plan`, `bash`, `general-purpose`)
**Current defaults:** Haiku 4.5 / Sonnet 4.6 | **GPT-5.4 fit:** Poor

At $2.50/$15, GPT-5.4 is too expensive for subagent work. Use GPT-5.4 Mini or Nano instead (see separate analyses).

#### `cli:interactive` and `cli:quick-command`
**Current defaults:** Sonnet 4.6 / Haiku 4.5 | **GPT-5.4 fit:** Poor

Too expensive and too slow for interactive CLI use. Mini or Nano are better fits.

---

## Critical Issue: Tool Behavior Bug

GitHub issue #13773 documents that GPT-5.4 ignores built-in tools (shell, apply_patch) when custom function tools are present. This is **directly relevant to Panopticon** — our agents use both MCP tools and built-in Claude Code tools simultaneously. Must verify whether this bug manifests in Panopticon's tool configuration before deploying GPT-5.4 for any work type.

---

## Summary

| Tier | Work Types | Rationale |
|------|-----------|-----------|
| **Benchmark now** | `issue-agent:implementation` | Best Terminal-Bench + SWE-Bench Verified, but tool bug needs investigation |
| **Benchmark now** | `specialist-test-agent` | Terminal-Bench 75.1% at Sonnet pricing |
| **Benchmark next** | `specialist-review-agent`, `specialist-uat-agent`, `issue-agent:exploration` | Strong capabilities, cost savings vs Opus |
| **Worth trying** | `convoy:security-reviewer`, `convoy:correctness-reviewer`, `convoy:performance-reviewer`, `specialist-merge-agent`, `specialist-inspect-agent` | Good reasoning + knowledge at Sonnet pricing |
| **Moderate** | `planning-agent`, `convoy:requirements-reviewer`, `issue-agent:documentation`, `convoy:synthesis-agent` | Mixed signals — benchmark before committing |
| **Never** | Subagents (too expensive), CLI modes (too expensive/slow) — use Mini/Nano |

## Integration Notes

- OpenAI is already a configured provider in Panopticon
- Model ID: `gpt-5.4`
- Available via OpenAI API and CLIProxyAPI sidecar (Codex subscription)
- **Must investigate tool behavior bug (#13773) before deployment**
- Reasoning effort should be configurable per work type (e.g., `low` for inspections, `high` for reviews)
- Suggested capability scores: code-generation 94, code-review 90, debugging 88, planning 82, documentation 78, testing 92, security 88, performance 86, synthesis 82, speed 60, context-length 90

## Sources

- [OpenAI: Introducing GPT-5.4](https://openai.com/index/introducing-gpt-5-4/)
- [OpenAI API Docs](https://developers.openai.com/api/docs/models/gpt-5.4)
- [BenchLM: GPT-5.4](https://benchlm.ai/models/gpt-5-4)
- [BenchLM: Claude Opus 4.6 vs GPT-5.4](https://benchlm.ai/blog/posts/claude-opus-vs-gpt-5)
- [Artificial Analysis](https://artificialanalysis.ai/models/gpt-5-4)
- [DataCamp Overview](https://www.datacamp.com/blog/gpt-5-4)
- [DataCamp: GPT-5.4 vs Claude Opus 4.6](https://www.datacamp.com/blog/gpt-5-4-vs-claude-opus-4-6)
- [NxCode Complete Guide](https://www.nxcode.io/resources/news/gpt-5-4-complete-guide-features-pricing-models-2026)
- [NxCode: GPT-5.4 vs Claude for Coding](https://www.nxcode.io/resources/news/gpt-5-4-vs-claude-opus-4-6-coding-comparison-2026)
- [Portkey Comparison](https://portkey.ai/blog/gpt-5-4-vs-claude-opus-4-6/)
- [Evolink: SWE-bench 2026](https://evolink.ai/blog/swe-bench-verified-2026-claude-vs-gpt)
