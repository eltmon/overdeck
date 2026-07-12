---
scope: universal
---
### Use the beads doors; JSONL is derived only

Read current beads through the canonical resolver and mutate them with
`pan beads …`, never by reading or editing `issues.jsonl` or running raw mutating
`bd` commands. Dolt history on `refs/dolt/data` is authoritative; the JSONL file
is only a validated recovery export, so bypassing the doors creates cross-machine
drift.
