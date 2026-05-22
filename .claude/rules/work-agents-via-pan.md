---
scope: universal
---
## Work Agents Run Through `pan` — Never the Claude Code `Agent` Tool

Spawn work agents only through the Panopticon CLI — `pan start <id>`,
`pan swarm <id>`, `pan plan <id>`. NEVER spawn a *work* agent via Claude
Code's `Agent`/subagent tool.

### Why

`pan`-spawned agents are registered with Panopticon: a
`~/.panopticon/agents/agent-<id>/state.json` carrying `issueId`, a tmux
session on the `panopticon` socket, and (for swarms) a swarm-runtime entry.
The dashboard's resource-discovery service nests them under their issue with
openable terminals, and the review/test/ship pipeline can manage them.

Agents spawned via the `Agent` tool run as ephemeral subagents inside the
caller's session — no state file, no `issueId`, no `panopticon`-socket
session. The dashboard cannot discover them; they cannot be paused, resumed,
reviewed, merged, or recovered through the pipeline.

### Scope

- **work** (implementation), **plan**, **review/test/ship** → always `pan`.
- Claude Code's built-in `Explore` / `general-purpose` subagents are fine for
  *throwaway code investigation* — they produce no deliverable and are not
  work agents.

Let Cloister route models — do not pass `--model` unless explicitly asked.
