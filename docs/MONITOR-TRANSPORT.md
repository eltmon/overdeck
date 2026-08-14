# Monitor Transport (PAN-3015)

Pull-based message delivery for Claude Code sessions. Instead of typing a
message into the agent's TUI composer (PTY supervisor paste or tmux
`paste-buffer`), the sender writes a durable mail file and a `pan monitor`
background task running *inside* the agent's session prints it to stdout.
Claude Code surfaces background-command output to the model at the next turn
boundary — and wakes an idle session — so the message reaches the model with
no keystrokes at all.

The pattern is borrowed from Traycer's open-source `traycer monitor`
(github.com/traycerai/traycer, `clients/traycer-cli/src/commands/monitor.ts`),
adapted to Overdeck's existing durable mail queue.

## Why

Every keystroke-injection failure class disappears when no keystrokes exist:

- echo-confirmation + purge/backspace retries and the duplicate-writer race (PAN-1769)
- `send-keys` into a dead pane returning false success (PAN-2228 / PAN-2179)
- strict-supervisor echo failures stranding review feedback (PAN-1988)
- Enter-timing / settle-wait lag, paste placeholder matching, large-paste garbling (PAN-1803)

It also finally gives the mail queue a consumer — PAN-2668's complaint was
feedback stranded "in a queue nothing drains."

## Pieces

| Piece | Where | Job |
| --- | --- | --- |
| `pan monitor [id]` | `src/cli/commands/monitor.ts` | Long-running background task in the agent session. Drains mail to stdout blocks, maintains presence. stdout = messages only; diagnostics = stderr. |
| `pan inbox [id] [--limit n]` | `src/cli/commands/inbox.ts` | Unary full-body re-read (monitor blocks truncate at 4000 chars). Moves nothing. |
| Shared library | `src/lib/agents/monitor-transport.ts` | Presence protocol, mail-file format, drain/claim logic, block rendering. |
| Monitor tier | `src/lib/agents/messaging.ts` (`messageAgent`) | For `claude-code` targets with a live monitor: write mail, done. Stale presence falls through to the normal cascade. |
| Role instruction | `roles/work.md`, `roles/strike.md` | Tells Claude agents to start `pan monitor` in the background at session start. |

## Presence protocol

The monitor writes `~/.overdeck/agents/<id>/monitor.json`
(`{pid, startedAt, heartbeatAt}`), refreshing the heartbeat every 15s and
removing the file on SIGINT/SIGTERM. A sender treats the monitor as live only
when the heartbeat is under 45s old (3 missed beats) AND the pid is alive.
A dead monitor never strands a message: the mail file is durable either way,
gets drained on the next monitor start, and stale presence just means the
sender uses the keystroke cascade as before.

## Mail flow

1. `messageAgent` (mid-session tells: `pan tell`, dashboard, Cloister feedback)
   sees a live monitor and writes `mail/<ts>.md` with a provenance header:
   `# Message` / `source: <caller>` / `date: <iso>` / body. Legacy headerless
   files still parse.
2. The monitor claims each plain `.md` file by renaming it into `mail/read/`
   (claim-by-rename makes concurrent drainers safe), then prints:

   ```
   [overdeck:agent-message] source: pan-tell at: 2026-07-24T…
   <body, truncated at 4000 chars with a pan-inbox pointer>
   [overdeck:agent-message] end
   ```

3. `pan inbox` re-reads full bodies from `mail/` + `mail/read/`.

`.pending.md` files remain codex notify-hook territory and `mail-*.json`
remains the FPP mailbox; the monitor never touches either. `.delivered.md`
files are post-delivery backups of messages another transport already landed
(PAN-3738); the suffix only tells a human reading `mail/` that the file is a
receipt rather than a queue entry, and the monitor drains them like any other
plain `.md`.

## Boundaries

- **Mid-session only.** Kickoff and resume delivery keep the injection paths
  (`deliverAgentMessage` / `deliverInitialPromptWithRetry`) — no monitor
  exists before the session's first turn. The tier lives in `messageAgent`,
  deliberately not in `deliverAgentMessage`.
- **Claude Code only.** Codex (app-server), ACP, and Pi (RPC FIFO) already
  have structured transports and are untouched.
- **Fallback preserved.** Every keystroke transport remains in place for
  sessions without a running monitor (specialists, conversations, pre-monitor
  turns, crashed monitors).
