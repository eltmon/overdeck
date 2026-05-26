---
name: pan-handoff
description: "pan handoff <conv> — agent-authored conversation handoff that spawns a new conversation"
triggers:
  - pan handoff
  - hand off conversation
  - agent handoff
  - context handoff
  - fork with handoff
allowed-tools:
  - Bash
  - Read
---

# pan handoff

Create a new conversation seeded by a handoff document written by the live source agent.

## Quick command

```bash
pan handoff <conv> [focus text...]
```

The trailing text after the conversation reference becomes the focus — no flag required.

## Usage

```bash
pan handoff 42
pan handoff source-conv continue the API wiring
pan handoff source-conv --model claude-sonnet-4-6
pan handoff source-conv --harness pi
pan handoff source-conv --cwd /path/to/project
pan handoff source-conv --model claude-opus-4-7 wire the Stripe webhook into checkout
```

## When to use

- A long-running conversation is near the context wall.
- The current agent knows dead ends, hazards, or file relationships that a passive summary may miss.
- You want a deliberate context transfer before switching models, harnesses, or tasks.

Use a normal summary fork when the source conversation is ended or when a quick passive summary is enough. Use a plain fork only when staying within Claude Code-compatible raw history.

## Focus

The positional text after `<conv>` is the focus — a short statement of what the successor should concentrate on. Quotes are optional; everything after the conversation reference (excluding flags) is joined with spaces. Keep it short and task-oriented; the focus is injected into the handoff-authoring prompt, not used as the new conversation's user request.

## Fallback behavior

`pan handoff <conv>` always attempts to create a usable new conversation. If the live-agent handoff cannot complete, Panopticon falls back to a summary fork and prints the fallback reason.

Common fallback reasons:

- `source-ended` — the source conversation is already ended.
- `handoff-timeout` — the source did not write both the document and `.done` sentinel in time.
- `handoff-validation` — the document did not satisfy the handoff contract.
- `source-workspace-devcontainer` — the source cannot write to the host handoff directory from a workspace container.

## Output

Successful handoffs print the new conversation id, tmux session, model, harness, dashboard link, and handoff doc path. Fallbacks print the same new conversation details plus a yellow fallback notice.

## See also

- `pan fork <conv>` — create a summary or plain fork without asking the source agent to author a handoff.
- `/pan-workflow` — broader Panopticon workflow guidance.
