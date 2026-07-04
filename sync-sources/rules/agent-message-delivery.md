---
scope: universal
---
### Message running agents with `pan tell` — never raw tmux keystroke injection

To send a message to a running agent, conversation, or the flywheel, use
`pan tell <agent-or-session> "<message>"`. It routes through the delivery door
(`deliverAgentMessage`: PTY supervisor → channels → tmux fallback), echoes into
the transcript, and works regardless of harness. If it reports the target is
not running, verify with `tmux -L overdeck list-sessions` and check your
`OVERDECK_HOME` (a polluted shell env is the usual cause — prefix
`OVERDECK_HOME=~/.overdeck` if in doubt).

Do NOT drive another session's terminal directly with `tmux paste-buffer` or
`tmux send-keys` — keystroke injection is deny-listed in permission settings
and will be refused. That deny-list is intentional; `pan tell` is the
sanctioned path. (The `load-buffer`/`paste-buffer` pattern remains correct
*inside Overdeck source code* implementing the delivery fallback — see the dev
async-tmux rule.)
