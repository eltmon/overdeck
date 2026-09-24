---
name: pan-worker
description: "pan worker run|wait|report|list|register — delegate a bounded task to a registered, issue-linked worker agent and get its report back. Use instead of a harness plugin such as the Codex plugin; register agents another tool launched so the Agents Directory shows them."
triggers:
  - pan worker
  - delegate to a worker
  - spawn a worker
  - run a worker
  - second opinion from another model
  - codex plugin
  - pan worker register
  - register an external agent
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
  `<workspace>/.swarm/worker-<n>/` on branch `<feature-branch>-worker-<n>`. With `--read-only` it runs
  in the issue workspace behind a `git` PATH shim that prevents accidental git writes to the issue's
  repository (the primary checkout and every worktree of it). Reads such as `status`, `diff`, `log`,
  `show`, `config --get` and `branch --show-current` still work; `fetch` does not. The shim is not a
  sandbox: an absolute `/usr/bin/git` bypasses it, so does `OVERDECK_PAN_GIT_OP=1`, and it does not
  restrict file or network writes.
- **Parent.** `--parent`, else `$OVERDECK_AGENT_ID`, else `$OVERDECK_CONVERSATION`. Called from an agent
  with none of these, the command fails and asks for `--parent`.

## Exit codes (run and wait)

| Code | Meaning | Output |
|---|---|---|
| 0 | Report with status `done` | Report body on stdout |
| 4 | Report with status `blocked` or `failed` | Report body on stdout |
| 2 | Worker exited, or sat idle 10 minutes, without a report | Its last assistant message on stdout, prefixed `[no report — last assistant message]` |
| 3 | Timeout; the worker is still running | The exact `pan worker wait` to run next, on stderr |
| 1 | Usage or spawn error | Reason on stderr |

Status lines always go to stderr, so stdout is only the report. A report's status line names its
sequence number and the next wait, for example
`worker agent-pan-123-worker-1 report 2: done; next: pan worker wait agent-pan-123-worker-1 --after 2`.

## Which report `wait` returns

- `pan worker wait <id>` with no `--after` returns the newest report the worker has written, even one
  written while nothing was waiting. Use it for the first report of a `--detach`ed worker.
- `pan worker wait <id> --after <n>` returns the next report after `n`. Once you have read report `n`,
  every later wait passes `--after <n>`; otherwise you get report `n` again.

## How to wait from each harness

- **Claude Code:** run `pan worker run …` with the Bash tool's `run_in_background: true`. The
  foreground limit is 10 minutes; a background command notifies you when it exits, and its stdout is
  the report.
- **Codex and other harnesses:** run `pan worker run … --detach` to get the id, then wait in a loop
  until the exit code is not 3. A timed-out wait loses nothing: the next one still returns the report.

  ```bash
  id=$(pan worker run --issue PAN-123 --brief brief.md --detach)
  pan worker wait "$id" --timeout 540    # repeat while the exit code is 3
  # after reading report 1, wait for the next one:
  pan worker wait "$id" --after 1 --timeout 540
  ```

## Follow-ups

A worker stays running after it reports. To give it more work:

```bash
pan tell agent-pan-123-worker-1 "Also check the tmux adapter."
pan worker wait agent-pan-123-worker-1 --after 1   # 1 = the last report you read
```

Only the worker's parent, the issue's work agent, or an operator conversation may `pan tell` a worker.
Stop a worker you no longer need with `pan kill <worker-id>`. Stopping it (or `--stop-after-report`)
keeps its `.swarm/worker-<n>` worktree and branch, because you may still need its work. The worktree
is removed only when the issue's workspace is deleted, and the branch only once its commits are in
`main` or the feature branch; an unmerged worker branch is always kept. Merge what you need.

## Reporting (for the worker itself)

The brief ends with the exact command. Write the report as Markdown to a file, then run
`pan worker report <your-id> --file <path>`, with `--status blocked` or `--status failed` when you
could not finish. Put the answer first. An agent can record a report only for itself.

## Registering an agent another tool launched

`pan worker register` records an externally spawned agent (one Overdeck did not launch) so the Agents
Directory shows it, with its transcript when Overdeck can read that kind. Overdeck can show and read an
external agent; it cannot `pan tell`, stop or restart it.

```bash
pan worker register --source my-tool --external-id run-7 --harness codex \
  --model gpt-5.5 --cwd . --issue PAN-123 --parent "$OVERDECK_CONVERSATION" \
  --label "second opinion" --pid 4242 --transcript ~/.codex/sessions/2026/09/23/rollout-…-<thread>.jsonl
pan worker register --source my-tool --external-id run-7 --harness codex --json   # { "id": …, "created": false }
```

- Required: `--source` (`[a-z0-9-]`, up to 32 characters; `codex-plugin` is reserved), `--external-id`,
  `--harness`. Optional: `--model`, `--cwd`, `--issue`, `--parent` (agent id, conversation tmux session,
  or `claude-session:<uuid>`), `--label`, `--pid`, `--transcript`, `--session-id`, `--json`.
- The id is `ext-<source>-<external-id>`. Registering the same source and external id again prints the
  existing id and writes nothing.
- With `--pid`, the directory shows the agent working while that process runs (the pid's start time is
  recorded, so a reused pid is not mistaken for it).
- Scripts without the CLI can `POST /api/workers/register` with the same fields as JSON and the
  `x-overdeck-internal-token` header.
- Codex-plugin jobs (`codex:codex-rescue` and friends) are registered automatically; you do not need
  to register them.
