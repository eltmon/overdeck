# GPT-5.4 Mini Work Type Fit Analysis

Research date: 2026-04-17

Evaluates OpenAI's GPT-5.4 Mini against Panopticon's 23 work types. Mini is the mid-tier variant — faster and cheaper than standard GPT-5.4, positioned as a Sonnet/Haiku competitor.

## Model Profile

| Spec | Value |
|------|-------|
| **Vendor** | OpenAI |
| **Release** | 2026-03-17 |
| **Architecture** | Undisclosed parameter count, reasoning model with extended thinking |
| **Context Window** | 400K tokens |
| **Max Output** | 128K tokens |
| **Knowledge Cutoff** | August 31, 2025 |
| **Modalities** | Text + Image input; Text output. Computer use supported |
| **Reasoning Modes** | `none`, `low`, `medium`, `high`, `xhigh` |
| **Pricing (input)** | $0.75/M |
| **Pricing (cached input)** | $0.075/M (90% discount) |
| **Pricing (output)** | $4.50/M |
| **Speed** | ~150-190 tok/s |
| **TTFT** | ~0.42s (no reasoning) to ~9.8s (xhigh) |

**Cost comparison:**
- vs Sonnet 4.6 ($3/$15): **4x cheaper input, 3.3x cheaper output**
- vs Haiku 4.5 ($1/$5): **Slightly cheaper** ($0.75 vs $1.00 input, $4.50 vs $5.00 output)
- vs GPT-5.4 Standard ($2.50/$15): **3.3x cheaper input, 3.3x cheaper output**
- vs Kimi K2.5 ($0.60/$2.50): **Similar input, 1.8x more expensive output**
- vs MiniMax M2.7 ($0.30/$1.20): **2.5x more expensive input, 3.75x more expensive output**

**Cached input at $0.075/M is exceptionally cheap** — cheaper than MiniMax M2.7's cached rate ($0.06/M is slightly lower, but Mini's standard input is higher).

## Key Benchmarks

| Benchmark | GPT-5.4 Mini | GPT-5.4 Std | Sonnet 4.6 | Haiku 4.5 | Kimi K2.5 | M2.7 |
|-----------|-------------|-------------|------------|-----------|-----------|------|
| SWE-Bench Pro | 54.4% | 57.7% | ~47% | -- | 50.7% | 56.22% (self) |
| Terminal-Bench 2.0 | 60.0% | 75.1% | 59.1% | -- | 50.8% | 47.19% (ind.) |
| OSWorld-Verified | 72.1% | 75.0% | 72.5% | -- | -- | -- |
| GPQA Diamond | 88.0% | 92.8% | -- | ~73% | 87.6% | 86.62% |
| Tau2-Bench (telecom) | 93.4% | -- | -- | -- | -- | -- |
| MCP-Atlas | 57.7% | -- | -- | -- | 29.5% | -- |
| Toolathon | 42.9% | -- | -- | -- | -- | 46.3% |

**Key insight:** Mini hits ~94% of GPT-5.4 Standard's coding performance at 1/3 the cost. On Terminal-Bench (60.0% vs 59.1%) and SWE-Bench Pro (54.4% vs ~47%), it matches or beats Sonnet 4.6 while being 3-4x cheaper.

## Standout Capabilities

1. **Speed** — 150-190 tok/s, roughly 3-4x faster than Sonnet 4.6 and 6-8x faster than GPT-5.4 Standard. One of the fastest reasoning-capable models available.
2. **Computer use at Mini pricing** — 72.1% OSWorld matches Sonnet 4.6 (72.5%) at 1/4 the price. Viable for screenshot-based testing and UI reasoning.
3. **Tool use reliability** — Tau2-Bench 93.4%, MCP-Atlas 57.7%. Strong multi-tool orchestration at speed.
4. **Adjustable reasoning** — `none` mode (0.42s TTFT) for fast tasks, `high` for complex ones. Fine-grained cost/quality control.
5. **SWE-Bench Pro 54.4%** — beats Sonnet and Kimi K2.5 on the hardest agentic coding benchmark.
6. **400K context** — larger than most competitors at this price point (Sonnet 200K, Kimi 256K).
7. **90% cache discount** — $0.075/M cached input enables very cheap repeated context in agentic loops.

## Known Weaknesses

1. **TTFT at high reasoning** — 9.8s at `xhigh` is painful. Must use lower reasoning levels for interactive work.
2. **Instruction following in agentic loops** — developers report GPT-5.4 models "seem not to understand instructions" compared to Claude. Task overexpansion problem persists (generates thousands of lines unprompted).
3. **Daily-driver coding consensus favors Sonnet** — "95%+ of GPT-5.4's coding quality at roughly half the effective cost and 2-3x faster output speed" when factoring Sonnet's cache discount.
4. **No fine-tuning** — distillation only.
5. **Gap to Standard on hard problems** — Terminal-Bench 60% vs 75.1%, SWE-Bench Pro 54.4% vs 57.7%.
6. **Over-refactoring inherited from GPT-5.4 family** — expands beyond requested scope.

---

## Work Type Fit Assessment

### Excellent Fit

#### `specialist-inspect-agent`
**Current default:** Claude Sonnet 4.6 | **GPT-5.4 Mini fit:** Excellent

Per-bead inspection needs speed and runs frequently. Mini at 150-190 tok/s is 3-4x faster than Sonnet. At $0.75/$4.50, it's 4x cheaper on input. Adjustable reasoning: `low` for simple inspections, `medium` for complex diffs. This is Mini's sweet spot — fast, cheap, frequent, structured.

#### `specialist-test-agent`
**Current default:** Claude Sonnet 4.6 | **GPT-5.4 Mini fit:** Excellent

Tool use reliability (Tau2-Bench 93.4%, MCP-Atlas 57.7%) is critical for test agents that issue many sequential tool calls. Terminal-Bench 60% matches Sonnet (59.1%). 4x cheaper input. Speed means faster test-analyze-retest loops.

#### `specialist-merge-agent`
**Current default:** Claude Sonnet 4.6 | **GPT-5.4 Mini fit:** Excellent

Merge operations are structured and procedural. Mini's speed accelerates the sync-merge-verify-build-push pipeline. Tool reliability is high. 4x cheaper than Sonnet. Low risk — merge failures are detectable.

#### `subagent:general-purpose`
**Current default:** Claude Sonnet 4.6 | **GPT-5.4 Mini fit:** Excellent

Mixed helper tasks. Mini at 150-190 tok/s with SWE-Bench Pro 54.4% provides Sonnet-level quality at 4x lower cost and 3-4x higher speed. The ideal general-purpose subagent.

#### `subagent:bash`
**Current default:** Claude Haiku 4.5 | **GPT-5.4 Mini fit:** Excellent

Shell execution. Mini is cheaper than Haiku ($0.75 vs $1.00 input) with dramatically better coding capability. Terminal-Bench 60% shows strong CLI work. Speed at 150-190 tok/s is competitive with Haiku.

### Good Fit — Worth Benchmarking

#### `issue-agent:testing`
**Current default:** Claude Sonnet 4.6 | **GPT-5.4 Mini fit:** Good

Test writing + execution. Similar profile to specialist-test-agent. The question is whether instruction-following issues manifest during longer test generation sessions.

#### `issue-agent:review-response`
**Current default:** Claude Sonnet 4.6 | **GPT-5.4 Mini fit:** Good

Reading feedback and implementing fixes. Fast turnaround. The over-refactoring tendency is a risk — may change more than the review requested.

#### `specialist-uat-agent`
**Current default:** Claude Sonnet 4.6 | **GPT-5.4 Mini fit:** Good

Computer use at 72.1% OSWorld matches Sonnet (72.5%) at 1/4 the price. Can process screenshots and interact with UI. Needs Playwright MCP validation.

#### `convoy:correctness-reviewer`
**Current default:** Claude Sonnet 4.6 | **GPT-5.4 Mini fit:** Good

GPQA Diamond 88% shows strong reasoning for logic review. Speed means convoy lanes complete faster. 4x cheaper than Sonnet.

#### `convoy:performance-reviewer`
**Current default:** Claude Sonnet 4.6 | **GPT-5.4 Mini fit:** Good

Code comprehension + speed for parallel review lanes. Cost savings are significant for convoy work that runs on every review cycle.

#### `issue-agent:implementation` (cost-optimized tier)
**Current default:** Kimi K2.5 | **GPT-5.4 Mini fit:** Moderate-Good

SWE-Bench Pro 54.4% beats K2.5 (50.7%). At $0.75/$4.50, comparable to K2.5 ($0.60/$2.50 — Mini is slightly more expensive on output). Speed advantage (150-190 vs 35 tok/s) is massive. However, instruction-following concerns and task overexpansion make Mini risky as a primary implementation model. Better as a backup or for well-constrained beads.

#### `cli:interactive`
**Current default:** Claude Sonnet 4.6 | **GPT-5.4 Mini fit:** Moderate-Good

Fast (150-190 tok/s), cheap, and capable. Good for interactive CLI use at `none` or `low` reasoning. TTFT of 0.42s in no-reasoning mode is excellent. The instruction-following weakness is concerning for complex interactive sessions.

### Poor Fit — Do Not Route

#### `planning-agent`
**Current default:** Claude Opus 4.6 | **GPT-5.4 Mini fit:** Poor

Planning needs top-tier reasoning. GPQA 88% is solid but planning requires architectural judgment that Mini lacks compared to Opus or Standard GPT-5.4.

#### `specialist-review-agent`
**Current default:** Claude Opus 4.6 | **GPT-5.4 Mini fit:** Poor

Pre-merge quality gate. Mini's instruction-following weakness and over-refactoring tendency make it unsuitable for the last line of defense. Keep on Opus.

#### `convoy:security-reviewer`
**Current default:** Claude Opus 4.6 | **GPT-5.4 Mini fit:** Poor

Security is safety-critical. Mini's reasoning gap (88% vs Opus 91.3% GPQA) and instruction-following issues disqualify it.

#### `convoy:requirements-reviewer`
**Current default:** Claude Opus 4.6 | **GPT-5.4 Mini fit:** Poor

Planning-heavy. Needs strong reasoning for spec cross-referencing.

#### `issue-agent:exploration`
**Current default:** Claude Opus 4.6 | **GPT-5.4 Mini fit:** Moderate

Fast and 400K context is decent, but exploration needs deep synthesis. Standard GPT-5.4 or Qwen 3.6 Plus (1M context) are better fits.

#### `subagent:explore`
**Current default:** Claude Haiku 4.5 | **GPT-5.4 Mini fit:** Moderate

Fast enough but more expensive than Haiku for simple exploration. The 400K context is a plus for large codebases.

#### `subagent:plan`
**Current default:** Claude Haiku 4.5 | **GPT-5.4 Mini fit:** Moderate

Slightly overkill for quick planning sketches. Haiku is adequate and cheaper on output.

#### `cli:quick-command`
**Current default:** Claude Haiku 4.5 | **GPT-5.4 Mini fit:** Moderate

Mini at `none` reasoning is fast (0.42s TTFT) and cheaper than Haiku on input. But output at $4.50/M vs Haiku $5/M is similar. No strong reason to switch from Haiku for one-shot commands.

#### `issue-agent:documentation`
**Current default:** Claude Sonnet 4.6 | **GPT-5.4 Mini fit:** Poor

Doc writing needs clean prose. GPT-5.4 family's over-generation and weaker writing quality (29% preference vs Claude's 47%) make this a poor fit.

#### `convoy:synthesis-agent`
**Current default:** Claude Sonnet 4.6 | **GPT-5.4 Mini fit:** Poor

Synthesis needs concise output. GPT-5.4 family's verbosity works against this.

---

## Summary

| Tier | Work Types | Rationale |
|------|-----------|-----------|
| **Deploy now** | `specialist-inspect-agent`, `subagent:bash`, `subagent:general-purpose` | Speed + cost + reliability for fast structured tasks |
| **Benchmark next** | `specialist-test-agent`, `specialist-merge-agent` | Strong tool use at 4x cheaper than Sonnet |
| **Worth trying** | `specialist-uat-agent`, `issue-agent:testing`, `issue-agent:review-response`, `convoy:correctness-reviewer`, `convoy:performance-reviewer` | Good capability at significant cost savings |
| **Maybe** | `issue-agent:implementation` (cost tier), `cli:interactive` | Instruction-following concerns need validation |
| **Never** | Planning, specialist-review, security review, requirements review, documentation, synthesis |

## Integration Notes

- OpenAI already configured in Panopticon
- Model ID: `gpt-5.4-mini`
- Available via OpenAI API and CLIProxyAPI sidecar
- Reasoning effort should be configurable per work type
- Suggested capability scores: code-generation 88, code-review 82, debugging 84, planning 74, documentation 68, testing 88, security 78, performance 80, synthesis 74, speed 88, context-length 85

## Sources

- [OpenAI: Introducing GPT-5.4 Mini and Nano](https://openai.com/index/introducing-gpt-5-4-mini-and-nano/)
- [OpenAI API Docs](https://developers.openai.com/api/docs/models/gpt-5.4-mini)
- [DataCamp: GPT-5.4 Mini and Nano](https://www.datacamp.com/blog/gpt-5-4-mini-nano)
- [Artificial Analysis](https://artificialanalysis.ai/models/gpt-5-4-mini)
- [DocsBot: Sonnet 4.6 vs GPT-5.4 Mini](https://docsbot.ai/models/compare/claude-sonnet-4-6/gpt-5-4-mini)
- [NxCode: Sonnet 4.6 vs GPT-5.4 Coding](https://www.nxcode.io/resources/news/claude-sonnet-4-6-vs-gpt-5-4-coding-comparison-2026)
- [HN Discussion](https://news.ycombinator.com/item?id=47415441)
- [SitePoint: GPT-5.4 Mini vs GPT-4o Mini](https://www.sitepoint.com/gpt-5-4-mini-vs-gpt-4o-mini-comparison-2026/)
- [MindStudio: Mini vs Nano Subagent Comparison](https://www.mindstudio.ai/blog/gpt-5-4-mini-vs-nano-sub-agent-comparison)
