# Tiered Execution

Tiered execution routes each vBRIEF bead to the cheapest warm agent tier that can do the work, while a durable foreman owns issue bookkeeping and commit boundaries. It is off by default. Enable it only for projects that have explicit tier configuration and are ready for standing tier sessions.

## Configuration

The project config declares the tier table, routing defaults, supervisor policy, feed policy, escalation policy, and replay behavior under `tiered_execution`. Every v2 knob defaults to current behavior: no call-outs, no feed exclusions, no diff cap, no escalation, no compaction reroute, no supervisor-owned inspection, and no kind-based routing.

```yaml
tiered_execution:
  enabled: false
  tiers:
    cheap:
      model: claude-haiku-4-5
      harness: claude-code
      difficulties: [trivial, simple]
    standard:
      model: claude-sonnet-4-6
      harness: claude-code
      difficulties: [medium]
    frontier:
      model: claude-opus-4-8
      harness: claude-code
      difficulties: [complex, expert]
  supervisor:
    model: claude-opus-4-8
    harness: claude-code
    subscribe: flagged
    owns_inspection: false
  by_kind:
    design: frontier
    spike: frontier
  feed:
    callouts: off
    exclude: []
    exclude_subjects: []
    max_diff_bytes: null
  escalation:
    enabled: false
    retries_at_tier: 0
    max_promotions: 0
    flounder_budget_minutes: {}
  compaction_reroute: off
  replay_threshold: 0.5
```

`enabled` must stay `false` unless the operator deliberately opts the project into tiered execution. The loader (`src/lib/agents/tier-table.ts`) validates the table at load time and fails loudly rather than falling back to a hardcoded model:

- Every one of the five difficulties (`trivial`, `simple`, `medium`, `complex`, `expert`) must map to exactly one tier — a difficulty mapped to zero tiers or to two tiers is a named validation error.
- An unknown model or harness is rejected at load, and tier/supervisor definitions pass through the same pi+Anthropic+subscription ToS gate as every other spawn (`src/lib/harness-policy.ts`).
- A `supervisor` block is required whenever tiers are configured.
- With no `tiered_execution` block present, the loader returns `enabled: false` with `replay_threshold: 0.5` and no error.
- `feed.callouts` must be `off`, `notify`, or `corroborate`; default `off` preserves the old ingestion-only feed text byte-for-byte.
- `feed.exclude` is a list of git pathspec globs removed from rendered feed diffs; default `[]` removes nothing.
- `feed.exclude_subjects` is a list of commit-subject prefixes skipped from live and replay feeds; default `[]` skips nothing.
- `feed.max_diff_bytes` is a positive integer cap or `null`; default `null` keeps raw `git show` output uncapped.
- `escalation.enabled` defaults to `false`; when disabled, supervisor verdicts and verification failures do not promote tiers.
- `escalation.retries_at_tier` and `escalation.max_promotions` are non-negative integers; both default to `0`.
- `escalation.flounder_budget_minutes` maps difficulties to positive minute budgets; default `{}` leaves the floundering trigger inactive.
- `compaction_reroute` must be `off` or `on`; default `off` keeps replay respawning the same registered slot with the same captured behavior.
- `supervisor.owns_inspection` defaults to `false`, so `pan inspect` still spawns the ephemeral inspect specialist unless the operator opts in.
- `by_kind` is optional and defaults to `{}`; kind routing is never hardcoded.

## Resolution Chain

The router chooses a tier deterministically for each ready bead. Models do not race to decide whether to intervene.

1. Explicit override: a per-bead or operator override wins when present.
2. Kind routing: `metadata.kind` routes docs, API, backend, frontend, infra, test, refactor, design, and spike work to configured tier preferences when `by_kind` names them.
3. Difficulty routing: `metadata.difficulty` routes trivial/simple/medium/complex/expert beads when no kind route applies.
4. Role default: the configured role default tier is used when neither override nor metadata routes the bead.

If the chain reaches a missing tier, missing model, or missing harness, spawn must fail loudly. It must not silently fall back to a literal model ID.

Recommended, not default: route judgment-deliverable kinds such as `design` and `spike` to the top tier:

```yaml
tiered_execution:
  by_kind:
    design: frontier
    spike: frontier
```

This follows Devin Fusion's failure-mode lesson: when judgment is the deliverable, delegating it to a cheaper sidekick can backfire. It remains a recommendation because model choice must come from explicit operator configuration, never a hardcoded fallback.

## Standing Warm Tiers

The foreman owns `bd ready`, claiming, status updates, verification commands, commit messages, and bead closure. Tier agents do implementation only. They receive the bead brief, make the scoped change, and return control to the foreman for verification and commit.

Standing tier agents are long-lived sessions for the life of the issue. The commit feed is an everyone-hears-everything stream: every standing implementation tier receives the committed diff and bead summary, so future tier agents stay warm without re-onboarding. This is intentionally simpler than per-tier relevance filtering and keeps replay deterministic.

Feed filtering is subtractive noise removal only. `feed.exclude` removes configured paths from the diff, `feed.exclude_subjects` skips whole commits such as beads-sync commits, and `feed.max_diff_bytes` replaces oversized diffs with `git show --stat` plus an explicit truncation note. Live feed and replay use the same renderer so replayed messages stay byte-identical to live messages under the same config.

`feed.callouts` controls quiet-but-vigilant listener authority:

- `off` (default): feed messages stay strictly ingestion-only and byte-identical to the baseline.
- `notify`: listeners may raise at most one call-out through `POST /api/tiered/callouts`; the call-out is recorded and surfaced, but it does not block dispatch.
- `corroborate`: `notify` behavior plus exactly one supervisor review of that commit, even if the commit is outside the supervisor's normal subscription.

A call-out is a flag, not a task. Listener agents must not edit files, self-assign, or halt the line directly; policy and supervisor verdicts decide consequences.

## Event-Driven Supervisor

The supervisor is a standing review tier, not an implementer. It wakes on commit events and reviews the diff against the bead description and acceptance criteria.

Supported subscription policies (`supervisor.subscribe`):

- `all`: review every bead commit.
- `flagged`: review only commits for beads flagged for inspection (e.g. `requiresInspection: true` in bead metadata).
- `sampled`: review a configured sample of commits for cost measurement.

There is no `off` policy — the supervisor block is required whenever tiers are configured. To run without supervision, disable tiered execution entirely.

Supervisor findings block the foreman before downstream beads proceed. A clean supervisor ack does not replace the normal review and test pipeline.

When `supervisor.owns_inspection: true` and tiered execution is enabled for the issue, `pan inspect` routes to the standing supervisor instead of spawning an ephemeral inspect specialist. If the supervisor session is absent, Overdeck starts it first; if that fails, inspection fails loudly rather than silently falling back. With the flag at its default `false`, the existing ephemeral inspect path is unchanged.

## Escalation

Escalation is disabled by default. When `escalation.enabled: true`, deterministic trigger events can promote a bead's effective difficulty exactly one step up the ladder:

`trivial -> simple -> medium -> complex -> expert`

Triggers are supervisor `BLOCKED` verdicts for the bead's commit, verification failures attributed to the bead, and floundering when a configured per-difficulty time budget is exceeded. `retries_at_tier` controls how many attempts stay on the current tier before promotion, and `max_promotions` caps promotions per bead. At `expert`, or after the promotion cap is reached, the result is block-and-surface for operator attention.

Example with `retries_at_tier: 1` and `max_promotions: 2`: a `simple` bead gets one retry at `simple`; the next qualifying trigger promotes it to `medium`; another retry/promotion cycle can move it to `complex`; a further trigger blocks because the promotion cap is spent. Promotions are recorded as effective difficulty in workspace `.pan/continue.json` `tierOverrides`, not by mutating the vBRIEF spec.

## Trivial Fast-Track

Trivial and simple beads can run in a cheap in-context path when their metadata is high-confidence and the files scope is narrow. The trust boundary is strict: fast-track agents may edit only the claimed bead scope, and the foreman still runs the bead's verification command before committing.

Fast-track is for mechanical work such as docs, tests, small refactors, and obvious single-file changes. It is not a bypass for security, schema, auth, or cross-cutting protocol beads.

## Replay and Compaction

A standing tier session's curated context is derivable from the vBRIEF plan plus the git commit log. If a tier session dies, saturates context, or reaches `replay_threshold` of its context window at a tier-run boundary, the foreman can restart it and replay the issue feed from durable commits.

Replay is the compaction strategy. Agents should not rely on hidden terminal state or uncommitted local memory for correctness.

With `compaction_reroute: off` (default), replay respawns the same registered tier slot behavior as before. With `compaction_reroute: on`, crash replay and threshold compaction recompute the remaining tier-run schedule from items not completed in `statusOverrides`, after applying effective difficulties from `tierOverrides`. If the target tier no longer appears in the remaining schedule, Overdeck decommissions it and spawns nothing. If the tier is still needed, replay respawns with that tier's current configured model and harness, so operator tuning and promotions take effect at the cache-miss point.

## Non-Goals

- Per-tier relevance filtering is deferred; the feed stays everyone-hears-everything with only subtractive noise filtering.
- The live cost pilot is deferred; this document describes the intended contract, not measured production economics.
- Remote tiers are deferred; v1 assumes local standing sessions unless a later issue adds remote-tier lifecycle support.
- Tiered execution does not replace the review pipeline.
- Tiered execution does not allow in-session model switching; each tier is its own session.
- Listener call-outs do not authorize implementation, self-assignment, or direct dispatch blocking.
