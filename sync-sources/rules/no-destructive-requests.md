---
scope: universal
paths:
  - "src/dashboard/**"
  - "src/lib/**"
---
NEVER send destructive HTTP requests (POST/DELETE) speculatively — the request fires on send, not on tool approval.

The deep-wipe endpoint (`POST /api/agents/:id/deep-wipe`) with `deleteWorkspace: true` is irreversible and destroys: tmux sessions, agent state, entire workspace directory (including `.planning/`, beads), git branches (local + remote), and issue tracker status.

NEVER call deep-wipe programmatically without the user explicitly requesting it.
