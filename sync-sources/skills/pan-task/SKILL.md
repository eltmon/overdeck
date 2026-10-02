---
name: pan-task
description: "pan task <verb> <issue> — claim and complete xBRIEF checklist items"
triggers:
  - pan task
  - claim task
  - complete task
allowed-tools:
  - Bash
---

# pan task

Run the requested task command now. Task state belongs to one issue's xBRIEF checklist, recorded in `.pan/continues/<issue>.xbrief.json` in the project repo (or the configured plan-home repo for polyrepo projects) — never a tracker or pipeline record.

```bash
pan task next PAN-123
pan task show PAN-123 PAN-123-a
pan task claim PAN-123 PAN-123-a
pan task claim PAN-123 PAN-123-a --steal
pan task done PAN-123 PAN-123-a
pan task block PAN-123 PAN-123-a
pan task block PAN-123 PAN-123-a --on PAN-120 '#4444'
pan task unblock PAN-123 PAN-123-a
pan task cancel PAN-123 PAN-123-a
```

`block --on <ref>...` also records which issues or PRs the item waits on (issue IDs,
`#N`, `owner/repo#N`, GitHub PR URLs; comma-separated values work too), and Overdeck
wakes the agent with a `BLOCKERS MERGED` message once all of them merge. Run it for
every item parked on other work; a comment alone wakes nobody. `unblock`/`cancel` only
flip the item's status in the continue file. There is still no `--reason` flag or
free-text note field; say why in the issue/PR conversation if a reason is worth
recording.

`pan task claim` records the claim in the continue file. Commit exactly one xBRIEF item at a time with the commit trailer `Item: <item-id>`, and push the feature branch immediately — before running `pan task done`. An unpushed item can be lost before Overdeck can see it.

`pan task claim` refuses (exit 1, nothing written) when a running agent already holds the item, or holds another item whose `files_scope` overlaps it — a low-confidence `files_scope` on either side counts as overlap. A worker that gets refused should run `pan task next` and pick a different item, never retry with `--steal`. `--steal` overrides both refusal kinds and is for the foreman or the operator only, when the other holder is known stuck or gone.

`pan task done <item>` then verifies a commit on the pushed feature branch carries `Item: <item-id>`, and commits the item's status into the continue file. It refuses if the branch isn't pushed or the trailer is missing.
