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
- TLDR command failure (graceful degradation)
- Sparse summaries (< 100 tokens for files > 5KB) where both `context` and `extract` produce insufficient content (e.g., test files with `describe`/`it` blocks)

**Behavior**: Returns a `deny` permission decision with TLDR context as `additionalContext`. Claude sees the summary and can then do a targeted read if it needs exact content.

**Fallback chain**:
1. `tldr context <module-path> --lang <language>` — primary (uses call graph, line numbers)
2. If context fails or is sparse → `tldr extract <file-path>` — secondary (works on all file paths including `.tsx`)
3. If extract also returns 0 functions/classes → bypass entirely (allow normal read)

**Import formatting**: Raw JSON from `tldr imports` is formatted into readable `import { ... } from "..."` statements.

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
# context expects MODULE PATHS (no extension) and explicit --lang
.venv/bin/tldr context src/lib/agents --lang typescript
.venv/bin/tldr context src/lib/config --lang typescript

# extract works on FILE PATHS (with extension) — fallback for .tsx
.venv/bin/tldr extract src/dashboard/frontend/src/components/App.tsx

# Other commands
.venv/bin/tldr structure src/lib/
.venv/bin/tldr calls src/lib/agents.ts --lang typescript
.venv/bin/tldr impact spawnAgent src/lib/agents.ts --lang typescript
.venv/bin/tldr imports src/lib/agents.ts --lang typescript
.venv/bin/tldr warm .
```

**Important**: `context` expects module paths WITHOUT extension (e.g., `src/lib/agents` not `src/lib/agents.ts`). Passing a file path with `.ts` silently returns a near-empty "~25 tokens" result. The `--lang` flag defaults to `python` — always pass `--lang typescript` for TypeScript projects.

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

### Full Codebase Analysis (2026-02-21)

Measured across the entire Panopticon CLI codebase (243 code files > 3KB) with llm-tldr v1.5.2 + tsx patch. Token counts approximate (1 token ~ 4 chars).

#### Summary

| Metric | Value |
|--------|-------|
| Code files analyzed | 243 |
| Files intercepted (TLDR summary) | 206 (85%) |
| Files bypassed (full read) | 37 (15%) |
| Tokens without TLDR (intercepted files) | 704,342 |
| Tokens with TLDR (intercepted files) | 82,907 |
| **Tokens saved** | **621,435 (88.2%)** |
| Project-wide savings (including bypassed) | 76.4% |

#### Method Breakdown

| Method | Files | Notes |
|--------|-------|-------|
| `context` (primary) | 174 | Full call graph, line numbers, depth traversal |
| `extract` (fallback) | 32 | For .tsx files and modules not in call graph |
| Bypassed | 37 | Test files (sparse), CLI entry points |

#### Per-File Results (top 15 by savings)

| File | Raw Tokens | TLDR Tokens | Savings | Functions |
|------|------------|-------------|---------|-----------|
| `server/index.ts` | 129,582 | 2,850 | 97.8% | 57 |
| `WorkspacePanel.tsx` | 18,575 | 492 | 97.4% | 10 |
| `KanbanBoard.tsx` | 19,222 | 1,215 | 93.7% | 25 |
| `specialists.ts` | 18,501 | 2,748 | 85.1% | 62 |
| `IssueDetailPanel.tsx` | 13,369 | 366 | 97.3% | 6 |
| `deacon.ts` | 12,227 | 1,162 | 90.5% | 30 |
| `SettingsPage.tsx` | 11,217 | 356 | 96.8% | 6 |
| `workspace.ts` (CLI) | 11,747 | 909 | 92.3% | 14 |
| `merge-agent.ts` | 11,133 | 810 | 92.7% | 14 |
| `workspace-manager.ts` | 7,726 | 813 | 89.5% | 12 |
| `issue-data-service.ts` | 8,133 | 1,224 | 85.0% | 30 |
| `agents.ts` | 7,506 | 1,202 | 84.0% | 28 |
| `cloister/service.ts` | 9,032 | 2,248 | 75.1% | 55 |
| `workspace-migrate.ts` | 8,436 | 844 | 90.0% | 11 |
| `issue.ts` (CLI) | 5,429 | 951 | 82.5% | 12 |

#### Typical Agent Session Impact

| Session Size | Without TLDR | With TLDR | Savings |
|-------------|-------------|-----------|---------|
| Quick task (10 files) | ~34,000 tokens | ~4,000 tokens | 88% |
| Standard task (20 files) | ~68,000 tokens | ~8,000 tokens | 88% |
| Large task (40 files) | ~137,000 tokens | ~16,000 tokens | 88% |

#### Cost Savings

Per full codebase exploration (all 206 intercepted files read once):

| Model | Without TLDR | With TLDR | Saved |
|-------|-------------|-----------|-------|
| Sonnet 4.6 ($3/M input) | $2.11 | $0.25 | **$1.86** |
| Opus 4.6 ($15/M input) | $10.57 | $1.24 | **$9.32** |

For a typical agent session reading 20 files:

| Model | Without TLDR | With TLDR | Saved |
|-------|-------------|-----------|-------|
| Sonnet 4.6 | $0.21 | $0.02 | **$0.18** |
| Opus 4.6 | $1.03 | $0.12 | **$0.90** |

At 10 agent sessions per day, that's **$1.80-$9.00/day** saved on input tokens alone.

### Hook Performance

Hook execution adds 150-330ms per read, negligible relative to API round-trip times (2-10s).

| File Size | Latency |
|-----------|---------|
| 6-10 KB | ~180ms |
| 30 KB | ~220ms |
| 500+ KB | ~330ms |

### Quality Gates

The read-enforcer applies quality gates to prevent useless summaries:

| Condition | Behavior |
|-----------|----------|
| File < 3 KB | Bypass (full read) |
| Non-code file (.json, .md, etc.) | Bypass (full read) |
| Read with offset/limit | Bypass (targeted edit read) |
| No .venv ancestor | Bypass (TLDR not available) |
| Context < 100 tokens for file > 5 KB | Fallback to `extract`, bypass if extract also empty |
| .tsx files | Full support via patched llm-tldr (upstream PR #53 pending) |
| Test files (describe/it blocks, no functions) | Bypass (full read) — tree-sitter can't extract test structure |

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| No TLDR data in dashboard | Main branch has no `.tldr/` | Run `pan tldr warm` or `.venv/bin/tldr warm .` |
| New workspace has empty index | Main index missing, auto-warm didn't run | Run `.venv/bin/tldr warm .` in the workspace |
| `tldr: command not found` | Not in venv | Use `.venv/bin/tldr` or activate venv |
| Stale index (old file count) | Edits didn't trigger re-warm | `pan tldr warm` or edit 10+ files to trigger auto-warm |
| Daemon not starting | PID file stale | Delete `~/.panopticon/tldr/*/daemon.json` and restart |
| `.tsx` files get "Module not found" | Upstream llm-tldr `_get_module_exports()` only checks `.ts` | Fixed by local patch (`scripts/patches/llm-tldr-tsx-support.py`); upstream PR [#53](https://github.com/parcadei/llm-tldr/pull/53) pending |
| Context returns "~25 tokens" | Module path includes file extension | Pass without extension: `src/lib/agents` not `src/lib/agents.ts` |
| Context returns "~25 tokens" | Language defaults to Python | Pass `--lang typescript` explicitly |
| Test files not summarized | tree-sitter doesn't extract `describe`/`it` blocks | By design: sparse summaries bypass to full read |

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
