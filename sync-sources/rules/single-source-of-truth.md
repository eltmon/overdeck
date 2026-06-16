---
scope: dev
---
### Tenet: single source of truth — one read door, one write door, no direct store access

Every piece of canonical state — issue status, plans, verdicts, agent runtime, per-issue progress —
has **exactly one read path and one write path**. Code, agents, the CLI, and the dashboard reach state
ONLY through:

- **the read door** — the state-resolver API (`/api/state/*` + the RPC `StateGroup`); and
- **the write door** — the single record writer / write-surface.

No route handler, agent, script, or hook may read or write the SQLite DB, the `.pan/` filesystem,
`state.json`, or GitHub issue state **directly** for canonical state. The DB is a disposable cache,
rebuilt from the sources of truth (GitHub, git `.pan/records`, JSONL transcripts, tmux); the two doors
are the only things that touch a store, and the writer mirrors durable state back to git so it travels.

**Why:** drift. The same fact was read from 8+ endpoints and written from 100+ call sites across
DB / filesystem / GitHub with nothing enforcing agreement — the root cause of the recurring state and
pipeline corruption (stale state, agents disagreeing, "half-files/half-DB", recovery breaking). Two
doors over one surface make drift **structurally impossible**, not merely discouraged.

**How to apply:** to add a state read or write, extend the resolver or the writer — never add a new
direct access. A CI guard fails the build on direct DB / `.pan/` / `state.json` / GitHub access for
canonical state outside the two doors. When you find existing direct access, route it through a door;
do not add a parallel path. See `docs/API-SURFACE.md` (end-state diagram) and the state-model epic.
