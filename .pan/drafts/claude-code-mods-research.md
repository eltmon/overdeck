# Claude Code Mods: Research Brief

Date: 2026-10-04. Local build: Claude Code 2.1.288. Source tags: **[skill]** is the built-in `plugin-authoring` skill (SKILL.md, reference.md, and the `types/claude-code.d.ts` it writes for 2.1.288). **[S1]..[S12]** are listed at the end. **[community]** is a third-party source and is used only for context. **UNVERIFIED** marks a claim that no authoritative source confirms.

## 1. What a mod is

- A mod is a Claude Code plugin whose `hooks/hooks.json` has a `modules` key naming one hooks module (JS/TS). The module exports `register(on, options)`. "Having it is what makes the plugin a mod." [S2][S3]
- Each `on(event, matcher?, hook)` call registers a middleware-style hook `($, e, next)`. `$` is the mods API (frozen). `e` is the event input, deeply frozen. `next(e)` runs the later mods and then Claude Code's own behavior. A hook can **observe** (`return next(e)`), **rewrite** (`next({...e, x})`), or **answer** (return a result without calling `next`). [S1][S4][skill]
- Released 2026-10-01 in 2.1.287. The changelog entry reads "Added Claude Mods: plugins may now modify deeper behavior". Docs say mods "require Claude Code v2.1.287 or later, and they're on by default." [S6][S1][S5]
- They existed before 2.1.287 as an early-access "function hooks" runtime behind `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS`, which 2.1.287+ ignores. Issues from 2.1.263 reference `/plugin-types`. [S1][S8][S11]
- **Stability is stated two ways.** The local types header says "EARLY ACCESS: this surface may change between releases without notice", and reference.md says "The API is early access and moves between releases: the declaration file is the authority". The blog and docs carry no beta label but say events and methods "can change between releases". [skill][S2][S5]

## 2. File layout, loading, scoping, hot reload

**Layout** [S3][skill]:
```
<mod>/.claude-plugin/plugin.json   # ordinary plugin manifest; optional "types": "./types/index.d.ts"
<mod>/hooks/hooks.json             # { "modules": ["./register.ts"] }; may also hold settings hooks under "hooks"
<mod>/hooks/register.(js|ts|tsx|jsx|mjs|cjs|mts|cts)   # ES module, exports register
<mod>/types/index.d.ts             # required when using $.state or adding a $ namespace
<mod>/**/*.test.ts(x)              # run by `claude plugin test`
```
- At each load, Claude Code writes generated types to `<mod>/.claude-plugin/types/`: `claude-code/` (API), `claude-code-tools/`, `claude-code-mcp/`, dependency contracts, and a `tsconfig.json`. A public copy is at `anthropics/claude-code/mods/types/claude-code.d.ts`. [S2][skill]
- **Static-analysis rules.** The loader reads the source before running it. Event names must be string literals. `$` calls must be written in full (no `const ui = $.ui`, no destructuring). Imports are static, relative, and inside the plugin, with `claude-code` as the only bare import. There is no `require` and no dynamic `import()`. `$.env` names and `$.state` keys must be literals. A module that breaks these rules does not load. [S2][skill]

**Ways a mod loads (scope)**:

| Scope | Mechanism | Notes |
|---|---|---|
| Session (Claude-written) | `~/.claude/dev-mods/<session-id>/<mod>/`. The first file write triggers a one-time "Enable hot reloading for this session?" prompt. | Loads at the end of the turn and reloads at the end of each turn that edits it. Lasts across resume of that session. The folder is deleted after `cleanupPeriodDays`. [S2][skill] |
| One session, from disk | `claude --plugin-dir <dir or .zip>` (repeatable), `--plugin-url <zip>` | Watched and hot-reloaded in interactive sessions. [S3][skill] |
| Apps without flags (Desktop, SDK) | `CLAUDE_CODE_PLUGIN_DIRS` from the process env or the `env` block of `~/.claude/settings.json` (**never project settings**) | `CLAUDE_CODE_PLUGIN_DIR_WATCH=1` makes long-lived headless/SDK sessions reload on save. [S3][skill] |
| User/project install | `/plugin install name@marketplace`. A marketplace can be registered in repo settings. | Installed copies are cached by version, so edits need a version bump and reinstall. `/reload-plugins` picks up shell installs. [S1][S2] |
| Organization | Managed `extraKnownMarketplaces` (a **directory** marketplace at an absolute path, plugin listed by relative path) plus managed `enabledPlugins`, and optionally `prependPlugins`/`appendPlugins` | Plugins copied from GitHub/git/URL/npm count as the **user's**, even when managed settings enable them. [S7] |

**Hot reload semantics** [skill][S2][S9]:
- Each reload runs `register` again in a fresh environment. `session.start` fires again, previous timers are dropped, and module variables reset. `$.state` (session-scoped, host-held) and `$.store` (persistent) survive.
- Saves made during the session's own turn reload once when the turn ends, or earlier if a tool or command the plugin registered is about to run. External saves reload after a quiet period (about 0.25 s for a single save).
- A broken save logs "reload failed, the previous version stays loaded". `claude -p` always loads fresh.

**Hot reload is unavailable** under `claude -p` or `dontAsk` (nobody can approve), in an untrusted workspace, with `--safe-mode`/`--bare`/`disableAllHooks`, or under org policy. [S2]

## 3. Event surface

All events, from the reference [S3] and the types `EngineResultOf`/`EngineEventOf` [skill]:

| Group | Events |
|---|---|
| Tools | `tool.call` (deny / rewrite args / `{result}` without running / retry by calling `next` twice), `tool.check` (final `allow`/`ask`/`deny` after rules and settings hooks), `tool.describe` (rewrite a description, defer to tool search) |
| Prompts / what the model reads | `prompt.submit` (rewrite text, add model-only `context`, `{drop}`), `prompt.fill`, `prompt.suggest`, `prompt.edit`, `prompt.compose` (system prompt sections), `prompt.section`, `prompt.context`, `prompt.attachment` (reminders), `skill.prompt`, `attribution.text` |
| Commands/config | `command.run`, `command.describe`, `config.set`, `config.describe` |
| Turns | `turn.start`, `turn.step` (**streaming** async generator per model request: can switch `model`/`effort`, read `usage` incl. cache tokens, or answer without calling the model), `turn.complete` (`answer`, `durationMs`, `usage`, `isAborted`, `agentId`) |
| Session | `session.start`, `session.end` (`reason`: clear/resume/logout/prompt_input_exit/other), `session.compact` (`{skip}`), `session.receive`/`session.send` (cross-session messaging), `session.append` (every stored transcript row; can rewrite `content`), `session.attach`/`detach` (remote surfaces), `session.measure` |
| Subagents | `agent.offer`, `agent.spawn` (`{model}` / `{deny}`) |
| UI | `ui.render`, `ui.resolve`, `ui.press`, `ui.input`, `ui.select`, `ui.focus`, `ui.scroll`, `ui.close`, `ui.message` |
| Other mods | `plugin.register` (refuse a module by `tier`/`uses`), `engine.create` (add or withhold `$` namespaces) |
| Telemetry | `telemetry.log`, `telemetry.mark`, requiring a `{to:'collector'}` (customer OTel) or `'anthropic'` matcher |
| Settings-hook bridge | `classic.<Event>` for every settings hook event: PreToolUse, PostToolUse, PostToolUseFailure, PostToolBatch, Stop, StopFailure, SubagentStart/Stop, SessionStart/End, UserPromptSubmit, UserPromptExpansion, PreCompact/PostCompact, Notification, PermissionRequest/Denied, Pre/PostModelSwitch, FileChanged, CwdChanged, ConfigChange, InstructionsLoaded, MessageDisplay, TaskCreated/Completed, TeammateIdle, Worktree*, Elicitation*, Setup, DirectoryAdded. `e` is the settings hook's stdin JSON, including `transcript_path`. [skill] |
| API calls as events | Every `$.ns.method` is also an event (`fs.read`, `http.fetch`, `process.spawn`, …), so an earlier mod can observe, rewrite or `{deny}` a later mod's calls. [S3][S4] |

Matchers are field objects (value, array, or RegExp). `*` and `classic.*` are wildcards, but `*` does not match telemetry. Registering one event twice without a matcher fails the load. [S4]

## 4. `$` API surface (2.1.288)

| Namespace | Methods (selected detail) |
|---|---|
| `$.ui` | `open`/`close`/`panes` (panes), `status` (one pinned line per plugin under the prompt), `toast` (4 s default), `log` (dim transcript line, not sent to the model, or `{to:'debug'}`), `notice` (a line under an open tool dialog), `ask` (AskUserQuestion dialog; rejects in `-p`), `invalidate`, `resolve`, `focus`, `scroll`, `copy`, `blit`, `selection` (2.1.288) |
| `$.session` | `messages()` (newest 4,096; `{role,text,toolUses}` or `{as:'api'}`; per-`agentId`), `id`, `cwd`, `root`, `model`, `turns`, `repo`, `surfaces`, `usage()` (`{startedAt, context{tokens,window,percent}, rateLimits[{kind,percentUsed,resetsAt}], cost}`), `version`, `compact`, `send`, `append`, `authorize` (an opaque first-party credential handle usable only via `$.http.fetch`) |
| `$.prompt` | `submit({text, asUser?})`, `read`, `fill`, `suggest`, `compose` |
| `$.turn` | `abort` |
| `$.tool` / `$.command` / `$.agent` | `register`/`call`/`check`/`list`; `register`/`run`/`list`; `register`/`spawn`/`list` |
| `$.model` | `complete` (no history; `maxTokens` default 1024), `fork` (one tool-less question over the session transcript, served from the prompt cache), `classify` |
| `$.fs` | `read` (4 MiB), `write` (non-atomic), `list`, `exists`, `stat({resolve})`, `ancestors` |
| `$.process` | `run(argv)` (no shell; 30 s default, 10 min max; git runs with repo hooks off), `spawn` (streaming child whose lifetime is the `for await` loop) |
| `$.http` | `fetch(url, {method, headers, body, auth, socketPath})` |
| `$.mcp` | `call(server, tool, args)` (the engine's connection; "No permission prompt"), `connect` (only servers in the mod's own manifest) |
| `$.store` / `$.state` | Persistent JSON KV shared by all sessions on the machine (4 MiB, `~/.claude/plugins/store/`, not atomic across sessions) / reactive session state (`atom`, `read`, `update`, `derive`, `memberOf`) |
| `$.clock` | `now`, `sleep`, `after`, `every` (replace `setTimeout`/`setInterval`) |
| `$.settings` / `$.env` | `read` (merged or per source, unfiltered, including `env`) / `get`, `set` (literal names; `set` affects every later Bash/MCP/process child) |
| `$.audio` / `$.config` / `$.telemetry` / `$.plugin` | `play` (macOS `afplay`; **Linux terminals play nothing**), `speak` / `list`, `set` / `log`, `mark` / `name`, `root` |

Sources: [S3][S5][skill].

**Capability answers to the specific questions:**
- **Send input into the session.** Yes. `$.prompt.submit` queues a new turn once the session is idle. It "never folded into a running turn" and resolves when the turn starts. `asUser:true` drops the "from mod X" framing. `$.prompt.fill` writes the prompt box. `$.session.append` adds a user-role `isMeta` row the model reads, or a system notice the model does not. `$.session.send` messages another session or subagent. `$.turn.abort` cancels the turn. [S5][skill]
- **Read or modify prompts and tool calls.** Yes, fully: `prompt.submit`, `prompt.compose`/`section`, `tool.call`, `tool.check`, and `session.append` for every stored row. The permission prompt itself cannot be redrawn. [S1][S4]
- **Network.** `$.http.fetch` (http/https and **Unix domain sockets via `socketPath`**). It is subject to the org web-fetch policy and `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` (requests carrying `auth`). There is no raw TCP/UDP/WebSocket API in `$`. A spawned process has the user's full network access. [skill][S7]
- **Long-lived background work.** Yes. Start it from `session.start` with `$.clock.every/after`, or a detached `$.process.spawn` loop that "runs on after the hook returns, and ends with the child or with the module". Timers and children die on reload. [skill][S5]
- **Talk to an external process.** Through `$.process.run/spawn` (stdio streams), `$.http.fetch` over a Unix socket, `$.fs`, `$.mcp.call`, or `Image` reading a file or POSIX shared-memory object another process wrote. [skill]
- **Data received.** Session id, transcript path (via `classic.*`), transcript messages, tool calls and results, per-request token usage (`turn.step`), turn totals, context %, rate-limit windows, cost, model, cwd/repo, and agent list. [S3][S4][skill]

## 5. UI primitives

- **Pane.** `$.ui.open({id,title,focus?,closeOnEscape?,holdToasts?,rows?,columns?})` plus a `ui.render` hook on `{component:'Pane', requestId:id}`. It docks as a sidebar in a wide **fullscreen** terminal and sits inline above the prompt otherwise. A pane the user did not ask for is placed only at 144 or more columns (110 once the user has opened it); `isPlaced:false` otherwise. [S9][S3]
- **Band.** `ui.render` on `AbovePrompt`, shared by all mods. A returned tree replaces what later mods draw unless it embeds `await next(e)`. [S9]
- **Status line** `$.ui.status`, **toast** `$.ui.toast`, **log line** `$.ui.log`, **notice** `$.ui.notice`, **question dialog** `$.ui.ask`, **sound** `$.audio`. [S3][skill]
- **Restyling built-in sites.** `UserMessage`, `AssistantMessage`, `ToolUse`, `ToolResult`, `ToolGroup`, `CommandOutput`, `AskUserQuestion`, `Spinner`, `PromptHint`, `SessionMode` (terminal and desktop), and `ToolProgress`, `TurnDuration`, `InfoNotice` (terminal only). [S3]
- **Elements.** `Box`, `Text`, `Button`, `Link`, `Code`, `Markdown`, `Input`, `Select`, `Client` (a second module of yours for animation and pointer input, with no `$` access; it posts `ui.message`), `Svg` (desktop only), `Raster` and `Image` (terminal only; kitty graphics where supported). [S3][S9][skill]
- **Keyboard.** A mod never reads raw keys. Focus comes via Ctrl+X Tab, a click, or `focus:true`. Tab and the arrow keys cannot be rebound. A tree that fails validation is replaced by the engine's own drawing and logged. [S9][S10]

## 6. Runtime model

- **Language and environment.** JS/TS (TS and JSX compiled by the engine, no build step). The environment is isolated: "no DOM, no Node", no `setTimeout`, no `require`. Web APIs available include `URL`, `TextEncoder`, `AbortController`, and `crypto.subtle`. [skill][S5]
- **Process.** Installed mods share **one worker thread**; the debug line reads `loaded (worker, environment 2, tier user)`. A mod that blocks or crashes the worker is unloaded. After 3 untraceable crashes, all non-built-in mods are off until `/reload-plugins`. [S10][S7]
- **Not sandboxed.** "Mods run with the same access to your machine as Claude Code itself. They aren't sandboxed." The Bash sandbox, when enabled, does not cover processes a mod starts. [S5][S1]
- **Time budgets** (the hook's own CPU and wait time; the clock pauses during `next` and `$` calls except `$.clock.sleep`): hook 10 s, `.catch` 1 s, linger after abort 5 s, all `session.end` hooks together 1.5 s. Redraws are throttled to 10/s (30/s for the visible terminal pane, band and hint). [S3][skill]
- **Failure isolation.** A hook that throws, times out, or returns a bad shape before calling `next` is skipped and the chain continues (**fail-open**). If it fails after `next` resolved, that result stands. `.catch(handler)` lets a guard fail closed. A broken reload keeps the previous version. [S4][S10]
- **Chain order (tiers).** `prepend` (sec-default guard plus managed `prependPlugins`) → `user` → `append` → `builtin` → `core`. Managed `PreToolUse` hooks run before every mod and their block is final. Other settings `PreToolUse` hooks run after the last mod as part of `core`, so a mod that answers `tool.call` itself skips them. [S4][skill]

## 7. Surfaces

| Where | Hooks run | Drawing shows |
|---|---|---|
| `claude` in a terminal (incl. editor terminals, JetBrains) | Yes | Yes |
| Desktop Code tab | Yes | Yes, minus terminal-only elements (`Raster`, `Image`) and sites |
| Desktop WSL session | No | No |
| VS Code extension chat panel | Yes | **No** (issue #99045) |
| `claude -p` / Agent SDK | Yes | No (`ui_log` messages reach the SDK host; `$.ui.ask` rejects) |
| Remote Control (claude.ai/mobile) | Yes, on the local machine | In the local terminal |
| Cloud sessions | Yes, if the plugin carries over | No |

Source: [S1][S12][skill]. The types still list a `mobile` surface table without `Input`/`Select`. [skill]

**tmux** (types file only; the public docs say nothing) [skill]:
- Under tmux Claude Code defaults to the **main-screen layout** (`isFullscreen:false`, "`CLAUDE_CODE_NO_FLICKER=0`, tmux by default"). Panes therefore open **inline above the prompt**, not docked beside the transcript, and the docking threshold applies only in fullscreen.
- "tmux passes none through" for sub-cell pointer coordinates.
- Clipboard (`$.ui.copy`) can go through tmux's buffer or OSC 52.
- `Image` uses kitty graphics "where the terminal has it (kitty, Ghostty), its alt elsewhere". Passthrough through tmux is not documented; treat it as falling back to `alt` (**UNVERIFIED**).
- `$.ui.selection()` returns `undefined` when fullscreen is off, so it does not work by default under tmux.

## 8. Distribution, security, enterprise controls

- **Sharing.** Mods ship as plugins: a directory or zip, a private marketplace, the managed org marketplace, or submission to Anthropic's directory. `claude plugin validate` rejects names that look like Anthropic's own (`claude-…`). [S2][S5]
- **Trust.**
  - The workspace trust prompt must be accepted before any mod loads.
  - Claude-written mods need the per-session hot-reload approval.
  - `~/.claude` and `--plugin-dir` folders are protected paths, so default and `acceptEdits` modes prompt for each file Claude writes.
  - There is **no per-mod capability consent at install time**. Review is manual with `claude plugin validate` (it prints `hooks:`, `calls:`, `env reads/writes`, `state reads/writes`). [S7][S2][S1]
- **What a mod can reach** (docs' own list): files, processes and network as the user; env vars and settings (API keys); every prompt and tool call; rewriting them; submitting prompts as the user; approving tool calls before the user is asked; spending model usage. [S1]
- **Built-in guard `sec-default@builtin`** loads only with managed settings or a Team/Enterprise login (not API-key or Bedrock/Vertex/Foundry users without managed settings). It protects managed hooks, the system prompt, managed CLAUDE.md, settings reads, and managed MCP tools, and it enforces `deny` rules over mod approvals. It does **not** restrict a mod's own `$.fs`/`$.process` calls: with `Read(.env)` denied, a mod can still `$.fs.read` it. It fails closed. Without the guard, a user mod's `tool.check` can approve an `ask`-rule call or a non-managed `PreToolUse`-blocked call, and in auto mode an approved call skips the classifier. [S7][S1]
- **Managed settings keys:**
  - `pluginConfigs["cc-plugin-sec-default@builtin"].options.allowManagedModsOnly` and `allowModsToOverrideDenyRules`.
  - `allowManagedHooksOnly` and `disableAllHooks` (in user settings this also stops custom status lines and settings hooks).
  - `disableSideloadFlags` (blocks `--plugin-dir`, `--plugin-url`, Claude-written mods, `--agents`, `--mcp-config`).
  - `prependPlugins`/`appendPlugins` and `strictKnownMarketplaces`.
  - Policy mods via `plugin.register` refusals plus per-call event hooks (`fs.write`, `process.run`, …). [S3][S7]
- **Remote kill switch.** Anthropic can turn installed mods off remotely ("hooks modules are turned off in this process"). Check with `claude plugin test` in a directory with no mod. **On this machine it printed `no hooks module to load` = mods can load.** Issue #99130 reports the switch serving off on 2.1.288 for some users. [S10][S8]
- **Supply chain.** Installed plugins are cached by version. Org mods count as the org's only from an admin-writable local directory marketplace ("Anyone who can write there can rewrite your mod"). [S7][S2]

## 9. Relationship to existing features

- **Settings hooks** (`settings.json` command/HTTP/prompt/agent hooks) are unchanged and "Nothing about them is deprecated". Mods can observe or answer them through `classic.*`. The same `hooks/hooks.json` can hold both. [S7][S3][S4]
- **statusLine.** The docs present mods as coexisting with it. `$.ui.status` adds one pinned line per plugin "beside the engine's own pinned notices", and `disableAllHooks` stops custom status lines too. The docs do not say mods replace `statusLine`. [skill][S1]
- **Plugins/marketplaces.** A mod *is* a plugin, and every plugin install, update and policy control applies. One plugin can bundle a mod, skills, agents and MCP servers. `disableAllHooks`/`allowManagedModsOnly` stop only the mod part. [S1]
- **MCP.** `$.tool.register` exposes in-process tools as `mcp__<plugin>__<name>`. `$.mcp.call` drives connected servers without a permission prompt. Docs position MCP for reaching external systems and mods for UI and in-process event rewriting. [S1][S5]
- **Built-in mods:** `cc-plugin-diff` (`/diff` pane), `cc-plugin-agents-md`, `cc-plugin-sec-default`, `cc-plugin-telemetry`, `cc-plugin-plugin-authoring` (skill only), and `cc-plugin-you-should-know` (side agent, off by default). Source for four of them is in `anthropics/claude-code/mods/`. [S1][S12]

## 10. Limitations and known issues

- **Size and time limits:**
  - 4 MiB per fs read/write.
  - 4 MiB total store.
  - 10,000 characters per Text/Code/Markdown.
  - `$.session.messages` returns the newest 4,096 entries.
  - Raster up to 512×256 cells.
  - Image up to 2 MiB.
  - Names up to 64 chars of `[A-Za-z0-9_-]`.
  - A `claude plugin test` test times out after 5 s by default.

  [S3]
- **State resets.** `/clear`, `/resume` and `/branch` reset `$.state` without firing `session.start`; reload from `classic.SessionStart` instead. [S9]
- **Auto mode.** A hook that rewrites tool input after classifier review causes a denial. [S10]
- **Open GitHub issues** [S11]:

  | Issue | Problem |
  |---|---|
  | #99130 | Remote switch off despite on-by-default |
  | #99045 | VS Code draws no mod UI |
  | #96336 | Desktop does not show a `$.prompt.submit` turn on an idle session |
  | #96831 | `classic.PreToolUse`/`skill.prompt` not dispatched |
  | #92533 | Any `tool.call` hook on Bash breaks `isolation:"worktree"` agents |
  | #95328, #96485 | `session.compact` result lost on `--resume` |
  | #99354 | Docked pane ignores light theme |
  | #94424 | No event for usage changes (polling needed) |

- **2.1.289** (not installed here) adds `agent.spawn` for teammates, idle/waiting states in `$.agent.list()`, and `ui.fault` for failing `Client`s. [S6]
- **Community** projects show an early ecosystem: OneWave-AI/claude-code-mods, ishuagrawal/clawdhouse, scoobynko/claude-code-mods, and Anthropic's `claude-code-playground/claude-code/mods` samples (token-weather, blast-radius, replay-theater; unsupported). [community][S1]

## 11. Open questions (not confirmed by an authoritative source)

1. **Herdr.** No source covers Herdr. Whether it reports fullscreen, docks panes, passes mouse/pixel events, OSC 52 or kitty graphics is **UNVERIFIED**.
2. **tmux and kitty graphics.** Whether `Image` survives tmux with `allow-passthrough` is undocumented, and so is whether forcing fullscreen under tmux (`CLAUDE_CODE_NO_FLICKER=1`?) docks panes.
3. **Desktop Code tab.** Pane placement, widths and focus behavior beyond the render-site and element tables are undocumented.
4. **Spawned or automated sessions.** For managed agents launched non-interactively or with `dontAsk`, are Claude-written mods silently skipped? (The docs imply yes; untested here.) Does `CLAUDE_CODE_PLUGIN_DIRS` plus `CLAUDE_CODE_PLUGIN_DIR_WATCH=1` behave identically under SDK hosts?
5. **statusLine.** Ordering and layout interaction between `$.ui.status` lines and a custom `statusLine` command is undocumented.
6. **Hook budget.** The precise semantics of the 10 s budget under worker contention (many mods, one thread) are undocumented.
7. **`$.store` location.** Whether the store is keyed by plugin name or by plugin id (a name collision between an `@inline` and an installed copy) is unconfirmed.
8. **Rollout switch.** The rollout cohorting and refresh cadence of the remote switch (#99130) are unknown.

## Sources

- [S1] Mods overview: https://code.claude.com/docs/en/plugins/mods/overview
- [S2] Create a mod: https://code.claude.com/docs/en/plugins/mods/create
- [S3] Mods reference: https://code.claude.com/docs/en/plugins/mods/reference
- [S4] React to events: https://code.claude.com/docs/en/plugins/mods/events
- [S5] Blog, "Customize Claude Code with mods in TypeScript" (2026-10-01): https://claude.com/blog/claude-code-mods, and Use the mods API: https://code.claude.com/docs/en/plugins/mods/api
- [S6] CHANGELOG (2.1.287–2.1.289): https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
- [S7] Manage mods for your organization: https://code.claude.com/docs/en/plugins/mods/admin
- [S8] Issue #99130: https://github.com/anthropics/claude-code/issues/99130
- [S9] Draw in the interface: https://code.claude.com/docs/en/plugins/mods/interface
- [S10] Troubleshoot a mod: https://code.claude.com/docs/en/plugins/mods/troubleshoot
- [S11] Open issues via `gh issue list -R anthropics/claude-code` (2026-10-04): #92469, #92533, #94424, #95328, #96336, #96485, #96831, #99045, #99354
- [S12] Built-in mods source: https://github.com/anthropics/claude-code/tree/main/mods
- [skill] `plugin-authoring` skill, Claude Code 2.1.288: SKILL.md, reference.md, types/claude-code.d.ts (local bundled copy)
- [community] https://github.com/OneWave-AI/claude-code-mods, https://github.com/ishuagrawal/clawdhouse, https://github.com/scoobynko/claude-code-mods, https://aicoder.com/news/news-20261002-claude-code-2-1-287-mods-you-should-know
