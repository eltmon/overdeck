---
name: pan-review
description: "pan review <subcommand> — manage the code review lifecycle: list pending work, re-request review, reset/abort/restart review cycles"
triggers:
  - pan review
  - review pending
  - request review
  - reset review
  - restart review
  - abort review
  - code review lifecycle
allowed-tools:
  - Bash
  - Read
---

# pan review

Manage the review pipeline for completed agent work. Use this when an issue
has been signaled done by the work agent but you need to inspect, retry, or
abandon the review/test/ship pass.

## Usage

```
pan review pending                                 # List completed work awaiting review
pan review request <id>                            # Re-request review after fixing feedback
pan review reset <id> [--session]                  # Reset review/test/merge cycles (human override)
pan review abort <id>                              # Kill all running reviewers, leave worker idle
pan review restart <id> [--model <m>] [--role <r>] # Kill reviewers and dispatch a fresh review pipeline
```

## What each subcommand does

- **`pending`** — Lists every issue whose work agent has signaled `done` but
  whose review pipeline hasn't completed (in-flight, blocked, or stalled).
  This is the first command to run when you want to know "what's waiting on
  me right now?"
- **`request <id>`** — After fixing the issues a reviewer flagged, this
  re-triggers the review pipeline against the current branch state. Use this
  when the worker has committed fixes and you want the existing review pass
  to re-evaluate.
- **`reset <id>`** — Clears the review/test/merge state for an issue, so the
  pipeline can be re-dispatched from scratch. Use when the saved state is
  inconsistent or corrupt. `--session` additionally clears the saved Claude
  session for each reviewer so they restart with a clean conversation.
- **`abort <id>`** — Kills any currently running reviewer sessions but
  leaves the work agent alone. Use when reviewers are stuck or running
  against the wrong commit and you want to halt without resetting state.
- **`restart <id>`** — `abort` + dispatch a fresh review pipeline in one
  command. Use when reviewers crashed or produced unusable output and you
  want a clean re-run. Optional flags:
  - `--model <model>` — override the model for every reviewer in this run
    (e.g. `gpt-5.4`, `claude-sonnet-4-6`). Useful when the default model has
    misbehaved and you want to retry with a different one.
  - `--role <role>` — restart only one reviewer role (`correctness`,
    `security`, `performance`, `requirements`) instead of the whole convoy.

## When to use each

| Situation | Command |
|---|---|
| "What's waiting on me?" | `pan review pending` |
| Worker pushed a fix, want re-review | `pan review request <id>` |
| Pipeline state is inconsistent, need a clean slate | `pan review reset <id>` |
| Same as above plus reviewer Claude sessions are bad | `pan review reset <id> --session` |
| Reviewer is hung, just kill it | `pan review abort <id>` |
| Reviewer crashed, want a fresh convoy with a different model | `pan review restart <id> --model gpt-5.4` |
| Only the security reviewer is broken | `pan review restart <id> --role security` |

## Merging is NOT here

`pan approve` has been removed. To merge an approved branch, use the
**MERGE** button on the dashboard. The merge agent runs autonomously after
all reviewers + the test specialist sign off; humans only click the button.

## See also

- `pan show <id>` — inspect work agent state, vBRIEF status, recent activity
- `pan done <id>` — signal initial work completion (from the worker side)
- `pan code-review` skill — orchestrated parallel code review with synthesis
- `roles/review.md` — the review role's frontmatter and prompt
- `docs/REVIEW-AGENT-ARCHITECTURE.md` — full design of the review convoy
