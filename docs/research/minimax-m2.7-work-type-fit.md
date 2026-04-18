# MiniMax M2.7 Work Type Fit Analysis

Research date: 2026-04-17

Evaluates MiniMax M2.7 (and M2.7 Highspeed) against Panopticon's 23 work types. MiniMax is already a configured provider in Panopticon with both model variants available.

## Model Profile

| Spec | M2.7 | M2.7 Highspeed |
|------|------|----------------|
| **Vendor** | MiniMax (Shanghai, HKEX IPO Jan 2026, ~$12.8B market cap) |
| **Release** | 2026-03-18 | Same model, inference-optimized deployment |
| **Architecture** | MoE, 229B total / 10B active per token | Same |
| **Experts** | 256 local, 8 activated per token (top-k routing) | Same |
| **Context Window** | ~200K tokens | Same |
| **Max Output** | 131K tokens | Same |
| **Modalities** | Text-only (no vision, audio, or video) | Same |
| **License** | Modified MIT (commercial use requires written authorization — NOT true open source) |
| **Pricing (input)** | $0.30/M | $0.60/M |
| **Pricing (output)** | $1.20/M | $2.40/M |
| **Cached input** | $0.06/M | $0.06/M |
| **Speed** | ~40 tok/s | ~100 tok/s |
| **Reasoning** | Extended thinking / chain-of-thought (toggleable) | Same |

**Key cost comparison:**
- vs Opus 4.6 ($5/$25): M2.7 is **17x cheaper input, 21x cheaper output**
- vs Sonnet 4.6 ($3/$15): M2.7 is **10x cheaper input, 12x cheaper output**
- vs Kimi K2.5 ($0.60/$2.50): M2.7 is **2x cheaper input, 2x cheaper output**
- vs GLM-5.1 ($1.40/$4.20): M2.7 is **4.7x cheaper input, 3.5x cheaper output**
- Cache reads at $0.06/M are exceptionally cheap — major advantage for agentic workflows with repeated context

## Key Benchmarks

**Caution:** MiniMax's self-reported benchmarks are consistently higher than independent evaluations. Both are shown below; trust the independent numbers (Vals, Arena) for routing decisions.

### Coding

| Benchmark | M2.7 (self-reported) | M2.7 (independent) | Opus 4.6 | Sonnet 4.6 | GLM-5.1 | Kimi K2.5 |
|-----------|---------------------|---------------------|----------|------------|---------|-----------|
| SWE-Bench Verified | 78% | 73.8% (Vals) | ~80.9% | -- | 77.8% | 76.8% |
| SWE-Bench Pro | 56.22% | -- | ~57.3% | -- | 58.4% | 50.7% |
| Terminal-Bench 2 | 57.0% | 47.19% (Vals) | 58.43% (Vals) | -- | ~54.9% | 50.8% |
| Code Arena Elo | -- | 1422 (#17) | 1548 (#1) | 1524 (#4) | ~1530 (#3) | ~1430 (#16) |
| Multi SWE-Bench | 52.7% | -- | -- | -- | -- | -- |
| SWE Multilingual | 76.5% | -- | -- | -- | -- | -- |

### Reasoning & Knowledge

| Benchmark | M2.7 | Opus 4.6 | GLM-5.1 | Kimi K2.5 |
|-----------|------|----------|---------|-----------|
| GPQA Diamond | 86.62% | ~91.3% | 86.0% | 87.6% |
| AIME 2025 | 91.04% | ~99.8% | 92.7% | 96.1% |
| MMLU-Pro | 80.43% | 89.11% | -- | 87.1% |
| IOI | 4.92% | -- | 22% (GLM-5) | 17.67% |

### Agentic

| Benchmark | M2.7 | Opus 4.6 | Notes |
|-----------|------|----------|-------|
| GDPval-AA Elo | 1495 | Higher | Highest among open-weight (office doc editing) |
| MLE Bench Lite | 66.6% | 75.7% | Second only to Opus |
| Toolathon | 46.3% | -- | Tool-use accuracy |
| MM Claw | 62.7% | -- | End-to-end agent eval |
| Skill Adherence | 97% | -- | Across 40+ complex skills (>2K tokens each) |

### Composite

| Index | M2.7 | Opus 4.6 | GLM-5.1 | Kimi K2.5 |
|-------|------|----------|---------|-----------|
| Vals Index | 59.58% | 65.98% | -- | 59.74% |
| Artificial Analysis Intelligence | 50/100 (#3) | -- | 51/100 (#1) | 47/100 (#4) |

## Standout Capabilities

1. **Best price/performance in the top tier** — delivers ~75-90% of Opus quality at ~5% of the cost. The headline value proposition. At $0.30/$1.20, you can run 17x more agent-hours than Opus for the same budget.
2. **Self-evolution during training** — first model that autonomously participated in its own training loop (100+ iterations of analyze/modify/evaluate/keep-revert), achieving 30% performance improvement. Handles 30-50% of RL research workflow autonomously.
3. **97% skill adherence** — across 40+ complex skills exceeding 2,000 tokens each. Strong at following detailed multi-step instructions.
4. **Extremely cheap cache reads** — $0.06/M tokens makes repeated agentic context nearly free. Critical for Panopticon's long-running agents that re-read workspace state.
5. **Highspeed variant** — ~100 tok/s at 2x the price is still dramatically cheaper than competitors. Enables fast iteration where needed without switching models.
6. **SWE-Bench Pro 56.22%** — self-reported but, if accurate, competitive with GPT-5.3 Codex (56.8%) and close to GLM-5.1 (58.4%).

## Known Weaknesses

1. **Text-only** — no vision. Cannot process screenshots, UI mockups, or visual regressions.
2. **Coding not quite frontier** — Code Arena Elo 1422 is #17, well behind Opus (1548), Sonnet (1524), and GLM-5.1 (~1530). ~126-point gap to the top means more mistakes on complex multi-file refactors.
3. **Self-reported benchmark inflation** — Terminal-Bench self-reported 57% vs independent 47.19%. SWE-Bench self-reported 78% vs independent 73.8%. A consistent ~4-10% gap.
4. **Weak competitive programming** — IOI at 4.92% vs GLM-5 at 22%. Very poor at Olympiad-level algorithmic reasoning.
5. **MMLU-Pro gap** — 80.43% vs Opus 89.11%. Substantially weaker on broad knowledge tasks.
6. **Licensing ambiguity** — marketed as "open source" but requires written authorization for commercial use. Community backlash on HuggingFace. License was changed post-release.
7. **Standard tier speed** — ~40 tok/s on standard tier is below median. Highspeed fixes this but costs 2x.
8. **Enterprise/finance weakness** — Finance Agent 48.4% vs Opus 60.05%, TaxEval 66.56% vs Opus 75.96%.

---

## Work Type Fit Assessment

M2.7's thesis is clear: **massive cost savings on work types where 75-90% of Opus quality is sufficient.** The question for each work type is whether the quality gap matters.

### Excellent Fit

#### `issue-agent:implementation` (cost-optimized tier)
**Current default:** Kimi K2.5 | **M2.7 fit:** Excellent for cost, Good for quality

M2.7 is 2x cheaper than Kimi K2.5 on both input and output, with comparable or slightly better independent benchmark scores (Vals: 73.8% SWE-Bench vs K2.5's 76.8%, but SWE-Pro 56.22% vs K2.5's 50.7%). For routine implementation work on well-specified beads, M2.7 is the budget champion. For harder issues, route to GLM-5.1 or Opus.

**Recommendation:** Add M2.7 as a "cost-optimized" implementation option. Use for well-specified, medium-complexity beads. Escalate to GLM-5.1/Opus for complex architectural work.

#### `specialist-test-agent`
**Current default:** Claude Sonnet 4.6 | **M2.7 fit:** Excellent

Test execution + output parsing is procedural work where 97% skill adherence shines. M2.7 can follow detailed test execution scripts reliably. At 10x cheaper than Sonnet, the cost savings are dramatic for a high-volume work type. M2.7 Highspeed at $0.60/$2.40 provides faster turnaround while still being 5x cheaper than Sonnet.

#### `specialist-merge-agent`
**Current default:** Claude Sonnet 4.6 | **M2.7 fit:** Excellent

Merge operations are structured, procedural, and well-defined. The skill adherence strength maps perfectly — merges follow a fixed protocol (sync, merge, verify, build, push). Failure modes are detectable. At 10x cheaper than Sonnet, this is an easy win.

#### `specialist-inspect-agent`
**Current default:** Claude Sonnet 4.6 | **M2.7 fit:** Excellent (Highspeed variant)

Per-bead inspection needs to be fast and runs frequently. M2.7 Highspeed at ~100 tok/s is faster than Sonnet and dramatically cheaper. The inspection task is well-structured (compare diff to bead spec, check constraints, verify compilation) — plays to skill adherence. Highspeed at $0.60/$2.40 is still 5x cheaper than Sonnet.

### Good Fit — Worth Benchmarking

#### `issue-agent:testing`
**Current default:** Claude Sonnet 4.6 | **M2.7 fit:** Good

Test writing + coverage analysis. M2.7's coding quality is sufficient for test generation. The IOI weakness (4.92%) means it may struggle with algorithmically complex test scenarios, but most test work is pattern-based, not algorithmic.

#### `issue-agent:review-response`
**Current default:** Claude Sonnet 4.6 | **M2.7 fit:** Good

Reading review feedback and making fixes. 97% skill adherence means it follows fix instructions reliably. The Code Arena gap (1422 vs 1524 Sonnet) suggests it may produce lower-quality fixes for nuanced reviews.

#### `convoy:performance-reviewer`
**Current default:** Claude Sonnet 4.6 | **M2.7 fit:** Moderate-Good

Performance analysis benefits from code understanding. M2.7's independent SWE-bench scores show decent code comprehension. Cost savings make parallel convoy lanes much cheaper. Benchmark output quality before deploying.

#### `convoy:correctness-reviewer`
**Current default:** Claude Sonnet 4.6 | **M2.7 fit:** Moderate-Good

Logic and edge case review. GPQA Diamond 86.62% is comparable to GLM-5.1 (86.0%) and K2.5 (87.6%). Adequate reasoning for most correctness checks. The MMLU-Pro gap (80.43% vs Sonnet's likely ~85%+) is a concern for domain-specific correctness.

#### `convoy:synthesis-agent`
**Current default:** Claude Sonnet 4.6 | **M2.7 fit:** Moderate

Synthesis needs concise integration. M2.7's skill adherence (97%) suggests it can follow structured synthesis templates well. Worth testing — if it produces clean, concise summaries, it's a huge cost win for a work type that runs on every review.

#### `issue-agent:documentation`
**Current default:** Claude Sonnet 4.6 | **M2.7 fit:** Moderate

M2.7's GDPval-AA score (highest among open-weight for document generation) suggests decent doc writing capability. However, text-generation quality for English prose is unproven at Sonnet's level. Worth benchmarking output quality.

### Poor Fit — Do Not Route

#### `specialist-uat-agent`
**Current default:** Claude Sonnet 4.6 | **M2.7 fit:** Disqualified

Text-only. No vision capability. Cannot analyze Playwright screenshots or detect visual regressions.

#### `planning-agent`
**Current default:** Claude Opus 4.6 | **M2.7 fit:** Poor

MMLU-Pro gap (80.43% vs 89.11%) and AIME gap (91% vs 99.8%) indicate significantly weaker reasoning. Planning needs the strongest reasoner for architecture decisions and requirement decomposition. Keep on Opus.

#### `convoy:security-reviewer`
**Current default:** Claude Opus 4.6 | **M2.7 fit:** Poor

Security is a safety-critical gate. The Code Arena gap (1422 vs 1548) and reasoning weaknesses make this too risky. A missed vulnerability is far more expensive than the cost savings.

#### `convoy:requirements-reviewer`
**Current default:** Claude Opus 4.6 | **M2.7 fit:** Poor

Planning-heavy (0.5 weight). Needs strong reasoning to cross-reference specs against implementation. MMLU-Pro and reasoning gaps disqualify it.

#### `issue-agent:exploration`
**Current default:** Claude Opus 4.6 | **M2.7 fit:** Poor (standard), Moderate (Highspeed)

Standard M2.7 at ~40 tok/s is too slow. Highspeed at ~100 tok/s is fast enough, but exploration also needs strong synthesis capability to map unfamiliar codebases. The MMLU-Pro gap suggests weaker broad understanding. Not recommended.

#### `specialist-review-agent`
**Current default:** Claude Opus 4.6 | **M2.7 fit:** Poor

The pre-merge quality gate. Code Arena #17 vs Opus #1 means M2.7 will miss issues that Opus catches. This gate exists to prevent defects from reaching main — savings here create costs downstream.

#### All subagents (`explore`, `plan`, `bash`, `general-purpose`)
**Current defaults:** Haiku 4.5 / Sonnet 4.6 | **M2.7 fit:** Poor (standard), Possible (Highspeed for bash)

Standard tier too slow. Highspeed is fast enough for `subagent:bash` (shell execution is procedural), but at $0.60/$2.40 it's more expensive than Haiku ($0.80/$4.00 input/output) with arguably less value for quick helper tasks. Not compelling.

#### `cli:interactive` and `cli:quick-command`
**Current defaults:** Sonnet 4.6 / Haiku 4.5 | **M2.7 fit:** Poor

User-facing latency. Standard tier too slow. Highspeed is fast but CLI modes need conversational quality, not just speed.

---

## The M2.7 Value Proposition for Panopticon

M2.7's unique angle isn't that it's the best at anything — it's that it's **good enough at many things while being absurdly cheap.** The strategic play:

### Cost Modeling

Assuming a typical issue lifecycle costs ~$15-25 in LLM tokens (across planning, implementation, review, test, merge):

| Strategy | Est. Cost per Issue | Quality |
|----------|-------------------|---------|
| All Opus | ~$25-40 | Maximum |
| Current mix (Opus planning/review, Kimi impl, Sonnet specialists) | ~$15-25 | High |
| M2.7 for specialists + Kimi/GLM impl + Opus gates | ~$8-15 | High (gates protect quality) |
| M2.7 for everything except planning + security | ~$5-10 | Moderate-High |

The third row is the sweet spot: **use M2.7 for high-volume procedural work (test, merge, inspect) while keeping Opus on the quality gates (planning, security review, pre-merge review).**

### M2.7 Highspeed vs Standard Decision Matrix

| Use Highspeed when... | Use Standard when... |
|----------------------|---------------------|
| Speed matters (inspect-agent, per-bead) | Cost matters more than speed |
| User is waiting (review-response) | Agent runs in background (test-agent) |
| Short tasks (<5 min) | Long tasks (>15 min) |

---

## Summary

| Tier | Work Types | Variant | Rationale |
|------|-----------|---------|-----------|
| **Deploy now** | `specialist-merge-agent` | Standard | Procedural, low-risk, 10x cheaper than Sonnet |
| **Deploy now** | `specialist-inspect-agent` | Highspeed | Fast + cheap, plays to skill adherence |
| **Benchmark next** | `specialist-test-agent`, `issue-agent:testing` | Standard | High-volume, procedural, massive cost savings |
| **Benchmark next** | `issue-agent:implementation` (cost tier) | Standard | Budget option for well-specified beads |
| **Worth trying** | `issue-agent:review-response`, `convoy:performance-reviewer`, `convoy:correctness-reviewer`, `convoy:synthesis-agent` | Standard | Cost savings if quality holds |
| **Maybe** | `issue-agent:documentation` | Standard | GDPval-AA is promising, benchmark prose quality |
| **Never** | UAT (no vision), planning (reasoning gap), security review (too risky), specialist-review (quality gate), exploration (synthesis weakness), subagents (Haiku is better fit), CLI modes |

## Integration Notes

- MiniMax is already a configured provider in Panopticon (`minimax`)
- Model IDs: `minimax-m2.7`, `minimax-m2.7-highspeed`
- Capability scores already in `model-capabilities.ts` — verify they reflect independent (not self-reported) benchmarks
- Suggested capability score adjustments based on independent data:
  - code-generation: 82 (not 88 — Vals SWE-bench 73.8%, not self-reported 78%)
  - code-review: 80
  - debugging: 78
  - planning: 70
  - documentation: 78
  - testing: 82
  - security: 72
  - performance: 76
  - synthesis: 76
  - speed: 35 (standard), 75 (highspeed)
  - context-length: 80

## Benchmark Credibility Note

MiniMax's self-reported benchmarks consistently exceed independent evaluations by 4-10 percentage points. When updating `model-capabilities.ts`, use independent numbers (Vals, Code Arena, Artificial Analysis) rather than MiniMax's blog claims. Specific discrepancies:

| Benchmark | Self-Reported | Independent | Gap |
|-----------|--------------|-------------|-----|
| Terminal-Bench 2 | 57.0% | 47.19% (Vals) | -9.8% |
| SWE-Bench Verified | 78% | 73.8% (Vals) | -4.2% |

## Sources

- [MiniMax M2.7 Official](https://www.minimax.io/models/text/m27)
- [MiniMax M2.7 Blog](https://www.minimax.io/news/minimax-m27-en)
- [Artificial Analysis](https://artificialanalysis.ai/models/minimax-m2-7)
- [HuggingFace Model Card](https://huggingface.co/MiniMaxAI/MiniMax-M2.7)
- [MiniMax API Pricing](https://platform.minimax.io/docs/guides/pricing-paygo)
- [OpenRouter](https://openrouter.ai/minimax/minimax-m2.7)
- [Chinese Frontier Models Compared (Maniac.ai)](https://www.maniac.ai/blog/chinese-frontier-models-compared-glm5-minimax-kimi-qwen)
- [Code Arena Leaderboard](https://arena.ai/leaderboard/code)
- [NVIDIA Technical Blog](https://developer.nvidia.com/blog/minimax-m2-7-advances-scalable-agentic-workflows-on-nvidia-platforms-for-complex-ai-applications/)
- [WaveSpeed AI Review](https://wavespeed.ai/blog/posts/minimax-m2-7-self-evolving-agent-model-features-benchmarks-2026/)
- [MarkTechPost](https://www.marktechpost.com/2026/04/12/minimax-just-open-sourced-minimax-m2-7-a-self-evolving-agent-model-that-scores-56-22-on-swe-pro-and-57-0-on-terminal-bench-2/)
- [Decrypt License Controversy](https://decrypt.co/364225/minimax-m27-agent-model-license-change)
