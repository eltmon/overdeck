# The Flywheel

The Flywheel is the `/pan-flywheel` loop skill running in one operator conversation, `conv-flywheel`. It ticks the backlog and order books, launches work with `pan start`, watches each PR to landing, and parks what it cannot decide. There is no daemon and no run record.

PAN-3917 cut the Flywheel page and its `pause`/`resume`/`abort`/`report`/`stats` verbs along with the stored run records. PAN-3964 brought the page and the verbs back as a **derived view**: every status the page shows is computed when it is read, from sources that already exist. Nothing new is stored in SQLite. The only files are the loop's own `.pan/flywheel/state.md` and `.pan/flywheel/report.md`.

`pan flywheel status`, `GET /api/flywheel/status`, and the page all call the same function, `deriveFlywheelStatus()` in `src/lib/flywheel/derive-status.ts`, so the CLI and the page show the same answer.

## Sources

| What you see | Where it comes from | Code |
| --- | --- | --- |
| Run state: `running`, `paused`, `idle` | The `conv-flywheel` row in the `conversations` table and whether its tmux session is alive. `running` means the row is `active`, not mid-fork, and the session is up. `paused` means a row exists but is not running. `idle` means there is no row. | `readFlywheelRun()` |
| Last tick, pick, phase, needs-you | The newest **assistant** message in the conversation's transcript that contains a tick marker. Its `createdAt` is the tick time. | `findLastTick()`, `parseTickMarker()` |
| Freshness | The age of the last tick: 60 seconds or less is `live`, 20 minutes or less is `breathing`, and anything older is `stalled`. | `freshnessFor()` |
| In-flight issues | The project's `workspaces/feature-*` directories (slot workspaces excluded), their derived issue state (`loadIssueStatesForProject`), and the last entry of each `<workspace>/.overdeck/pipeline.jsonl`. | `deriveFlywheelStatus()` |
| Policies | The control settings `auto_pickup_backlog`, `require_uat_before_merge`, and `merge_train_enabled`. | `control-settings.ts` |
| Order book | The `running` book under the plan home's `.pan/orders/`, with landed/total from `computeBookProgress`. | `listBooks()` |
| State tab | `<planHome>/.pan/flywheel/state.md` | `readFlywheelStateFile()` |
| Report | `<planHome>/.pan/flywheel/report.md` | `readFlywheelReportFile()` |
| Stats tab | Tracker issues labelled `substrate-improvement` (`gh issue list`, cached for 60 seconds) and merged PRs from `listRepoPullRequests`. | `computeSubstrateStats()` |
| Pending auto-merges | The merge train's cooldown queue, `GET /api/merge-train/auto-merge/pending`. | `merge-train.ts` |

The flywheel works on the project that contains its conversation's `cwd`. When no flywheel conversation exists, it uses the dashboard's working directory. The **plan home** is `resolvePlanHome(projectRoot)`.

When the status fetch fails, the page shows "Can't reach the server — retrying". It never shows `idle` for a failed read.

## Tick marker contract

The skill ends every tick by printing one line:

```text
flywheel-tick: tick=3 pick=PAN-3964 phase=watch in-flight=PAN-3964,PAN-3920 needs-you=none
```

| Key | Value |
| --- | --- |
| `tick` | A counter that starts at 1 for this conversation. A line without a numeric tick is ignored. |
| `pick` | The issue the tick picked, or `none` (parsed as `null`). |
| `phase` | One of `orient`, `pick`, `launch`, `watch`, `park`, `idle`, `stopping`. An unknown value is parsed as `watch`. |
| `in-flight` | Comma-separated issue ids, or `none` (parsed as `[]`). |
| `needs-you` | Free text for the operator, or `none` (parsed as `null`). It is always the last key and takes the rest of the line, so it may contain spaces and `=`. |

`formatTickMarker` and `parseTickMarker` live in `src/lib/flywheel/tick-marker.ts`. When a message contains more than one marker, the last one wins. User messages are ignored: the stop and report requests contain a marker template, and the skill's own example appears in a user turn when the slash command expands.

The marker is the only status the loop reports. There is no `POST /api/flywheel/status`.

## `.pan/flywheel/` files

| File | Contents | Written by | Committed as |
| --- | --- | --- | --- |
| `state.md` | The loop's memory across runs: the substrate fixes it drove and learnings worth keeping. New entries are appended. It holds no run ids, counters, or pipeline states. | The loop, whenever a tick produces a fix or a learning. | `chore(workspace): flywheel state`, then pushed |
| `report.md` | What shipped, what is in flight, what is parked, and the substrate fixes from this run. Each write replaces the previous report; git history keeps the old ones. | The loop, on `stop` or `report`. | `chore(workspace): flywheel report`, then pushed |

The dashboard and the CLI only read these files. Path traversal outside the plan home throws. The legacy `flywheel-orchestrator` commit and push guards allow `.pan/flywheel/`.

## Verb → route → view

| Verb | Route | Page control | Action |
| --- | --- | --- | --- |
| `pan flywheel start [--orders <id>] [--fresh] [--model] [--harness] [--cwd]` | `POST /api/flywheel/start` `{ model?, harness?, orders?, fresh? }` | Start, Start fresh | `startFlywheel`: creates `conv-flywheel` and sends `/pan-flywheel [book]`. Refuses a running flywheel (409). Refuses a paused one unless `--fresh` (409): `paused flywheel exists — pan flywheel resume to continue, pan flywheel start --fresh to start over`. |
| `pan flywheel pause` | `POST /api/flywheel/pause` | Pause | `pauseFlywheel`: `handleConversationStop` kills the session and marks the row ended. The row and transcript are kept. |
| `pan flywheel resume` | `POST /api/flywheel/resume` | Resume | `resumeFlywheel`: `handleConversationResume` without the resume contract, then sends `/pan-flywheel` again. |
| `pan flywheel abort` | `POST /api/flywheel/abort` | Abort (confirm) | `abortFlywheel`: pause without a report. |
| `pan flywheel report` | `POST /api/flywheel/report`, `GET /api/flywheel/report` | Report | `requestFlywheelReport` when the flywheel is running. Otherwise the CLI prints `report.md` or "No report yet." |
| `pan flywheel stop [--timeout <ms>]` | `POST /api/flywheel/stop` `{ timeoutMs? }` → 202 | Stop (confirm) | `stopFlywheel`: sends the stop request, checks the report's mtime every 5 seconds until it is newer than the request or the time limit (120 seconds by default) passes, then pauses either way. |
| `pan flywheel status [--json]` | `GET /api/flywheel/status` | Header, Status tab | `deriveFlywheelStatus`. `--json` prints the object unchanged. |
| `pan flywheel stats [--json] [--window <days>]` | `GET /api/flywheel/stats?window=<days>` | Stats tab (7/30/90) | `computeSubstrateStats` |
| — | `GET /api/flywheel/state` | State tab | `readFlywheelStateFile` |

Typed errors: `FlywheelAlreadyRunning` and `FlywheelPausedExists` return 409, and `FlywheelNotRunning` returns 404. The CLI prints the message and exits 1. Every POST passes the trusted-origin and CSRF gate. The page lives at `/flywheel`: Sidebar **Flywheel** (with a muted `live` marker while running), the palette action `pan-flywheel`, and the popout `/popout/flywheel-conversation`. `tests/unit/flywheel/no-loss.test.ts` checks that every v1 affordance still has a home.

## Policies and where each lives

| Policy | Meaning | Where to change it |
| --- | --- | --- |
| `auto_pickup_backlog` (default off) | Off: the loop picks up only operator-released items. On: every ready, planned item can be picked up. | The **Auto-pickup** switch in the Flywheel header |
| `require_uat_before_merge` (default on) | A PR may not merge until UAT passes. | The **Require UAT** switch in the Flywheel header |
| `merge_train_enabled` | After a merge, rebase and re-verify the other ready branches. | The Merge train section on **Awaiting Merge**. The Flywheel header only shows it and links there. |

All three use `GET/POST /api/merge-train/config`. The skill's Orient step reads them from `pan flywheel status --json` (`.policies`) instead of assuming the defaults.

## Non-goals

- Stats criteria c3–c7 (pass rate, MTTR, intervention rate, time consistency, flake). Their inputs were the run telemetry that PAN-3917 deleted.
- A run record, a run id, a `flywheel_runs` table, a telemetry service, or `POST /api/flywheel/status`.
- Boot reconciliation, the Recover button, the orphan-test-agent surface, the VerifyingOnMain badge, and the reset/restart-from-plan buttons.
- Moving `merge_train_enabled` off the Merge train section.
- Changing the loop's phases or the `pan start` launch path.
- Launching `roles/flywheel.md` as a role prompt. The skill is the prompt, and the role file is only the source of the text it quotes.

Known limits: `listRepoPullRequests` reads at most 200 PRs, so a 90-day window on a busy repo undercounts merged PRs, the c1 denominator. The order book's landed count reads the issue cache. The dashboard keeps that cache loaded, but a bare CLI process may not have it, so `pan flywheel status` can report fewer landed items than the page.
