The report is complete and printed below. I could not create `/home/eltmon/Projects/overdeck/.tmp/herdr-capability-research.md`: the workspace is mounted read-only, and both absolute and repo-relative patch attempts were rejected by the sandbox.

# Herdr 0.9.1 capability research for Overdeck

Date: 2026-09-20  
Scope: Overdeck `main`, installed `herdr 0.9.1`, and Herdr’s versioned 0.9.1 documentation.

## Verdict

Overdeck is using Herdr as a **materially better terminal substrate**, but not yet as an agent-runtime authority.

It gets named servers, issue-grouped panes, metadata, live inventory/events, and direct dashboard terminal streaming. For Claude Code, it also gets first-class detection and guarded `agent.prompt`. Those are real improvements over tmux.

Most specifically agentic benefits remain unrealized:

- Every harness except Claude is deliberately pane-bound.
- `agent.wait` has no production caller.
- Native session references are discarded.
- Herdr worktrees, notifications, and remote machines are unused.
- Missing Herdr binary/socket silently changes the backend to tmux.

The PAN-3917 cut replaced the multiplexer and improved the read model, but retained most readiness, delivery, transcript/session, recovery, worktree, and remote orchestration machinery.

**Recommendation:** make Herdr a checked, supervised dependency and remove automatic fallback. Do **not** install all integrations globally. Pilot lifecycle-authority integrations for Pi/OMP/Kimi/OpenCode with `resume_agents_on_restore = false`. Defer Claude/Codex/Hermes integrations until Overdeck consumes session references. For Codex behind the app-server host, add lifecycle/session reporting to that host; the official Codex integration cannot solve its detection problem.

## 1. Capability audit

“Material” means it can remove correctness-sensitive machinery or substantially improve orchestration. “Marginal” means useful operational/UX polish without changing Overdeck’s control model.

| Herdr capability | Benefit over tmux; impact | Used today? | Replacement or simplification |
|---|---|---|---|
| Named detached server and per-home sessions | Stable headless server/API instead of tmux socket and command parsing. **Material.** | **Yes.** Default home maps to `overdeck`; other homes to `overdeck-<sha1[0:8]>`. ([instance-name.ts:23–30](/home/eltmon/Projects/overdeck/src/lib/instance-name.ts:23), [select.ts:82–97](/home/eltmon/Projects/overdeck/src/lib/terminal-backends/select.ts:82)) | Already replaces the tmux server when selected. Installation and service lifecycle are not owned. |
| Workspaces and panes | Native issue grouping and stable pane identities. **Material.** | **Yes.** Adapter looks up/creates an issue workspace, stamps metadata, and splits panes. ([herdr.ts:512–552](/home/eltmon/Projects/overdeck/src/lib/terminal-backends/herdr.ts:512)) | Removes tmux session-name inference on the Herdr path. Does not replace Overdeck’s workspace database. |
| Local NDJSON API | Structured snapshots and operations instead of scraping CLI output. **Material.** | **Yes.** Protocol-22 client uses bounded frames and never retries ambiguous mutations. ([herdr-api.ts:1–25](/home/eltmon/Projects/overdeck/src/lib/terminal-backends/herdr-api.ts:1), [herdr-api.ts:59–89](/home/eltmon/Projects/overdeck/src/lib/terminal-backends/herdr-api.ts:59)) | Already replaces most tmux CLI calls inside the adapter. |
| Pane metadata/tokens | Stable issue, role, harness, model, and agent identity independent of labels. **Material.** | **Yes.** Metadata is stamped at launch and returned in inventory. ([herdr.ts:586–590](/home/eltmon/Projects/overdeck/src/lib/terminal-backends/herdr.ts:586), [herdr.ts:919–930](/home/eltmon/Projects/overdeck/src/lib/terminal-backends/herdr.ts:919)) | Replaces tmux name parsing and supports safer routing. |
| Agent detection and `agent_status` | Semantic `working/blocked/idle/done/unknown`, versus tmux activity heuristics. **Material.** | **Partial: Claude only.** All other harnesses are intentionally pane-bound. ([launch.ts:35–59](/home/eltmon/Projects/overdeck/src/lib/terminal-backends/launch.ts:35), [herdr.ts:602–611](/home/eltmon/Projects/overdeck/src/lib/terminal-backends/herdr.ts:602)) | Lifecycle integrations or host reports could replace output-age and screen heuristics. Session-only integrations cannot. |
| `agent.get` and `agent.list` | Deterministic identity/status rather than process and session-name probes. **Material.** | **Partial.** Lookup tries `agent.get`, then pane tokens/snapshot; inventory merges agent and pane-bound rows. ([herdr.ts:277–330](/home/eltmon/Projects/overdeck/src/lib/terminal-backends/herdr.ts:277), [herdr.ts:433–475](/home/eltmon/Projects/overdeck/src/lib/terminal-backends/herdr.ts:433)) | Could become the single async liveness oracle after all harnesses report lifecycle. |
| `agent.prompt` | Agent-aware paste/Enter ordering, blocked-agent refusal, optional settle wait. **Material for direct TUIs; marginal for hosted transports.** | **Claude/direct agents only.** Codex app-server and ACP/OpenCode are excluded. ([delivery.ts:52–68](/home/eltmon/Projects/overdeck/src/lib/agents/delivery.ts:52), [delivery.ts:387–425](/home/eltmon/Projects/overdeck/src/lib/agents/delivery.ts:387)) | Could simplify direct-TUI delivery. It must not replace authenticated app-server/ACP RPC or Overdeck’s durable keyed delivery. |
| `agent.wait` | Event-driven wait for semantic state instead of polling output or files. **Material.** | **Implemented but unused.** ([herdr.ts:803–825](/home/eltmon/Projects/overdeck/src/lib/terminal-backends/herdr.ts:803)); repository search found no production caller. | Could replace TUI readiness scraping after lifecycle status is authoritative. It cannot replace the journal-aware stalled-review policy. |
| `pane wait-output` | Server-side output matching instead of repeated capture calls. **Material for ordinary commands; marginal for integrated agents.** | **No.** Herdr pane reads are one-shot. ([herdr.ts:477–489](/home/eltmon/Projects/overdeck/src/lib/terminal-backends/herdr.ts:477); `herdr pane wait-output --help`) | Useful bridge for readiness while integrations are incomplete. |
| Event stream | Push state and pane changes rather than polling tmux. **Material.** | **Yes, with a reconnect defect.** ([herdr.ts:858–917](/home/eltmon/Projects/overdeck/src/lib/terminal-backends/herdr.ts:858), [backend-inventory.ts:363–391](/home/eltmon/Projects/overdeck/src/dashboard/server/services/backend-inventory.ts:363)) | Replaces most dashboard polling; five-second snapshots remain a fallback. |
| Terminal observe/control | Direct terminal read/write/resize tied to terminal IDs. **Material UX improvement.** | **Yes.** ([herdr.ts:827–833](/home/eltmon/Projects/overdeck/src/lib/terminal-backends/herdr.ts:827), [terminal-service.ts:302–329](/home/eltmon/Projects/overdeck/src/dashboard/server/services/terminal-service.ts:302)) | Replaces browser-to-tmux PTY attachment. |
| Session identity/native restore | Restores the real conversation after a server restart. **Material but currently unsafe.** | **No.** Protocol schema contains `agent_session`, but adapter snapshots discard it; `resume()` is unsupported. ([herdr.ts:941–951](/home/eltmon/Projects/overdeck/src/lib/terminal-backends/herdr.ts:941)) | Could replace portions of `session.id`, `sessions.json`, `codex-thread-id`, and transcript-discovery logic. ([session-pointers.ts:17–71](/home/eltmon/Projects/overdeck/src/lib/agents/session-pointers.ts:17)) |
| Live handoff | Preserve PTYs across a binary/server upgrade. **Material operationally.** | **Not managed by Overdeck.** | Could reduce upgrade disruption, but subscriptions and in-flight operations must reconnect. |
| Herdr worktrees | Creates a Git worktree and Herdr workspace together. **Marginal now; material only in a redesign.** | **No.** Overdeck owns Git and database lifecycle. ([create.ts:351–405](/home/eltmon/Projects/overdeck/src/lib/workspaces/create.ts:351)) | Mixing both would create dual ownership. Adopt only as a full lifecycle migration. |
| Notifications | In-app toast and optional request/done sound. **Marginal.** | **No.** | Optional mirror for local attention; cannot replace durable `needs-you`, which classifies questions, permissions, rate limits, pane prompts, and resume gates. ([agent-enrichment.ts:43–65](/home/eltmon/Projects/overdeck/src/lib/agent-enrichment.ts:43), [agent-enrichment.ts:106–165](/home/eltmon/Projects/overdeck/src/lib/agent-enrichment.ts:106)) |
| Machines/SSH federation | Aggregate local and SSH-hosted Herdr sessions. **Marginal for current Overdeck.** | **No.** | Could display terminals on already-provisioned hosts. It cannot replace Fly provisioning, authentication, workspace sync, resource policy, or teardown. ([remote/interface.ts:1–6](/home/eltmon/Projects/overdeck/src/lib/remote/interface.ts:1)) |
| Prompt authority/dedupe | Metadata-backed target checks beyond tmux. **Material safety feature, mostly Overdeck-owned.** | **Partial.** Only worker targets are authority-gated; dedupe is in-memory/per-process. ([prompt-guard.ts:9–19](/home/eltmon/Projects/overdeck/src/lib/terminal-backends/prompt-guard.ts:9), [prompt-guard.ts:132–203](/home/eltmon/Projects/overdeck/src/lib/terminal-backends/prompt-guard.ts:132)) | Herdr does not replace durable delivery keys or Overdeck’s role policy. |

The stalled-review routine is a good example of the limit. `agent.wait` could improve the liveness input, but cannot replace logic that examines the last pipeline event, missing verdict, run state, elapsed age, and redispatch cooldown. ([deacon-lite.ts:185–287](/home/eltmon/Projects/overdeck/src/lib/cloister/deacon-lite.ts:185))

## 2. Official integrations

All are currently absent (`herdr integration status`).

Herdr’s authority model is:

1. A complete, actively reporting lifecycle integration wins. Screen fallback is disabled for that lifecycle authority.
2. Without lifecycle reporting, Herdr combines foreground-process detection with its bottom-of-buffer screen rules.
3. Session-identity-only reports attach `agent_session`; they do not override screen-derived status.

Direct integrations inherit `HERDR_PANE_ID`, `HERDR_SOCKET_PATH`, `HERDR_BIN_PATH`, and `HERDR_ENV`, then report through `pane report-agent`/`pane.report_agent`. Sequence numbers prevent stale updates from winning. [Herdr integrations](https://herdr.dev/docs/integrations) and [agent status documentation](https://herdr.dev/docs/agents).

### Exact writes and mutations

| Target | Files and settings written | Status authority |
|---|---|---|
| `claude` | Writes `~/.claude/hooks/herdr-agent-state.sh`, or `$CLAUDE_CONFIG_DIR/hooks/...`; adds a Herdr `SessionStart` command with a ten-second timeout to `settings.json`. Removes obsolete Herdr-owned entries while preserving unrelated hooks. | **Session identity only.** Status remains screen-derived. |
| `codex` | Writes `~/.codex/herdr-agent-state.sh`, or `$CODEX_HOME/...`; creates/updates `hooks.json` with Herdr `SessionStart`; removes legacy Herdr lifecycle actions; ensures `[features] hooks = true` and removes deprecated top-level `codex_hooks` from `config.toml`. Uninstall leaves hooks enabled. | **Session identity only.** |
| `pi` | Writes `~/.pi/agent/extensions/herdr-agent-state.ts`, or `$PI_CODING_AGENT_DIR/extensions/...`. | **Lifecycle and session authority.** |
| `omp` | Writes `~/.omp/agent/extensions/herdr-omp-agent-state.ts`. Resolution uses `$PI_CODING_AGENT_DIR`, otherwise `$HOME/$PI_CONFIG_DIR/agent`, otherwise `~/.omp/agent`. It refuses collision with Pi’s directory and removes a legacy Pi-named Herdr extension in the OMP directory. | **Lifecycle and session authority**, labeled `omp`. |
| `kimi` | Writes `~/.kimi-code/hooks/herdr-agent-state.sh`, or `$KIMI_CODE_HOME/hooks/...`; appends a Herdr-managed `[[hooks]]` block to `config.toml`. Events cover session start, prompts, tools, subagents, compaction, permissions, stop, and interrupt. Requires Kimi ≥0.14.0. | **Lifecycle and session authority.** |
| `opencode` | Writes `~/.config/opencode/plugins/herdr-agent-state.js`, `~/.config/opencode/herdr-tui-session.js`, and `~/.config/opencode/herdr-opencode/tui.js`; registers V1 in `tui.jsonc` and V2 in `cli.json`. V1 registration can be deferred until OpenCode2 performs its preference migration. | **Lifecycle and session authority in TUI mode.** V2 mini/headless has no TUI reporter. |
| `hermes` | Writes `~/.hermes/plugins/herdr-agent-state/plugin.yaml` and `__init__.py`, or under `$HERMES_HOME`; enables `herdr-agent-state` in `config.yaml`. | **Session identity only.** |

Installed integration revisions shipped with 0.9.1 are Pi 9, OMP 10, Claude 10, Codex 8, Kimi 7, OpenCode 12, and Hermes 5. Evidence: `herdr integration install --help`, `herdr integration status`, and [Herdr integrations](https://herdr.dev/docs/integrations).

### Native restore mechanics

An integration reports a durable session ID or path through launch flags, `pane report-agent-session`, or `pane.report_agent_session`. Herdr persists it with session state.

After a server restart, Herdr reconstructs workspaces, tabs, panes, cwd, layout, and focus. Once a client supplies terminal size/theme, it relaunches eligible agents with the target’s native resume mechanism. Invalid, stale, duplicate, unsupported, or missing references fall back to a shell. Detaching does not trigger this because the server and PTYs remain alive. [Herdr session-state documentation](https://herdr.dev/docs/session-state).

Native restore defaults on unless:

```toml
[session]
resume_agents_on_restore = false
```

That default conflicts with Overdeck. `pan pause` persists `paused: true`, and Overdeck’s resume policy blocks paused, troubled, or operator-stopped agents. ([agent-state.ts:248–260](/home/eltmon/Projects/overdeck/src/lib/agents/agent-state.ts:248), [agent-state.ts:612–685](/home/eltmon/Projects/overdeck/src/lib/agents/agent-state.ts:612), [PIPELINE-GATES.md:88–115](/home/eltmon/Projects/overdeck/docs/PIPELINE-GATES.md:88))

A Herdr restart followed by client attachment could relaunch an eligible pane without consulting those gates. Therefore every Overdeck-managed Herdr session should set `resume_agents_on_restore = false` until restore is mediated by Overdeck.

### What becomes deterministic

- Pi/OMP/Kimi/OpenCode can materially improve `agent_status`.
- `agent.get` becomes useful for pane-bound agents once their integration creates or associates a lifecycle record.
- `agent.wait` becomes trustworthy only for lifecycle-authority integrations.
- All seven can provide deterministic native session identity, but Overdeck presently drops `agent_session`.
- Claude/Codex/Hermes integrations do not make status deterministic.

Critically, `herdr integration install codex` does **not** fix Codex beneath `node dist/codex-app-server-host.js`. The integration is session-only, while Overdeck intentionally marks the host-backed pane non-detectable. ([launch.ts:38–55](/home/eltmon/Projects/overdeck/src/lib/terminal-backends/launch.ts:38))

The app-server host itself should report `pane.report_agent` lifecycle transitions and `pane.report_agent_session`, because it already knows thread, turn, permission, and completion state. Delivery should remain on authenticated app-server RPC.

### Claude hook conflict

Current `~/.claude/settings.json` hook keys are:

```text
Stop, SessionEnd, PreToolUse, PostToolUse, PostToolUseFailure, SessionStart,
Notification, UserPromptSubmit, PreCompact, PostCompact, PermissionRequest,
StopFailure, SubagentStart, SubagentStop, TeammateIdle
```

Evidence:

```sh
python3 -c "import json;print(list(json.load(open('/home/eltmon/.claude/settings.json'))['hooks']))"
```

The Herdr integration would append to the already-populated `SessionStart` array. Its installer is surgical, so this is not inherently a semantic collision. It is a configuration-ownership collision: `pan sync` and Herdr install/update/uninstall both edit the same global file, and both SessionStart paths execute.

Doctor should verify only the Herdr-owned entry. Sync must merge rather than replace. The benefit is currently marginal because Claude status already works and Overdeck ignores the reported session reference.

### Installation recommendation

| Integration | Recommendation |
|---|---|
| Pi/OMP | **Pilot; material.** Direct lifecycle reporting can pierce wrappers. Verify pane environment inheritance and agent-ID association first. |
| Kimi | **Pilot; material.** Can replace fragile Kimi prompt/status scraping and provide permission/blocked transitions. |
| OpenCode | **Pilot for real TUI mode.** Hosted ACP delivery remains authoritative; mini/headless lacks the reporter. |
| Claude | **Defer; marginal today.** Session-only, existing status already works, and restore/config ownership introduces risk. |
| Codex | **Do not install for status.** Add app-server host reporting instead. |
| Hermes | **Defer; marginal today.** Session-only with no adapter consumer. |

## 3. Installation and operational ownership

### Official binary installation

From [Herdr installation documentation](https://herdr.dev/docs/install):

- Linux/macOS:

  ```sh
  curl -fsSL https://herdr.dev/install.sh | sh
  ```

- Windows PowerShell:

  ```powershell
  powershell -ExecutionPolicy Bypass -c "irm https://herdr.dev/install.ps1 | iex"
  ```

- Package options include `brew install herdr`, `mise use -g herdr`, and a versioned Nix flake.
- Manual assets cover Linux x86_64/aarch64, macOS Intel/Apple Silicon, and Windows x86_64.
- Windows ConPTY runtime files must remain beside the executable.

This host has `/home/eltmon/.local/bin/herdr`, reporting `herdr 0.9.1`.

### Start and verify a named server

Run under a user service/process supervisor:

```sh
/home/eltmon/.local/bin/herdr --session overdeck server
```

Verify separately:

```sh
/home/eltmon/.local/bin/herdr --session overdeck status server
/home/eltmon/.local/bin/herdr --session overdeck api snapshot
```

Expected default socket:

```text
~/.config/herdr/sessions/overdeck/herdr.sock
```

A non-default `OVERDECK_HOME` needs its own service using `overdeck-<sha1(home)[0:8]>`. ([TERMINAL-BACKENDS.md:50–71](/home/eltmon/Projects/overdeck/docs/TERMINAL-BACKENDS.md:50))

The research sandbox denied the live socket query with `PermissionDenied`; the command form and a recorded 0.9.1/protocol-22 probe are documented in [TERMINAL-BACKENDS.md:255](/home/eltmon/Projects/overdeck/docs/TERMINAL-BACKENDS.md:255).

There is no top-level `herdr wait` command in 0.9.1: `herdr wait --help` prints root help. The actual commands are:

```sh
herdr agent wait
herdr pane wait-output
```

### Channels and updates

The direct installer defaults to the stable channel. `herdr channel set preview|stable` changes direct-installer behavior; Homebrew, mise, and Nix remain package-manager controlled.

A normal `herdr update` replaces the client while a compatible endpoint-generation-1 server may keep running. New server features therefore require a later restart.

`herdr update --handoff` performs experimental, best-effort live replacement intended to preserve PTYs. Even a successful handoff interrupts in-flight API calls, waits, subscriptions, client sockets, and messages. Overdeck should drain mutations, close/reconnect subscriptions, hand off, recheck ping/schema, and then resume traffic.

### Make Herdr an absolute dependency

Today:

- Missing binary selects tmux.
- Missing named socket selects tmux.
- Selection exceptions return tmux.
- Delivery selection exceptions independently return tmux.

Evidence: [select.ts:123–188](/home/eltmon/Projects/overdeck/src/lib/terminal-backends/select.ts:123) and [delivery.ts:70–83](/home/eltmon/Projects/overdeck/src/lib/agents/delivery.ts:70).

This search returned no matches:

```sh
rg -n -i herdr \
  src/cli/commands/install.ts \
  src/cli/commands/sync.ts \
  src/cli/commands/doctor.ts
```

Recommended responsibilities:

1. `pan install`

   Install a pinned supported Herdr build through the official platform path; create an Overdeck-owned config with native restore disabled; install one supervised service per Overdeck home; start it; verify version, protocol, endpoint generation, named socket, and API snapshot. Do not install every agent integration by default.

2. `pan sync`

   Idempotently synchronize the service definition, config, and explicitly selected integrations while preserving user settings. Ensure the exact named server is running and fail on incompatible API/schema.

3. `pan doctor`

   Report binary path/version, install channel, config path, computed session/socket, service state, ping/API protocol, capabilities, snapshot result, integration revisions/status, and `resume_agents_on_restore`. Missing binary/socket or incompatible API must be an error.

4. Backend selection

   Default Herdr should be strict. Keep tmux only behind explicit `terminal.backend = "tmux"` or `OVERDECK_TERMINAL_BACKEND=tmux`. A Herdr outage should mean “backend unavailable,” not “consult a different terminal universe.”

## 4. Gaps and risks

1. **PAN-3952: unviewed panes can launch with a one-row viewport, making `pane read` empty.**  
   Fix: allocate a sane PTY size during launch, or perform one controlled resize before readiness/output reads. Current `pane.split` supplies no dimensions. ([herdr.ts:546–552](/home/eltmon/Projects/overdeck/src/lib/terminal-backends/herdr.ts:546))

2. **Missing binary/socket/config silently changes the backend to tmux.**  
   Fix: make default Herdr strict and retain tmux only as explicit opt-in.

3. **A Herdr inventory read failure silently returns tmux inventory.**  
   Stale pre-cut tmux panes can therefore appear authoritative.  
   Fix: return indeterminate or last-known Herdr state and surface backend health. ([backend-inventory.ts:182–203](/home/eltmon/Projects/overdeck/src/dashboard/server/services/backend-inventory.ts:182))

4. **The Herdr event stream never reconnects.**  
   When iteration ends, `eventStreamClose` remains non-null, so later starts return immediately.  
   Fix: clear it in `finally`, back off, resnapshot, and resubscribe. ([backend-inventory.ts:367–391](/home/eltmon/Projects/overdeck/src/dashboard/server/services/backend-inventory.ts:367))

5. **All non-Claude harnesses normally remain pane-bound and `unknown`.**  
   Fix: add verified lifecycle integrations for Pi/OMP/Kimi/OpenCode and host-side reports for Codex/ACP.

6. **Official Codex integration does not fix app-server-host detection.**  
   Fix: report lifecycle and session identity from the Node host itself.

7. **The adapter discards `agent_session`.**  
   Fix: expose session references in adapter/domain snapshots and reconcile reset/restore semantics before enabling native restore.

8. **Native restore can violate paused, troubled, operator-stop, memory, and boot no-resume gates.**  
   Fix: set `resume_agents_on_restore = false`; later implement an Overdeck-authorized restore coordinator.

9. **`agent.wait` is dead API surface.**  
   Fix: route integrated-harness readiness and settling through `TerminalBackend.wait`; retain RPC readiness for Codex/ACP.

10. **Kimi and Codex TUI readiness still invoke tmux `sessionExists` and `capturePane`.**  
    Fix: use backend-aware `agent.wait` or `pane wait-output`. ([runtime-command.ts:298–355](/home/eltmon/Projects/overdeck/src/lib/agents/runtime-command.ts:298))

11. **Delivery guarantees differ across Herdr, app-server, ACP, supervisor, channels, and tmux.**  
    Fix: define an explicit capability matrix and never let a missing Herdr target fall through to an identically named stale tmux session.

12. **Prompt dedupe is in-memory/per-process, and only worker targets are authority-gated.**  
    Fix: move message-ID admission to the durable delivery component and define policy for review/test/UAT/work roles.

13. **Synchronous liveness remains tmux-only.**  
    Fix: eliminate `isAliveSync` callers or serve a cached Herdr snapshot through an async boundary. ([TERMINAL-BACKENDS.md:240–243](/home/eltmon/Projects/overdeck/docs/TERMINAL-BACKENDS.md:240))

14. **Existing Herdr workspace reuse does not verify its cwd against Overdeck’s current workspace path.**  
    Fix: compare the stored cwd and migrate or refuse mismatches. ([herdr.ts:518–524](/home/eltmon/Projects/overdeck/src/lib/terminal-backends/herdr.ts:518))

15. **Enabling Herdr worktrees would create dual ownership.**  
    Fix: keep Overdeck authoritative or perform a full migration consuming Herdr worktree events.

16. **Herdr notifications cannot replace durable `needs-you`.**  
    Fix: retain structured Overdeck pending-input state; optionally mirror new requests as Herdr toasts.

17. **Herdr machines do not replace Fly remote agents.**  
    Fix: treat them only as optional terminal federation after Fly provisioning.

18. **Install, sync, and doctor have no Herdr ownership despite Herdr being the default.**  
    Fix: add hard prerequisite, service, configuration, and schema checks and refuse startup when the required backend is absent.

## Command record

Read-only commands run included:

```text
herdr --version
herdr --help
herdr agent --help
herdr agent wait --help
herdr pane --help
herdr pane wait-output --help
herdr integration --help
herdr integration install --help
herdr integration status
herdr api --help
herdr wait --help
herdr worktree --help
herdr machine --help
herdr notification --help
herdr session --help
herdr --session overdeck status server
python3 -c "import json;print(list(json.load(open('/home/eltmon/.claude/settings.json'))['hooks']))"
rg -n -i herdr src/cli/commands/install.ts src/cli/commands/sync.ts src/cli/commands/doctor.ts
```

No integration was installed and no server, session, pane, terminal, worktree, or machine was mutated.

Codex session ID: 01a0be19-d5fa-75e2-a56d-4032a3a3c19f
Resume in Codex: codex resume 01a0be19-d5fa-75e2-a56d-4032a3a3c19f
