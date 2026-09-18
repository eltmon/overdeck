# Agent Message Delivery (PTY supervisor + legacy Channels)

> Moved from CLAUDE.md (2026-08-07); the authoritative description of orchestrator-to-agent message delivery.


Claude Code work agents and Claude Code conversation sessions use the PTY
supervisor as the preferred orchestrator-to-agent delivery path. The launcher
wraps Claude as `node <projectRoot>/dist/pty-supervisor.js claude ...`, exports
`OVERDECK_AGENT_ID`, and writes a per-agent `pty-token` under
`${OVERDECK_HOME}/agents/<id>/pty-token` before the tmux session starts.

The supervisor is Node 22-only because it owns a real PTY through
`@lydell/node-pty`; do not run it under Bun. It binds
`${OVERDECK_HOME}/sockets/pty-<id>.sock` at mode `0600`, accepts authenticated
HTTP-on-unix POSTs, writes each delivered message into Claude's PTY input, and
echoes the message into the tmux transcript so operators can see what was sent.
`src/lib/channels/injection-budget.ts` is the single timing source for the
supervisor's payload-sized echo, settle, and purge waits and for the delivery
client deadline that must outlast them. The supervisor accepts at most 262,144
characters, returns HTTP 400 above that limit, and can therefore purge every
character it accepted before retrying without stacking duplicate composer text.

`deliverAgentMessage(agentId, message, caller?)` is the single delivery
primitive. In automatic mode it tries, in order (two earlier tiers — codex app-server
and ACP sockets — precede these but are no-ops for Claude Code agents):

1. PTY supervisor socket (`path: "supervisor"`)
2. legacy Claude Code Channels MCP socket for already-wired sessions
3. tmux paste-buffer fallback

## Supervisor lifecycle events (PAN-3849)

The supervisor is also the lifecycle reporter for its agent (W33, FR-21/FR-24).
Because it spawns the harness child and reaps its exit, it posts the events
only it can know to `POST /api/agents/:id/lifecycle` (authenticated with the
same `pty-token` as the delivery socket):

- `session-started` — right after the harness process spawns; the projection
  writes `running` and emits `agent.started` here, never from a pre-spawn
  placeholder row.
- `turn-started` — after each accepted injection; touches `lastActivity`.
- `turn-ended` — reserved in the route's event union.
- `exited` — after the child exits; the projection writes `stopped` through
  `applyAgentLifecycleEvent` (`src/dashboard/server/services/agent-projection.ts`)
  in one transaction with the agents-row upsert.

Posts retry three times with backoff and are logged on failure; an
unreachable dashboard never blocks the child, and `exited` is awaited (the
child is already dead) before the supervisor exits. The event is additive
with the delivery contract above: a confirmed turn is still reported by
`messageAgent` through transcript probing (PAN-3846), while these events
drive the agents-table status and activity columns.


## Delivery contract (PAN-3846)

`messageAgent` returns `delivered: true` for a running Claude Code agent only
when the agent's transcript shows the message as a new turn — the delivery is
probed against the session JSONL for up to 30 seconds across two attempts
(`deliverMessageWithTranscriptConfirmation` in `src/lib/agents/delivery.ts`,
the generalized resume primitive). When no turn appears, the outcome is
`delivered: false` with a `reason` (and `confirmed: false`); callers that need
escalation branch on `delivered` and surface a needs-you instead of reporting
success. Keyed deliveries keep the dedup door as their receipt and non-Claude
harnesses keep their composer-level contract; both report `confirmed: false`.
A confirmed delivery also clears the issue's `feedback_delivery_needs_you`
stuck flag through the review-status door.

The tmux fallback presses Enter after an unverified paste so text never sits
orphaned in the composer — except when the pane is blocked on a numbered choice
menu (session-resume gate, permission prompt, plan approval). That menu is why
the paste was swallowed, and Enter would confirm its highlighted row, so
`sendKeys` fails the delivery with `MessageDeliveryFailed` instead. Never answer
a menu Overdeck did not open: at the resume gate the highlighted row is "Resume
from summary", and a stray Enter there discarded an operator's full session
(PAN-3212). `paneHasBlockingChoiceMenu()` in `src/lib/pane-choice-menu.ts` is
the shared detector. The keyed dedup submit applies the same guard before its
server-owned `if-shell` Enter. Each pending claim has an explicit, strictly-read payload state:
`unverified` requires text in the cursor-anchored active composer (positive absence atomically
re-pastes), while `enter-attempted` preserves no-repaste rollback recovery. Unreadable, unset legacy,
or unknown states remain pending and fail closed rather than authorizing Enter.

Summary forks add a pane-verified recovery above that transport: when the
runtime transcript stays silent but the delivered tail remains in the composer,
the fork pipeline sends at most two standalone Enter keystrokes. If submission
still cannot be confirmed, it keeps the conversation alive but records
`forkStatus = 'failed'` with an actionable `forkError` instead of presenting an
empty transcript as a healthy completed fork.

## Home resolution and supervisor recovery

Local launcher scripts export the spawning process's resolved `OVERDECK_HOME`.
The PTY supervisor and in-session `pan` commands therefore do not depend on the
tmux server's global environment to find runtime files. The shared `overdeck`
socket sanitizer always pins canonical `HOME` and `OVERDECK_HOME` values and
refuses a caller's non-canonical home. Test and throwaway instances use
`OVERDECK_TMUX_SOCKET_NAME` or the automatically derived per-home socket, where
the caller's resolved home remains valid.

A missing supervisor socket does not make a live tmux session a failed spawn.
When the socket wait expires but the session still exists, Overdeck logs a
warning and continues. Later messages use the remaining Channels and tmux-paste
fallback tiers. If the tmux session is also gone, the timeout remains a real
spawn failure. A healthy harness statusline is never quoted as supervisor error
output.

The liveness repair clears `spawn_error` and a failed `fork_status`/`fork_error`
when it resurrects a conversation whose tmux session and harness are alive. An
operator can run `pan conversations heal <name>`, which calls
`POST /api/conversations/:name/clear-fork-state`, to perform the same repair.
The endpoint refuses to clear failures when the tmux session is dead because
that stored failure state is still accurate.

Docker workspaces remain excluded from supervisor wiring until host/container
socket sharing is designed; Pi keeps using its `rpc.in` FIFO. H1 lifecycle
semantics apply: the supervisor owns Claude's PTY master fd, so if the
supervisor process exits, Claude exits with it and the session must be resumed
through the normal dashboard/Deacon flow.

## Claude Code Channels (experimental legacy fallback)

Reference: https://code.claude.com/docs/en/channels

Claude Code Channels is now a legacy fallback — see the PTY supervisor section
above for the recommended transport. Channels remains only for already-running
agents with `state.channelsEnabled = true` and for explicit diagnostic opt-in
via `experimental.claudeCodeChannelsMcp: true`.

`src/lib/channels/overdeck-bridge.ts` is a per-agent Bun stdio MCP server.
When the diagnostic override is enabled, Claude is spawned with
`--mcp-config <workspace>/.pan/agent-mcp.json --dangerously-load-development-channels server:overdeck-bridge`,
the bridge listens on `${OVERDECK_HOME}/sockets/agent-<id>.sock`, and
`deliverAgentMessage` uses it only after the supervisor tier fails. The
`WARNING: Loading development channels` dialog is dismissed only when that MCP
config is actually wired; supervisor-only sessions must not receive this Enter
keystroke.
