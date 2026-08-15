# Tiered Execution

Tiered execution routes each xBRIEF task to the cheapest warm agent tier that can do the work, while a durable foreman owns issue bookkeeping and commit boundaries. It is off by default. Enable it only for projects that have explicit tier configuration and are ready for standing tier sessions.

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
    owns_inspection: true   # default when a supervisor is configured (PAN-2397 W4)
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
- `supervisor.owns_inspection` defaults to `true` when a supervisor is configured (PAN-2397 W4): a standing supervisor IS the inspection surface. Set it to `false` explicitly to keep routing `pan inspect` to the ephemeral inspect/inspect-deep subrole agents.
- `by_kind` is optional and defaults to `{}`; kind routing is never hardcoded.

## Settings UI

The dashboard Settings -> Tiered Execution panel presents the tier table as crews, so operators edit the routing decision rather than YAML tier names. Its five-column board maps every difficulty to exactly one crew, making missing and duplicate difficulty coverage impossible. The crew roster labels each crew by its staffing (for example, `Kimi K2.7 Code` or `4-model mix`), shows blended cost, and expands into single-model or weighted-distribution editors. Harness selectors default to the provider route and warn when an explicit override creates a known routing hazard.

The roster's **+ Add crew** control opens an inline difficulty prompt, so creating a crew and assigning its first difficulty remain one gesture. From an empty roster, the first crew takes every difficulty immediately. Each collapsed row exposes **× remove**; when the crew owns difficulties, the hand-off prompt chooses another crew to inherit them and emits the reassignment and removal in one settings write. The board's **+ new crew…** shortcut remains available and uses the same create-and-assign path.

The supervisor collapses to a sentence describing its subscription, model, and inspection ownership. Kind routing shows only active override chips plus an add control; when none exist, the panel says that all kinds follow difficulty routing. Commit feed, escalation, and session replay settings live under Advanced disclosures with their resolved values in the summary. Session replay exposes both `replay_threshold` and `compaction_reroute`: **bring back the same session as before** writes `off`, while **re-plan remaining work; retire crews no longer needed** writes `on`. A final disclosure previews the exact `tiered_execution` YAML the next save will write.

On load, tiers with identical staffing merge into one crew and own the union of their difficulties; this changes only the editing shape, not runtime routing. On save, tier names are derived from the owned difficulties in ladder order, such as `trivial-simple` or `medium-complex-expert`, and every `by_kind` reference is rewritten in the same operation. Hand-authored tier names remain valid and are honored when read from YAML, but the next UI save replaces them with derived names. The operator-approved interaction references are [`docs/design/mockups/tiered-execution-redesign-pan-2684.html`](design/mockups/tiered-execution-redesign-pan-2684.html) for the overall panel and [`docs/design/mockups/crew-create-delete-pan-2760.html`](design/mockups/crew-create-delete-pan-2760.html) for crew creation and removal.

Every crew must retain at least one difficulty because runtime tiers reject an empty `difficulties` list. Removal performs the required reassignment through the hand-off prompt before deleting the crew. A crew with kind overrides remains blocked with `Move or remove these kind overrides before removing this crew.`; the last crew remains blocked with `This is the only crew, and every difficulty needs one. Add another crew first — or turn tiered execution off.` Moving the final difficulty of a kind-routed crew is also blocked until those overrides are explicitly moved or removed, so an unrelated routing edit cannot silently delete kind-routed work.

The issue view's **Policies** panel exposes the per-issue override in its Work group as a **Standing crew** segmented control: `Default · <effective> (<source>)`, `On`, or `Off`. Explicit overrides appear in the collapsed strip as an overrides-only `crew · on|off` chip and write to the per-issue permanent record through `PATCH /api/workspaces/:issueId/tiered-execution`; the xBRIEF spec remains immutable under PAN-1124, so the override is stored outside the spec and resolved at runtime. When a per-issue work-model override is active, it suspends crew routing for the entire issue, and the panel and collapsed chip state that consequence.

## Resolution Chain

The following precedence applies when resolving tiered execution for an issue:

- **Per-issue record override** — highest precedence; set by the Standing Crew toggle on the issue view and persisted to the per-issue permanent record.
- **Plan metadata override** (`plan.metadata.tiered_execution`) — set at planning time in the xBRIEF spec.
- **Global / project configuration** (`tiered_execution.enabled`) — the default switch in project config.

If a record override is present, it wins over both plan metadata and the global flag. Deleting the record override falls back to plan metadata, and absent both, the global/project flag decides.

Per-task routing then proceeds as follows:

The router chooses a tier deterministically for each ready task. Models do not race to decide whether to intervene.

1. Explicit override: a per-task or operator override wins when present.
2. Kind routing: `metadata.kind` routes docs, API, backend, frontend, infra, test, refactor, design, and spike work to configured tier preferences when `by_kind` names them.
3. Difficulty routing: `metadata.difficulty` routes trivial/simple/medium/complex/expert tasks when no kind route applies.
4. Role default: the configured role default tier is used when neither override nor metadata routes the task.

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

The foreman owns `pan task next`, claiming, status updates, verification commands, commit messages, and task closure. Tier agents do implementation only. They receive the task brief, make the scoped change, and return control to the foreman for verification and commit.

Standing tier agents are long-lived sessions for the life of the issue. The commit feed is an everyone-hears-everything stream: every standing implementation tier receives the committed diff and task summary, so future tier agents stay warm without re-onboarding. This is intentionally simpler than per-tier relevance filtering and keeps replay deterministic.

Feed filtering is subtractive noise removal only. `feed.exclude` removes configured paths from the diff, `feed.exclude_subjects` skips whole commits such as tasks-sync commits, and `feed.max_diff_bytes` replaces oversized diffs with `git show --stat` plus an explicit truncation note. Live feed and replay use the same renderer so replayed messages stay byte-identical to live messages under the same config.

`feed.callouts` controls quiet-but-vigilant listener authority:

- `off` (default): feed messages stay strictly ingestion-only and byte-identical to the baseline.
- `notify`: listeners may raise at most one call-out through `POST /api/tiered/callouts`; the call-out is recorded and surfaced, but it does not block dispatch.
- `corroborate`: `notify` behavior plus exactly one supervisor review of that commit, even if the commit is outside the supervisor's normal subscription.

A call-out is a flag, not a task. Listener agents must not edit files, self-assign, or halt the line directly; policy and supervisor verdicts decide consequences.

## Event-Driven Supervisor

The supervisor is a standing review tier, not an implementer. It wakes on commit events and reviews the diff against the task description and acceptance criteria.

Supported subscription policies (`supervisor.subscribe`):

- `all`: review every task commit.
- `flagged`: review only commits for tasks flagged for inspection (e.g. `requiresInspection: true` in task metadata).
- `sampled`: review a configured sample of commits for cost measurement.

There is no `off` policy — the supervisor block is required whenever tiers are configured. To run without supervision, disable tiered execution entirely.

Supervisor findings block the foreman before downstream tasks proceed. A clean supervisor ack does not replace the normal review and test pipeline.

When `supervisor.owns_inspection: true` and tiered execution is enabled for the issue, `pan inspect` routes to the standing supervisor instead of spawning an ephemeral inspect specialist. If the supervisor session is absent, Overdeck starts it first; if that fails, inspection fails loudly rather than silently falling back. With the flag explicitly set to `false`, the existing ephemeral inspect path is unchanged (and it remains the path when no supervisor is configured at all).

## Escalation

Escalation is disabled by default. When `escalation.enabled: true`, deterministic trigger events can promote a task's effective difficulty exactly one step up the ladder:

`trivial -> simple -> medium -> complex -> expert`

Triggers are supervisor `BLOCKED` verdicts for the task's commit, verification failures attributed to the task, and floundering when a configured per-difficulty time budget is exceeded. `retries_at_tier` controls how many attempts stay on the current tier before promotion, and `max_promotions` caps promotions per task. At `expert`, or after the promotion cap is reached, the result is block-and-surface for operator attention.

Example with `retries_at_tier: 1` and `max_promotions: 2`: a `simple` task gets one retry at `simple`; the next qualifying trigger promotes it to `medium`; another retry/promotion cycle can move it to `complex`; a further trigger blocks because the promotion cap is spent. Promotions are recorded as effective difficulty in workspace `.pan/continue.json` `tierOverrides`, not by mutating the xBRIEF spec.

## Trivial Fast-Track

Trivial and simple tasks can run in a cheap in-context path when their metadata is high-confidence and the files scope is narrow. The trust boundary is strict: fast-track agents may edit only the claimed task scope, and the foreman still runs the task's verification command before committing.

Fast-track is for mechanical work such as docs, tests, small refactors, and obvious single-file changes. It is not a bypass for security, schema, auth, or cross-cutting protocol tasks.

## Replay and Compaction

A standing tier session's curated context is derivable from the xBRIEF plan plus the git commit log. If a tier session dies, saturates context, or reaches `replay_threshold` of its context window at a tier-run boundary, the foreman can restart it and replay the issue feed from durable commits.

Replay is the compaction strategy. Agents should not rely on hidden terminal state or uncommitted local memory for correctness.

With `compaction_reroute: off` (default), replay respawns the same registered tier slot behavior as before. With `compaction_reroute: on`, the foreman owns rerouting: it recomputes the remaining tier-run schedule from items not completed in `statusOverrides`, after applying effective difficulties from `tierOverrides`. If the target tier no longer appears, the foreman decommissions it. If the tier is still needed, the foreman respawns it with the current configured model and harness, so operator tuning and promotions take effect at the cache-miss point.

## Non-Goals

- Per-tier relevance filtering is deferred; the feed stays everyone-hears-everything with only subtractive noise filtering.
- The live cost pilot is deferred; this document describes the intended contract, not measured production economics.
- Remote tiers are deferred; v1 assumes local standing sessions unless a later issue adds remote-tier lifecycle support.
- Tiered execution does not replace the review pipeline.
- Tiered execution does not allow in-session model switching; each tier is its own session.
- Listener call-outs do not authorize implementation, self-assignment, or direct dispatch blocking.
