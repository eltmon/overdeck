---
scope: universal
---
### Use the beads doors; JSONL is derived only

Read current beads through the canonical resolver and mutate them with
`pan beads …`, never by reading or editing `issues.jsonl` or running raw mutating
`bd` commands. Dolt history on `refs/dolt/data` is authoritative; the JSONL file
is only a validated recovery export, so bypassing the doors creates cross-machine
drift.

Treat untracked `.beads/` files in a code checkout as generated tracker
infrastructure, not product changes. Do not commit `.beads/config.yaml`,
`.beads/README` or `README.md`, `.beads/.gitignore`, database files, or recovery
exports, and do not change the repository `.gitignore` merely to hide them.
Leave them untouched and report the unexpected files; Overdeck owns repair and
cleanup through its beads and workspace doors.
