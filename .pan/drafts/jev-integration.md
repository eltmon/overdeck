# Jev (TypeSafe AI) for Overdeck: findings and implementation plan

Date: 2026-09-29. Status: PRD. The operator approved setting up Jev and implementing the items below where it helps most (2026-09-29); item 1b is not filed and needs operator sign-off after phase-1 accuracy data. Research included one live API call set (3 requests plus a models listing) against the OpenCode Zen free Jev endpoint with the vendor's sample text. No Overdeck data was sent.

---

## Verdict

**What Jev is.** Jev (`jev-1.13`) is the first "System One" model from TypeSafe AI (typesafe.ai; the name is "TypeSafe", not the old Scala company Typesafe/Lightbend). It does not generate text. You send a `state` (text or JSON, up to 32k tokens) plus a map of typed questions. It returns typed answers with calibrated probabilities:

- `noul`: the probability that a yes/no statement is true.
- `choice`: one option from up to 255, with a probability per option and a confidence.
- `score`: a position on a rubric of 2 to 10 levels.

It costs $0.042 per million input tokens, and output is free. Latency is sub-second: 0.34 to 0.49 s end to end from this machine via the OpenCode Zen proxy (not measured against TypeSafe directly). It is a judgment function for code. It is not a harness model, and TypeSafe's docs say plainly that it cannot power a coding agent.

**Where it helps Overdeck most (ranked):**

0. **Foundation (required by everything else):** an optional, off-by-default Jev client in `src/lib/jev/`. Config comes from `config.yaml`, the key from Settings → API Keys or the environment, and cost recording goes through `background-ai`. All questions and thresholds live in one constants file, with an evalite fixture set. It has no value on its own, but items 1 to 3 need it.
1. **Turn-end reason classifier.** When an agent ends its turn, Jev decides what the final message is: a question to the operator, a report that the work is done, a blocker, or a partial-progress update. Overdeck cannot make this distinction today. `agent-enrichment.ts` says a prose question is "invisible to every other detector". Work agents are deliberately excluded from `agentTurnEnded` because their idle "can mean between-items or complete". The deacon then nudges them blindly. Phase 1 only adds labels to Needs-you and to the stall sweeper's `idle-running` rows. It never acts. **Highest value, medium effort.**
2. **Advisory semantic check of xBRIEF acceptance criteria at `pan plan finalize`.** Today `ac-not-observable` is a substring test against a list of 49 terms (`OBSERVABLE_TERMS`, which includes `'when '`, `'then '`, `'passes'`). Jev can judge whether each AC names observable behavior and whether it packs several behaviors into one. The output is warnings only. The synchronous `assertPlanQuality` gate is unchanged. **Good value, low effort.**
3. **Relevance filter for prompt-time memory injection.** This is the textbook Jev use case: a BM25 shortlist, then one Noul per candidate. But it is **blocked**, because prompt-time memory injection currently returns nothing (see the bug below). **Fix memory first.**

**New finding worth its own issue (not a Jev problem).** Prompt-time memory injection is effectively dead:

- Since 2026-09-14 there were 5,950 `user-prompt` RAG decisions.
- Query expansion failed with `extraction-failed` in 100% of them.
- Only 8 of them injected any observation, summary or sibling memory.
- There were zero `background:memoryExtraction` cost events in the last 14 days.

**Setup can start today without a new account.** OpenCode Zen serves Jev at `https://opencode.ai/zen/v1/systemone`, and an existing OpenCode Zen API key works. `jev-1.13-free` answered correctly in the smoke test. A direct TypeSafe account (console.typesafe.ai) is optional, and creating one needs the operator.

---

## 1. The earlier investigation

**Where it was.** An earlier exploratory Overdeck conversation (2026-09-17) reviewed the TypeSafe docs and looked for use cases in Overdeck. It is summarized here; the transcript is not part of this PRD.

**What it concluded (2026-09-17).** It recommended piloting Jev for "frequent, narrowly defined judgments", starting with **issue triage and spec readiness**, then **task-difficulty assessment**. It ran nothing against the API. Its five ranked ideas, and what has happened to each target since:

| # | 09-17 idea | Target code then | Status on origin/main now |
| - | - | - | - |
| 1 | Issue triage / spec readiness | `src/lib/overdeck/issue-reads.ts`: substring "ambiguity" heuristic (any `" or "`, description > 500 chars) | **Target removed.** PAN-3859 (#3876, commit 18dbf0f5227) "delete the dead triage surface, legacy complexity chain". Spec readiness now lives in `src/lib/xbrief/quality-lint.ts`, which becomes **item 2**. |
| 2 | Difficulty assessment before model selection | `src/lib/cloister/complexity.ts` keyword detection; `dispatch-tier.ts` | **Target shrunk.** `complexity.ts` now only parses `difficulty:` labels. The planner sets `metadata.difficulty` with full context, and tiered execution is on. **Deferred** (see "Not now"). |
| 3 | Memory capture filter + retrieval rerank | `memory/extract.ts`, `memory/search.ts` | Code is still there, but the pipeline yields almost no memories. This becomes **item 3, gated on the memory bug**. |
| 4 | Feature ownership / duplicate detection | `registry/feature-registry-population.ts` | Unchanged. It is still generative (`gpt-5.4-mini` via cliproxy) because it must *name* features, which Jev cannot do. **Deferred.** |
| 5 | Stall diagnosis, advisory only | `src/lib/cloister/stuck-remediation.ts` | **File deleted** in PAN-3917 W4 (commit 94255f055fe). Its successors are the stall sweeper (observability-only by operator directive), deacon-lite `checkStuckWorkAgents` and `agentTurnEnded`. This becomes **item 1**. |

The earlier conversation also got the right cautions: confidence is not accuracy on Overdeck tasks; pin the model version; run in shadow mode first; keep permissions, tests and merge authority in code. Its pricing check was correct: $42 per billion tokens equals $0.042 per million. A side fix in that conversation (keep line numbers out of file-link targets) opened PR #3880. That PR was closed unmerged, but the same wording is on main in `sync-sources/rules/file-path-references.md`.

---

## 2. Current public facts (checked 2026-09-28/29)

| Fact | Value | Source | Verified? |
| - | - | - | - |
| Company | TypeSafe AI, typesafe.ai. Came out of stealth 2026-09-15 with a $40M seed led by DCVC | [Launch blog](https://typesafe.ai/blog/introducing-system-one-models-and-jev); [Business Wire via Morningstar](https://www.morningstar.com/news/business-wire/20260915525333/typesafe-ai-emerges-from-stealth-with-40m-in-funding-with-new-model-for-composable-ai); [AIwire](https://www.hpcwire.com/aiwire/2026/09/16/typesafe-ai-emerges-from-stealth-with-40m-in-funding-with-new-model-for-composable-ai/) | Yes (official blog + press release) |
| Founder | **Diogo Almeida** (ex-OpenAI, RLHF/ChatGPT research). Co-founders Erik Gafni and Sasha Sheng are named by secondary sources | Blog byline; [Dealroom](https://dealroom.co/news/151032-typesafe-exits-stealth-with-40m-seed-to-build-ai-for-software-not-people/) | Founder: yes (blog). One search summary says "Diego", which is wrong. Co-founders: secondary sources only |
| Model | `jev-1.13.0`; aliases `jev-latest` and `jev-preview` (both → 1.13.0; no preview build yet) | [docs/models](https://docs.typesafe.ai/models) | Yes |
| Price | $0.042/Mtok input ($42/Btok); output free | docs/models; blog | Yes (published). The blog admits it "can't prove it isn't subsidized" |
| Limits | 250k tok/s, 1,200 req/min. The docs say the limits "are adjusting dynamically" and "can change without notice" | docs/models | Yes |
| Context | 64k per request; 32k for state plus the longest question. Text only | docs/models | Yes |
| API | `POST https://api.typesafe.ai/v1/systemone`, Bearer key; `GET /v1/models`; errors 401/422/429/529 | [docs/api](https://docs.typesafe.ai/api) | Yes |
| JS SDK | `@typesafe-ai/sdk` 0.6.0 (2026-09-15). MIT, **zero dependencies**, Node ≥ 20, ESM+CJS+types. Defaults: 10 s timeout, 2 retries on 408/429/5xx, honors `retry-after`. Env: `TYPESAFE_API_KEY`, `TYPESAFE_BASE_URL`, `TYPESAFE_DEFAULT_MODEL` (else `jev-latest`) | `npm view`; [SDK changelog](https://docs.typesafe.ai/sdk/javascript/changelog); [client.ts v0.6.0](https://github.com/typesafe-ai/typesafe-sdk-js/blob/v0.6.0/src/client.ts) | Yes |
| Python SDK | `typesafe-sdk` 0.7.2 (2026-09-26): pydantic, `response_model`, HTTP/2 extra, AI-gateway examples | [Py changelog](https://docs.typesafe.ai/sdk/python/changelog) | Yes |
| Agent skill | `typesafe-ai/skills` (MIT, ~2.4k stars). Claude Code: `claude plugin marketplace add typesafe-ai/skills` then `claude plugin install typesafe@typesafe-ai` | [docs/agent-skill](https://docs.typesafe.ai/agent-skill) | Yes |
| Data | Not trained on customer data; retention per the privacy policy; ZDR for enterprise only; service based on the US West Coast | [docs/legal](https://docs.typesafe.ai/legal), blog | Yes (policy text not reviewed in depth) |
| Known weak spots | Literal reading, counting and math, date comparison, indirection, **large irrelevant state (context rot)**, **adversarial content in state**, contradictory criteria, Noul vs Choice not interchangeable, no generation | [Jev 1.13 jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13) (reviewed 2026-09-17) | Yes (vendor-stated) |
| OpenCode Zen | Serves `jev-1.13` ($0.042/M) and `jev-1.13-free` (limited time) at `https://opencode.ai/zen/v1/systemone` with an OpenCode Zen key; Zen privacy note: Jev inputs are not used for training | [opencode zen.mdx](https://github.com/anomalyco/opencode/blob/dev/packages/web/src/content/docs/zen.mdx), [opencode.ai/docs/zen](https://opencode.ai/docs/zen/) | Yes, and live-tested (below) |
| Speed and quality claims | 70–500 ms; "40–200x faster", "193x faster / 445x cheaper"; "frontier intelligence on System One tasks" | Blog; [Tom's Hardware](https://www.tomshardware.com/tech-industry/artificial-intelligence/typesafe-ais-jev-offers-an-alternative-to-llms-that-claims-to-be-193x-faster-and-445x-cheaper-system-one-type-model-is-bespoke-for-probabilistic-decision-making) | Latency: consistent with our test. Multipliers and quality: **vendor claims, unverified** |
| Funding talks | Reportedly raising > $1B at > $10B | [remio.ai](https://www.remio.ai/post/typesafe-ai-funding-talks-test-whether-jev-can-justify-a-10-billion-valuation) | **Unconfirmed** |
| Console pricing / free credits / card requirement | Not published; `typesafe.ai/pricing` returns 404 | n/a | **Unverified.** Operator will see it at sign-up |

**Live smoke test (2026-09-29, this machine).** Zen route, `jev-1.13-free`, the docs' sample Stripe ticket, one Noul and one 3-way Choice:

- HTTP 200 on all 3 requests, in 0.49 s, 0.34 s and 0.40 s including TLS.
- Noul 0.98. Choice `technical`, with confidence varying 0.75 / 0.66 / 0.77 across identical requests.
- 371 input tokens (cost $0.0000156 at the paid rate). `GET /zen/v1/models` lists `jev-1.13-free` and `jev-1.13`.
- The response `model` field echoes `jev-1.13-free`, not a versioned ID.

Implication: answers are **not bit-deterministic run to run**, so thresholds need margin and tests must stub the client.

**What changed since the 09-17 investigation.** The API surface and model are unchanged. The 09-17 conversation read the same `jev-1.13` docs, and the JS SDK 0.6.0 predates it. What is new is the ecosystem:

- Launch press coverage and third-party explainers (MarkTechPost 09-19, LangChain, TrueFoundry, flaviocopes, a Wikipedia page).
- The **OpenCode Zen route with a free tier**.
- Python SDK 0.7.x (pydantic `response_model`, HTTP/2).
- `system-one-adapter-python`, an "LLM-backed drop-in TypeSafeClient replacement" (Python only).
- `n8n-nodes-typesafe-ai` (pushed 09-28).
- The unconfirmed $10B raise talk.

"More info is out" is mostly market validation plus a no-signup access path, not new capability.

---

## 3. How Overdeck should integrate it (constraints that shape every item)

- **Optional, off by default.** No `jev` config means no call, no error and no startup check. Every consumer has a non-Jev path that is today's behavior. Low-cost mode (`background_ai.cheap_mode`) disables it too, because it goes through `isBackgroundFeatureEnabled`.
- **No hardcoded model.** `jev.model` comes from config, like `memory.extraction.model` and `registry.classification.model`. If it is unset, the feature reports "disabled: jev.model not configured" and does not fall back to `jev-latest`. That means always passing `model` explicitly, because the SDK would otherwise default to `jev-latest`. Zen ids are `jev-1.13` / `jev-1.13-free`, not the alias. Pin the versioned id once thresholds are tuned.
- **No execSync / no blocking.** The client is `fetch`-based (the SDK uses global `fetch`). Calls are async with an `AbortSignal` and a short timeout (config `jev.timeout_ms`; override the SDK's 10 s default and 2 retries). Hot paths never wait on Jev. They read a memo and schedule a background assessment.
- **Stores no status it can derive.** A Jev verdict is derived from a transcript message or an AC text. It is memoized in process by `(input hash, questionSetVersion, model)` with an LRU, and never written to agent rows, `sessions.json`, the journal or the tracker. An optional append-only eval log (the pattern of the `memory/rag-runs` decision log) is for threshold tuning only, and nothing reads it back as authority.
- **Stall sweeper directive holds.** Jev output may enrich the evidence text of a sweep recommendation. It may never trigger a spawn, stop, nudge or kill.
- **Third-party data.** Transcript tails and AC text go to TypeSafe, or to Zen and then TypeSafe. There is precedent: Anthropic, OpenAI, cliproxy and Zen already receive transcripts. The operator should still know. Jev's weakness to adversarial state matters most for text that the public can write into `eltmon/overdeck` issues. Item 2 treats Jev output as advice for exactly that reason.
- **Cost accounting.** Record through `recordBackgroundAiCost` with `provider: 'custom'`, which follows the `muse-spark-1.3` precedent. Add `DEFAULT_PRICING` rows in `src/lib/cost.ts`: `jev-1.13` at 0.000042/1k in and 0 out, and an **exact** `jev-1.13-free` row at 0/0. The exact row is required: `getPricing` tries exact matches first and then falls back to a prefix match, so without it `jev-1.13-free` would price as paid. Row order does not matter.

**Expected spend.**

- Turn-end classification sends about 1.5–3k tokens per assessment. At 2,000 assessments a day that is roughly $0.13–0.25/day at the paid rate, or $0 on `-free`.
- AC checks cost well under $0.001 per plan.
- Rate limits (1,200 rpm) are far above Overdeck's needs.

---

## 4. Ranked plan

| Rank | Item | Value | Effort | Risk | Depends on |
| - | - | - | - | - | - |
| 0 | Optional Jev client, config, cost, eval fixtures | Enabler | S–M (2–3 days) | Low | none |
| 1 | Turn-end reason classifier (Needs-you + sweeper annotation), observability only | **High**: fixes a documented blind spot hit every day (prose questions, silent work-agent stops) | M (3–4 days) | Low (labels only) | 0 |
| 1b | Phase 2: let the classification shape `checkStuckWorkAgents` (suppress the nudge when the agent asked the operator; tailor the nudge text) | Medium–High | S | **Medium**: it changes an action. Needs operator sign-off after phase-1 accuracy data | 1 + measured accuracy |
| 2 | Advisory semantic AC check at `pan plan finalize` | Medium: better plans, less keyword gaming | S (1–2 days) | Low (warnings only) | 0 |
| 3 | Memory relevance filter for prompt-time injection | Medium–High **once memory works** | S–M | Low | 0 + memory bug fixed |
| n/a | **Memory injection returns nothing** (separate bug, no Jev) | High | Unknown | n/a | none |

### Not now (one line each)

- **Difficulty second opinion:** the planner assigns `metadata.difficulty` with the whole codebase in context. Jev seeing only item text would be the weaker judge, and wrong routing is already handled by escalation (`retries_at_tier`, `max_promotions`).
- **Feature-registry classification:** the job is naming new features, which Jev cannot generate. Matching against existing features is possible later as a pre-step.
- **Guardrails on inbound issue/PR text:** the jaggedness page lists adversarial content as a weak spot. Revisit after a later Jev version.
- **Skill suggestion (PAN-3942 per-skill toggles):** TypeSafe has a cookbook for it, but the harnesses already route skills natively. Low marginal value.
- **Awareness feed / TTS "is this worth announcing":** plausible Score use. PAN-4301 is reshaping that feed first.

---

## 5. Setup on this machine

| Step | Who | Notes |
| - | - | - |
| A. Zen route, no new account (recommended to start) | **Operator** (a secret goes into Overdeck config) | Use an OpenCode Zen API key; Overdeck does not read OpenCode's own credential store. Put the Zen key in the **same** `api_keys.typesafe` slot (Settings → API Keys, added by item 0); that slot is the one canonical place for whichever Jev key is in use. Config: `jev.base_url: https://opencode.ai/zen`, `jev.model: jev-1.13-free`. (Fallback only if you prefer env: export the key and name it with `jev.api_key_ref`.) `jev-1.13-free` is limited-time. Switching to `jev-1.13` bills the Zen balance (which auto-reloads $20 below $5, per the Zen docs). |
| B. Direct TypeSafe account (optional, for production) | **Operator**: sign-up, possibly payment. Free credits are unverified | https://console.typesafe.ai/keys → `api_keys.typesafe` (Settings → API Keys); `jev.base_url` unset (defaults to `https://api.typesafe.ai`); `jev.model: jev-1.13.0` (pinned). Enterprise ZDR requires sales@typesafe.ai. |
| C. SDK dependency | Implementing agent (item 0 PR) | `bun add @typesafe-ai/sdk@0.6.0` in the root package (MIT, zero deps). Pin the exact version: 0.6.0 had a breaking `Score.criteria` change one patch after the first release. |
| D. TypeSafe agent skill for the agents writing the integration (optional) | **Operator** (changes their Claude Code plugin config) | `claude plugin marketplace add typesafe-ai/skills` then `claude plugin install typesafe@typesafe-ai`. This is not required, because the issue bodies below carry the API facts. Do **not** vendor it into `sync-sources/skills/`: it is a third-party skill, and Overdeck agents only need it while item 0 is being built. |
| E. Enable features | Operator (Settings toggles) | `background_ai.features.jevTurnEndAssessment: true`, and so on, after item 0 lands. Everything defaults to off. |

Nothing requires a payment to start (route A with `-free`). The only operator actions are: choose the route, place the key, and optionally sign up at TypeSafe and install the plugin.

---

## 6. Ready-to-file issue bodies

### Issue 0: Optional Jev (TypeSafe System One) judgment client

**Problem.** Several Overdeck decisions are fuzzy judgments made with keyword lists or not made at all. Examples: whether an agent's last message is a question, and whether an acceptance criterion is observable. Jev (TypeSafe AI, `jev-1.13`) returns typed, calibrated answers in under 0.5 s at $0.042/Mtok input. Overdeck has no client, config, cost accounting or eval harness for it. Research: `.pan/drafts/jev-integration.md`.

**Design.**
- New module `src/lib/jev/`:
  - `client.ts`: a thin wrapper over `@typesafe-ai/sdk` `TypeSafeClient`, constructed from config.
  - `config.ts`: resolves config and reports why the client is unavailable.
  - `questions.ts`: the single file holding every question text, criteria, threshold and `QUESTION_SET_VERSION`.
  - `memo.ts`: an in-process LRU keyed by `(sha256(state), questionSetVersion, model)`, plus an in-flight dedupe map and a concurrency cap (4). This mirrors the pane-detection limiter in `src/lib/agent-input-detection.ts`.
- `assess(featureKey, state, questions, { signal })` behavior:
  - Returns `{ status: 'answered', answers, model, usage }` or `{ status: 'unavailable' | 'failed', reason }`.
  - Never throws into callers.
  - Checks `isBackgroundFeatureEnabled(featureKey)` first.
  - Records cost via `recordBackgroundAiCost({ feature, provider: 'custom', model, usage })`.
- Config (`src/lib/config-yaml/schema.ts`, `defaults.ts`, `load.ts`): a `jev:` block with `base_url?`, `model?`, `api_key_ref?` and `timeout_ms` (default 2000). Key resolution order: (1) `api_keys.typesafe`, the canonical slot, set from Settings → API Keys and used for both the direct TypeSafe key and an OpenCode Zen key; (2) fallback: the env var named by `jev.api_key_ref` (default `TYPESAFE_API_KEY`).
  - No block, or no `model`, means unavailable with a reason.
  - No model is written in code.
  - Add `typesafe?: string` to `apiKeys` in `schema.ts`, with a `TYPESAFE_API_KEY` env fallback in `applyEnvironmentFallbacks` (the same pattern as `voyage`).
  - The key is never logged: set the SDK `logLevel` to `warn`; the SDK redacts auth headers but not bodies, so never use `debug`.
- Background-ai registry (`src/lib/background-ai/registry.ts`): add `jevTurnEndAssessment`, `jevAcceptanceCriteriaReview` and `jevMemoryRelevance`, all `defaultEnabled: false`, and add them to the Settings UI list (`src/dashboard/frontend/src/components/Settings/settingsPageConstants.ts`, `types.ts`).
- Pricing (`src/lib/cost.ts` `DEFAULT_PRICING`): `{provider:'custom', model:'jev-1.13', inputPer1k:0.000042, outputPer1k:0}` plus an exact `{provider:'custom', model:'jev-1.13-free', inputPer1k:0, outputPer1k:0}` row. The exact row is required, because `getPricing`'s prefix fallback would otherwise price `-free` as paid.
- Evals: an `evals/jev-*.eval.ts` harness using `evals/lib/`, plus a fixture dir of labeled inputs. It runs only when `TYPESAFE_API_KEY` or the configured ref is present, and skips otherwise.

**Work items.**
1. Add the `@typesafe-ai/sdk@0.6.0` dependency (exact pin).
2. Create `src/lib/jev/{client,config,questions,memo}.ts` with tests in `src/lib/jev/__tests__/`, injecting a fake `fetch` through the SDK `fetch` option.
3. Add config schema, defaults and env fallbacks: `src/lib/config-yaml/{schema,defaults,load}.ts`.
4. Add the background-ai features and Settings UI toggles.
5. Add the pricing rows in `src/lib/cost.ts`.
6. Add the eval harness skeleton `evals/jev-smoke.eval.ts`.

**Acceptance criteria.**
- Given no `jev` config, when `assess()` is called, then it returns `unavailable` with reason `not-configured` and makes no network call (test: the fake fetch is never invoked).
- Given `jev.model` unset but a key present, `assess()` returns `unavailable` with reason `model-not-configured` (test).
- Given `background_ai.cheap_mode: true`, `assess()` returns `unavailable` with reason `disabled` (test).
- Given a 401 / 429 / timeout from the fake fetch, `assess()` resolves to `failed` with a reason and never rejects (tests for each).
- Given the same state and question set twice, only one request is sent (memo test), and concurrent identical calls share one in-flight request.
- A successful call appends one cost event with source `background:jevTurnEndAssessment` and cost 0 for `jev-1.13-free` (test on `getPricing` ordering).
- `npm run typecheck`, `npm run lint` and `npm run lint:effect-facades` pass (no Effect façade around the Promise client).

**Docs.** New `configuration/jev.mdx`: what Jev is, the Zen route vs the direct TypeSafe route, config keys, privacy note, cost. Add a row for it to the CLAUDE.md topic index.

---

### Issue 1: Classify why an agent ended its turn (Needs-you + stall sweeper), observability only

**Problem.** When an agent ends its turn, Overdeck cannot tell a question from a report.
- `src/lib/agent-enrichment.ts` marks every idle interactive agent `agentTurnEnded` ("Answer the agent"). The comment there says a prose question "carries no tool call and no modal, and is therefore invisible to every other detector". The frontend's `isBareTurnEnd` (`src/dashboard/frontend/src/lib/simple/derive.ts`) has to assume "it did not ask anything".
- Work, review and test agents are excluded, because their idle "can mean between-items or complete; flagging those would flood the surface".
- So a work agent that stops to ask a question, or stops blocked, is found only when the stall sweeper's `idle-running` orbit fires (`src/lib/parked/resolver.ts`). That orbit says "poke for progress". Or deacon-lite's `checkStuckWorkAgents` sends a generic hourly nudge if it has unpushed commits.

**Design.**
- A new `src/lib/jev/turn-end.ts` with `assessTurnEnd({ agentId, role, harness, lastAssistantText, messageId })`.
  - State: `{ role, last_message }`. Take the last assistant message only, tail-trimmed to about 6k chars, because Jev loses accuracy on large, irrelevant state.
  - Questions (in `questions.ts`):
    - Choice `turn_end_kind` with options `asks_operator`, `reports_complete`, `reports_blocked`, `progress_update`, `other`. Each option gets a one-sentence criterion.
    - Noul `needs_operator_answer`: "Does the end of `last_message` ask the operator a question or request a decision that must be answered before work continues?"
- Consumers read a memo and schedule an assessment. They never wait on Jev.
  - **Interactive agents:** `AgentEnrichment` gains an optional derived `turnEndAssessment?: { kind, confidence, needsAnswer, model }`. Leave it unset below `TURN_END_MIN_CONFIDENCE` (in `questions.ts`) or when Jev is unavailable. The Needs-you row shows "Asked you a question" / "Reported done" / "Blocked" in place of the bare "Answer the agent". `isBareTurnEnd` treats `kind !== 'asks_operator'` with high confidence as bare. Unknown stays exactly as today.
  - **Work/review/test agents:** no new pending-input kind. `resolveParkedPopulation`'s `idle-running` rows carry the assessment in `evidence` ("last message reads as: blocked (0.84)"). The stall sweeper's activity sentence includes it. The sweeper still takes no action.
- Transcript access: use the last-assistant-message reader behind `src/lib/agents/transcript-resolver.ts`. Phase 1 covers claude-code JSONL and codex rollouts. Other harnesses report `unassessed` (see the harness-boundary lesson: check every `transcriptKind` site).
- No persistence. The verdict is memoized by message id plus content hash and is recomputed after a restart.

**Work items.**
1. `src/lib/jev/turn-end.ts` and the question set in `src/lib/jev/questions.ts`.
2. A last-assistant-message extractor (reuse existing JSONL / rollout parsing; do not add a new parser) in `src/lib/agents/`.
3. `src/lib/agent-enrichment.ts`: attach `turnEndAssessment` for interactive roles. `src/dashboard/server/services/agent-enrichment-service.ts`: schedule assessments off the poll path.
4. `src/lib/parked/resolver.ts` and `src/lib/cloister/stall-sweeper.ts`: add the assessment to `idle-running` evidence and the activity sentence.
5. Frontend: `src/dashboard/frontend/src/lib/pendingInput.ts` labels, `lib/simple/derive.ts` `isBareTurnEnd`, `lib/useDecisions.ts`.
6. Fixtures: 40 or more real, labeled final messages from local transcripts (question / done / blocked / progress), plus `evals/jev-turn-end.eval.ts` reporting per-class precision and recall at the chosen threshold.

**Acceptance criteria.**
- With Jev unavailable, enrichment output and the Needs-you UI are byte-identical to today (snapshot test on `agent-enrichment`).
- Given a stubbed assessment `{kind:'asks_operator', confidence:0.9}` for an idle `conv-*` agent, the Needs-you row renders "Asked you a question" (frontend test). Given `reports_complete` at 0.9, `isBareTurnEnd` returns true (derive test).
- Given an assessment below `TURN_END_MIN_CONFIDENCE`, no label is shown and behavior matches today (test).
- Given an `idle-running` row for a work agent with a stubbed `reports_blocked` assessment, the sweep recommendation's evidence contains "blocked", and the sweeper performs no spawn, stop, message or kill. Existing sweeper no-action tests still pass, plus a new assertion.
- The enrichment poll never awaits a Jev call. A test with a never-resolving fake client shows the poll completing within its normal budget.
- The eval reports at least 0.9 precision for `asks_operator` on the fixture set before the feature is described as ready in docs (measured, recorded in the PR).

**Docs.** `docs/PIPELINE-GATES.md` (stall sweeper and deacon-lite sections): the assessment exists, it is advisory, and it never acts. `configuration/jev.mdx`: the `jevTurnEndAssessment` toggle.

---

### Issue 1b (phase 2, file after issue 1 has data): Let the turn-end assessment shape deacon-lite's stuck-work nudge

**Problem.** `checkStuckWorkAgents` (`src/lib/cloister/deacon-lite.ts`) sends the same nudge every hour to any idle work agent with unpushed commits. If the agent asked the operator a question, the nudge talks over it. If it reported "done" without `pan done`, the generic text does not say what is missing.

**Design.** Only when `jevTurnEndAssessment` is enabled and the assessment clears a separate, higher `NUDGE_GATE_MIN_CONFIDENCE`:
- `asks_operator` suppresses the nudge and leaves the agent to Needs-you.
- `reports_complete` sends the existing message with an added line about running `pan done`.
- Every other case keeps today's behavior.

It never adds a nudge that would not be sent today.

**Work items.** `src/lib/cloister/deacon-lite.ts` (read the memo only, no new call path); `src/lib/cloister/__tests__/deacon-lite*.test.ts`.

**Acceptance criteria.**
- With the feature off, the nudges sent are identical to today (test).
- An `asks_operator` assessment above threshold means no message is delivered, and an activity entry records the suppression (test).
- There is no case where a nudge is sent that the current code would not send (property-style test over the assessment kinds).

**Docs.** `docs/PIPELINE-GATES.md` deacon-lite routine 1. **Needs operator sign-off**: it changes an acting routine.

---

### Issue 2: Advisory semantic review of xBRIEF acceptance criteria at `pan plan finalize`

**Problem.** `lintItem` in `src/lib/xbrief/quality-lint.ts` flags `ac-not-observable` when an AC title contains none of the 49 substrings in `OBSERVABLE_TERMS`. That list includes `'when '`, `'then '`, `'passes'` and `'contains'`, so "Given the page loads then it works" passes, while "The CLI exit code is 2 on a missing file" fails. Planners learn to add magic words instead of writing testable criteria.

**Design.**
- A new `src/lib/jev/acceptance-criteria.ts` with `reviewAcceptanceCriteria(doc)`. It sends one request per plan (fan-out). The state is the list of `{ id, title }` for every AC of non-cancelled items.
- Per AC, two Nouls:
  - `observable_<id>`: "Does `criteria[<id>]` describe a behavior a test or a person can observe, such as an output, stored state, UI change, exit code or emitted event?"
  - `compound_<id>`: "Does `criteria[<id>]` describe more than one independent behavior?"
- It returns `QualityIssue`s with severity `warn` only: `ac-semantic-not-observable` and `ac-semantic-compound`, with thresholds in `questions.ts`.
- Call it from `src/cli/commands/plan-finalize.ts` after `evaluatePlanFinalizeQualityGate`, and print the warnings in the finalize report. `assertPlanQuality`, `lintPlanQuality` and `src/lib/overdeck/planning-promotion.ts` stay synchronous and unchanged. The existing keyword rule stays the gate.
- Shadow data: when enabled, append `{ acId, keywordVerdict, jevNoul }` to a local eval log for comparing the two rules. Nothing reads it back as authority.

**Work items.**
1. `src/lib/jev/acceptance-criteria.ts` plus tests.
2. `src/cli/commands/plan-finalize.ts` integration plus tests.
3. `evals/jev-acceptance-criteria.eval.ts` with 60 or more labeled ACs taken from `.pan/specs/*.xbrief.json`.

**Acceptance criteria.**
- With Jev unavailable, `pan plan finalize` output and exit code are unchanged (test).
- Given a stubbed Noul of 0.1 for `observable_ac1`, the finalize report contains `[warn] ac-semantic-not-observable` for that AC and the exit code is still 0 (test).
- `assertPlanQuality` throws exactly as before for a plan with a keyword-rule error, whatever Jev says (test).
- One HTTP request is made per finalize, however many ACs there are (fake-fetch call count test).

**Docs.** `docs/XBRIEF.md` quality-lint section: the advisory semantic check, its rules and that it never blocks.

---

### Issue 3 (bug, no Jev): Prompt-time memory injection almost never injects a memory

**Problem.** Local RAG decision logs (`<overdeck home>/memory/<project>/<workspace>/rag-runs/*.jsonl`, measured 2026-09-29 on the operator's host) show:
- 5,950 `surface: user-prompt` decisions since 2026-09-14.
- Query expansion status `fallback` with reason `extraction-failed` in 100% of them.
- Only 8 decisions with any observation, summary or sibling hit. The rest inject only the knowledge index.
- The cost ledger (`<overdeck home>/costs/events.jsonl`) has **zero** `background:memoryExtraction` or `background:memoryQueryExpansion` events in the last 14 days, while `memory.extraction` is configured as `provider: anthropic`, `model: claude-haiku-4-5`, and both features are enabled.

Either extraction is not running, or it is running without recording cost, and expansion always fails within its 750 ms budget.

**Design.** Diagnose before changing anything:
- Check whether the configured provider can authenticate on this host. Unverified hypothesis: an API-key provider on a subscription-only host.
- Check whether the 750 ms `PROMPT_TIME_EXPANSION_TIMEOUT_MS` in `src/lib/memory/injection.ts` is always lost.
- Check whether observations exist in the FTS index at all.

**Work items.**
1. Trace `expandMemoryQuery` failures (`src/lib/memory/query-expansion.ts`, `providers/`).
2. Check extraction health (`src/lib/memory/health.ts`, `pipeline.ts`, `poller.ts`).
3. Surface the failure reason in `pan doctor` or memory health instead of a silent `extraction-failed`.

**Acceptance criteria.**
- The root cause is named in the PR.
- After the fix, a fresh session on a project with observations shows `hitCounts.observations > 0` on a matching prompt (manual check plus a unit test of the fixed path).
- A provider auth failure is reported by memory health with its reason (test).

**Docs.** `configuration/memory-governor.mdx` or the memory doc: the failure reasons and how to read `rag-runs`.

---

### Issue 4 (after issue 3): Jev relevance filter for prompt-time memory candidates

**Problem.** `searchMemory` (`src/lib/memory/search.ts`) ranks an FTS shortlist (3x overfetch) by BM25, recency and tag boosts. `injectPromptTimeMemory` (`src/lib/memory/injection.ts`) then fills budgets of up to 5,000 observation tokens per prompt. Lexical matches that do not help the current prompt still use up the budget. TypeSafe's own rerank cookbook (BM25 shortlist, one question per pair) reports top-10 accuracy going from 38% to 62% on a legal benchmark. That is a vendor number and must be re-measured here.

**Design.**
- After search and before budget selection, one Jev request per prompt.
- State: `{ prompt (trimmed), candidates: [{id, text}] }`, with at most about 20 candidates each trimmed to 600 chars, to stay well under the 32k state limit.
- One Noul per candidate: "Would `candidates[i]` help answer or act on `prompt`?"
- Drop candidates below `MEMORY_RELEVANCE_MIN` and order the rest by noul.
- Hard timeout 400 ms on the `user-prompt` surface. On timeout, fall back to today's ranking.
- Log the Jev scores in the existing rag-decision entry (`sources[].score` stays BM25; add `relevance`) so the effect is measurable from the logs already written.

**Work items.** `src/lib/jev/memory-relevance.ts`; `src/lib/memory/injection.ts` (new optional dep `rerank`, same injection style as `expansion` / `search`); a `@overdeck/contracts` `RagDecision` source field; tests; `evals/jev-memory-relevance.eval.ts`.

**Acceptance criteria.**
- With Jev unavailable or timed out, the selected candidates are identical to today (test with a never-resolving fake).
- Given stubbed nouls, candidates below threshold are excluded and the rest are ordered by noul (test).
- The rag-decision log entry carries `relevance` per source when Jev answered (test).
- On a 30-prompt eval set, the injected observation tokens that the labeled set marks relevant go up, and the total injected tokens do not (eval result recorded in the PR).

**Docs.** The memory configuration doc: the relevance filter, its toggle `jevMemoryRelevance`, and its fallback.
