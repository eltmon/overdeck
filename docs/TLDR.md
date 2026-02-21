# TLDR Code Analysis System

Token-efficient code analysis for Panopticon agents. Produces structured summaries at 500-1,200 tokens per file instead of 10-25k for raw reads.

**PRD**: [PAN-173](./prds/completed/PAN-173-plan.md) | **Skill**: `pan-tldr` | **CLI**: `pan tldr`

## Architecture

```
PROJECT ROOT (main branch)
├── .venv/                    Python venv with llm-tldr installed
├── .tldr/                    Persistent index (always up-to-date)
│   ├── cache/
│   │   └── call_graph.json   Function relationships (edges + file refs)
│   └── languages.json        Detected languages + last warm timestamp
└── .tldrignore               Gitignore-syntax exclusion rules

WORKSPACE (git worktree)
├── .venv/                    Workspace-specific venv
├── .tldr/                    Copied from main at creation, then delta-updated
│   ├── cache/
│   │   └── call_graph.json
│   ├── languages.json
│   └── dirty-files           Tracked by post-edit hook
└── .tldrignore
```

### Daemon Model

```
              ┌─────────────────────────┐
              │   Main Daemon           │
              │   Project root .tldr/   │
              │   Started by: pan up    │
              │   Stopped by: pan down  │
              └─────────────────────────┘
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
    ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
    │ WS Daemon    │ │ WS Daemon    │ │ WS Daemon    │
    │ feature/173  │ │ feature/205  │ │ feature/222  │
    │ Delta updates│ │ Delta updates│ │ Delta updates│
    └──────────────┘ └──────────────┘ └──────────────┘
```

Each daemon is a background process managing a TLDR index for its directory. State is stored at `~/.panopticon/tldr/{hash}/daemon.json` where `{hash}` is SHA256 of the workspace path.

## Index Lifecycle

### Build Triggers

| Event | What Happens |
|-------|-------------|
| `pan up` | Starts main daemon |
| `pan workspace create` | Creates venv, copies `.tldr/` from main, starts workspace daemon, triggers background warm |
| Agent spawn | Health-checks workspace daemon, starts it if not running |
| 10 code file edits | Post-edit hook triggers background re-warm |
| `pan work approve` (merge) | Merge-agent calls `notifyTldrDaemon()` to re-warm main |
| `pan tldr warm` | Manual trigger |

### Index Sharing (Copy-on-Create)

When a workspace is created:
1. `workspace-manager.ts` checks for `.tldr/` in the project root (main branch)
2. If found, copies it recursively to the new workspace
3. Paths in the index are **relative** (`src/lib/file.ts`, not absolute), so they remain valid across worktrees
4. Workspace daemon handles incremental updates for changed files

If no main branch index exists, the workspace starts fresh and the background warm builds from scratch.

### Post-Merge Reindex

After the merge-agent merges a feature branch into main:
1. `notifyTldrDaemon()` in `merge-agent.ts` runs `git diff --name-only HEAD~1 HEAD`
2. Filters to source code files only (`.ts`, `.js`, `.py`, etc.)
3. If the main daemon is running, triggers a background warm
4. Main index is updated so future workspace copies are fresh

## Hook Integration

Three Claude Code hooks provide automatic TLDR integration:

### 1. Read Enforcer (`PreToolUse` on `Read`)

**Script**: `scripts/tldr-read-enforcer`

Intercepts file reads and returns TLDR summaries for large code files.

**Bypasses** (allows normal read):
- Files < 3KB
- Reads with `offset` or `limit` (targeted reads for editing)
- Non-code files (.json, .md, .yaml, etc.)
- No `.venv` in the project tree
- TLDR command failure

**Behavior**: Returns a `deny` permission decision with TLDR context as `additionalContext`. Claude sees the summary and can then do a targeted read if it needs exact content.

### 2. Post-Edit Notify (`PostToolUse` on `Edit|Write`)

**Script**: `scripts/tldr-post-edit`

Tracks code file edits in `.tldr/dirty-files`. After 10 edits, triggers a background re-warm to keep the index fresh.

### 3. MCP Server

**Configured in**: `~/.claude/settings.json` (via `pan setup hooks`)

```json
{
  "mcpServers": {
    "tldr": {
      "command": ".venv/bin/tldr-mcp",
      "args": ["--project", "."]
    }
  }
}
```

The relative path `.` resolves to the current working directory, so it works in both project root and workspace contexts.

## CLI Commands

```bash
# Show status of all TLDR daemons
pan tldr status

# Start main daemon
pan tldr start

# Stop main daemon
pan tldr stop

# Warm (rebuild) index — defaults to main, specify workspace for workspace
pan tldr warm
pan tldr warm feature-pan-173
```

### Direct TLDR CLI

```bash
# From any workspace or project root
.venv/bin/tldr context src/lib/agents.ts
.venv/bin/tldr structure src/lib/
.venv/bin/tldr calls src/lib/agents.ts
.venv/bin/tldr impact spawnAgent src/lib/agents.ts
.venv/bin/tldr semantic "agent lifecycle management"
.venv/bin/tldr warm .
```

## Dashboard API

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/services/tldr/status` | GET | All daemon statuses (main + workspaces) |
| `/api/services/tldr/start` | POST | Start main daemon |
| `/api/services/tldr/stop` | POST | Stop main daemon |
| `/api/workspaces/:issueId/tldr` | GET | Per-workspace daemon status |

Response includes: `running`, `pid`, `healthy`, `fileCount`, `edgeCount`, `indexAge`.

## Setup

TLDR is set up automatically during `pan setup hooks` if Python 3 is available:
1. Detects Python 3
2. Configures TLDR MCP server in `~/.claude/settings.json`
3. Registers read-enforcer and post-edit hooks

For existing installations, run `pan sync` to install the new hooks.

### Manual Setup (project root)

```bash
cd /path/to/project
python3 -m venv .venv
.venv/bin/pip install llm-tldr
.venv/bin/tldr warm .
```

### .tldrignore

Gitignore-syntax file controlling what gets indexed. Default excludes: `node_modules/`, `.venv/`, `dist/`, `build/`, `.env`, binary files, IDE files. Customize by adding patterns to the `Project-specific` section.

## Token Savings

| Scenario | Without TLDR | With TLDR | Savings |
|----------|-------------|-----------|---------|
| Understand 1 file | 15,000 tokens | 800 tokens | 95% |
| Explore 20 files | 300,000 tokens | 16,000 tokens | 95% |
| Typical session (explore + edit) | 300,000+ tokens | 61,000 tokens | 80% |

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| No TLDR data in dashboard | Main branch has no `.tldr/` | Run `pan tldr warm` or `.venv/bin/tldr warm .` |
| New workspace has empty index | Main index missing, auto-warm didn't run | Run `.venv/bin/tldr warm .` in the workspace |
| `tldr: command not found` | Not in venv | Use `.venv/bin/tldr` or activate venv |
| Stale index (old file count) | Edits didn't trigger re-warm | `pan tldr warm` or edit 10+ files to trigger auto-warm |
| Daemon not starting | PID file stale | Delete `~/.panopticon/tldr/*/daemon.json` and restart |

## Files

| File | Purpose |
|------|---------|
| `src/lib/tldr-daemon.ts` | TldrDaemonService — daemon lifecycle management |
| `src/cli/commands/work/tldr.ts` | `pan tldr` CLI commands |
| `src/lib/workspace-manager.ts:390-428` | Workspace TLDR setup (venv, copy, daemon, warm) |
| `src/lib/agents.ts` | Pre-spawn daemon health check |
| `src/lib/cloister/merge-agent.ts:209-265` | Post-merge reindex notification |
| `src/cli/commands/setup/hooks.ts` | Hook and MCP server registration |
| `scripts/tldr-read-enforcer` | PreToolUse read interceptor |
| `scripts/tldr-post-edit` | PostToolUse dirty file tracker |
| `src/dashboard/server/index.ts` | Dashboard API endpoints |
| `skills/pan-tldr/SKILL.md` | Agent-facing skill documentation |
