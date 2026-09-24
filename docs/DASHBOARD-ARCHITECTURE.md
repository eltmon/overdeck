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
- The supervisor keeps the latest `patrol-done` report in memory, across child restarts. Nothing is written to disk.
- `GET /api/deacon/status` and `GET /api/cloister/status` compose `deaconLite` from that report: `running` is whether the child process is running, `intervalMs` is 60000, and `lastRunAt`/`lastRunError` are the relayed report.
- The `pan up` supervisor watchdog restarts the dashboard when `deaconLite.lastRunAt` is older than three intervals. A null `lastRunAt` never produces a verdict.

**Two WebSocket endpoints:**
- `/ws/rpc` — Effect RPC (PanRpcGroup): domain events, snapshots, replay. Uses typed Schema.
- `/ws/terminal?session=<name>` — Raw WebSocket: live PTY terminal streaming via `ws` library.
  Terminal data bypasses Effect RPC because the RPC serialization layer can't handle
  high-throughput binary-like terminal data reliably.

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
- `wsTransport.ts` — Effect-based RPC client with auto-reconnection
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
  `{ status: 'loading', code: 'snapshot_loading' }` and `Retry-After: 5`. That
  503, a failed or timed-out request, and a proxy 502/503/504 are transient:
  the banner keeps retrying them (backoff capped at 30s, never sooner than
  `Retry-After`), shows "retrying automatically" instead of the error alert, and
  keeps its last good result meanwhile. A typed `status: 'unavailable'` body or
  another HTTP error is a settled answer and shows the alert with its Retry
  button. The membership query also joins the reconnect refetch above.

**Simple home conversation composer:** `components/simple/TalkItThrough.tsx`
starts a discuss-first conversation through `POST /api/conversations` and opens
`/conv/:name`. The description uses a full row, with the project selector, model
picker, and action wrapping below it. The model picker follows the configured
provider harness unless explicit harness permutations are enabled. Click and
Enter share a pending-launch guard. Launch errors appear below the controls;
the draft stays available for retry. Browser coverage lives in
`src/dashboard/frontend/tests/talk-it-through.spec.ts`.

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
- The `read` lane handles interactive lookups, the `long` lane handles bulk scans and
  reconciliation, and the `semantic` lane isolates embedding and semantic-search work.
  The `parse` lane runs `parseTranscriptSnapshot`. Transcript parsing is CPU-bound and
  can take seconds, so its own lane cannot block interactive reads or wait behind bulk
  sweeps.
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
- Jobs that wait or run for more than one second emit
  `[db-jobs] slow: op=<operation> lane=<lane> waitMs=<n> runMs=<n> depth=<n>`.
  The line identifies whether queue delay or worker execution caused the slowdown.
- `costReconcileSweep` walks and parses transcript files in the `long` lane. The main
  thread records bounded 250-event progress batches through the canonical write doors and
  acknowledges each batch before the worker continues its single-pass scan. This limits
  transfer memory without repeated parsing while preserving EventBus publication and
  durable skip-cache updates.
- Cost polling, conversation-list ledger totals, and search counters use shared worker
  snapshots. Concurrent refreshes coalesce. Cost snapshots refresh after 15 seconds;
  search counters refresh after 60 seconds. Successful values remain usable for at most
  five minutes during refresh failures, with a five-second retry backoff. Search
  configuration, provider availability, and runtime health are still read per request.
- Agent resource costs use one grouped worker query and a 15-second shared snapshot,
  invalidated when agent membership changes. Hourly burn remains twice the sum in the
  last 30 minutes, with the inclusive cutoff and rounding to cents preserved. SQLite's
  more accurate summation can correct a cent at a half-cent floating-point boundary.
  Resource polling no longer materializes each agent's full ledger history.
- `subscribeConversationMessages` resolves transcript paths on the main thread and
  shares worker parse results across subscribers. Codex consumes appended records;
  other full-parser harnesses still parse changed files in the worker. Clients receive
  complete initial history, then changed message/tool rows and metadata. Explicit resets
  replace history after truncation/replacement, and metadata snapshots clear removed
  plans or compact boundaries. Full tool results remain accessible.
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
- `GET /api/conversations/:name/messages` serves registered conversations only. It
  never scans agent directories or global session UUIDs to resolve an agent-backed row.
- HTTP acceptance and transcript confirmation are distinct. A late echo does not prove
  delivery failure. Unknown delivery preserves the operator's text; confirmed rejection
  retains the existing recovery actions. The client bounds the request and body read to
  120 seconds, and reconciles late echoes using message identity or text/time matching.
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
- Conversation sends carry `clientMessageId`; retries preserve it and set `retry: true`.
  The server coalesces matching concurrent requests and retains their result, including
  ambiguous failures. Changed text or command confirmation requires a new ID. Receipts
  are bounded to 2,000 entries and 24 hours. A retry whose receipt was lost to restart or
  expiry is refused with an unknown outcome, never injected as a new message. This is
  safe retry handling, not an exactly-once guarantee from the underlying harness.
- `pan pause sequencer-runner` prevents both explicit and automatic sequencer starts.
  The launcher checks the pause before preparation and immediately before spawning.
  Resume permission requires `pan unpause sequencer-runner`.

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

## Agents Directory (PAN-3920)

`/agents` opens the Agents Directory by default: a tree (location → project → issue, plus one
"Conversations" group per project), a list of the selected node's entries, and a detail pane
with the entry's transcript and issue context. The card grid, table and timeline stay behind
`?view=grid|table|timeline`. The page is still behind the experimental-features gate.

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
