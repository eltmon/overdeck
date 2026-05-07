# Claude Code Channels — Manual Smoke Test (PAN-985)

End-to-end verification of the experimental Channels prompt-delivery path.
Run on a real workstation against a real `claude` binary with claude.ai or
Console-API auth. CI cannot exercise this path because it requires an
interactive Claude session; the in-process unit tests in
`__tests__/panopticon-bridge.test.ts` and
`../__tests__/deliver-agent-message.test.ts` are the automated layer.

## Prerequisites

- `claude` on PATH and authenticated against an Anthropic provider
  (`claude --version` returns cleanly; `claude /login` already done).
- `bun` on PATH (the bridge runs under Bun; see CLAUDE.md → Project Structure).
- Panopticon dashboard running locally (`pan up`).
- A work-eligible issue with a workspace already created (e.g. `pan plan`
  followed by `pan start`). Native workspace, not Docker.

## Procedure

1. **Toggle the experimental flag on.**
   - Open the dashboard Settings page.
   - Scroll to the bottom; the **Experimental** section is the last on the page.
   - Flip **Use Claude Code Channels for prompt delivery (work agents only)** on.
   - Confirm the toggle persists: refresh the page and verify it stays on.
   - Behind the scenes this writes
     `experimental: { claudeCodeChannels: true }` to
     `~/.panopticon/config.yaml`.

2. **Start a work agent.**
   - From the dashboard or `pan start <ISSUE>`.
   - The launch path writes:
     - `<workspace>/.pan/agent-mcp.json` pointing at
       `src/lib/channels/panopticon-bridge.ts`.
     - `state.channelsEnabled = true` in
       `${PANOPTICON_HOME}/agents/<agent-id>/state.json`.
   - Watch the agent's stdout/log for the eligibility line:
     ```
     [agent-pan-XXX] channels:eligible
     ```
     If you see `channels:ineligible:<reason>` instead, the path will
     silently fall back to tmux for this agent (intended behaviour for
     non-Anthropic, Docker, or specialist agents — verify the reason
     matches your configuration).

3. **Observe the dev-channels dialog auto-dismiss.**
   - `tmux -L panopticon attach -t agent-pan-XXX`.
   - Within 8–15 seconds of cold start, the TUI dialog
     `WARNING: Loading development channels` appears and is dismissed
     within ~500ms by a single Enter keystroke. If the dialog visibly
     lingers, dismissal is broken (see Failure modes below).
   - Detach with `Ctrl-B d`.

4. **Tail the bridge log.**
   - `tail -f ${PANOPTICON_HOME:-~/.panopticon}/logs/bridge-agent-pan-XXX.log`.
   - For each delivered prompt you should see one JSON line per delivery,
     e.g.:
     ```
     {"ts":"2026-05-07T...","agentId":"agent-pan-XXX","contentLength":1234,"metaKeys":[]}
     ```
     This is written by the bridge itself when it forwards a push as a
     channel notification.
   - The companion line written by `deliverAgentMessage` records the
     decision (`path: 'channel'` for the success case,
     `path: 'tmux', reason: 'socket-...'` for fallback). Both go to the
     same `bridge-<id>.log` file.

5. **Force a second delivery via `pan tell`.**
   - Run `pan tell PAN-XXX "echo smoke-test"`.
   - The bridge log gains another entry, this time with
     `caller: 'messageAgent:pan-tell'`. The agent's tmux pane should
     show no typed text (the message went through the channel, not via
     paste-buffer).

## Expected log signatures

Successful channel push:
```
{"ts":"2026-...","agentId":"agent-pan-XXX","path":"channel","caller":"messageAgent:pan-tell"}
{"ts":"2026-...","agentId":"agent-pan-XXX","contentLength":17,"metaKeys":["caller"]}
```

Fallback to tmux (transient bridge crash):
```
{"ts":"2026-...","agentId":"agent-pan-XXX","path":"tmux","reason":"socket-post-failed: ...","caller":"messageAgent:pan-tell"}
```

## Failure modes & where to look

- **Dialog never dismissed:** check the launcher script in
  `~/.panopticon/agents/<id>/launcher.sh` — it must include
  `--dangerously-load-development-channels server:panopticon-bridge`.
  If absent, the eligibility decision returned `false`; revisit step 2.
- **Socket missing:** `ls ${PANOPTICON_HOME}/sockets/agent-<id>.sock`. If
  no file: the bridge subprocess never bound. Check
  `~/.panopticon/agents/<id>/state.json`'s `channelsEnabled` and the
  pane output for `panopticon-bridge:` errors.
- **Every push falls back:** the channel listener may not have registered
  before delivery started. The dismissal step has a 20s budget; if claude
  cold-starts slower than that on this host, increase the timeout in
  `dismissDevChannelsDialog` or wait an extra few seconds before the
  first `pan tell`.

## Reverting

1. Toggle the experimental flag **off** in dashboard Settings.
2. Stop and restart any running work agents (`pan kill <id>` then
   `pan start <id>`). Existing agent state files retain
   `channelsEnabled = true` from the previous launch; the next spawn
   recomputes eligibility against the now-off flag and writes a fresh
   state record without the flag.
