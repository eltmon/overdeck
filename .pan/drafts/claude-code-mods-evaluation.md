# Claude Code mods for Overdeck: evaluation report

**Issue:** [PAN-4529](https://github.com/eltmon/overdeck/issues/4529). Evaluation only; nothing is adopted in this change.
**Claude Code build evaluated:** 2.1.288 (local), with the 2.1.289 changelog read.
**Research input:** [`claude-code-mods-research.md`](claude-code-mods-research.md), the Flywheel research brief, committed unmodified.

Evidence verified at commit a53af5777c3

## Executive summary

To be written last, from the finished sections (spec item `ranked-recommendation`).

## How to read this report

The report has three parts. The first part explains what a mod is and lists the limits that apply to every idea. The second part evaluates seven candidates, one section each. The third part covers security, delivery into Overdeck's managed sessions, the ranked recommendation, and the proposed follow-up issues.

Every candidate section starts with the same table. The rows are, in this order: What it would do, Mod capability, Replaces or improves, Overdeck evidence, Harness parity, Risk, Size, Sources, Verdict. One to four paragraphs of analysis follow the table. The verdict is one of `adopt-first`, `adopt-later` or `do-not-adopt`. The size is S, M or L.

**Citations.** A claim about Claude Code behavior cites one of these sources:

- `[skill]` is the built-in `plugin-authoring` skill for 2.1.288: its `reference.md` (cited by section) and its `types/claude-code.d.ts` (cited by line). These files are the authority for this build.
- `[S1]`..`[S12]` are the research brief's sources: the docs pages at `https://code.claude.com/docs/en/plugins/mods/…`, the CHANGELOG, and upstream issues. Appendix B lists them.
- `brief §N` is a section of the research brief.

**UNVERIFIED.** A claim that no authoritative source confirms carries the word **UNVERIFIED** next to it. The report keeps every UNVERIFIED marking and open question from the research brief wherever it relies on that claim.

**Evidence refs.** A reference into the Overdeck code has the form `` `path:line` — `anchor` ``. The anchor is literal text on that line at the commit named above. The reader can check any ref with `sed -n '<line>p' <path>`.

**Issue links.** `PAN-<n>` links go to Overdeck issues. `#<n>` links go to `anthropics/claude-code` issues.

## What a mod is and what it can do

This section summarizes the research brief §1-§7. Each sentence names its source.

### Definition and status

- A mod is a Claude Code plugin whose `hooks/hooks.json` names one hooks module under `modules`, and that module exports `register(on, options)` ([skill] reference.md "What a plugin of function hooks is"; [S2](https://code.claude.com/docs/en/plugins/mods/create)).
- Each `on(event, matcher?, hook)` call registers a hook with the shape `($, e, next)`: `$` is the engine API, `e` is the frozen event input, and `next(e)` runs the rest of the chain and then Claude Code's own behavior ([skill] reference.md "What a plugin of function hooks is"; [S4](https://code.claude.com/docs/en/plugins/mods/events)).
- A hook can observe (`return next(e)`), rewrite (`next({ ...e, x })`), or answer (return a result without calling `next`) ([skill] reference.md "What a plugin of function hooks is"; [S4](https://code.claude.com/docs/en/plugins/mods/events)).
- Mods shipped in 2.1.287 on 2026-10-01 with the changelog line "Added Claude Mods: plugins may now modify deeper behavior" ([S6 CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)).
- The docs say mods "require Claude Code v2.1.287 or later, and they're on by default", and 2.1.287+ ignores the old `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` switch ([S1](https://code.claude.com/docs/en/plugins/mods/overview)).
- The API is early access: the types header says "EARLY ACCESS: this surface may change between releases without notice" ([skill] types/claude-code.d.ts line 4), and the docs say events and methods "can change between releases" ([S5](https://code.claude.com/docs/en/plugins/mods/api)).

### Loading and scope

- A mod loads from one of five places: a session's `~/.claude/dev-mods/<session-id>/` folder (Claude-written mods, after a one-time hot-reload approval), `claude --plugin-dir <dir>` for one session, `CLAUDE_CODE_PLUGIN_DIRS`, a user or project plugin install from a marketplace, or an organization's managed marketplace ([skill] reference.md "Developing one"; [S2](https://code.claude.com/docs/en/plugins/mods/create); [S7](https://code.claude.com/docs/en/plugins/mods/admin)).
- `CLAUDE_CODE_PLUGIN_DIRS` is read from the process environment or the `env` block of `~/.claude/settings.json`, never from a project's settings ([skill] reference.md "Developing one"; [S3](https://code.claude.com/docs/en/plugins/mods/reference)).
- An interactive session watches a `--plugin-dir` or `CLAUDE_CODE_PLUGIN_DIRS` folder and reloads the module on save; `register` then runs again in a fresh environment and drops the previous timers ([skill] reference.md "Developing one").
- `$.state` (session-scoped, held by the host) and `$.store` (persistent) survive a reload, but module variables do not ([skill] reference.md "Drawing: ui.render"; [S9](https://code.claude.com/docs/en/plugins/mods/interface)).
- Installed plugin copies are cached by version, so a change to an installed mod needs a version bump and a reinstall ([S2](https://code.claude.com/docs/en/plugins/mods/create)).
- Hot reload is unavailable under `claude -p` or `dontAsk`, in an untrusted workspace, under `--safe-mode`, `--bare` or `disableAllHooks`, or under organization policy ([S2](https://code.claude.com/docs/en/plugins/mods/create)).
- The loader reads the source before it runs it, so event names, `$.env` names and `$.state` keys must be literals, `$` calls must be written in full, and imports must be static and relative ([skill] types/claude-code.d.ts lines 19-24; [S2](https://code.claude.com/docs/en/plugins/mods/create)).

### Events

- Tool events are `tool.call` (deny, rewrite the arguments, answer with `{ result }` without running the tool, or retry), `tool.check` (the final `allow`/`ask`/`deny` decision) and `tool.describe` ([S3](https://code.claude.com/docs/en/plugins/mods/reference); [skill] types/claude-code.d.ts `EngineEventOf`).
- Prompt events include `prompt.submit` (rewrite the text, add model-only `context`, or drop it), `prompt.compose` and `prompt.section` (system prompt sections) and `prompt.context` (first-message context blocks) ([S3](https://code.claude.com/docs/en/plugins/mods/reference); [skill] reference.md "What a plugin of function hooks is").
- Turn events are `turn.start`, `turn.step` (a streaming hook per model request that can read token usage or switch the model) and `turn.complete` (answer, duration, usage, abort flag) ([S3](https://code.claude.com/docs/en/plugins/mods/reference); [skill] reference.md "What a plugin of function hooks is").
- Session events are `session.start`, `session.end`, `session.compact`, `session.receive` and `session.send` (cross-session messaging), and `session.append`, which every stored transcript row passes through ([S3](https://code.claude.com/docs/en/plugins/mods/reference); [skill] reference.md "The rows a conversation keeps: session.append").
- Subagent events are `agent.offer` and `agent.spawn`, and `agent.spawn` can answer `{ model }` or `{ deny }` ([S3](https://code.claude.com/docs/en/plugins/mods/reference)).
- Every settings-hook event is also hookable as `classic.<Event>` (`classic.Stop`, `classic.SessionStart`, …), and `e` is that hook's stdin JSON including `transcript_path` ([skill] reference.md "What a plugin of function hooks is").
- Every `$.ns.method` call is itself an event, so an earlier mod can observe, rewrite or deny a later mod's calls ([S3](https://code.claude.com/docs/en/plugins/mods/reference); [S4](https://code.claude.com/docs/en/plugins/mods/events)).

### The `$` API

- `$.prompt.submit({ text, asUser })` queues a prompt that starts its own turn once the session is idle; it is never folded into a running turn, and the call resolves as that turn starts ([skill] reference.md "Work that outlives a dispatch"; [S5](https://code.claude.com/docs/en/plugins/mods/api)).
- `$.session.append` adds a user-role `isMeta` row the model reads, or a system notice the model does not read, and the row reaches "a running turn's requests from the loop's next top" ([skill] reference.md "The rows a conversation keeps: session.append").
- `$.session.usage()` returns context tokens and percent, rate-limit windows with reset times, and cost ([S3](https://code.claude.com/docs/en/plugins/mods/reference); [skill] types/claude-code.d.ts `$.session`).
- `$.http.fetch(url, { method, headers, body, auth, socketPath })` reaches HTTP, HTTPS and Unix domain sockets ([skill] types/claude-code.d.ts lines 3271-3279 and 4928-4930).
- `$.process.run` runs a host command by argv with no shell, and `$.process.spawn` streams a child process ([skill] reference.md "Work that outlives a dispatch"; [S3](https://code.claude.com/docs/en/plugins/mods/reference)).
- `$.fs` reads, writes, lists and stats paths, up to 4 MiB per read or write ([skill] reference.md "Work that outlives a dispatch"; [S3](https://code.claude.com/docs/en/plugins/mods/reference)).
- `$.mcp.call` drives a connected MCP server with "No permission prompt" ([skill] types/claude-code.d.ts line 2498).
- `$.clock.every` and `$.clock.after` replace `setInterval` and `setTimeout`, and their timers run until cancelled or until the module reloads ([skill] reference.md "Work that outlives a dispatch").
- `$.store` is a JSON key-value store shared by every session on the machine, limited to 4 MiB and not atomic across sessions ([S3](https://code.claude.com/docs/en/plugins/mods/reference)).
- `$.audio.play` uses `afplay` on macOS, and "a Linux or Windows terminal, having no player, plays nothing" ([skill] types/claude-code.d.ts lines 2462-2463).

### Drawing

- A pane is opened with `$.ui.open` and drawn by a `ui.render` hook on `Pane`; it docks beside the transcript only in the fullscreen layout and opens inline above the prompt on the main screen ([skill] reference.md "Drawing: ui.render"; [S9](https://code.claude.com/docs/en/plugins/mods/interface)).
- A band is a `ui.render` hook on the `AbovePrompt` site, shared by all mods ([S9](https://code.claude.com/docs/en/plugins/mods/interface)).
- `$.ui.status` pins one line per plugin under the prompt, and `$.ui.toast`, `$.ui.log` and `$.ui.notice` show transient lines without starting a turn ([skill] reference.md "Work that outlives a dispatch"; [S3](https://code.claude.com/docs/en/plugins/mods/reference)).
- A mod can restyle built-in render sites, `AskUserQuestion` among them, but not the permission prompt ([S3](https://code.claude.com/docs/en/plugins/mods/reference); [S1](https://code.claude.com/docs/en/plugins/mods/overview)).
- Under tmux, Claude Code uses the main-screen layout by default: the types say `isFullscreen` is false "on the main screen (`CLAUDE_CODE_NO_FLICKER=0`, tmux by default)" ([skill] types/claude-code.d.ts line 1582).
- Whether Herdr reports fullscreen, docks panes, or passes mouse events, OSC 52 or kitty graphics is **UNVERIFIED**; no source covers Herdr (brief §11 open question 1).

### Runtime

- A hooks module runs in an isolated environment with "no DOM, no Node", no `setTimeout` and no `require` ([skill] types/claude-code.d.ts lines 18-23; [S5](https://code.claude.com/docs/en/plugins/mods/api)).
- Installed mods share one worker thread, and after three untraceable crashes all non-built-in mods stay off until `/reload-plugins` ([S10](https://code.claude.com/docs/en/plugins/mods/troubleshoot); [S7](https://code.claude.com/docs/en/plugins/mods/admin)).
- Mods are not sandboxed: "Mods run with the same access to your machine as Claude Code itself. They aren't sandboxed." ([S5](https://code.claude.com/docs/en/plugins/mods/api); [S1](https://code.claude.com/docs/en/plugins/mods/overview)).
- A hook that throws, times out or returns a bad shape before it calls `next` is skipped and the chain continues, so hooks fail open unless a `.catch` handler answers in their place ([skill] reference.md "Developing one"; [S4](https://code.claude.com/docs/en/plugins/mods/events)).
- Chain order is `prepend` (the sec-default guard and managed plugins), then `user`, `append`, `builtin` and `core`; managed `PreToolUse` hooks run before every mod, and other settings `PreToolUse` hooks run after the last mod, so a mod that answers `tool.call` itself skips them ([S4](https://code.claude.com/docs/en/plugins/mods/events); brief §6).

### Surfaces

- Hooks run and drawings show in `claude` in a terminal; hooks run in the Desktop Code tab, `claude -p`, the Agent SDK and the VS Code panel, but `claude -p` and the SDK show no drawing and VS Code draws none ([S1](https://code.claude.com/docs/en/plugins/mods/overview); [#99045](https://github.com/anthropics/claude-code/issues/99045)).
- `$.ui.ask` rejects under `claude -p` ([S3](https://code.claude.com/docs/en/plugins/mods/reference); brief §4).

## Hard limits

These limits apply to every candidate below. Each one comes from the docs reference "Limits" ([S3](https://code.claude.com/docs/en/plugins/mods/reference)), the other cited docs pages, or the brief §10.

1. **No listening socket.** `$` has no server or listen API. A mod can reach out over HTTP, HTTPS or a Unix socket with `$.http.fetch`, or start a child process, but nothing outside can open a connection into the mod ([skill] types/claude-code.d.ts `$.http`; brief §4). Push delivery into a session therefore needs polling, a long-poll request, or a child process the mod owns.
2. **The permission prompt cannot be redrawn.** The docs list what a mod can restyle "but not the permission prompt" ([S1](https://code.claude.com/docs/en/plugins/mods/overview)). A mod can decide a permission with `tool.check`, but it cannot change the dialog the operator sees.
3. **10 s hook budget.** A hook has 10 s of its own time, a `.catch` handler 1 s, a hook after an abort 5 s, and all `session.end` hooks together 1.5 s ([S3](https://code.claude.com/docs/en/plugins/mods/reference)). The clock pauses during `next` and during every `$` call except `$.clock.sleep` ([skill] reference.md "Work that outlives a dispatch"). So a hook may wait on one long `$.http.fetch`, but a sleep-and-retry loop spends the budget.
4. **Remote kill switch.** Anthropic can turn installed mods off remotely ("hooks modules are turned off in this process"), and [#99130](https://github.com/anthropics/claude-code/issues/99130) reports the switch serving "off" on 2.1.288 for some users despite the on-by-default rule ([S10](https://code.claude.com/docs/en/plugins/mods/troubleshoot); brief §8). On this machine `claude plugin test` printed `no hooks module to load`, which means mods can load (brief §8).
5. **Drawing only in a terminal or Desktop.** `claude -p` and the Agent SDK draw nothing, and the VS Code panel draws nothing ([#99045](https://github.com/anthropics/claude-code/issues/99045); [S1](https://code.claude.com/docs/en/plugins/mods/overview)).
6. **Fail open.** A failed hook is skipped and the chain continues, so a guard must add `.catch` to fail closed ([S4](https://code.claude.com/docs/en/plugins/mods/events)).
7. **One shared worker.** All installed mods share one worker thread, and three untraceable crashes unload every non-built-in mod until `/reload-plugins` ([S10](https://code.claude.com/docs/en/plugins/mods/troubleshoot)). How the 10 s budget behaves under worker contention is **UNVERIFIED** (brief §11 open question 6).
8. **`disableAllHooks` stops everything together.** In user settings it stops mods, settings hooks and the custom status line at once ([S7](https://code.claude.com/docs/en/plugins/mods/admin); brief §8).
9. **`$.store` is small and shared.** It holds 4 MiB in total for all sessions on the machine and is not atomic across sessions ([S3](https://code.claude.com/docs/en/plugins/mods/reference)).
10. **tmux is main-screen.** Under tmux the default layout is the main screen, so a pane opens inline above the prompt and never docks, and `$.ui.selection()` returns `undefined` ([skill] types/claude-code.d.ts line 1582; [skill] reference.md "Work that outlives a dispatch"). Overdeck sets no fullscreen variable (`grep -rn "NO_FLICKER" src sync-sources` returns nothing).
11. **No sound on Linux.** `$.audio.play` plays nothing in a Linux terminal ([skill] types/claude-code.d.ts lines 2462-2463).
12. **Early-access API.** The surface "may change between releases without notice" ([skill] types/claude-code.d.ts line 4), so every mod Overdeck ships needs a version gate and a test against each new Claude Code release.

## Candidate 1: Operator state in the agent's own pane

| Field | Finding |
| --- | --- |
| What it would do | Draw one band above the prompt (or one pinned status line) in every managed Claude Code pane, showing the issue, the pipeline phase, verification and review state, and whether the issue waits on the operator (Needs-you). |
| Mod capability | `ui.render` on `AbovePrompt` for the band, or `$.ui.status` for a single line; `session.start` starts a `$.clock.every` timer; each tick reads state with `$.http.fetch` to the dashboard (or `$.fs.read` of a state file) and writes it to `$.state`, which redraws the band. |
| Replaces or improves | Improves the operator's view inside a terminal. It replaces nothing: the dashboard stays the source of truth, and the bash status line (`src/lib/sync.ts:614` — `const STATUSLINE_TARGETS`) keeps showing model, context, cost and plan limits. |
| Overdeck evidence | `src/lib/sync.ts:614` — `const STATUSLINE_TARGETS`; `src/lib/sync.ts:680` — `settings.statusLine = {`; `sync-sources/hooks/statusline.sh:2` — `# Claude Code status line`; `sync-sources/hooks/pan-hook-lib.sh:343` — `pan_emit_event() {` (how hooks reach the dashboard today, with the internal token) |
| Harness parity | Claude Code only. Codex, Pi and Kimi panes get no band. That is acceptable because the band only mirrors dashboard state and no pipeline step depends on it. |
| Risk | Low. The mod reads only; if it is unloaded ([#99130](https://github.com/anthropics/claude-code/issues/99130), three worker crashes, `disableAllHooks`) the band disappears and nothing else changes. The mod needs the dashboard internal token to call the API, so it carries a secret into every session that loads it (see Security). Herdr fullscreen behavior is **UNVERIFIED**. |
| Size | S. One hooks module of about 60 lines plus one read route or state file; the probe in Appendix A already draws the band from state. |
| Sources | plugin-authoring skill: reference.md "Drawing: ui.render" and "Work that outlives a dispatch", types/claude-code.d.ts line 1582 (`isFullscreen`); docs: https://code.claude.com/docs/en/plugins/mods/interface (S9), https://code.claude.com/docs/en/plugins/mods/reference (S3); research brief §5 and §7; Appendix A. |
| Verdict | adopt-first: it is the only candidate whose silent loss costs the pipeline nothing, and it builds the packaging, scoping and review path every later mod needs. |

**Where the band shows.** Overdeck sets no Claude Code fullscreen variable (`grep -rn "NO_FLICKER" src sync-sources` returns nothing). Under tmux, Claude Code therefore uses the main-screen layout, where `isFullscreen` is false ([skill] types/claude-code.d.ts line 1582). A band draws above the prompt in both layouts, so it works under tmux. A `Pane` would open inline above the prompt instead of docking beside the transcript, which takes vertical space from the agent's output; that is why this candidate uses a band or a status line and not a pane. Under Herdr the layout is **UNVERIFIED**: no source says whether Claude Code in a Herdr pane runs fullscreen, docks panes, or passes pointer events (brief §11 open question 1). This is an open question for the follow-up, to answer with a live check in a throwaway Herdr pane. If Herdr runs fullscreen, [#99354](https://github.com/anthropics/claude-code/issues/99354) (a docked pane ignores the light theme) applies only to panes, not to the band.

**The operator sees it with no dashboard change.** The dashboard's terminal panel streams the pane's raw PTY bytes over `/ws/terminal` (`docs/DASHBOARD-ARCHITECTURE.md:28` — `/ws/terminal?session=<name>`). Whatever the mod draws is part of those bytes, so the band appears in the dashboard terminal view and in a direct attach alike. Non-Claude harnesses get nothing, so the band must only mirror what the dashboard already shows.

**Comparison with the shipped status line.** `pan sync` copies `statusline.sh` to `~/.claude/statusline-command.sh` and points `settings.statusLine` at it (`src/lib/sync.ts:680` — `settings.statusLine = {`). That script runs on each status update, reads Claude Code's stdin JSON, and fetches plan usage with `curl` from the OAuth credentials file. It shows nothing about Overdeck's pipeline. A band adds what the status line cannot know: issue, phase, review and Needs-you. The docs present `$.ui.status` as coexisting with `statusLine`, and the order of the two lines is undocumented and **UNVERIFIED** (brief §11 open question 5), so a band is the safer surface than a second status line.

**Data source.** The mod reads `OVERDECK_AGENT_ID` and `OVERDECK_DASHBOARD_URL` with `$.env.get` and the token from `~/.overdeck/internal-token` with `$.fs.read`, the same values `pan-hook-lib.sh` uses (`sync-sources/hooks/pan-hook-lib.sh:271` — `PAN_INTERNAL_TOKEN=`). No current dashboard route returns issue, phase, review and Needs-you for one agent in one call, so the follow-up must add a small read route or a per-agent state file; the probe used a placeholder route. A 15 s poll is cheap, but every managed pane polls, so the follow-up should measure the load with the fleet at full size.

## Candidate 2: Reliable in-session message delivery

| Field | Finding |
| --- | --- |
| What it would do | Deliver orchestrator and operator messages (`pan tell`, review feedback, kickoffs) into a Claude Code session from inside the process, with a positive acknowledgment, instead of typing them into the pane. |
| Mod capability | Three shapes, evaluated below: (a) pull with `$.clock.every` plus `$.http.fetch`, then `$.prompt.submit({ text, asUser })`, with `$.session.append` of a user-role `isMeta` row as the steer equivalent; (b) peer socket through `session.receive` and `SendMessage` to a `uds:<socket>` address; (c) the existing Channels MCP bridge, for comparison. |
| Replaces or improves | Improves the Claude Code leg of `deliverAgentMessage`. Shape (a) removes two failure classes of the keystroke path: the unverifiable Enter ([PAN-4492](https://github.com/eltmon/overdeck/issues/4492)) and request text that Herdr's JSON API rejects ([PAN-4506](https://github.com/eltmon/overdeck/issues/4506)). It replaces nothing outright, because the keystroke path must stay as the fallback. |
| Overdeck evidence | `src/lib/agents/delivery.ts:377` — `export async function deliverAgentMessage(`; `src/lib/terminal-backends/herdr.ts:765` — `prompt(`; `src/lib/terminal-backends/herdr.ts:807` — `PAN-4292/PAN-4492: agent.prompt cannot verify its own Enter`; `src/lib/terminal-backends/herdr-api.ts:180` — `function wellFormedReplacer(_key: string, value: unknown): unknown {`; `src/lib/agents/supervisor-channels.ts:290` — `if (!isClaudeCodeChannelsMcpEnabled()) {`; `src/lib/channels/overdeck-bridge.ts:275` — `export async function pushChannelNotification(` |
| Harness parity | Claude Code only. Codex (app-server socket), ACP harnesses, Pi and Kimi keep their own transports, and `deliverAgentMessage` stays the single entry point that picks a path per harness. |
| Risk | Medium. Delivery is on the critical path, and a mod can be unloaded silently ([#99130](https://github.com/anthropics/claude-code/issues/99130), three worker crashes, `disableAllHooks`), so the dashboard must know per session whether the mod is live before it chooses the mod path. Two paths for one message need a dedup key. Shape (b) rests on an undocumented protocol (**UNVERIFIED**). |
| Size | M. A pull mod, a dashboard outbox route with acknowledgment, a "mod live" signal per session, and a new branch in `deliverAgentMessage` with tests for fallback and dedup. |
| Sources | plugin-authoring skill: reference.md "Work that outlives a dispatch" (`$.prompt.submit` "never folded into a running turn; the call resolves as that turn starts") and "The rows a conversation keeps: session.append" ("in a running turn's requests from the loop's next top"), types/claude-code.d.ts lines 3271-3279 (`socketPath`) and 15542 (`uds:<socket>`); docs: https://code.claude.com/docs/en/plugins/mods/api (S5), https://code.claude.com/docs/en/plugins/mods/reference (S3); research brief §4 and §10. |
| Verdict | adopt-later: shape (a) fixes real failure classes, but it must ship after Candidate 1 proves the packaging and with the keystroke path kept as the fallback. |

**Today's path.** `deliverAgentMessage` picks one route per target: persistent protocol hosts, the PTY supervisor socket, Channels, or the terminal backend (`docs/TERMINAL-BACKENDS.md:590` — `## Message delivery routing`). For a Herdr-detected Claude Code pane it does not trust Herdr's `agent.prompt`, because "agent.prompt cannot verify its own Enter" (`src/lib/terminal-backends/herdr.ts:807` — `agent.prompt cannot verify its own Enter`). It types the text with bracketed paste, waits for the composer to show it, presses Enter, and resends Enter once if the text is still there (`docs/TERMINAL-BACKENDS.md:625` — `### Submit verification on Claude Code panes (PAN-4492)`). This is careful screen reading, and it still infers delivery from what the pane shows. Separately, the text crosses Herdr's JSON API, where a lone surrogate once made Herdr reject the whole request ([PAN-4506](https://github.com/eltmon/overdeck/issues/4506), fixed by `wellFormedReplacer`).

**(a) Pull from the dashboard, submit in process.** A `session.start` hook starts a `$.clock.every` timer that asks a per-agent dashboard outbox for queued messages with `$.http.fetch`. For each message the mod calls `$.prompt.submit({ text, asUser: true })`. The call "resolves as that turn starts" and the prompt is "never folded into a running turn" ([skill] reference.md "Work that outlives a dispatch"). That resolution is a positive acknowledgment, so the mod can confirm delivery to the dashboard by message id, which the keystroke path cannot do ([PAN-4492](https://github.com/eltmon/overdeck/issues/4492)). The text never crosses Herdr's JSON API, so the [PAN-4506](https://github.com/eltmon/overdeck/issues/4506) failure class goes away for this path. Overdeck's steer (Ctrl+X Ctrl+S, which interrupts the turn) has no exact equivalent: `$.session.append` of a user-role `isMeta` row reaches "a running turn's requests from the loop's next top" without interrupting it, and `$.turn.abort` followed by `$.prompt.submit` interrupts. The costs are a poll interval (seconds of latency instead of near-instant typing), one HTTP request per pane per tick, and a dependency on the mod being loaded. [#96336](https://github.com/anthropics/claude-code/issues/96336) (Desktop does not show a `$.prompt.submit` turn on an idle session) is Desktop-only and does not affect terminal sessions.

**(b) Peer socket.** Claude Code has cross-session messaging: a `session.receive` hook sees each inbound delivery, and the `SendMessage` tool accepts "an explicit uds:<socket> / bridge:<session id> address" ([skill] types/claude-code.d.ts line 15542). If the dashboard could write to a session's socket, delivery would be push, not poll. The wire protocol on that socket is not documented anywhere, so this shape is **UNVERIFIED**. It is an implementation checkpoint for the follow-up: a throwaway session pair must show that a non-Claude process can deliver a message and observe the result. If that fails, the fallback is (a).

**(c) The existing Channels MCP bridge.** Overdeck already has an in-process push path: `overdeck-bridge.ts` is a per-agent MCP server that listens on a Unix socket and turns dashboard posts into Claude channel notifications (`src/lib/channels/overdeck-bridge.ts:275` — `export async function pushChannelNotification(`). It is off by default and limited to the work role (`src/lib/agents/supervisor-channels.ts:290` — `if (!isClaudeCodeChannelsMcpEnabled()) {`), and it depends on Claude Code's research-preview Channels launch flag. The bridge solves the problem mods cannot: it is a listener. Compared with it, (a) needs no preview flag and no extra process but polls; (b) would push without an extra process, if its protocol can be verified. A plugin may bundle an MCP server beside a mod (brief §9), so a later design could keep the bridge's listener and use the mod only for the acknowledgment.

**Decision rule for the follow-up.** Use the mod path only when the dashboard holds a fresh "mod live" signal for that session (for example a heartbeat the mod posts from `session.start` and its timer), and fall back to the keystroke path otherwise. Every message carries one id, so a message the mod already submitted is never typed again.

## Candidate 3: Liveness and activity signals

| Field | Finding |
| --- | --- |
| What it would do | Report turn boundaries, per-request model activity ("thinking" versus tool time), token usage and context fill from inside Claude Code to the dashboard heartbeat route, so the dashboard can tell a long model step from an idle agent. |
| Mod capability | `turn.start`, `turn.step` (a streaming hook per model request, with `usage`), `turn.complete` (`durationMs`, `usage`, `isAborted`), `session.end`, `classic.Stop`, and `$.session.usage()`; each posts with `$.http.fetch` to the existing heartbeat route. |
| Replaces or improves | Improves the activity signal. It replaces nothing: the settings-hook heartbeat stays the baseline, and the liveness verdict keeps coming from the terminal backend and the process tree. |
| Overdeck evidence | `sync-sources/hooks/pan-hook-lib.sh:343` — `pan_emit_event() {`; `src/lib/agents/liveness.ts:173` — `export async function isAlive(agentId: string, deps: LivenessAsyncDeps = {}): Promise<LivenessVerdict> {`; `src/lib/agents/liveness.ts:363` — `export function isIdle(`; `src/lib/agent-input-detection.ts:229` — `export function detectAwaitingInputFromPane(`; `src/lib/claude-hooks-registration.ts:91` — `export const OVERDECK_HOOK_REGISTRATIONS` |
| Harness parity | Claude Code only. Liveness and idleness must keep working for Codex, Pi and Kimi, so the mod can only add detail to a Claude Code agent's row. |
| Risk | Low if additive, high if relied on. An unloaded mod goes silent: [#99130](https://github.com/anthropics/claude-code/issues/99130) (remote switch off), three untraceable worker crashes, or `disableAllHooks` all stop it with no error. A dashboard that read silence as idleness would nudge or reap healthy agents. |
| Size | S for the mod (four small hooks posting to an existing route); M if the dashboard reducer and God View learn a new "thinking" activity. |
| Sources | plugin-authoring skill: reference.md "What a plugin of function hooks is" (`turn.step` streams; `classic.<Event>`) and "Work that outlives a dispatch"; docs: https://code.claude.com/docs/en/plugins/mods/reference (S3), https://code.claude.com/docs/en/plugins/mods/troubleshoot (S10); research brief §3, §6 and §8. |
| Verdict | adopt-later: the `turn.step` signal fills a real gap for long model steps, but it must stay an extra input to `isIdle`, never the only liveness source. |

**What the hooks already give.** Overdeck's settings hooks are event-driven: `PostToolUse` posts `working` with the tool name, `Stop` marks the turn's end, `UserPromptSubmit` clears the waiting state, and `PreCompact`/`PostCompact` mark compaction (`src/lib/claude-hooks-registration.ts:91` — `export const OVERDECK_HOOK_REGISTRATIONS`). Each hook is a shell process that POSTs to `/api/agents/:id/heartbeat` and buffers to `pending-events.jsonl` when the dashboard is down (`sync-sources/hooks/pan-hook-lib.sh:343` — `pan_emit_event() {`). `isIdle` then asks one question: "how old is the last real work?" (`src/lib/agents/liveness.ts:363` — `export function isIdle(`), with a 5-minute default threshold.

**The gap a mod fills.** No settings hook fires while the model is generating. A long reasoning step with no tool call produces no `PostToolUse` event, so its work activity ages exactly like an idle agent's. A `turn.step` hook runs once per model request and streams, so the mod can post "thinking" when a request starts and a token count when it ends, and `turn.complete` adds the turn's duration, usage and whether it was aborted ([skill] reference.md "What a plugin of function hooks is"; [S3](https://code.claude.com/docs/en/plugins/mods/reference)). The mod posts in process with `$.http.fetch`, so it also avoids one shell and `curl` start per event. `$.session.usage()` adds context percent and rate-limit windows, but no event fires when usage changes ([#94424](https://github.com/anthropics/claude-code/issues/94424)), so the mod reads it at turn boundaries or on a timer.

**Why the mod cannot be the liveness source.** `isAlive` asks the terminal backend (Herdr) or the tmux session, the pane and the harness process (`src/lib/agents/liveness.ts:173` — `export async function isAlive(agentId: string, deps: LivenessAsyncDeps = {}): Promise<LivenessVerdict> {`). That answer does not depend on anything inside Claude Code, which is the property to keep. A mod that is unloaded by the remote switch ([#99130](https://github.com/anthropics/claude-code/issues/99130)), by three untraceable crashes of the shared worker, or by `disableAllHooks` stops posting with no error at all ([S10](https://code.claude.com/docs/en/plugins/mods/troubleshoot)). So the dashboard may use mod events only to make an agent look busier (a fresh "thinking" event postpones idleness), never to make it look idle or dead. The pane-based waiting detector (`src/lib/agent-input-detection.ts:229` — `export function detectAwaitingInputFromPane(`) also stays, because it works for every harness.

**Context: [PAN-4522](https://github.com/eltmon/overdeck/issues/4522).** God View's frozen orbs come from the dashboard's runtime map, which a restart resets (`packages/contracts/src/event-reducers.ts:337` — `agentRuntimeById: snapshot.agentRuntimeById ?? state.agentRuntimeById,`). A mod does not fix that: its events reach the same reducer. It would only make the next activity event arrive sooner during a long model step.

## Candidate 4: AskUserQuestion and permission prompts

| Field | Finding |
| --- | --- |
| What it would do | Let the operator answer an agent's `AskUserQuestion` and its tool-permission prompts from the dashboard, with the answer returned in process, instead of denying the question (PAN-1520) and instead of reading the permission prompt off the screen and pressing keys. |
| Mod capability | `tool.call` on `AskUserQuestion`: hold the call and answer with `{ result }` without running the tool; the `AskUserQuestion` render site to show that the question waits on the dashboard; `tool.check` returning `{ decision }` to decide a permission before the dialog appears. Both hold one long-poll `$.http.fetch` to the dashboard. |
| Replaces or improves | Would replace the PAN-1520 deny hook's restate-in-prose workaround and the pane parser plus keystroke answer for permission prompts. It cannot replace the permission dialog itself, which a mod cannot redraw. |
| Overdeck evidence | `sync-sources/hooks/ask-user-question-hook:4` — `# PreToolUse hook on AskUserQuestion — denies the tool call to prevent the`; `src/lib/agent-enrichment.ts:358` — `const ASK_USER_QUESTION_HOOK_DENY_MARKER = 'PAN-1520'`; `src/lib/agent-enrichment.ts:386` — `export async function getPendingQuestions(jsonlPath: string): Promise<PendingQuestion[]> {`; `src/lib/agents/permission-prompt.ts:105` — `export function parsePermissionPrompt(paneText: string): PermissionPrompt | null {`; `src/lib/agents/permission-prompt.ts:219` — `export function permissionKeystrokes(`; `src/lib/cloister/feedback-target.ts:306` — `export async function surfaceIssueFeedbackNeedsYou(` |
| Harness parity | Claude Code only. Other harnesses keep the transcript and pane paths, so the Needs-you row and the dashboard dialog must stay harness-neutral and only gain a faster Claude Code source. |
| Risk | High. A mod that approves tool calls bypasses `ask` rules and, without the sec-default guard, non-managed `PreToolUse` blocks such as Overdeck's own `tmux-send-keys-guard`. A held call depends on a long-poll whose engine ceiling is **UNVERIFIED**. A user interrupt aborts the hold. |
| Size | M. Two hooks and a long-poll route with a per-question id, plus changes to how Needs-you learns about a question (a mod POST instead of the transcript deny marker). |
| Sources | plugin-authoring skill: reference.md "Work that outlives a dispatch" (budget pauses during `$` calls; `next.signal`), types/claude-code.d.ts `ToolCheckResult` (`allow`/`ask`/`deny`) and `HttpInit` (`{ method, headers, body, auth, socketPath }`); docs: https://code.claude.com/docs/en/plugins/mods/overview (S1, "but not the permission prompt"), https://code.claude.com/docs/en/plugins/mods/reference (S3, "Limits", render sites), https://code.claude.com/docs/en/plugins/mods/admin (S7); research brief §5, §6 and §8. |
| Verdict | adopt-later: the `AskUserQuestion` hold is a clear improvement with a built-in fallback, but permission decisions from a mod are a security change that needs its own design review. |

**AskUserQuestion today.** Claude Code's question dialog once returned option 1's label as the answer when it did not render, so Overdeck denies every `AskUserQuestion` call with a `PreToolUse` hook (`sync-sources/hooks/ask-user-question-hook:4` — `# PreToolUse hook on AskUserQuestion — denies the tool call to prevent the`). The deny reason tells the agent to restate the question in prose and wait. The dashboard finds the question by reading the transcript for the `PAN-1520` marker (`src/lib/agent-enrichment.ts:358` — `const ASK_USER_QUESTION_HOOK_DENY_MARKER = 'PAN-1520'`; `src/lib/agent-enrichment.ts:386` — `export async function getPendingQuestions(jsonlPath: string): Promise<PendingQuestion[]> {`) and shows the popup. The operator's answer then arrives as a normal user message, so the agent's turn has already ended.

**AskUserQuestion with a mod.** A `tool.call` hook on `AskUserQuestion` posts the questions to the dashboard, then holds the call on one long-poll `$.http.fetch` that the dashboard answers when the operator picks an option. The hook returns `{ result }` with the operator's choice, so the agent's turn continues with a real answer. The 10 s hook budget does not stop this: the budget counts only the hook's own time, and "a `next` or `$` call in flight does not count; a `$.clock.sleep` does" ([skill] reference.md "Work that outlives a dispatch"). So the hold must be one long-poll fetch that the dashboard keeps open, never a sleep-and-retry loop. `HttpInit` has no timeout field, and no source says whether the engine caps one fetch, so "a held fetch has no engine-imposed ceiling" is **UNVERIFIED**; the follow-up must test a hold of several minutes and fall back to re-polling if the fetch ends early. When the operator interrupts the turn, `next.signal` aborts "when that dispatch is abandoned", so the mod must abort the fetch on that signal and tell the dashboard to drop the question. The hook answers the call itself, so the later settings `PreToolUse` hooks, the PAN-1520 deny hook among them, do not run for that call ([S4](https://code.claude.com/docs/en/plugins/mods/events); brief §6). If the mod is unloaded, the deny hook runs as today, so this part has a built-in fallback. The `AskUserQuestion` render site can show "answer in the dashboard" in the pane while the call waits ([S3](https://code.claude.com/docs/en/plugins/mods/reference)).

**Permission prompts today.** Claude Code draws a blocking permission prompt even under `bypassPermissions` (`docs/DASHBOARD-ARCHITECTURE.md:600` — `## Terminal permission prompts and held messages (PAN-4278)`). Overdeck parses it from the pane text (`src/lib/agents/permission-prompt.ts:105` — `export function parsePermissionPrompt(paneText: string): PermissionPrompt | null {`), shows a dashboard dialog, and answers by pressing arrow keys and Enter (`src/lib/agents/permission-prompt.ts:219` — `export function permissionKeystrokes(`). A mod cannot change that: "the permission prompt" is the one thing the docs say a mod cannot restyle ([S1](https://code.claude.com/docs/en/plugins/mods/overview)). The permission prompt cannot be redrawn by a mod.

**Permission prompts with a mod.** A `tool.check` hook runs before the dialog: `ask` "puts it to the mode's decider (the dialog …)" ([skill] types/claude-code.d.ts `ToolCheckResult`). A mod can call `next(e)`, and only when the engine's answer is `ask`, hold a long-poll for the operator and return `allow` or `deny`, so the dialog never draws and no keys are pressed. Whether Claude Code's built-in safety checks (the "Dangerous rm operation" class) go through `tool.check` like rule-based asks is **UNVERIFIED**.

**Security finding.** Without the sec-default guard, which loads only with managed settings or a Team/Enterprise login, a user mod's `tool.check` can approve an `ask`-rule call and a call that a non-managed `PreToolUse` hook blocked ([S7](https://code.claude.com/docs/en/plugins/mods/admin); brief §8). Overdeck's own guards, such as `tmux-send-keys-guard` and `ask-user-question-hook`, are non-managed `PreToolUse` hooks installed in `~/.claude/settings.json`. A permission mod must therefore turn only an engine `ask` into the operator's decision and must never turn a `deny` into `allow`. That rule belongs in the mod's tests and in the CI review proposed in the Security section.

## Candidate 5: Flywheel and gauntlet loop pane

To be written (spec item `candidate-5-flywheel-pane`).

## Candidate 6: Reviewer and worker progress bands

To be written (spec item `candidate-6-review-worker-bands`).

## Candidate 7: Other uses

To be written (spec item `candidate-7-other-uses`).

## Security and supply chain

To be written (spec item `cross-cutting-security`).

## Managed Claude home and sync targets

To be written (spec item `cross-cutting-security`).

## Ranked adoption recommendation

To be written (spec item `ranked-recommendation`).

## Proposed follow-up issues

To be written (spec item `ranked-recommendation`).

## Appendix A: Prototype probe

The probe tested whether a small Overdeck band can be written, validated and tested without loading it into any session. It followed the PRD rules: the files lived only in `/tmp/pan-4529-mods-scratch/overdeck-band/`, nothing was written to `~/.claude/dev-mods/`, and no `--plugin-dir`, `/reload-plugins` or nested `claude -p` ran. The only commands were `claude plugin validate --json` and `claude plugin test`, both with Claude Code 2.1.288. The scratch dir was removed afterwards with `rm -rf /tmp/pan-4529-mods-scratch`.

**What was written.** Five files: `.claude-plugin/plugin.json` (name `overdeck-band`, `"types": "./types/index.d.ts"`), `hooks/hooks.json` (`{ "modules": ["./register.ts"] }`), `types/index.d.ts` (declares the state key `overdeck-band.snapshot`), `hooks/register.ts`, and `hooks/register.test.ts`. The module uses the global `h` factory instead of JSX, so it stays a plain `.ts` file. A `session.start` hook starts a 15 s `$.clock.every` timer. Each tick reads a JSON state file with `$.fs.read`, asks a dashboard route over a Unix socket with `$.http.fetch({ socketPath })`, and writes the result to `$.state`. A `ui.render` hook on `AbovePrompt` draws `<issue> · <phase>` from that state and yields to the engine when there is no snapshot or a survey holds the band.

```ts
import type { Register } from 'claude-code'
import type { OverdeckBandSnapshot } from '../types'

// Probe only: paths live in the scratch dir, never in a real session.
const STATE_FILE = '/tmp/pan-4529-mods-scratch/state.json'
const DASHBOARD_SOCKET = '/tmp/pan-4529-mods-scratch/dashboard.sock'
const snapshot = { plugin: 'overdeck-band', key: 'snapshot' } as const

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    $.clock.every(15000, () => {
      void (async () => {
        try {
          const fromFile = JSON.parse(String(await $.fs.read(STATE_FILE))) as OverdeckBandSnapshot
          const res = await $.http.fetch('http://localhost/api/issues/PAN-4529/phase', {
            socketPath: DASHBOARD_SOCKET,
          })
          const phase = res.ok ? res.text.trim() : fromFile.phase
          await $.state.set(snapshot, { issue: fromFile.issue, phase })
        } catch {
          // The band keeps the last snapshot when the file or socket is missing.
        }
      })()
    })
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { value } = await $.state.get(snapshot)
    if (e.props.hasSurvey || value == null) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return h(Box, null, h(Text, { key: 'band', dimColor: true }, `${value.issue} · ${value.phase}`))
  })
}
```

**`claude plugin validate --json` output** (condensed from the JSON; exit code 0):

```text
success: true
manifest notes:
  types ./types/index.d.ts declares on $: nothing (no EngineInterface member)
  types ./types/index.d.ts declares state: overdeck-band.snapshot
manifest warning: No author information provided. Consider adding author details for plugin attribution
hooks/hooks.json notes:
  ./register.ts hooks: session.start, ui.render{component=AbovePrompt}
  ./register.ts calls: $.clock.every, $.fs.read, $.http.fetch, $.state.get, $.state.set, $.ui.resolve
  ./register.ts state writes: overdeck-band.snapshot
  ./register.ts state reads: overdeck-band.snapshot
```

The `calls:` line lists `$.fs.read` and `$.http.fetch`, so a reviewer sees the band's file and network reach before it loads. This is the review surface the Security section builds its CI ratchet on.

**`claude plugin test` output** (final run; exit code 0):

```text
hooks/register.test.ts:
(pass) band draws issue and phase after one refresh [34.59ms]
(pass) band stays out of the way before the first refresh [10.74ms]

 2 pass
 0 fail
Ran 2 tests across 1 file. [0.16s]
```

The remote kill switch ([#99130](https://github.com/anthropics/claude-code/issues/99130)) did not block the test kit on this machine.

**What it took to pass.** The first four runs failed, and each failure taught something about the test kit that a future Overdeck mod suite needs to know:

1. The engine `$` in a test has no `state` noun (`TypeError: undefined is not an object (evaluating '$.state.set')`), and the kit holds no session state between calls. The test therefore records the band's `state.set` and answers `state.get` itself.
2. Nothing sits beneath the plugin, so the test must answer every event the plugin passes to `next`: `ui.render` (with a tree, not `null`), `session.start` (with `{ cwd }`), and each `$` call the plugin makes.
3. A test hook that answers a `$` call event (`fs.read`, `http.fetch`, `state.get`) wraps the result as `{ value: … }`; a bare result is skipped with "returned neither { value } nor { deny }".
4. A `key` on a `Text` element built with `h` did not reach the drawing (`key: undefined` in `findAll`), so the test finds the band by element type and text.

**What the probe proves and what it does not.** It proves that a band can draw issue and phase from `$.state` on the terminal and desktop surfaces, that a `$.clock.every` timer refreshes that state from a file read and a socket fetch, and that `validate` lists the `fs.read` and `http.fetch` calls a reviewer must approve. The test kit has no fs, network or process access, and the test itself answered the file read and the fetch. So the probe **does not prove a socket round trip** to the Overdeck dashboard, does not show how the band looks in a real tmux or Herdr pane, and does not measure the cost of a 15 s poll in a live session. Those stay open for the follow-up issue.

## Appendix B: Sources

**Claude Code documentation and changelog**

- [S1] Mods overview: https://code.claude.com/docs/en/plugins/mods/overview
- [S2] Create a mod: https://code.claude.com/docs/en/plugins/mods/create
- [S3] Mods reference (events, `$` API, render sites, Limits): https://code.claude.com/docs/en/plugins/mods/reference
- [S4] React to events: https://code.claude.com/docs/en/plugins/mods/events
- [S5] Use the mods API: https://code.claude.com/docs/en/plugins/mods/api, and the blog post "Customize Claude Code with mods in TypeScript" (2026-10-01): https://claude.com/blog/claude-code-mods
- [S6] CHANGELOG (2.1.287 to 2.1.289): https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
- [S7] Manage mods for your organization: https://code.claude.com/docs/en/plugins/mods/admin
- [S9] Draw in the interface: https://code.claude.com/docs/en/plugins/mods/interface
- [S10] Troubleshoot a mod: https://code.claude.com/docs/en/plugins/mods/troubleshoot
- [S12] Built-in mods source: https://github.com/anthropics/claude-code/tree/main/mods

**Upstream issues** ([S8], [S11]; all open on 2026-10-04)

- [#92533](https://github.com/anthropics/claude-code/issues/92533) Any `tool.call` hook on Bash breaks `isolation: "worktree"` agents
- [#94424](https://github.com/anthropics/claude-code/issues/94424) No event for usage changes (polling needed)
- [#95328](https://github.com/anthropics/claude-code/issues/95328), [#96485](https://github.com/anthropics/claude-code/issues/96485) `session.compact` result lost on `--resume`
- [#96336](https://github.com/anthropics/claude-code/issues/96336) Desktop does not show a `$.prompt.submit` turn on an idle session
- [#96831](https://github.com/anthropics/claude-code/issues/96831) `classic.PreToolUse` and `skill.prompt` not dispatched
- [#99045](https://github.com/anthropics/claude-code/issues/99045) VS Code draws no mod UI
- [#99130](https://github.com/anthropics/claude-code/issues/99130) Remote switch off despite on-by-default
- [#99354](https://github.com/anthropics/claude-code/issues/99354) Docked pane ignores light theme
- [#92469](https://github.com/anthropics/claude-code/issues/92469) listed by the brief's issue sweep [S11]

**The `plugin-authoring` skill (Claude Code 2.1.288, bundled copy)**

- `SKILL.md`: where a mod is written, where the types are, what happens when the turn ends.
- `reference.md`: sections "What a plugin of function hooks is", "The types are the reference", "Developing one", "Drawing: ui.render", "The rows a conversation keeps: session.append", "Work that outlives a dispatch", "Tools and agent types the model can call".
- `types/claude-code.d.ts`: the declaration file written by 2.1.288; line numbers in this report refer to that file.
- `examples/band.tsx`, `examples/pane.tsx`, `examples/tool-call.ts`.

**Research brief**

- [`claude-code-mods-research.md`](claude-code-mods-research.md), §1-§11, and its sources S1-S12.

**Community context (not used as evidence)**

- https://github.com/OneWave-AI/claude-code-mods, https://github.com/ishuagrawal/clawdhouse, https://github.com/scoobynko/claude-code-mods, https://aicoder.com/news/news-20261002-claude-code-2-1-287-mods-you-should-know
