---
scope: dev
---
### Use strike agents first for urgent pipeline blockers

When an issue blocks critical pipeline flow (red main, stuck merge gate,
failing verification), spawn a `pan strike <id>` to land the fix fast rather
than routing it through the normal plan/work/review cycle.

Unblocking the pipeline is more urgent than review compliance. After the
strike lands a minimal unblock, immediately file a follow-up issue for tests
or hardening and route that follow-up through the normal pipeline.
