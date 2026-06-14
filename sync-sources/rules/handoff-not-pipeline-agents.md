---
scope: dev
---
### Use `pan handoff` for ad-hoc supervised conversation agents

When the operator asks from inside a conversation to "spawn agents" for ad-hoc
supervised work, use `pan handoff`. These are interactive, human-supervised
conversations, not managed pipeline agents.

This does not override the pipeline rule: managed work, plan, review, test, and
ship agents run through `pan start`, `pan swarm`, or `pan plan`. Tell handoff
agents not to run `pan done`; using a worktree `--cwd` is fine when the operator
asked for supervised handoff work.
