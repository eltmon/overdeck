# Terminal backends

The terminal backend owns agent terminals: it creates the issue workspace, starts agents in panes,
delivers prompts, waits on agent state, streams terminal output, and reports the live inventory.
Nothing about a running agent is stored — the backend is read live and matched to issues by
workspace and pane metadata (PAN-3917, FR-3 to FR-5, FR-17, D10).

Two adapters implement one contract:

| | Herdr (default) | tmux |
| --- | --- | --- |
| Module | `src/lib/terminal-backends/herdr.ts` | `src/lib/terminal-backends/tmux.ts` |
| Transport | NDJSON over `~/.config/herdr/sessions/<instance>/herdr.sock` | `tmux -L <instance>` |
| Agent states | `idle`, `working`, `blocked`, `done`, `unknown` (Herdr's own) | `working`, `idle`, `exited` from `src/lib/agents/liveness.ts` |
| `wait` | `agent.wait` | `unsupported` — tmux has no lifecycle state |
| `observe` / `control` | `herdr terminal session observe\|control` | `unsupported` — the dashboard PTY supervisor serves tmux |
| Metadata tokens | `pane.report_metadata` | `unsupported` — the agent launch metadata is their source |
| Native resume | `unsupported` — protocol 22 has no resume method | `unsupported` |

## The contract

`src/lib/terminal-backends/types.ts` (W2) defines it; `packages/contracts/src/terminal-backend.ts`
holds the shared vocabulary (`TerminalBackendName`, `AgentState`, `AgentRole`, `PaneTokens`,
`BackendAgentSnapshot`). Every operation returns an Effect whose success value is either a typed
result or `{ unsupported: true, reason }` — an operation an adapter cannot perform is a **value**,
not a throw. The error channel carries only genuine failures (socket down, tmux command failed).

Operations: `workspaceFor`, `startAgent`, `prompt`, `wait`, `observe`, `control`, `list`, `events`,
`reportMetadata`, `close`, `resume`.

## Selection (D10, PAN-3956)

Selection is **policy**; availability is a separate **probe**. Neither ever turns a missing Herdr
into a tmux selection.

`selectTerminalBackend(config)` in `select.ts` returns `{ backend, source, diagnostic }`, in
precedence order, and never touches the filesystem:

1. `OVERDECK_TERMINAL_BACKEND=tmux|herdr` (`source: 'env'`) — the explicit override, above config.
   An unrecognized value is ignored with a warning. Every harness that spawns real agents under an
   isolated home sets it to `tmux`, and so does the unit-test setup (`tests/setup.ts`).
2. `terminal.backend` in `~/.overdeck/config.yaml` (`source: 'config'`).
3. Otherwise `herdr` (`source: 'default'`).

`hostTerminalBackendName()` memoizes that policy per process; a failure reading config falls back to
`herdr`, never `tmux`.

`probeHerdrAvailability()` answers whether Herdr can serve **right now**: the `herdr` binary on
`PATH` or in `~/.local/bin`, **and** *this instance's* session socket. No subprocess — `fs.access`
only — and never memoized, so a session server started after dashboard boot is usable at once.

What an unavailable Herdr does:

- **Launch:** `resolveLaunchBackend()` (and so `launchAgentPane`, `agentPaneExists`, `pan spawn`)
  throws `TerminalBackendUnavailableError`, whose message names the reason, `pan install`, and
  `terminal.backend: tmux`. `closeAgentPane` still kills a legacy tmux session of the agent's name;
  read paths (`liveAgentInventory`, the terminal bridge, `closeIssuePanes`) read "nothing".
- **Boot:** the dashboard logs exactly one `[terminal] backend=… source=…` line
  (`describeTerminalBackendBoot`), with `console.error` and `UNAVAILABLE:` when Herdr is selected
  but unavailable.
- **Inventory:** the backend inventory never reads tmux on a Herdr host; it serves the last-known
  panes and warns once per failure streak.
- **Doctor:** `pan doctor` reports the `Terminal backend` row as an error, so it exits 1.

Opting into tmux is explicit: `terminal.backend: tmux`. The user-facing page is
[`configuration/terminal-backend.mdx`](../configuration/terminal-backend.mdx).

Adapters register themselves at import time; `registry.ts` resolves a name to an adapter and throws
with the missing import when nothing registered it.

`src/lib/terminal-backends/launch.ts` is the one launch path: it resolves the backend, finds or
creates the issue workspace, starts the pane, and stamps the tokens. Every launcher goes through
it, so none of them can forget a token — see "Spawn paths" below for the full list.

### Session naming and isolation

The Herdr session name is the **per-home instance name**, `managedInstanceName()` in
`src/lib/instance-name.ts` — the same value `tmux -L` uses as its socket name:

| `OVERDECK_HOME` | instance | Herdr session / socket | tmux socket |
| --- | --- | --- | --- |
| `~/.overdeck` (default) | `overdeck` | `~/.config/herdr/sessions/overdeck/herdr.sock` | `tmux -L overdeck` |
| anything else | `overdeck-<sha1(home)[0..8]>` | `~/.config/herdr/sessions/overdeck-<hash>/herdr.sock` | `tmux -L overdeck-<hash>` |

It is resolved at call time, never at module load, because `OVERDECK_HOME` is set per process.

This is the Herdr half of the PAN-3673 rule: **a derived per-home instance must never take over the
default one.** The availability probe requires *that* instance's socket, so a process serving a
`/tmp` home (a test, an isolated verification stack) cannot see the live `overdeck` session — it
either runs on an explicit tmux policy or fails to launch with `TerminalBackendUnavailableError`.
Before this, any test process on a host with the `herdr` binary and a live `overdeck` socket
selected Herdr and spawned real agents into the operator's session.

A systemd unit that serves the default home therefore runs `herdr --session overdeck server`, which
is correct precisely because `~/.overdeck` owns the `overdeck` instance. A second Overdeck instance
needs its own unit with its own `--session overdeck-<hash>`; it must not reuse the default unit or
the default session name.

### Host setup (PAN-3956)

`pan install` and `pan sync` own the Herdr host setup (`src/lib/herdr-setup/`); `pan up` makes sure
the session server runs. All three skip under an explicit tmux policy, `CI`, Vitest, or
`pan install --skip-herdr`.

| Piece | Where | Notes |
| --- | --- | --- |
| Binary | `~/.local/bin/herdr` | Vendor installer (`https://herdr.dev/install.sh`); stable channel. `pan install` updates when `https://herdr.dev/latest.json` is newer; `pan sync` only when no session server runs for this home. |
| Config | `~/.config/herdr/config.toml` | `[session] resume_agents_on_restore = false`, edited line by line, checked by `herdr config check`, reloaded with `server reload-config`. |
| Session server | `<session>-herdr.service` (`overdeck-herdr.service` for the default home) | systemd user unit, else a detached `herdr --session <session> server` logging to `~/.overdeck/logs/herdr-<session>.log`. |
| Integrations | pilot set `pi`, `omp`, `kimi` (≥ 0.14.0), `opencode` | Installed only when the harness binary resolves. `claude`, `codex`, `hermes` are never installed or removed. |

Nothing ever stops or restarts a running session server — a restart closes every agent pane.
`pan doctor` reports `Terminal backend`, `Herdr binary`, `Herdr server`, `Herdr config`, and one
`Herdr integration: <target>` row per target.

## Detection policy per harness (PAN-3917 W12)

Herdr's agent detector reads the pane's **foreground process** and matches it against its own agent
manifest. That decides how a launch is made, per harness, in `detectionPolicyFor`
(`src/lib/terminal-backends/launch.ts`) — the launcher puts the answer on the start spec
(`StartAgentSpec.detection`) and the Herdr adapter branches on it.

| Harness | Pane foreground process | Detection | How `startAgent` ends |
| --- | --- | --- | --- |
| `claude-code` | `claude` (the real CLI; the PTY supervisor is refused on Herdr) | **required** | waits for detection (~2s live), `agent.rename` binds the Overdeck agent id |
| `codex` | `node dist/codex-app-server-host.js` (or the codex TUI under `codex.transport: tui`) | not required | **pane-bound**: stamp, send the launcher, return |
| `acp` / `opencode` | `node dist/acp-host.js` | not required | pane-bound |
| `kimi-code` | the kimi launcher/supervisor | not required | pane-bound |
| `ohmypi` / `muse` | `omp` / the muse TUI, both under Overdeck's wrapper | not required | pane-bound |

A **pane-bound** launch splits the pane, stamps `pane.report_metadata` (the four tokens plus
`agentId`, and `title` / `display_agent` so the Herdr UI still names it), sends the launcher, and
returns the pane reference immediately. Herdr's agent state for that pane stays `unknown`, which is
the truth. Nothing waits for a detection that cannot happen — waiting for it is what killed
`agent-pan-3705-review` (codex, gpt-5.6-sol) 61s after launch on 2026-09-19 while its app-server
host was already connected and writing `appserver-events.jsonl`.

Everything downstream follows the pane instead of the agent record:

- **Inventory** (`listHerdrAgents`) reads `agent.list` *and* the session snapshot's panes, keyed by
  the `agentId` token, so a token-stamped pane with no detected agent is a live agent and a pane
  Herdr later detects is not counted twice. It deliberately stops at "the pane exists" — a census
  must not fan out one `pane.process_info` per pane; `isAlive` is the oracle that asks.
- **Liveness** (`probeHerdrAgentLiveness`, used by `isAlive`) falls back to the same token scan when
  `agent.get` says "no such agent", and then asks the pane's **foreground process**, because a Herdr
  pane OUTLIVES the process typed into it: the launcher is a child of the pane's shell, so a harness
  that exits leaves the pane sitting at `$`. Verified live — an idle pane reports its own shell
  (`foreground_processes = [bash]`, `pid === shell_pid`), a working one reports the harness or its
  host with a different pid. So: `absent` when the snapshot no longer lists the pane, `exited` when
  only the shell is left (a confirmed death, `pane-dead`), `alive` while a process of its own runs,
  `indeterminate` whenever a probe itself failed. This is the Herdr analog of the tmux oracle's
  process-subtree walk, and it is what keeps a claude-code agent whose name Herdr released from
  reading alive forever. `findHerdrAgent` applies the same check, so a dead-shell pane neither
  blocks a respawn (`agentPaneExists`) nor receives a message.
- **Delivery** — see "Message delivery routing" below.
- **Close** is by pane reference (`AgentState.paneId`, recorded the moment `startAgent` returns), so
  a spawn failure cleans up its own pane on either policy.

## Stopping an agent (PAN-3947)

Every stop path terminates the agent **through the terminal backend** — never by rewriting state
alone, and never by assuming a tmux session exists. Before PAN-3947, `stopAgent` ran only
`tmux kill-session`; on a Herdr host there is no such session, so `pan kill`, dashboard Stop and the
post-merge lifecycle wrote `stopped` while the pane and the idle harness in it stayed alive. Every
liveness reader still saw the agent, the next start was refused as "already running", and
close-out's DoD row 5 failed on "running agents" until the panes were closed by hand.

The primitives live in `src/lib/terminal-backends/launch.ts` and go through the adapter's `close`:

| Primitive | Herdr | tmux |
| --- | --- | --- |
| `closeAgentPane(agentId)` | `pane.close` on the agent's pane, found by live agent name, then by its `agentId` token — **with no liveness check**, so a residue pane whose shell is back at `$` closes too (`findHerdrAgentPane`). A same-name tmux session left from before the host moved to Herdr is killed as well. | `kill-session` through the tmux adapter, when the session exists. |
| `closeIssuePanes(issueId, { roles? })` | `pane.close` on every inventory pane whose `issue` token matches, optionally filtered by `role` — never an operator conversation pane (`conv-*`). | No-op — the callers' session-name scans already reach every tmux session, and a tmux pane carries no tokens. |

Both never throw; a Herdr socket failure closes nothing and the stop still completes.

Who uses them:

- **`stopAgent`** (async, `src/lib/agents/termination.ts`) — calls `closeAgentPane` after capturing
  output and before the orphan-launcher sweep. Every async caller inherits it: the dashboard
  Stop/Delete routes, recovery and restart, preemption, the closed-issue reaper, spawn-failure
  cleanup.
- **`pan kill` / `pan stop` / `pan pause`** — use the async `stopAgent`, and decide "running" and "live
  sibling" with `agentPaneExists`, not `sessionExistsSync`.
- **Dashboard Pause and Suspend** — probe with `agentPaneExists` and close with `closeAgentPane`.
- **Post-merge lifecycle** (`postMergeLifecycle` in `src/lib/cloister/merge-agent.ts`) —
  `closeAgentPane` for the work, planning and strike agents; `closeIssuePanes` with roles
  `review`, `test`, `uat` for the specialists.
- **Close-out teardown** (`teardown-workspace.ts`) and the closed-issue residue reaper
  (`reap-issue-residue.ts`) — `closeIssuePanes(issueId)` for every pane of the issue, after the
  tmux session-name sweep.

`stopAgentSync` is **tmux-only**: Herdr is an async socket, so the sync variant can kill a tmux
session but cannot close a Herdr pane. Its remaining callers are sync internals (`health.ts`
force-kill, the `concurrency.ts` emergency brake, `handoff.ts`, the memory governor's hard-band
shed); a new stop path must use `stopAgent`.

Stopping does not infer lifecycle state: supervisor-launched agents still write `stopped` from the
supervisor's own `exited` event, and liveness stays with `src/lib/agents/liveness.ts`, which now
sees the pane gone.

## Pane metadata (FR-5)

Every launcher stamps four tokens on its pane: `issue`, `role`, `harness`, `model`, plus `agentId` —
the Overdeck agent id. `role` is one of
`work`, `worker`, `review`, `test`, `uat`, `strike`, `plan`. An operator conversation carries **no**
`issue` token — that absence is also how the prompt guard recognizes an operator sender.
Overdeck's own `ship` role maps to the `uat` token role (`toPaneRole`).

`BackendPane.agentId` (PAN-3920) carries the Overdeck agent id into the dashboard's pane
inventory: on Herdr it is the pane's `agentId` token, else Herdr's live agent name — but only on
a pane that carries Overdeck tokens, because Herdr names every agent it detects (`codex-1`,
`claude-1`), the operator's own panes included; on tmux it is the session name of an Overdeck
session (agent state, or an `agent-`/`planning-`/`strike-`/`conv-` name). On Herdr `pane.id` is the
backend handle (`w1:p1`), not the agent name, so any join from an agent to its pane — the
Agents Directory's first of all — must match `pane.agentId === agent.id`, never `pane.id`.
A pane created by a live event gets its `agentId` on the next inventory refresh (at most 5 s).

## Spawn paths (PAN-3960)

Every path that starts an agent or a planner goes through `launchAgentPane`, so each one lands on
the backend the host selects **now** and stamps the same four tokens. None of them calls tmux
`createSession` directly; tmux lives only inside the tmux adapter.

| Path | Code | `role` token |
| --- | --- | --- |
| Work agents (`pan start`, `pan strike`) | `spawnAgent` in `src/lib/agents/spawn.ts` | `work`, `strike` |
| Specialists (review, test, ship, plan) and `pan review spawn-reviewer` | `spawnRun` in `src/lib/agents/spawn.ts` | `review`, `test`, `uat`, `plan` |
| Registered workers (`pan worker run`, PAN-3920) | `startWorker` in `src/lib/agents/worker/start.ts` → `spawnRun` | `worker` (plus a `parent` token when the worker has a parent) |
| Planning (`pan plan`, the plan phase of `pan start`, dashboard Start Planning) | `spawnPlanningSession` in `src/lib/planning/spawn-planning-session.ts` | `plan` |
| Planning continuation (a user message to a dead planner) | `POST /api/planning/:issueId/message` in `src/dashboard/server/routes/misc/planning.ts` | `plan` |
| Resume (`pan resume`, dashboard Resume, auto-resume) | `resumeAgent` in `src/lib/agents/resume.ts` | the agent's role |
| Restart (dashboard Restart and restart-all) | `restartAgent` in `src/lib/agents/recovery.ts` | the agent's role |
| Crash recovery (`pan recover`, dashboard Recover, the health force-kill path) | `recoverAgent` in `src/lib/agents/recovery.ts` | the agent's role |
| Message-triggered fallback relaunch (only while `ALLOW_SESSION_ROTATION_ON_RESUME` is on; it is off) | `messageAgent` in `src/lib/agents/messaging.ts` | the agent's role |

**Resume, restart and recovery relaunch on the host's backend, not the old pane's.** An agent that
last ran in a tmux session is relaunched as a Herdr pane on a Herdr host, and the other way round.
Before the relaunch, `closeAgentPane` closes whatever is left of the old one — on Herdr that
includes a same-name tmux session from before the host moved. Recorded `backend` / `paneId` on the
agent state are overwritten from the pane `launchAgentPane` returns; nothing reads them to choose a
backend.

Liveness on these paths comes from `src/lib/agents/liveness.ts` (`isAlive`), like every other
reader: resume treats a confirmed death as a crash, recovery leaves an `alive` agent alone, and a
`runtime-indeterminate` probe is never a death, so neither reaps on it.

Two tmux-only behaviors the planning path always had are kept, and are no-ops on Herdr
(`src/lib/terminal-backends/launch.ts`):

- `prepareTmuxServer(backend, vars)` starts the tmux server with a parked `overdeck-init` session
  and removes leaked variables (`GITHUB_TOKEN`, `LINEAR_API_KEY`, `CLAUDECODE`, provider keys) from
  its global environment — `-e` can set a variable but never unset one.
- `keepTmuxSessionOpen(pane)` sets `destroy-unattached off` and `remain-on-exit on`.

The planner's launcher keeps its `while true; do sleep 60; done` keep-alive tail on tmux only: in a
Herdr pane that loop is a non-shell foreground process, so the Herdr liveness probe would read a
finished planner as alive forever. A Herdr pane already outlives its process.

The planner's stop and status paths follow the same backend: finalize (`planning-promotion.ts`),
abort (`planning-sessions.ts`), and the dashboard's planning status, message and Stop routes use
`closeAgentPane`, `agentPaneExists` and `deliverAgentMessage` rather than tmux calls.

**Not yet routed** (tracked elsewhere): operator conversations and `pan handoff` (#3921); the
runtime-class `spawnAgent` of the muse and kimi-code runtimes (#3936) and of the codex, acp, ohmypi
and pi runtimes, reached only from Cloister's session rotation and crash respawn
(`session-rotation.ts`, `service-crash.ts`) — the claude-code runtime delegates to `spawnAgent` and
is routed. Remote Fly agents run tmux on the remote VM, not the local backend. Workspace run
commands, plain dashboard terminals and the codex auth login are not agents.

A graceful restart's 60-second warning reaches a Herdr agent through `deliverAgentMessage`; on tmux
it is still Escape twice and a tmux paste (`src/lib/graceful-restart.ts`).

**Known gaps on Herdr** (readers, not spawners): `detectCrashedAgents` (`pan recover --all`,
`autoRecoverAgents`) still filters on the sync, tmux-only `tmuxActive`, so on Herdr it lists live
agents as crashed — `recoverAgent`'s `isAlive` gate then answers `already-running` for them, so
nothing is double-spawned, but they are reported as failed. The Claude resume-summary gate crossing
(`prepareAutonomousAgentResumePane`) and the pane half of `detectPendingOperatorDecision` read the
tmux pane, so on Herdr they see no menu and fall through (the AskUserQuestion transcript check
still runs).

## The prompt guard (FR-17)

`src/lib/terminal-backends/prompt-guard.ts`, run by **both** adapters inside `prompt`, and by
`deliverAgentMessage` before the tmux delivery cascade:

1. **Idempotence.** Every prompt carries a message id. A repeat of the same id for the same target
   within the window (10 minutes, a 64-entry ring per target) returns `{ dropped: true, reason }`.
   The ring is in memory and per process: it de-duplicates inside the long-lived dashboard server,
   which is where the repeated deliveries came from. A retry of a *failed* delivery must use a new
   id — the guard records an id when it admits it.
2. **Authority.** A pane whose tokens say issue X and role `worker` accepts prompts only from the
   pane whose tokens say issue X and role `work`, from the sender whose id equals the pane's
   `parent` token (the agent or conversation that ran `pan worker run`, PAN-3920), or from an
   operator conversation (a `conv-` id with no `issue` token). Anything else gets
   `{ refused: true, reason }`. Other roles keep today's open delivery. On tmux the `parent` token
   comes from `state.json`'s `parentId`.

Sender identity: the Herdr adapter reads the target's tokens from `agent.get`; on tmux the sender is
`OVERDECK_AGENT_ID` and the target's tokens come from the agent's launch metadata
(`getAgentStateSync`), because a tmux pane carries no tokens.

`deliverAgentMessage` returns the drop or refusal in `DeliveryResult.failure` (`refused: …` /
`dropped: …`); a refusal is `ok: false`, so `pan tell` exits non-zero.

## Message delivery routing

`deliverAgentMessage` (`src/lib/agents/delivery.ts`) resolves the host's backend once per process,
then asks it whether the target is a **live Herdr agent** (`findHerdrAgent`, a bounded 2 s probe on
its own real timer, so a wedged socket can never hold up a message; it answers for a pane-bound
agent too, through its `agentId` token).

For a **detected** agent the whole delivery is `backend.prompt`. For a **pane-bound** agent Herdr
cannot prompt the pane at all, so `prompt` answers `unsupported` — before the guard, since the
target's metadata is perfectly well known — and delivery falls through to the harness's own
transport, which is how those harnesses were always reached: app-server socket, ACP socket, PTY
supervisor, Channels, tmux paste buffer (PAN-3879 routes them by harness). A tmux host, or a tmux
session that predates the cut, takes the same cascade. The prompt guard runs in front of every path:
on the fall-through it is `checkPrompt` with the target's launch tokens and the real sender, so an
`unsupported` answer never becomes an ungated delivery.

A THROW from the Herdr prompt stays a Herdr failure (`ok: false, path: 'herdr'`); only a returned
`unsupported` falls through. The two are different facts and must not be folded together.

The dashboard terminal follows the same rule: `/ws/terminal` resolves the session name to a Herdr
terminal id first (`resolveHerdrTerminalId`) and serves that client from `observe` plus a lazily
opened `control`; a null answer means the PTY hub path, exactly as before. The RPC
`TerminalService` uses the same bridge, wearing the PTY interface (`HerdrTerminalProcess`).

A prompt whose `wait` stalls or times out is reported **delivered**, not failed: Herdr writes the
text and Enter before it starts watching for activity, so a stalled wait is no proof the prompt never
landed, and its own guide says never to re-send on one. `agent_blocked` stays an error — Herdr
refuses a blocked agent before writing any input. The kickoff retry's "is the terminal still there"
check is backend-aware for the same reason: without it a Herdr spawn would look like a session that
exited before kickoff.

Spawn guards are backend-aware too: "is this agent already running" is `agentPaneExists`, a live
tmux session or a live Herdr agent of that name, and the tmux-only session options
(`destroy-unattached`, `remain-on-exit`) are applied only when the pane really is a tmux session.

## Companion terminals (PAN-3974)

A **companion terminal** is a second terminal session next to a conversation's own (owner)
session, running a harness's native client attached to the owner's live runtime and exact
session. It exists only so the operator can use the native CLI from the conversation TERMINAL
view; dashboard delivery never goes through it (the composer keeps the ACP socket, app-server
socket, and so on). OpenCode is the first adapter; Codex `codex resume --remote` (PAN-3835)
reuses the same seam.

| Piece | Where |
| --- | --- |
| Shared vocabulary (`CompanionTerminalKind`, `CompanionTerminalState`, `companionTerminalKindFor`, body whitelists) | `packages/contracts/src/companion-terminal.ts` |
| Lifecycle (open / close / owner teardown, per-owner lock, generation checks) | `src/lib/overdeck/companion-terminal/lifecycle.ts` |
| Host port + tmux implementation (async `tmuxExecAsync` / `createSession`, no keystrokes) | `src/lib/overdeck/companion-terminal/host.ts` |
| OpenCode adapter | `src/lib/overdeck/companion-terminal/opencode-adapter.ts` |
| Wiring + `closeCompanionTerminalForOwner` | `src/lib/overdeck/companion-terminal/index.ts` |
| Routes | `src/dashboard/server/routes/conversation-companion-terminal.ts` |
| UI | `src/dashboard/frontend/src/components/chat/ConversationTerminalView.tsx` |

**Session.** One companion per owner, named `companion-<ownerSession>` on the managed tmux
socket (conversations are tmux on every host until PAN-3921). The prefix is ignored by the
backend inventory, `isAgentSessionName`, and every reaper. The pane runs
`exec <absolute binary> …`, so the session ends when the native client exits. The dashboard
streams it through the ordinary `/ws/terminal?session=` path; a browser disconnect only drops the
PTY client, and no `destroy-unattached` is set, so the companion survives.

**Generation.** `sha256(ownerSession, owner #{session_created}, adapter fingerprint)`, 24 hex. The
OpenCode fingerprint is `<port>:<sessionId>`, so any owner respawn (new tmux session, new port)
changes it. It is stamped on the companion at creation as the session env var
`OVERDECK_COMPANION_GENERATION` (`new-session -e`, atomic) and read back with `show-environment`;
the tmux session is the authority and nothing else is stored. Rules:

- Every operation on one owner runs through a per-owner promise lock, so concurrent opens create
  one companion.
- Open reuses a companion only when its stamp equals the current generation; any other session
  under that name is killed and replaced. When unsure, kill and recreate: the companion holds no
  state, the harness session does.
- After creating, open resolves the generation again. If the owner changed meanwhile, it kills the
  companion it created (only if the stamp is still its own) and answers `owner-changed` (409).
- Close must carry the generation the browser was given; a mismatch answers `stale-generation`
  (409) and kills nothing.
- An owner whose tmux session is gone makes open reap any companion (`owner-not-running`).

**Owner teardown.** `closeCompanionTerminalForOwner(ownerSession)` never throws and is called from
`stopConversationRuntime` (stop, delete, archive, resume/restart failure, flywheel archive; after
the shared-session early return, so a runtime another conversation still owns keeps its companion),
from `spawnConversationSession` right before it kills the owner
session (every resume and restart-all), and for owners that exited on their own from both the
conversation lifecycle poll and the PTY supervisor's `exited` event (`agent-projection.ts`). Those
two close the companion before marking the row ended, because later writers skip ended rows.

**OpenCode adapter.** Reads `~/.overdeck/agents/<ownerSession>/opencode-port` and `acp-session-id`
(PAN-3937), the cwd from the conversation record, and the binary from `resolveHarnessBinary`, then
asks `GET http://127.0.0.1:<port>/session/<id>` (2 s timeout) before handing out
`opencode attach http://127.0.0.1:<port> --session <id> --dir <cwd>`. Attach only; never `--fork`,
`--continue`, `serve`, or a second `acp`.

| owner tmux | `opencode-port` | `acp-session-id` | `GET /session/<id>` | result |
| --- | --- | --- | --- | --- |
| gone | – | – | – | `owner-not-running` |
| alive | any | missing | – | `owner-starting` |
| alive | missing | present | – | `restart-required` (pre-PAN-3937 host) |
| alive | malformed | or malformed | – | `restart-required` |
| alive | present | present | error / non-2xx | `owner-starting` |
| alive | present | present | 404 | `session-missing` |
| alive | present | present | 2xx | attach |

**Routes.** `POST /api/conversations/:name/companion-terminal/open` (body `{}`) and
`…/close` (body `{ generation }`), both behind `rejectUnsafeDashboardMutationRequest`. Any other
body key or any query parameter is a 400: the browser can never name a URL, command, session id,
cwd, binary, or terminal target. Responses are `CompanionTerminalState` bodies; `unsupported` is
400, `owner-changed` / `stale-generation` are 409, everything else 200.

**Adding a harness (PAN-3835).** Add a kind to `CompanionTerminalKind`, map it in
`companionTerminalKindFor`, write an adapter whose `resolveTarget` returns argv, cwd, and a
fingerprint from server-side records, and register it in `defaultAdapters()` in `index.ts`. The
lifecycle, routes, and UI need no change.

## Herdr wire facts (v0.9.1, protocol 22)

Verified live on 2026-09-18 against the running `overdeck` session.

- **One request per connection.** Connect, write one `{"id","method","params"}` line, read one
  `{"id","result"}` or `{"id","error"}` line — the server then closes. Pipelining a second request
  is answered with a reset. `herdr-api.ts` therefore opens a connection per call.
- A request the server cannot parse is answered with an **empty id**: `{"id":"","error":{…}}`.
- `events.subscribe` is the exception: the connection stays open, the first line is
  `{"result":{"type":"subscription_started"}}`, and every later line is `{"event":"<kind>","data":{…}}`.
- A disconnect after a **mutating** request was written but before a response is **ambiguous**:
  the error carries `ambiguous: true` and is never retried. Inspect live state instead.
- Terminal streams are NDJSON `terminal.frame` records
  (`{bytes: base64, encoding:"ansi", full, width, height, seq}`) ending in `terminal.closed`;
  `control` takes `{"type":"terminal.input","text":…}` and `{"type":"terminal.resize","cols","rows"}`
  on stdin. An EOF without a close record synthesizes an `exit` frame so no viewer hangs.
- Lifecycle events arrive as `pane_updated` records carrying the pane's `agent_status`: the
  `pane.agent_status_changed` subscription is per-pane (it requires a `pane_id`), so the
  workspace-wide stream reports state transitions through `pane_updated`. Verified live —
  `unknown → idle` arrived that way when a harness finished starting.
- `probe()` compares the live `ping` protocol against the committed fixture
  (`src/lib/terminal-backends/__fixtures__/herdr-v0.9.1/schema.json`, protocol 22, schema_version 1).
  A mismatch is a typed error — never a reason to stop or update a server.

### Why `startAgent` does not call `agent.start`

`agent.start {kind}` builds the command line itself from Herdr's agent manifest, so it cannot run
Overdeck's generated launcher script — the script that carries the provider exports, the
system-prompt files, the session id, and every harness-specific launch field. The adapter therefore
splits a pane with the launch env, runs the launcher with `pane.send_input` (text plus Enter in one
ordered submission), waits for Herdr's own agent detection, and binds the Overdeck agent id as the
live agent name with `agent.rename`. Herdr then treats the pane as a first-class agent: `agent.prompt`,
`agent.wait` and the `idle|working|blocked|done` states all work, and both backends run the identical
launcher. This deviates from the PRD sketch for W8 step 2 on purpose.

### The PTY supervisor is tmux-only (PAN-3917 W12)

**Herdr's agent detector reads the pane's foreground process.** The PTY supervisor
(`node dist/pty-supervisor.js claude …`) allocates a *second* pseudo-terminal for the harness with
node-pty, so the pane's own foreground process stays `node`, and Herdr never sees `claude` — the
60 s detection wait then times out and `startAgent` closes the pane. That is exactly how
`pan start PAN-3705` failed on 2026-09-19.

So `decideSupervisorForWorkAgent` refuses the supervisor whenever the selected backend is Herdr
(`supervisor:ineligible:herdr-backend`) and the generated launcher execs the harness directly. Both
the fresh-launch and the relaunch/resume paths re-derive the backend, so a resume cannot re-wrap a
Herdr agent. Herdr needs nothing the supervisor provided: `agent.prompt` delivers (`delivery.ts`
routes the whole delivery through the backend, with no socket to find), `agent.get`/`agent.list`
answer liveness, and `terminal.session.observe|control` serves the terminal.

`isAlive` (`src/lib/agents/liveness.ts`) is backend-aware for the same reason: a Herdr agent has no
tmux session, so the tmux three-check probe would answer `no-session` for every healthy agent and
the remediators would reap the fleet. On Herdr the oracle is `probeHerdrAgentLiveness`, which keeps
"the server says there is no such agent" (`no-session`, a confirmed death) apart from "the socket
did not answer" (`runtime-indeterminate`, never a death). `isAliveOnTmux` is exported so the tmux
adapter's own inventory keeps probing tmux on either host.

**Known gap:** `isAliveSync` is still tmux-only — there is no synchronous Herdr client — so its
callers (`work-agent-lifecycle.ts`, `parked/resolver.ts`) read a Herdr agent as `no-session`.

`runtimes/muse.ts`, `runtimes/kimi-code.ts` and `overdeck/conversation-runtime.ts` still hardcode
`useSupervisor: true`, but that is no longer a launch failure: those harnesses are launched
pane-bound, so nothing waits for a detection the supervisor's second pty would have hidden, and
their delivery already goes through the supervisor socket. Only `claude-code` needs the supervisor
refused on Herdr, and `decideSupervisorForWorkAgent` does that.

A detection failure now carries the pane's foreground process and its last 20 lines of output, so
the next one names its own cause. (A full-screen harness renders on the alternate screen, where
`pane.read` returns nothing — the output is there for the launcher-died-early case.)

## Live verification record (AC-8)

Host: herdr 0.9.1, server protocol 22, socket `~/.config/herdr/sessions/overdeck/herdr.sock` (the
default home owns the `overdeck` instance).
Date: 2026-09-18. Throwaway workspace `pan-3917-verify`, closed at the end. JSON trimmed.

**Probe**

```json
→ {"id":"1","method":"ping","params":{}}
← {"id":"1","result":{"type":"pong","version":"0.9.1","protocol":22,
     "capabilities":{"live_handoff":true,"detached_server_daemon":true,
     "endpoint_protocol_generation":1,"surface_interest":true,"health_check":true}}}
```

**Workspace for the issue** (`workspaceFor`)

```json
→ {"method":"workspace.create","params":{"cwd":"…/verify","label":"pan-3917-verify","focus":false}}
← {"result":{"type":"workspace_created","workspace":{"workspace_id":"w1","label":"pan-3917-verify"},
     "tab":{"tab_id":"w1:t1"},"root_pane":{"pane_id":"w1:p1","terminal_id":"term_65bc93a0c4ef81"}}}
→ {"method":"workspace.report_metadata","params":{"workspace_id":"w1","source":"overdeck","tokens":{"issue":"PAN-3917"}}}
← {"result":{"type":"ok"}}
```

**Plain shell pane** — the root pane, driven through `control`:

```
$ printf '%s\n' '{"type":"terminal.resize","cols":100,"rows":30}' \
    '{"type":"terminal.input","text":"echo herdr-control-ok\r"}' \
  | herdr --session overdeck terminal session control term_65bc93a0c4ef81
{"type":"terminal.frame","full":true,"width":100,"height":30,"seq":1,"bytes":"…"}
{"type":"terminal.frame","full":false,"width":100,"height":30,"seq":2,"bytes":"…"}
{"type":"terminal.closed"}
$ herdr --session overdeck pane read w1:p1 …
eltmon@…:…/verify$ echo herdr-control-ok
herdr-control-ok
```

**Start an agent** (`startAgent`) — a real `claude` harness launched through a launcher script,
exactly as `spawn.ts` does it:

```json
→ {"method":"pane.split","params":{"workspace_id":"w1","direction":"right","target_pane_id":"w1:p1",
     "cwd":"…/verify","focus":false,"env":{"OVERDECK_AGENT_ID":"agent-pan-3917-verify","OVERDECK_ISSUE_ID":"PAN-3917"}}}
← {"result":{"type":"pane_info","pane":{"pane_id":"w1:p2","terminal_id":"term_65bc93acb59ea2"}}}
→ {"method":"pane.send_input","params":{"pane_id":"w1:p2","text":"bash …/verify/launcher.sh","keys":["enter"]}}
← {"result":{"type":"ok"}}
… ~9s later, on the events subscription:
← {"event":"pane_agent_detected","data":{"agent":"claude","pane_id":"w1:p2","workspace_id":"w1"}}
→ {"method":"agent.rename","params":{"target":"w1:p2","name":"agent-pan-3917-verify"}}
← {"result":{"type":"agent_info","agent":{"name":"agent-pan-3917-verify","agent":"claude","agent_status":"idle"}}}
→ {"method":"pane.report_metadata","params":{"pane_id":"w1:p2","source":"overdeck",
     "tokens":{"issue":"PAN-3917","role":"work","harness":"claude-code","model":"claude-opus-5"}}}
← {"result":{"type":"ok"}}
```

**Prompt and wait to idle** (`prompt` with `wait`) — 3.3 s, settled `idle`, and the harness renamed
its own terminal title from the answer:

```json
→ {"method":"agent.prompt","params":{"target":"agent-pan-3917-verify",
     "text":"Reply with exactly: PAN-3917 W8 VERIFIED","wait":{"timeout_ms":180000}}}
← {"result":{"type":"agent_prompted","agent":{"agent_status":"idle","state_change_seq":3,
     "terminal_title_stripped":"PAN-3917 W8 verified"}}}
```

A prompt sent while the harness was still painting its first screen returned
`{"error":{"code":"agent_prompt_stalled","message":"agent prompt produced no observed working or
blocked state within 5000 ms; current status is idle"}}` — the adapter surfaces that as a typed
error; the text was never re-sent.

**Blocked on an interactive prompt** — `/effort` opens Claude Code's picker:

```json
→ {"method":"agent.get","params":{"target":"agent-pan-3917-verify"}}
← {"result":{"type":"agent_info","agent":{"agent_status":"blocked"}}}
→ {"method":"agent.prompt","params":{"target":"agent-pan-3917-verify","text":"hello"}}
← {"error":{"code":"agent_blocked","message":"agent agent-pan-3917-verify is blocked and requires interactive input"}}
→ {"method":"agent.wait","params":{"target":"agent-pan-3917-verify","until":["blocked"],"timeout_ms":10000}}
← {"result":{"type":"agent_info","agent":{"agent_status":"blocked"}}}
→ {"method":"agent.send_keys","params":{"target":"agent-pan-3917-verify","keys":["esc"]}}   → back to "idle"
```

Herdr refuses to type into a blocked agent before writing any input — the behavior FR-17 wants from
the backend, underneath Overdeck's own guard.

**Observe streaming** — first frame full (a snapshot), then incrementals while the agent answered a
prompt:

```
$ herdr --session overdeck terminal session observe term_65bc93acb59ea2
{"type":"terminal.frame","encoding":"ansi","full":true,"width":100,"height":30,"seq":1,"bytes":"G1s/MjAyNmgb…"}
… 27 further frames with "full":false during one prompt …
```

**Inventory and events** (`list`, `events`)

```json
→ {"method":"agent.list","params":{}}
← {"result":{"type":"agent_list","agents":[{"name":"agent-pan-3917-verify","pane_id":"w1:p2",
     "terminal_id":"term_65bc93acb59ea2","agent_status":"idle",
     "tokens":{"issue":"PAN-3917","role":"work","harness":"claude-code","model":"claude-opus-5"}}]}}
→ {"method":"session.snapshot","params":{}}   ← 2 panes, workspace w1 with tokens {"issue":"PAN-3917"}
subscription frames seen: workspace_created, pane_created (×2), pane_agent_detected, workspace_closed
```

**Teardown**

```json
→ {"method":"workspace.close","params":{"workspace_id":"w1"}}   ← {"result":{"type":"ok"}}
→ {"method":"workspace.list","params":{}}                       ← {"workspaces":[]}
```

**Not exercised.** *Resume after a server restart*: protocol 22 exposes no agent-resume method and
this verification was barred from stopping or restarting the live server, so `resume` returns
`unsupported` with that reason on both adapters; Overdeck resumes by relaunching the harness with
its own resume flag, which is `startAgent` again.

## Live verification record — supervisor vs direct exec (PAN-3917 W12)

Host: herdr 0.9.1, server protocol 22, socket `~/.config/herdr/sessions/overdeck/herdr.sock`.
Date: 2026-09-19. Throwaway workspace `fix11-verify` (`wF`), closed at the end. Both runs used the
*same* on-disk launcher from the failed `pan start PAN-3705`, copied to a scratch path with a fresh
session id and a throwaway agent id; the only difference was the exec line.

**Run A — `exec node …/pty-supervisor.js claude …` (as shipped)**

```
pane.get wF:p2 polled every 7s for 56s:
  agent = None   agent_status = unknown   terminal_title = '✳ agent-fix11-sup'   (unchanged, all 8 polls)
pane.process_info wF:p2:
  foreground_processes[0].name    = "node"
  foreground_processes[0].cmdline = "node /home/eltmon/.overdeck/deployments/dashboard/
      .pan-reload-generation-b/dist/pty-supervisor.js claude --permission-mode bypassPermissions
      --effort high --model claude-sonnet-5 --name agent-fix11-sup --session-id … "
agent.list: the pane is absent — 3 pre-existing agents only.
```

**Run B — `exec claude …` (supervisor removed, nothing else changed)**

```
pane.get wF:p3 polled every 2.5s:
  t=2s  agent = claude   → DETECTED
  t=10s agent = claude   agent_status = idle   terminal_title = '✳ agent-fix11-dir'
pane.process_info wF:p3:
  foreground_processes[0].name = "claude"
agent.rename wF:p3 agent-fix11-dir → {"type":"agent_info","agent":{"name":"agent-fix11-dir",
  "agent":"claude","agent_status":"idle"}}
agent.list: the pane is listed as a first-class agent.
```

**What this settles.** The terminal title was correct in *both* runs, so Herdr does not detect on the
title and stamping a pane title would not have helped. Detection follows the pane's foreground
process, which the supervisor's node-pty replaces with `node`. Every agent Herdr had already
detected on the live session (`flywheel-orchestrator`, `agent-pan-2468-knowledge`,
`sequencer-runner`) also runs `claude` directly — none is supervisor-wrapped.

Teardown: `workspace.close wF` → `{"result":{"type":"ok"}}`; no `fix11-*` processes survived.

## Live verification record — pane-bound codex launch (PAN-3917 W12)

Host: herdr 0.9.1, session `overdeck`, 2026-09-19. The subject is the launcher of the agent that
failed the day before, run unchanged: `bash ~/.overdeck/agents/agent-pan-3705-review/launcher.sh`
(codex app-server host, gpt-5.6-sol) in `workspaces/feature-pan-3705`, through
`startAgent` with `detection: 'not-required'`, in a throwaway workspace.

```
workspace.create → wH            (label fix14-throwaway)
startAgent       → {"paneId":"wH:p2","terminalId":"term_65bd520ce2a45148",
                    "agentName":"agent-pan-3705-review"}   — returned at once, no detection wait

herdr --session overdeck pane get wH:p2:
  agent_status  = "unknown"        (Herdr detects nothing: the foreground process is the host)
  title         = "agent-pan-3705-review"
  display_agent = "codex"
  tokens        = {agentId: agent-pan-3705-review, issue: PAN-3705, role: review,
                   harness: codex, model: gpt-5.6-sol}

~/.overdeck/agents/agent-pan-3705-review/appserver-events.jsonl: 259 → 518 bytes
  (new remoteControl/status/changed record at 12:26:37Z — the host connected)
~/.overdeck/sockets/appserver-agent-pan-3705-review.sock: created
process: node …/dist/codex-app-server-host.js --effort high --model gpt-5.6-sol

probeHerdrAgentLiveness → {"kind":"alive","paneId":"wH:p2","state":"unknown"}
listHerdrAgents         → the agent is listed: agentId agent-pan-3705-review, paneBound true
HerdrBackend.prompt     → {"unsupported":true,"reason":"herdr has no detected agent in pane wH:p2
                           (codex runs through a host process); deliver through the harness
                           transport instead"}
```

Teardown: `pane.close wH:p2` + `workspace.close wH` → `{ok:true}` twice; the workspace is gone from
`workspace list` and no `gpt-5.6-sol` app-server host process survived.

**What this settles.** A codex (and by the same mechanism ACP, kimi-code, ohmypi/muse) agent now
starts on Herdr: the pane stays open, carries its identity, runs its real transport, and reads as a
live agent everywhere Overdeck asks. The kickoff prompt is unaffected by the instant return —
`deliverInitialPromptWithRetry` waits for `waitForCodexAppServerReady` (the socket plus token) before
it delivers, exactly as on tmux.

**Second run (final code), same session:** the same launcher in workspace `wK` alongside a
deliberately exiting pane (`true`, agent id `agent-fix14-exits`):

```
agent-pan-3705-review  liveness {"kind":"alive","paneId":"wK:p2","state":"unknown"}
                       findHerdrAgent → paneBound true
agent-fix14-exits      liveness {"kind":"exited","paneId":"wK:p3"}   ← shell back at its prompt
                       findHerdrAgent → null                          ← a respawn is not blocked
                       inventory      → still listed (census stops at pane existence, by design)
```

Teardown: both panes closed, `workspace.close wK` → `{ok:true}`, no app-server host survived.

## Live verification record — OpenCode companion terminal (PAN-3974)

2026-09-23, OpenCode 1.18.31, tmux 3.4. Everything ran on a private socket (`tmux -L pan3974-test`)
against a throwaway owner: `opencode acp --hostname 127.0.0.1 --port 54333` in a scratch directory,
with an ACP session created over stdio (`ses_f31392699ffePn4CdhKK6zUR0E`). The real lifecycle,
OpenCode adapter, and tmux host drove it, with the host's `exec`/`createSession` bound to that socket.
No live conversation or dashboard was touched.

```
GET /session/<ACP session id>           → 200 (an ACP-created session is visible over HTTP)
open ×2 concurrently                    → one companion created, second answer reused:true
pane command                            → opencode "exec '<abs>/opencode' 'attach' 'http://127.0.0.1:54333'
                                            '--session' 'ses_…' '--dir' '<scratch>/oc-acp'"
OVERDECK_COMPANION_GENERATION           → 9bd653f22a0eef0992eb340f
capture-pane -e                         → native OpenCode TUI (prompt box, "Build · <model> · xhigh",
                                            "tab agents / ctrl+p commands"), 162 ANSI escape runs, truecolor
OpenCode sessions before/after attach   → 13 → 13 (no second session)
PTY tmux client attached, then killed   → companion still alive (browser disconnect)
reopen                                  → reused:true
close with a stale generation           → stale-generation; companion still alive
close with the current generation       → closed; companion gone; owner alive; GET /session/<id> 200
owner teardown after reopening          → companion gone
opencode-port removed                   → restart-required; no companion created
```

Teardown: `tmux -L pan3974-test kill-server`; port 54333 no longer answers.
