---
scope: universal
---
### Work agents run through `pan` — never the Claude Code `Agent` tool

Spawn work agents only through the Overdeck CLI — `pan start <id>`, `pan swarm <id>`, `pan plan <id>`. NEVER spawn a *work* agent via Claude Code's `Agent`/subagent tool.

**Why:** `pan`-spawned agents are registered with Overdeck — a `~/.overdeck/agents/agent-<id>/state.json` carrying `issueId` and a tmux session on the `overdeck` socket. The dashboard nests them under their issue with openable terminals, and the review/test/ship pipeline can manage them.

Agents spawned via the `Agent` tool run as ephemeral subagents inside the caller's session — no state file, no `issueId`, no `overdeck`-socket session. The dashboard cannot discover them; they cannot be paused, resumed, reviewed, merged, or recovered through the pipeline.

**Scope:**

- **work** (implementation), **plan**, **review/test/ship** → always `pan`.
- Claude Code's built-in `Explore` / `general-purpose` subagents are fine for *throwaway code investigation* — they produce no deliverable and are not work agents.
- A swarm foreman may perform a small, high-confidence item in its own context or use a registered standing tier session. The foreman still owns the claim, verification, commit, push, and task transition; an ephemeral subagent never becomes an independent slot.

Let Cloister route models — do not pass `--model` unless explicitly asked.
