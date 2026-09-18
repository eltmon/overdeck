---
scope: universal
---
### Message Overdeck-managed agents with `pan tell`, not raw tmux keystrokes

To send a message to a running **Overdeck-managed** agent, use `pan tell <agent-or-session> "<message>"`, never raw `tmux send-keys`. It goes through the terminal backend's `prompt()` operation, which is role- and id-checked: a `worker` pane accepts a message only from its issue's `work` pane or an operator, and a repeated message id cannot land twice.
