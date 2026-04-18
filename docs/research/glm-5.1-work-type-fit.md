# GLM-5.1 Work Type Fit Analysis

Research date: 2026-04-17

Evaluates Z.ai's GLM-5.1 against Panopticon's 23 work types to identify where it would add value as a routing option.

## Model Profile

| Spec | Value |
|------|-------|
| **Vendor** | Z.ai (formerly Zhipu AI, Tsinghua spinoff, HKEX IPO Jan 2026) |
| **Architecture** | Mixture-of-Experts, 744B total / 40B active per token |
| **Context Window** | 200K tokens |
| **Max Output** | 131K tokens |
| **Modalities** | Text-only (no vision, audio, or video) |
| **License** | MIT, open-weight on Hugging Face (`zai-org/GLM-5.1`) |
| **Pricing** | ~$1.00-1.40/M input, ~$3.15-4.40/M output, $0.26/M cached |
| **Speed** | ~40.3 tok/s (median for class: 53.2) |
| **Verbosity** | High — generates ~3x more tokens than median during evaluation |
| **Training Hardware** | Huawei Ascend (zero Nvidia dependency) |

## Key Benchmarks

| Benchmark | GLM-5.1 | Claude Opus 4.6 | Claude Sonnet 4.6 | Kimi K2.5 | GPT-5.4 |
|-----------|---------|-----------------|-------------------|-----------|---------|
| SWE-Bench Pro | **58.4 (#1)** | 57.3 | -- | 50.7 | 57.7 |
| SWE-Bench Verified | 77.8% | 80.8% | -- | 76.8% | -- |
| Code Arena Elo | ~1530 (#3) | 1542 (#2) | -- | ~1430 | -- |
| GPQA Diamond | 86.0% | 91.3% | -- | 87.6% | -- |
| AIME 2025 | 92.7% | 99.8% | -- | 96.1% | -- |
| CyberGym | 68.7 | -- | -- | 41.3 | -- |
| Terminal-Bench + NL2Repo | 54.9 | 57.5 | -- | 50.8 | -- |

## Standout Capabilities

1. **8-hour autonomous execution** — sustains up to 1,700 autonomous steps without human intervention. Built a Linux desktop environment across 655 iterations in demos.
2. **SWE-Bench Pro #1** — top score on the hardest agentic software engineering benchmark.
3. **Open-weight at frontier quality** — first open-weight model in Code Arena top 3.
4. **6-10x cheaper than Opus** — significant cost advantage for high-volume agentic workloads.
5. **Strong agentic coding** — 94.6% of Opus-level coding performance on Z.ai's internal eval.

## Known Weaknesses

1. **Text-only** — no vision input. Cannot analyze screenshots, UI mockups, or visual regressions.
2. **Slow** — ~40 tok/s vs 53 median. Noticeably sluggish for interactive use.
3. **Verbose** — generates ~3x more tokens than peers, increasing effective cost despite low per-token pricing.
4. **Reasoning gap** — GPQA Diamond 86% vs Opus 91.3%. Weaker on tasks requiring deep abstract reasoning.
5. **Self-hosting impractical** — ~1,490GB memory requirement (8+ H100s minimum).
6. **Peak-hour surcharges** — 3x pricing during Beijing business hours (14:00-18:00 BJT).

---

## Work Type Fit Assessment

### Excellent Fit

#### `issue-agent:implementation`
**Current default:** Kimi K2.5 | **GLM-5.1 fit:** Excellent

The strongest match. Implementation is our longest-running, most autonomous phase (30 min to 4+ hours), and GLM-5.1's entire thesis is sustained autonomous coding. It holds #1 on SWE-Bench Pro, sustains 1,700-step loops over 8 hours, and scores 94.6% of Opus on code generation. Directly competes with Kimi K2.5 at similar pricing — but with a stronger agentic endurance story. The verbosity downside matters less when the agent is writing code, not chatting.

- SWE-Bench Pro: GLM 58.4 vs Kimi 50.7 (+15%)
- Code Arena: GLM ~1530 vs Kimi ~1430 (+100 Elo)
- Both text-only, both 200K+ context

#### `specialist-test-agent`
**Current default:** Claude Sonnet 4.6 | **GLM-5.1 fit:** Excellent

Primarily shell execution + test output parsing + root cause analysis. No vision needed, medium autonomy. GLM-5.1's strong agentic loop capability means it can iterate through test-fix-retest cycles effectively. Speed isn't critical here since tests themselves take time. Would be significantly cheaper than Sonnet while maintaining quality.

#### `specialist-merge-agent`
**Current default:** Claude Sonnet 4.6 | **GLM-5.1 fit:** Excellent

Structured multi-phase git operations (sync, merge, verify, build, push). Procedural agentic work is exactly what GLM-5.1 is optimized for. Conflict resolution benefits from strong code understanding. Low risk to trial since merge failures are detectable and reversible.

### Good Fit — Worth Benchmarking

#### `issue-agent:testing`
**Current default:** Claude Sonnet 4.6 | **GLM-5.1 fit:** Good

Test writing + execution + coverage analysis is coding-heavy work. The 200K context handles large test suites. Similar profile to specialist-test-agent but with more code generation weight.

#### `issue-agent:review-response`
**Current default:** Claude Sonnet 4.6 | **GLM-5.1 fit:** Good

Reading review feedback and implementing fixes is an agentic coding loop — iterative problem-solving where GLM-5.1 competes well. Cost savings would be the primary win.

#### `convoy:performance-reviewer` and `convoy:correctness-reviewer`
**Current defaults:** Claude Sonnet 4.6 | **GLM-5.1 fit:** Moderate-Good

Single-burst code reading tasks. GLM-5.1's code understanding is strong. Slowness matters less since convoy lanes run in parallel. Verbosity is a concern — these should produce concise, structured findings, not verbose analysis. Worth benchmarking output quality.

### Poor Fit — Do Not Route

#### `specialist-uat-agent`
**Current default:** Claude Sonnet 4.6 | **GLM-5.1 fit:** Disqualified

Hard no. Requires vision (Playwright screenshots, visual regression detection). GLM-5.1 is text-only.

#### `planning-agent`
**Current default:** Claude Opus 4.6 | **GLM-5.1 fit:** Poor

Needs top-tier reasoning, synthesis, and interactive questioning. GPQA Diamond gap (86% vs 91.3%) means weaker architectural judgment. Planning is where you want the strongest reasoner. Keep on Opus.

#### `convoy:security-reviewer`
**Current default:** Claude Opus 4.6 | **GLM-5.1 fit:** Poor

Security review demands deep reasoning about attack vectors and subtle vulnerabilities. Currently on Opus for good reason (98/100 security capability score). The reasoning gap makes this too risky for a security gate.

#### `convoy:requirements-reviewer`
**Current default:** Claude Opus 4.6 | **GLM-5.1 fit:** Poor

Planning-heavy (0.5 weight) — needs to cross-reference specs against implementation. Reasoning-heavy, not coding-heavy.

#### `issue-agent:exploration`
**Current default:** Claude Opus 4.6 | **GLM-5.1 fit:** Poor

Needs fast, broad codebase scanning. GLM-5.1 is slow (~40 tok/s vs 53 median). Exploration rewards speed over depth.

#### `issue-agent:documentation`
**Current default:** Claude Sonnet 4.6 | **GLM-5.1 fit:** Poor

Doc writing needs concise, well-structured prose. GLM-5.1's verbosity is a direct liability here.

#### All subagents (`explore`, `plan`, `bash`, `general-purpose`)
**Current defaults:** Haiku 4.5 / Sonnet 4.6 | **GLM-5.1 fit:** Disqualified

Subagents must be fast. GLM-5.1 is the slowest model in its class. A slow subagent defeats the purpose.

#### `cli:interactive` and `cli:quick-command`
**Current defaults:** Sonnet 4.6 / Haiku 4.5 | **GLM-5.1 fit:** Disqualified

User-facing latency matters. Slowness and verbosity would make the CLI feel sluggish.

#### `convoy:synthesis-agent`
**Current default:** Claude Sonnet 4.6 | **GLM-5.1 fit:** Poor

Synthesis needs concise integration of multiple review findings. Verbosity works against the goal.

#### `specialist-inspect-agent`
**Current default:** Claude Sonnet 4.6 | **GLM-5.1 fit:** Poor

Per-bead inspection needs to be fast (3-8 min per bead). Runs frequently during implementation. Slowness would bottleneck the bead loop.

---

## Summary

| Tier | Work Types | Rationale |
|------|-----------|-----------|
| **Deploy now** | `issue-agent:implementation` | Core strength — long autonomous coding, #1 SWE-Bench Pro, competitive with Kimi K2.5 |
| **Benchmark next** | `specialist-test-agent`, `specialist-merge-agent`, `issue-agent:testing`, `issue-agent:review-response` | Medium-autonomy coding tasks where cost + quality justify testing |
| **Maybe later** | `convoy:performance-reviewer`, `convoy:correctness-reviewer` | Single-burst code analysis; benchmark output conciseness first |
| **Never** | UAT (no vision), planning (reasoning gap), security review (too risky), all subagents (too slow), CLI modes (latency), inspect-agent (speed), documentation (verbosity), synthesis (verbosity), exploration (speed) |

## Integration Notes

- GLM-5.1 is available via Z.AI API and OpenRouter
- Provider ID in Panopticon: `zai` (already exists in provider config)
- Model ID: `glm-5.1`
- Would need capability scores added to `model-capabilities.ts`
- Suggested scores: code-generation 92, code-review 88, debugging 85, planning 78, documentation 72, testing 88, security 80, performance 82, synthesis 80, speed 35, context-length 80

## Sources

- [WaveSpeedAI comparison](https://wavespeed.ai/blog/posts/glm-5-1-vs-claude-gpt-gemini-deepseek-llm-comparison/)
- [BuildFastWithAI review](https://www.buildfastwithai.com/blogs/glm-5-1-open-source-review-2026)
- [Dataconomy SWE-Bench Pro](https://dataconomy.com/2026/04/08/z-ais-glm-5-1-tops-swe-bench-pro-beating-major-ai-rivals/)
- [VentureBeat coverage](https://venturebeat.com/technology/ai-joins-the-8-hour-work-day-as-glm-ships-5-1-open-source-llm-beating-opus-4)
- [MarkTechPost introduction](https://www.marktechpost.com/2026/04/08/z-ai-introduces-glm-5-1-an-open-weight-754b-agentic-model-that-achieves-sota-on-swe-bench-pro-and-sustains-8-hour-autonomous-execution/)
- [Artificial Analysis profile](https://artificialanalysis.ai/models/glm-5-1)
- [Hugging Face model card](https://huggingface.co/zai-org/GLM-5.1)
