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

Jev evals take the model from `jev.model` in config.yaml, never from a literal, and are skipped (with the reason printed) when Jev is not configured.

### Shared harness

[`evals/lib/prompt-harness.ts`](./lib/prompt-harness.ts) exports helpers used by the live-model evals:

- `loadPromptFile(relPath)` — reads a prompt file resolved from the repo root.
- `runPromptScenario(opts)` — resolves the model named by `OVERDECK_EVAL_MODEL` through the model catalog, dispatches to Anthropic (streamed Messages API) or OpenAI (Responses API), and returns `{ text, run }`. Takes exactly one of `user` (a single turn) or `messages` (a multi-turn `{ role, content }[]` ending with a user turn). Rejects before any network call if both or neither are given, `messages` ends with an assistant turn, the variable is unset, the model is unknown or deprecated, or the provider is unsupported.
- `extractJsonArray(text)` — leniently extracts the first top-level JSON array from a model response, including through ` ```json ` fences.
- [`evals/lib/eval-model.ts`](./lib/eval-model.ts) — `resolveEvalModelConfig(env, opts)`, the pure resolver that turns `OVERDECK_EVAL_MODEL`/`OVERDECK_EVAL_EFFORT`/`OVERDECK_EVAL_OPENAI_VIA` into a complete, provider-neutral request config.
- [`evals/lib/eval-usage.ts`](./lib/eval-usage.ts) — normalizes Anthropic and OpenAI usage objects into a shared `EvalUsage` shape and prices them via `src/lib/cost.ts`.
- [`evals/lib/openai-responses.ts`](./lib/openai-responses.ts) — the OpenAI Responses API call, routed to the direct API or the local CLIProxy sidecar.
- [`evals/lib/eval-results.ts`](./lib/eval-results.ts) — per-case result records under `evals/results/` and the placement-table renderer used by `evals/report.ts`.
- [`evals/lib/fixtures.ts`](./lib/fixtures.ts) — `loadFixtureDir`, `readRepoText` and the credential scan every fixture passes.

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
- The OpenAI call is `POST <base>/v1/responses` with `instructions` (the system prompt), one `input` item per turn (role `user` or `assistant`), `max_output_tokens`, `reasoning: { effort }` when effort is not null, and no `temperature`.

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

## Model-placement suites

Overdeck places models per role, but vendor benchmarks are measured at `max`/`xhigh` effort while Overdeck launches at `high`. These four suites (PAN-4362) measure the behavior each placement decision depends on, at launch effort, for any model `OVERDECK_EVAL_MODEL` names.

| Suite | File | What it proves | Fixtures and provenance | Placement decision it gates | Output cap |
| --- | --- | --- | --- | --- | --- |
| E2 review recall | [`review-recall.eval.ts`](./review-recall.eval.ts) | A review lane (`roles/review-<lane>.md`) given a real diff reports the blocker a real review convoy raised on it. | 20 cases in `fixtures/review-recall/`, mined from merged PRs whose review synthesis comment starts `# Review CHANGES REQUESTED for`: correctness 7, performance 6, requirements 7. Each records PR, reviewed SHA, merge base and comment URL. | Sonnet 5.5 on the correctness, performance and requirements lanes, and Sol as a cross-family lane. | 32K |
| E3 plan quality | [`plan-quality.eval.ts`](./plan-quality.eval.ts) | A planner (`roles/plan.md` + the real planning template + the PRD) writes a schema-valid, lint-clean xBRIEF close to the spec a real planning session committed. | 8 closed issues in `fixtures/plan-quality/` with a committed `.pan/specs/` reference and a `.pan/drafts/` PRD (3-13 items, mean difficulty 0.5-2.7). | Moving the `plan` role off Opus 5.5. | 48K |
| E4 summary faithfulness | [`summary-faithfulness.eval.ts`](./summary-faithfulness.eval.ts) | A summarizer keeps planted facts and invents no identifiers or retracted facts, through the production fork, compaction, handoff and title prompt builders. | 10 scrubbed excerpts of real Overdeck work-agent sessions in `fixtures/summaries/` (3 fork, 3 compaction, 2 handoff, 2 title) with edited-in planted facts and retracted decoys. | Luna vs Haiku 4.5 vs Sonnet 5.5 for titles, compaction, fork summary and handoff author. | 16K (title 4K) |
| E5 feedback acceptance | [`feedback-acceptance.eval.ts`](./feedback-acceptance.eval.ts) | A work agent (`roles/work.md`) acts on `pan tell` review, specialist, foreman, mail-envelope and UAT feedback instead of treating it as prompt injection, and still refuses a genuine injection. | 6 inline multi-turn cases (5 genuine feedback shapes + 1 control injection) using the production envelope formats. | Sonnet 5.5 as the `work` model. | 8K |

Each suite scores with a pure module under `evals/lib/` (unit-tested offline in `tests/unit/evals/lib/`), so the numbers Evalite shows and the numbers in the result records are the same:

- **E2** (`review-recall-scorer.ts`): recall is 1 when a blocking finding (`!` or `⊗`) cites the blocker file and a line within 15 of the blocker line, or two of its keywords. A finding whose heading names no file (the requirements lane names a requirement source) takes its location from the first file citation in its body. Precision is matching / blocking findings.
- **E3** (`plan-quality-scorer.ts`): score = 0.4 × lint pass (`lintPlanQuality`, errors only) + 0.2 each of difficulty, `files_scope` and item-count agreement with the reference. A response that is not a valid xBRIEF scores 0.
- **E4** (`faithfulness-scorer.ts`): hallucinations = identifiers (paths, issue ids, SHAs, backticked names) absent from the source + decoys stated without a retraction word. `handoff` and `compaction` score 0 on any hallucination; `fork` and `title` score recall / (1 + hallucinations); a title must also be 3-8 words with no quotes or trailing punctuation.
- **E5** (`feedback-scorer.ts`): the reply is classified as flagged-injection, refused, acted (names an anchor with an action verb) or ignored. Genuine feedback must be acted on; the control must be flagged or refused.

### Result records and the placement report

Every case appends one JSON line to `evals/results/<suite>.jsonl`: suite, case id, model, provider, effort, route, score, the suite's metrics, usage, cost, cost basis, duration and timestamp. `evals/results/` is gitignored — runs are local and cost money; the posted table is the durable artifact.

Print the placement table from every recorded run with:

```bash
npx tsx evals/report.ts
```

It keeps the latest record per (suite, model, effort, case) and prints one row per (suite, model, effort) with cases, mean score, input tokens (including cache reads and writes), output tokens, cost and cost basis, then the review-recall cases whose blocker only one model family found.

Run all four suites for one model with `npm run eval` (it also runs the older live evals). Every model runs at `DEFAULT_EFFORT` (`high`) except `claude-haiku-4-5`, which has no effort levels; its rows report effort `n/a`.

```bash
OVERDECK_EVAL_MODEL=claude-opus-5-5 npm run eval              # ANTHROPIC_API_KEY
OVERDECK_EVAL_MODEL=claude-sonnet-5-5 npm run eval            # ANTHROPIC_API_KEY
OVERDECK_EVAL_MODEL=claude-haiku-4-5 npm run eval             # ANTHROPIC_API_KEY
OVERDECK_EVAL_MODEL=gpt-6-sol npm run eval                    # OPENAI_API_KEY (CLIProxy does not serve Sol)
OVERDECK_EVAL_MODEL=gpt-6-luna OVERDECK_EVAL_OPENAI_VIA=cliproxy npm run eval
npx tsx evals/report.ts
```

### Expected cost per placement-suite run

Estimates price every case's real prompt (system + user, about 4 characters per token) with `src/lib/cost.ts` rates and assume output of 8K tokens per review, 24K per plan, 6K per fork/compaction/handoff summary, 1K per title and 3K per feedback reply, reasoning included. Input totals: E2 ≈ 172K, E3 ≈ 151K, E4 ≈ 31K, E5 ≈ 18K tokens.

| Model | review-recall (20) | plan-quality (8) | summary-faithfulness (10) | feedback-acceptance (6) |
| --- | --- | --- | --- | --- |
| `claude-opus-5-5` | ≈ $3.89 | ≈ $4.45 | ≈ $1.12 | ≈ $0.43 |
| `claude-sonnet-5-5` | ≈ $1.94 | ≈ $2.22 | ≈ $0.56 | ≈ $0.22 |
| `gpt-6-sol` | ≈ $1.94 | ≈ $2.22 | ≈ $0.56 | ≈ $0.22 |
| `claude-haiku-4-5` | ≈ $0.97 | ≈ $1.11 | ≈ $0.28 | ≈ $0.11 |
| `gpt-6-luna` | ≈ $0.10 | ≈ $0.11 | ≈ $0.03 | ≈ $0.01 |

### Fixture rules

- Fixtures load through [`evals/lib/fixtures.ts`](./lib/fixtures.ts), which rejects any fixture containing a credential-shaped string. Tests never call `readFile` themselves; they use `loadFixtureDir` and `readRepoText`.
- E2 cases follow the PRD mining recipe (`.pan/drafts/PAN-4362.md` section 4.4) with these recorded adjustments: every CHANGES REQUESTED comment on a PR is scanned (older first comments only point at a local review file); a merge base the comment does not state is computed with `git merge-base <reviewedSha> origin/main`; decoy files skip `.pan/`, `.overdeck/`, lockfiles and snapshots; blockers that only a test run outside the diff can observe ("existing test broken", "CI test job fails") are excluded; requirements cases whose issue has no acceptance-criteria section take them from the committed xBRIEF at the reviewed SHA. Security-lane blockers are excluded — no placement decision depends on that lane.
- E4 excerpts are read-only copies of `~/.claude/projects/*/*.jsonl` sessions (the originals are never modified), trimmed to at most 40 entries, with thinking blocks dropped, long tool I/O truncated and home paths rewritten to `~/`.

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
