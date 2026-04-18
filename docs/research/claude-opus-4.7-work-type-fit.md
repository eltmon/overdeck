# Claude Opus 4.7 Work Type Fit Analysis

Research date: 2026-04-17

Evaluates Anthropic's Claude Opus 4.7 against Panopticon's 23 work types. Released April 16, 2026 — Anthropic's newest and most capable model. Panopticon needs to be updated to support it (breaking API changes from 4.6).

## Model Profile

| Spec | Value |
|------|-------|
| **Vendor** | Anthropic |
| **Release** | 2026-04-16 |
| **Model ID** | `claude-opus-4-7` |
| **Architecture** | Undisclosed parameter count |
| **Context Window** | 1M tokens (~555K words with new tokenizer) |
| **Max Output** | 128K tokens (300K via Batch API with `output-300k-2026-03-24` header) |
| **Knowledge Cutoff** | January 2026 |
| **Modalities** | Text + Image input; Text output |
| **Reasoning** | Adaptive only (low/medium/high/xhigh/max). Off by default. |
| **Pricing (input)** | $5.00/M |
| **Pricing (output)** | $25.00/M |
| **Batch API** | 50% off ($2.50/$12.50) |
| **Speed** | ~81 tok/s (2x faster than Opus 4.6) |
| **TTFT** | Not published |

**Cost comparison:**
- vs Opus 4.6 ($5/$25): **Same pricing, but new tokenizer inflates token count 1-1.35x** — effective cost increase of 0-35%
- vs GPT-5.4 ($2.50/$15): **2x more expensive input, 1.67x more expensive output** (before tokenizer inflation)
- vs Gemini 3.1 Pro ($2/$12): **2.5x more expensive input, 2.1x more expensive output**
- vs Sonnet 4.6 ($3/$15): **1.67x more expensive input, 1.67x more expensive output**

**Effective cost:** With 1.0-1.35x tokenizer inflation, the same text that cost $5/$25 on Opus 4.6 now costs $5-6.75/$25-33.75 on Opus 4.7.

## Key Benchmarks

| Benchmark | Opus 4.7 | Opus 4.6 | Delta | GPT-5.4 | Gemini 3.1 Pro |
|-----------|----------|----------|-------|---------|----------------|
| SWE-Bench Verified | **87.6%** | 80.8% | +6.8 | 84.0% | 80.6% |
| SWE-Bench Pro | **64.3%** | 53.4% | +10.9 | 57.7% | 54.2% |
| GPQA Diamond | **94.2%** | 91.3% | +2.9 | 92.8% | 94.3% |
| Terminal-Bench 2.0 | 69.4% | 65.4% | +4.0 | **75.1%** | 68.5% |
| CursorBench | **70%** | 58% | +12 | -- | -- |
| MCP-Atlas | **77.3%** | 75.8% | +1.5 | -- | 69.2% |
| OSWorld-Verified | **78.0%** | 72.7% | +5.3 | 75.0% | -- |
| Finance Agent v1.1 | **64.4%** | 60.1% | +4.3 | -- | -- |
| BrowseComp | 79.3% | **83.7%** | -4.4 | 82.7% | 85.9% |
| BigLaw Bench | **90.9%** | 90.2% | +0.7 | -- | -- |
| CharXiv Reasoning | **91.0%** | 84.7% | +6.3 | -- | -- |
| MMMLU | 91.5% | 91.1% | +0.4 | -- | -- |

**SOTA claims:** SWE-Bench Verified (87.6%), SWE-Bench Pro (64.3%), GPQA Diamond (94.2% — tied with Gemini 3.1 Pro), CursorBench (70%), MCP-Atlas (77.3%), OSWorld (78.0%)

## Standout Capabilities

1. **SWE-Bench SOTA** — 87.6% Verified and 64.3% Pro are the highest scores of any GA model. A 6.8-point jump on Verified and 10.9 on Pro over Opus 4.6.
2. **Vision transformation** — 54.5% → 98.5% accuracy on visual-acuity benchmark. Max resolution 2,576px (was 1,568px). 1:1 pixel coordinate mapping.
3. **Tool error reduction** — ~1/3 the tool errors of Opus 4.6 on long agentic runs. Critical for Panopticon's multi-hour agent sessions.
4. **Multi-step agentic reasoning** — 14% improvement on complex multi-step workflows. Fewer subagents spawned, more direct problem-solving.
5. **Speed doubled** — ~81 tok/s vs Opus 4.6's ~40.6 tok/s. Still slower than Sonnet (50-55 tok/s is Sonnet's standard; Opus 4.7 is now faster than Sonnet).
6. **MCP-Atlas leader** — 77.3% on multi-tool coordination. Highest of any model evaluated.
7. **CursorBench leader** — 70% on real-world IDE coding tasks (+12 over Opus 4.6).
8. **Memory/scratchpad** — Better at writing and using file-system-based memory across turns in agentic loops.
9. **More literal instruction following** — Won't silently generalize or "read between the lines." Better for constrained agent prompts.
10. **Fewer subagents** — Uses reasoning instead of spawning subagents by default. Raises effort to increase tool usage.

## Known Weaknesses

1. **Tokenizer inflation** — New tokenizer uses 1.0-1.35x more tokens on the same input. Effective cost increase of up to 35% despite same per-token pricing. 1M context window now represents ~555K words vs ~750K words on 4.6.
2. **BrowseComp regression** — 79.3% vs Opus 4.6's 83.7% (-4.4 points). Web research capability declined.
3. **Terminal-Bench gap** — 69.4% vs GPT-5.4's 75.1%. Still trails on complex terminal operations.
4. **Breaking API changes** — See "API Migration" section below. Cannot be a drop-in replacement for Opus 4.6.
5. **Higher output volume at higher effort** — `xhigh` and `max` effort produce more output tokens, inflating costs further with the new tokenizer.
6. **Stricter instruction following** — May cause unexpected results with older prompts that relied on the model interpreting ambiguous instructions.
7. **Thinking display change** — Thinking content is omitted from responses by default (silent change). Must opt in with `"display": "summarized"`.

---

## API Migration from Opus 4.6

### Breaking Changes

| Change | Opus 4.6 | Opus 4.7 |
|--------|----------|----------|
| **Model ID** | `claude-opus-4-6` | `claude-opus-4-7` |
| **Thinking mode** | `{"type": "enabled", "budget_tokens": N}` or `{"type": "adaptive"}` | **Only** `{"type": "adaptive"}` — `budget_tokens` returns 400 |
| **Thinking display** | Included by default | Omitted by default; opt in with `"display": "summarized"` |
| **Sampling params** | `temperature`, `top_p`, `top_k` accepted | All return **400 error** if non-default |
| **Effort levels** | low, medium, high, max | Added **`xhigh`** between high and max |
| **Max image resolution** | 1,568px / 1.15 MP | 2,576px / 3.75 MP |
| **Context window** | 1M (~750K words) | 1M (~555K words, new tokenizer) |

### New Features

- **Task budgets (beta):** Header `task-budgets-2026-03-13` + `output_config.task_budget` — advisory token budget across full agentic loop. Model sees a running countdown. Minimum 20K tokens.
- **`xhigh` effort level:** Recommended starting point for coding and agentic use cases. Minimum `high` recommended for intelligence-sensitive tasks.

### Panopticon Impact

These changes require updates to:
1. **`model-capabilities.ts`** — Add `claude-opus-4-7` with updated capability scores
2. **Cloister API calls** — Remove `budget_tokens` from thinking config, use adaptive only
3. **Cloister API calls** — Remove any `temperature`/`top_p`/`top_k` parameters for Opus 4.7
4. **Effort level config** — Add `xhigh` as an option, make it default for Opus 4.7 coding work
5. **Token estimation** — Account for 1-1.35x tokenizer inflation in cost calculations
6. **Task budgets** — Consider implementing for long-running agent loops

---

## Work Type Fit Assessment

### Excellent Fit — Upgrade from Opus 4.6

#### `planning-agent`
**Current default:** Claude Opus 4.6 | **Opus 4.7 fit:** Excellent — Upgrade

GPQA 94.2% (+2.9 over 4.6), improved multi-step reasoning (+14%), and better instruction following make this a strict upgrade for planning. The tokenizer inflation is acceptable for a once-per-issue work type.

#### `specialist-review-agent`
**Current default:** Claude Opus 4.6 | **Opus 4.7 fit:** Excellent — Upgrade

SWE-Bench Verified 87.6% (+6.8) means dramatically better code comprehension. 1/3 tool errors means more reliable review workflows. MCP-Atlas 77.3% (highest of any model) confirms strong tool orchestration for review agents that use tools to verify claims.

#### `convoy:security-reviewer`
**Current default:** Claude Opus 4.6 | **Opus 4.7 fit:** Excellent — Upgrade

GPQA 94.2% + improved vision (98.5% accuracy) enables visual security analysis of architecture diagrams. Better instruction following reduces false positive/negative risk. Security review runs infrequently enough that tokenizer inflation is acceptable.

#### `convoy:requirements-reviewer`
**Current default:** Claude Opus 4.6 | **Opus 4.7 fit:** Excellent — Upgrade

Better instruction following + improved reasoning depth. Requirements review is read-heavy (input-dominated), so the tokenizer inflation on input is the primary cost concern.

### Good Fit — Strong Upgrade Candidate

#### `issue-agent:exploration`
**Current default:** Claude Opus 4.6 | **Opus 4.7 fit:** Excellent — Upgrade

SWE-Bench Pro 64.3% (+10.9 over 4.6) shows dramatically better codebase understanding. Vision 98.5% enables processing architecture diagrams. 81 tok/s (2x faster) accelerates exploration. However, the tokenizer inflation reduces effective context to ~555K words — still large, but less than 4.6's ~750K.

**Alternative:** Gemini 3.1 Pro at $2/$12 with 1M context and GPQA 94.3% remains a strong exploration candidate at 2.5x cheaper.

#### `convoy:correctness-reviewer`
**Current default:** Claude Sonnet 4.6 | **Opus 4.7 fit:** Good — Consider upgrade

GPQA 94.2% and SWE-Bench Pro 64.3% are compelling for catching subtle logic errors. But Sonnet 4.6 at $3/$15 may be sufficient for this lane. Benchmark before committing.

#### `convoy:performance-reviewer`
**Current default:** Claude Sonnet 4.6 | **Opus 4.7 fit:** Good — Consider upgrade

Same reasoning as correctness reviewer. Strong analytical capabilities, but Sonnet may be sufficient.

#### `specialist-uat-agent`
**Current default:** Claude Sonnet 4.6 | **Opus 4.7 fit:** Good

Vision transformation (98.5% accuracy, 2,576px resolution, 1:1 pixel mapping) makes Opus 4.7 the strongest visual analysis model for UI testing. However, $5/$25 is expensive for UAT which runs frequently.

### Moderate Fit — Possible but Expensive

#### `issue-agent:implementation`
**Current default:** Kimi K2.5 | **Opus 4.7 fit:** Moderate

SWE-Bench Verified 87.6% is best-in-class, and 1/3 tool errors would reduce stuck loops. But at $5/$25 (8.3x Kimi's input price, 10x output), the cost per implementation session would be $50-200+ vs $5-20 with Kimi. Reserve for critical/complex implementations only.

#### `specialist-test-agent`
**Current default:** Claude Sonnet 4.6 | **Opus 4.7 fit:** Moderate

Strong reasoning for root cause analysis, but test agents run frequently. Sonnet 4.6 at 60% cost is usually sufficient.

### Poor Fit — Too Expensive

#### All subagents, inspect agent, merge agent, CLI modes
Same rationale as Opus 4.6 — too expensive and (despite speed improvement) still slower than purpose-built budget models for these high-volume work types.

---

## Summary

| Tier | Work Types | Rationale |
|------|-----------|-----------|
| **Upgrade now** | `planning-agent`, `specialist-review-agent`, `convoy:security-reviewer`, `convoy:requirements-reviewer` | Strict improvements over Opus 4.6 on every quality dimension |
| **Upgrade now** | `issue-agent:exploration` | 2x faster, 10.9-point SWE-Bench Pro jump, vision transformation |
| **Benchmark next** | `convoy:correctness-reviewer`, `convoy:performance-reviewer` | Strong upgrade from Sonnet 4.6, but cost needs validation |
| **Worth trying** | `specialist-uat-agent` | Vision transformation is uniquely valuable for UI testing |
| **Critical implementations only** | `issue-agent:implementation` | Best-in-class SWE-Bench but 8-10x more expensive than alternatives |
| **Never** | Subagents, inspect, merge, CLI, documentation, synthesis | Too expensive for high-volume work |

## Integration Notes

- **REQUIRES CODE CHANGES** — cannot be a drop-in replacement for Opus 4.6
- Model ID: `claude-opus-4-7`
- Available via Anthropic API, Amazon Bedrock (research preview), Google Vertex AI, Microsoft Foundry
- Suggested capability scores: code-generation 94, code-review 96, debugging 92, planning 98, documentation 90, testing 88, security 96, performance 90, synthesis 92, speed 56, context-length 95 (reduced from 98 due to tokenizer inflation)
- **Effort recommendation:** Use `xhigh` for coding/agentic work, `high` for review, `medium` for lightweight tasks
- **Task budgets:** Consider implementing `task-budgets-2026-03-13` beta for long-running agent loops to help Opus 4.7 prioritize work within token constraints

## Sources

- [Anthropic: Claude Opus 4.7](https://www.anthropic.com/news/claude-opus-4-7)
- [What's New in Claude Opus 4.7](https://platform.claude.com/docs/en/about-claude/models/whats-new-claude-4-7)
- [Migration Guide](https://platform.claude.com/docs/en/about-claude/models/migration-guide)
- [Anthropic Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- [Anthropic Models Overview](https://platform.claude.com/docs/en/about-claude/models/overview)
- [Vellum: Opus 4.7 Benchmarks Explained](https://www.vellum.ai/blog/claude-opus-4-7-benchmarks-explained)
- [VentureBeat: Opus 4.7 Release](https://venturebeat.com/technology/anthropic-releases-claude-opus-4-7-narrowly-retaking-lead-for-most-powerful-generally-available-llm)
- [TheNextWeb: Opus 4.7 Coding Benchmarks](https://thenextweb.com/news/anthropic-claude-opus-4-7-coding-agentic-benchmarks-release)
- [Lushbinary: Opus 4.7 Developer Guide](https://lushbinary.com/blog/claude-opus-4-7-developer-guide-benchmarks-vision-migration/)
- [Finout: Opus 4.7 Pricing Analysis](https://www.finout.io/blog/claude-opus-4.7-pricing-the-real-cost-story-behind-the-unchanged-price-tag)
- [llm-stats.com: Opus 4.7 vs 4.6](https://llm-stats.com/blog/research/claude-opus-4-7-vs-opus-4-6)
