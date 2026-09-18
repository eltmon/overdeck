---
name: pan-review
description: "pan review <subcommand> — manage the code review lifecycle: re-request review, set review mode, abort/restart review cycles"
triggers:
  - pan review
  - request review
  - review mode
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
abandon the review pass. Review verdicts are PR reviews (approve or request
changes) — there is no separate pipeline status to list, reset, or resync;
`gh pr list` and `gh pr view` answer "what's waiting" directly from the forge.

## Usage

```
pan review request <id>                            # Re-request review after fixing feedback
pan review mode <id> <quick|full>                  # Set this issue's review mode override
pan review abort <id>                               # Kill all running reviewers, leave worker idle
pan review restart <id> [--model <m>] [--role <r>]  # Resume review and re-dispatch reviewers missing a report
```

## What each subcommand does

- **`request <id>`** — After fixing the issues a reviewer flagged, this
  re-triggers the review pipeline against the current branch state. Use this
  when the worker has committed fixes and you want the existing review pass
  to re-evaluate.
- **`mode <id> <quick|full>`** — Sets a per-issue review-mode override.
  `quick` runs the single parent review agent. `full` opts the issue into
  the convoy review: security, correctness, performance, and requirements
  sub-reviewers plus synthesis. Use this only when heavier review is worth
  the extra agent/runtime cost for this one issue.
- **`abort <id>`** — Kills any currently running reviewer sessions but
  leaves the work agent alone. Use when reviewers are stuck or running
  against the wrong commit and you want to halt without waiting them out.
- **`restart <id>`** — Restarts the review parent, preserves completed reports,
  and re-dispatches reviewer lanes that have no report. Use when a reviewer
  crashed and the synthesis parent is waiting on that missing lane. Optional flags:
  - `--model <model>` — override the model for every reviewer in this run
    (e.g. `gpt-5.4`, `claude-sonnet-4-6`). Useful when the default model has
    misbehaved and you want to retry with a different one.
  - `--role <role>` — restart only one reviewer role (`correctness`,
    `security`, `performance`, `requirements`) instead of the whole convoy.

## When to use each

| Situation | Command |
|---|---|
| "What's waiting on me?" | `gh pr list --search "review-requested:@me"` |
| "What's ready to merge?" | `gh pr list --search "review:approved status:success"` |
| Worker pushed a fix, want re-review | `pan review request <id>` |
| This issue needs the full review convoy | `pan review mode <id> full` |
| Return an issue to default quick review | `pan review mode <id> quick` |
| Reviewer is hung, just kill it | `pan review abort <id>` |
| Reviewer crashed, resume the convoy with a different model | `pan review restart <id> --model gpt-5.4` |
| Only the security reviewer is broken | `pan review restart <id> --role security` |

## Merging is NOT here

To merge an approved branch, use the **MERGE** button on the dashboard, or
`gh pr merge`. The merge agent runs autonomously once approvals and checks
are green and the PR is mergeable; humans only click the button.

## See also

- `pan show <id>` — inspect work agent state, xBRIEF status, recent activity
- `pan done <id>` — signal initial work completion (from the worker side)
- `pan code-review` skill — orchestrated parallel code review with synthesis
- `roles/review.md` — the review role's frontmatter and prompt
- `docs/REVIEW-AGENT-ARCHITECTURE.md` — full design of the review convoy
