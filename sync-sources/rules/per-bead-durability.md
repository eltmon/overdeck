---
scope: universal
---
### Push every managed-work bead before closing it

For an Overdeck-managed work issue, commit exactly one bead at a time and immediately
push the feature branch before running `pan beads close`. This invariant applies on
local and remote machines and overrides generic project Git profiles; an unpushed bead
can be lost before Overdeck advances durable pipeline state.
