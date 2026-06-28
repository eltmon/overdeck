# Overdeck Evals

Run the eval suite with:

```bash
npm run eval
```

Evalite runs every `*.eval.ts` file under `evals/` and stores local run data under `node_modules/.evalite/`. These evals are not part of the blocking CI gate yet because future cases may call models and introduce cost or nondeterminism.

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
