# Tiered Execution

Tiered execution routes each vBRIEF bead to the cheapest warm agent tier that can do the work, while a durable foreman owns issue bookkeeping and commit boundaries. It is off by default. Enable it only for projects that have explicit tier configuration and are ready for standing tier sessions.

## Configuration

The project config declares the tier table, the routing defaults, supervisor policy, and replay threshold under `tiered_execution`:

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
  replay_threshold: 0.5
```

`enabled` must stay `false` unless the operator deliberately opts the project into tiered execution. The loader (`src/lib/agents/tier-table.ts`) validates the table at load time and fails loudly rather than falling back to a hardcoded model:

- Every one of the five difficulties (`trivial`, `simple`, `medium`, `complex`, `expert`) must map to exactly one tier — a difficulty mapped to zero tiers or to two tiers is a named validation error.
- An unknown model or harness is rejected at load, and tier/supervisor definitions pass through the same pi+Anthropic+subscription ToS gate as every other spawn (`src/lib/harness-policy.ts`).
- A `supervisor` block is required whenever tiers are configured.
- With no `tiered_execution` block present, the loader returns `enabled: false` with `replay_threshold: 0.5` and no error.

## Resolution Chain

The router chooses a tier deterministically for each ready bead. Models do not race to decide whether to intervene.

1. Explicit override: a per-bead or operator override wins when present.
2. Kind routing: `metadata.kind` routes docs, API, backend, frontend, infra, test, refactor, design, and spike work to configured tier preferences.
3. Difficulty routing: `metadata.difficulty` routes trivial/simple/medium/complex/expert beads when no kind route applies.
4. Role default: the configured role default tier is used when neither override nor metadata routes the bead.

If the chain reaches a missing tier, missing model, or missing harness, spawn must fail loudly. It must not silently fall back to a literal model ID.

## Standing Warm Tiers

The foreman owns `bd ready`, claiming, status updates, verification commands, commit messages, and bead closure. Tier agents do implementation only. They receive the bead brief, make the scoped change, and return control to the foreman for verification and commit.

Standing tier agents are long-lived sessions for the life of the issue. In v1, the commit feed is an everyone-hears-everything stream: every standing implementation tier receives the committed diff and bead summary, so future tier agents stay warm without re-onboarding. This is intentionally simpler than per-tier filtering and keeps replay deterministic.

## Event-Driven Supervisor

The supervisor is a standing review tier, not an implementer. It wakes on commit events and reviews the diff against the bead description and acceptance criteria.

Supported subscription policies (`supervisor.subscribe`):

- `all`: review every bead commit.
- `flagged`: review only commits for beads flagged for inspection (e.g. `requiresInspection: true` in bead metadata).
- `sampled`: review a configured sample of commits for cost measurement.

There is no `off` policy — the supervisor block is required whenever tiers are configured. To run without supervision, disable tiered execution entirely.

Supervisor findings block the foreman before downstream beads proceed. A clean supervisor ack does not replace the normal review and test pipeline.

## Trivial Fast-Track

Trivial and simple beads can run in a cheap in-context path when their metadata is high-confidence and the files scope is narrow. The trust boundary is strict: fast-track agents may edit only the claimed bead scope, and the foreman still runs the bead's verification command before committing.

Fast-track is for mechanical work such as docs, tests, small refactors, and obvious single-file changes. It is not a bypass for security, schema, auth, or cross-cutting protocol beads.

## Replay and Compaction

A standing tier session's curated context is derivable from the vBRIEF plan plus the git commit log. If a tier session dies, saturates context, or reaches `replay_threshold` of its context window at a tier-run boundary, the foreman can restart it and replay the issue feed from durable commits.

Replay is the compaction strategy. Agents should not rely on hidden terminal state or uncommitted local memory for correctness.

## Non-Goals

- Per-tier commit filtering is deferred; v1 uses everyone-hears-everything feeds.
- The live cost pilot is deferred; this document describes the intended contract, not measured production economics.
- Remote tiers are deferred; v1 assumes local standing sessions unless a later issue adds remote-tier lifecycle support.
- Tiered execution does not replace the review pipeline.
- Tiered execution does not allow in-session model switching; each tier is its own session.
