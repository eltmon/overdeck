# Qwen 3.6 Work Type Fit Analysis

Research date: 2026-04-17

Evaluates Alibaba's Qwen 3.6 family against Panopticon's 23 work types. Two variants exist:

- **Qwen 3.6 Plus** — proprietary API-only flagship, undisclosed parameter count, 1M context window
- **Qwen 3.6-35B-A3B** — open-weight (Apache 2.0), 35B total / 3B active MoE, 262K context

The "Plus" designation in Qwen's naming is their proprietary API tier (same pattern as Qwen 3.5 Plus). The open-weight 35B is a smaller model that punches well above its weight via sparse MoE.

## Model Profiles

### Qwen 3.6 Plus (Proprietary Flagship)

| Spec | Value |
|------|-------|
| **Vendor** | Alibaba Cloud (Qwen team) |
| **Release** | Late March / early April 2026 |
| **Architecture** | Hybrid linear attention + sparse MoE (undisclosed size) |
| **Context Window** | 1,000,000 tokens (1M) |
| **Max Output** | 65,536 tokens |
| **Modalities** | Text + Image (vision understanding) |
| **License** | Proprietary (API only) |
| **Pricing (input, 0-256K)** | $0.40/M |
| **Pricing (output, non-thinking)** | $1.20/M |
| **Pricing (output, thinking)** | $4.00/M |
| **Pricing (256K-1M input)** | $1.20/M |
| **Pricing (256K-1M output, non-thinking)** | $3.60/M |
| **OpenRouter** | $0.325/M input, $1.95/M output (currently free preview) |
| **Speed** | ~3x faster output than Claude Opus 4.6 |
| **MCP Support** | Native |
| **Computer Use** | Yes |

### Qwen 3.6-35B-A3B (Open-Weight)

| Spec | Value |
|------|-------|
| **Total Parameters** | 35B |
| **Active Parameters** | ~3B (sparse MoE) |
| **Architecture** | 40 layers, Gated DeltaNet (linear attention) + Gated Attention + MoE (256 experts, 8 routed + 1 shared) |
| **Context Window** | 262K native, extendable to ~1M via YaRN |
| **Max Output** | 32,768 (general), 81,920 (complex tasks) |
| **Modalities** | Text + Image + Video + Document/OCR |
| **License** | Apache 2.0 (fully open) |
| **Self-hosting** | SGLang >=0.5.10, vLLM >=0.19.0, KTransformers, HF Transformers |

**Cost comparison (Plus, 0-256K context):**
- vs Opus 4.6 ($5/$25): **12.5x cheaper input, 21x cheaper output** (non-thinking)
- vs Sonnet 4.6 ($3/$15): **7.5x cheaper input, 12.5x cheaper output**
- vs Kimi K2.5 ($0.60/$2.50): **1.5x cheaper input, 2x cheaper output**
- vs MiniMax M2.7 ($0.30/$1.20): **Comparable** (M2.7 slightly cheaper)
- vs GLM-5.1 ($1.40/$4.20): **3.5x cheaper input, 3.5x cheaper output**

**Warning:** Pricing jumps 3x for contexts above 256K. The 1M context window is available but expensive.

## Key Benchmarks

### Qwen 3.6 Plus

#### Coding

| Benchmark | Qwen 3.6 Plus | Opus 4.6 | Sonnet 4.6 | GLM-5.1 | Kimi K2.5 | M2.7 | Gemini 3 Pro |
|-----------|---------------|----------|------------|---------|-----------|------|-------------|
| SWE-Bench Verified | 78.8% | ~80.9% | -- | 77.8% | 76.8% | 73.8% (ind.) | -- |
| SWE-Bench Pro | 56.6% | ~57.3% | -- | 58.4% | 50.7% | 56.22% (self) | -- |
| Terminal-Bench 2.0 | **61.6%** | 59.3% | -- | ~54.9% | 50.8% | 47.19% (ind.) | -- |
| SWE-Bench Multilingual | 73.8% | -- | -- | -- | 73.0% | 76.5% (self) | 77.5% |
| NL2Repo | 37.9% | -- | -- | -- | -- | 39.8% (self) | 43.2% |
| Claw-Eval | 58.7% | 59.6% | -- | -- | 52.9% | -- | -- |

**Standout:** Terminal-Bench 2.0 at 61.6% — beats Claude Opus 4.6 (59.3%). This benchmark measures real terminal/CLI agent work, directly relevant to Panopticon's implementation agents.

#### Reasoning & Knowledge

| Benchmark | Qwen 3.6 Plus | Opus 4.6 | GLM-5.1 | Kimi K2.5 | M2.7 |
|-----------|---------------|----------|---------|-----------|------|
| GPQA Diamond | -- | ~91.3% | 86.0% | 87.6% | 86.62% |
| AIME 2025 | -- | ~99.8% | 92.7% | 96.1% | 91.04% |

Note: Qwen has not published GPQA/AIME scores for 3.6 Plus specifically. BenchLM rates reasoning at 44.2/100 — a significant concern.

#### Vision & Document Understanding

| Benchmark | Qwen 3.6 Plus | Opus 4.6 | Kimi K2.5 |
|-----------|---------------|----------|-----------|
| OmniDocBench v1.5 | **91.2** | 87.7 | 88.8 |
| RealWorldQA | **85.4** | 77.0 | -- |
| MMMU | 86.0 | -- | 84.3 |
| Video-MME | 87.8 | 77.6 | 87.4 |

**Standout:** Best-in-class document understanding and real-world visual QA. Significantly ahead of Claude on OmniDocBench (+3.5) and RealWorldQA (+8.4).

#### Agentic

| Benchmark | Qwen 3.6 Plus | Notes |
|-----------|---------------|-------|
| MCPMark | 37.0 | Improved from 27.0 (3.5) |
| QwenWebBench Elo | 1502 | Web agent benchmark |

### Qwen 3.6-35B-A3B (Open-Weight)

| Benchmark | Score | Context |
|-----------|-------|---------|
| SWE-Bench Verified | 73.4% | With only 3B active params |
| SWE-Bench Pro | 49.5% | Beats models 10x its active size |
| Terminal-Bench 2.0 | 51.5% | |
| GPQA Diamond | 86.0% | Matches GLM-5.1 |
| AIME 2026 | 92.7% | |
| MMLU-Pro | 85.2% | |
| LiveCodeBench v6 | 80.4% | |
| MCP-Atlas | 62.8% | Strong agentic tool use |
| Claw-Eval | 68.7% | Higher than Plus (58.7%) on this benchmark |

## Standout Capabilities

1. **Terminal-Bench 2.0 leader (Plus)** — 61.6% beats Claude Opus 4.6 (59.3%). Best benchmark result for real terminal/CLI agent work. Directly maps to Panopticon's implementation workflow.
2. **1M context window (Plus)** — largest among competitors at this quality tier. Enables full-codebase reasoning without chunking. Critical for exploration and large refactors.
3. **Best document/vision understanding** — OmniDocBench 91.2%, RealWorldQA 85.4%. Leads the field by significant margins. Has native vision — unlike GLM-5.1 and M2.7 which are text-only.
4. **Native MCP + Computer Use** — built-in MCP tool integration and GUI interaction. Purpose-built for agentic workflows.
5. **Price/performance** — 12-21x cheaper than Opus while approaching its benchmark scores. Comparable to M2.7's pricing tier.
6. **Speed** — ~3x faster output than Claude Opus 4.6. Critical for interactive and high-volume work types.
7. **Overthinking fix** — 515 fewer reasoning tokens than Qwen 3.5 Plus while producing more output. More efficient token usage = lower effective cost.
8. **Perfect consistency** — 10.0 consistency score with zero flaky tests in production testing. Reliable for automated pipelines.
9. **Open-weight option** — 35B-A3B under Apache 2.0 is genuinely self-hostable with only 3B active params. Beats models 10x its size.
10. **Default params tuned for production** — Temperature 0.2 / top_p 0.9 (more deterministic than 3.5's 0.6/0.95).

## Known Weaknesses

1. **Reasoning benchmark gap** — BenchLM rates reasoning at only 44.2/100. No published GPQA/AIME scores for Plus. This is the biggest concern for planning and security work types.
2. **Hallucination reports** — developers report it "hallucinates a lot more" than Sonnet and "will consistently ignore" explicit instructions. Critical for autonomous agents where hallucinations compound.
3. **NL2Repo gap** — 37.9% vs Gemini 3 Pro at 43.2%. Weaker at generating entire repositories from scratch.
4. **Security coding** — only 43.3% hidden test success rate on security tasks. Concerning for security-adjacent work.
5. **Closed-weight flagship** — Plus model is API-only, disappointing given Alibaba's open-source reputation. HN developers frustrated.
6. **Data privacy concerns** — Alibaba's data terms are a red flag for production use with sensitive code. Panopticon agents process proprietary codebases.
7. **No long-term track record** — brand new (late March/early April 2026). Production reliability unproven.
8. **Benchmark comparison controversy** — Alibaba compared against Claude 4.5 Opus (not current 4.6), which developers called deceptive.
9. **TTFT on free tier** — 11.5s average time-to-first-token. May not apply to paid API but worth monitoring.
10. **Context pricing cliff** — 3x price increase for contexts above 256K. The 1M window is powerful but expensive for large codebases.

---

## Work Type Fit Assessment

### Excellent Fit

#### `issue-agent:implementation`
**Current default:** Kimi K2.5 | **Qwen 3.6 Plus fit:** Excellent

The Terminal-Bench 2.0 score (61.6%) is the highest of any model we've evaluated — beating Opus 4.6 (59.3%), GLM-5.1 (~54.9%), and K2.5 (50.8%). Terminal-Bench directly measures CLI agent effectiveness, which is exactly what our implementation agents do. Combined with SWE-Bench Pro 56.6% (competitive with GLM-5.1's 58.4% and ahead of K2.5's 50.7%), native MCP support, and pricing comparable to K2.5, this is a strong candidate to replace or benchmark alongside K2.5.

The consistency score (10.0, zero flaky tests) is particularly valuable for long autonomous sessions — hallucinations and flaky behavior compound over multi-hour runs.

**Concern:** Hallucination reports from developers. Benchmark consistency doesn't necessarily mean instruction-following consistency.

#### `specialist-test-agent`
**Current default:** Claude Sonnet 4.6 | **Qwen 3.6 Plus fit:** Excellent

Test execution is procedural + analytical. Plus is fast (~3x Opus), cheap (~12x cheaper than Sonnet), and has native MCP for tool orchestration. The vision capability is a bonus — can read error screenshots or test failure UI if needed. SWE-Bench Verified 78.8% shows strong code understanding for root cause analysis.

#### `issue-agent:exploration`
**Current default:** Claude Opus 4.6 | **Qwen 3.6 Plus fit:** Excellent

This is where the 1M context window is transformative. Current default (Opus, 200K) requires selective reading. Plus can ingest significantly more codebase context in a single pass. Combined with ~3x Opus speed and vision (can read architecture diagrams, screenshots), this is the strongest exploration candidate. 12.5x cheaper than Opus.

**Concern:** The 256K→1M pricing cliff means cost-efficient exploration stays under 256K. Above that, cost per issue rises significantly.

### Good Fit — Worth Benchmarking

#### `specialist-inspect-agent`
**Current default:** Claude Sonnet 4.6 | **Qwen 3.6 Plus fit:** Good

Per-bead inspection needs speed (runs frequently) and code understanding. Plus is ~3x faster than Opus and has strong code comprehension. Vision capability helps if inspecting UI changes. 7.5x cheaper than Sonnet.

#### `issue-agent:testing`
**Current default:** Claude Sonnet 4.6 | **Qwen 3.6 Plus fit:** Good

Test writing + coverage analysis. Similar profile to specialist-test-agent. Native MCP and speed are advantages.

#### `issue-agent:review-response`
**Current default:** Claude Sonnet 4.6 | **Qwen 3.6 Plus fit:** Good

Reading review feedback and implementing fixes. Fast turnaround matters here (user is waiting for the review-fix cycle). Plus's speed advantage helps. Claw-Eval 58.7% (close to Opus's 59.6%) suggests competitive code quality.

#### `convoy:performance-reviewer`
**Current default:** Claude Sonnet 4.6 | **Qwen 3.6 Plus fit:** Good

Performance analysis benefits from large context (can see more of the codebase at once). 1M window is useful for understanding system-wide performance implications. Speed means convoy lanes complete faster.

#### `convoy:correctness-reviewer`
**Current default:** Claude Sonnet 4.6 | **Qwen 3.6 Plus fit:** Moderate-Good

Logic review. The reasoning concern (BenchLM 44.2/100) is relevant here — correctness review needs strong logical reasoning. Benchmark against Sonnet on real diffs before deploying.

#### `specialist-uat-agent`
**Current default:** Claude Sonnet 4.6 | **Qwen 3.6 Plus fit:** Good

**Key differentiator:** Plus has vision AND native computer use. OmniDocBench 91.2% and RealWorldQA 85.4% show best-in-class visual understanding. Unlike GLM-5.1 (disqualified, no vision) and M2.7 (disqualified, no vision), Plus can analyze Playwright screenshots effectively. Native computer use capability aligns with browser-based UAT.

**Concern:** Playwright MCP integration with Qwen models hasn't been tested in Panopticon. Need validation.

#### `specialist-merge-agent`
**Current default:** Claude Sonnet 4.6 | **Qwen 3.6 Plus fit:** Good

Structured git operations. Fast, cheap, and reliable. The consistency score (10.0) is valuable for merge reliability. Lower priority than other candidates since merges are lower-volume.

#### `convoy:synthesis-agent`
**Current default:** Claude Sonnet 4.6 | **Qwen 3.6 Plus fit:** Moderate-Good

Synthesis needs concise integration. The "overthinking fix" from 3.5 → 3.6 (515 fewer reasoning tokens) suggests more efficient output. Worth benchmarking output conciseness.

#### `issue-agent:documentation`
**Current default:** Claude Sonnet 4.6 | **Qwen 3.6 Plus fit:** Moderate

OmniDocBench leadership suggests strong document generation. However, hallucination reports and instruction-ignoring are concerning for documentation accuracy. Benchmark against Sonnet.

### Poor Fit — Do Not Route

#### `planning-agent`
**Current default:** Claude Opus 4.6 | **Qwen 3.6 Plus fit:** Poor

BenchLM reasoning at 44.2/100 is disqualifying. Planning needs the strongest reasoner for architecture decisions, requirement decomposition, and tradeoff analysis. No published GPQA/AIME scores for Plus. Keep on Opus.

**Exception:** The 1M context window could be valuable for planning large issues with extensive PRDs. Consider a hybrid: Opus for reasoning + Plus for context ingestion (exploration phase of planning).

#### `convoy:security-reviewer`
**Current default:** Claude Opus 4.6 | **Qwen 3.6 Plus fit:** Poor

Security coding at 43.3% hidden test success rate is below frontier. Security review is a safety-critical gate. The reasoning gap and hallucination reports make this too risky.

#### `convoy:requirements-reviewer`
**Current default:** Claude Opus 4.6 | **Qwen 3.6 Plus fit:** Poor

Planning-heavy (0.5 weight). Needs strong reasoning to cross-reference specs. BenchLM reasoning score disqualifies.

#### `specialist-review-agent`
**Current default:** Claude Opus 4.6 | **Qwen 3.6 Plus fit:** Poor

Pre-merge quality gate. Hallucination reports and instruction-ignoring are exactly the wrong traits for a review gate. Keep on Opus.

#### All subagents (`explore`, `plan`, `bash`, `general-purpose`)
**Current defaults:** Haiku 4.5 / Sonnet 4.6 | **Qwen 3.6 Plus fit:** Moderate for `explore` (1M context), Poor for others

Subagents need fast TTFT and quick completion. The 11.5s TTFT (if it applies to paid tier) would be painful. The `subagent:explore` use case could benefit from 1M context for scanning large codebases, but latency concerns remain. Other subagents are better served by Haiku.

#### `cli:interactive` and `cli:quick-command`
**Current defaults:** Sonnet 4.6 / Haiku 4.5 | **Qwen 3.6 Plus fit:** Poor

TTFT concerns and hallucination reports make this unsuitable for user-facing interaction.

---

## Qwen 3.6 Plus vs Competitors: Implementation Routing

| Factor | Qwen 3.6 Plus | GLM-5.1 | Kimi K2.5 | M2.7 | Opus 4.6 |
|--------|---------------|---------|-----------|------|----------|
| SWE-Bench Verified | 78.8% | 77.8% | 76.8% | 73.8% (ind.) | ~80.9% |
| SWE-Bench Pro | 56.6% | **58.4%** | 50.7% | 56.22% (self) | ~57.3% |
| Terminal-Bench 2.0 | **61.6%** | ~54.9% | 50.8% | 47.19% (ind.) | 59.3% |
| Context Window | **1M** | 200K | 256K | 200K | 200K |
| Vision | Yes | No | Yes | No | Yes |
| Speed | **~3x Opus** | ~40 tok/s | ~35 tok/s | ~40 tok/s | Baseline |
| Price (input/output) | $0.40/$1.20 | $1.40/$4.20 | $0.60/$2.50 | **$0.30/$1.20** | $5/$25 |
| Autonomous endurance | Unknown | **8 hours** | Agent Swarm | Unknown | -- |
| MCP Native | **Yes** | No | No | No | No |
| Consistency | **10.0** | -- | -- | -- | -- |
| Hallucination risk | **Higher** | Unknown | Higher | Unknown | Low |

**Assessment:** Qwen 3.6 Plus has the best Terminal-Bench score, fastest speed, largest context window, native MCP, and vision — on paper the most well-rounded implementation candidate. The concerns are hallucination reports and the unproven reasoning score. GLM-5.1 leads on SWE-Bench Pro and autonomous endurance. M2.7 wins on raw cost.

**Recommendation:** Benchmark Qwen 3.6 Plus alongside GLM-5.1 and K2.5 on 5-10 real implementation issues. If hallucination concerns don't manifest in Panopticon's structured bead workflow (which constrains scope per step), Plus could become the default implementation model.

---

## The 35B-A3B for Self-Hosted Use

The open-weight Qwen 3.6-35B-A3B deserves separate mention for potential self-hosted deployment:

- **3B active parameters** — runs on a single consumer GPU
- **SWE-Bench Verified 73.4%** with 3B active — remarkable efficiency
- **MCP-Atlas 62.8%** — strong agentic tool use (vs K2.5's 29.5%)
- **Apache 2.0** — no licensing concerns
- **Potential use:** Local subagent for `subagent:explore` and `subagent:bash` where you want zero API cost and can tolerate slightly lower quality

This model could be interesting for Panopticon's self-hosted deployment story if/when that becomes a goal.

---

## Summary

| Tier | Work Types | Variant | Rationale |
|------|-----------|---------|-----------|
| **Deploy now** | `issue-agent:exploration` | Plus | 1M context + 3x speed + vision. Transformative for codebase scanning |
| **Benchmark next** | `issue-agent:implementation` | Plus | Best Terminal-Bench score, but hallucination concerns need validation |
| **Benchmark next** | `specialist-test-agent`, `specialist-inspect-agent` | Plus | Speed + cost + native MCP |
| **Worth trying** | `specialist-uat-agent` | Plus | Vision + computer use — validate Playwright MCP integration |
| **Worth trying** | `specialist-merge-agent`, `issue-agent:testing`, `issue-agent:review-response` | Plus | Cost savings + speed |
| **Worth trying** | `convoy:performance-reviewer`, `convoy:correctness-reviewer`, `convoy:synthesis-agent` | Plus | Cost savings, benchmark output quality |
| **Maybe** | `issue-agent:documentation` | Plus | OmniDocBench is strong, but hallucination risk |
| **Never** | Planning (reasoning gap), security review (43.3% security score), requirements review, specialist-review (hallucination risk), CLI modes (TTFT) |

## Data Privacy Consideration

Alibaba Cloud's data terms should be reviewed before routing proprietary codebase content through their API. If data privacy is a concern, the 35B-A3B open-weight model can be self-hosted with no data leaving the network. This is a meaningful advantage over GLM-5.1 (self-hosting impractical at 1,490GB) and M2.7 (commercial license requires authorization).

## Integration Notes

- Qwen is available via Alibaba Bailian API and OpenRouter
- Would need a new provider in Panopticon (or route through OpenRouter)
- Model IDs: `qwen3.6-plus` (API), `qwen/qwen3.6-plus` (OpenRouter)
- Suggested capability scores (Plus):
  - code-generation: 90, code-review: 86, debugging: 82, planning: 72, documentation: 82, testing: 88, security: 70, performance: 82, synthesis: 80, speed: 80, context-length: 98
- Note: context-length scored 98 due to 1M window, but effective cost at >256K is 3x

## Sources

- [Qwen 3.6 Plus Official Blog](https://qwen.ai/blog?id=qwen3.6)
- [BuildFastWithAI Preview](https://www.buildfastwithai.com/blogs/qwen-3-6-plus-preview-review)
- [HuggingFace 35B-A3B](https://huggingface.co/Qwen/Qwen3.6-35B-A3B)
- [RenovateQR Review](https://renovateqr.com/blog/qwen-3-6-plus-review-benchmarks-2026)
- [LushBinary Developer Guide](https://lushbinary.com/blog/qwen-3-6-developer-guide-benchmarks-architecture-api-self-hosting/)
- [OpenRouter](https://openrouter.ai/qwen/qwen3.6-plus)
- [BenchLM.ai](https://benchlm.ai/models/qwen3-6-plus)
- [HN Discussion](https://news.ycombinator.com/item?id=47615002)
- [Alibaba Cloud Pricing](https://www.alibabacloud.com/help/en/model-studio/model-pricing)
- [Qwen 3.6 Plus vs GLM-5.1 vs Kimi 2.5](https://www.buildfastwithai.com/blogs/qwen-3-6-plus-vs-glm-5-1-vs-kimi-2-5-coding-2026)
- [MarkTechPost 35B-A3B](https://www.marktechpost.com/2026/04/16/qwen-team-open-sources-qwen3-6-35b-a3b-a-sparse-moe-vision-language-model-with-3b-active-parameters-and-agentic-coding-capabilities/)
- [Artificial Analysis](https://artificialanalysis.ai/models/qwen3-6-plus)
