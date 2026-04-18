# Gemini 3 Flash Preview Work Type Fit Analysis

Research date: 2026-04-17

Evaluates Google's Gemini 3 Flash Preview against Panopticon's 23 work types. Still in preview with no GA date announced — Google appears to have leapfrogged to 3.1 Pro for GA while leaving 3 Flash in preview.

## Model Profile

| Spec | Value |
|------|-------|
| **Vendor** | Google DeepMind |
| **Release** | Preview (early 2026) |
| **Architecture** | Undisclosed parameter count, reasoning-enabled |
| **Context Window** | 1M tokens |
| **Max Output** | 64K tokens |
| **Knowledge Cutoff** | January 2025 |
| **Modalities** | Text + Image + Audio + Video + PDF input; Text output |
| **Reasoning** | Configurable via `thinking_level`: minimal, low, medium, high |
| **Pricing (input)** | $0.50/M |
| **Pricing (output)** | $3.00/M |
| **Pricing (cached input)** | $0.05/M (90% discount) |
| **Batch API** | 50% off all prices |
| **Speed** | ~150-218 tok/s |
| **TTFT** | Sub-1s (minimal thinking) to ~7.3s (high reasoning) |

**Cost comparison:**
- vs Sonnet 4.6 ($3/$15): **6x cheaper input, 5x cheaper output**
- vs Haiku 4.5 ($1/$5): **2x cheaper input, 1.7x cheaper output**
- vs GPT-5.4 Mini ($0.75/$4.50): **1.5x cheaper input, 1.5x cheaper output**
- vs Kimi K2.5 ($0.60/$2.50): **Slightly cheaper input, slightly more expensive output**
- vs MiniMax M2.7 ($0.30/$1.20): **1.7x more expensive input, 2.5x more expensive output**
- vs Gemini 3.1 Pro ($2/$12): **4x cheaper input, 4x cheaper output**

**Cached input at $0.05/M** is one of the cheapest rates available. Combined with batch API (50% off), effective costs can drop to $0.25/$1.50 — in the Flash-Lite territory.

## Key Benchmarks

| Benchmark | Gemini 3 Flash | Gemini 3.1 Pro | Sonnet 4.6 | GPT-5.4 Mini | Kimi K2.5 |
|-----------|---------------|----------------|------------|-------------|-----------|
| SWE-Bench Verified | **78.0%** | 80.6% | 79.6% | -- | 76.8% |
| GPQA Diamond | **90.4%** | 94.3% | -- | 88.0% | 87.6% |
| AIME 2025 | **97.0%** | 91.2% | -- | -- | 96.1% |
| MMLU-Pro | 89.0% | 90.8% | -- | -- | 87.1% |
| LiveCodeBench | **90.8%** | -- | -- | -- | 85.0% |
| Terminal-Bench Hard | 38.6% | 68.5% | 59.1% | 60.0% | -- |
| IFBench | 78.0% | -- | -- | -- | -- |
| Tau2-Bench | 80.4% | -- | -- | 93.4% | -- |
| AA Intelligence Index | **71/100** | -- | -- | -- | -- |

**Remarkable:** Flash beats its own Pro sibling on SWE-Bench (78% vs 76.2% for Gemini 3 Pro — note 3.1 Pro is 80.6%), AIME (97% vs 91.2% for 3.1 Pro), and LiveCodeBench (90.8%). A Flash model outperforming Pro on coding agent tasks is unusual.

## Standout Capabilities

1. **Pro-grade intelligence at Flash pricing** — AA Intelligence Index 71/100 makes it the most intelligent model in the $0.50/M input tier by a wide margin. SWE-Bench 78% at $0.50/M is extraordinary value.
2. **Agentic Vision** — unique capability where the model treats image understanding as an agentic Think/Act/Observe loop. Autonomously generates Python code to crop, rotate, annotate, and re-examine images at higher resolution. Yields 5-10% quality boost on vision benchmarks.
3. **Multimodal breadth at budget price** — text, image, audio, video, PDF with 1M context at $0.50/M input. No other model at this price handles video.
4. **Speed** — 150-218 tok/s is 3-4x faster than Sonnet 4.6 and competitive with GPT-5.4 Mini.
5. **Configurable reasoning** — 4-level thinking (minimal/low/medium/high) enables per-request cost/quality tuning. Run cheap for simple tasks, deep for complex ones.
6. **AIME 97%** — near-perfect math reasoning, beating Kimi K2.5 (96.1%) and Gemini 3.1 Pro (91.2%).
7. **LiveCodeBench 90.8%** — highest code generation score of any model evaluated.
8. **30% fewer tokens** — uses 30% fewer tokens than Gemini 2.5 Pro for equivalent tasks, reducing effective costs.
9. **$0.05/M cached input** — aggressive caching discount for agentic loops with repeated context.
10. **Google Search grounding** — native web search, Maps grounding, URL context, and code execution built in.

## Known Weaknesses

1. **91% hallucination rate** — on AA-Omniscience benchmark. Confidently fabricates answers rather than saying "I don't know." **This is the critical weakness.** Disqualifying for any task requiring factual reliability without human verification.
2. **Verbosity** — 72M output tokens during evaluation vs 35M median (~2x). Inflates effective output costs.
3. **Terminal-Bench Hard 38.6%** — dramatically behind GPT-5.4 Mini (60%), Sonnet (59.1%), and Gemini 3.1 Pro (68.5%). Struggles with complex sequential terminal operations.
4. **Slower than predecessor** — 22% slower than Gemini 2.5 Flash. The "Flash" branding may mislead.
5. **TTFT in reasoning mode** — 7.3s is above median for the price tier.
6. **Preview stability** — reported API degradation, rate limits, no SLA.
7. **Depth of reasoning** — compromises depth for speed compared to Pro. Not suitable for the deepest analytical tasks.
8. **Knowledge cutoff** — January 2025 is older than some competitors.

---

## Work Type Fit Assessment

### Excellent Fit

#### `subagent:explore`
**Current default:** Claude Haiku 4.5 | **Gemini 3 Flash fit:** Excellent

Fast codebase scanning with 1M context at $0.50/M. Can ingest entire codebases in a single pass — Haiku's 200K context limits this. 150-218 tok/s is faster than Haiku. Multimodal means it can process screenshots and diagrams alongside code. Run at `minimal` thinking for maximum speed.

#### `subagent:general-purpose`
**Current default:** Claude Sonnet 4.6 | **Gemini 3 Flash fit:** Excellent

SWE-Bench 78% at 6x cheaper than Sonnet is extraordinary value for mixed helper tasks. AA Intelligence Index 71/100 — this is not a budget model pretending to be capable, it genuinely delivers Pro-grade quality at Flash pricing.

#### `specialist-inspect-agent`
**Current default:** Claude Sonnet 4.6 | **Gemini 3 Flash fit:** Excellent

Per-bead inspection needs speed and runs frequently. Flash at 150-218 tok/s with configurable reasoning (run `minimal` for simple diffs, `medium` for complex ones) is ideal. 6x cheaper than Sonnet. SWE-Bench 78% shows strong code comprehension. Multimodal can process visual diffs if needed.

**Concern:** 7.3s TTFT at higher reasoning levels. Use `minimal` or `low` to keep latency down.

### Good Fit — Worth Benchmarking

#### `specialist-test-agent`
**Current default:** Claude Sonnet 4.6 | **Gemini 3 Flash fit:** Good

Tau2-Bench 80.4% shows decent tool use. Speed advantage. 6x cheaper than Sonnet. Multimodal can process test failure screenshots.

**Concern:** Hallucination rate (91%) is concerning for test root cause analysis. May fabricate explanations for failures. Terminal-Bench Hard 38.6% is weak.

#### `issue-agent:testing`
**Current default:** Claude Sonnet 4.6 | **Gemini 3 Flash fit:** Good

Similar to specialist-test-agent. LiveCodeBench 90.8% shows strong code generation for test writing. Cost savings are significant.

#### `specialist-merge-agent`
**Current default:** Claude Sonnet 4.6 | **Gemini 3 Flash fit:** Good

Merge operations are procedural and well-constrained. Hallucination is less of a risk for structured git operations. 6x cheaper than Sonnet.

#### `convoy:performance-reviewer`
**Current default:** Claude Sonnet 4.6 | **Gemini 3 Flash fit:** Good

GPQA 90.4% shows strong analytical reasoning. 1M context enables system-wide analysis. 6x cheaper than Sonnet. Run at `medium` or `high` thinking for review quality.

#### `convoy:correctness-reviewer`
**Current default:** Claude Sonnet 4.6 | **Gemini 3 Flash fit:** Good

Strong reasoning (GPQA 90.4%, AIME 97%). Logic and edge case review benefits from analytical depth. 6x cheaper than Sonnet.

**Concern:** Hallucination rate could lead to false positives in correctness review.

#### `issue-agent:implementation` (cost-optimized tier)
**Current default:** Kimi K2.5 | **Gemini 3 Flash fit:** Moderate-Good

SWE-Bench 78% beats K2.5 (76.8%). LiveCodeBench 90.8% is best-in-class. Comparable pricing ($0.50 vs $0.60 input). 1M context enables larger refactors.

**Critical concern:** Terminal-Bench Hard 38.6% is very weak — implementation agents spend most of their time in terminal operations. And the 91% hallucination rate in an autonomous coding loop is dangerous. Benchmark carefully.

#### `specialist-uat-agent`
**Current default:** Claude Sonnet 4.6 | **Gemini 3 Flash fit:** Good

Agentic Vision capability is directly relevant — can autonomously investigate UI at higher resolution. Multimodal (video, screenshots). 6x cheaper than Sonnet.

**Concern:** Playwright MCP integration untested. Hallucination risk for visual regression detection.

#### `issue-agent:review-response`
**Current default:** Claude Sonnet 4.6 | **Gemini 3 Flash fit:** Moderate-Good

Reading feedback and implementing fixes. Fast turnaround, good code comprehension. But Terminal-Bench weakness and hallucination risk complicate implementation fixes.

### Poor Fit — Do Not Route

#### `planning-agent`
**Current default:** Claude Opus 4.6 | **Gemini 3 Flash fit:** Poor

Despite strong GPQA/AIME, Flash compromises reasoning depth for speed. Planning needs maximum analytical depth. 91% hallucination rate is disqualifying for architecture decisions.

#### `specialist-review-agent`
**Current default:** Claude Opus 4.6 | **Gemini 3 Flash fit:** Poor

Pre-merge quality gate. 91% hallucination rate means it may pass code that should fail (fabricated reasoning about correctness) or flag correct code with false issues. Too risky for the last line of defense.

#### `convoy:security-reviewer`
**Current default:** Claude Opus 4.6 | **Gemini 3 Flash fit:** Poor

Security review is safety-critical. Hallucination rate is disqualifying — a fabricated "no vulnerabilities found" verdict could be catastrophic.

#### `convoy:requirements-reviewer`
**Current default:** Claude Opus 4.6 | **Gemini 3 Flash fit:** Poor

Requirements cross-referencing needs factual precision. Hallucination risk.

#### `issue-agent:exploration`
**Current default:** Claude Opus 4.6 | **Gemini 3 Flash fit:** Moderate

1M context and speed are excellent for exploration, but Gemini 3.1 Pro is a better fit (stronger reasoning, still cheaper than Opus). Flash's hallucination risk could produce incorrect codebase analysis.

#### `issue-agent:documentation`
**Current default:** Claude Sonnet 4.6 | **Gemini 3 Flash fit:** Poor

Documentation needs factual accuracy and clean prose. 91% hallucination rate disqualifies.

#### `convoy:synthesis-agent`
**Current default:** Claude Sonnet 4.6 | **Gemini 3 Flash fit:** Poor

Synthesis needs concise, accurate integration. Verbosity (2x median) and hallucination risk work against this.

#### `subagent:bash`
**Current default:** Claude Haiku 4.5 | **Gemini 3 Flash fit:** Moderate

Terminal-Bench Hard 38.6% is weak for shell-focused work. Nano or Haiku are better fits for bash subagents.

#### `subagent:plan`
**Current default:** Claude Haiku 4.5 | **Gemini 3 Flash fit:** Moderate

Quick planning sketches. Hallucination risk for planning work, even lightweight planning.

#### `cli:interactive` and `cli:quick-command`
**Current defaults:** Sonnet 4.6 / Haiku 4.5 | **Gemini 3 Flash fit:** Poor

Hallucination rate makes it unreliable for user-facing responses. Quick commands need factual accuracy.

---

## The Hallucination Problem

The 91% hallucination rate is Flash's defining limitation. In concrete terms for Panopticon:

- An implementation agent may claim it fixed a bug when it didn't
- A review agent may fabricate reasoning about why code is correct
- An exploration agent may report incorrect codebase structure
- A test agent may explain test failures with fabricated root causes

This doesn't mean Flash is useless — it means Flash should only be deployed in work types where its output is independently verifiable. Inspection (compile check verifies), merge (git verifies), and subagent exploration (code reading verifies) are relatively safe. Reviews and implementation are not.

---

## Summary

| Tier | Work Types | Rationale |
|------|-----------|-----------|
| **Deploy now** | `subagent:explore`, `subagent:general-purpose`, `specialist-inspect-agent` | Speed + 1M context + Pro-grade intelligence at Flash pricing. Output is verifiable. |
| **Benchmark next** | `specialist-test-agent`, `specialist-merge-agent`, `convoy:performance-reviewer`, `convoy:correctness-reviewer` | Strong capabilities at 6x cheaper than Sonnet, but hallucination risk needs validation |
| **Worth trying** | `specialist-uat-agent` (Agentic Vision), `issue-agent:testing` | Unique capabilities, benchmark hallucination impact |
| **Caution** | `issue-agent:implementation` | Strong benchmarks but Terminal-Bench weakness + hallucination = high risk |
| **Never** | Planning, specialist-review, security review, requirements review, documentation, synthesis, bash subagent, CLI modes |

## Integration Notes

- Google already configured as provider in Panopticon
- Model ID: `gemini-3-flash-preview`
- Available via Google AI API (API key)
- Thinking level should be configurable per work type in Cloister
- Must handle preview stability issues (503s, rate limits)
- Suggested capability scores: code-generation 86, code-review 78, debugging 80, planning 70, documentation 62, testing 82, security 72, performance 80, synthesis 68, speed 88, context-length 98
- **Hallucination flag:** Add a `hallucination_risk: high` annotation in model-capabilities so the smart selector can penalize it for trust-critical work types

## Sources

- [Google Blog: Gemini 3 Flash](https://blog.google/products-and-platforms/products/gemini/gemini-3-flash/)
- [Artificial Analysis](https://artificialanalysis.ai/models/gemini-3-flash-reasoning)
- [Better Stack Review](https://betterstack.com/community/guides/ai/gemini-3-flash-review/)
- [Google AI Developers: Gemini 3 Guide](https://ai.google.dev/gemini-api/docs/gemini-3)
- [Vellum: Benchmarks Explained](https://www.vellum.ai/blog/google-gemini-3-benchmarks)
- [VentureBeat: Flash for Enterprises](https://venturebeat.com/orchestration/gemini-3-flash-arrives-with-reduced-costs-and-latency-a-powerful-combo-for/)
- [OpenRouter](https://openrouter.ai/google/gemini-3-flash-preview)
- [Gemini API Pricing](https://ai.google.dev/gemini-api/docs/pricing)
