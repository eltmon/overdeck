---
scope: universal
paths:
  - "src/dashboard/**"
  - "src/lib/**"
---
### Never speculatively send destructive HTTP requests

NEVER send destructive HTTP requests (POST/DELETE) speculatively — the request fires on send, not on tool approval. Tool rejection by the user CANNOT stop an already-sent request.

The deep-wipe endpoint (`POST /api/agents/:id/deep-wipe`) with `deleteWorkspace: true` is irreversible and destroys: tmux sessions, agent state, the entire workspace directory (including `.overdeck/` runtime files and its `.beads/` redirect), git branches (local + remote), and issue tracker status. Canonical permanent state for migrated projects instead lives on `overdeck-state` (on disk at `${OVERDECK_HOME}/state/<project>/`); unmigrated projects still use legacy `<projectRoot>/.pan/` and project `.beads/` paths until cutover.

NEVER call deep-wipe programmatically without the user explicitly requesting it.
