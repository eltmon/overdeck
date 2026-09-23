---
name: pan-worker
description: "pan worker run|wait|report|list — delegate a bounded task to a registered, issue-linked worker agent and get its report back. Use instead of a harness plugin such as the Codex plugin."
triggers:
  - pan worker
  - delegate to a worker
  - spawn a worker
  - run a worker
  - second opinion from another model
  - codex plugin
allowed-tools:
  - Bash
  - Read
---

# Registered Workers

## Overview

`pan worker run` starts a worker: a separate agent for one issue that does one brief and hands its
report back to you. The worker is a native Overdeck agent with role `worker`. It runs in a persistent
pane on the host's terminal backend, with its own `state.json`, transcript, cost, and model routing
(`roles.worker.model`). You are its parent: you can steer it with `pan tell`, and it appears in the
Agents Directory under you and under the issue.

Use a worker instead of a harness plugin (for example the Codex plugin): a plugin's agent is invisible
to Overdeck, and nothing can steer or stop it.

## When to use

- Delegate a bounded task (an investigation, a review pass, a fix in an isolated worktree) and get the
  result back as text.
- Get a second opinion from another model or harness (`--model`, `--harness`).
- Run review-style work that must not change the branch (`--read-only`).

Do not use a worker for the issue's own implementation lifecycle: never tell a worker to run
`pan done`, `pan review`, or `pan task done`.

## Commands

```bash
pan worker run --issue PAN-123 --prompt "Find every caller of resolveHarness and list them."
pan worker run --issue PAN-123 --brief brief.md --read-only
pan worker run --issue PAN-123 --brief brief.md --model gpt-5.5 --harness codex --name second-opinion
pan worker run --issue PAN-123 --prompt "Fix the flaky test." --cwd packages/core --parent conv-orchestrator
pan worker run --issue PAN-123 --brief brief.md --detach
pan worker run --issue PAN-123 --brief brief.md --timeout 540 --stop-after-report
pan worker wait agent-pan-123-worker-1 --timeout 540
pan worker wait agent-pan-123-worker-1 --after 1
pan worker report agent-pan-123-worker-1 --file report.md --status blocked
pan worker report agent-pan-123-worker-1 --stdin
pan worker list --issue PAN-123
pan worker list --parent conv-orchestrator --json
```

`pan worker run` flags: `--issue` (required), exactly one of `--prompt` or `--brief`, and optionally
`--model`, `--harness`, `--read-only`, `--cwd` (must be inside the issue workspace), `--parent`,
`--name`, `--detach`, `--timeout <seconds>`, `--stop-after-report`.

- **Working directory.** By default the worker gets its own git worktree at
  `<workspace>/.swarm/worker-<n>/` on branch `<feature-branch>/worker-<n>`. With `--read-only` it runs
  in the issue workspace behind a git guard that blocks every git write there (read commands such as
  `status`, `diff`, `log` and `show` still work). The guard covers git only; it is not a file-system
  sandbox.
- **Parent.** `--parent`, else `$OVERDECK_AGENT_ID`, else `$OVERDECK_CONVERSATION`. Called from an agent
  with none of these, the command fails and asks for `--parent`.

## Exit codes (run and wait)

| Code | Meaning | Output |
|---|---|---|
| 0 | Report with status `done` | Report body on stdout |
| 4 | Report with status `blocked` or `failed` | Report body on stdout |
| 2 | Worker exited, or sat idle 10 minutes, without a report | Its last assistant message on stdout, prefixed `[no report — last assistant message]` |
| 3 | Timeout; the worker is still running | `pan worker wait <id>` hint on stderr |
| 1 | Usage or spawn error | Reason on stderr |

Status lines always go to stderr, so stdout is only the report.

## How to wait from each harness

- **Claude Code:** run `pan worker run …` with the Bash tool's `run_in_background: true`. The
  foreground limit is 10 minutes; a background command notifies you when it exits, and its stdout is
  the report.
- **Codex and other harnesses:** run `pan worker run … --detach` to get the id, then run
  `pan worker wait <id> --timeout 540` in a loop until the exit code is not 3.

## Follow-ups

A worker stays running after it reports. To give it more work:

```bash
pan tell agent-pan-123-worker-1 "Also check the tmux adapter."
pan worker wait agent-pan-123-worker-1
```

Only the worker's parent, the issue's work agent, or an operator conversation may `pan tell` a worker.
Stop a worker you no longer need with `pan kill <worker-id>`.

## Reporting (for the worker itself)

The brief ends with the exact command. Write the report as Markdown to a file, then run
`pan worker report <your-id> --file <path>`, with `--status blocked` or `--status failed` when you
could not finish. Put the answer first.
