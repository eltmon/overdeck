# Claude Code Channels — Manual Smoke Test (PAN-985)

End-to-end verification of the legacy Channels MCP prompt-delivery fallback.
New work agents use the PTY supervisor by default; this path is retained as an
explicit YAML-only diagnostic override. Run on a real workstation against a
real `claude` binary with claude.ai or Console-API auth. CI cannot exercise
this path because it requires an interactive Claude session; the in-process
unit tests in `__tests__/overdeck-bridge.test.ts` and
`../__tests__/deliver-agent-message.test.ts` are the automated layer.

## Prerequisites

- `claude` on PATH and authenticated against an Anthropic provider
  (`claude --version` returns cleanly; `claude /login` already done).
- `bun` on PATH (the bridge runs under Bun; see CLAUDE.md → Project Structure).
- Overdeck dashboard running locally (`pan up`).
- A work-eligible issue with a workspace already created (e.g. `pan plan`
  followed by `pan start`). Native workspace, not Docker.

## Procedure

1. **Enable the legacy MCP override in YAML.**
   - Edit `~/.overdeck/config.yaml` and set:
     ```yaml
     experimental:
       claudeCodeChannelsMcp: true
     ```
   - The dashboard Settings toggle for `claudeCodeChannels` controls
     conversation delivery only; it does not wire MCP for new work agents.

2. **Start a work agent.**
   - From the dashboard or `pan start <ISSUE>`.
   - The launch path writes:
     - `<workspace>/.pan/agent-mcp.json` pointing at
       `src/lib/channels/overdeck-bridge.ts`.
     - `state.channelsEnabled = true` in
       `${OVERDECK_HOME}/agents/<agent-id>/state.json`.
   - Watch the agent's stdout/log for the eligibility line:
     ```
     [agent-pan-XXX] channels:eligible
     ```
     If you see `channels:ineligible:<reason>` instead, the path will
     silently fall back to tmux for this agent (intended behaviour for
     non-Anthropic, Docker, or specialist agents — verify the reason
     matches your configuration).

3. **Observe the dev-channels dialog auto-dismiss.**
   - `tmux -L overdeck attach -t agent-pan-XXX`.
   - Within 8–15 seconds of cold start, the TUI dialog
     `WARNING: Loading development channels` appears and is dismissed
     within ~500ms by a single Enter keystroke. If the dialog visibly
     lingers, dismissal is broken (see Failure modes below).
   - Detach with `Ctrl-B d`.

4. **Tail the bridge log.**
   - `tail -f ${OVERDECK_HOME:-~/.overdeck}/logs/bridge-agent-pan-XXX.log`.
   - `deliverAgentMessage` writes the routing decision to this file. On a
     healthy new agent the default decision is now `path: 'supervisor'`, because
     the PTY supervisor is tried before Channels.
   - A `path: 'channel'` line verifies the legacy MCP fallback only when the
     supervisor tier is unavailable or when a caller explicitly forces Channels.
     The bridge then writes a companion JSON line such as:
     ```
     {"ts":"2026-05-07T...","agentId":"agent-pan-XXX","contentLength":1234,"metaKeys":[]}
     ```

5. **Force a second delivery via `pan tell`.**
   - Run `pan tell PAN-XXX "echo smoke-test"`.
   - With the supervisor healthy, the decision line should be
     `path: 'supervisor'`. To test the Channels fallback itself, stop or remove
     the PTY supervisor socket for this disposable smoke-test agent, then send a
     second `pan tell` and expect `path: 'channel'` plus the bridge companion
     line.

## Expected log signatures

Default supervisor push:
```
{"ts":"2026-...","agentId":"agent-pan-XXX","path":"supervisor","caller":"messageAgent:pan-tell"}
```

Legacy channel fallback push:
```
{"ts":"2026-...","agentId":"agent-pan-XXX","path":"channel","caller":"messageAgent:pan-tell"}
{"ts":"2026-...","agentId":"agent-pan-XXX","contentLength":17,"metaKeys":["caller"]}
```

Fallback to tmux (both sockets unavailable):
```
{"ts":"2026-...","agentId":"agent-pan-XXX","path":"tmux","reason":"socket-post-failed: ...","caller":"messageAgent:pan-tell"}
```

## Failure modes & where to look

- **Dialog never dismissed:** check the launcher script in
  `~/.overdeck/agents/<id>/launcher.sh` — it must include
  `--dangerously-load-development-channels server:overdeck-bridge`.
  If absent, the eligibility decision returned `false`; revisit step 2.
- **Socket missing:** `ls ${OVERDECK_HOME}/sockets/agent-<id>.sock`. If
  no file: the bridge subprocess never bound. Check
  `~/.overdeck/agents/<id>/state.json`'s `channelsEnabled` and the
  pane output for `overdeck-bridge:` errors.
- **Every push falls back:** the channel listener may not have registered
  before delivery started. The dismissal step has a 20s budget; if claude
  cold-starts slower than that on this host, increase the timeout in
  `dismissDevChannelsDialog` or wait an extra few seconds before the
  first `pan tell`.

## Reverting

1. Remove `experimental.claudeCodeChannelsMcp` or set it to `false` in
   `~/.overdeck/config.yaml`.
2. Stop and restart any running work agents (`pan kill <id>` then
   `pan start <id>`). Existing agent state files retain
   `channelsEnabled = true` from the previous launch; the next spawn
   recomputes eligibility against the now-off flag and writes a fresh
   state record without the flag.
