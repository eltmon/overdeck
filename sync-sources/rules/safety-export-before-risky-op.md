---
scope: dev
---
### Take the safety export yourself before a risky op

Before a risky operation (data-layer cutover, migration, DB rebuild) that
could affect irreplaceable data (conversation metadata, cost history), take
the read-only snapshot yourself, immediately. Do not delegate the backup to
the agent performing the risky operation.

The safety net must exist independent of the operation, captured before
anything touches the data, so a bug in the operation cannot also corrupt the
only backup. Verify the snapshot (row counts + a sample resolve) before
handing the operation to the agent.
