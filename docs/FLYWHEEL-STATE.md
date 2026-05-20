# Flywheel State

Durable cumulative memory across Flywheel orchestrator runs. Status snapshots are ephemeral and live in `~/.panopticon/flywheel/`; this file is for facts that future runs should not have to rediscover.

## Substrate fixes

### Autonomous planning auto-promote (commit 861cf8baa, 2026-05-20, RUN-1)

**Problem.** Planning agents finished `pan plan finalize` (writes workspace `.pan/spec.vbrief.json` with `plan.status: "proposed"` plus beads) and then stopped, waiting for a human to click "Done" in the dashboard or run `pan plan done`. `roles/plan.md` explicitly told them to wait for the user. Under an autonomous Flywheel run nothing ever clicks Done, so planning agents sit forever — observed with PAN-1228 through PAN-1234 stuck for ~5h at session start.

**Fix.** `pan plan finalize` now chains to the dashboard's `complete-planning` endpoint by default (`--no-promote` opts out for humans who genuinely want manual review). The route's tmux session kill is deferred via `setTimeout` so a chained call from inside the planning session itself sees its own success response before the pane dies. Role prompt updated to drop "wait for user Done" language.

**Why this matters.** The only required human input is the merge decision after UAT. Any earlier human gate is a substrate gap, not a feature.

## Recurring patterns to watch

### Deacon orphan-detection races new agent spawn (observed RUN-1 tick 2)

When `pan plan <id> --auto` (or any spawn route) creates an agent state directory and starts the tmux session, the Deacon's orphan-recovery patrol can fire before the tmux session is fully up and mark the agent `stopped` with reason "orphaned: tmux session missing at boot". The agent still runs to completion (verified — PAN-1235 planning finalized + auto-promoted despite state.json being marked stopped at spawn+0ms), but the dashboard and any consumers of agent state see a misleading "stopped" while the agent is actually running.

**Why it matters.** Cosmetic for now, but if any downstream system uses agent state as the source of truth for "should I restart this", it could double-spawn or skip restarts. PAN-1213 (synthesis→review-status bridge) is the same family of bug. Worth a dedicated fix that gates orphan-detection on a minimum age since `startedAt`.

**How to apply.** When you see "agent stopped immediately after spawn" but the workspace artifacts still appear, do not panic — check the actual artifacts (spec file, beads, commit log) rather than trusting state.json alone.

## Parked items

(none recorded yet — `needs-discussion` / `needs-design` labels are the canonical park signal; do not duplicate that state here unless there is something additional to remember about the rationale)

## Open questions for the human

(none recorded yet)
