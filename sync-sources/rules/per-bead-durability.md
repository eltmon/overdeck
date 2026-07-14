---
scope: universal
---
### Push every managed-work item before completing it

For an Overdeck-managed work issue, commit exactly one vBRIEF item at a time and immediately
push the feature branch before running `pan task done`. This invariant applies on
local and remote machines and overrides generic project Git profiles; an unpushed item
can be lost before Overdeck advances durable pipeline state.
