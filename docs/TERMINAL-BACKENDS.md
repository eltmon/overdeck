# Terminal backends

The terminal backend owns agent terminals: it creates the issue workspace, starts agents in panes,
delivers prompts, waits on agent state, streams terminal output, and reports the live inventory.
Nothing about a running agent is stored — the backend is read live and matched to issues by
workspace and pane metadata (PAN-3917, FR-3 to FR-5, FR-17, D10).

Two adapters implement one contract:

| | Herdr (default) | tmux |
| --- | --- | --- |
| Module | `src/lib/terminal-backends/herdr.ts` | `src/lib/terminal-backends/tmux.ts` |
| Transport | NDJSON over `~/.config/herdr/sessions/overdeck/herdr.sock` | `tmux -L overdeck` |
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

## Selection (D10)

`selectTerminalBackend(config)` in `select.ts`: an explicit `terminal.backend` in `config.yaml`
wins; otherwise Herdr when the `herdr` binary is on `PATH` **and** the `overdeck` session socket
exists; otherwise tmux, with a diagnostic naming the reason. No subprocess — `fs.access` only, so
it is safe on every spawn. Adapters register themselves at import time; `registry.ts` resolves a
name to an adapter and throws with the missing import when nothing registered it.

`src/lib/terminal-backends/launch.ts` is the one launch path: it resolves the backend, finds or
creates the issue workspace, starts the pane, and stamps the tokens. Every launcher goes through
it, so none of them can forget a token.

## Pane metadata (FR-5)

Every launcher stamps four tokens on its pane: `issue`, `role`, `harness`, `model`. `role` is one of
`work`, `worker`, `review`, `test`, `uat`, `strike`, `plan`. An operator conversation carries **no**
`issue` token — that absence is also how the prompt guard recognizes an operator sender.
Overdeck's own `ship` role maps to the `uat` token role (`toPaneRole`).

Launch sites, all routed: `spawnAgent` and `spawnRun` in `src/lib/agents/spawn.ts` (work agents,
`pan start`, `pan strike`, the review/test/ship/plan specialists, and `pan review spawn-reviewer`
through `spawnRun`).

## The prompt guard (FR-17)

`src/lib/terminal-backends/prompt-guard.ts`, run by **both** adapters inside `prompt`, and by
`deliverAgentMessage` before the tmux delivery cascade:

1. **Idempotence.** Every prompt carries a message id. A repeat of the same id for the same target
   within the window (10 minutes, a 64-entry ring per target) returns `{ dropped: true, reason }`.
   The ring is in memory and per process: it de-duplicates inside the long-lived dashboard server,
   which is where the repeated deliveries came from. A retry of a *failed* delivery must use a new
   id — the guard records an id when it admits it.
2. **Authority.** A pane whose tokens say issue X and role `worker` accepts prompts only from the
   pane whose tokens say issue X and role `work`, or from an operator conversation (a `conv-` id
   with no `issue` token). Anything else gets `{ refused: true, reason }`. Other roles keep today's
   open delivery.

Sender identity: the Herdr adapter reads the target's tokens from `agent.get`; on tmux the sender is
`OVERDECK_AGENT_ID` and the target's tokens come from the agent's launch metadata
(`getAgentStateSync`), because a tmux pane carries no tokens.

`deliverAgentMessage` returns the drop or refusal in `DeliveryResult.failure` (`refused: …` /
`dropped: …`); a refusal is `ok: false`, so `pan tell` exits non-zero.

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

## Live verification record (AC-8)

Host: herdr 0.9.1, server protocol 22, socket `~/.config/herdr/sessions/overdeck/herdr.sock`.
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
