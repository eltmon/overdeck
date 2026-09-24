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
pan task done PAN-123 PAN-123-a
pan task block PAN-123 PAN-123-a
pan task unblock PAN-123 PAN-123-a
pan task cancel PAN-123 PAN-123-a
```

`block`/`unblock`/`cancel` only flip the item's status in the continue file — there
is no `--reason` flag or free-text note field. Say why in the issue/PR conversation
if a reason is worth recording.

`pan task claim` records the claim in the continue file. Commit exactly one xBRIEF item at a time with the commit trailer `Item: <item-id>`, and push the feature branch immediately — before running `pan task done`. An unpushed item can be lost before Overdeck can see it.

`pan task done <item>` then verifies a commit on the pushed feature branch carries `Item: <item-id>`, and commits the item's status into the continue file. It refuses if the branch isn't pushed or the trailer is missing.
