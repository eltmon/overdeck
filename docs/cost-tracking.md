# Cost Tracking Architecture — Complete System Design

## Source of Truth

Claude Code writes a transcript JSONL file for every session. The file is stored at:

```
~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl
```

Where `<encoded-cwd>` is derived from the **current working directory when `claude` was launched** — strip the leading `/`, replace all `/` with `-`, prefix with `-`. For example:

```
cwd: /home/eltmon/Projects/krux/workspaces/feature-krux-4
  → ~/.claude/projects/-home-eltmon-Projects-krux-workspaces-feature-krux-4/<uuid>.jsonl

cwd: /home/eltmon/Projects/krux
  → ~/.claude/projects/-home-eltmon-Projects-krux/<uuid>.jsonl
```

Each transcript entry for an assistant message contains:
- `requestId` — unique Claude API request ID (e.g., `req_011CZDBPvH99CWcNNsQoLEC3`)
- `message.model` — model used (e.g., `claude-opus-4-6`)
- `message.usage` — token counts: `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`

The transcript files are the canonical, immutable source of truth for all cost data.

## Where Sessions Live on Disk

A single issue can have **multiple agents**, each started from **different directories**, producing sessions in **different Claude project directories**:

| Agent Type | Typical cwd | Claude Project Dir |
|-----------|-------------|-------------------|
| Planning agent | Main project dir (before workspace exists) | `~/.claude/projects/-home-...-Projects-krux/` |
| Work agent | Git worktree workspace | `~/.claude/projects/-home-...-Projects-krux-workspaces-feature-krux-4/` |
| Review specialist | Workspace (per-project ephemeral) | Same as work agent, OR specialist-specific |
| Test specialist | Workspace | Same pattern |
| Merge specialist | Workspace | Same pattern |
| Interactive (user) | Anywhere | Wherever the user ran `claude` |

An agent can also produce **multiple sessions** over its lifetime (compactions, restarts, handoffs). Each session gets a unique UUID and its own `.jsonl` file, but they all land in the same Claude project directory (since the cwd doesn't change).

Subagent transcripts are stored in a `subagents/` subdirectory within the Claude project directory.

### Workspace Cleanup

When workspaces are cleaned up after merge (git worktree removed), the Claude session directory at `~/.claude/projects/` is **NOT deleted** — it survives workspace cleanup. This is critical for cost recovery.

## Session-to-Agent Mapping

The core attribution problem: given a transcript file `<uuid>.jsonl`, which Overdeck agent created it?

### Where the Mapping Is Stored

**Runtime state** (`~/.panopticon/agents/<agent-id>/runtime.json`):
- The heartbeat hook fires on every tool use and receives both `session_id` (from Claude Code) and `OVERDECK_AGENT_ID` (from env)
- It writes the current active `session_id` to `runtime.json` — this is the "what's active now" mapping

**Session history** (`~/.panopticon/agents/<agent-id>/sessions.json`):
- Append-only list of all Claude Code session UUIDs this agent has ever used
- The heartbeat hook appends new session IDs as they appear
- This is the "what sessions belong to this agent historically" mapping — exactly what the reconciler needs

**SQLite `processed_sessions` table**:
- Maps session UUIDs to agent IDs, issue IDs, transcript paths, and byte offsets
- Populated by both the live hook and the reconciler
- Serves as the reconciler's progress tracker

**SQLite `cost_events.session_id` column**:
- Each cost event records which Claude Code session produced it
- Enables querying costs by session for debugging and attribution

### Why Both Stores Matter

- `runtime.json` + `sessions.json` = "which agent owns which session" (needed for attribution)
- `processed_sessions` = "how far have we read each session's transcript" (needed for incremental processing)
- `cost_events.session_id` = "which session produced this cost" (needed for breakdown/analysis)

## SQLite Schema — cost_events Table

```sql
CREATE TABLE cost_events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    ts            TEXT    NOT NULL,
    agent_id      TEXT    NOT NULL,
    issue_id      TEXT    NOT NULL,
    session_type  TEXT    NOT NULL DEFAULT 'unknown',  -- planning, implementation, review, test, merge, interactive
    provider      TEXT    NOT NULL DEFAULT 'anthropic',
    model         TEXT    NOT NULL,
    input         INTEGER NOT NULL DEFAULT 0,
    output        INTEGER NOT NULL DEFAULT 0,
    cache_read    INTEGER NOT NULL DEFAULT 0,
    cache_write   INTEGER NOT NULL DEFAULT 0,
    cost          REAL    NOT NULL DEFAULT 0,
    request_id    TEXT,
    session_id    TEXT,    -- Claude Code session UUID
    tldr_interceptions INTEGER,
    tldr_bypasses      INTEGER,
    tldr_tokens_saved  INTEGER,
    tldr_bypass_reasons TEXT,  -- JSON string
    source_file   TEXT
);

CREATE UNIQUE INDEX idx_cost_request_id ON cost_events(request_id) WHERE request_id IS NOT NULL;
CREATE INDEX idx_cost_issue_id ON cost_events(issue_id, ts);
CREATE INDEX idx_cost_agent_id ON cost_events(agent_id, ts);
CREATE INDEX idx_cost_ts ON cost_events(ts);
CREATE INDEX idx_cost_session_id ON cost_events(session_id) WHERE session_id IS NOT NULL;
```

**CRITICAL**: Nothing in this table ever gets deleted. It is append-only.

The `request_id` unique index is the primary dedup mechanism. Each Claude API request has a globally unique ID. `INSERT OR IGNORE` skips duplicates.

## SQLite Schema — processed_sessions Table

```sql
CREATE TABLE processed_sessions (
    session_id      TEXT PRIMARY KEY,     -- Claude Code session UUID
    agent_id        TEXT,                 -- Overdeck agent that owns this session
    issue_id        TEXT,                 -- Issue this session is attributed to
    transcript_path TEXT,                 -- Full path to the .jsonl file
    byte_offset     INTEGER NOT NULL DEFAULT 0,  -- Bytes consumed so far
    processed_at    TEXT NOT NULL,
    event_count     INTEGER NOT NULL DEFAULT 0
);
```

## Path 1: Live Recording (Real-Time)

This is the hot path that records costs as agents work.

### Flow

1. Claude Code fires a `PostToolUse` hook after every tool use
2. The hook payload includes `session_id` and `transcript_path`
3. `~/.panopticon/bin/heartbeat-hook` (bash) receives this, does heartbeat/activity tracking, then calls `record-cost-event.js`
4. `record-cost-event.js` (tsdown-bundled TypeScript):
   - Reads the byte offset it last processed for this session from `~/.panopticon/costs/state/<session-id>.offset`
   - Opens the transcript JSONL file and reads only NEW bytes from that offset
   - Parses each new line looking for `type: "assistant"` entries with `message.usage`
   - Deduplicates by `requestId` (tracks seen IDs in `~/.panopticon/costs/state/<session-id>.seen`)
   - Calculates cost using pricing tables
   - Calls `appendCostEvent()` which triple-writes:
     - `~/.panopticon/costs/events.jsonl` (append-only JSONL log)
     - SQLite `cost_events` table (via `INSERT OR IGNORE` with `request_id` dedup)
     - Per-project WAL file (for cross-developer sharing via git)
   - Saves the new byte offset

### Session-to-Agent Mapping (Live Path)

The heartbeat hook has both `session_id` (from PostToolUse payload) and `OVERDECK_AGENT_ID` (from env, set by agent launcher). It should:
1. Write the current `session_id` to `runtime.json` (active session)
2. Append the `session_id` to `sessions.json` if not already present (session history)
3. Pass `session_id` through to `record-cost-event.js` which stores it in `cost_events.session_id`

### Issue ID Resolution

The hook resolves issue IDs in this order:
1. `$OVERDECK_AGENT_ID` / `$OVERDECK_ISSUE_ID` env vars (set by agent launcher)
2. Git branch name regex: `(pan|min|aud|krux|cli)-(\d+)`
3. Workspace path regex: same pattern
4. Fallback: `UNKNOWN`

### Build Requirements

The `record-cost-event.js` script is bundled with tsdown (`scripts/tsdown.config.ts`). It uses the shared SQLite driver adapter, which selects the runtime's built-in SQLite implementation instead of a native npm addon:
- `shims: true` — keeps ESM output compatible with any remaining CJS dependencies
- Everything is bundled (the script runs standalone from `~/.panopticon/bin/` where `node_modules` is not available)

### Error Handling Concern

The heartbeat hook silently swallows errors from `record-cost-event.js` (`2>/dev/null || true`). If the script is broken (as happened with the esbuild bundling issue), costs silently stop recording with NO visible indication. This needs to be addressed:
- The deacon should monitor cost event freshness
- The dashboard should show a banner when no cost events have been recorded recently
- The hook should log errors somewhere visible

## Path 2: Reconciler (Catch-Up Safety Net)

The reconciler is a periodic sweep that ensures completeness. It catches anything the live hook missed — whether from hook failures, process crashes, system reboots, or any other reason.

### How It Works

The reconciler scans `~/.claude/projects/` directly — no indirection through agent state files:

1. Scan all directories under `~/.claude/projects/`
2. Build a reverse session-to-agent index from `~/.panopticon/agents/*/sessions.json` files
3. For each directory, list all `.jsonl` transcript files
4. For each transcript file, check `processed_sessions` for existing byte offset
5. Read only new bytes, extract cost events with `requestId`
6. For **attribution** (agent ID, issue ID, session type):
   - Check `sessions.json` reverse index to find which agent owns this session UUID
   - Read `state.json` for the agent's `phase` field (used as `session_type`)
   - If no agent mapping found, infer issue ID from the encoded directory path (e.g., `feature-min-787` in the path → `MIN-787`)
   - If no issue can be inferred, attribute as `UNKNOWN` / `unattributed`
7. Insert with dedup via `INSERT OR IGNORE` on `request_id`
8. Update byte offset in `processed_sessions`

This approach catches **everything** — planning sessions from main project dirs, work agent sessions from worktree workspaces, specialist sessions, and interactive/manual Claude sessions.

### Key Properties

- **Idempotent**: Can run any number of times without creating duplicates (dedup on `request_id`)
- **Incremental**: Only processes new bytes in each transcript (offset tracking)
- **Non-destructive**: Never deletes anything from SQLite. Append-only.
- **Catches everything**: Any transcript entry with a `requestId` not in SQLite gets imported
- **Survives workspace cleanup**: Claude session dirs persist after git worktree removal

### When It Runs

- On dashboard startup (via `setImmediate` — non-blocking)
- Periodically (every 5 minutes via dashboard server)
- On-demand via API endpoint: `POST /api/costs/reconcile`
- Should become a proper managed background job (integrated with deacon or its own service)

## Path 3: Original Migration (Historical, Kept for Reference)

The original migration (`src/lib/costs/migration.ts`) was a one-time backfill for agents that ran before the live recording system existed. Key differences from the reconciler:

- Did NOT set `requestId` on events — no dedup protection
- Did NOT track session IDs or byte offsets
- Was designed to run once (`migrateIfNeeded()` skips if events already exist)
- Generated events with `agent_id: "recovered"` or `"recovered-deep"`

This code is preserved in `src/lib/costs/migration.ts` but the reconciler supersedes it for all ongoing use.

## Cost Attribution by Stage (PAN-77, PAN-42)

For the cost breakdown modal (PAN-77), costs need to be attributed by pipeline stage:

| Stage | Source | `session_type` value |
|-------|--------|---------------------|
| Planning | Planning agent session | `planning` |
| Implementation | Work agent session | `implementation` |
| Review | Review specialist session | `review` |
| Testing | Test specialist session | `test` |
| Merge | Merge specialist session | `merge` |
| Interactive | Manual user sessions | `interactive` |

### Current State

- Work agents and planning agents set `OVERDECK_SESSION_TYPE` via env vars at launch
- Specialists do NOT have `state.json` and are ephemeral (PAN-378 refactoring)
- Specialist sessions work across many issues, so per-issue attribution requires knowing which issue the specialist was working on at each point in the transcript
- The `session_type` column in `cost_events` tracks this, but only when the live hook captures it

### What's Needed

1. **Session-to-agent mapping** (described above) — heartbeat hook writes `session_id` to `runtime.json` and `sessions.json`
2. **Specialist cost attribution** — specialists need to set `OVERDECK_ISSUE_ID` and `OVERDECK_SESSION_TYPE` when they start working on a specific issue
3. **Reconciler v2** — scan `~/.claude/projects/` directly, use `sessions.json` for attribution

## Related Open Issues

| Issue | Title | Relevance |
|-------|-------|-----------|
| **PAN-77** | Cost breakdown modal: show costs by stage and model | Needs proper session_type attribution |
| **PAN-317** | Track non-agent Claude Code session costs ($545 unattributed) | Reconciler v2 direct scan solves this |
| **PAN-42** | Track costs at each stage of agent lifecycle | Needs session_type tracking on all agent types |
| **PAN-55** | Track specialist costs with time period filtering | Needs specialist session attribution |
| **PAN-206** | Persist cost data across environment rebuilds | SQLite + reconciler makes this resilient |
| **PAN-104** | Cost alerts/notifications when spending exceeds thresholds | Builds on accurate cost data |
| **PAN-106** | Cost prediction/estimation for in-progress work | Builds on per-stage cost history |

## Dashboard Integration

### Kanban Board Cost Display

- `fetchIssueCosts()` calls `GET /api/costs/by-issue` every 30 seconds
- Endpoint reads from SQLite via `getCostsByIssueFromDb()` — aggregates `cost_events` by `UPPER(issue_id)`
- `IssueCard` component renders cost badge with color coding (green < $5, yellow < $20, orange < $50, red >= $50)

### Per-Agent Cost (Detail Pane)

- `useAgentCost()` hook calls `GET /api/agents/:id/cost`
- This endpoint reads directly from Claude transcript JSONL files (NOT from SQLite)
- Used in `IssueAgentCard` for the detail pane

### Cost Breakdown Modal (PAN-77, not yet built)

- Click cost badge → modal showing breakdown by stage and model
- `GET /api/costs/issue/:id` returns `byModel` and `byStage` from SQLite
- Requires accurate `session_type` attribution to be meaningful

## Bugs Found and Fixed (2026-03-20)

### 1. record-cost-event.js esbuild bundle broken

The `build:scripts` command in `package.json` used `--format=esm` without the `createRequire` banner. At the time, the cost script depended on a CJS SQLite module that required Node built-ins dynamically, which failed in ESM without the polyfill. The script crashed with `Dynamic require of "fs" is not supported` but the heartbeat hook swallowed the error silently.

**Fix**: Created proper build config (originally esbuild, now `scripts/tsdown.config.ts` with `shims: true`). The cost path now uses the shared SQLite driver adapter.

### 2. Deacon patrolWorkAgentResolutions — getEnabledSpecialists not defined

The PAN-378 per-project specialist refactoring missed updating `patrolWorkAgentResolutions()` in `deacon.ts`. Two other functions (`checkAndSuspendIdleAgents`, `checkStuckWorkAgents`) were correctly updated to use `const isSpecialistSession = (id: string) => id.startsWith('specialist-')` but this one still referenced the removed `getEnabledSpecialists()` import.

**Fix**: Applied same pattern — replaced `getEnabledSpecialists()` call with inline `isSpecialistSession` function.

### 3. Issue ID regex missing prefixes

The heartbeat hook and record-cost-event.ts only matched `pan|min|aud` in git branch/workspace path regexes. `krux` and `cli` prefixed issues were not matched, falling through to `UNKNOWN`.

**Fix**: Updated regexes in both `scripts/heartbeat-hook` and `scripts/record-cost-event.ts` to include `krux|cli`.

## File Inventory

| File | Purpose |
|------|---------|
| `scripts/record-cost-event.ts` | Live recording script source |
| `scripts/record-cost-event.js` | Built bundle (deployed to `~/.panopticon/bin/`) |
| `scripts/tsdown.config.ts` | tsdown config for the recording script |
| `scripts/heartbeat-hook` | Bash hook source (deployed to `~/.panopticon/bin/`) |
| `src/lib/costs/events.ts` | `appendCostEvent()` — triple-write to JSONL, SQLite, WAL |
| `src/lib/costs/migration.ts` | Original one-time migration (preserved, superseded by reconciler) |
| `src/lib/costs/reconciler.ts` | Periodic catch-up sweep (v1 — agent state.json based) |
| `src/lib/costs/sync-wal.ts` | WAL file import from project repos |
| `src/lib/database/cost-events-db.ts` | SQLite cost_events CRUD and aggregation queries |
| `src/lib/database/schema.ts` | Schema definitions and migrations (currently v3) |
| `src/lib/cost.ts` | Pricing tables and cost calculation |
| `src/dashboard/server/index.ts` | API endpoints for `/api/costs/*` and `/api/agents/:id/cost` |
| `src/dashboard/frontend/src/components/KanbanBoard.tsx` | `IssueCard` cost badge rendering |
| `src/dashboard/frontend/src/hooks/useHandoffData.ts` | `useAgentCost()` hook |

## Data Flow Diagram

```
Claude Code Agent (tmux session)
  │
  ├─ writes transcript ──► ~/.claude/projects/<encoded-cwd>/<session>.jsonl
  │                           (source of truth: requestId, model, usage)
  │                           NOTE: <encoded-cwd> is based on WHERE claude was launched,
  │                           NOT on agent state.json. Planning agents started from the
  │                           main project dir write to a DIFFERENT Claude project dir
  │                           than work agents started from a worktree workspace.
  │
  ├─ fires PostToolUse hook
  │     │
  │     ▼
  │   heartbeat-hook (bash)
  │     ├─► runtime.json   (active session_id)
  │     ├─► sessions.json  (append session_id to history)
  │     │
  │     ▼
  │   record-cost-event.js ──► reads NEW bytes from transcript
  │     │                       │
  │     │                       ├─► events.jsonl (append-only log)
  │     │                       ├─► SQLite cost_events (INSERT OR IGNORE on request_id)
  │     │                       └─► per-project WAL (for git sharing)
  │     │
  │     └─► offset file: ~/.panopticon/costs/state/<session>.offset
  │
  └─ (transcript persists after workspace cleanup)

Reconciler (periodic sweep — safety net)
  │
  ├─ scans ~/.claude/projects/ directly (ALL transcript files)
  ├─ builds reverse index from ~/.panopticon/agents/*/sessions.json
  ├─ reads state.json for phase (session_type attribution)
  ├─ infers issue ID from directory path as fallback
  │
  ├─ reads from last known offset per session
  ├─ extracts usage, calculates cost
  └─► SQLite cost_events (INSERT OR IGNORE on request_id — natural dedup)

Dashboard
  │
  ├─ GET /api/costs/by-issue ──► SQLite aggregate query → kanban cost badges
  ├─ GET /api/agents/:id/cost ──► reads transcript JSONL directly → detail pane
  └─ GET /api/costs/issue/:id ──► SQLite per-issue breakdown (PAN-77 modal)
```
