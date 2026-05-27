---
scope: universal
paths:
  - "src/dashboard/**"
  - "src/lib/**"
---
### Never speculatively send destructive HTTP requests

NEVER send destructive HTTP requests (POST/DELETE) speculatively — the request fires on send, not on tool approval. Tool rejection by the user CANNOT stop an already-sent request.

The deep-wipe endpoint (`POST /api/agents/:id/deep-wipe`) with `deleteWorkspace: true` is irreversible and destroys: tmux sessions, agent state, entire workspace directory (including `.pan/specs/`, `.pan/continue.json`, `.beads/`), git branches (local + remote), and issue tracker status.

NEVER call deep-wipe programmatically without the user explicitly requesting it.
