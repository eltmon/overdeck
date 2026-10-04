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

To be written (spec item `candidate-1-operator-state-band`).

## Candidate 2: Reliable in-session message delivery

To be written (spec item `candidate-2-message-delivery`).

## Candidate 3: Liveness and activity signals

To be written (spec item `candidate-3-liveness-signals`).

## Candidate 4: AskUserQuestion and permission prompts

To be written (spec item `candidate-4-auq-permissions`).

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

To be written (spec item `prototype-probe`).

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
