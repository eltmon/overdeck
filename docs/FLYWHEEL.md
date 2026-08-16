# Flywheel

The Flywheel is Overdeck's singleton orchestrator for long-running, fix-all runs. It keeps PAN issues moving through the existing `plan`, `work`, `review`, `test`, and `ship` roles until each branch reaches the human merge gate.

The canonical skill entrypoint is `/pan-flywheel`, which wraps the `pan flywheel` CLI. Legacy invocations redirect there for one release only.

Read this with:

- [`flywheel-brief.md`](./flywheel-brief.md) — the operating contract the orchestrator reads at the start of every run.
- [`ROLES.md`](./ROLES.md) — the role taxonomy the Flywheel coordinates.
- [`ORDER-BOOKS.md`](./ORDER-BOOKS.md) — first-class operator campaigns, lane enforcement, drain detection, and continuation.
- [`../packages/contracts/src/flywheel.ts`](../packages/contracts/src/flywheel.ts) — the shared `FlywheelStatus` contract.

## Awaiting Merge UAT context

The Awaiting Merge page is the operator's human UAT gate. Each merge-ready card includes a collapsed **What to test / Expected changes** section sourced from `GET /api/workspaces/:issueId/uat-context`: xBRIEF acceptance criteria become the UAT checklist, xBRIEF deliverables describe the expected behavior change, and the workspace git diff supplies the changed-file summary. If xBRIEF or git data is unavailable, the card falls back to the issue description and a subtle "No file changes available" note instead of blanking the gate.

## Status vs State

The Flywheel produces two different artifacts. They are not interchangeable.

**Status** is the live snapshot of the current run. The orchestrator emits it every tick via `pan flywheel emit-status`. It is structured JSON validated against `FlywheelStatus`. Only the latest snapshot matters; the dashboard's **Status** tab renders it live and the CLI's `pan flywheel status` reads it back. Each run's snapshots persist at `${OVERDECK_HOME}/flywheel/runs/<runId>/latest.json`.

**State** is the durable cumulative memory across all runs. It lives at `docs/FLYWHEEL-STATE.md`, owned and edited by the orchestrator, plain markdown. Future runs read it before doing anything else. The dashboard's **State** tab renders it as markdown via `GET /api/flywheel/state`. The file does not exist before the first run that needs to record something durable; the orchestrator creates it.

`pan flywheel report` writes the per-run report at `${OVERDECK_HOME}/flywheel/runs/<runId>/report.md` and commits any orchestrator-authored changes to `docs/FLYWHEEL-STATE.md`. Before committing, it enforces State retention whenever the file exceeds 1,000 lines or 120 KiB: the curated Substrate fixes, Recurring patterns, Cross-run operational gotchas, and Parked items sections plus the latest three runs remain verbatim, while older run detail becomes one terse line per run. The original detail remains in git history; compaction changes only the working copy.

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
| `orders` | Optional bound order-book identity, progress, lane occupancy, and mechanical drained state. |
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
Flywheel-Affects-Criterion: 1,4
```

`Flywheel-Run-Id` identifies the active Flywheel orchestrator run that exposed the bug. The hook only injects the block when the run id matches the canonical `RUN-<number>` form.

`Flywheel-Filed-By` is `agent` only when the singleton `flywheel-orchestrator` files the issue itself. Work, plan, review, test, ship, and operator-requested issue creation are recorded as `operator` because a human or non-Flywheel role decided to file the record.

`Flywheel-Discovered-In` names the pipeline issue whose run exposed the substrate bug. It is resolved from the filing agent's Overdeck state at `${OVERDECK_HOME}/agents/<agent-id>/state.json`; the line is omitted when no issue id is available.

`Flywheel-Affects-Criterion` is an optional, author-supplied line naming the v1.0 readiness criterion (or criteria) the bug degrades. Use the criterion numbers from **Reading the Stats panel** above (1–7), comma-separated. Add this line when the affected criterion is known; omit it when the impact is unclear. The dashboard and `pan flywheel weights` use this line to compute a weight for the bug so the bottleneck criterion rises in the suggestion order.

The `gh-issue-trailer-hook` Claude Code PreToolUse Bash hook injects the provenance lines (`Flywheel-Run-Id`, `Flywheel-Filed-By`, and `Flywheel-Discovered-In`) into `gh issue create` calls before later Bash filters run. It handles inline `--body`, `--body-file <path>`, and `--body-file -` stdin bodies, and it leaves commands unchanged when a `Flywheel-Run-Id:` line already exists. `Flywheel-Affects-Criterion` is semantic and must be supplied by the filer in the issue body; the hook does not derive it from environment variables.

Telemetry consumes these trailers as the bridge between GitHub issues and local Flywheel stats. The substrate-bug poller reads candidate GitHub issues, parses the trailer block, stores each issue in the substrate-bug projection, and uses `Flywheel-Discovered-In` for substrate-attributable failure metrics. `Flywheel-Affects-Criterion` feeds the weight model described below.

## Metric-aware prioritization

Substrate bugs are not all equally urgent: a bug that degrades a v1.0 criterion currently in the red is a bigger blocker than one that touches a green criterion. The Flywheel ranks substrate-bug suggestions within the substrate-hardening tier using a numeric **weight** derived from the bug's declared affected criteria and the latest telemetry.

A substrate bug declares affected criteria with the `Flywheel-Affects-Criterion: N[,M]` trailer line documented above, using the criterion numbers from **Reading the Stats panel** (1–7). Labels of the form `affects-criterion-N` are also accepted as a fallback.

The weight formula is intentionally simple:

- For each affected criterion, if the latest 30-day telemetry shows that criterion as **red** (failing its ready threshold), the bug gets a large status-driven bonus.
- If the criterion is **yellow** (close to threshold), it gets a smaller bonus.
- Green criteria contribute no bonus.
- When telemetry is **insufficient** for a criterion, that criterion contributes zero.
- Each criterion also contributes its normalized current-value distance from target, so a criterion farther from readiness ranks above a closer criterion with the same status.

The result is a single number (`weight`) and a human-readable `weightReason` such as `Criterion 4 (MTTR) is red`. The orchestrator runs `pan flywheel weights --json` each tick, keeps operator-filed bugs first, and then orders each filing-source group by weight descending; equal weights use the oldest filing time first. Higher-weight bugs are surfaced first within their filing-source group, but weight **only re-orders within the tier** — it never overrides red-main/P0 work or filters or displaces operator-injected items.

`pan flywheel weights [--window <dur>] [--issue <id>] [--json]` is the sandbox-safe CLI surface for the same data the dashboard uses. Without `--json` it prints a table; with `--json` it emits the full weighted rows. The dashboard renders the weight as a badge on each substrate-bug suggestion in the Status panel, alongside the `weightReason`, and sorts by operator precedence, then priority, then weight.

The dashboard HTTP endpoint `GET /api/flywheel/substrate-bug-weights` requires dashboard authentication and accepts the same `?window=<dur>` duration grammar as the CLI. Omitted, malformed, or non-positive values fall back to `30d`; valid values longer than **365 days** are canonicalized to `365d` before entering the shared database-worker queue, while shorter values retain their normalized duration. The service independently enforces the same 365-day cap as defense in depth.

## Lifecycle

The Flywheel lifecycle is exposed as `pan flywheel` commands and mirrored by dashboard routes.

| Command | Purpose |
| --- | --- |
| `pan flywheel start` | Starts the singleton orchestrator for a configured scope and brief. Add `--orders <book-id>` to bind a ready order book. |
| `pan flywheel pause` | Stops the loop from launching more work while preserving run state. |
| `pan flywheel resume` | Continues a paused run from its saved state. |
| `pan flywheel status` | Reads the latest `FlywheelStatus` snapshot. |
| `pan flywheel emit-status --file <json>` | Validates and writes a status snapshot from the orchestrator. |
| `pan flywheel complete` | Finalizes a drained orders-bound run, writes its report and retrospective result, then starts the next ready book or backlog mode when configured. |
| `pan flywheel report` | Writes the per-run report, compacts over-threshold State to curated sections + three verbatim runs + one-line older runs, then commits `docs/FLYWHEEL-STATE.md`. |

Cloister owns the singleton gate. Only one Flywheel run may be active for a Overdeck home at a time. If a second start request arrives, it should fail with a clear active-run response instead of spawning a competing orchestrator. Pause and resume operate on that same saved run record, not on a new run.

### Autonomous planning permission and staffing

The reactive lifecycle scheduler treats permission and staffing as separate operator controls. With `flywheel.auto_pickup_backlog` off, an issue in stale `in_planning` state receives no autonomous planning spawn unless it has the case-insensitive `released` label; enabling auto-pickup grants that permission. Parked, vetoed, and objection labels still block dispatch, and unavailable tracker labels fail closed. A refusal emits a warning and a durable needs-you trip instead of silently starting work.

After permission passes, the scheduler reuses a model recorded on the current or legacy planning agent, then tries the optional scalar `roles.plan.autonomousModel`. If neither resolves, it records a needs-you refusal; it never falls through to the ordinary `roles.plan.model`. The operator can authorize autonomous planning by fixing the labels or pickup posture and configure its staffing with `roles.plan.autonomousModel`, or bypass this autonomous path deliberately with `pan plan`.

### Autonomous work pickup

The orphan-proposed reconciler and reactive lifecycle work dispatch use the same fail-closed pickup predicate as Flywheel backlog pickup. The issue must be ready and planned, and release must come from a case-insensitive `released` label, `flywheel.auto_pickup_backlog`, active order-book membership, or the planning session's persisted auto-start consent flag. `parked` (including the legacy `needs-design` and `needs-discussion` forms), `vetoed`, `objection`, and `epic` always block work dispatch.

Planning consent is current-cycle and one-shot: every planning launch writes a new generation, and an explicit `autoSpawn: false` invalidates it. The pickup decision records which release source authorized work, preferring the `released` label, auto-pickup, and active order-book membership before planning consent. Only a launch authorized by planning consent must durably claim that generation; other valid release sources never inspect the optional consent record, so corruption there cannot veto them. Explicit operator CLI and dashboard starts also bypass the consent record because the operator action is itself the release authority. A consent-backed launch that loses a claim race or finds the generation spent fails closed instead of starting unclaimed. If it fails before creating its local or remote tmux session, it releases the claim; once tmux accepts the session, the claim becomes spent immediately, so later runtime-state, daemon, watchdog, or kickoff setup failures cannot make the same consent reusable. Merely queueing container startup does not claim consent because the delayed `pan start` owns the launch boundary. Per-issue file locking and generation checks prevent an older completion or rollback from overwriting consent granted by a newer planning cycle. Consent does not waive readiness or any blocker. If tracker labels are unavailable, the predicate refuses the dispatch. Refusals create a durable needs-you trip; reactive dispatch also emits one warning, while the patrol-based orphan reconciler persists only a changed refusal reason instead of writing the same trip on every patrol.

For local stack startup, Deacon/Cloister should be running before starting or resuming the Flywheel; see [`OVERDECK_DEV_SOP.md`](./OVERDECK_DEV_SOP.md#deacon-and-flywheel-startup-order).

Run artifacts live under the Flywheel home:

```text
${OVERDECK_HOME:-~/.overdeck}/flywheel/runs/<RUN-ID>/
  latest.json             # latest validated FlywheelStatus
  report.md               # end-of-run report, when complete
  retro.md                # optional recognized improvements for an orders-bound run
  orders-overrides.jsonl  # audited --off-book dispatches, when used
  opened-pr.json          # optional merge/report metadata
  aborted.json            # present when the run ended early
```

Status writes must be atomic. Write a temporary file in the run directory, then rename it over `latest.json`.

## Scheduled auto-merge recovery

The auto-merge executor rechecks eligibility when a scheduled row becomes due,
then records one of three outcomes:

- **Requeue:** A transient merge-preparation failure returns `retryable: true`,
  including a missing local workspace, a non-conflict rebase failure, or an
  agent that stops or times out before pushing. The executor increments
  `mergeRetryCount`, moves the row back to `pending`, and schedules it 60
  seconds later. The issue keeps its earned review, test, and verification
  verdicts because the failure does not invalidate the reviewed HEAD.
- **Failed:** A content failure, such as red required CI, a closed or draft PR,
  or unresolved conflicts, marks the scheduled merge `failed`. The executor
  does not retry code or repository-state failures automatically.
- **Blocked:** After `FAILED_MERGE_MAX_RETRIES` transient attempts, the circuit
  breaker marks the row `blocked` and announces the retry count. Fix the
  underlying cause, then schedule auto-merge again; restarting a work agent is
  unnecessary when the reviewed HEAD has not changed.

### Reconciliation

Failed and blocked rows aren't permanent residue. On each Deacon patrol, the
reconciler marks them `merged` when the forge confirms that their PR or MR
merged by another path, and cancels all actionable rows for an issue whose
durable record says close-out completed. Forge checks are throttled per issue
for ten minutes after an unmerged result or lookup failure. `pan merge cancel
<id>` clears one actionable row per invocation; when duplicates remain, its
success message reports their count and tells the operator to run it again.

The requeue path uses the same merge executor described in
[`MERGE-WORKFLOW.md`](./MERGE-WORKFLOW.md): GitHub-clean PRs merge directly,
branches that are behind use the server-side rebase first, and only conflicts
escalate to a work agent.

## Merge: UAT batch trains

When a project's merge train is on, merge-ready features don't wait in a queue for
one-at-a-time human merges. A 60-second
reconciler assembles them into rolling **UAT batch trains** — throwaway `uat/*`
branches off main that bundle as many ready features as possible, resolving
cross-feature conflicts inside the batch, so a human can UAT the combined result
and **promote the batch** (merge exactly what they tested) in one action. Each
generation can serve a live stack at `uat-<codename>.overdeck.localhost`.

This is the primary merge path; the per-issue merge (see
[`MERGE-WORKFLOW.md`](./MERGE-WORKFLOW.md)) remains the escape hatch. The full
model — generations, the assembly agent, held-out features, promotion, the live
stacks (max 2), and the multi-project view — is documented in
[`UAT-BATCH-TRAINS.md`](./UAT-BATCH-TRAINS.md). Batch trains are inert until a
project's effective merge-train flag is on; the ready set comes from that
project's review-status records, so **no flywheel run is required**
([PAN-1696](https://github.com/eltmon/overdeck/issues/1696)).

The merge train is actionable only for merge-eligible issues: its rows render only when
canonical pipeline membership is `in_flight`. The merge-next endpoint revalidates the
selected head server-side immediately before shipping. If membership changed or needs
disposition, it returns HTTP `409` with the disposition reason and merges nothing.

### Orchestrator scope vs merge-train independence

Two things are easy to conflate, so state them separately:

- **Flywheel `scope`** decides **which projects the orchestrator inventories and
  dispatches into** — `pan-only`, or `all-tracked-projects`. Nothing else. It is
  baked into the run prompt at start or resume, so changing it mid-run does not
  reach the running orchestrator until the next start or resume; the run record
  and the Flywheel pane show the value the run is actually operating under.
- **Merge and UAT trains are per project and independent of that scope.** A
  project's train assembles from its own review-status ready set whenever its
  effective `merge_train` flag is on — whether or not the current run's scope
  includes that project, and whether or not a run exists at all. The orchestrator
  observes trains and reports them; it never gates or adopts one.

**Cross-project batches remain out of scope.** A generation always contains exactly
one project's work; only the view and control surface spans projects (one section
per project on Awaiting Merge, with the Flywheel rail as a second viewer).

## Settings → Roles → Flywheel

The Flywheel row in Settings → Roles controls the singleton orchestrator, not the role agents it launches. The role agents keep their own `plan`, `work`, `review`, `test`, and `ship` settings.

| Field | Effect |
| --- | --- |
| Harness | Selects the runtime used by the orchestrator. `claude-code` is the default; `pi` is available where project policy allows it. |
| Model | Selects the model or workhorse slot for the orchestrator's reasoning loop. This should usually be stronger than a worker default because it makes prioritization and recovery decisions. |
| Effort | Sets the reasoning budget for each loop tick. Use higher effort for unattended fix-all runs and lower effort for short, supervised runs. |
| Max agents | Sets the orchestrator's active-agent budget. The value is reflected in `FlywheelStatus.system.agentsCap`. |
| Scope | Chooses whether the run stays on PAN issues or includes every tracked project. `pan-only` is the default. This is the **orchestrator's** scope only — it does not enable or gate any project's merge train (see above). Unlike the other fields, a scope change applies at the next run **start or resume**, not on the next tick. |

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

## Prompt-regression protection

`roles/flywheel.md` and `docs/flywheel-brief.md` are load-bearing safety surfaces: the author/assignee gate, the `vetoed`-is-absolute rule, the saturation cap, and the `auto_pickup_backlog` switch exist only in prose. The following protection is in place to catch accidental prompt drift:

- **Deterministic rail tests** in [`tests/unit/evals/prompt-rails.test.ts`](../tests/unit/evals/prompt-rails.test.ts) assert the load-bearing text is still present and run in the default `npm test` path.
- **Live-model golden-scenario evals** in [`evals/flywheel-launch.eval.ts`](../evals/flywheel-launch.eval.ts) verify the role still produces launch decisions (not just reports) given fixture board states, including the author-gate negative case. They require `OVERDECK_EVAL_MODEL` and do not run in blocking CI.
- **CI prompt gate** — any PR that diffs `roles/*.md` or `docs/flywheel-brief.md` must include a `Prompt-Change:` trailer in at least one commit. The check is enforced by [`scripts/check-prompt-change-trailer.sh`](../scripts/check-prompt-change-trailer.sh) via the `prompt-gate` CI job and `npm run lint`.

When you change flywheel doctrine, update the rail tests and add a `Prompt-Change:` trailer explaining the behavioral impact. Do not rely on prose alone to preserve safety behavior across edits.

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
