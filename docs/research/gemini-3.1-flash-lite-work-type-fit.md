# Gemini 3.1 Flash-Lite Preview Work Type Fit Analysis

Research date: 2026-04-17

Evaluates Google's Gemini 3.1 Flash-Lite Preview against Panopticon's 23 work types. This is the smallest, cheapest, and fastest model in Google's Gemini 3.x family. Notably derived from **Pro** (not Flash) architecture.

## Model Profile

| Spec | Value |
|------|-------|
| **Vendor** | Google DeepMind |
| **Release** | 2026-03-03 (preview) |
| **Architecture** | Pro-derived distillation (undisclosed parameter count) |
| **Context Window** | 1M tokens |
| **Max Output** | 64K tokens |
| **Knowledge Cutoff** | January 1, 2025 |
| **Modalities** | Text + Image + Audio + Video input; Text output |
| **Reasoning** | 4-level thinking system: Minimal, Low, Medium, High |
| **Pricing (input)** | $0.25/M |
| **Pricing (output)** | $1.50/M |
| **Batch API** | 50% off (effective $0.125/$0.75) |
| **Speed** | ~382 tok/s |
| **TTFT** | ~6.44s (reasoning), much lower without |

**Cost comparison:**
- vs Haiku 4.5 ($1/$5): **4x cheaper input, 3.3x cheaper output**
- vs GPT-5.4 Nano ($0.20/$1.25): **Slightly more expensive** ($0.25 vs $0.20 input, $1.50 vs $1.25 output)
- vs Gemini 3 Flash ($0.50/$3): **2x cheaper**
- vs MiniMax M2.7 ($0.30/$1.20): **Slightly cheaper input, slightly more expensive output**

**Key:** Flash-Lite and GPT-5.4 Nano are in the same price bracket but have very different profiles (speed vs intelligence).

## Key Benchmarks

| Benchmark | Flash-Lite 3.1 | GPT-5.4 Nano | Haiku 4.5 | Gemini 3 Flash |
|-----------|---------------|-------------|-----------|---------------|
| GPQA Diamond | 86.9% | 82.8% | ~73% | 90.4% |
| MMMU Pro | 76.8% | -- | -- | 81.2% |
| MMMLU (multilingual) | 88.9% | -- | -- | -- |
| LiveCodeBench | 72.0% | -- | -- | 90.8% |
| Video-MMMU | 84.8% | -- | -- | -- |
| SWE-Bench Pro | Not published | 52.4% | ~45-50% | 78.0% (Verified) |
| FACTS (factuality) | 40.6% | -- | -- | -- |
| Arena Elo | 1432 | -- | -- | -- |
| AA Intelligence Index | 34/100 | 44/100 | -- | 71/100 |

**Key insight:** GPT-5.4 Nano is meaningfully smarter (Intelligence Index 44 vs 34). Flash-Lite is dramatically faster (382 vs 155-200 tok/s). They target different niches within the budget tier.

## Standout Capabilities

1. **Speed king** — 382 tok/s is the fastest model evaluated. 2.4x faster than Nano, 2.7x faster than Haiku, 1.6x faster than Gemini 2.5 Flash.
2. **1M context at budget pricing** — largest context window of any budget model. Nano offers 400K. Haiku offers 200K.
3. **Multimodal at $0.25/M** — text, image, audio, video input. Very few budget models handle video. Video-MMMU 84.8% is strong.
4. **Pro-derived architecture** — distilled from Pro, giving it some reasoning DNA that pure budget models lack. Near-tripling of Intelligence Index from 2.5 Flash-Lite (13 → 34).
5. **Configurable thinking levels** — 4 levels (Minimal/Low/Medium/High) for per-request tuning. Unique among budget models.
6. **GPQA Diamond 86.9%** — strong science reasoning for a budget model, beating Nano by 4 points.
7. **Batch API at 50% off** — effective $0.125/$0.75 for batch workloads.

## Known Weaknesses

1. **Hallucination rate** — described as "exceptionally high." Does not know when it's guessing. The model's "one glaring weakness."
2. **Factuality** — FACTS benchmark 40.6% vs Flash's 50.4%. A 20% relative drop. Hard quality cliff for knowledge-grounded tasks.
3. **Intelligence gap to Nano** — AA Index 34 vs Nano's 44. Nano is ~30% smarter. For tasks requiring reasoning, Nano wins.
4. **No published SWE-Bench** — Google hasn't released coding agent benchmarks for Flash-Lite. LiveCodeBench 72% is decent but far below Flash (90.8%).
5. **Complex reasoning cliff** — GPQA 86.9% vs Pro's 94.3%. Struggles with deep multi-step chains.
6. **Long-context performance** — only 12.3% on 1M-token long-context benchmarks despite supporting 1M window. The context window is available but retrieval quality degrades severely.
7. **Requires structured prompts** — struggles with ambiguous requirements.
8. **Verbose** — 53M output tokens during evaluation vs 26M median (~2x). Inflates effective costs.
9. **Weakest multilingual** — ranked #71 in its class.
10. **Preview stability** — no SLAs, no API stability guarantees.

---

## Work Type Fit Assessment

### The Speed vs Intelligence Tradeoff

Flash-Lite's value proposition is **raw speed at budget pricing with multimodal capability.** It is NOT a general-purpose budget model. For tasks where intelligence matters more than speed, GPT-5.4 Nano is better. For tasks where speed matters more than intelligence, Flash-Lite wins.

### Good Fit

#### `cli:quick-command`
**Current default:** Claude Haiku 4.5 | **Flash-Lite fit:** Good

One-shot utility commands need speed above all. 382 tok/s is the fastest option available. 4x cheaper than Haiku. Run at `Minimal` thinking for maximum speed.

**Concern:** Hallucination risk for commands that query state. If the quick command is "what's the status of X," Flash-Lite may fabricate. For pure routing/dispatch commands, this is less of an issue.

**vs Nano:** Nano is smarter and has lower hallucination risk. If quick commands need accuracy, use Nano. If they need speed, use Flash-Lite.

#### `subagent:explore`
**Current default:** Claude Haiku 4.5 | **Flash-Lite fit:** Moderate-Good

1M context + 382 tok/s enables rapid full-codebase scanning. Multimodal can process screenshots. 4x cheaper than Haiku.

**Concern:** 12.3% on 1M long-context benchmarks means retrieval quality degrades severely at large context. The 1M window is nominal, not effective. Nano's 400K context with better retrieval may be more practical.

### Moderate Fit — Niche Uses

#### `subagent:bash`
**Current default:** Claude Haiku 4.5 | **Flash-Lite fit:** Moderate

Shell execution is procedural. Speed helps. But no published coding benchmarks for bash-specific work, and Nano's stronger tool use (Tau2-Bench 92.5%) makes it a safer choice.

#### `specialist-inspect-agent`
**Current default:** Claude Sonnet 4.6 | **Flash-Lite fit:** Moderate

Speed is ideal for frequent per-bead inspection. But Intelligence Index 34 may miss subtle issues that Sonnet or even Flash would catch. Better to use Gemini 3 Flash or GPT-5.4 Mini for inspection.

### Poor Fit — Do Not Route

All other work types. Flash-Lite's Intelligence Index of 34, hallucination rate, and factuality weakness (40.6%) make it unsuitable for:

- **Implementation** — coding quality insufficient, hallucination in autonomous loops
- **Testing** — fabricated root cause analysis
- **Review** (any type) — hallucination rate is disqualifying for quality gates
- **Planning** — reasoning too shallow
- **Documentation** — factuality weakness
- **Merge** — lower reliability than Nano or Flash for structured operations
- **UAT** — despite multimodal capability, intelligence too low for UI reasoning
- **Synthesis** — factuality + verbosity
- **CLI interactive** — hallucination risk for user-facing responses
- **Subagent plan** — reasoning too shallow

---

## Flash-Lite's Niche in Panopticon

Flash-Lite is best understood as **infrastructure, not an agent model.** Its optimal uses are:

1. **High-volume log processing** — parse agent output at 382 tok/s for health monitoring
2. **Quick classification/routing** — triage incoming requests at maximum speed
3. **Multimodal preprocessing** — extract text from screenshots/videos before passing to a smarter model
4. **Batch data extraction** — at $0.125/$0.75 (batch pricing), process thousands of structured extractions cheaply

For Panopticon's agent work types, **GPT-5.4 Nano is the better budget model** — smarter (Index 44 vs 34), better tool use, similar pricing, and lower hallucination risk. Flash-Lite wins only when raw throughput matters more than accuracy.

---

## Summary

| Tier | Work Types | Rationale |
|------|-----------|-----------|
| **Maybe** | `cli:quick-command` | Fastest available, but Nano is smarter and safer |
| **Maybe** | `subagent:explore` | 1M context + speed, but long-context retrieval degrades |
| **Infrastructure only** | Log processing, classification, multimodal preprocessing | Speed + multimodal + batch pricing |
| **Never** | All 20+ remaining work types | Intelligence too low, hallucination too high |

## Integration Notes

- Google already configured as provider in Panopticon
- Model ID: `gemini-3.1-flash-lite-preview`
- Available via Google AI API (API key)
- Suggested capability scores: code-generation 68, code-review 58, debugging 62, planning 52, documentation 50, testing 66, security 52, performance 58, synthesis 54, speed 98, context-length 85 (nominal 1M but effective retrieval much lower)
- **Hallucination flag:** `hallucination_risk: critical` — highest of any evaluated model
- Consider for Cloister infrastructure layer rather than as an agent model

## Sources

- [Google Blog: Gemini 3.1 Flash Lite](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-1-flash-lite/)
- [Google DeepMind Model Card](https://deepmind.google/models/model-cards/gemini-3-1-flash-lite/)
- [Artificial Analysis](https://artificialanalysis.ai/models/gemini-3-1-flash-lite-preview)
- [Verdent: Flash-Lite vs Flash vs Pro](https://www.verdent.ai/guides/gemini-3-1-flash-lite-vs-flash-vs-pro)
- [BuildFastWithAI: 3.1 Flash Lite vs 2.5 Flash](https://www.buildfastwithai.com/blogs/gemini-3-1-flash-lite-vs-2-5-flash-speed-cost-benchmarks-2026)
- [SiliconANGLE: Launch Coverage](https://siliconangle.com/2026/03/03/google-launches-speedy-gemini-3-1-flash-lite-model-preview/)
- [VentureBeat: 1/8th Cost of Pro](https://venturebeat.com/technology/google-releases-gemini-3-1-flash-lite-at-1-8th-the-cost-of-pro/)
- [Vertex AI Documentation](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-1-flash-lite)
- [AIML API Review](https://aimlapi.com/blog/gemini-3-1-flash-lite-review-2026-pricing-benchmarks-features-best-use-cases)
