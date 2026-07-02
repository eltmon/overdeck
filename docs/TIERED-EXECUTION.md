# Tiered Execution

Tiered execution routes each vBRIEF bead to a standing implementation agent whose model and harness match the bead's declared difficulty. The foreman remains the only process that owns task state, commits, and lifecycle commands; tier agents only implement the bead they are handed.

This feature is off by default. The initial implementation is designed for serial bead execution through warm standing tiers, with an event-driven supervisor reviewing commit boundaries.

## Terms

| Term | Meaning |
|---|---|
| Bead | One vBRIEF plan item materialized as a `bd` task. |
| Difficulty | `metadata.difficulty` on a vBRIEF item: `trivial`, `simple`, `medium`, `complex`, or `expert`. |
| Tier | A named `{ model, harness, difficulties }` entry in `tiered_execution.tiers`. |
| Foreman | The durable issue work agent that claims beads, dispatches tier agents, commits changes, closes beads, and forwards feed events. |
| Supervisor | A standing reviewer agent subscribed to commit events. It reviews diffs and reports findings; it never implements. |
| Feed | Ingestion-only context sent to a standing tier or supervisor, usually a relevant commit diff plus bead metadata. |
| Replay | Recovery path that respawns a standing agent and re-delivers its durable feed from git history and the plan schedule. |

## Configuration

`tiered_execution` is configured in Overdeck config and defaults to disabled. Every difficulty must appear in exactly one tier. A missing difficulty or a difficulty listed in two tiers is rejected at config load. Unknown models, unknown harnesses, and harness/model/auth combinations blocked by `src/lib/harness-policy.ts` are also rejected.

```yaml
tiered_execution:
  enabled: false
  tiers:
    light:
      model: claude-haiku-4-5
      harness: claude-code
      difficulties: [trivial, simple]
    standard:
      model: gpt-5.5
      harness: codex
      difficulties: [medium, complex]
    frontier:
      model: claude-opus-4-6
      harness: claude-code
      difficulties: [expert]
  supervisor:
    model: claude-opus-4-6
    harness: claude-code
    subscribe: flagged
  replay_threshold: 0.5
```

`supervisor.subscribe` controls which commits are reviewed:

| Value | Behavior |
|---|---|
| `all` | Review every bead commit. Useful for pilots and high-risk plans. |
| `flagged` | Review only commits for beads marked for inspection, such as `requiresInspection: true`. |
| `sampled` | Review a sampled subset of commits once a sampling policy is configured by the supervisor implementation. |

`replay_threshold` is the fraction of a standing agent's model context window that triggers replay at a tier-run boundary. The default is `0.5`. Replay never happens mid-bead.

## Resolution Chain

Tiered dispatch uses deterministic resolution. Models do not decide whether to step in.

1. Explicit override for this spawn or bead, when one exists.
2. Kind-specific routing, such as a future `metadata.kind` route.
3. Difficulty routing through `tiered_execution.tiers`.
4. Role default from normal role model configuration.
5. Fail loudly if no configured value can be resolved.

There is no hardcoded model fallback in the tiered execution chain. An unset tier, unknown difficulty, or invalid tier definition is a configuration error.

## Execution Flow

The foreman owns the loop:

1. Read the next ready bead from `bd`.
2. Resolve the bead's difficulty to a tier.
3. Claim the bead.
4. Dispatch the bead spec and acceptance criteria to that tier's standing agent.
5. Receive the agent's completion response and inspect changed files for scope.
6. Stage and commit the bead as one commit.
7. Close the bead and update runtime plan state.
8. Emit the commit event to the supervisor and any tier feeds that need the diff.

Tier agents do not run `bd`, close tasks, inspect pipeline state, or commit. This keeps lifecycle state in one place and preserves the one-bead-one-commit invariant.

## Standing Warm Tiers

Each tier is a long-lived registered agent for the issue. Tiers are spawned lazily when their first run is near, not eagerly for every configured tier. A tier that never appears in the plan schedule is never started.

Standing tiers stay warm through feed messages. A feed message is ingestion-only: it gives the agent relevant completed work and explicitly asks for no response. The first version uses an everyone-hears-everything commit feed where appropriate; later scheduling can narrow this to plan-filtered delivery without changing the tier table.

Feed relevance comes from plan structure:

- `blocks` edges between vBRIEF items.
- `metadata.foundationFor` when a completed bead explicitly lays groundwork for later beads.
- `files_scope` overlap between the completed bead and upcoming beads.

During a run of unrelated trivial beads, expensive tiers receive no implementation work and may receive no feed, depending on subscription and relevance.

## Supervisor

The supervisor is event-driven. It receives commit events under its subscription policy and reviews the diff against the bead's acceptance criteria and traced requirements.

The supervisor can:

- Ack the commit.
- File a blocking finding that halts dependent dispatch.
- Ask for a replay or fresh review if its own session was recovered.

The supervisor cannot:

- Edit code.
- Claim or close beads.
- Merge branches.
- Replace the final review pipeline.

This generalizes the pull-based inspection model into a commit-boundary push model. The foreman still owns the wait point and routes any fix bead back through the deterministic tier table.

## Fast Track

Trivial mechanical work can use a fast path when the tier table maps `trivial` work to the foreman's own model and harness. In that case, the foreman may implement the bead directly instead of dispatching to a separate tier agent.

The trust boundary stays the same:

- The tier table, not the foreman, decides whether a bead is fast-track eligible.
- The bead must still be claimed, committed, closed, and fed through the same event path.
- Supervisor policy still applies to the resulting commit.
- Fast-track does not bypass scope checks, acceptance criteria, or review gates.

## Replay and Compaction

Replay is both crash recovery and the standing-session compaction strategy.

To replay a tier agent, the foreman respawns the registered session and re-delivers the tier's feed from durable sources: git history plus the plan schedule. To replay the supervisor, the foreman replays the commit events covered by the supervisor subscription policy.

Replay triggers:

- A standing tier or supervisor session crashes or is orphaned.
- A tier-run boundary is reached and the session is over `replay_threshold` of its model context window.

Replay does not try to salvage live context from the dead or overfull session. The durable feed is the source of truth.

## Operational Rules

- `enabled: false` is the default and must be safe.
- Every difficulty maps to exactly one tier.
- Tier and supervisor definitions must pass model, harness, and harness-policy validation before use.
- All foreman-to-agent messages use the normal agent delivery primitive.
- Tier agents are registered Overdeck agents, not one-shot harness executions.
- The foreman serializes v1 tiered execution; parallel-slot composition is deferred.

## Non-goals

- Per-tier commit filtering is deferred beyond the initial docs and schema work.
- The live cost pilot is deferred until the runtime path can emit per-agent feed and supervisor measurements.
- Remote tiers are deferred; v1 assumes local standing tier agents even though the config shape should not preclude future remote slots.
- Autonomous multi-model intervention is not part of the design. The router decides from config and bead metadata.
- Replacing the final review, test, or merge pipeline is not part of tiered execution.
