# Overdeck Evals

Run the eval suite with:

```bash
npm run eval
```

Evalite runs every `*.eval.ts` file under `evals/` and stores local run data under `node_modules/.evalite/`. These evals are not part of the blocking CI gate yet because future cases may call models and introduce cost or nondeterminism.

## Prompt-regression protection

The flywheel soul-degradation incident showed that prompt files are load-bearing safety surfaces with zero mechanical protection. This directory now houses regression coverage for `roles/*.md` and `docs/flywheel-brief.md`.

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

### Shared harness

[`evals/lib/prompt-harness.ts`](./lib/prompt-harness.ts) exports helpers used by the live-model evals:

- `loadPromptFile(relPath)` — reads a prompt file resolved from the repo root.
- `runPromptScenario(opts)` — calls the Anthropic Messages API using the model in `OVERDECK_EVAL_MODEL`; rejects before any network call if the variable is unset.
- `extractJsonArray(text)` — leniently extracts the first top-level JSON array from a model response, including through ` ```json ` fences.

There is no hardcoded model fallback. Set the eval model explicitly:

```bash
OVERDECK_EVAL_MODEL=claude-haiku-4-5-20251001 npm run eval
```

### CI prompt gate

A PR that diffs `roles/*.md` or `docs/flywheel-brief.md` must include a `Prompt-Change:` trailer in at least one commit. The gate is enforced by [`scripts/check-prompt-change-trailer.sh`](../scripts/check-prompt-change-trailer.sh), which runs in CI via the `prompt-gate` job and is also wired into `npm run lint` as `lint:prompt-trailer`.

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

The current suite is offline and deterministic. Live model evals should read credentials from the existing Overdeck/provider environment and should document expected cost before being added. CI wiring is intentionally deferred until the team decides which evals are cheap and stable enough to gate by default.
