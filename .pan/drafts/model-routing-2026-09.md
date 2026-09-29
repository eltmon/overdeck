# Model strengths and Overdeck routing: Sonnet 5.5, GPT-6 Sol, GPT-6 Luna

**Date:** 2026-09-29. Web sources checked 2026-09-28. Repo facts read from `origin/main` at `31b6e82d819`.
**Scope:** research and planning only. Nothing in the repo, config, tracker or agents was changed.
**Status:** approved by the operator 2026-09-29 for filing. Every default change stays gated on the eval results named below. "The reference install" means the operator's own Overdeck install; its config is described generically, not quoted.

Throughout, "high" means Overdeck's default effort (`sync-sources/rules/effort-high-default.md`, `DEFAULT_EFFORT` in PAN-4249). Vendor benchmarks are mostly reported at `max` or `xhigh`, so they overstate what Overdeck actually launches. That gap is why every default change below waits on an Overdeck eval.

---

## 1. Verdict

### Claude Sonnet 5.5 (`claude-sonnet-5-5`, $2 / $10 per MTok)

**Best at:** terminal and shell-driven agentic work, long single sessions (native 1M context, 128K output), and near-Opus general intelligence at half Opus 5.5's token price.

- It beats Opus 5.5 on Terminal-Bench 4.0: 70.6 vs 66.4 (xhigh) in Anthropic's system card. Artificial Analysis measured 64 vs 60, and Vals measured 53.03.
- It trails Opus 5.5 on repo-scale code changes. SWE-Bench Pro is 81.3 vs 89.9, and FrontierCode 1.1 is 46.2 vs 54.4.
- Its Artificial Analysis Intelligence Index is 56 at max, close to Opus 5.5's 58. At **high** it drops to 47, level with GPT-6 Sol at max (48).
- It is token-hungry at max: about 193K output tokens per Artificial Analysis task and $7.60 per task, against $5.98 for Opus 5.5. Its per-token price advantage only becomes a per-task saving at high or below, and that has to be measured.
- Anthropic claims it is 30%+ faster than Sonnet 5 and up to 30% cheaper per task.

**Overdeck placement:**

| Slot | Recommendation | Gate |
|---|---|---|
| `workhorses.mid` (product default) | Keep: `claude-sonnet-5-5`, already the default since v0.63.0 (PAN-4327) | Done |
| `workhorses.mid` on installs that staff it with Opus 5.5 (the reference install does) | Move to Sonnet 5.5. This halves the token price for `work` (unplanned), `ship` and `worker`. **Coupling:** on such installs `roles.review.model` and `roles.strike.model` may also be `workhorse:mid`, with the review sub-lanes on `parent`. In the **same** config edit, re-point `roles.review.model` and `roles.review.sub.security.model` to `workhorse:expensive`, and decide `strike` (recommended: `workhorse:expensive`, because strike lands on main without review). See section 6 | E6 head-to-head: medium and complex arms |
| Tier `simple-medium` (installs still on `claude-sonnet-5`) | Move to Sonnet 5.5. The price is the same and it is a newer model; 64% of plans staff here (section 3.1) | E6 smoke (N=3 medium) |
| Tier `complex` | Keep Opus 5.5. The SWE-Bench Pro gap (−8.6) is the decisive signal for multi-file code changes | Try Sonnet 5.5 only if E6 complex arm is within 10 points |
| `test` role (installs still on `claude-sonnet-5`) | Move to Sonnet 5.5. Test runs are terminal-heavy, which is its strongest benchmark | E6 (test verdict agreement) |
| Review convoy `correctness`, `performance`, `requirements` | Sonnet 5.5 | E2 review-recall within 5 points of Opus 5.5 |
| Review parent and `security` lane | Keep Opus 5.5. Security and synthesis are where missed findings cost most | none |
| `plan`, `sequencer`, `knowledge` | Keep Opus 5.5 (expensive slot) | E3 plan-quality before any change |
| Gauntlet builders | Sonnet 5.5 is the workhorse builder | none (skill already says workhorse for builders) |
| Gauntlet critics | Keep frontier (Opus 5.5). The skill says "never cheap out on the judge" | none |
| Conversation default (product) | Keep `claude-sonnet-5-5` | Done |
| Fork summary, status review, handoff author | Sonnet 5.5. Fork summary needs 1M in one shot, and no GPT model fits there on Overdeck's 272K pin. Installs that pin `handoff_author_model` to `claude-sonnet-5` should move it | E4 summary-faithfulness |
| Claude-code subagents (Explore, general-purpose) | They inherit the session model; no change | none |

**Watch-outs (from Anthropic's migration and prompting guides):**

- Non-default `temperature`, `top_p` or `top_k`, prefill, `budget_tokens`, `thinking: disabled` and forced `tool_choice` all return 400. Overdeck's eval harness sends `temperature: 0` (section 3.9).
- Thinking blocks are model-locked. Sonnet 5.5 cannot read blocks from Opus 5, Opus 5.5 or Fable, and edited history replays return 400. Mid-conversation model switches from Opus or Fable to Sonnet 5.5 need verification (issue H).
- It "can treat a user's mid-task message as a prompt injection." Overdeck delivers review feedback to work agents through `pan tell`, so this needs an eval (E5).
- At every effort level it adds tests and docs nobody asked for. That interacts with the file-size allowlist and review scope.
- At `low` it can skip verifying its own changes. Overdeck launches at high, so this should not bite.
- It needs Claude Code 2.1.284+. The reference install has 2.1.284. User-side version detection is PAN-4359 (open).

### GPT-6 Sol (`gpt-6-sol`, $2 / $0.20 cached / $10 per MTok)

**Best at:** cheap, token-efficient mid-tier coding, and a second model family for diversity.

- It is priced exactly like Sonnet 5.5 per token, but Artificial Analysis's **cost per Intelligence-Index task is $1.06**, against $7.60 for Sonnet 5.5 at max and $5.98 for Opus 5.5.
- Artificial Analysis Coding Agent Index is 57 (Astra 62, Fable 5.1 62, GPT-5.6 Sol 55).
- It is weak on Terminal-Bench 4.0 (43 vs Sonnet 5.5's 64 in the same Artificial Analysis run). Its Intelligence Index is 48 at max.
- Its hallucination rate on Artificial Analysis is 60%, versus Astra 51% and GPT-5.6 Sol 92%.
- Time to first token at max effort is about 164 s.
- OpenAI's API page says its default effort is medium. Codex 0.157.1's catalog says low (repo comment). Overdeck launches it at high.

**Overdeck placement:**

| Slot | Recommendation | Gate |
|---|---|---|
| Tier `simple-medium` | Add a `distribution` entry (start at 30%, codex harness) beside Sonnet 5.5, to spend ChatGPT-plan quota instead of Anthropic quota | E6 Sol arm: approval-without-rework within 10 points of Sonnet 5.5, and no harness stall (PAN-2817) |
| Review | Add a cross-family second-opinion lane (for example `correctness`) only if E2 shows it finds blockers that Claude lanes miss | E2 disjoint-findings score |
| Gauntlet critic | Use it as a second blind judge next to Opus 5.5, never as the only judge | E2 plus a gauntlet A/B |
| Not recommended | `plan`, review parent, tier supervisor, `flywheel`, `strike`, fork summary, and any 1M-context slot. Reasons: lower intelligence, a 272K Overdeck pin, 60% hallucination, and unattended-harness failures (open PAN-2817, 3313, 2639) | none |
| Class table | Reclassify `frontier` → `workhorse` (issue D). It is priced and positioned as the mid tier, and its Intelligence score sits below Sonnet 5.5 | none (metadata correction) |

**Cost reasoning.** Sol's $/MTok equals Sonnet 5.5's, so the case for Sol rests on two things:

- It emits fewer tokens per task: roughly 7× cheaper per task than Sonnet 5.5 at max on Artificial Analysis.
- It spends ChatGPT subscription quota rather than Anthropic quota.

Both are real, but the quality gap on terminal work is also real. Only a measured cost per merged PR at Overdeck's high effort settles it.

### GPT-6 Luna (`gpt-6-luna`, $0.10 / $0.01 cached / $0.50 per MTok)

**Best at:** fast, very cheap mechanical work.

- About 141–154 output tokens/s, and 0.74 s to first token with reasoning off.
- $0.07 per Artificial Analysis Intelligence task, about 10× cheaper per token than Haiku 4.5.
- The weak points are quality numbers: Intelligence Index 37, Coding Agent Index 41, and a **77% hallucination rate**.
- Vellum's secondary report gives DeepSWE (max) 66.6 vs Sol's 68.8. That is unverified against OpenAI and measured at max effort.

**Overdeck placement:**

| Slot | Recommendation | Gate |
|---|---|---|
| `workhorses.cheap` on installs that set it to `gpt-5.6-luna` | Re-point it to `gpt-6-luna` for hygiene only. **It is inert:** no role, sub-role or tier in the reference install's config or in the product defaults references `workhorse:cheap` (section 3, finding 13). Luna only runs where a literal names it: the tier `trivial` model, the `providers.ts` haiku remap, `ttsSummarizer`, `registry.classification` | none (no effect today) |
| Tier `trivial` | Luna is a candidate, but see section 3.1: **no plan on main has a trivial max difficulty**, so with `swarm.mode: off` this tier never fires. Luna earns tier placement only when swarm runs slot items (43 trivial and 283 simple items exist) | E6 swarm arm |
| Background classifiers | `ttsSummarizer.model` (`gpt-5.4-mini`, a deprecated id that hops to `gpt-5.6-luna`) and `registry.classification.model` (`gpt-4.1-nano`) are natural Luna slots: short, structured and cheap | E4 title/classification cases |
| Titles, compaction, fork/handoff summaries, memory extraction | **Not yet.** A 77% hallucination rate is disqualifying for anything whose output later becomes an agent's memory or context | E4 summary-faithfulness must beat Haiku 4.5 |
| Proxied-GPT subagents (the haiku slot in `providers.ts` openai `tierModels`) | `gpt-6-luna`, replacing `gpt-5.6-luna` | Issue D |
| Not recommended | Any work tier above simple, any review lane, any critic | none |

**Luna blocker: ChatGPT-login 400.** The backend rejects Sol and Luna for ChatGPT-account clients reporting a version below 0.155.x. The error is "The 'gpt-6-luna' model is not supported when using Codex with a ChatGPT account"; Astra keeps working on the same account.

- **Codex (direct):** the reference install's Codex CLI is 0.158.0, which is fine. But Overdeck's `MINIMUM_NATIVE_ENDPOINT_CODEX_VERSION` is `0.153.4` (`src/lib/codex/app-server-manager.ts:22`), so a host on 0.153–0.154 passes Overdeck's check and then 400s on Sol and Luna. PAN-4236 notes the reference install was on 0.153.4 when GPT-6 was added.
- **CLIProxy:** the reference install's CLIProxy is 7.3.16. Whether it sends a new-enough version header is **UNVERIFIED**. Its release notes do not mention GPT-6 or the header, and its local `/v1/models` listed no `gpt-6-*` ids on 2026-09-28.
- **Consequence:** every Luna or Sol placement on the claude-code+CLIProxy route is conditional on issue D2.

### Everything else, briefly

| Model | Overdeck role |
|---|---|
| Opus 5.5 ($4/$20) | Stays the expensive slot for plan, review parent, security, complex tier, critic, supervisor and flywheel. Its default effort is medium; Overdeck runs high. Fast mode costs $8/$40 and is not recommended |
| Fable 5.1 ($10/$50) | Expert tier only. Only 3% of plans have an expert max difficulty. Artificial Analysis Coding Agent 62 and arena Agent board #1, but Terminal-Bench 4.0 of 55.8 is below Sonnet 5.5's 70.6 |
| Sonnet 5 | Superseded by Sonnet 5.5 at the same price. Replace wherever an install still pins it: `test`, tier `simple-medium`, `handoff_author_model` |
| Haiku 4.5 ($1/$5, 200K) | Its model page guarantees availability through at least 2026-10-15. That is Anthropic's standard one-year floor, the same that gives Sonnet 5.5 2027-09-28; **no retirement is announced**. Anthropic says Haiku 5.5 "will join the Claude 5.5 family in the coming weeks". Overdeck defaults use Haiku 4.5 for `compactionModel`, `titleModel`, the memory classifier and the (unconsumed) `workhorses.cheap`. Plan a successor because a better small model is arriving, not because Haiku 4.5 is leaving (issue F) |
| GPT-6 Astra ($10/$50) | Artificial Analysis Coding Agent 62 and Terminal-Bench 4.0 of 59–60, at Fable's price. It is a cross-family expert or critic option. No change is recommended until E2 or E6 shows a need |

---

## 2. Model comparison (models Overdeck supports)

Prices are USD per MTok (input / cached input / output). "Overdeck ctx" is the window Overdeck configures (`docs/MODEL-CONTEXT-AUDIT.md`), not the vendor maximum.

| Model | Price | Vendor ctx / max out | Overdeck ctx | Speed | Strengths | Known issues |
|---|---|---|---|---|---|---|
| Fable 5.1 `claude-fable-5-1` | 10 / 0.25 / 50 | 1M / 128K | 1M | Slower | Long-horizon autonomy; arena Agent #1; Artificial Analysis Coding Agent 62 | Terminal-Bench 4.0 55.8; needs Claude Code ≥ 2.1.255 |
| Opus 5.5 `claude-opus-5-5` | 4 / 0.20 / 20 | 1M / 128K | 1M | Moderate; about 75 tok/s, 21.5 s TTFT at medium | SWE-Bench Pro 89.9, Artificial Analysis Intelligence 58 (max), Vals #1 | Default effort medium; its thinking blocks can't be read by Sonnet 5.5 |
| Sonnet 5.5 `claude-sonnet-5-5` | 2 / 0.20 / 10 | 1M / 128K | 1M | 93 tok/s, 17 s TTFT at high | Terminal-Bench 4.0 70.6, OSWorld 2.1 80.1, Vals #2 | Artificial Analysis 47 at high vs 56 at max; very token-heavy at max; sampling params, prefill and forced tool_choice return 400; unrequested tests and docs; mid-task messages mistaken for prompt injection |
| Sonnet 5 `claude-sonnet-5` | 2 / 0.20 / 10 | 1M / 128K | 1M | — | Superseded | Terminal-Bench 4.0 is 10.3% as published on anthropic.com/claude-sonnet-5-5 (re-fetched 2026-09-29). This is anomalous against every other Sonnet 5 → 5.5 delta (+15 to +25 points), so don't rely on it |
| Haiku 4.5 `claude-haiku-4-5` | 1 / 0.10 / 5 | 200K / 64K | 200K | Fastest Claude | Cheap, reliable small model | Availability guaranteed through at least 2026-10-15 (standard one-year floor, no retirement announced); no effort control; Feb 2025 cutoff |
| GPT-6 Astra `gpt-6-astra` | 10 / 1 / 50 | 1.05M / 128K | 272K | — | Artificial Analysis Coding Agent 62, Intelligence 53, hallucination 51% | Some paid plans leave out its top effort; secondary sources imply release about 2026-09-03 (UNVERIFIED) |
| GPT-6 Sol `gpt-6-sol` | 2 / 0.20 / 10 | 1.05M / 128K | 272K (>272K billed 2× in, 1.5× out) | About 85 tok/s, about 164 s TTFT at max | $1.06 per Artificial Analysis task; Coding Agent 57 | Terminal-Bench 4.0 43; hallucination 60%; ChatGPT-login 400 below Codex 0.155; classed `frontier` in Overdeck |
| GPT-6 Luna `gpt-6-luna` | 0.10 / 0.01 / 0.50 | 1.05M / 128K | 272K | About 141–154 tok/s | $0.07 per Artificial Analysis task; fastest | Intelligence 37, hallucination 77%; same 400; codex#49052 reports high quota use per prompt (open) |
| GPT-5.6 Sol / Terra / Luna | Sol: $4/$0.40/$20 on OpenAI's page (promo) vs **$5/$30 in `model-capabilities.ts`** (PAN-4236). Terra: $2/$12 in the repo (not re-verified). Luna: $0.20/$1.20 in the catalog but $1/$6 in `cost.ts` (PAN-4236) | 1.05M | 272K (372K opt-in) | — | Previous generation | OpenAI's codex PR #47401 proposed migrating 5.6 to 6 (closed, not merged) |

Fast and priority tiers: GPT fast mode costs 2× (Sol $4/$20, Luna $0.20/$1.00). Claude fast mode exists only on Opus (5.5: $8/$40, Claude API only). Batch is 50% off on both vendors.

---

## 3. Where Overdeck's routing would stop a better model from being used

### Superseded: the tier-bypass bug is fixed

Earlier internal notes on the tier-bypass bug and on GPT routing are **stale**. Current facts:

- **PAN-3857** was closed 2026-09-17. `buildPanStartArgs` (`src/dashboard/server/routes/agents/shared.ts:66`) emits `--model` only for an explicit operator choice. `resolveSingleWorkTierSpawnParams` (`src/lib/agents/spawn-prep.ts:481`) staffs the single work agent on the plan's **hardest remaining item** (`selectStaffingItem`), not the first item.
- **PAN-3858 and PAN-3859** are closed. Promotions now reach staffing, and the legacy chain and the `resume.ts` literal are gone.
- **PAN-3917** deleted the per-issue record: `resolveIssueWorkModel` in `staffing.ts` always returns `undefined`. The 101 stale `record.workModel` stamps no longer route anything.
- The reference install now routes OpenAI through the codex harness (`models.providers.openai.harness: codex`), not claude-code.

### What still blocks or distorts placement today

**1. Swarm off means one model per issue, staffed at the plan's max difficulty.** The reference install runs with swarm off; the schema type is `'off'|'auto'|'always'`. Across the 65 plans on `origin/main` `.pan/specs/`, the max difficulty per plan (with `by_kind` design/spike counted as complex) splits as:

| Max difficulty | Plans | Share | Reference-install tier and model |
|---|---:|---:|---|
| trivial | 0 | 0% | `trivial` (Haiku 4.5) never fires |
| simple | 10 | 15% | `simple-medium` (`claude-sonnet-5`) |
| medium | 32 | 49% | `simple-medium` (`claude-sonnet-5`) |
| complex | 21 | 32% | `complex` (Opus 5.5) |
| expert | 2 | 3% | `expert` (Fable 5.1) |

64% of issues already staff on the Sonnet tier, which is still on the older `claude-sonnet-5`. Luna, or any small model, can only earn work share through swarm slot items: 43 trivial and 283 simple items exist.

**2. `gpt-6-sol` is misclassified as `frontier`** (`src/lib/model-capability-class.ts`).

- Its own catalog row calls it "GPT-6 mid tier", and its price equals Sonnet 5.5's, which is classed `workhorse`.
- Placing it in `simple-medium`, where it belongs, makes `tier-fitness.ts` warn "frontier-class model but this tier only owns simple, medium — a workhorse-class model would cost less".
- The class table's own rule ("provider tierModels.opus slot ⇒ frontier") doesn't hold either: openai `tierModels.opus` is `gpt-5.6-sol`.

This is issue D.

**3. `providers.ts` openai `tierModels` still points at GPT-5.6:** `{ opus: 'gpt-5.6-sol', sonnet: 'gpt-5.6-terra', haiku: 'gpt-5.6-luna' }`. Proxied GPT sessions remap subagents to the old generation. See also PAN-3667 (open: Anthropic-pinned subagents die in proxied sessions). This is issue D.

**4. The ChatGPT-login 400 for Sol and Luna has no guard.** `MINIMUM_NATIVE_ENDPOINT_CODEX_VERSION = '0.153.4'`, but GPT-6 Sol and Luna need a client version of at least 0.155 (0.156.1 carries the catalog entries). The CLIProxy version header is unverified. `pan doctor` does not detect either. This is issue D2.

**5. Stale product defaults.**

- `DEFAULT_WORKHORSES.expensive = 'claude-opus-4-8'`, two releases behind.
- `DEFAULT_ROLES.flywheel.model` and `DEFAULT_MODEL_REFS.flywheel` are the literal `'claude-opus-4-8'`, not `workhorse:expensive`, so re-pointing the slot never moves the flywheel (`src/lib/config-yaml/roles.ts`).

This is issue E.

**6. Haiku 4.5 is the only small Anthropic default, and its successor (Haiku 5.5) is announced as coming.** Four defaults use it: `conversations.compactionModel`, `conversations.titleModel`, the memory `classifier.model` and `workhorses.cheap`. Availability is guaranteed only through at least 2026-10-15 (the standard floor; no retirement is announced). This is issue F.

**7. Capability scores for all three new models are inherited, not measured.**

- `model-capability-additions.ts` says "Skill scores inherit the Sonnet 5 baseline" for Sonnet 5.5, and the gpt-5.6 baselines for Sol and Luna.
- The smart selector and the tier-fitness hints therefore can't distinguish Sonnet 5.5 from Sonnet 5, or GPT-6 from GPT-5.6.
- `MODEL_CAPABILITIES` header "Last updated: 2026-06-30".

This is issue G, which feeds PAN-1852.

**8. The 272K GPT pin excludes Sol and Luna from 1M slots.** `forkSummaryModel` needs the whole conversation in one shot, and long-context planning does too. This pin is deliberate (PAN-3388 billing tier), not a bug, but it is a hard discriminator: those slots stay Claude.

**9. The eval harness can't run the candidates.**

- `evals/lib/prompt-harness.ts` is Anthropic-SDK-only, so it cannot run GPT models at all.
- It sends `temperature: 0`, which returns 400 on Sonnet 5.5, and on every model with `supportsSamplingParams: false` (Opus 5, Opus 5.5, Fable).
- `max_tokens` defaults to 4096, which truncates adaptive-thinking output.

The two existing live evals (flywheel-launch, review-synthesis) therefore cannot confirm any placement recommended here. This is issue A, the prerequisite.

**10. There is no way to run a variant matrix any more.**

- PAN-3054's proposed mechanism (per-issue record overrides) died with PAN-3917.
- There is no `pan benchmark` CLI.
- The `/benchmark` skill still creates one QuantumLlama issue per scenario, and its examples cite Opus 4.6 and Sonnet 4.6.

This is issue C.

**11. Harness reliability for unattended GPT roles.** Open issues:

- PAN-2817: GPT sessions idle at the composer and are never redriven.
- PAN-3313: a CLIProxy stream error benches the only auth, giving 503s.
- PAN-2639: codex-resume replays a revoked token, wedging review convoys with 401.
- PAN-2580: `pan tell` can't reach codex conversations.

Review and test depend on warm-session messaging, so Sol stays out of review-parent and test roles until these close, whatever E2 says.

**12. Thinking-block and model-switch interop for Sonnet 5.5 is unverified.** Switching a conversation from Opus 5.5 or Fable to Sonnet 5.5, or forking one, may send history containing unreadable thinking blocks. Rewritten history (compaction) can 400 on replay for accounts created on or after 2026-08-31. This is issue H.

**13. `workhorse:cheap` has no consumer.** No role in `DEFAULT_ROLES` or `DEFAULT_MODEL_REFS` references it; the review sub-lanes are expensive or mid. `DEFAULT_TIERED_EXECUTION_CONFIG` has no tiers. In the reference install's config, every role is `workhorse:mid`, `workhorse:expensive` or a literal, and every tier is a literal. Two other literals copy the slot: `RolesPanel.tsx:79` has a frontend `cheap: 'claude-haiku-4-5'`, and `settings-api.ts:1397` has a preset `cheap: 'minimax-m2.7-highspeed'`. Re-pointing the slot therefore changes nothing that launches. Luna, or any small model, reaches work only through the tier `trivial` literal (swarm only), the `providers.ts` haiku remap, or background-AI literals. This goes in issue F.

---

## 4. Eval plan

**Principle:** measure at Overdeck's effort (high) on Overdeck's harnesses. Score structure first; use an LLM judge only for fuzzy output. Change no default until its gate passes. Everything is documented in `evals/README.md` with expected cost.

### Existing evals (usable after issue A)

| Eval | Confirms | Candidates |
|---|---|---|
| `evals/flywheel-launch.eval.ts` | The flywheel and sequencer role stays on the expensive slot, and Opus 5.5 is a safe replacement for the `claude-opus-4-8` literal (issue E) | Opus 4.8 vs Opus 5.5 vs Sonnet 5.5 |
| `evals/review-synthesis.eval.ts` | Whether the review parent can move off Opus 5.5 | Opus 5.5 vs Sonnet 5.5 vs Sol |
| `evals/memory-status-rollup.eval.ts` | Offline, uses captured outputs, so it is not a model comparison. It shows the scorer pattern to reuse | none |
| `tests/unit/evals/prompt-rails.test.ts` | Deterministic, no model | none |

### New evals (issue B)

| ID | Eval | Fixture | Scorer | Decides |
|---|---|---|---|---|
| E2 | `review-recall.eval.ts` | 12–20 real diffs with a known blocker: reverted PRs, and PRs where review requested changes that later landed | Recall and precision of the known blocker per lane prompt (`roles/review.md` plus the lane brief); also the count of blockers only one model family found | Sonnet 5.5 on the correctness, performance and requirements lanes; Sol as a cross-family lane or critic |
| E3 | `plan-quality.eval.ts` | 8 closed issues with their committed xBRIEF as reference | xBRIEF schema and quality lint pass; difficulty agreement with the reference; item count and file-scope overlap | Whether `plan` could move off Opus 5.5 (expected answer: no) |
| E4 | `summary-faithfulness.eval.ts` | 10 transcripts with planted facts and decoys, covering fork summary, handoff, compaction and title | Planted-fact recall; hallucinated-fact count (hard fail at >0 for compaction and handoff); title length and format | Luna vs Haiku 4.5 vs Sonnet 5.5 for titles, compaction, TTS and classification; the successor for issue F |
| E5 | `feedback-acceptance.eval.ts` | A work-agent context plus a mid-task `pan tell` review-feedback message | Does the model act on it, rather than flag it as an injection or ignore it? | The Sonnet 5.5 work role (its prompting guide names this risk) |

Keep scorer logic in `evals/lib/*.ts` so it can be unit-tested offline.

### Head-to-head on the real pipeline (E6, issue C)

**Arms, each run serially, N ≥ 3:**

| Tier | Models |
|---|---|
| medium | Sonnet 5.5 (claude-code) vs Opus 5.5 (claude-code) vs Sol (codex) |
| complex | Opus 5.5 vs Sonnet 5.5 |
| swarm trivial/simple slot | Luna (codex) vs Haiku 4.5 |

**Inputs:**

- The `/benchmark` QuantumLlama template.
- 6 replay issues copied from closed issues with committed xBRIEFs (2 simple, 2 medium, 2 complex). Each gets a new `benchmark`-labelled issue whose body links the original and whose plan is the original spec. Replays are never merged.

**Mechanism (works today, no new code):**

1. `pan start <id> --model <m> --harness <h>`. An explicit override is the legitimate tool here, and nothing stamps it permanently any more.
2. Or set `plan.metadata.tiered_execution` or item `metadata.model` in the copied spec.

**Metrics:**

| Metric | Source |
|---|---|
| Cost per merged-ready PR | Close-out usage |
| Tokens in/out | Close-out usage |
| Wall-clock from first spawn to merge-ready | `<workspace>/.overdeck/pipeline.jsonl` |
| Review rounds and first-pass approval | The PR |
| CI verification result | The PR |
| Harness stalls and interventions | Pipeline journal plus operator notes |

**Pass thresholds (proposed):**

- **Sonnet 5.5 replaces Opus 5.5 for `mid` on installs that staff it with Opus** if first-pass approval is within 10 points of Opus and cost per PR is ≤ 70% of Opus's.
- **Sol gets a 30% distribution share** if approval is within 10 points of Sonnet 5.5, there are zero unrecovered stalls, and its cost per PR is ≤ Sonnet 5.5's.
- **Luna takes the cheap slot** if its slot-item pass rate is ≥ Haiku 4.5's and E4 shows no hallucinated facts.

**Contention and admission:** run arms one at a time. The resource governor and the shared Vitest CPU queue skew wall-clock when arms overlap. Record the host load average per run.

**Critic check:** run a `pan lane start --role critic --model <m>` blind A/B on one gauntlet run: Opus 5.5 critic vs Opus 5.5 plus a Sol second critic. Score defects caught against a hand-labelled list.

---

## 5. Ready-to-file issues

Every default change below is gated on a named eval, and none of them adds a hardcoded model fallback. Resolution always goes through config, workhorse refs, or a named error (the `no-hardcoded-model-fallbacks` rule; `resolveTier` and `derefWorkhorse` already throw rather than guess).

---

### Issue A: Live evals can't run Sonnet 5.5, Opus 5.x or any GPT model: make the prompt harness provider-neutral and sampling-safe

**Problem**

`evals/lib/prompt-harness.ts` has two defects that stop the live evals running on the models Overdeck now defaults to:

- It builds `new Anthropic()` and always sends `temperature: 0` with `max_tokens: 4096`.
- Sonnet 5.5, Opus 5, Opus 5.5 and Fable reject non-default sampling parameters with 400. Their catalog rows say `supportsSamplingParams: false`.
- It has no OpenAI path, so `gpt-6-sol`, `gpt-6-luna` and `gpt-6-astra` cannot be evaluated at all.
- A 4096-token cap truncates adaptive-thinking output.

The flywheel-launch and review-synthesis evals therefore cannot confirm any model placement.

**Design**

- `runPromptScenario` resolves the provider from the model id through the existing provider map (`getModelProvider` in `src/lib/model-fallback.ts`). It never guesses: an unknown id fails loudly, and `OVERDECK_EVAL_MODEL` stays mandatory.
- **Anthropic:** omit `temperature` when `MODEL_CAPABILITIES[model].supportsSamplingParams === false`. Take `max_tokens` from `maxOutputTokens` when set, capped by an optional override. Pass `effort` from `OVERDECK_EVAL_EFFORT`, which defaults to the canonical `DEFAULT_EFFORT` from `@overdeck/contracts`, not a literal.
- **OpenAI:** call the Responses API with `OPENAI_API_KEY`, or with the local CLIProxy endpoint when `OVERDECK_EVAL_OPENAI_VIA=cliproxy`. Map effort to `reasoning.effort`.
- Record model, provider, effort, token usage and cost in each eval result so runs are comparable.

**Work items**

1. `evals/lib/prompt-harness.ts`: provider dispatch, sampling-param guard, effort and max-tokens handling, usage capture.
2. `tests/unit/evals/lib/prompt-harness.test.ts`: request shape per provider. Assert no `temperature` is sent for no-sampling models, and that an unknown id rejects before any network call.
3. `evals/flywheel-launch.eval.ts`, `evals/review-synthesis.eval.ts`: consume the returned usage and report it.
4. `package.json`: add `openai` as a devDependency only if it is not already present; otherwise use `fetch`.

**Acceptance criteria**

- Given `OVERDECK_EVAL_MODEL=claude-sonnet-5-5`, when `npm run eval` runs review-synthesis, then the request carries no `temperature` and the eval completes without a 400.
- Given `OVERDECK_EVAL_MODEL=gpt-6-luna` and a key or CLIProxy, when flywheel-launch runs, then it calls OpenAI and reports tokens and cost.
- Given an unknown model id, then the harness throws naming the id, and no request is sent.

**Docs**

`evals/README.md`: supported providers, env vars (`OVERDECK_EVAL_MODEL`, `OVERDECK_EVAL_EFFORT`, `OVERDECK_EVAL_OPENAI_VIA`), expected cost per eval per model.

---

### Issue B: Model-placement eval suite: review recall, plan quality, summary faithfulness, feedback acceptance

**Problem**

Overdeck decides which model plays each role on vendor benchmarks run at `max` effort. Overdeck runs at `high`, where Sonnet 5.5's Artificial Analysis Intelligence score drops from 56 to 47. No Overdeck eval measures what the roles actually do: find review blockers, write xBRIEFs, summarize without inventing facts, or act on `pan tell` feedback. Luna's 77% hallucination rate and Sonnet 5.5's documented "treats mid-task user messages as prompt injection" behavior are both untested against Overdeck prompts.

**Design**

Add four evalite suites on the issue A harness. Pure scorer logic lives in `evals/lib/`, with offline unit tests. Fixtures come from real Overdeck history, scrubbed of secrets.

| Eval | Fixture | Scorer |
|---|---|---|
| E2 review recall | Diffs with one known blocker each | Blocker recall and precision; blockers found only by one model family |
| E3 plan quality | Closed issues plus their committed xBRIEF | Schema and quality-lint pass; difficulty agreement; file-scope overlap |
| E4 summary faithfulness | Transcripts with planted facts and decoys, covering fork summary, handoff, compaction and title | Recall; hallucinated facts (hard fail above 0 for handoff and compaction) |
| E5 feedback acceptance | Mid-task review feedback delivered as a user message | Acted-on vs refused or flagged as injection |

**Work items**

1. `evals/review-recall.eval.ts`, `evals/lib/review-recall-scorer.ts`, `evals/fixtures/review-recall/*`.
2. `evals/plan-quality.eval.ts`, `evals/lib/plan-quality-scorer.ts`. Reuse `src/lib/xbrief/quality-lint.ts` and the xBRIEF validator; don't copy them.
3. `evals/summary-faithfulness.eval.ts`, `evals/lib/faithfulness-scorer.ts`, `evals/fixtures/summaries/*`.
4. `evals/feedback-acceptance.eval.ts`, `evals/lib/feedback-scorer.ts`.
5. `tests/unit/evals/lib/*-scorer.test.ts`: one offline test file per scorer.

**Acceptance criteria**

- Each suite runs with `OVERDECK_EVAL_MODEL` set to any of `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-4-5`, `gpt-6-sol`, `gpt-6-luna`, and reports a numeric score plus tokens and cost.
- Scorer unit tests pass under `npx vitest run tests/unit/evals`.
- A results table for those five models is posted as a comment on this issue, at effort `high`.

**Docs**

`evals/README.md`: the table of what each suite proves, fixture provenance, and the placement decision each one gates.

---

### Issue C: Head-to-head model benchmarks after PAN-3917: variant launch and a report from close-out usage and the pipeline journal

**Problem**

- PAN-3054's variant mechanism (per-issue record overrides) no longer exists after PAN-3917.
- `/benchmark` makes one QuantumLlama issue per scenario, and comparing runs means reading cost records by hand.
- The skill's examples name Opus 4.6 and Sonnet 4.6.

Confirming Sonnet 5.5, Sol or Luna placements needs N ≥ 3 serial runs per arm, compared on cost per merge-ready PR, review rounds and wall-clock.

**Design**

- `pan benchmark launch --template <name> --variant model=<id>,harness=<h>[,effort=<e>] ... [--replay <issue>] --runs N`:
  - Creates one `benchmark`-labelled issue per variant and run, sharing a `benchmark-group:<slug>` label.
  - Starts them one at a time through `pan start <id> --model --harness --effort`. These are explicit per-spawn overrides; nothing persists beyond the spawn.
  - `--replay` copies a closed issue's committed xBRIEF into the benchmark issue's plan.
- `pan benchmark report <group>` derives everything and stores nothing:
  - Cost and tokens from close-out usage.
  - Wall-clock from `.overdeck/pipeline.jsonl`.
  - Review rounds, approval and CI from the PR.
  - Output is one row per variant with median and spread.
- Benchmark branches are never merged; that is already the skill rule.

**Work items**

1. `src/cli/commands/benchmark.ts` (new) and its registration in the CLI command index.
2. `src/lib/benchmark/report.ts` (new, pure aggregation) and `src/lib/benchmark/__tests__/report.test.ts`.
3. `sync-sources/skills/benchmark/SKILL.md`: use the new verbs, update the examples to current models, and document replay.
4. `benchmarks/templates/`: add a replay template that links the original issue.
5. Comment on PAN-3054 that this supersedes its record-override mechanism.

**Acceptance criteria**

- Given two variants with `--runs 3`, launch creates six labelled issues and starts them serially. The next start waits until the previous one is merge-ready or failed.
- `report` prints cost, tokens, wall-clock, review rounds and first-pass approval per variant, computed only from close-out usage, the pipeline journal and the PR.
- No per-issue model state is written anywhere.

**Docs**

`sync-sources/skills/benchmark/SKILL.md`, and a "Benchmarking models" section in `docs/PIPELINE-GATES.md` or `configuration/*.mdx`.

---

### Issue D: GPT-6 catalog alignment: `gpt-6-sol` is classed frontier, and the OpenAI `tierModels` remap still points at GPT-5.6

**Problem**

- `MODEL_CAPABILITY_CLASSES['gpt-6-sol'] = 'frontier'`, yet:
  - its own catalog row calls it the "GPT-6 mid tier";
  - it costs $2/$10, the same as Sonnet 5.5 (`workhorse`);
  - its Artificial Analysis Intelligence Index is 48, below Sonnet 5.5's 56.
- `tier-fitness.ts` therefore warns "frontier-class model … would cost less" when Sol staffs `simple-medium`, which is where it belongs.
- `providers.ts` openai `tierModels` is `{ opus: 'gpt-5.6-sol', sonnet: 'gpt-5.6-terra', haiku: 'gpt-5.6-luna' }`, so proxied GPT sessions remap subagents to the previous generation.

**Design**

- Reclassify `gpt-6-sol` to `workhorse`. Keep `gpt-6-astra` `frontier` and `gpt-6-luna` `small`.
- Set openai `tierModels` `sonnet` → `gpt-6-sol` and `haiku` → `gpt-6-luna`. Gate this on issue D2, so the remap never targets a model the host's client version can't reach. Until D2 lands, keep 5.6 on hosts that fail the check, and report that through `pan doctor` rather than a silent substitute.
- **`opus` needs an explicit decision, not a default.** After Sol's reclassification, `gpt-6-astra` is the only GPT-6 frontier model, but it costs $10/$50 against `gpt-5.6-sol`'s $4/$20 on OpenAI's current page. That is the price every opus-pinned subagent in a proxied session would pay. Options: keep `gpt-5.6-sol` (cheaper, frontier-classed, older), move to Astra (2.5× price, Artificial Analysis Coding Agent 62), or use `gpt-6-sol` and accept a workhorse-class opus slot. Decide from the E2 and E6 numbers.
- Do not add `MODEL_DEPRECATIONS` hops from GPT-5.6 to GPT-6. OpenAI has not retired 5.6, and a hop would silently change what an operator's config launches.

**Work items**

1. `src/lib/model-capability-class.ts`: move `gpt-6-sol` to the workhorse block.
2. `src/lib/providers.ts`: openai `tierModels`.
3. `src/lib/agents/__tests__/tier-fitness.test.ts`: Sol in a simple/medium tier raises no over-provisioned warning; Sol alone on `expert` warns under-provisioned.
4. `src/dashboard/frontend/src/components/Settings/sections/tiered-crews.ts`: no code change expected (it reads `capabilityClassOf`). Verify with the existing `TieredExecutionSection.test.tsx`.

**Acceptance criteria**

- `capabilityClassOf('gpt-6-sol') === 'workhorse'`.
- A tier table with `simple-medium: gpt-6-sol` produces no fitness warning.
- A proxied GPT session's haiku-slot subagent launches `gpt-6-luna` on a host that passes D2.

**Docs**

`docs/MODEL_ROUTING.md` "Capability classes" is historical, so put the class table note in `docs/CONFIGURATION.md` or `configuration/harnesses.mdx`. Add a line to `docs/MODEL-CONTEXT-AUDIT.md`.

---

### Issue D2: GPT-6 Sol and Luna fail with 400 on ChatGPT login below Codex 0.155, and Overdeck's version floor is 0.153.4

**Problem**

- OpenAI's backend rejects `gpt-6-sol` and `gpt-6-luna` for ChatGPT-account clients whose reported version is below 0.155.x. The error is "The 'gpt-6-luna' model is not supported when using Codex with a ChatGPT account"; `gpt-6-astra` still works on the same account. Sources: openai/codex#47784, clodex#267, pi-openai-toolkit#8/#9, litellm-mysubs#2.
- Overdeck's `MINIMUM_NATIVE_ENDPOINT_CODEX_VERSION` is `0.153.4` (`src/lib/codex/app-server-manager.ts:22`).
- Whether CLIProxy (7.3.16 on the reference install) sends a new-enough version header is unverified.
- A host can pass every Overdeck check and still 400 on its first Sol or Luna launch.

**Design**

- Add a per-model minimum client version for the codex route: `gpt-6-sol` and `gpt-6-luna` need ≥ 0.156.1, the first catalog-bearing release.
- Check it where the harness policy decides launchability (`canUseHarness` in `src/lib/harness-policy.ts`), and in `pan doctor`.
- A failing check refuses the launch with a named error that includes the upgrade command (`pan install`). It never substitutes another model.
- For the CLIProxy route, verify the header empirically with one `gpt-6-luna` request through the local CLIProxy endpoint. If it fails, pin or upgrade CLIProxy through `pan install`, and record the minimum CLIProxy version beside the Codex one.

**Work items**

1. `src/lib/codex/app-server-manager.ts`: a per-model minimum-version table beside `MINIMUM_NATIVE_ENDPOINT_CODEX_VERSION`.
2. `src/lib/harness-policy.ts`: consult it for the codex harness.
3. `src/cli/commands/doctor.ts` plus a new `src/cli/commands/doctor-codex-models.ts` (same pattern as `doctor-ollama.ts` and `doctor-herdr.ts`): a WARN or FAIL row per enabled GPT-6 model.
4. The CLIProxy install and version pin used by `pan install`: bump it if the empirical check fails.
5. Tests: harness-policy unit test for 0.153.4 (refused) and 0.158.0 (allowed).

**Acceptance criteria**

- On a host with codex 0.153.4, `pan start <id> --model gpt-6-luna --harness codex` exits non-zero naming the required version and `pan install`, and no agent row is written.
- `pan doctor` shows the same finding.
- On 0.158.0 the launch proceeds.

**Docs**

`configuration/harnesses.mdx` (codex section), with the minimum versions.

---

### Issue E: Stale product defaults: `workhorses.expensive` is Opus 4.8, and the flywheel role default is a literal that ignores the slot

**Problem**

- `DEFAULT_WORKHORSES.expensive = 'claude-opus-4-8'` in `src/lib/config-yaml/roles.ts`.
- `DEFAULT_ROLES.flywheel.model` and `DEFAULT_MODEL_REFS.flywheel` are the literal `'claude-opus-4-8'`, not `workhorse:expensive`, so re-pointing the slot never moves the flywheel.
- New installs therefore plan, review and run the flywheel on a model two releases old.
- Opus 5.5 is $4/$20 against Opus 4.8's $5/$25. Opus 4.8's price comes from the repo catalog note and was not web-verified in this pass. Opus 5.5 scores higher on every published benchmark checked.

**Design**

- Point `DEFAULT_ROLES.flywheel.model` and `DEFAULT_MODEL_REFS.flywheel` at `workhorse:expensive`.
- Move `DEFAULT_WORKHORSES.expensive` to `claude-opus-5-5` **only after** `flywheel-launch.eval.ts` and `review-synthesis.eval.ts` (on the issue A harness) score Opus 5.5 at or above Opus 4.8. Post the results on the issue before merging.
- Installed configs are untouched: an explicit `roles.flywheel.model` still wins.

**Work items**

1. `src/lib/config-yaml/roles.ts`: flywheel ref, then the `expensive` slot.
2. `src/lib/__tests__/config-yaml-roles.test.ts`: defaults resolve through the slot; re-pointing `expensive` moves the flywheel.
3. `src/lib/__tests__/settings-api.test.ts`: fixture expectations.

**Acceptance criteria**

- With no config, `resolveModel('flywheel')` equals `resolveModel('plan')`.
- Both equal `claude-opus-5-5` after the gate.
- The eval results table is linked in the PR.

**Docs**

`docs/CONFIGURATION.md` defaults table; `CHANGELOG` entry.

---

### Issue F: Small-model defaults: plan the Haiku 4.5 successor, and give `workhorse:cheap` a consumer or drop it

**Problem**

Haiku 4.5's page guarantees availability through at least 2026-10-15. That is Anthropic's standard one-year floor, and no retirement is announced. Anthropic says Haiku 5.5 is coming "in the coming weeks", and `gpt-6-luna` costs a tenth of Haiku 4.5's price. Overdeck defaults to Haiku 4.5 in four places:

- `DEFAULT_WORKHORSES.cheap`, which no role or tier references, so it routes nothing (the frontend copy is at `RolesPanel.tsx:79`)
- `conversations.compactionModel`
- `conversations.titleModel`
- the memory `classifier.model` (`src/lib/config-yaml/defaults.ts`)

Two small-model defaults are already on deprecated or ancient ids: `ttsSummarizer.model: 'gpt-5.4-mini'`, which hops to `gpt-5.6-luna`, and `registry.classification.model: 'gpt-4.1-nano'`.

**Design**

- Pick the successor per slot from E4 results, comparing Haiku 5.5 (once Anthropic releases it), `gpt-6-luna`, and Sonnet 5.5 for compaction.
- Anthropic-only slots, which run through claude-code without CLIProxy, stay Anthropic unless the operator has enabled OpenAI.
- Change defaults only after E4. Add a `MODEL_DEPRECATIONS` hop only when Anthropic actually announces the retirement date.
- No slot gets a hardcoded fallback. An unavailable model fails loudly, as `handoff_author_model` does today.
- `workhorse:cheap`: either point the background-AI small-model defaults (`titleModel`, the memory `classifier.model`, `ttsSummarizer.model`) at `workhorse:cheap` so one slot moves them all, or delete the slot. Do not leave a slot that looks configurable but routes nothing. The configured value is written back as a ref, never a literal (the PAN-4191 pattern). `compactionModel` stays separate because it needs faithfulness, not just speed.

**Work items**

1. `src/lib/config-yaml/defaults.ts`: new defaults per slot, after E4.
2. `src/lib/config-yaml/roles.ts` (`DEFAULT_WORKHORSES.cheap`), `src/lib/config-yaml/defaults.ts` (refs for the background-AI defaults), and `src/dashboard/frontend/src/components/Settings/RolesPanel.tsx:79` (remove the literal copy).
3. `src/lib/model-deprecations.ts`: a hop only on retirement.
4. Default-snapshot tests: `src/lib/__tests__/config-yaml*.test.ts`.

**Acceptance criteria**

- E4 results for Haiku 4.5, the Haiku successor and `gpt-6-luna` are posted.
- Each changed default cites the E4 row that justifies it.
- No default references a model id the provider has retired.

**Docs**

`docs/CONFIGURATION.md` conversations and background-AI defaults.

---

### Issue G: Replace inherited capability scores for Sonnet 5.5, GPT-6 Sol and GPT-6 Luna with measured ones

**Problem**

`src/lib/model-capability-additions.ts` gives Sonnet 5.5 the Sonnet 5 skill scores, and Sol and Luna the GPT-5.6 scores ("inherit … until benchmarked"). The smart selector and tier-fitness hints can't tell a better model from its predecessor.

The published numbers disagree with the inherited ones:

- Sonnet 5.5's Artificial Analysis Intelligence Index is 56 at max and 47 at high, and it ranks #2 on the Vals Index (69.22%). None of that is reflected in the inherited scores. Its announcement's Sonnet 5 Terminal-Bench figure (10.3%) is anomalous, so don't use it.
- Sol's Artificial Analysis Coding Agent Index is only +2 over GPT-5.6 Sol.

`MODEL_CAPABILITIES` header says "Last updated: 2026-06-30".

**Design**

- Score from two sources, each cited in a row comment with its URL and the date checked:
  - Overdeck's own evals (B, and the E6 medians);
  - published benchmarks: the Sonnet 5.5 system card, Artificial Analysis, Vals.
- Where a source is secondary, for example Vellum's summary of OpenAI's numbers, mark it unverified.
- This feeds PAN-1852's capability-floor design; it does not implement it.

**Work items**

1. `src/lib/model-capability-additions.ts`: the three rows, with notes updated.
2. `src/lib/model-capabilities.ts`: refresh the header date and sources.
3. `docs/MODEL-CONTEXT-AUDIT.md`: sources list.

**Acceptance criteria**

- Each of the three rows has a skill score that differs from its predecessor wherever the evidence shows a difference, and a note that cites the source.
- `npx vitest run src/lib/__tests__/model-capabilities*.test.ts` passes.

**Docs**

`docs/MODEL-CONTEXT-AUDIT.md`.

---

### Issue H: Verify Sonnet 5.5 against model switches, forks and compaction (model-locked thinking blocks, append-only history)

**Problem**

Anthropic's Sonnet 5.5 migration guide says three things that matter here:

- Thinking blocks are model-locked. Sonnet 5.5 cannot read Opus 5, Opus 5.5 or Fable blocks, and no other model can read its blocks.
- Blocks only work in the account that produced them.
- Replaying edited history returns 400 for accounts created on or after 2026-08-31.

Several Overdeck paths carry history across models or rewrite it: dashboard switch-model, fork and handoff, rich compaction, and codex/claude resume. None has been exercised against Sonnet 5.5.

**Design**

- A live, operator-run checklist; no speculative code change.
- Switch a conversation Opus 5.5 → Sonnet 5.5 and Sonnet 5.5 → Opus 5.5.
- Fork an Opus 5.5 conversation onto Sonnet 5.5.
- Hand off from a Fable 5.1 conversation to a Sonnet 5.5 author.
- Compact a Sonnet 5.5 session and resume it.
- Record any 400 with its request id. Fix only the paths that fail, by stripping or omitting foreign thinking blocks at the launch door; never by falling back to another model.

**Work items**

1. Checklist results posted on the issue.
2. For each failing path, a fix in its owning module, with a regression test (`src/dashboard/server/routes/` switch-model handlers covered by `agents-switch-model.test.ts` / `conversations-switch-model.test.ts`, `src/lib/conversations/summary-fork.ts`, the compaction module).

**Acceptance criteria**

- All five scenarios complete without an API 400, or each failure has a linked fix with a test.

**Docs**

`docs/DASHBOARD-ARCHITECTURE.md` or `configuration/harnesses.mdx`: a note on cross-model history.

---

## 6. Install config changes (not issues; apply after the named gate)

These are recommendations for an install's own config, derived from the reference install. They are not product-default changes, and each waits for its gate.

**Coupling.** An install that staffs `workhorses.mid` with Opus 5.5 and points review or strike at `workhorse:mid` must, in the same edit that moves `mid` to Sonnet 5.5, move `roles.review.model`, `roles.review.sub.security.model` and `roles.strike.model` to `workhorse:expensive`. Otherwise the review parent, the security lane and strike silently drop to Sonnet.

| Key | Proposed | Gate |
|---|---|---|
| `tiered_execution.tiers.simple-medium.model` | `claude-sonnet-5-5` (where still `claude-sonnet-5`) | E6 smoke |
| `roles.test.model` | `workhorse:mid` once mid is Sonnet 5.5 | E6 smoke |
| `conversations.handoff_author_model` | `claude-sonnet-5-5` (where still `claude-sonnet-5`) | E4 |
| `workhorses.mid` | `claude-sonnet-5-5` (where it is Opus 5.5). **Must land in the same edit as the next three rows** | E6 medium and complex arms plus E2 |
| `roles.review.model` | `workhorse:expensive` (keeps the review parent on Opus 5.5) | Same edit as `mid` |
| `roles.review.sub.security.model` | `workhorse:expensive` | Same edit as `mid` |
| `roles.review.sub.{correctness,performance,requirements}.model` | `workhorse:mid`, making them Sonnet 5.5 | E2 within 5 points of Opus 5.5; until then leave them on `parent` |
| `roles.strike.model` | `workhorse:expensive` (strike skips review and lands on main) | Same edit as `mid` |
| `workhorses.cheap` | `gpt-6-luna` (hygiene only; nothing consumes the slot) | D2 check on that install |
| `tiered_execution.supervisor.model` | `claude-opus-5-5` (cheaper and newer than Opus 5) | E2 |
| `tiered_execution.tiers.simple-medium.distribution` | Sonnet 5.5 70% / `gpt-6-sol` via codex 30% | E6 Sol arm plus PAN-2817 closed |
| `models.default_conversation_model` | `claude-fable-5-1`, or `claude-opus-5-5` if cost matters | Operator preference |
| `tiered_execution.tiers.trivial` | No change needed while swarm is off (0 plans have a trivial max difficulty) | Revisit if swarm is turned on |

---

## Sources (checked 2026-09-28)

**Anthropic**

- https://platform.claude.com/docs/en/models/sonnet-5-5/overview
- https://platform.claude.com/docs/en/models/sonnet-5-5/whats-new-sonnet-5-5
- https://platform.claude.com/docs/en/models/sonnet-5-5/migration-guide
- https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-sonnet-5-5
- https://platform.claude.com/docs/en/about-claude/pricing
- https://platform.claude.com/docs/en/models/overview
- https://platform.claude.com/docs/en/models/opus-5-5/overview
- https://platform.claude.com/docs/en/models/fable-5-1/overview
- https://platform.claude.com/docs/en/models/sonnet-5/overview
- https://platform.claude.com/docs/en/models/haiku-4-5/overview
- https://platform.claude.com/docs/en/build-with-claude/fast-mode
- https://www.anthropic.com/claude-sonnet-5-5
- https://www.anthropic.com/claude-opus-5-5
- https://www.anthropic.com/news/claude-haiku-4-5
- The Sonnet 5.5 system card PDF (www-cdn.anthropic.com; read via `pdftotext`, sections 8.1 and 8.5)

**OpenAI**

- https://developers.openai.com/api/docs/models/gpt-6-sol
- https://developers.openai.com/api/docs/models/gpt-6-luna
- https://developers.openai.com/api/docs/models/gpt-6-astra
- https://developers.openai.com/api/docs/models/gpt-5.6-sol
- https://developers.openai.com/api/docs/models/gpt-5.5
- https://developers.openai.com/api/docs/pricing
- https://developers.openai.com/api/docs/guides/latest-model
- https://learn.chatgpt.com/docs/models
- https://learn.chatgpt.com/docs/changelog
- https://community.openai.com/t/announcing-gpt-6-sol-and-gpt-6-luna-in-the-api-codex-and-chatgpt/1399925
- https://github.com/openai/codex/pull/47401
- https://github.com/openai/codex/issues/47784
- https://github.com/openai/codex/issues/49052

**The 400 fixes in third-party clients**

- https://github.com/bman654/clodex/pull/267
- https://github.com/awoaCrim/pi-openai-toolkit/issues/8
- https://github.com/eduardopessin/litellm-mysubs/issues/2
- https://github.com/router-for-me/CLIProxyAPI/releases

**Independent evals**

- https://artificialanalysis.ai/articles/claude-sonnet-5-5
- https://artificialanalysis.ai/articles/gpt-6-sol-and-luna-push-the-cost-efficiency-frontier
- https://artificialanalysis.ai/articles/benchmarking-gpt-6-astra
- https://artificialanalysis.ai/models/comparisons/claude-opus-5-5-medium-vs-gpt-6-sol
- https://www.vals.ai/models/anthropic_claude-sonnet-5-5
- https://arena.ai/leaderboard
- https://www.vellum.ai/blog/gpt-6-sol-and-luna-benchmarks-explained (secondary; UNVERIFIED against OpenAI)

**Could not load or verify**

- openai.com announcement and pricing pages (403), so OpenAI's own benchmark tables are unread.
- tbench.ai leaderboard: the table is rendered client-side.
- swebench.com: truncated.
- Scale's SWE-bench Pro board: stale.
- UNVERIFIED items:
  - SWE-bench Verified, GPQA, tau-bench and ARC-AGI for all three models.
  - Sol's maximum input tokens.
  - Astra's release date.
  - Artificial Analysis's Sonnet 5.5 low and medium scores.
  - Whether CLIProxy 7.3.16 sends a new-enough Codex version header.

Terminal-Bench 4.0 differs by harness: 70.6 (Anthropic), 64 (Artificial Analysis), 53.03 (Vals). Compare only within one source.
