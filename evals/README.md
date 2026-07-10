# Overdeck Evals

Run the eval suite with:

```bash
npm run eval
```

Evalite runs every `*.eval.ts` file under `evals/` and stores local run data under `node_modules/.evalite/`.

The suite is split deliberately between deterministic and live cases:

- **Deterministic cases** (memory rollup synthesis, prompt-invariant rail assertions, …) run on every `npm test` and `npm run eval`. They are safe for the blocking CI gate because they do not call a model.
- **Live prompt cases** (flywheel launch decision, review synthesis canonical blocker format) call an Anthropic model at temperature 0 against the actual role prompt surface. They require `OVERDECK_EVAL_MODEL` plus ambient Anthropic credentials, and **never run in CI**. They are meant for local operator-driven regression sweeps, not gating.

`OVERDECK_EVAL_MODEL` is mandatory for any live case. There is no hardcoded model fallback anywhere in `evals/lib/prompt-harness.ts` — the harness reads the env var and rejects before any network call when it is unset. Setting `OVERDECK_EVAL_MODEL` is the operator's explicit opt-in to spend on a live run.

```bash
# Required to run live prompt evals. Pick whichever model you want to charge.
export OVERDECK_EVAL_MODEL=claude-haiku-4-5-20251001

# Then run the eval suite. Deterministic cases run as usual; live cases
# only run when their scenario file is invoked (e.g. via the matching
# bead's verify command), not by the default `npm run eval` path.
npm run eval
```

## Live prompt evals — cost order of magnitude

Each live case loads the actual prompt file under test (e.g. `roles/flywheel.md` or `docs/flywheel-brief.md`) via `loadPromptFile` and calls `runPromptScenario` against the eval model with `temperature: 0`. Token math for a single local sweep:

- ~2 prompt files × ~3–5 scenarios per file
- ~2k–8k input tokens per scenario (the role brief plus a fixture board state)
- ~200–800 output tokens per scenario (a structured JSON array or decision text)

So one full sweep is roughly **~20k–60k input tokens + ~2k–4k output tokens** across all live cases. At Haiku-class pricing that is well under one US dollar per run. Use a stronger model (Sonnet / Opus) only when you specifically want to validate reasoning on a hard scenario — those runs cost more in proportion.

## Prompt-Change trailer contract

`roles/*.md` and `docs/flywheel-brief.md` are load-bearing safety surfaces. The CI prompt-gate job (see [`../docs/FLYWHEEL.md`](../docs/FLYWHEEL.md#prompt-regression-protection) → **Prompt-regression protection**) refuses any PR whose diff touches those paths without a `Prompt-Change:` trailer in the commit message footer.

When a deliberate prompt change ships, the commit subject (and footer) should look like:

```text
fix(flywheel): restore the author-gate negative case rail

The flywheel role lost the "you may only touch the prompt under your
own author gate" rail. Restore it verbatim.

Prompt-Change: restored author-gate rail; behavior unchanged elsewhere
```

`Prompt-Change:` must appear in the commit message footer on every commit that diffs `roles/*.md` or `docs/flywheel-brief.md`. The trailer is a plain `Key: value` line, free-form after the colon. The CI script parses only the key, not the value.

**Do not amend pushed commits to add the trailer.** If a commit already landed without one, ship a follow-up commit that carries the trailer rather than rewriting history.

## Evals

Each `*.eval.ts` file under `evals/` covers a specific surface. Add new cases to the matching file rather than creating parallel suites.

### `memory-status-rollup.eval.ts`

Covers memory status rollup synthesis through `synthesizeStatusRollup`. Uses realistic observations, pending turns, and captured provider-shaped outputs to exercise the same structured-output boundary used by the LLM provider path, then scores the validated rollup for phase selection, working-set recall, stale working-set removal, blocker preservation, next-step preservation, and prompt replacement guidance.

This case is fully deterministic — the provider call is replaced by a captured-output stub, so it runs in CI.

### `flywheel-launch.eval.ts`

Golden-scenario live eval: given a fixture board state (a synthetic pipeline plus a known backlog of parked issues), does the loaded `roles/flywheel.md` prompt still drive the model toward a **launch decision** (run `pan start <id>` against a concrete issue) rather than collapsing into a report? Includes the author-gate negative case — the eval fixture must include a change by an off-allowlist author and assert the role refuses to mutate the prompt.

Runs against `OVERDECK_EVAL_MODEL`. Not in CI.

### `review-blocker-format.eval.ts`

Golden-scenario live eval: given fixture reviewer reports (a correctness pass plus a requirements fail), does the loaded `roles/review.md` prompt still drive the model to emit a synthesis in the canonical blocker format (the `## Blockers` section with the `file:line` citations and the per-finding verdict lines the rest of the pipeline parses)?

Runs against `OVERDECK_EVAL_MODEL`. Not in CI.

## Deterministic prompt-invariant suite

In addition to the evalite cases, `tests/unit/prompts/prompt-invariants.test.ts` asserts the load-bearing rail text exists in the prompt files themselves (e.g. "vetoed-is-absolute", "auto_pickup_backlog", "author/assignee allowlist"). This suite is plain Vitest, runs in the default `npm test` path, and is the only prompt regression check in blocking CI.

## Adding A Case

Add or extend a `*.eval.ts` file with:

1. Fixed input evidence from realistic records, fixtures, or small synthetic cases that mirror production shape.
2. A task that calls the actual Overdeck behavior under evaluation. For live cases, route through `loadPromptFile` + `runPromptScenario` from `evals/lib/prompt-harness.ts` so the model is supplied by the operator, not by the file.
3. Structural scorers first. Add an LLM-as-judge scorer only when the output is genuinely fuzzy.

Keep datasets small until baseline storage and CI policy exist. Do not commit API keys or captured secrets in eval fixtures.

## Caveats

- The deterministic suite is fully offline and safe for blocking CI.
- The live prompt cases require `OVERDECK_EVAL_MODEL` plus ambient Anthropic credentials. They are not part of the default `npm run eval` path and are never invoked in CI — they live behind their matching bead's verify command.
- CI wires up only the deterministic suite plus the `Prompt-Change:` trailer gate. Wiring the live cases into CI would require an explicit cost and flakeness decision the team has not yet made.