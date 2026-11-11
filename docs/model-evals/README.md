# Model evaluations

Head-to-head runs of Overdeck's own eval suites (`evals/`) that back model placement decisions and the provider presets (#4400). Each report states the models, effort, sample size, cost, results, caveats and the resulting config recommendation.

| Date | Comparison | Decision |
| --- | --- | --- |
| 2026-11-11 | [Haiku 5.5 vs Haiku 4.5 for background calls](2026-11-11-haiku-5-5-background-calls.md) | Move the cheap slot and the title, compaction and memory defaults to Haiku 5.5. It was at least as good on 20 of 20 titles and 20 of 20 compactions, at about 1/26 of the title cost and 1/3.5 of the compaction cost. |
| 2026-09-29 | [Opus 5.5 vs Sonnet 5.5 for the `mid` slot](2026-09-29-opus-5-5-vs-sonnet-5-5.md) | Keep `mid` on Opus 5.5; keep review on Opus. Sonnet 5.5 matched Opus on delegated execution at about 45% of the cost, but found far fewer review blockers (10 of 60 vs 30 of 60). |

The Anthropic [model presets](../../configuration/model-presets.mdx) cite the 2026-09-29 run for their `mid` and review placements.
