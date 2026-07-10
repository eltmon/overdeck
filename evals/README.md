# Overdeck Evals

Run the eval suite with:

```bash
npm run eval
```

Evalite runs every `*.eval.ts` file under `evals/` and stores local run data under `node_modules/.evalite/`. These evals are not part of the blocking CI gate yet because future cases may call models and introduce cost or nondeterminism.

## Current Targets

The first eval covers memory status rollup synthesis through `synthesizeStatusRollup`. It uses realistic observations, pending turns, and captured provider-shaped outputs to exercise the same structured-output boundary used by the LLM provider path, then scores the validated rollup for phase selection, working-set recall, stale working-set removal, blocker preservation, next-step preservation, and prompt replacement guidance.

The second eval — `flywheel-launch-decision.eval.ts` — is a live-model golden-scenario regression guard for the Flywheel role. It loads the prompt surface under test from the repo (the system prompt is `roles/flywheel.md` plus `docs/flywheel-brief.md`, fetched via `loadPromptFile` and never embedded), feeds three fixture board snapshots, and scores the returned action array against the role's load-bearing rails: the role must still LAUNCH (not just report) a released, author-trusted backlog issue when capacity is free; must never start an untrusted-author issue (the author/assignee gate — the only safeguard against a malicious third-party issue); and must hold unreleased backlog when `auto_pickup_backlog` is OFF. Pure scorer logic lives in `evals/lib/flywheel-scorers.ts` so the rails are offline-auditable without a live model call; the live-model task uses the shared `evals/lib/prompt-harness.ts` (`loadPromptFile` / `runPromptScenario` / `extractJsonArray`).

The primary review synthesis role still requires a tmux agent session, so it was not chosen for this foundation pass. A later eval should extract the review synthesis prompt/report logic into a callable function, reusing the same `evals/lib/prompt-harness.ts` harness and the pure-scorer-split pattern.

## Adding A Case

Add or extend a `*.eval.ts` file with:

1. Fixed input evidence from realistic records, fixtures, or small synthetic cases that mirror production shape.
2. A task that calls the actual Overdeck behavior under evaluation.
3. Structural scorers first. Add an LLM-as-judge scorer only when the output is genuinely fuzzy.

Keep datasets small until baseline storage and CI policy exist. Do not commit API keys or captured secrets in eval fixtures.

## Caveats

The memory-status-rollup eval is offline and deterministic. The flywheel launch eval is live-model: it calls `runPromptScenario`, which fails loudly when `OVERDECK_EVAL_MODEL` is unset (no hardcoded model fallback — see `evals/lib/prompt-harness.ts`) and makes no network call at all while that env var is absent. Run it manually with a **sonnet-tier-or-stronger** model:

```bash
OVERDECK_EVAL_MODEL=<sonnet-tier-or-stronger model> npm run eval
```

The author/assignee-gate case (`excludes-untrusted-author`) is security-critical and sits near the floor of model reliability. Verified live: a sonnet-tier model passes all three hard scorers (ac1 launch, ac2 author-gate withhold, ac3 pickup-OFF hold); a haiku-tier / flash-slot model intermittently *starts* the untrusted issue and fails ac2 — a model-capability gap, not a prompt regression (the gate is intact in `roles/flywheel.md`). Use a sonnet-tier-or-stronger eval model so a weak model is not misread as doctrine degradation.

Per NFR-1 it is intentionally NOT in the blocking CI gate; live model evals should read credentials from the existing Overdeck/provider environment and document expected cost before being added. CI wiring is deferred until the team decides which evals are cheap and stable enough to gate by default.
