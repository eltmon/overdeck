# Dashboard Server Architecture (Effect + Raw WebSocket)

> Moved from CLAUDE.md (2026-08-07).


The dashboard server uses **Effect.js** for HTTP routes and structured RPC, plus a
**raw WebSocket** endpoint for terminal streaming.

**Server structure** (split from old 15K-line monolith in PAN-428):
- `src/dashboard/server/main.ts` — entry point, dual-runtime (Bun dev, Node prod)
- `src/dashboard/server/server.ts` — Effect HTTP server, route composition, layers
- `src/dashboard/server/ws-rpc.ts` — Effect RPC over WebSocket at `/ws/rpc`
- `src/dashboard/server/ws-terminal.ts` — raw WebSocket terminal at `/ws/terminal`
- `src/dashboard/server/routes/` — ~60 route modules plus domain subdirs (agents/, misc/, resources/, specialists/, workspaces/)
- `src/dashboard/server/services/*.ts` — domain services (cache, agent enrichment, TTS runtime/playback, etc.)
- `src/dashboard/server/event-store.ts`, `read-model.ts` — event store and in-memory read model, at the server root

**Deacon child process** (PAN-3922):
- The dashboard forks `dist/dashboard/deacon.js` (`src/dashboard/server/deacon-main.ts`) through `services/deacon-supervisor.ts`. Cloister and deacon-lite run only in that child, never in the dashboard process.
- IPC, parent to child: `{type:'patrol'}` (run one patrol now) and `{type:'reload-config'}`. Child to parent: `{type:'patrol-done', at, error}` after every completed deacon-lite tick, scheduled or manual.
- Dead-agent events (PAN-4300): each deacon-lite tick checks agents whose `state.json` says `running`. When one is absent from the backend inventory and the liveness oracle confirms it dead, the child emits `agent.heartbeat_dead` and then `agent.status_changed` with `status: stopped`, `previousStatus` set to the recorded status, and `hasLivePane: false`. It emits this pair once per death: it remembers the agent id and launch generation (`startedAt` + `lastResumeAt`) in memory and emits again only after the agent is seen alive, is resumed, or leaves the `running` list. `state.json` is not changed. A deacon child restart emits the pair once more for each agent that is still dead.
- The supervisor keeps the latest `patrol-done` report in memory, across child restarts. Nothing is written to disk.
- `GET /api/deacon/status` and `GET /api/cloister/status` compose `deaconLite` from that report: `running` is whether the child process is running, `intervalMs` is 60000, and `lastRunAt`/`lastRunError` are the relayed report.
- The `pan up` supervisor watchdog restarts the dashboard when `deaconLite.lastRunAt` is older than three intervals. A null `lastRunAt` never produces a verdict.

**WebSocket endpoints:**
- `/ws/rpc` — Effect RPC (PanRpcGroup): domain events, snapshots, replay. Uses typed Schema.
- `/ws/terminal?session=<name>` — Raw WebSocket: live PTY terminal streaming via `ws` library.
  Terminal data bypasses Effect RPC because the RPC serialization layer can't handle
  high-throughput binary-like terminal data reliably.
- `/ws/voice` — Raw WebSocket: microphone audio in, transcript events out.
- `/ws/autopreso` — Raw WebSocket: whiteboard element stream.

Every upgrade passes `authorizeDashboardUpgrade` (`ws-auth.ts`): trusted-or-absent
Origin, then session cookie or internal token — see [DASHBOARD-AUTH.md](DASHBOARD-AUTH.md).

**Terminal architecture** (`ws-terminal.ts` + `XTerminal.tsx`):
- Server: raw `WebSocketServer` with `noServer: true`, deferred PTY spawn (waits for
  client resize dimensions), `node-pty` spawns `tmux attach-session`
- Client: raw `WebSocket` API with a five-minute patient reconnect window from
  `terminalReconnectPolicy.ts`: delays are 1s, 2s, 4s, then a flat 5s.
- Reconnect state stays outside xterm scrollback in a status overlay; exhaustion keeps
  the terminal mounted and offers a manual Reconnect action.
- Close code `4404` means the tmux session is still gone after the server-side wait and
  is fatal. Close code `4503` means the dashboard is gracefully restarting, so the UI
  shows calm "Dashboard restarting" copy and uses the same patient reconnect policy;
  `handleShutdownSignal` broadcasts `4503` before server teardown.
- PTY waits for the tmux session to exist (`sessionExists` + respawn-pending waits) before spawning
- Attach uses a deterministic snapshot protocol: the server sends a `snapshot` control frame,
  the client acks `ready`, and only then does live data flow (`readyForLiveData` in XTerminal.tsx);
  unready clients are closed with `terminal-ready-timeout`
- App-level heartbeat (PAN-4434): a client that opts in with `?heartbeat=1` on the upgrade URL
  receives a `\u0000{"type":"ping"}` control frame every 20s from connection onward (across the
  attach/respawn wait) and must answer `{"type":"pong"}`; any inbound message resets the missed-interval
  counter, and two consecutive silent intervals end in `ws.terminate()`. Ping/pong client messages are
  dropped at the single `ws.on('message')` entry point before they can reach the PTY, the Herdr bridge,
  or any pending-input buffer. A connection without `?heartbeat=1` gets no heartbeat and is never
  terminated by it; `XTerminal.tsx` always opts in. A data frame is used instead of a protocol-level
  `ws.ping()` because proxies such as Cloudflare close an idle WebSocket after ~100s and treat a data
  frame as traffic more reliably than a ping frame. See `ws-terminal-heartbeat.ts` and
  `components/terminal/terminalControlFrames.ts`.
- Companion terminals (PAN-3974, PAN-3835): an OpenCode or Codex conversation's TERMINAL
  streams a separate `companion-<ownerSession>` tmux session running `opencode attach` or
  `codex resume --remote` against the conversation's own runtime, opened through
  `POST /api/conversations/:name/companion-terminal/open|close`
  (`routes/conversation-companion-terminal.ts`) and rendered by `ConversationTerminalView.tsx`.
  The browser names only the conversation. See "Companion terminals" in
  [TERMINAL-BACKENDS.md](TERMINAL-BACKENDS.md).

**Frontend data flow:**
- `EventRouter.tsx` → connects to `/ws/rpc`, fetches snapshot via `getSnapshot` RPC,
  subscribes to `subscribeDomainEvents` stream, applies events to Zustand store
- The snapshot's agent `status` is derived when it is served, not copied from the stored
  record (#4098). A row stored as `running`/`starting` with no non-exited pane in the
  backend inventory is served `stopped`. Every agent-to-pane join in the server, including
  this one, goes through `indexPanesByAgentKey` in `packages/contracts/src/backend-pane.ts`
  (PAN-4320): the key is `agentId ?? terminalId ?? id`, and when two panes share a key —
  a restarted Herdr agent beside its exited pane — the non-exited pane wins. On Herdr, the
  enrichment poller's `agent.created` is the only way an agent started after dashboard boot
  enters `agentsById` (Herdr work agents run without the PTY supervisor), and under Herdr
  the poller skips a cycle only while the backend inventory is degraded, never for lack of a
  tmux census. Before the inventory has answered even once (Herdr not up at dashboard boot),
  such rows are served `unknown`, never dead; after that, a failed read keeps the last-good
  panes. Stored `stopped`/`error` and the `paused` / `stoppedByUser` intent fields pass
  through unchanged. Only `agent-`, `planning-` and `strike-` ids are derived, the set the
  inventory answers for (`deriveServedAgentStatuses` in `src/dashboard/server/read-model.ts`).
  A row served `stopped` this way also has `hasLivePane` (and its deprecated alias
  `hasLiveTmuxSession`) served `false`; a row served `unknown` keeps its stored flags.
- `wsTransport.ts` — Effect-based RPC client with auto-reconnection
- Outage handling never blocks the UI: see [Degraded mode (PAN-4279)](#degraded-mode-pan-4279).
- Store: Zustand with shared reducers from `@overdeck/contracts`
- The Command Deck project list (`command-deck-projects`), project registry
  (`registered-projects`) and conversation list (`conversations`) still load over
  REST. `lib/queryRecovery.ts` (PAN-3527) retries any failure of them with
  backoff (1s, 2s, 4s, 8s, 16s) and, when EventRouter re-bootstraps after a
  `/ws/rpc` reconnect, cancels in-flight fetches and refetches them, so a failed
  or hung fetch during a dashboard restart does not leave the sidebar empty.
- The Command Deck's pipeline-membership banner (`ProjectMembershipBoundary`,
  PAN-3527) tells a temporary outage from a settled answer. While a restarted
  server's snapshot warms, `GET /api/pipeline/membership` returns 503 with
  `{ status: 'loading', code: 'snapshot_loading' }` and `Retry-After: 5`. A
  cold snapshot whose gather failed because the forge did not answer (rate
  limit, 429/5xx, timeout, network error: reason `forge_transient`) also
  returns 503, with `Retry-After: 30`; the 5-minute periodic-convergence
  refresh re-gathers it. A forge that answered "no" (404, a 403
  without a rate limit, no App installation) stays `forge_unavailable`. Those
  503s, a failed or timed-out request, and a proxy 502/503/504 are transient:
  the banner keeps retrying them (backoff capped at 30s, never sooner than
  `Retry-After`), shows "retrying automatically" instead of the error alert, and
  keeps its last good result meanwhile. A typed `status: 'unavailable'` body or
  another HTTP error is a settled answer and shows the alert with its Retry
  button. The membership query also joins the reconnect refetch above.

**Home composer** (PAN-4280): `components/home/HomeComposer.tsx`, mounted on
both Simple and Advanced Home. It wraps the existing Launcher with the Home
intent order from `buildHomeIntents` (agent, terminal, optional codex,
Simple-only "Talk it through first:"), a project chip, and type-to-focus.
Enter posts the raw typed text to `POST /api/conversations` (no `projectKey`
when no project is chosen) and opens `/conv/:name`; the Simple discuss-first
flow sends `seedDiscussPrompt(text)` instead. Ctrl+Enter (or the terminal row)
writes a terminal hand-off through `components/home/pendingTerminal.ts` — a
sessionStorage record plus a same-tab `CustomEvent` — then navigates to the
deck; `Stage` peeks it (non-consuming) to open the drawer, and
`TerminalDrawer` consumes it to run the command in a fresh shell, so it runs
exactly once.
Launch errors appear below the input; the draft stays available for retry.
Browser coverage lives in `src/dashboard/frontend/tests/home-type-and-go.spec.ts`
and `tests/talk-it-through.spec.ts`.

`POST /api/terminals` also accepts an optional `command` (a single line, at
most 2000 characters): once the tmux session exists, it is typed in with
`send-keys -l` then Enter, and the response reports `commandSent`.

**Pipeline retrospective button:** the Command Deck header's
`RetrospectiveButton` (`components/CommandDeck/RetrospectiveButton.tsx`) POSTs
`{ window: '24h' | '7d', model, harness }` to
`POST /api/conversations/retrospective`
(`routes/conversations-retrospective.ts`). The server reads
`roles/retrospective.md` on every request — edit it to tune the prompt, no
rebuild or restart — renders the window bounds and per-project state/repo
paths into the kickoff message, and creates an **unscoped** conversation
through `handleConversationCreate`, so it appears under the sidebar's
`No project` bucket. The conversation is read-only by prompt contract only
(no tool sandbox); `tests/unit/prompts/retrospective-template.test.ts` pins
the read-only clause and the placeholder set.

Because the endpoint spawns a billable model session, it is gated by
`rejectUnsafeDashboardMutationRequest` — the same authenticated-mutation
contract as the other launch routes — not by `validateOrigin` alone. A
trusted `Origin` with no credentials gets 401; a session cookie without the
matching CSRF header gets 403; the server-side internal token is accepted on
its own. The button therefore sends `dashboardMutationJsonHeaders()`, with no
argument: that helper resolves a WebSocket RPC URL internally, so passing it a
relative REST path would throw in `new URL(...)`.

The kickoff prompt never tells the conversation to read per-issue records.
Instead the server gathers that evidence itself, before the conversation
exists, and embeds it at `{{EVIDENCE}}` under the template's `## Record
evidence` heading. `collectRetrospectiveEvidence` enumerates through
`listIssueRecords` — the issue-record read door's own bounded enumeration
facet, which already resolves both the migrated layout and the legacy layout
(the latter is issue-workspace scoped, because `getIssueRecordPath` delegates
to `getIssueRecordBasePath`; a project state-root concatenation is **not**
equivalent and getting that wrong is exactly how an earlier cycle shipped a
broken instruction). Records are filtered to `updated >= windowStart` and
projected to a bounded per-issue snapshot preserving `pipeline`, `feedback`,
`sessionHistory`, `recoveryTrips`, and `scopeDrift`.

The window is closed on both ends (`start <= updated <= now`): a future-dated
record — clock skew or a hand edit — would otherwise satisfy `>= start` for
every window and sort to the top of all of them, so those are excluded and
counted separately. The nested arrays (`feedback`, `sessionHistory`,
`recoveryTrips`) are stored append-only oldest-first, so the renderer sorts
them newest-first *before* applying the per-issue caps; slicing an unsorted
append-only list keeps the oldest entries and discards exactly the recent
activity a retrospective exists to explain.

Every omission is disclosed in the rendered text rather than dropped silently:
out-of-window and future-dated counts, records with no usable timestamp,
per-issue and per-project cap overflow (counted across *both* scope-drift
arrays, since a disclosure that under-reports is worse than none), paths the
read door could not read, and a read door that threw (which renders as
`EVIDENCE UNAVAILABLE`). Both failure disclosures tell the agent not to infer
that nothing happened. Caps live in `EVIDENCE_LIMITS`, including
`maxRenderedBytes` — a global byte budget, because per-row caps do not bound
the whole snapshot and `handleConversationCreate` caps the entire kickoff
message, so an unbounded snapshot can push the instructions themselves out.

The enumeration itself is bounded and honest: `listIssueRecordsDetailed`
reads under a concurrency ceiling and returns `{ records, failures }`, so an
unreadable directory is distinguishable from an empty one. (`listIssueRecords`
keeps its array-only signature for its other callers and delegates.) This is
what keeps the feature inside the single-source-of-truth rule: the
conversation consumes a snapshot produced by the read door, and never reaches
for a store itself. Note the standing gap: no `pan` verb and no
dashboard endpoint returns a **full** record to a shell consumer — `pan show
--json` is the runtime lens and `pan task show --json` is a single plan item,
so neither reaches `feedback`, `scopeDrift`, `sessionHistory`, or
`recoveryTrips`. The template discloses that limitation rather than implying a
door that does not exist; a real record read door would be a separate change.

**DB job worker lanes:**
- Five lanes. The `read` lane handles interactive point lookups only (e.g.
  `getConversationByName`). The `poll` lane runs the four polling aggregates —
  `getCostsByIssueSnapshot`, `getConversationSearchStats`, `getConversationLedgerCosts`,
  and `getAgentCostStats` — so their multi-second refreshes never queue behind, or ahead
  of, an interactive lookup. The `long` lane handles bulk scans and reconciliation, and
  the `semantic` lane isolates embedding and semantic-search work. The `parse` lane runs
  `parseTranscriptSnapshot`. Transcript parsing is CPU-bound and can take seconds, so its
  own lane cannot block interactive reads or wait behind bulk sweeps. Rule: an aggregate
  or scan never shares a lane with a lookup that sits on an interactive path (PAN-4312 —
  before this, the polling aggregates shared `read` with `getConversationByName`, so a
  live conversation subscribe could wait behind a 13-second search-stats refresh).
- Worker implementations live in `src/dashboard/server/services/dashboard-db-worker.ts`.
  Add each new operation to both `dashboard-db-task.ts` and the worker dispatch table so
  the main thread and worker remain type-safe.
- The dashboard runs the built bundle, where `dashboard-db-worker.js` is its own entry in
  `dist/dashboard/` (`src/dashboard/server/tsdown.config.ts`). `dashboard-db-task.ts`
  resolves it from the `dist/` root, like the memory FTS worker, so it is found whichever
  chunk the bundler puts the task module in.
- Under a source run (Vitest, `tsx`) `dashboard-db-task.ts` loads as `.ts`. Node's type
  stripping does not rewrite the worker's `.js` import specifiers, and a `--import tsx`
  flag in `execArgv` does not reach a worker thread, so a raw `.ts` worker dies on its
  first relative import. The `.ts` branch instead boots the thread through an `eval`
  bootstrap that registers `tsx`'s resolver and then imports `dashboard-db-worker.ts`
  (PAN-3930). Bun runs the `.ts` worker directly. Tests that boot the real worker call
  `__testInternals.terminateWorkers()` in `afterEach`.
- That bootstrap is `spawnModuleWorker` in `src/lib/module-worker.ts`; start any new
  worker thread through it. The memory checkpoint worker uses it too:
  `src/lib/memory/checkpoint-client.ts` resolves `dist/dashboard/checkpoint-worker.js`
  from dashboard chunks and `dist/lib/memory/checkpoint-worker.js` (a root
  `tsdown.config.ts` entry) from CLI chunks such as `pan memory backfill`.
- The memory FTS worker uses it as well. `src/lib/memory/fts-db.ts` resolves
  `dist/dashboard/memory-fts-worker.js` from dashboard chunks and
  `dist/lib/memory/fts-worker.js` from CLI chunks. From source, only Vitest runs FTS
  statements inline (memory tests mock modules and change `OVERDECK_HOME` per test,
  and neither reaches a worker thread). A `tsx` run uses the worker.
- Jobs that wait or run for more than one second emit
  `[db-jobs] slow: op=<operation> lane=<lane> waitMs=<n> runMs=<n> depth=<n>`.
  The line identifies whether queue delay or worker execution caused the slowdown.
- `costReconcileSweep` walks and parses transcript files in the `long` lane. The main
  thread records bounded 250-event progress batches through the canonical write doors and
  acknowledges each batch before the worker continues its single-pass scan. This limits
  transfer memory without repeated parsing while preserving EventBus publication and
  durable skip-cache updates.
- Cost polling, conversation-list ledger totals, and search counters use shared worker
  snapshots on the `poll` lane. Concurrent refreshes coalesce. Cost snapshots refresh
  after 15 seconds; search counters refresh after 60 seconds and read `lastIndexedAt`
  from `max(file_cursors.updated_at)` rather than scanning every row of the `chunks`
  table (PAN-4312 — that scan cost ~9s on a 3GB embeddings DB). Successful values remain
  usable for at most five minutes during refresh failures, with a five-second retry
  backoff. Search configuration, provider availability, and runtime health are still
  read per request.
- Agent resource costs use one grouped worker query and a 15-second shared snapshot,
  invalidated when agent membership changes. Hourly burn remains twice the sum in the
  last 30 minutes, with the inclusive cutoff and rounding to cents preserved. SQLite's
  more accurate summation can correct a cent at a half-cent floating-point boundary.
  Resource polling no longer materializes each agent's full ledger history.
- `subscribeConversationMessages` resolves the conversation row with a `read`-lane point
  lookup (`getConversationByName`), then resolves transcript paths on the main thread and
  shares worker parse results across subscribers. The Claude initial transcript snapshot
  goes through `sharedTranscriptParser('claude-initial')`: reused while the file's stat
  signature is unchanged, with each subscriber getting its own copy of the mutable
  parse-state containers (`parseStateFromSnapshot`), since the incremental parser mutates
  those containers in place and a shared copy would corrupt other subscribers. A missing
  session file (a freshly spawned conversation subscribing before its transcript exists)
  still dispatches an uncached parse rather than throwing; `watchConversation` then polls
  until the file appears. Codex consumes appended records; other full-parser harnesses
  still parse changed files in the worker. Clients receive complete initial history, then
  changed message/tool rows and metadata. Explicit resets replace history after
  truncation/replacement, and metadata snapshots clear removed plans or compact
  boundaries. Full tool results remain accessible.
  - The client shows the loading skeleton until the first WS payload arrives, and falls
    back to HTTP `GET .../messages` only after `MESSAGES_HTTP_FALLBACK_MS` (1500 ms) pass
    without one (`useMessagesHttpFallback`, PAN-4312). Resume, switch-model, and fork
    completion re-read over HTTP with `queryClient.fetchQuery({ ..., staleTime: 0 })`
    rather than `invalidateQueries`, since `invalidateQueries` does not refetch a
    disabled query, and `fetchQuery` without `staleTime: 0` would return cached data
    without a request whenever a recent stream event left the query fresh under the
    app's default 30 s `staleTime`.
  - Context usage comes from the parse result (`contextUsageFromParseResult`) on both the
    WS path and HTTP `/messages`, instead of a second file parse. `GET
    /api/conversations/:id` uses a memoized `computeContextUsage`, keyed by session file
    and model and validated against file size and mtime, so a repeat read with an
    unchanged transcript never reopens the file.
  - `/diffs` polls only while the conversation's session is alive (an ended conversation
    cannot gain new edits), runs one `git diff` pair per repo across every edited turn
    instead of one pair per turn, and caches its result for 30 seconds keyed by the
    transcript's size and mtime (repo `HEAD` is not part of the key, since `git diff
    <base> -- <paths>` compares against the working tree either way).
- Global issue updates use `issues.delta`: complete changed rows at their original
  array positions plus the resulting length. Initial/reconnect snapshots retain all
  rows and descriptions. Shared reducers preserve order, removal, and arbitrary tracker
  fields without repeatedly transmitting unchanged descriptions. These projections use
  in-memory publication and never enter the durable event log.

**Conversation loading and delivery:**
- A `/conv/<id>` deep link loads that conversation directly, independently of the
  sidebar list. Favorites, pending-input state, and normal list navigation remain intact.
- Issue Session tabs load agent transcripts through
  `GET /api/agents/:agentId/conversation`. For Claude agents, the route checks the
  durable `sessions.json` index from newest to oldest until it finds an existing
  JSONL. Legacy launcher/runtime/state pointers are eligible only when the index is
  absent. A 404 names the agent and every path checked. Since PAN-3959, each
  harness's capture point records the transcript's absolute path in the entry it
  writes at session start, so resolution is a newest-first lookup over recorded
  paths; per-harness path formulas apply only to pre-PAN-3959 entries that predate
  that recording.
- `src/lib/agents/transcript-resolver.ts` is the single resolver: the agent
  conversation route above, the `/ws/rpc` synthetic-agent stream, enrichment, and
  the summary-fork/handoff transcript adapters all call it — no other path re-derives
  an agent's on-disk transcript layout.
- The `/ws/rpc` synthetic-agent stream watches every root a transcript could still
  appear under. A root whose watch attachment fails (e.g. the directory does not
  exist yet) is retried on the next event fired by a surviving watcher — there is no
  timer or poll. If every watch attempt fails, the stream stays in `discovering`
  until an operator or later launch creates one of the watched roots.
- Pull requests on conversations (PAN-3822): the `conversation_pull_requests` table
  holds PR links keyed by host/repository/number with a `source`, a `dismissed_at`
  tombstone, and a `snapshot_json`. The pull-request sync sweep
  (`services/pull-request-sync-service.ts`, primary dashboard only, boot +30 s then
  every 60 s) reads each GitHub project's `gh pr list` once per sweep, links every PR
  whose head branch equals a conversation's branch (`resolveConversationBranch`: a
  linked worktree's, an agent's, or — PAN-4457 — a live operator conversation's branch
  in the primary checkout, via the backend-agnostic pane inventory, `getBackendPanes`;
  liveness unknown or the inventory degraded skips primary-checkout matching that
  sweep; never the default branch) as a `branch` link, and refreshes stored snapshots of linked PRs
  by due rule: unsynced and open every sweep, closed every 15 min, merged never. A
  due GitHub link no listing covered gets one `gh pr view` (the fallback), and 3
  consecutive failed reads skip that repository for 15 min. The last-read times
  and failure counts are in memory only. A change emits the in-memory
  `conversation.pull_requests_changed` event, which bumps `conversationsListRevision`.
  `GET /api/conversations` rows carry `pullRequest` (the effective link from
  `resolveEffectivePullRequest`) and `pullRequestCount`, read with one SQL query per
  page. The door is `src/lib/overdeck/conversation-pull-requests.ts`. Explicit links
  go through `conversation-pull-request-commands.ts`, which parses the ref
  (`packages/contracts/src/pull-request-ref.ts`, shared with the dashboard: PR/MR URL, `#42`, `owner/repo#42`) and refuses a
  repository not configured for the conversation's project
  (`foreign_repository`). The dashboard routes
  (`GET/POST/DELETE /api/conversations/:name/pull-requests`, the DELETE takes
  `?ref=`) and `pan conv link-pr`/`unlink-pr`/`prs` both call it. An unlink always
  sets `dismissed_at` rather than deleting, so the sweep cannot re-add the PR. A
  `manual`/`agent` relink clears it; a `created` link does not. `created` links
  come from `linkCreatedPullRequestToIssueConversations`, called after
  `createReviewArtifact` in `review-artifacts.ts` and `pan done`: every
  non-archived agent conversation with that `issue_id` gets the PR, and so
  (PAN-4457) does every non-archived, non-vault operator conversation whose
  `cwd` is at or under the issue's `workspacePath` (matched with SQLite
  `instr()`, never `LIKE`, so a path containing `_` or `%` isn't a wildcard).
  Issue and workspace row badges (`FeatureItem.tsx`, `Sidebar.tsx`) read
  `DerivedIssueState.pr` through `issuePullRequestBadgeLink`, never a
  conversation link. `startRequestReviewPipeline`
  (`routes/workspaces/review-pipeline.ts`) calls
  `refreshIssuePullRequestStateNow` (`services/issue-pr-refresh.ts`) right
  after journalling an accepted review request, which invalidates the repo's
  cached PR listing and schedules a derived-state refresh for the issue, so
  the badge appears within seconds of `pan done` opening the PR. Other reads,
  all in `routes/conversation-pull-requests.ts`: `POST …/pull-requests/sync`
  (forced `gh pr view` refresh of every live, unmerged link), `GET
  /api/pull-requests?state=&project=` (every live link, with its conversation and
  effective project), `GET /api/pull-requests/conversations?url=` (reverse index),
  and `pullRequest` + `pullRequests` on `GET /api/conversations/:id`. A new table
  goes in the init migration AND a `runSchemaTopUp` in `ensureRuntimeIndexesSync`,
  and bumps `OVERDECK_TABLE_COUNT`.
- `GET /api/conversations/:name/messages` and `/message-locator` resolve registered
  rows first. A name that is a bare Claude session UUID with no row (a Cmd-K hit on an
  indexed transcript Overdeck never registered) falls back to an exact `<uuid>.jsonl`
  lookup under `~/.claude/projects/` and is served read-only (no composer). `agent-*`
  names never trigger a scan: work agents use `/api/agents/:id/conversation`, and
  subagent hits open their parent conversation with `?agentId=<bare id>` (PAN-3982).
- Delivery modes (PAN-4292). `HarnessBehavior.steerKind` (`packages/contracts/src/harness-behavior.ts`)
  says how a harness can be steered: `send-now-keys` (Claude Code), `control-channel` (Pi), or
  `null`. The composer shows its delivery selector only for a steer-capable harness (Pi only on
  conversations), and Ctrl/Cmd+Enter sends with `deliverAs: 'steer'`; elsewhere Ctrl+Enter is
  Enter. Both `POST /api/conversations/:name/message` and `POST /api/agents/:id/message` accept
  the `deliverAs` body field. A Claude Code steer reaches the delivery door as
  `submit: 'steer'`. A harness without steer, or `follow_up` on Claude Code, answers **422**
  `steer-unsupported` and delivers nothing. When an old PTY supervisor pressed Enter instead, the
  response carries `steerDegraded` with the reason.
- Live effort (PAN-4255). `POST /api/conversations/:name/thinking-level` (claude-code branch) and
  `POST /api/agents/:id/effort` (claude-code agents only; other harnesses answer **400**) both call
  `applyClaudeLiveEffort` (`src/lib/agents/effort-live.ts`): a mid-turn session is refused, then the
  pane is checked for a permission prompt and the main input target, `/effort <level>` is delivered
  through `deliverAgentMessage`, and the session transcript is polled from the pre-delivery offset
  for 10 s. Confirmation is the user record `<local-command-stdout>Set effort level to <level> …`;
  only then does the door persist the level (`setConversationEffort`, or `effort` +
  `effortSource: 'explicit'` in agent state). Status codes: **409** `busy` / `permission-pending` /
  `input-target-not-main`, **422** `effort-rejected` or session not running, **502**
  `not-delivered`, **504** `not-confirmed`. The transcript's observed effort reaches the composer
  chip as `ContextUsage.lastEffort` (conversations) and `observedEffort` + `effortResolution` on
  `GET /api/agents/:id/conversation` (agents).
- HTTP acceptance and transcript confirmation are distinct. A late echo does not prove
  delivery failure. Unknown delivery preserves the operator's text; confirmed rejection
  retains the existing recovery actions. The client bounds the request and body read to
  120 seconds, and reconciles late echoes using message identity or text/time matching.
  A pending user bubble's `deliveryState` renders one of: `pending` ("Sending…"),
  `unknown` ("Delivery not confirmed"), `accepted` ("Sent · waiting for transcript"), or
  `subagent` ("Delivered to subagent · `<description>`" — Claude Code routed the message
  into a running subagent instead of this conversation; PAN-4247), or `held` ("Waiting:
  the agent needs a permission answer first"; see "Terminal permission prompts and held
  messages" below, PAN-4278). Before pasting, the
  composer route checks Claude Code's agent selector and switches input back to the main
  agent (PAN-4268); if that cannot be confirmed the route answers 409
  `input-target-not-main`, the toast shows the reason, and the draft stays in the editor.
  Conversation rows carry `inputTarget` (`'main' | { subagent } | 'unknown'`), which
  drives the composer's "Typed messages are going to subagent" notice. An `accepted` bubble
  that stays unmatched for `TURN_STALL_MS` (4 minutes) **while the conversation is not
  streaming** moves to the outbox as "Not found in transcript", with **Resend** (a fresh
  send identity — new `clientMessageId`, no inherited `createdAt`, no `retry` flag, since
  the original send may still land) and **Copy** (writes the text to the clipboard); while
  streaming, the same delay proves nothing, since a message queued behind a long tool
  call is legitimately unrendered until consumed. Two or more quick sends that Claude
  Code joins into one queued message are reconciled together: the single transcript
  record clears every contributing bubble at once, not just the first. Claude Code
  records a long composer paste as `<pasted_content id="N">…</pasted_content id="N">`
  in both landed and queued records; the parser (`renderableUserText()`) and the
  landing probe strip that wrapper through `src/lib/pasted-content.ts` before any
  further checks, so the timeline shows the operator's own text with no tags
  (PAN-4305). `reconcileComposerEchoes()` compares bubble and transcript text with
  whitespace collapsed rather than exact, so attachment references Claude Code joins
  with a space still match a bubble that joined them with a newline, and it also
  clears a bubble whose full text is contained in a later user record (a merged
  queued prompt with extra content) — the red "Not found in transcript" state now
  appears only when no landed or queued record matches or contains the bubble's text
  at all. Composer delivery still pastes the raw, unwrapped text: every delivery path
  (tmux `paste-buffer -p`, Herdr `pane.send_text`, Herdr `agent.prompt` for non-Claude
  harnesses) submits with bracketed paste because raw typed bytes submit a multi-line
  message at its first newline, so the agent sees a long composer message inside
  `<pasted_content>` too — a known, accepted side effect, not something delivery works
  around. On Herdr a Claude Code composer send is submit-verified: Overdeck presses
  Enter itself after the paste shows in the composer and resends Enter once if the
  message is still there (PAN-4492).
- Composer attachments (PAN-4493): `POST /api/conversations/:name/upload-image` stores
  a file in `~/.overdeck/conversation-attachments/<name>/`. `GET
  /api/conversations/:name/attachments/:file` (`routes/conversation-attachments.ts`)
  serves an image (`png`, `jpg`, `jpeg`, `gif`, `webp`) from that folder only; every
  other name, traversal, non-image file or other conversation's file is 404. The
  composer thumbnail and the sent-message thumbnails open one shared lightbox
  (`components/chat/ImageLightbox.tsx`, host mounted in `main.tsx`); sent-message
  thumbnails come from `extractAttachmentImageRefs()` in `messagesTimeline/helpers.ts`.
- Conversation timeline layout (PAN-4497): `MessagesTimeline.tsx` virtualizes all but
  the last 8 rows with `@tanstack/react-virtual`. Visible virtual rows render in normal
  flow inside one wrapper translated to the first visible row's offset, so rows cannot
  overlap while a height measurement is pending. Virtualizer keys are the row id, so
  measured heights survive a width change. When the row width (capped at 760px by
  `.messagesTimelineInner`) or "Hide tool calls" changes, the timeline re-reads every
  mounted row's height in the same layout pass. It never calls the virtualizer's
  `measure()`: that drops every cached height, and rows whose height did not change
  would fall back to estimates and overlap. The
  regression check is `src/dashboard/frontend/tests/pan-4497-timeline-overlap.spec.ts`.
- The PTY supervisor reports what it observes about its harness to
  `POST /api/agents/:id/lifecycle`, authenticated by the session's pty-token. It emits
  `session-started`, `turn-started` (on a confirmed injection) and `exited`. The route
  also accepts `turn-ended`, but the supervisor does not emit it: it sees only the PTY
  byte stream. A turn's `idle` comes from the harness's own hook (claude-code's Stop
  hook), so a hookless harness stays `working` until its next edge. Each post carries
  `launchedAt`, the supervisor's start time, as its launch generation. `:id` is the
  supervised session id, so one route serves agents and conversations (`conv-<name>`).
  For an agent it appends `agent.started`/`agent.activity_changed`/`agent.stopped`.
  For a conversation, the row is the non-archived one whose `tmux_session` is `:id`,
  preferring a post-/clear sibling over its cleared parent. `session-started` marks
  that row active, unless it is a /clear-ended parent or the start is older than the
  row's `ended_at`. `exited` marks it ended at the exit time and runs attachment
  cleanup once, only if the row was not already ended. Each edge appends
  `agent.activity_changed` under the session id its hooks report under. An exit from a
  launch older than the in-flight respawn, or older than the newest launch that reported
  `session-started`, is acknowledged and not recorded. A new harness that dies inside the
  respawn window still ends the row (PAN-3962). The 10-second conversation poller stays
  as the backstop. It does not resurrect a row whose end is newer than its census
  snapshot, or whose harness a fresh probe finds gone.
- A post-`/clear` sibling shares its parent's terminal session (PAN-4485). The parent
  (`cleared_to_conv_id` set) is superseded and owns nothing; the chain head — the
  newest row, `cleared_to_conv_id` null — owns the session.
  `src/lib/overdeck/conversation-clear-chain.ts` is the one resolver: list repair
  never revives a superseded row and re-ends one stored `active`; stop and resume on a
  superseded row act on the chain head (resume answers 409 `conversation-cleared` when
  the chain is broken); delete and archive of a superseded row stop nothing;
  restart-all restarts each live session once, through its owner; plan-action,
  permission and pane-choice answers on a superseded row return 409. There is no
  boot-time conversation auto-resume.
- Conversation sends carry `clientMessageId`; retries preserve it and set `retry: true`.
  The server coalesces matching concurrent requests and retains their result, including
  ambiguous failures. Changed text or command confirmation requires a new ID. Receipts
  are bounded to 2,000 entries and 24 hours. A retry whose receipt was lost to restart or
  expiry is refused with an unknown outcome, never injected as a new message. This is
  safe retry handling, not an exactly-once guarantee from the underlying harness.
- `pan pause sequencer-runner` prevents both explicit and automatic sequencer starts.
  The launcher checks the pause before preparation and immediately before spawning.
  Resume permission requires `pan unpause sequencer-runner`.
- A sequencer pass does not close its pane when it finishes. `spawnSequencerAgent` clears a
  finished run before it spawns, on the operator route and the auto-trigger alike.
  `getSequencerRunStatus` decides through `isAlive` in `src/lib/agents/liveness.ts`: a run is
  done when its pane has no live harness (`pane-dead`), it wrote a fresh `sequence.md`
  (`fresh-sequence`), or its Herdr pane is idle or done at its prompt after the prompt was
  delivered, with work activity older than 60 s (`pane-finished`, PAN-3923). When the backend
  has no per-pane state (tmux), the runtime mirror's idle label stands in for Herdr's and passes
  the same `isFinishedRoleRun` rule (`idle`, PAN-4172); the label alone never finishes a run.
  A codex, kimi-code, pi, ACP or OpenCode sequencer reads `unknown` on Herdr; its transcript's
  turn-complete marker stands in for the idle label under the same rule (`pane-finished`, #4169,
  see "Non-Claude harnesses on Herdr" in `docs/TERMINAL-BACKENDS.md`).
  `pane-finished` covers a dashboard restart, which empties the
  in-process mirror, and a pass that failed before writing. After a restart the activity age
  rests on the transcript heartbeat; if no activity signal resolves, the run is refused, never
  reaped. `clearFinishedSequencerRun` probes a
  `pane-finished` or `idle` run a second time 5 s later and stops it only if it still reads done;
  after the stop it waits up to 3 s for the backend to drop the pane.

**Issue views:** Rail, cockpit, and console issue surfaces share the kit documented in
`docs/ISSUE-VIEW.md`. Route new issue sections through `IssueViewModel`, the shared
components, and `DENSITY_SECTIONS`; update the inventory and real `data-section`
marker so the no-loss gate proves that no existing surface disappeared.

**God View:** `/god-view` centers the Confluence production canvas from [PAN-3447](https://github.com/eltmon/overdeck/issues/3447); its deliberate style-guide exemption and live-data contract are documented in `docs/GOD-VIEW.md`.

**Derived issue state on board routes (PAN-3925):** routes that derive many issues go through the server adapter's batch doors in `services/derived-issue-state.ts`: `loadIssueStatesForProject` for one project, and `loadIssueStatesForIssues` for ids from many projects (one batch per project, the projects in parallel). A batch costs one `gh pr list` per repo, two `git for-each-ref` calls, and no per-issue spawn. The server batch doors read the PR listing stale-while-revalidate (`listRepoPullRequestsStaleOk`): a busy repo's listing takes ~11s, so once the 30s TTL passes, reads get the last listing immediately while a single refresh runs. A read waits for the forge only when no listing is younger than two minutes. Gates that act on readiness (merge scheduling, the ready set) keep the strict `listRepoPullRequests`. Route code must not call `getDerivedIssueState` in a loop.

**Session lifecycle rules:**
- On WebSocket close, do NOT kill the PTY — the tmux session survives independently.
- Do NOT pre-resize tmux windows. Let the PTY spawn handle sizing via client dimensions.
- The planning launcher script MUST export TERM/COLORTERM/LANG for Claude Code rendering.
- Planning sessions use `remain-on-exit on` + `destroy-unattached off` so the session
  survives after the agent exits, until the user clicks Done.

## Diff compare and ignore-whitespace (PAN-4503)

The diff panel can compare any two refs of a local repository, with no remote
and no PR. Two routes in `src/dashboard/server/routes/diff-compare.ts` serve it,
backed by `src/lib/diffs/compare.ts`:

- `GET /api/diffs/compare?repo=&base=&head=&mode=&file=&ignoreWhitespace=`
  returns `{ repoRoot, mode, base: { ref, sha }, head: { ref, sha }, mergeBase,
  files, diff? }`. `files` is always present; `diff` (the patch) is present only
  when `file=` names one file, the same contract the panel already renders for
  vs-main and all-turns. `mode` is `two-dot` (default: `git diff <base> <head>`,
  every difference) or `three-dot` (`git diff $(git merge-base base head) head`,
  only head's changes since the branches diverged; `mergeBase` is set).
- `GET /api/diffs/refs?repo=` returns `{ repoRoot, head, branches, tags,
  commits }` for the ref picker. It reads only `refs/heads`, `refs/remotes` and
  `refs/tags`, so checkpoint refs under `refs/pan/turn/` never appear.

Failures return 400 with `{ code, error }`: `INVALID_REPO`, `REPO_NOT_ALLOWED`,
`NOT_A_GIT_REPO`, `INVALID_REF`, `UNKNOWN_REF`, `INVALID_MODE`, `NO_MERGE_BASE`.

**Allowed roots.** `repo` must be an absolute path whose realpath is inside a
registered project's `path`, inside that project's workspaces dir, or **exactly
equal** to the cwd of an unarchived conversation. Conversation cwds are
exact-match only, so a conversation started in the home directory does not open
every repository under home. Anything else is `REPO_NOT_ALLOWED`, decided before
any git process starts.

**Refs.** Each ref is shape-checked before any git call (no leading `-`, no `..`,
no whitespace or `:`, at most 256 characters), then resolved with
`git rev-parse --verify --quiet --end-of-options <ref>^{commit}`. Every later git
command receives the resolved SHAs, never the user's string. All git calls are
`execFile` argument arrays.

**Ignore whitespace.** `ignoreWhitespace=1` (or `true`) maps to `git -w` on the
patch and numstat of every diff route: the compare route, the agent turn, full
and vs-main routes, and the conversation full and turn routes. The turn-summary
lists (`GET /api/agents/:id/diffs`, `GET /api/conversations/:name/diffs`) ignore
it. The panel stores the toggle per browser in `overdeck.ui.diff.preferences`.
The helpers live in `src/lib/diffs/diff-output.ts` (`DiffOptions`,
`diffOptionArgs`, `diffOptionsFromSearchParams`).

**URL state.** The Compare view lives in `diffTurnId=compare`, `diffBase`,
`diffHead` and `diffMode` (plus the usual `diffFilePath`). `DiffPanel` shows the
"Compare…" chip only when it gets a `repoPath` prop: `ConversationPanel` passes
the conversation cwd, and the `/popout/diff` route passes its `repo` param. The
panel's pop-out button carries `repo` and the compare keys.

## CPU weight and the runaway patrol (PAN-4311)

The dashboard runs in its own transient systemd unit started with
`CPUWeight=<resources.dashboard_cpu_weight>` (default 1000; the supervisor
unit uses the same value). That weight enables the `cpu` controller in
`app.slice`, so under contention the dashboard's cgroup gets its weighted
share instead of competing thread by thread with every agent in the Herdr
unit. It fixes scheduler starvation of the event loop. It does not fix the
event-loop p99 the dashboard causes itself with its own blocking work.

The runaway-process patrol (`src/lib/cloister/runaway-process-patrol.ts`)
runs in the dashboard **main** process, not the deacon child, because
`/api/resources` is built there and `isIdle` has runtime data only there.
`main.ts` starts it next to `startResourcesSnapshotService()` and stops it on
the same shutdown path. Every 30 s it reads `/proc` with async
`fs/promises` calls only (no child processes, no `*Sync` reads): one `stat`
per process in the Overdeck cgroups, and `environ`, `cmdline` and `cwd` once
per process identity. Its latest sample feeds `/api/resources`
`hostProcesses` and the load-spike sampler. It only reports: it never kills,
pauses or messages anything (see "Runaway processes" in
[PIPELINE-GATES.md](PIPELINE-GATES.md)).

## Terminal permission prompts and held messages (PAN-4278)

Claude Code draws a blocking tool-permission prompt in a conversation's pane (`Bash command`,
the command, sometimes a reason such as `Dangerous rm operation …`, then `Do you want to
proceed?` with `1. Yes`, optionally `2. Yes, and always allow …`, and `No`). It fires even
under `--permission-mode bypassPermissions`, and a background subagent's prompt draws in the
main view too, titled `Bash command · from the <type> agent`. This applies to Claude Code
**conversations** only; work, review and test agents keep the "blocked on a terminal dialog —
open its terminal" toast.

**Two sources, the pane decides.** `src/lib/agents/permission-prompt.ts` parses the prompt from
a plain-text screen (fixtures in `src/lib/agents/__fixtures__/claude-code-2.1.280/`). The
`PermissionRequest` hook (`POST /api/hooks/permission-event`) records, per conversation and per
agent key (`agent_id ?? 'main'`), the tool, an input preview, the subagent's description
(`subagents/agent-<id>.meta.json`) and the request time in an in-memory registry
(`src/lib/overdeck/conversation-permission-registry.ts`); a clearing hook removes only its own
agent's entry. Hooks alone cannot keep it current — a user Deny fires neither `PostToolUse` nor
`Stop` — so the pane is the evidence: an entry whose prompt the pane showed and no longer shows
is dropped on the next read, and a confirmed dashboard answer clears its entry. `conversationPendingPermission` (`src/lib/overdeck/conversation-permission.ts`)
reads the pane through `resolveAgentPaneIo` (Herdr or tmux) and joins the two. A prompt on screen
is `answerable`; so is one taller than the pane that has lost its `───` rule and title off the
top, recognized as **clipped** (PAN-4466) when its question matches `Do you want to …`, its
options and `Esc to cancel` footer are the last thing on screen, and no rule is in view. A
clipped prompt's agent comes from the hook registry (or reads `Unknown agent` when none
matches), and `inputPreview` carries the start of the command — the pane shows only the tail. A
registry entry without a prompt on screen is `answerable: false`. The registry is lost on a
dashboard restart;
the dialog then labels the agent from the prompt's title. `GET /api/conversations/pending-input`
carries `pendingPermission` (and skips the PAN-3113 pane-choice check while one is pending);
`GET /api/conversations/:id` adds `permissionRequest` to `pendingInputKinds`.

**The dialog.** `TerminalPermissionDialog` opens for the oldest pending permission and names
the conversation, the agent (`Main agent` or `Subagent: <description>`), the tool, the command
and the reason. For a clipped prompt it adds a **Command (start)** field from `inputPreview`,
labels the detail block **On screen**, and notes that the top of the prompt scrolled off. It
offers **Allow once**, **Allow always** (only when the prompt offers it) and
**Deny**; a non-answerable one offers only **Open terminal** and **Dismiss**, and makes
**Open terminal** the primary action — it navigates to `/conv/<name>?view=terminal`, which
switches the conversation's Command Deck pane into its terminal view (PAN-4466). An answer posts
`POST /api/conversations/:id/permission {signature, choice}`, which re-reads the pane, refuses
without sending keys when the prompt is gone (`prompt-gone`) or differs (`prompt-changed`), then
sends **arrow keys to the chosen row and Enter** — never digits, never Escape — and confirms the
prompt left the screen (`delivery-unconfirmed` otherwise). The dialog stays in "Confirming…"
until the feed stops reporting that prompt's signature.

**Needs you and notifications.** A pending permission is a blocking `permissionRequest` row in
Needs you, described `<agent> · <tool> · click to answer` when answerable or `<agent> · <tool> ·
answer in the terminal` when not (PAN-4466), and showing the start of the command and `waiting
<relative time>`; rows sort oldest first. A conversation row with no issue ref falls back to the
conversation's title instead of its raw name. Clicking a non-answerable row navigates straight to
the conversation's terminal view in one click, rather than reopening a dialog with nothing to
show. A desktop notification fires when a prompt is first seen and again 5 and 30 minutes after
it started waiting, while it is still pending.

**Held messages.** The composer route checks for an on-screen prompt **before** switching the
agent selector to main (PAN-4268), because that switch's `Down`/`Enter` would answer the menu.
With a prompt up it pastes nothing and answers 409 `permission-pending`. A registry-only entry
never holds a message: the hook is best-effort, so a lost clearing post must not block every
send. The composer keeps the message as a `held` bubble ("Waiting: the agent needs a permission
answer first", with Discard) and resends it once a feed read newer than the hold shows no
on-screen (`answerable`) `pendingPermission` for that conversation, with a fresh `clientMessageId`
and no `retry` flag —
the receipts cache holds the 409 under the old id. A second `permission-pending` holds it again.
A clipped prompt is answerable, so it holds messages exactly like any other on-screen prompt
(PAN-4466). Held bubbles live in memory only: a page reload drops them.

**Not delivered.** When `deliverAgentMessage` returns `ok: false` (for example a Herdr refusal,
or a Herdr client failure before `agent.prompt`), the composer route logs `[conversations]
<name>: not delivered via <path>: <failure>` and answers 502 `not-delivered`; a delivered send
logs `delivered via <path>`. The outbox shows **Not delivered — resend**, and Resend uses a fresh
`clientMessageId`. The eaten-message watcher counts a redelivery only when it returned `ok: true`.
One silent path remains by design: Herdr reports `agent_prompt_stalled`/`timeout` on an
`agent.prompt` wait as delivered, because it types the text and Enter before it watches, and
its contract says never to re-send. The frontend's 4-minute "Not found in transcript" timer is
the only cover for that case.

## Degraded mode (PAN-4279)

When a tab loses touch with its server, the dashboard never blocks the UI. The
last-known pages stay mounted, visible and navigable, and one banner reports
the outage. `lib/connectionState.ts` is the single source of truth: a Zustand
store that holds the inputs and derives one **connection phase** from them.

| Phase | Meaning | Banner (`components/DegradedModeBanner.tsx`) |
| --- | --- | --- |
| `restarting` | A planned restart is in progress (`dashboardLifecycle.active`). | "Overdeck server is restarting — showing data from HH:MM", plus the lifecycle issue and reason. |
| `unauthorized` | The session mint returned 401. | "Dashboard session could not be established (HTTP 401) — see docs/DASHBOARD-AUTH.md", with **Retry**. |
| `unreachable` | The server does not answer HTTP. | "Can't reach the Overdeck server — showing data from HH:MM", with **Retry** and **Force Restart**. |
| `delayed` | HTTP answers, but the `/ws/rpc` domain stream is reconnecting or has not bootstrapped. | "Live updates are delayed — reconnecting · showing data from HH:MM", with **Retry**. |
| `live` | HTTP answers and the stream has bootstrapped. | Nothing. After any degraded phase, "Reconnected" shows for 2.5 s. |

Precedence is `restarting` > `unauthorized` > `unreachable` > `delayed` > `live`.

- **Reachability rule.** A response is *reachable* when its body is JSON with a
  string `status` field, at any HTTP status. `/api/health` answers 503 with
  JSON in its "incoherent" states, and the server is still up then. A network
  error, a 3 s timeout, or a non-JSON body (a proxy's 502/503/504 HTML page) is
  *unreachable*. Two sources write reachability: the App's 5 s `/api/version`
  poll (2 failed polls mean unreachable, one success means reachable) and
  EventRouter's `probeServerHealth()` (`GET /api/health`). EventRouter probes on
  every stream retry, staleness strike and bootstrap failure, so a stream
  outage reads `delayed`, never `unreachable`, while HTTP still works.
- **Freshness stamp.** `HH:MM` is `lastLiveAt`: the time of the last successful
  bootstrap or applied domain-event batch. Before any bootstrap it is the
  cached snapshot's timestamp (`loadSnapshotCacheEntry()` in
  `lib/snapshotCache.ts`). The clause is omitted when no time is known.
- **First-load screen.** `App/BackendConnectionBoundary.tsx` renders the
  first-load screen ("Can't reach the Overdeck server" or "Overdeck server is
  restarting", "The dashboard will load as soon as the server answers.",
  Retry) only when the tab has no snapshot at all (no cache, no bootstrap) and
  the phase is `unreachable` or `restarting`. It is the only full-page outage
  state. With a snapshot, the boundary always renders its children. It keeps
  one duty: when the phase leaves `unreachable`/`restarting`, it invalidates
  every React Query so queries that failed during the outage refetch.
- **Bootstrap.** EventRouter races `getSnapshot` against a 20 s timeout
  (`BOOTSTRAP_TIMEOUT_MS`). A timed-out or failed attempt sets the stream
  down, probes health, and schedules a reconnect on a fresh transport with the
  existing backoff (2 s doubling, 30 s cap, ±20 % jitter). Retries continue
  forever; there is no give-up window. A generation counter makes a superseded
  attempt a no-op, so a late answer never overwrites newer state. The 2 s
  fallback poller runs until the first bootstrap succeeds, and it stands down
  while a backoff reconnect is scheduled.
- **Retry.** The banner's and first-load screen's Retry calls
  `requestReconnect()`. EventRouter registers that on mount: it abandons any
  in-flight attempt (even one that will never settle), resets the backoff, and
  reconnects on a fresh transport. The banner's Retry also refetches the
  `backend-health` poll.
- **Write actions.** While the phase is `unreachable` or `restarting`, every
  issue action with a server endpoint (`ISSUE_ACTIONS` entries with
  `endpoint !== null`) is disabled but stays visible, with the reason "Can't
  reach the Overdeck server — available again when it reconnects."
  (`blockedOffline` in `useIssueActions.ts`). `delayed` blocks nothing, because
  HTTP works. Mutations outside the issue-action registry keep failing with
  their own error toasts.
- **Held composer messages.** A prompt submitted while `unreachable` or
  `restarting` is not POSTed. `holdSend` keeps it in the composer outbox as
  "Waiting to send — will send when the server reconnects", and it is sent
  once, oldest first, when the phase returns to `live`, keeping its
  `clientMessageId`. A `/pan` command is not held: it shows "Can't reach the
  Overdeck server — commands need a live connection" and keeps the draft. Held
  messages live in the in-memory composer store, so a full page reload drops
  them; drafts already persist in localStorage.
- **Asset recovery.** `recovery.tsx`'s "Reconnecting to the dashboard…" modal
  shows only for the `root_error_boundary` trigger, when React itself is down.
  Chunk and asset load failures poll `/` silently, then reload.

Outage surfaces that PAN-4279 removed or folded into the banner: the
`display: none` route wrapper and "Waiting for backend data" page, the
"Connection lost — reconnecting…" pill, both EventRouter "Server unreachable —
Retry" overlays (the 3-minute fallback window and the 6-retry escalation), and
the AppChrome restart, "Backend is unreachable" and "Backend is back up"
banners. Kept on purpose: the `RootErrorBoundary` crash fallback and the reload
circuit-breaker overlay (crashes, not connectivity), `XTerminal.tsx`'s inline
reconnecting status, and region-scoped boundaries (`LoadingBoundary`,
`ProjectMembershipBoundary`, the Flywheel unreachable chip). Browser coverage
is `src/dashboard/frontend/tests/pan-4279-degraded-mode.spec.ts`, which runs on
an isolated dashboard.

## Agents page: Live and History (PAN-3920, PAN-4197)

`/agents` opens the **Live view** (`components/Agents/live/`): what is running and progressing,
what needs the operator, and what waits in the pipeline, with nothing finished. Rows fall into
three sections, **Needs you**, **Live** and **Waiting**, each row with one reason (table below).
Rows with nothing nameable to wait on (idle with no blocker, or stopped) are not Waiting: they
fold into a collapsed **Idle** footer (`▸ N idle sessions · History`, the choice kept in
localStorage) that the header does not count. A list pane (at least 360px) and a collapsible
preview pane sit in `react-resizable-panels`, saved in localStorage under the layout id
`agents-live`. The preview is `DirectoryDetail` (header, issue context, live transcript), dated
from the runtime snapshot like the row. A click selects and previews (`?entry=`, replaceState);
**Open** (neutral, shown on hover or selection), Enter or a double-click goes to the live thing:
a conversation's `/conv/<name>`, or the agent's session pane in its project's Command Deck (the
`agent` pane the rail tree opens, then `/command-deck/<project>`); an agent with no registered
project falls back to `/issues/<id>`. The header shows the counts in the glyph vocabulary
(`● 6 live  ◐ 1 need you  ○ 3 waiting`; zero counts dimmed, a nonzero need-you in its tone and
clickable to scroll to the section), the preview toggle, and one **History** link. `?view=history` (and the old `?view=directory`) opens the Agents Directory,
described below as History; any other `view` opens Live. The Grid, Table and Timeline views are
gone: the Grid showed every non-dead strike as running. The page is still behind the
experimental-features gate.

**Live scope.** The Live view reads `GET /api/agent-directory?scope=live`
(`buildLiveAgentDirectory`), which has no time window. It answers
`{ generatedAt, windowHours: 0, scope: 'live', entries }` and keeps an entry when:

1. its state is live (`working`, `idle`, `blocked`, `unknown`);
2. it is a native agent with a pause gate (`pause`, below) and its issue's derived state is not
   `merged` or `closed` (an agent with no issue is kept);
3. it is the newest (by `startedAt`, then id) `work`/`strike` agent of an issue whose derived
   state is `in-review`, `changes-requested` or `ready`.

Every ancestor of a kept entry is re-added, and the sort is the window answer's. In both scopes a
native agent whose id is a conversation's tmux session is that conversation's own pane and is
listed once, as the conversation. The derived
states come from `getSharedIssueService().listDerivedStates()` on the server, so the client never
receives the full history to filter. The answer is memoized 3 s in its own cache; a `scope` other
than `live` answers 400, and `windowHours` is ignored with `scope=live`. The window answer carries
`scope: 'window'`. Every native agent entry whose `state.json` has `paused: true` carries
`pause: { by, reason, since }` in both scopes: `by` is `operator` for `isOperatorPause()`,
`scheduler` for `yieldedByScheduler`, else `machine`; `reason` is `pausedReason`; `since` is
`pausedAt`, else `yieldedAt`.

**Lanes and successors (PAN-4223).** A conversation entry's `parentId` is `conv:<parent name>`
whenever its row has a parent link (`parent_conversation_id`), so gauntlet lanes nest under the
conversation that launched them and handoff/fork successors under their predecessor. A lane entry
carries `lane: { run, key, role, iteration, reportStatus }`; a successor carries `continuesFrom`
(the predecessor's legacy conversation id, linked as `/conv/<id>`). `keepWithAncestors` never
climbs a **succession edge** (a conversation entry with a `parentId` and no `lane`): a live
successor keeps its own row and does not pull its ended predecessor into the live scope, while a
live lane still pulls in its ended launcher. In the Live view a lane with its parent on the page is
a child line of the parent row (a needs-you lane also keeps its own row), and a successor always
keeps its own row with its `continues ←` link. History nests both by `parentId`, capped at two
levels; a deeper row renders at the second level with `flattenedFrom` naming its real parent.

**Command Deck conversation groups (PAN-4223).** `conversation-tree.ts` nests every conversation
whose parent link names a row in the rendered list, lanes and successors alike, in pre-order at
display depth `min(natural depth, 2)`; a deeper row keeps its pre-order place and shows a marker
naming its real parent (`↳ continued from #<id>` or `lane of #<id> · <run>`), and a row whose
parent is not in the list renders at top level with the same kind of marker. A top-level group
ranks where its best member would sit in the flat active-then-inactive order, so an ended
predecessor with a live successor ranks with the successor. Only top-level rows carry a collapse
toggle, which lists the group's non-zero counts. A group defaults to expanded while any descendant
is active and collapsed otherwise; the viewer's collapsed groups persist in localStorage under
`commandDeck.groups.collapsed` (a JSON array of top-level conversation names).

**Reasons.** `live-model.ts` classifies each row on the client from the entry plus real-time store
facts: the issue's derived state, the agent snapshot's pending inputs, and the runtime snapshot.
The first match wins. "Issue agent" means `kind: 'agent'`, an issue, and role `work` or `strike`.

| # | Condition | Reason | Section | Tone |
| --- | --- | --- | --- | --- |
| 1 | `blocked` | question waiting / permission prompt / plan approval (a conversation's terminal permission prompt, main agent or subagent, also has its own dialog: see "Terminal permission prompts and held messages") | Needs you | needs-you |
| 2 | operator pause | paused by you | Needs you | needs-you |
| 3 | issue agent, attention `api-error`, or any entry with `providerError` | API error or usage limit | Needs you | stuck |
| 4 | issue agent, attention `stuck`, `idle` | stuck · idle `<age>` | Needs you | stuck |
| 5 | issue agent, issue `ready` | ready to merge | Needs you | needs-you |
| 6 | `working` | `<tool>` / thinking / working | Live | live |
| 7 | remote and `unknown` | running on Fly | Live | live |
| 8 | scheduler or machine pause | held by Overdeck | Waiting | waiting |
| 9 | issue agent, PR checks red | CI failed | Waiting | stuck |
| 10 | issue agent, issue `changes-requested` | changes requested | Waiting | waiting |
| 11 | issue agent, issue `in-review` | in review | Waiting | waiting |
| 12 | issue agent, PR checks pending | CI running | Waiting | waiting |
| 13 | `idle` | idle — no known blocker | Idle | waiting |
| 14 | otherwise | agent stopped | Idle | waiting |

`deriveIssueState`'s fourth attention value, `work-not-started` (PAN-4399, a
gave-up or stalled post-planning auto-start read from the workspace journal —
see "Work agent not started" in `docs/PIPELINE-GATES.md`), never appears in
this table: it is derived only when there is no live pane at all, so no row
here can carry it. Command Deck's state badge (`featureStateBadge.ts`) and
the Needs-you strip's "Start work" card (`NeedsYouStrip.tsx`) render it
instead.

Needs you sorts oldest wait first. Live sorts by start time so rows never reshuffle under the
pointer as agents write output; Waiting and Idle sort most recent activity first. A subagent
nests under its parent row (at most three lines, then `+N more`, each with its state glyph). A
row's first line is the issue id and title (the role only when it is not `work`); its second
line is the reason, then what it is doing or waiting on, then the age. For a live agent that is
its runtime snapshot's tool name (`currentTool`, bare, no longer `running <tool>`) and, when the
hook reported one, the tool's own description (`currentToolDescription`, e.g. `Bash · Commit
WI-7`) — never the agent's raw pane output; there is no output subscription on this row anymore.
A row's `since` (and its quiet age) is the newest activity across the row and every one of its
subagents, not just its own: an orchestrator with a working subagent is never quiet just because
it made no tool call itself. `quiet <age>` replaces the age in the stuck tone past five silent
minutes — the two never render together. Tones are the `--state-*` tokens in `index.css` (live blue and
never green, needs-you amber, stuck red, waiting warm neutral, done emerald); see the style
guide's "State Tokens". The same tokens tone the History row badge.

A conversation entry is keyed in the directory by `conv:<name>`, but its runtime facts
(`agentRuntimeById`) are keyed by its tmux session — `DirectoryEntry.runtimeId` carries that
session id when it differs from `id`, and the Live view looks runtime facts up by
`runtimeId ?? id`. `DirectoryEntry.providerError` (`{ message, at }`) is set on a conversation
whose transcript's last turn ended in a provider error (billing, a usage limit) while the
session otherwise looks idle (`readConversationProviderError`, `src/lib/overdeck/`) — reason 3
above fires on it exactly like an issue agent's `api-error` attention, with the error's own
message and timestamp.

When there are no visible rows, the Live view renders one column, never the two-panel layout: the
loading/error status or the empty message (`Nothing is running or waiting. Finished work is in
History.`), followed by the Idle footer when there are idle sessions — no preview pane, so there
is never a second, contradictory "Select an agent…" message alongside it. The preview's own
Agents rail (a conversation's subagent list, `SubagentRail`) starts collapsed there regardless of
what the user left it at on the conversation's own page — see `docs/CONVERSATION-SUBAGENTS.md`.

### History: the Agents Directory

`/agents?view=history` opens the Agents Directory: a tree (location → project → issue, plus one
"Conversations" group per project), a list of the selected node's entries, and a detail pane
with the entry's transcript and issue context. The three panes are `react-resizable-panels`,
saved under the layout id `agents-directory`, and the tree pane collapses. Under the 24h/7d
toggle the tree says `Live agents always show. Finished ones show if active in the last 24 hours.`
(or 7 days), and each node's `live/total` count has the title `<n> live of <m> shown`.

**Derived on read; stores nothing.** `GET /api/agent-directory?windowHours=<1..168>` (default
24) recomputes the entries from `~/.overdeck/agents/*/state.json`, the backend pane inventory,
the conversation list (500 rows, the same enrichment `GET /api/conversations` shares), transcript files and `remote-state.json`
(`src/dashboard/server/services/agent-directory.ts`). Nothing it computes is written, and no
`agent_directory.*` event exists. The server memoizes each window's response for 3 s and shares
one in-flight build between concurrent callers. `windowHours` outside 1–168 answers 400.

Each entry with an issue carries `issueTitle` from the shared issue service's tracker cache
(never a live tracker call; `null` when the cache does not hold the issue). A subagent's `model`
is read from the tail of its own transcript (`src/lib/conversations/transcript-model.ts`,
memoized per file mtime), else its parent's. The row badge adds the issue's derived attention on
top of the entry state: the issue's idle work agent shows `stuck` or `API error` exactly when
`deriveIssueState` reports that attention. The UI never prints `unknown`.

Sources: native agents (every `state.json` except `conv-*` dirs), pane-only agents (panes with an
`agentId` or `issue` token but no `state.json`, i.e. `pan spawn` panes), conversations, the
Claude/Codex subagents of every non-stopped conversation and agent, and external agents (every
`~/.overdeck/agents/ext-*/registration.json`, `src/dashboard/server/services/agent-directory-external.ts`).
An external agent's `parentId` naming a conversation's tmux session nests it under that
conversation, like a worker's. Agents are joined to panes by
`BackendPane.agentId` (see TERMINAL-BACKENDS.md "Pane metadata").

| Entry | `working` / `idle` / `blocked` / `done` / `unknown` | `stopped` |
| --- | --- | --- |
| Agent (native or pane-only) | the pane's state; a remote agent is `unknown` | pane `exited`, or no pane; a remote agent whose `remote-state.json` status is `stopped` or `error` |
| Conversation | `blocked` when input is pending, else `working` when a turn runs, else `idle` | session not alive |
| Subagent | `working` when its transcript changed in the last 120 s and the parent is not stopped; else `done` | — |
| External agent | `working` when the recorded pid is alive with its recorded start time (D21); else `done` when the transcript's last turn is complete; a pid-less registration is `working` while its transcript changed in the last 120 s | dead pid (or none) and an incomplete transcript |

Live entries (not `stopped`/`done`) are always listed; the rest only when their last activity is
inside the window, and a parent is kept whenever one of its children is. The frontend polls every
5 s while the tab is visible and refetches (at most every 2 s) when the pane inventory changes.
Transcripts reuse existing routes: `/api/agents/:id/conversation` (with `?subagentId=` for an
agent's subagent) and the conversation routes. User guide: `reference/agents-directory.mdx`.

**External agents (PAN-3920 Phase C).** An agent another tool launched is recorded, never
inferred, by a write-once `~/.overdeck/agents/ext-<source>-<slug>/registration.json` (flag `wx`)
plus the append-only `sessions.json`, whose `path` makes the agent transcript route serve it
unchanged (the route takes the registration's `cwd` as the workspace and makes no tmux lookup).
The registration holds facts only: who launched it, the external id, harness, model, cwd, issue,
parent, label, pid and the pid's start time (field 22 of `/proc/<pid>/stat`). Liveness (D21) is
`/proc/<pid>/stat` existing with the same start time, `kill(pid, 0)` without `/proc`, and no
subprocess. Two writers share one core (`src/lib/agents/external-register.ts`,
`external-registry.ts`): `pan worker register` / `POST /api/workers/register` (internal-token
auth; the `codex-plugin` source is reserved), and the Codex-plugin adapter
(`services/codex-plugin-importer.ts`), which the primary dashboard starts from `main.ts`. The
adapter scans `~/.claude/plugins/data/codex-openai-codex/state/*/jobs/*.json` every 15 s
(`OVERDECK_CODEX_PLUGIN_DATA` overrides the root), registers each job the first time it sees it
with the parent resolved then (conversation by Claude session, else the agent or conversation
whose `sessions.json` holds that session, else `claude-session:<uuid>`), and links the job's
Codex rollout once its thread id is known. It never writes under `~/.claude/plugins`. Cleanup
keeps `ext-*` directories (`isExternalAgentDirectory`).

File safety (`src/lib/agents/external-paths.ts`): every file another tool names is `realpath`ed
and must be a regular file under its root, checked at registration and again before every read,
because it can be replaced later. Transcripts: `~/.claude/projects`, `$CODEX_HOME/sessions`
(default `~/.codex/sessions`), `~/.overdeck/agents`; the job log: the plugin data root. Reads
open with `O_NONBLOCK` and re-check the descriptor with `fstat`, so a FIFO never pins a libuv
thread. A registration is written to a temp file, fsynced and `link()`ed to `registration.json`,
so the name only appears with complete content; a file that does not parse counts as absent and
is replaced. The transcript link is appended with the async `appendSessionIdToHistoryAsync`.

## Awareness feed (PAN-4301)

The Command Deck's right-hand rail is `SessionFeedSidebar`
(`src/dashboard/frontend/src/components/sessionFeed/`) with three scopes, Needs
you, Project and Global. Needs you is the `DecisionsPanel`. Project and Global
show one merged feed with three tabs: All, Chats and Activity. The Git, Files and
Comments tabs are gone because no source ever wrote rows for them; a stored
hidden tab falls back to All.

Sources, merged in `useMergedFeed.ts`:

- `GET /api/conversations`, polled every 30 s (`useConversationFeed.ts`).
- `recentActivity`, the `activity.entry` events in the dashboard store, capped
  at 50 (`useActivityEntryFeed.ts`).
- Memory observations (`useObservationFeed.ts`).

**All shows transitions.** A conversation card is dated by a lifecycle fact:
`endedAt` when the conversation ended, otherwise `createdAt`, labelled `ended` or
`started`. It is never dated by transcript activity (`lastActivityAt`, the
transcript file mtime), which moves on every write and used to pull every busy
conversation back to "Just Now" on each poll. All keeps a conversation only when
that lifecycle timestamp is inside a 24 h window (`FEED_WINDOW_MS`).

**Chats is a recency index.** It keeps root conversations that are alive or were
active in the last 24 h, re-dated to the recency timestamp
(`lastActivityAt ?? lastAttachedAt ?? createdAt`, labelled `active`), newest
first.

**Gauntlet runs are one card.** Lane conversations never render as their own
cards. `groupGauntletRuns` (`gauntletRunEntries.ts`) folds them into one run card
per `(projectKey, gauntletRun)` with a counts line (`6 builders · 6 working`), a
state dot and the latest event. The card's time is the newest lane report,
failed start, end or launch, never transcript activity. A run card shows in All
and Chats while any lane is alive or its latest event is inside the window. The
card opens the launching conversation; its expand control lists the lanes and
fetches `GET /api/lanes?run=<run>` only on expand, once, with no polling, for git
facts and archived lanes.

**Other rules.**

- Activity entries that name an issue collapse to one card per issue: the newest
  entry's headline, plus `N steps` for the entries folded into it.
- Singleton runners (`flywheel-orchestrator`, `sequencer-runner`,
  `SINGLETON_AGENT_IDS` in `@overdeck/contracts`) never render.
- The conversation card's status dot is derived from the row: waiting when the
  session is alive with pending input, active when it is alive and working,
  idle otherwise.
- **Project scope** keeps an entry when it is system-wide activity, its issue is
  one of the project's issues, it is a conversation in the Command Deck's
  resolved project conversation set (`projectConvIdSet`, built with
  `resolveEffectiveProjectKey`), or it is a run card with a lane in that set.

Everything above is a selector over existing rows and events; nothing is stored.
`activity.entry` is meant for news (something shipped, failed, finished or needs
the operator); progress telemetry belongs in `activity.detailed`. Moving the
remaining telemetry emit sites is tracked in PAN-4306.
