---
scope: universal
---
### Message Overdeck-managed agents with `pan tell`, not raw tmux keystrokes

To send a message to a running **Overdeck-managed** agent, conversation, or
the flywheel, use `pan tell <agent-or-session> "<message>"`. It routes through
the delivery door (`deliverAgentMessage`: PTY supervisor → channels → tmux
fallback), echoes into the transcript, and works regardless of harness. If it
reports the target is not running, verify with `tmux -L overdeck list-sessions`
and check your `OVERDECK_HOME` (a polluted shell env is the usual cause —
prefix `OVERDECK_HOME=~/.overdeck` if in doubt).

Do not drive another **Overdeck-managed** session with raw `tmux send-keys` /
`tmux paste-buffer` when `pan tell` can reach it — raw keystrokes bypass the
transcript echo and the PTY supervisor, so the message leaves no trace and can
interleave with the harness's own input handling. Scope of the mechanical
enforcement (PAN-1084): pipeline **work agents** are hook-blocked from
injecting keystrokes into any session other than their own (this exists to
stop self-approval of another agent's permission prompts). Conversations and
human-directed sessions are NOT blocked.

Driving a session that Overdeck does not manage (e.g. the operator's own tmux
session on the default socket, at their direction) with `send-keys` /
`paste-buffer` is legitimate — use the async `load-buffer` + `paste-buffer` +
delayed Enter pattern from the async-tmux rule so the text lands reliably.
