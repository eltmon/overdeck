# Overdeck Evals

Run the eval suite with:

```bash
npm run eval
```

Evalite runs every `*.eval.ts` file under `evals/` and stores local run data under `node_modules/.evalite/`. These evals are not part of the blocking CI gate yet because future cases may call models and introduce cost or nondeterminism.

## Prompt-regression protection

The flywheel soul-degradation incident showed that prompt files are load-bearing safety surfaces with zero mechanical protection. This directory now houses regression coverage for `roles/*.md` and `sync-sources/skills/pan-flywheel/SKILL.md`.

### Deterministic rail tests

[`tests/unit/evals/prompt-rails.test.ts`](../tests/unit/evals/prompt-rails.test.ts) asserts that load-bearing rail text still exists in the prompt files. It runs in the default `npm test` path and requires no model calls. Covered rails include:

- Flywheel author/assignee gate, `vetoed` absolutism, saturation cap, and `auto_pickup_backlog` switch.
- The auto-pickable predicate and the canonical review synthesis blocker format.

### Live-model golden-scenario evals

Evals that call a model live under `npm run eval`. They read the model from `OVERDECK_EVAL_MODEL` and fail loudly if it is unset.

| Eval | File | What it proves |
| --- | --- | --- |
| Flywheel launch-vs-report | [`flywheel-launch.eval.ts`](./flywheel-launch.eval.ts) | Given a fixture board, the flywheel role emits launch actions for eligible issues and respects the author/assignee gate, veto, and `blocks-main` emergency override. |
| Review synthesis blocker format | [`review-synthesis.eval.ts`](./review-synthesis.eval.ts) | Given fixture convoy reviewer reports, the review role produces the canonical synthesis blocker format and a changes-requested verdict. |
| Jev smoke | [jev-smoke.eval.ts](./jev-smoke.eval.ts) | Given 8 labeled messages, Jev's question-detection Noul agrees with the label. Skipped unless config.yaml has jev.model and a TypeSafe/Zen key. |
| Jev turn-end | [jev-turn-end.eval.ts](./jev-turn-end.eval.ts) | Given the 40-row `evals/fixtures/jev-turn-end.json` set, Jev's `turn_end_kind` Choice (confidence-gated at `TURN_END_MIN_CONFIDENCE`) agrees with the label; prints `perClassMetrics` as a table after the run. Skipped unless config.yaml has jev.model and a TypeSafe/Zen key. |

Jev evals take the model from `jev.model` in config.yaml, never from a literal, and are skipped (with the reason printed) when Jev is not configured.

#### Jev turn-end: measured per-class precision (PAN-4371 WI-12 checkpoint)

Measured with `jev.model = jev-1.13-free`, 2026-09-29 (`cd evals && npx evalite run jev-turn-end.eval.ts`). Overall scorer score: **60% (24/40)**.

| Class | Precision | Recall | Support |
| --- | --- | --- | --- |
| `asks_operator` | 0.7778 | 0.875 | 8 |
| `reports_complete` | 0.8 | 0.8 | 10 |
| `reports_blocked` | 0.6667 | 0.6667 | 9 |
| `progress_update` | 0.75 | 0.3 | 10 |
| `other` | null | 0 | 3 |

The WI-12 gate is `asks_operator` precision ≥ 0.9. **Not met** (measured 0.78 on this 40-row fixture and this free-tier model). Per the checkpoint's fallback, the feature is documented as advisory with accuracy under measurement, and the D-1 thresholds (`TURN_END_MIN_CONFIDENCE = 0.7`, `TURN_END_NEEDS_ANSWER_THRESHOLD = 0.5`) are unchanged — thresholds were not tuned against this fixture set.

### Shared harness

[`evals/lib/prompt-harness.ts`](./lib/prompt-harness.ts) exports helpers used by the live-model evals:

- `loadPromptFile(relPath)` — reads a prompt file resolved from the repo root.
- `runPromptScenario(opts)` — resolves the model named by `OVERDECK_EVAL_MODEL` through the model catalog, dispatches to Anthropic (streamed Messages API) or OpenAI (Responses API), and returns `{ text, run }`. Rejects before any network call if the variable is unset, the model is unknown or deprecated, or the provider is unsupported.
- `extractJsonArray(text)` — leniently extracts the first top-level JSON array from a model response, including through ` ```json ` fences.
- [`evals/lib/eval-model.ts`](./lib/eval-model.ts) — `resolveEvalModelConfig(env, opts)`, the pure resolver that turns `OVERDECK_EVAL_MODEL`/`OVERDECK_EVAL_EFFORT`/`OVERDECK_EVAL_OPENAI_VIA` into a complete, provider-neutral request config.
- [`evals/lib/eval-usage.ts`](./lib/eval-usage.ts) — normalizes Anthropic and OpenAI usage objects into a shared `EvalUsage` shape and prices them via `src/lib/cost.ts`.
- [`evals/lib/openai-responses.ts`](./lib/openai-responses.ts) — the OpenAI Responses API call, routed to the direct API or the local CLIProxy sidecar.

There is no hardcoded model fallback. Set the eval model explicitly:

```bash
OVERDECK_EVAL_MODEL=claude-haiku-4-5-20251001 npm run eval
```

### Supported providers and models

The harness supports Anthropic and OpenAI models only. The model id in `OVERDECK_EVAL_MODEL` must have a row in `MODEL_CAPABILITIES` (`src/lib/model-capabilities.ts`, `src/lib/model-capability-additions.ts`); a dated snapshot suffix such as `claude-haiku-4-5-20251001` is accepted when its undated base (`claude-haiku-4-5`) has a row. A deprecated id (`src/lib/model-deprecations.ts`) rejects, naming its replacement. An unknown id rejects before any request is sent.

### Environment variables

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `OVERDECK_EVAL_MODEL` | Yes | none | No hardcoded fallback; the harness rejects if unset or blank. |
| `OVERDECK_EVAL_EFFORT` | No | `high` (`DEFAULT_EFFORT`) | Must be one of `EFFORT_LEVELS` and, when the model enumerates `effortLevels`, one of that model's allowed levels. Must stay unset for a model with no `effortLevels` (e.g. Haiku 4.5) — setting it there rejects. |
| `OVERDECK_EVAL_OPENAI_VIA` | No | `api` | `api` calls `https://api.openai.com` with `OPENAI_API_KEY`; `cliproxy` calls the local CLIProxy sidecar instead. Any other value rejects. |
| `OPENAI_API_KEY` | Only for OpenAI models on route `api` | none | Required before any OpenAI request on the default route. |
| `ANTHROPIC_API_KEY` | Only for Anthropic models | none | Resolved by the Anthropic SDK's own credential lookup. |

The harness always sends effort explicitly, because Opus 5.5's API default effort is `medium` — one level below Overdeck's `high` launch effort. Without an explicit value, a live run would not be evaluating Opus 5.5 at the effort Overdeck actually launches it at.

### Request shape per model

- An effort-capable Anthropic model (its catalog row has a non-empty `effortLevels`) gets `thinking: { type: 'adaptive' }` and `output_config: { effort }`. A model with no `effortLevels` gets neither field.
- `temperature: 0` is sent only when the model is not getting adaptive thinking **and** its catalog row does not set `supportsSamplingParams: false`. Models that reject sampling parameters (Sonnet 5.5, Opus 5, Opus 5.5, Fable) never receive `temperature`, and neither does any model once adaptive thinking is on (the API rejects non-default temperature alongside thinking).
- `max_tokens` (Anthropic) / `max_output_tokens` (OpenAI) is the catalog row's `maxOutputTokens`, or `EVAL_DEFAULT_MAX_OUTPUT_TOKENS` (16,000) when the row has none, capped by the caller's `opts.maxTokens` when given.
- The Anthropic call always streams (`client.messages.stream(params).finalMessage()`) — the installed SDK requires streaming once `max_tokens` is large enough to make a non-streaming call risk exceeding the 10-minute request timeout.
- The OpenAI call is `POST <base>/v1/responses` with `instructions` (the system prompt), one `input` message, `max_output_tokens`, `reasoning: { effort }` when effort is not null, and no `temperature`.

### Run info and cost

Every `runPromptScenario` call returns `{ text, run }`. `run` carries: `model`, `provider`, `effort`, `thinking`, `temperature`, `maxTokens`, `openaiVia`, `usage` (`inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `reasoningTokens`), `costUsd`, `costBasis`, `stopReason`, and `durationMs`. Both live evals (`flywheel-launch.eval.ts`, `review-synthesis.eval.ts`) put `run` into their Evalite task output, so every stored result shows the model, provider, effort, tokens, and cost.

`costBasis` is `'api-equivalent'` when the call went through CLIProxy on a subscription (the number shows what the same tokens would have cost on the API) and `'api'` otherwise. `costUsd` is `null` when `src/lib/cost.ts` has no pricing row for the model.

### Expected cost per eval run

Estimates below assume the flywheel system prompt (≈16 KB ≈ 4K tokens per call × 4 calls) and the review system prompt (≈13 KB ≈ 3.3K tokens × 1 call), an 8K output-token ceiling per call at `high` effort, and `DEFAULT_PRICING` rates from `src/lib/cost.ts`:

| Model | flywheel-launch (4 calls) | review-synthesis (1 call) |
| --- | --- | --- |
| `claude-opus-5-5` | ≤ $0.72 | ≤ $0.18 |
| `claude-sonnet-5-5` | ≤ $0.36 | ≤ $0.09 |
| `gpt-6-sol` | ≤ $0.36 | ≤ $0.09 |
| `claude-haiku-4-5` | ≤ $0.18 | ≤ $0.05 |
| `gpt-6-luna` | ≤ $0.02 | < $0.01 |

Measured values from the first live runs are listed below; replace the estimates when a model is measured.

- `gpt-6-luna` (via `cliproxy`, effort `high`, 2026-09-29): `flywheel launch-vs-report decision` — 2 calls, 9,486 input tokens (incl. cache reads), 413 output tokens, $0.000464. `flywheel order-book drain completion` — 2 calls, 8,871 input tokens (incl. cache reads), 1,346 output tokens, $0.000869. `review synthesis canonical blocker format` — 1 call, 3,317 input tokens (incl. cache reads), 1,019 output tokens, $0.000588. All 5 calls total: 21,674 input tokens, 2,778 output tokens, $0.0019, cost basis `api-equivalent` (billed against a CLIProxy ChatGPT subscription, not the API).
- `claude-sonnet-5-5`: pending operator run — `OVERDECK_EVAL_MODEL=claude-sonnet-5-5 npm run eval` (needs an `ANTHROPIC_API_KEY` credential not present in the reference agent environment).

### Known limits

- `gpt-6-sol` is not served by the local CLIProxy sidecar (`{"error":{"message":"unknown provider for model gpt-6-sol","code":"model_not_found"}}`); evaluate it with `OPENAI_API_KEY` on the default `api` route instead.
- `xhigh`/`max` effort on OpenAI models was verified only through CLIProxy, not against `api.openai.com` directly.

### CI prompt gate

A PR that diffs `roles/*.md` or `sync-sources/skills/pan-flywheel/SKILL.md` must include a `Prompt-Change:` trailer in at least one commit. The gate is enforced by [`scripts/check-prompt-change-trailer.sh`](../scripts/check-prompt-change-trailer.sh), which runs in CI via the `prompt-gate` job and is also wired into `npm run lint` as `lint:prompt-trailer`.

## Current Target

The first eval covers memory status rollup synthesis through `synthesizeStatusRollup`. It uses realistic observations, pending turns, and captured provider-shaped outputs to exercise the same structured-output boundary used by the LLM provider path, then scores the validated rollup for phase selection, working-set recall, stale working-set removal, blocker preservation, next-step preservation, and prompt replacement guidance.

The primary review synthesis role still requires a tmux agent session, so it was not chosen for this foundation pass. A later eval should either extract the review synthesis prompt/report logic into a callable function or add a live-agent eval harness deliberately.

## Adding A Case

Add or extend a `*.eval.ts` file with:

1. Fixed input evidence from realistic records, fixtures, or small synthetic cases that mirror production shape.
2. A task that calls the actual Overdeck behavior under evaluation.
3. Structural scorers first. Add an LLM-as-judge scorer only when the output is genuinely fuzzy.

Keep datasets small until baseline storage and CI policy exist. Do not commit API keys or captured secrets in eval fixtures.

## Caveats

Live model evals should read credentials from the existing Overdeck/provider environment; see "Expected cost per eval run" above before running one. CI wiring is intentionally deferred until the team decides which evals are cheap and stable enough to gate by default.
