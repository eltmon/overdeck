# Kimi K2.5 / K2.6 Work Type Fit Analysis

Research date: 2026-04-17

Evaluates Moonshot AI's Kimi K2.5 (GA) and K2.6 Code Preview against Panopticon's 23 work types. K2.5 is the current default for `issue-agent:implementation`. K2.6 is in preview — data is limited but promising.

**Data labeling convention:** Benchmarks and claims are tagged `[K2.5]` or `[K2.6]` to indicate which version they come from. Where only K2.5 data exists, we assume K2.6 matches or exceeds it (no known regressions). K2.6-specific improvements are called out explicitly.

## Model Profile

| Spec | K2.5 (GA) | K2.6 Code Preview |
|------|-----------|-------------------|
| **Release** | 2026-01-27 | 2026-04-13 (preview) |
| **Architecture** | MoE, 1T total / 32B active | Same foundation as K2.5 |
| **Context Window** | 256K tokens | 256K tokens |
| **Max Output** | 96K (reasoning), 4-8K (standard) | Same |
| **Modalities** | Text + Image + Video input | Text + Image + Video input |
| **License** | Modified MIT, open-weight (HuggingFace) | Weights NOT yet released |
| **Pricing (input)** | $0.60/M | $0.60/M |
| **Pricing (output)** | $2.50/M (instant), $3.00/M (thinking) | $2.50/M |
| **Cached input** | $0.15/M (75% automatic discount) | $0.15/M |
| **Speed** | ~34.6 tok/s `[K2.5]` | TBD |
| **Verbosity** | High — 89M tokens during evaluation `[K2.5]` | Expected similar or slightly improved |
| **Vision** | MoonViT 400M encoder `[K2.5]` | Same |

**Third-party pricing:** As low as $0.23/M input via SiliconFlow, $2.25/M output via DeepInfra/Fireworks `[K2.5]`.

## Key Benchmarks

All data below is `[K2.5]` unless explicitly marked `[K2.6]`.

### Coding

| Benchmark | K2.5 | Claude Opus 4.6 | Claude Sonnet 4.6 | GLM-5.1 | GPT-5.3 Codex |
|-----------|------|-----------------|-------------------|---------|---------------|
| SWE-Bench Verified | 76.8% | ~80.9% | -- | 77.8% | -- |
| SWE-Bench Pro | 50.7% | -- | -- | 58.4% | 56.8% |
| Code Arena Elo | ~1430 | 1542 | -- | ~1530 | -- |
| Terminal-Bench 2.0 | 50.8 | 57.5 | -- | 54.9 | -- |
| HumanEval | 99.0% | -- | -- | -- | -- |
| LiveCodeBench v6 | 85.0% (swarm) | -- | -- | -- | -- |
| CyberGym | 41.3 | -- | -- | 68.7 | -- |

### Reasoning & Knowledge

| Benchmark | K2.5 | Claude Opus 4.6 | GLM-5.1 | GPT-5.2 |
|-----------|------|-----------------|---------|---------|
| GPQA Diamond | 87.6% | ~91.3% | 86.0% | ~92.4% |
| AIME 2025 | 96.1% | ~99.8% | 92.7% | 100% |
| MMLU-Pro | 87.1% | -- | -- | -- |
| HLE-Full | 30.1% | -- | -- | -- |
| HLE-Full (w/ tools) | 50.2% | -- | -- | -- |

### Agentic

| Benchmark | K2.5 | GLM-5.1 |
|-----------|------|---------|
| MCP Atlas | 29.5% | 71.8% |
| Agentic Average | 54.6 | 65.3 |
| BrowseComp (Agent Swarm) | 78.4% | -- |

### Vision (K2.5 — GLM-5.1 has no vision)

| Benchmark | K2.5 |
|-----------|------|
| MMMU-Pro | 78.5 |
| MathVision | 84.2 |
| OCRBench | 92.3 |
| VideoMMMU | 86.6 |

**Artificial Analysis Intelligence Index:** 47/100 `[K2.5]` (#4 out of 71 models).

## K2.5 Standout Capabilities

1. **Agent Swarm** — can coordinate up to 100 specialized sub-agents in parallel, up to 1,500 tool calls per task. Reduces execution time by 4.5x vs single-agent. `[K2.5]`
2. **Open-weight at frontier quality** — most significant open-source release since Llama 3. Modified MIT license. `[K2.5]`
3. **Native multimodality** — vision-language trained from the start (MoonViT). Strong video understanding. `[K2.5]`
4. **Cost efficiency** — 5-6x cheaper than Claude Sonnet, 4-17x cheaper than GPT-5.4. `[K2.5]`
5. **Competitive programming** — 85% LiveCodeBench, 99% HumanEval. `[K2.5]`
6. **Math reasoning** — 96.1% AIME 2025, near top of all models. `[K2.5]`
7. **Automatic prompt caching** — 75% discount on cached input, applied automatically. `[K2.5]`

## K2.5 Known Weaknesses

1. **SWE-Bench gap** — 76.8% Verified trails Claude (80.9%), Gemini 3.1 Pro (80.6%), Qwen3-Max (88.3%). `[K2.5]`
2. **Agentic endurance gap** — MCP Atlas 29.5% vs GLM-5.1's 71.8%. Struggles with sustained sequential agentic tasks. `[K2.5]`
3. **Orchestrator collapse** — known issue where parallel Agent Swarm falls back to single-agent loops. `[K2.5]` Partially addressed in K2.6.
4. **Speed** — 34.6 tok/s, described as "notably slow." `[K2.5]`
5. **Verbose output** — 89M tokens during evaluation. Often over-engineers code on first pass. `[K2.5]`
6. **Context window** — 256K is large but significantly shorter than Claude Opus 4.6's 1M. `[K2.5]`
7. **Hallucination rate** — higher than frontier closed models on edge cases. `[K2.5]`
8. **English prose** — ~8.5/10 vs ChatGPT 9/10. Fine for code, slightly weaker for natural language. `[K2.5]`
9. **Ecosystem maturity** — Kimi Code CLI has ~6.4K stars. Documentation stronger in Chinese. `[K2.5]`

## K2.6 Code Preview: What Changed

K2.6 is a coding-specialized variant built on the same K2.5 foundation. Released to all Kimi Code subscribers 2026-04-13, still in preview as of this writing. **No official benchmarks published yet.**

### Confirmed Improvements `[K2.6]`

1. **Deeper reasoning traces** — more verbose, Claude Opus-style chain-of-thought reasoning
2. **Cleaner multi-step agent plans** — better task decomposition for complex coding workflows
3. **More reliable tool call execution** — fewer failed or malformed tool calls
4. **Better orchestrator routing** — fixes the K2.5 orchestrator collapse weakness (parallel Agent Swarm stays parallel more reliably)
5. **Code-specific tuning** — optimized for large codebase analysis, full-stack development, complex debugging, and code review

### Community Reception `[K2.6]`

- Beta testers describe it as "Opus-flavored" — the quality jump mirrors K2 → K2-Thinking in late 2025
- Described as "a real improvement" on agent planning
- CLI access initially lagged behind dashboard rollout

### What We Don't Know `[K2.6]`

- No official SWE-Bench, Code Arena, or GPQA scores published
- No speed or verbosity measurements
- Weights not released (cannot self-host)
- Unknown whether vision capabilities changed
- Token quota: 300-1,200 API calls per 5-hour window (subscription dependent)

---

## Work Type Fit Assessment

### Currently Deployed

#### `issue-agent:implementation`
**Current default:** Kimi K2.5 | **Fit:** Good (K2.5), potentially Excellent (K2.6)

K2.5 is already the default here and performing well. The key question is whether K2.6's improvements in reasoning and tool call reliability justify switching. Given that K2.6 addresses orchestrator collapse and adds deeper reasoning — both directly relevant to long implementation sessions — upgrading to K2.6 is recommended once it exits preview.

**vs GLM-5.1:** GLM-5.1 leads on SWE-Bench Pro (58.4 vs 50.7) and Code Arena (~1530 vs ~1430). GLM's 8-hour autonomous endurance is a stronger story than K2.5's Agent Swarm for sustained single-agent work. However, K2.6's improvements may close the gap. Recommend benchmarking both on real Panopticon issues.

### Excellent Fit

#### `specialist-test-agent`
**Current default:** Claude Sonnet 4.6 | **Fit:** Good `[K2.5]`, Excellent `[K2.6]`

Test execution + output parsing + root cause analysis. K2.5's 99% HumanEval and strong algorithmic coding translate well to test writing. K2.6's improved tool call reliability directly helps here (test agents issue many sequential tool calls). Vision capability is a bonus for UAT-adjacent test work (can read error screenshots). 5-6x cheaper than Sonnet.

#### `specialist-merge-agent`
**Current default:** Claude Sonnet 4.6 | **Fit:** Good `[K2.5]`

Structured git operations. K2.5's code understanding handles conflict resolution well. Cost savings are the primary win. The merge flow is procedural enough that K2.5's weaker agentic endurance (vs GLM-5.1) doesn't matter — merges are short.

### Good Fit — Worth Benchmarking

#### `issue-agent:testing`
**Current default:** Claude Sonnet 4.6 | **Fit:** Good `[K2.5]`

Similar to specialist-test-agent. Strong algorithmic coding helps with test generation. Vision could be useful if test failures produce visual output.

#### `issue-agent:review-response`
**Current default:** Claude Sonnet 4.6 | **Fit:** Good `[K2.5]`, likely better `[K2.6]`

Reading feedback and implementing fixes. K2.6's deeper reasoning should help interpret nuanced review comments. Cost savings vs Sonnet.

#### `convoy:performance-reviewer`
**Current default:** Claude Sonnet 4.6 | **Fit:** Moderate-Good `[K2.5]`

K2.5 has reasonable code analysis capability. Verbosity is a concern for structured review output. K2.6's improved reasoning may help with performance anti-pattern detection.

#### `convoy:correctness-reviewer`
**Current default:** Claude Sonnet 4.6 | **Fit:** Moderate-Good `[K2.5]`

Logic and edge case review. K2.5's 87.6% GPQA Diamond suggests decent reasoning. K2.6 improvements would help.

#### `specialist-uat-agent`
**Current default:** Claude Sonnet 4.6 | **Fit:** Moderate `[K2.5]`

**Unlike GLM-5.1, Kimi has vision.** MoonViT can process screenshots and visual regression checks. However, Playwright MCP integration hasn't been tested with Kimi models in Panopticon, and OCR quality for UI elements is untested. Would need careful validation. The vision capability makes this theoretically possible where GLM-5.1 is disqualified.

### Poor Fit — Do Not Route

#### `planning-agent`
**Current default:** Claude Opus 4.6 | **Fit:** Poor `[K2.5]`

Planning needs top-tier reasoning and interactive questioning. GPQA 87.6% vs Opus 91.3% is a meaningful gap for architecture decisions. K2.6's deeper reasoning may narrow this, but no data yet. Keep on Opus until K2.6 benchmarks prove otherwise.

#### `convoy:security-reviewer`
**Current default:** Claude Opus 4.6 | **Fit:** Poor `[K2.5]`

Security review is a safety-critical gate. Hallucination rate concerns and the reasoning gap make K2.5 unsuitable. K2.6 might improve, but security gates should stay on the strongest reasoner.

#### `convoy:requirements-reviewer`
**Current default:** Claude Opus 4.6 | **Fit:** Poor `[K2.5]`

Planning-heavy (0.5 weight). Needs deep spec-to-implementation cross-referencing. Keep on Opus.

#### `issue-agent:exploration`
**Current default:** Claude Opus 4.6 | **Fit:** Poor `[K2.5]`

Needs fast codebase scanning. K2.5 at 34.6 tok/s is even slower than GLM-5.1. Exploration rewards speed.

#### `issue-agent:documentation`
**Current default:** Claude Sonnet 4.6 | **Fit:** Poor `[K2.5]`

English prose quality rated ~8.5/10 and verbose output work against documentation quality. Sonnet produces cleaner docs.

#### All subagents (`explore`, `plan`, `bash`, `general-purpose`)
**Current defaults:** Haiku 4.5 / Sonnet 4.6 | **Fit:** Disqualified `[K2.5]`

34.6 tok/s is far too slow for subagents that need to return in seconds.

#### `cli:interactive` and `cli:quick-command`
**Current defaults:** Sonnet 4.6 / Haiku 4.5 | **Fit:** Disqualified `[K2.5]`

User-facing latency. Kimi's speed makes it unsuitable for interactive CLI use.

#### `convoy:synthesis-agent`
**Current default:** Claude Sonnet 4.6 | **Fit:** Poor `[K2.5]`

Synthesis needs concise integration. Verbosity is a direct liability.

#### `specialist-inspect-agent`
**Current default:** Claude Sonnet 4.6 | **Fit:** Poor `[K2.5]`

Per-bead inspection runs frequently (3-8 min per bead). Speed matters. K2.5 is too slow to avoid bottlenecking the implementation loop.

---

## K2.5 vs GLM-5.1: Head-to-Head for Implementation

The key routing decision for `issue-agent:implementation`:

| Factor | Kimi K2.5 | GLM-5.1 | Winner |
|--------|-----------|---------|--------|
| SWE-Bench Pro | 50.7% | 58.4% | GLM-5.1 |
| SWE-Bench Verified | 76.8% | 77.8% | GLM-5.1 (narrow) |
| Code Arena Elo | ~1430 | ~1530 | GLM-5.1 |
| Autonomous endurance | Agent Swarm (parallel) | 8-hour single-agent | GLM-5.1 (for Panopticon's model) |
| MCP Atlas (agentic) | 29.5% | 71.8% | GLM-5.1 |
| Vision | Yes (MoonViT) | No | Kimi K2.5 |
| Context window | 256K | 200K | Kimi K2.5 |
| Price (input) | $0.60/M | $1.00-1.40/M | Kimi K2.5 |
| Price (output) | $2.50/M | $3.15-4.40/M | Kimi K2.5 |
| Speed | 34.6 tok/s | 40.3 tok/s | GLM-5.1 (slightly) |
| Open-weight | Yes (Modified MIT) | Yes (MIT) | Tie |

**Assessment:** GLM-5.1 is the stronger model for implementation work on benchmarks, especially for Panopticon's single-agent-per-workspace architecture where sustained sequential autonomy matters more than parallel sub-agent swarms. However, K2.5 is cheaper and K2.6 may close the gap. Recommend running both on 5-10 real issues and comparing output quality, completion rate, and effective cost (factoring in verbosity).

---

## Summary

| Tier | Work Types | K2.5 | K2.6 (projected) |
|------|-----------|------|-------------------|
| **Already deployed** | `issue-agent:implementation` | Good | Excellent (upgrade when GA) |
| **Benchmark next** | `specialist-test-agent`, `specialist-merge-agent` | Good | Excellent |
| **Worth trying** | `issue-agent:testing`, `issue-agent:review-response`, `convoy:performance-reviewer`, `convoy:correctness-reviewer` | Moderate-Good | Good |
| **Interesting edge case** | `specialist-uat-agent` | Moderate (has vision, needs validation) | TBD |
| **Never** | Planning, security review, requirements review, exploration, documentation, all subagents, CLI modes, inspect-agent, synthesis | Poor/Disqualified | Unlikely to change |

## Action Items

1. **K2.6 GA watch** — monitor for official benchmarks and weight release. Upgrade `issue-agent:implementation` default when data confirms no regressions.
2. **GLM-5.1 vs K2.5 benchmark** — run both on 5-10 real implementation issues. Compare completion rate, bead pass rate, effective cost.
3. **K2.5 for test-agent trial** — route `specialist-test-agent` to K2.5 for one sprint and measure cost savings vs quality delta.
4. **K2.5 UAT-agent experiment** — test Playwright MCP + MoonViT integration in a sandbox. If screenshots are readable, K2.5 could be a cheaper UAT option with vision.

## Sources

- [Hugging Face - moonshotai/Kimi-K2.5](https://huggingface.co/moonshotai/Kimi-K2.5)
- [Kimi K2.6 Code Preview - BuildFastWithAI](https://www.buildfastwithai.com/blogs/kimi-code-k26-preview-2026)
- [Kimi K2.6 Deep Dive - kimi-k2.org](https://kimi-k2.org/blog/23-kimi-k2-6-code-preview)
- [Artificial Analysis - Kimi K2.5](https://artificialanalysis.ai/models/kimi-k2-5)
- [OpenRouter - Kimi K2.5 Pricing](https://openrouter.ai/moonshotai/kimi-k2.5)
- [Kimi K2.5 Benchmark Comparison](https://kimi-k25.com/blog/kimi-k2-5-benchmark)
- [Best AI Models April 2026 - BuildFastWithAI](https://www.buildfastwithai.com/blogs/best-ai-models-april-2026)
- [GPT-5.3-Codex vs Claude Opus vs Kimi](https://www.buildfastwithai.com/blogs/gpt-5-3-codex-vs-claude-opus-vs-kimi)
- [Qwen 3.6 Plus vs GLM-5.1 vs Kimi 2.5](https://www.buildfastwithai.com/blogs/qwen-3-6-plus-vs-glm-5-1-vs-kimi-2-5-coding-2026)
- [Kimi K2.5 Pricing - NxCode](https://www.nxcode.io/resources/news/kimi-k2-5-pricing-plans-api-costs-2026)
- [Kimi official tech blog](https://www.kimi.com/blog/kimi-k2-5)
- [BenchLM - K2.6 vs K2.5](https://benchlm.ai/compare/kimi-2-6-vs-kimi-k2-5)
