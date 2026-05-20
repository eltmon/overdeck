# Flywheel

The Flywheel is Panopticon's singleton orchestrator for long-running, fix-all runs. It keeps PAN issues moving through the existing `plan`, `work`, `review`, `test`, and `ship` roles until each branch reaches the human merge gate.

The canonical skill entrypoint is `/pan-flywheel`, which wraps the `pan flywheel` CLI. Legacy invocations redirect there for one release only.

Read this with:

- [`flywheel-brief.md`](./flywheel-brief.md) — the operating contract the orchestrator reads at the start of every run.
- [`ROLES.md`](./ROLES.md) — the role taxonomy the Flywheel coordinates.
- [`../packages/contracts/src/flywheel.ts`](../packages/contracts/src/flywheel.ts) — the shared `FlywheelStatus` contract.

## Status vs State

The Flywheel produces two different artifacts. They are not interchangeable.

**Status** is the live snapshot of the current run. The orchestrator emits it every tick via `pan flywheel emit-status`. It is structured JSON validated against `FlywheelStatus`. Only the latest snapshot matters; the dashboard's **Status** tab renders it live and the CLI's `pan flywheel status` reads it back. Each run's snapshots persist at `${PANOPTICON_HOME}/flywheel/runs/<runId>/latest.json`.

**State** is the durable cumulative memory across all runs. It lives at `docs/FLYWHEEL-STATE.md`, owned and edited by the orchestrator, plain markdown. Future runs read it before doing anything else. The dashboard's **State** tab renders it as markdown via `GET /api/flywheel/state`. The file does not exist before the first run that needs to record something durable; the orchestrator creates it.

`pan flywheel report` writes the per-run report at `${PANOPTICON_HOME}/flywheel/runs/<runId>/report.md` and commits any orchestrator-authored changes to `docs/FLYWHEEL-STATE.md`. The CLI does not author State content — that is the orchestrator's job.

## Status contract

Every run emits `FlywheelStatus`, defined in [`packages/contracts/src/flywheel.ts`](../packages/contracts/src/flywheel.ts). The contract is the only shape the CLI, server, and dashboard should exchange for live Flywheel state.

The top-level fields are:

| Field | Meaning |
| --- | --- |
| `runId`, `startedAt`, `elapsedMs` | Run identity and elapsed wall-clock time. |
| `orchestrator` | Harness, model, effort, and context usage for the singleton orchestrator. |
| `headline` | Counts for bugs fixed, swarm items merged, PRs merged, and items awaiting UAT. |
| `activePipeline` | Issues currently moving through planning, work, review, test, ship, merge, blocked, or parked states. |
| `substrateBugs` | Panopticon infrastructure bugs found during orchestration. |
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

Cloister owns the singleton gate. Only one Flywheel run may be active for a Panopticon home at a time. If a second start request arrives, it should fail with a clear active-run response instead of spawning a competing orchestrator. Pause and resume operate on that same saved run record, not on a new run.

Run artifacts live under the Flywheel home:

```text
${PANOPTICON_HOME:-~/.panopticon}/flywheel/runs/<RUN-ID>/
  latest.json      # latest validated FlywheelStatus
  report.md        # end-of-run report, when complete
  opened-pr.json   # optional merge/report metadata
  aborted.json     # present when the run ended early
```

Status writes must be atomic. Write a temporary file in the run directory, then rename it over `latest.json`.

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

A brief is a markdown operating contract for a Flywheel run. It should be specific enough that the orchestrator can act without asking for routine direction, but narrow enough that it does not bypass Panopticon's pipeline.

A useful brief includes:

1. Source material to read before the first tick.
2. Scope: projects, issue prefixes, priorities, and exclusions.
3. Priority rules for choosing the next issue.
4. The substrate-fix rule: broken Panopticon behavior must be fixed at the root cause.
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
| UI | `/flywheel` | Two-pane layout. Left pane has **Status** and **State** tabs. Right pane is the orchestrator conversation. |
| UI | `/flywheel` → Status tab | Renders the live `FlywheelStatus` snapshot via `subscribeFlywheelStatus`. Default tab. |
| UI | `/flywheel` → State tab | Renders `docs/FLYWHEEL-STATE.md` as markdown. |
| UI | Sidebar Flywheel item | Opens `/flywheel` and shows a live badge when a run summary reports `status: running`. |
| UI | Settings → Roles → Flywheel | Edits the orchestrator model, harness, effort, max-agent budget, and scope for future starts. |

The legacy skill described a manual operating loop for pushing many Panopticon issues forward. The Flywheel turns that loop into a product surface:

- The brief replaces ad hoc prompt text.
- `FlywheelStatus` replaces prose-only progress updates.
- The singleton gate prevents competing orchestrators.
- Run artifacts make pause, resume, report, and debugging repeatable.
- Dashboard panes expose active pipeline, substrate bugs, agents, system health, parked items, open questions, transcript, and run configuration.

The operating principle stays the same: use Panopticon to fix Panopticon. When the Flywheel finds a broken route, gate, prompt, workspace setup, status update, or recovery path, it fixes the substrate instead of working around it.
