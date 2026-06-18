# Flywheel

The Flywheel is Overdeck's singleton orchestrator for long-running, fix-all runs. It keeps PAN issues moving through the existing `plan`, `work`, `review`, `test`, and `ship` roles until each branch reaches the human merge gate.

The canonical skill entrypoint is `/pan-flywheel`, which wraps the `pan flywheel` CLI. Legacy invocations redirect there for one release only.

Read this with:

- [`flywheel-brief.md`](./flywheel-brief.md) — the operating contract the orchestrator reads at the start of every run.
- [`ROLES.md`](./ROLES.md) — the role taxonomy the Flywheel coordinates.
- [`../packages/contracts/src/flywheel.ts`](../packages/contracts/src/flywheel.ts) — the shared `FlywheelStatus` contract.

## Awaiting Merge UAT context

The Awaiting Merge page is the operator's human UAT gate. Each merge-ready card includes a collapsed **What to test / Expected changes** section sourced from `GET /api/workspaces/:issueId/uat-context`: vBRIEF acceptance criteria become the UAT checklist, vBRIEF deliverables describe the expected behavior change, and the workspace git diff supplies the changed-file summary. If vBRIEF or git data is unavailable, the card falls back to the issue description and a subtle "No file changes available" note instead of blanking the gate.

## Status vs State

The Flywheel produces two different artifacts. They are not interchangeable.

**Status** is the live snapshot of the current run. The orchestrator emits it every tick via `pan flywheel emit-status`. It is structured JSON validated against `FlywheelStatus`. Only the latest snapshot matters; the dashboard's **Status** tab renders it live and the CLI's `pan flywheel status` reads it back. Each run's snapshots persist at `${OVERDECK_HOME}/flywheel/runs/<runId>/latest.json`.

**State** is the durable cumulative memory across all runs. It lives at `docs/FLYWHEEL-STATE.md`, owned and edited by the orchestrator, plain markdown. Future runs read it before doing anything else. The dashboard's **State** tab renders it as markdown via `GET /api/flywheel/state`. The file does not exist before the first run that needs to record something durable; the orchestrator creates it.

`pan flywheel report` writes the per-run report at `${OVERDECK_HOME}/flywheel/runs/<runId>/report.md` and commits any orchestrator-authored changes to `docs/FLYWHEEL-STATE.md`. The CLI does not author State content — that is the orchestrator's job.

## Status contract

Every run emits `FlywheelStatus`, defined in [`packages/contracts/src/flywheel.ts`](../packages/contracts/src/flywheel.ts). The contract is the only shape the CLI, server, and dashboard should exchange for live Flywheel state.

The top-level fields are:

| Field | Meaning |
| --- | --- |
| `runId`, `startedAt`, `elapsedMs` | Run identity and elapsed wall-clock time. |
| `orchestrator` | Harness, model, effort, and context usage for the singleton orchestrator. |
| `headline` | Counts for bugs fixed, swarm items merged, PRs merged, and items awaiting UAT. |
| `activePipeline` | Issues currently moving through planning, work, review, test, ship, merge, blocked, or parked states. |
| `substrateBugs` | Overdeck infrastructure bugs found during orchestration. |
| `agents` | Role agents participating in the run, with issue, role, model, context, and current action when known. |
| `parked` | Issues the Flywheel cannot move without a concrete reason. |
| `system` | Main HEAD, RAM, swap, active-agent count, and agent cap. |
| `openQuestions` | Actionable human decisions only. |
| `ticks`, `lastTickAt` | Loop cadence metadata. |

To extend the contract:

1. Add the field or enum value to `packages/contracts/src/flywheel.ts`.
2. Add or update contract tests in `packages/contracts/src/flywheel.test.ts`.
3. Update every producer before relying on the new field in a consumer.
4. Update dashboard rendering and this document in the same change when operator behavior changes.

Do not add dashboard-only or CLI-only status fields. A status change starts in the shared contract, then moves outward.

## Reading the Stats panel

The dashboard's **Stats** tab and `pan flywheel stats` interpret the seven v1.0 readiness criteria from [`vision.mdx`](../vision.mdx#v10-readiness-criteria-draft). The default window is the most recent 30 days; CLI callers may override it with `--window <duration>`, but the v1.0 call is always based on 30 consecutive days. In-flight pipeline runs are excluded from denominators until they finish as merged, parked, or cancelled. Before at least three completed pipeline runs exist in the window, the panel reports insufficient data instead of classifying readiness.

| # | Criterion | Formula | Ready threshold |
| --- | --- | --- | --- |
| 1 | Substrate-bug discovery rate | `substrate bugs filed in window / completed pipeline runs in window` | `< 2%` (at most one substrate bug per 50 runs) |
| 2 | Critical/P0 substrate bugs | Count of substrate bugs with `P0` severity filed in the window | `0` |
| 3 | Pipeline pass success rate, substrate-attributable only | `1 - (substrate-attributable failed passes / total pipeline passes)` | `≥ 99%` |
| 4 | MTTR for filed substrate bugs | Median and p95 duration from substrate bug `filed_at` to `fix_merged_at` | Median `< 24h` and p95 `< 1 week` |
| 5 | Operator intervention rate per pipeline run | `operator intervention events / completed pipeline runs in window` | `< 5%` |
| 6 | Time-in-pipeline consistency by complexity bucket | For each bucket, `p95 completed-run duration / median completed-run duration` | Every populated bucket is `≤ 2×` |
| 7 | Flake rate on substrate-attributable failures | `substrate-attributable flakes / substrate-attributable review-or-test failures` | `< 5%` |

Criterion 3 and criterion 7 use the D13 substrate-attributable heuristic: a review or test failure counts as substrate-attributable only when a substrate bug is filed within 24 hours and its `Flywheel-Discovered-In` trailer points at the same issue. This is intentionally conservative; unfiled substrate failures are not inferred.

Criterion 6 uses the D12 complexity buckets captured at planning completion: `simple` is 1-3 beads, `medium` is 4-8 beads, and `complex` is 9 or more beads. Runs without a bead count are placed in `unbucketed` and excluded from criterion 6 while still counting for the other criteria.

Criterion 7 uses the H9 flake definition: a review or test check that passes on one cycle and fails on the next cycle in the same pipeline run with no intervening code commit, meaning the head SHA is unchanged. Failures after a new commit are treated as ordinary pass/fail outcomes, not flakes.

## Substrate-bug provenance

Substrate bug issues filed during a Flywheel run carry a trailer block at the bottom of the GitHub issue body:

```text
---
Flywheel-Run-Id: RUN-123
Flywheel-Filed-By: agent
Flywheel-Discovered-In: PAN-1487
```

`Flywheel-Run-Id` identifies the active Flywheel orchestrator run that exposed the bug. The hook only injects the block when the run id matches the canonical `RUN-<number>` form.

`Flywheel-Filed-By` is `agent` only when the singleton `flywheel-orchestrator` files the issue itself. Work, plan, review, test, ship, and operator-requested issue creation are recorded as `operator` because a human or non-Flywheel role decided to file the record.

`Flywheel-Discovered-In` names the pipeline issue whose run exposed the substrate bug. It is resolved from the filing agent's Overdeck state at `${OVERDECK_HOME}/agents/<agent-id>/state.json`; the line is omitted when no issue id is available.

The `gh-issue-trailer-hook` Claude Code PreToolUse Bash hook injects the trailer into `gh issue create` calls before later Bash filters run. It handles inline `--body`, `--body-file <path>`, and `--body-file -` stdin bodies, and it leaves commands unchanged when a `Flywheel-Run-Id:` line already exists.

Telemetry consumes these trailers as the bridge between GitHub issues and local Flywheel stats. The substrate-bug poller reads candidate GitHub issues, parses the trailer block, stores each issue in the substrate-bug projection, and uses `Flywheel-Discovered-In` for substrate-attributable failure metrics.

## Lifecycle

The Flywheel lifecycle is exposed as `pan flywheel` commands and mirrored by dashboard routes.

| Command | Purpose |
| --- | --- |
| `pan flywheel start` | Starts the singleton orchestrator for a configured scope and brief. |
| `pan flywheel pause` | Stops the loop from launching more work while preserving run state. |
| `pan flywheel resume` | Continues a paused run from its saved state. |
| `pan flywheel status` | Reads the latest `FlywheelStatus` snapshot. |
| `pan flywheel emit-status --file <json>` | Validates and writes a status snapshot from the orchestrator. |
| `pan flywheel report` | Writes the per-run report under the run directory and commits any pending changes to `docs/FLYWHEEL-STATE.md`. |

Cloister owns the singleton gate. Only one Flywheel run may be active for a Overdeck home at a time. If a second start request arrives, it should fail with a clear active-run response instead of spawning a competing orchestrator. Pause and resume operate on that same saved run record, not on a new run.

For local stack startup, Deacon/Cloister should be running before starting or resuming the Flywheel; see [`OVERDECK_DEV_SOP.md`](./OVERDECK_DEV_SOP.md#deacon-and-flywheel-startup-order).

Run artifacts live under the Flywheel home:

```text
${OVERDECK_HOME:-~/.overdeck}/flywheel/runs/<RUN-ID>/
  latest.json      # latest validated FlywheelStatus
  report.md        # end-of-run report, when complete
  opened-pr.json   # optional merge/report metadata
  aborted.json     # present when the run ended early
```

Status writes must be atomic. Write a temporary file in the run directory, then rename it over `latest.json`.

## Merge: UAT batch trains

While a run is active and `flywheel.merge_train_enabled` is on, merge-ready
features don't wait in a queue for one-at-a-time human merges. A 60-second
reconciler assembles them into rolling **UAT batch trains** — throwaway `uat/*`
branches off main that bundle as many ready features as possible, resolving
cross-feature conflicts inside the batch, so a human can UAT the combined result
and **promote the batch** (merge exactly what they tested) in one action. Each
generation can serve a live stack at `uat-<codename>.pan.localhost`.

This is the primary merge path for a flywheel run; the per-issue merge (see
[`MERGE-WORKFLOW.md`](./MERGE-WORKFLOW.md)) remains the escape hatch. The full
model — generations, the assembly agent, held-out features, promotion, the live
stacks (max 2), and the "UAT batches" card — is documented in
[`UAT-BATCH-TRAINS.md`](./UAT-BATCH-TRAINS.md). Batch trains are inert until the
merge-train flag is on and a run is active; the ready set is computed from the
merge queue (`computeMergeQueue`, gated on `MERGE_GATE_VERBS = {shipping,
merging}` per [PAN-1736](https://github.com/eltmon/overdeck/issues/1736)).

## Settings → Roles → Flywheel

The Flywheel row in Settings → Roles controls the singleton orchestrator, not the role agents it launches. The role agents keep their own `plan`, `work`, `review`, `test`, and `ship` settings.

| Field | Effect |
| --- | --- |
| Harness | Selects the runtime used by the orchestrator. `claude-code` is the default; `pi` is available where project policy allows it. |
| Model | Selects the model or workhorse slot for the orchestrator's reasoning loop. This should usually be stronger than a worker default because it makes prioritization and recovery decisions. |
| Effort | Sets the reasoning budget for each loop tick. Use higher effort for unattended fix-all runs and lower effort for short, supervised runs. |
| Max agents | Sets the orchestrator's active-agent budget. The value is reflected in `FlywheelStatus.system.agentsCap`. |
| Scope | Chooses whether the run stays on PAN issues or includes every tracked project. `pan-only` is the default. |

Changing the Flywheel row affects future starts. It must not mutate already-saved run artifacts.

## Brief authoring

A brief is a markdown operating contract for a Flywheel run. It should be specific enough that the orchestrator can act without asking for routine direction, but narrow enough that it does not bypass Overdeck's pipeline.

A useful brief includes:

1. Source material to read before the first tick.
2. Scope: projects, issue prefixes, priorities, and exclusions.
3. Priority rules for choosing the next issue.
4. The substrate-fix rule: broken Overdeck behavior must be fixed at the root cause.
5. Human-input policy: the expected human gate is merge approval after UAT.
6. Status requirements: which facts must appear in each `FlywheelStatus` snapshot.
7. End-of-run report requirements.

The default brief lives at [`docs/flywheel-brief.md`](./flywheel-brief.md). Custom brief paths must stay inside the project root. The brief API rejects absolute or relative paths that escape the repository.

Do not put secrets, machine-local paths, or one-time session state in a brief. Put durable operating rules in the brief and transient run state in the Flywheel run directory.

## Skill → CLI → API → UI map

| Layer | Surface | Responsibility |
| --- | --- | --- |
| Skill | `/pan-flywheel` | Loads the operator guidance and tells Claude Code to use the canonical `pan flywheel` commands. |
| CLI | `pan flywheel start [--brief <path>]` | Validates the brief path, creates a run ID, spawns the `flywheel-orchestrator`, and writes the first `latest.json`. |
| CLI | `pan flywheel emit-status --file <json>` | Validates a `FlywheelStatus` payload and publishes it to the dashboard status endpoint. |
| CLI | `pan flywheel status [--json]` | Reads the active run's latest status snapshot from the run directory. |
| CLI | `pan flywheel pause` / `pan flywheel resume` | Toggles the singleton gate for the active orchestrator. |
| CLI | `pan flywheel report` | Writes the per-run `report.md` under the run directory and commits any orchestrator-authored changes to `docs/FLYWHEEL-STATE.md`. |
| API | `GET /api/flywheel/state` | Reads `docs/FLYWHEEL-STATE.md` for the dashboard State tab. Returns `{ exists: false }` before the first orchestrator write. |
| API | `GET /api/flywheel/runs` | Lists run summaries for the sidebar live badge and Flywheel page. |
| API | `GET /api/flywheel/runs/:id` | Returns a run detail plus its latest validated status snapshot. |
| API | `GET /api/flywheel/brief` / `POST /api/flywheel/brief` | Reads and updates the markdown brief, constrained to paths inside the project root. |
| API | `GET /api/flywheel/uat-generations` | UAT batch-train chain (members + per-member acceptance criteria, held-out, resolutions, live-stack status). `[]` when no run is active. See [`UAT-BATCH-TRAINS.md`](./UAT-BATCH-TRAINS.md). |
| API | `POST /api/flywheel/uat-generations/:name/stack` | Ensures a generation's live UAT stack (max 2 concurrent). |
| API | `POST /api/flywheel/uat-generations/:name/promote` | Promotes (merges) a tested generation to main. |
| API | `POST /api/flywheel/assemble-uat` | Forces a reconcile/rebuild of the current generation. |
| API | `GET /api/flywheel/merge-queue` / `POST /api/flywheel/merge-next` | The ready set (reference) and the single-feature merge escape hatch. |
| UI | `/flywheel` | Two-pane layout. Left pane has **Status**, **Stats**, and **State** tabs. Right pane is the orchestrator conversation. |
| UI | `/flywheel` → Status tab | Renders the live `FlywheelStatus` snapshot via `subscribeFlywheelStatus`. Default tab. |
| UI | `/flywheel` → Stats tab | Renders the rolling-window readiness metrics for the seven v1.0 criteria. |
| UI | `/flywheel` → State tab | Renders `docs/FLYWHEEL-STATE.md` as markdown. |
| UI | Sidebar Flywheel item | Opens `/flywheel` and shows a live badge when a run summary reports `status: running`. |
| UI | Settings → Roles → Flywheel | Edits the orchestrator model, harness, effort, max-agent budget, and scope for future starts. |

The legacy skill described a manual operating loop for pushing many Overdeck issues forward. The Flywheel turns that loop into a product surface:

- The brief replaces ad hoc prompt text.
- `FlywheelStatus` replaces prose-only progress updates.
- The singleton gate prevents competing orchestrators.
- Run artifacts make pause, resume, report, and debugging repeatable.
- Dashboard panes expose active pipeline, substrate bugs, agents, system health, parked items, open questions, transcript, and run configuration.

The operating principle stays the same: use Overdeck to fix Overdeck. When the Flywheel finds a broken route, gate, prompt, workspace setup, status update, or recovery path, it fixes the substrate instead of working around it.
