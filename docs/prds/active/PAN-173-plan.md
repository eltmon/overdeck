# PAN-173: TLDR-Code Integration for Token-Efficient Agent Code Analysis

## Problem

Agents read full source files via Claude Code's built-in Read/Grep/Glob tools, consuming 10-25k tokens per file. On a complex implementation task touching 20+ files, agents burn 200-500k tokens just on code reading, exhausting their context window and limiting how much work they can do per session. There is no code summarization or structural analysis layer.

## Solution

Integrate [llm-tldr](https://github.com/parcadei/llm-tldr) — a 5-layer code analysis tool that produces structured summaries (500-1,200 tokens per file instead of 10-25k). Uses its native MCP server (`tldr-mcp`) so Claude Code agents get TLDR tools directly. Persistent daemon on main branch with index sharing to new workspaces.

## Architecture

### Index Sharing Model

```
PROJECT ROOT (main branch)
├── .tldr/                    ← Persistent index, always up-to-date
│   ├── ast/                  ← Layer 1: functions, classes, methods
│   ├── callgraph/            ← Layer 2: function relationships
│   ├── cfg/                  ← Layer 3: control flow
│   ├── dfg/                  ← Layer 4: data flow
│   ├── pdg/                  ← Layer 5: program dependence
│   └── semantic/             ← Embeddings for natural language search
└── .tldrignore               ← Gitignore-compatible exclusion rules

WORKSPACE (git worktree from main)
├── .tldr/                    ← Copied from main at creation time
│   └── (same structure)      ← Workspace daemon handles delta updates
└── .venv/                    ← Isolated Python environment
    └── bin/
        ├── tldr              ← CLI
        └── tldr-mcp          ← MCP server
```

**Flow:**
1. `pan up` → Start main daemon, warm indexes on project root
2. `createWorkspace()` → Copy `.tldr/` from main, create `.venv`, install `llm-tldr`, start workspace daemon
3. Agent spawns → MCP server already configured globally, agents get TLDR tools
4. Agent works → Workspace daemon incrementally updates indexes as files change
5. Merge to main → Notify main daemon to reindex changed files
6. `removeWorkspace()` → Stop workspace daemon, cleanup

### MCP Integration

Global configuration in `~/.claude/settings.json`:
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

The relative path `.` resolves to the current working directory, so it works in both project root and workspace contexts. The `.venv/bin/tldr-mcp` path requires each workspace (and project root) to have a venv with llm-tldr installed.

### Daemon Architecture

```
                 ┌─────────────────────────┐
                 │   Main Daemon (always)   │
                 │   Project root .tldr/    │
                 │   Started by: pan up     │
                 │   Stopped by: pan down   │
                 └─────────────────────────┘
                          │
              ┌───────────┼───────────┐
              ▼           ▼           ▼
    ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
    │ WS Daemon #1 │ │ WS Daemon #2 │ │ WS Daemon #3 │
    │ feature/173  │ │ feature/205  │ │ feature/209  │
    │ Delta updates│ │ Delta updates│ │ Delta updates│
    └──────────────┘ └──────────────┘ └──────────────┘
```

### Agent Workflow Change

**Before (current):**
```
Agent needs to understand auth.ts
→ Read auth.ts (23,000 tokens)
→ Read related imports (50,000 tokens)
→ Total: 73,000 tokens for one subsystem
```

**After (with TLDR):**
```
Agent needs to understand auth.ts
→ tldr context auth.ts (1,200 tokens)
→ Understands structure, dependencies, call graph
→ Only reads specific functions if needed (2,000 tokens)
→ Total: 3,200 tokens — 96% savings
```

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Package | `llm-tldr` (pip) | Native MCP server, 16 languages, 5 analysis layers |
| Primary integration | MCP server (`tldr-mcp`) | Agents get native tools, cleanest DX |
| Daemon lifecycle | Per-workspace + persistent main | Main provides hot indexes, workspaces handle deltas |
| Index strategy | Copy from main at workspace creation | Near-instant TLDR for new workspaces |
| Python dependency | Auto-install in workspace venv | Isolated, no system dependency conflicts |
| MCP scope | Global `~/.claude/settings.json` | All Claude sessions get TLDR, including interactive |
| Definition of done | Full pipeline with dashboard visibility | Agent spawns → uses TLDR → visible token savings |

## Out of Scope

- Custom TLDR analysis layers beyond what llm-tldr provides
- Replacing Claude Code's built-in Read/Grep tools (TLDR supplements, not replaces)
- Automatic "never read full files" enforcement (agents choose when to use TLDR)
- Multi-language semantic search model customization
- TLDR integration for remote workspaces (follow-up issue)

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Python not installed on system | Medium | Detect in `pan setup`, graceful skip if unavailable |
| TLDR daemon crashes | Low | Health checks + auto-restart, agents degrade to direct file reads |
| Index corruption | Low | Re-warm from source, daemon handles recovery |
| MCP server conflicts | Low | Namespace as `tldr`, unique among MCP servers |
| Large repo warm time | Medium | Background warm, workspace creation doesn't block on it |
| Venv creation adds workspace setup time | Low | ~5-10 seconds, parallelizable with other setup steps |

## Files to Modify

### Core Infrastructure
- `src/lib/workspace-manager.ts` — Add venv creation, .tldr/ copy, daemon start/stop
- `src/lib/agents.ts` — Health check TLDR daemon before agent spawn
- `src/cli/commands/setup/hooks.ts` — Add MCP server configuration to setup flow

### New Files
- `src/lib/tldr-daemon.ts` — TldrDaemonService (following Cloister service pattern)
- `src/cli/commands/work/tldr.ts` — `pan tldr status|start|stop|warm` CLI commands
- `scripts/tldr-setup.sh` — Venv creation and llm-tldr installation helper

### Agent Integration
- `src/lib/cloister/prompts/work-agent.md` — Add TLDR usage instructions
- `CLAUDE.md` — Add TLDR guidance for agents

### Dashboard
- `src/dashboard/server/index.ts` — TLDR daemon status endpoints
- `src/dashboard/frontend/src/components/` — TLDR status indicators

### Cloister Integration
- `src/lib/cloister/merge-agent.ts` — Notify main daemon after merge
- `src/lib/cloister/specialists.ts` — Configure TLDR MCP for specialists
