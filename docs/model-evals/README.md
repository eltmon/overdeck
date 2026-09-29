# Model evaluations

Head-to-head runs of Overdeck's own eval suites (`evals/`) that back model placement decisions and the provider presets (#4400). Each report states the models, effort, sample size, cost, results, caveats and the resulting config recommendation.

| Date | Comparison | Decision |
| --- | --- | --- |
| 2026-09-29 | [Opus 5.5 vs Sonnet 5.5 for the `mid` slot](2026-09-29-opus-5-5-vs-sonnet-5-5.md) | Keep `mid` on Opus 5.5; keep review on Opus. Sonnet 5.5 matched Opus on delegated execution at about 45% of the cost, but found far fewer review blockers (10 of 60 vs 30 of 60). |

The Anthropic [model presets](../../configuration/model-presets.mdx) cite the 2026-09-29 run for their `mid` and review placements.
