# Panopticon: Multi-Agent Orchestration for Claude Code

**Issue:** MIN-630
**Related:** MIN-648 (Research & Expanded Architecture), MIN-650 (V2: Advanced Portability), MIN-651 (MYN Migration)
**Status:** Planning - Ready for Weekend Implementation
**Author:** Ed Becker
**Date:** 2026-01-17

---

## Executive Summary

Panopticon is an **opinionated multi-agent orchestration system** for Claude Code. It manages projects, agents, and provides a unified set of skills, commands, and integrations that sync to your Claude Code environment.

### Key Insights

This document synthesizes insights from:

1. **Cursor's Dynamic Context Discovery** - Pull context on demand, reduce token usage by 46.9%
2. **Gastown's Agent Orchestration** - Beads, FPP, hooks, multi-runtime support, health monitoring
3. **GSD-Plus Context Engineering** - Structured state management (STATE.md, WORKSPACE.md, SUMMARY.md)
4. **Current Panopticon Implementation** - What we've already built in MYN infra
5. **Claude Code Skills** - Progressive disclosure, cross-platform compatibility

### Core Insight

**Panopticon should be a context orchestration system, not just an agent monitor.** The real power lies in intelligently managing what context agents have access to, when they get it, and how work state persists across sessions.

### Skills over Molecules

We adopt Claude Code's skills system (Markdown, progressive disclosure) instead of Gastown's molecules (TOML, heavy context). Skills provide better context efficiency and cross-platform support.

### Industry Convergence

The AI coding tool ecosystem has converged on `SKILL.md` format. **Six major tools** now support the same file format:

| Tool | SKILL.md Support | Skill Locations |
|------|------------------|-----------------|
| **Claude Code** | ✅ Native | `~/.claude/skills/`, `.claude/skills/` |
| **Codex** | ✅ Native | `~/.codex/skills/`, `.codex/skills/` |
| **Cursor** | ✅ Native | `~/.cursor/skills/`, `.cursor/skills/`, `.claude/skills/` |
| **Gemini CLI** | ✅ Native | `~/.gemini/skills/`, `.gemini/skills/` |
| **Google Antigravity** | ✅ Native | `~/.gemini/antigravity/skills/`, `.agent/skills/` |
| **Factory, Amp** | ⚠️ AGENTS.md | Project root (legacy format) |

This means **one skill file works everywhere** with no conversion needed for the 5 major tools.

### About the Name

The name "Panopticon" is inspired by *Doctor Who*, where the Panopticon served as the Time Lords' parliament and seat of State on Gallifrey. The Eye of Harmony—the source of all Time Lord power—was kept hidden beneath it. When Gallifrey's suns shone on the Panopticon, the interior glowed turquoise, and its ceiling was so high that clouds formed near it.

The parallels to our project are intentional:

| Doctor Who Panopticon | Our Panopticon |
|----------------------|----------------|
| Time Lords' parliament & central oversight | Agent orchestration & central oversight |
| Eye of Harmony hidden beneath (source of power) | The "eye" watching all agents (source of visibility) |
| Six sides for six Founders of Gallifrey | Multi-runtime support (Claude, Codex, Cursor, Gemini, etc.) |
| Central to Gallifreyan governance | Central to your development workflow |
| Clouds formed near its high ceiling | Runs in the cloud (or locally!) |

The original Greek etymology also applies: "pan" (πᾶν) meaning "all" + "opticon" (ὀπτικόν) meaning "view" = **all-seeing**. Which is exactly what an agent monitoring dashboard should be.

*"The Panopticon had six sides, one for each of the Founders of Gallifrey..."* — PROSE: The Ancestor Cell

---

## Part 1: Architecture Vision

### Core Concept

Panopticon sits **above** individual projects and manages them:

```
┌─────────────────────────────────────────────────────────────────┐
│                      PANOPTICON                                  │
│  (orchestration layer - skills, commands, agents, dashboard)     │
└─────────────────────────────────────────────────────────────────┘
         │              │              │              │
         ▼              ▼              ▼              ▼
    ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐
    │   MYN   │   │Panopticon│   │Househunt│   │ Auricle │
    │(project)│   │ (itself) │   │(project)│   │(project)│
    └─────────┘   └─────────┘   └─────────┘   └─────────┘
```

### Unified Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      PANOPTICON v2.0                             │
│           Context-Aware Multi-Agent Orchestration                │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    CONTEXT LAYER                                 │
├─────────────────────────────────────────────────────────────────┤
│  Dynamic Discovery │ Budget Manager │ Skill Index │ MCP Cache   │
│  ─────────────────────────────────────────────────────────────  │
│  - Materialize tool outputs                                     │
│  - Queryable history files                                      │
│  - On-demand skill loading                                      │
│  - MCP tool discovery                                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  ORCHESTRATION LAYER                             │
├─────────────────────────────────────────────────────────────────┤
│    Linear Sync   │   Runtime Manager   │   Health Monitor       │
│  ─────────────────────────────────────────────────────────────  │
│  - Issue → Workspace mapping                                    │
│  - Multi-runtime support (Claude, Codex, Cursor, Gemini, etc.)  │
│  - Stuck detection + auto-recovery                              │
│  - A/B testing framework                                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   PERSISTENCE LAYER (Beads)                      │
├─────────────────────────────────────────────────────────────────┤
│   Hooks   │   Skills Index │   Agent CVs   │   Activity Feed    │
│  ─────────────────────────────────────────────────────────────  │
│  - FPP: "Work on hook = MUST run"                               │
│  - Skills loaded on-demand (progressive disclosure)             │
│  - Agent performance history                                    │
│  - Real-time work tracking                                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  WORKSPACE LAYER                                 │
├─────────────────────────────────────────────────────────────────┤
│   Docker Containers   │   Git Worktrees   │   Context Files     │
│  ─────────────────────────────────────────────────────────────  │
│  - Isolated per feature branch                                  │
│  - STATE.md, WORKSPACE.md, SUMMARY.md                           │
│  - Auto-provisioned from templates                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   DASHBOARD LAYER                                │
├─────────────────────────────────────────────────────────────────┤
│  Kanban  │  Terminal View  │  Health  │  Metrics  │  Skills     │
│  ─────────────────────────────────────────────────────────────  │
│  - Issue status overview                                        │
│  - Live agent terminal                                          │
│  - Health status indicators                                     │
│  - Performance metrics + runtime comparison                     │
│  - Skill browser + `pan sync` management                        │
└─────────────────────────────────────────────────────────────────┘
```

### The Mayor Architecture: Dual-Interface Design

Panopticon provides **two first-class interfaces** to the same underlying system:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        INTERFACE OPTIONS                                 │
│                                                                          │
│   Option A: CLI-Only                Option B: AI Co-Mayor                │
│   ─────────────────────             ───────────────────────              │
│                                                                          │
│   $ pan work issue MIN-648          Human + Claude Code in project root  │
│   $ pan status                      /work-issue MIN-648                  │
│   $ pan workspace list              /pan:status                          │
│                                                                          │
│   Good for:                         Good for:                            │
│   • Automation/scripting            • Interactive guidance               │
│   • CI/CD pipelines                 • Quick fire-fighting                │
│   • Terminal purists                • Context-aware suggestions          │
│   • When AI isn't running           • Small tasks without spawning agents│
│                                                                          │
│   Both interfaces call the same underlying Panopticon APIs               │
└─────────────────────────────────────────────────────────────────────────┘
```

#### The Mayor Concept (from Gastown)

In Gastown, the **Mayor** is the orchestration entity that dispatches work. In Panopticon:

- **The Mayor** = Human + AI tool (Claude Code, Codex, Gemini CLI, etc.) running in the project root
- **The Agents** = AI instances running in isolated workspaces on specific issues

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         MAYOR LAYER                                      │
│                   /home/user/projects/myproject/                         │
│                                                                          │
│   Human ◄──────► Claude Code (or Codex, Gemini CLI, etc.)               │
│                       │                                                  │
│   "Co-Mayors" who:    ├── CLAUDE.md        ← pan sync'd                 │
│   • Plan work         ├── .claude/skills/  ← pan sync'd (ALL skills)    │
│   • Dispatch agents   ├── .claude/commands/← pan sync'd (/work-issue)   │
│   • Monitor progress  │                                                  │
│   • Put out fires     │   /work-issue MIN-648                           │
│   • Make decisions    │   /pan:status                                    │
│                       │   /work-approve MIN-648                          │
└───────────────────────┼─────────────────────────────────────────────────┘
                        │
                        │ Spawns agents via tmux
                        ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         AGENT LAYER                                      │
│                                                                          │
│   workspaces/feature-min-648/       workspaces/feature-min-649/         │
│   ├── CLAUDE.md (workspace-specific)├── CLAUDE.md                       │
│   ├── .claude/skills/ (symlinks)    ├── .claude/skills/                 │
│   ├── fe/                           ├── fe/                             │
│   └── api/                          └── api/                            │
│                                                                          │
│   Agents:                                                                │
│   • Work autonomously on Linear issues                                   │
│   • Have workspace-specific context                                      │
│   • Report back via Beads                                                │
│   • Can be monitored/messaged by Mayor                                   │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Why AI Co-Mayor is Powerful

| Scenario | CLI-Only | AI Co-Mayor |
|----------|----------|-------------|
| Agent reports error | Read logs, debug manually | "What went wrong?" → AI analyzes, suggests fix |
| Quick 2-line fix | Spawn agent (overkill) | Mayor does it directly, no agent needed |
| Planning complex work | Write plan manually | Discuss with AI, iterate, then dispatch |
| Prioritization | Check Linear manually | "What should I work on?" → AI considers context |
| Fire-fighting | Read errors, fix manually | AI helps diagnose, you approve fixes |

#### What `pan sync` Syncs

```
~/.panopticon/
├── skills/           # Comprehensive skill library (Gastown molecules + more)
├── commands/         # All commands (/work-issue, /pan:*, etc.)
└── templates/

        │
        │ pan sync
        ▼

┌─────────────────────────────────────────────────────────────────────────┐
│  GLOBAL (for any AI tool session)                                        │
│  ~/.claude/skills/      ← Claude Code                                    │
│  ~/.claude/commands/    ← Claude Code commands                           │
│  ~/.codex/skills/       ← Codex                                          │
│  ~/.gemini/skills/      ← Gemini CLI                                     │
│  ~/.gemini/antigravity/skills/ ← Antigravity                            │
├─────────────────────────────────────────────────────────────────────────┤
│  PROJECT ROOT (the Mayor's workspace)                                    │
│  ${PROJECT_ROOT}/.claude/skills/    ← Mayor's skills                     │
│  ${PROJECT_ROOT}/.claude/commands/  ← Mayor's commands                   │
│  ${PROJECT_ROOT}/CLAUDE.md          ← Mayor's context                    │
├─────────────────────────────────────────────────────────────────────────┤
│  AGENT WORKSPACES                                                        │
│  workspaces/feature-*/. claude/skills/   ← Symlinks                      │
│  workspaces/feature-*/CLAUDE.md          ← Workspace-specific            │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Panopticon Ships Batteries-Included

Unlike minimal tools that ship empty, Panopticon ships with a **comprehensive** library:

**Skills (converted from Gastown molecules + new):**

| Category | Skills |
|----------|--------|
| **Workflow** | feature-work, bug-fix, code-review, release, hotfix |
| **Code Quality** | testing-patterns, refactoring, security-review, performance |
| **Languages** | typescript-patterns, java-spring, python-patterns, go-patterns |
| **Frameworks** | react-best-practices, next-patterns, spring-boot, fastapi |
| **Infrastructure** | docker-patterns, kubernetes, ci-cd, monitoring |
| **AI/LLM** | prompt-engineering, agent-patterns, context-management |
| **Project-Specific** | (projects add their own, like MYN's myn-coding-standards) |

**Commands:**

| Command | Description |
|---------|-------------|
| `/work-issue <id>` | Create workspace and spawn agent for Linear issue |
| `/work-plan <id>` | Create detailed execution plan before spawning |
| `/work-status` | Show all running agents and their status |
| `/work-approve <id>` | Approve agent work, merge MR, update Linear |
| `/work-tell <id> <msg>` | Send message to running agent |
| `/pan:up` | Start Panopticon dashboard and services |
| `/pan:down` | Stop dashboard and optionally agents |
| `/pan:sync` | Sync skills/commands to all targets |
| `/pan:health` | Show health of all agents |

**Multi-Runtime Support:**

Commands are Claude Code specific (slash commands), but the **underlying operations** work from CLI too:

```bash
# CLI equivalent of /work-issue MIN-648
pan work issue MIN-648

# CLI equivalent of /work-status
pan status

# CLI equivalent of /pan:sync
pan sync
```

This means:
- Humans who prefer CLI get full functionality
- AI co-mayors get the same functionality via commands
- Automation/CI can use CLI
- It's the same system, two interfaces

### Success Metrics

1. **Single source of truth** - All agent tooling in `~/.panopticon/`
2. **Zero friction sync** - `pan sync` updates Claude Code instantly
3. **Project isolation** - Each project has its own workspaces/agents
4. **Crash recovery** - Beads tracks state, agents can resume
5. **Multi-project** - Switch between projects seamlessly
6. **Cross-platform skills** - One SKILL.md works in Claude, Codex, Cursor

---

## Part 2: Dynamic Context Discovery

### The Cursor Insight

Cursor's blog post reveals a fundamental shift in AI context management:

> "Rather than loading all potential information upfront, the system enables agents to pull relevant context on its own."

This reduces token usage by **46.9%** in their A/B testing.

### Five Patterns to Adopt

#### 1. Tool Response Materialization

**Current State:** Tool outputs are returned inline, consuming context window.

**Proposed:** Write tool responses to files. Agents use `tail`/`grep` to discover needed portions.

```typescript
// Before
const output = await runCommand("npm test");
return output; // Full 10KB output in context

// After
const outputFile = await runCommand("npm test", { materialize: true });
return `Output written to ${outputFile}. Use tail/grep to inspect.`;
```

**Panopticon Implementation:**
- Add `--materialize` flag to workspace operations
- Dashboard shows "materialized outputs" with file browser
- Agents learn to use grep/tail for discovery

#### 2. Chat History as Queryable Files

**The Problem:** Agent context fills up. Summarization loses detail.

**The Solution:** Write conversation history to searchable files.

```
~/.panopticon/history/
├── sessions/
│   ├── 2026-01-17-min-648/
│   │   ├── transcript.md      # Full conversation
│   │   ├── decisions.md       # Extracted decisions
│   │   └── artifacts.md       # Code/files created
│   └── 2026-01-16-min-630/
│       └── ...
└── index.md                   # Search index
```

Agents can `grep` their own history to recover context after compaction.

#### 3. Skills as Discoverable Definitions

**Current State:** Skills in `~/.claude/skills/` are loaded by name.

**Proposed:** Index skill metadata separately from definitions.

```
~/.panopticon/skills/
├── index.json               # Names + descriptions only
├── definitions/             # Full skill definitions
│   ├── beads-tracking.md
│   ├── linear-cli.md
│   └── ...
└── capabilities.json        # Skill-to-capability mapping
```

Agents receive only the index. When they need a skill, they `grep` for its definition.

#### 4. MCP Tool Discovery

**The Opportunity:** Tool descriptions consume significant context.

**Proposed:** Sync MCP tool descriptions to filesystem.

```
~/.panopticon/mcp/
├── servers/
│   ├── linear/
│   │   ├── tools.json       # Tool names + short descriptions
│   │   └── schemas/         # Full schemas (loaded on demand)
│   ├── playwright/
│   │   └── ...
│   └── sentry/
│       └── ...
└── status.json              # Auth status per server
```

Benefits:
- Proactive auth status notifications
- Reduced baseline context
- Searchable tool discovery

#### 5. Terminal Output Integration

**Current State:** Agents receive full terminal output inline.

**Proposed:** Sync terminal sessions to filesystem.

```
~/.panopticon/terminals/
├── agent-min-648/
│   ├── output.log           # Full session log
│   ├── recent.log           # Last 100 lines (rotated)
│   └── errors.log           # Filtered errors
└── agent-min-630/
    └── ...
```

Dashboard already captures this. Add agent-accessible paths.

### Context Budget Manager

New Panopticon component: **Context Budget Manager**

```typescript
interface ContextBudget {
  total: number;           // e.g., 200K tokens
  used: number;            // Current usage
  reserved: {
    systemPrompt: number;  // ~10K
    skills: number;        // Variable
    history: number;       // Growing
    workState: number;     // From Beads
  };
  available: number;       // For actual work
}

// Budget-aware context loading
function loadContext(agent: Agent, budget: ContextBudget): Context {
  const ctx = new Context();

  // Always load (reserved)
  ctx.add(systemPrompt);
  ctx.add(activeSkillIndex);  // Not full definitions

  // Conditional loading
  if (budget.available > 50000) {
    ctx.add(fullHistory);
  } else {
    ctx.add(summarizedHistory);
    ctx.addDiscoveryHint("Full history at ~/.panopticon/history/...");
  }

  // Work state (always critical)
  ctx.add(beadsState);

  return ctx;
}
```

---

## Part 3: Beads Deep Integration

### Beyond Issue Tracking

Gastown shows that Beads isn't just an issue tracker - it's the **persistent memory layer** for multi-agent systems.

### The FPP Principle (Fixed Point Principle)

> "Any runnable action is a fixed point and must resolve before the system can rest."
>
> *Inspired by Doctor Who: a fixed point in time must occur — it cannot be avoided.*

This transforms agents from passive responders to **self-propelling workers**:

```
┌─────────────────────────────────────────────────────────────────┐
│                     FPP FLOW                                     │
└─────────────────────────────────────────────────────────────────┘

1. Agent starts → Checks hook (bd hook check)
2. Work found  → Execute immediately (no confirmation)
3. Work done   → Close bead, check for more work
4. No work     → Enter idle/patrol mode
5. New work arrives → Hook notified → FPP triggers
```

### Hooks as Primary Interface

Every Panopticon agent gets a **hook** - a persistent work queue backed by Beads:

```bash
# Hook structure
~/.panopticon/agents/
├── min-648/
│   ├── hook.json            # Active work item
│   ├── mail/                # Incoming messages
│   └── state.json           # Agent state (crash recovery)
└── min-630/
    └── ...

# Hook workflow
bd hook check min-648        # Returns current work item
bd hook complete min-648     # Marks work done, returns next
bd hook assign min-648 beads-xyz  # Assigns specific issue
```

### Agent Attribution

Every action tracked to the agent that performed it:

```json
{
  "id": "beads-abc",
  "title": "Implement login flow",
  "created_by": "panopticon/agent-min-648",
  "assignee": "panopticon/agent-min-648",
  "commits": [
    {
      "sha": "abc123",
      "author": "panopticon/agent-min-648 <noreply@panopticon.local>",
      "message": "feat: add login endpoint"
    }
  ],
  "events": [
    { "type": "status_change", "actor": "panopticon/agent-min-648", "from": "open", "to": "in_progress" }
  ]
}
```

### Agent CVs (Work History)

Track agent performance over time:

```bash
bd stats --actor=panopticon/agent-min-648

Agent: panopticon/agent-min-648
─────────────────────────────
Issues completed: 47
Success rate:     94%
Avg time/issue:   23 min
Top capabilities: typescript (28), react (19), testing (15)

Recent work:
  ✓ beads-xyz  "Add logout button"     12 min
  ✓ beads-def  "Fix auth redirect"     8 min
  ✗ beads-ghi  "Implement SSO"         [failed: timeout]
```

This enables **capability-based routing** - assign work to agents with proven track records.

### Crash Recovery

Beads persists state that survives agent crashes:

```typescript
interface AgentState {
  id: string;
  currentWork: BeadID | null;
  checkpoint: {
    step: string;          // "running tests"
    progress: number;      // 0.75
    files_modified: string[];
    uncommitted_changes: boolean;
  };
  lastActivity: Date;
}

// On agent restart
async function recoverAgent(agentId: string) {
  const state = await bd.getAgentState(agentId);

  if (state.currentWork) {
    // Resume from checkpoint
    const bead = await bd.get(state.currentWork);
    console.log(`Resuming: ${bead.title} at step "${state.checkpoint.step}"`);

    // Check for uncommitted changes
    if (state.checkpoint.uncommitted_changes) {
      console.log("Warning: uncommitted changes found");
      // Agent can decide to commit or discard
    }
  }
}
```

### Beads Flow with Panopticon

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Linear      │────▶│  Panopticon  │────▶│    Beads     │
│  (issues)    │     │ (orchestrate)│     │  (tracking)  │
└──────────────┘     └──────────────┘     └──────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │   Agents     │
                     │  (execute)   │
                     └──────────────┘
```

1. **Issue Created in Linear** → Panopticon sees it via API/CLI
2. **Agent Spawned** → Panopticon creates Bead for tracking
3. **Agent Works** → Progress logged to Bead via `bd notes add`
4. **Agent Completes** → Bead closed, MR link attached
5. **Work Approved** → Bead marked as merged

---

## Part 4: Skills-Based Workflow System

### Why Skills Over Molecules?

Gastown's molecule system (TOML-based workflow templates) was designed **before agent skills existed**. Skills were introduced to Claude Code in **October 2025** and became an **open standard in December 2025**.

**Key insight:** Skills provide the same benefits as molecules with significant advantages:

| Aspect | Molecules (Gastown) | Skills (Panopticon) |
|--------|---------------------|---------------------|
| Context usage | Heavy (full TOML loaded) | Light (progressive disclosure) |
| Cross-platform | No (`gt` CLI specific) | Yes (Claude, Cursor, Codex) |
| When loaded | All at once when cooked | On-demand when matched |
| Step tracking | Built into molecule | Use Beads separately |
| Format | TOML | Markdown (universal) |

### The Industry Skill Standards

**Great news: The industry has converged on `SKILL.md` format!**

| Tool | Format | Skill Locations | Notes |
|------|--------|-----------------|-------|
| **Claude Code** | `SKILL.md` | `~/.claude/skills/`, `.claude/skills/` | Original format |
| **Codex** | `SKILL.md` | `~/.codex/skills/`, `.codex/skills/` | Adopted SKILL.md |
| **Cursor** | `SKILL.md` | `~/.cursor/skills/`, `.cursor/skills/`, **`~/.claude/skills/`**, **`.claude/skills/`** | **Also discovers from Claude locations!** |
| **Factory, Amp** | `AGENTS.md` | Project root | Legacy format (single file) |

**Key insight:** Cursor explicitly discovers skills from `.claude/skills/` directories, and Gemini CLI/Antigravity share similar conventions. This means **a single SKILL.md file works across all five major tools** with simple symlinks to each tool's expected location.

### SKILL.md Common Format

All five major tools use the same core format:

```yaml
---
name: feature-work
description: Guide for implementing new features with proper testing
---

# Feature Work

Instructions in markdown...
```

| Field | Claude Code | Codex | Cursor | Gemini CLI | Antigravity |
|-------|-------------|-------|--------|------------|-------------|
| `name` | Required (64 chars max) | Required (100 chars max) | Optional (uses folder name) | Required | Required |
| `description` | Required (1024 chars) | Required (500 chars) | Required | Required | Required |
| Extra fields | `allowed-tools`, `context`, `hooks` | Ignored | Ignored | Ignored | Ignored |

**For maximum compatibility:** Use `name` + `description` only, keep description ≤500 chars (Codex limit).

### The Panopticon Skills Model

```
┌─────────────────────────────────────────────────────────────────┐
│                 PANOPTICON SKILLS ARCHITECTURE                   │
│              (Unified Format - Works Everywhere!)                │
└─────────────────────────────────────────────────────────────────┘

~/.panopticon/skills/              # Canonical skill source (master)
├── feature-work/
│   └── SKILL.md                   # How to implement features
├── bug-fix/
│   └── SKILL.md                   # How to investigate/fix bugs
├── code-review/
│   └── SKILL.md                   # How to review code
└── release/
    └── SKILL.md                   # How to do releases

         │
         │  pan sync (symlinks to all tool locations)
         ▼

~/.claude/skills/                  # Claude Code, Cursor (also reads from here)
~/.codex/skills/                   # Codex
~/.gemini/skills/                  # Gemini CLI
~/.gemini/antigravity/skills/      # Google Antigravity
├── feature-work → ~/.panopticon/skills/feature-work
├── bug-fix → ~/.panopticon/skills/bug-fix
├── code-review → ~/.panopticon/skills/code-review
└── release → ~/.panopticon/skills/release

         │
         │  Auto-discovered by ALL FIVE tools!
         ▼

┌────────────────┬────────────────┬────────────────┬────────────────┬────────────────┐
│  Claude Code   │     Codex      │     Cursor     │  Gemini CLI    │  Antigravity   │
│   (native)     │  (SKILL.md)    │ (reads .claude)│  (SKILL.md)    │  (SKILL.md)    │
│      ✅        │      ✅        │      ✅        │      ✅        │      ✅        │
└────────────────┴────────────────┴────────────────┴────────────────┴────────────────┘

Agent workspaces also get skills:
├── workspaces/feature-min-648/.claude/skills/
│   └── (symlinks to ~/.panopticon/skills/*)
└── workspaces/feature-min-649/.claude/skills/
    └── (same structure)
```

### Separation of Concerns

**Skills = Knowledge** ("How to do X")
**Beads = State** ("Track progress on X")

```bash
# Skills tell the agent HOW to work
~/.panopticon/skills/feature-work/SKILL.md

# Beads track WHAT work is done
bd create "MIN-648: Understand requirements" --type task
bd create "MIN-648: Design approach" --depends-on "MIN-648: Understand"
bd create "MIN-648: Implement" --depends-on "MIN-648: Design"
bd create "MIN-648: Test" --depends-on "MIN-648: Implement"
bd create "MIN-648: Review" --depends-on "MIN-648: Test"
bd create "MIN-648: Submit" --depends-on "MIN-648: Review"

# Agent workflow
bd ready                           # Returns "Understand" (no blockers)
# Agent reads feature-work skill, does the work
bd close "MIN-648: Understand" --reason "Requirements clear from PRD"

bd ready                           # Returns "Design" (now unblocked)
# ... continues through workflow
```

### Skill Progressive Disclosure

Skills only load when **relevant to the current task**, reducing context usage:

```
┌─────────────────────────────────────────────────────────────────┐
│              PROGRESSIVE SKILL LOADING                           │
└─────────────────────────────────────────────────────────────────┘

Agent starts with:
├── CLAUDE.md (always loaded, ~2K tokens)
└── Skill index (names + descriptions only, ~500 tokens)

When agent encounters "implement a feature":
├── Skill matcher detects relevance
└── feature-work/SKILL.md loaded on-demand (~1K tokens)

When agent encounters "review code":
├── Previous skill may be unloaded
└── code-review/SKILL.md loaded on-demand

Result: Only relevant skills in context at any time
```

### `pan sync` - Skill Distribution

Thanks to format convergence, `pan sync` is beautifully simple:

```bash
# Update all agent workspaces with latest skills
pan sync

# What it does:
# 1. Reads ~/.panopticon/skills/
# 2. Creates/updates symlinks to all tool locations:
#    - ~/.claude/skills/           (Claude Code + Cursor)
#    - ~/.codex/skills/            (Codex)
#    - ~/.gemini/skills/           (Gemini CLI)
#    - ~/.gemini/antigravity/skills/ (Antigravity)
# 3. For each active workspace:
#    - Creates .claude/skills/ symlinks
# 4. Notifies running agents of updates
#
# That's it! No format conversion needed.
# All 5 major tools read SKILL.md from their respective locations

# Selective sync
pan sync --workspace min-648       # Single workspace
pan sync --skill feature-work      # Single skill to all

# For legacy tools (Factory, Amp) that need AGENTS.md
pan sync --format agents-md        # Generate AGENTS.md from skills
```

### Why Symlinks?

Symlinks provide instant propagation without copying:

```bash
# Edit a skill in the canonical location
vim ~/.panopticon/skills/feature-work/SKILL.md

# All agents immediately see the update (no sync needed!)
# Because .claude/skills/feature-work → ~/.panopticon/skills/feature-work
```

### Skill Interoperability

**The industry has converged!** One SKILL.md works across all major tools:

```
┌─────────────────────────────────────────────────────────────────┐
│           UNIFIED SKILL FORMAT - NO CONVERSION NEEDED            │
└─────────────────────────────────────────────────────────────────┘

Panopticon Canonical Source:
~/.panopticon/skills/feature-work/SKILL.md

        │
        │ pan sync (symlinks to all tool locations!)
        ▼

~/.claude/skills/feature-work/      (symlink) → Claude Code + Cursor
~/.codex/skills/feature-work/       (symlink) → Codex
~/.gemini/skills/feature-work/      (symlink) → Gemini CLI
~/.gemini/antigravity/skills/feature-work/ (symlink) → Antigravity

        │
        │ Auto-discovered by all five!
        ▼

┌──────────────────────────────────────────────────────────────────────────────────┐
│ Claude Code │   Codex   │   Cursor   │ Gemini CLI │  Antigravity                 │
│ ✅ Native   │ ✅ Native │ ✅ Native  │ ✅ Native  │  ✅ Native                   │
│ ~/.claude/  │ ~/.codex/ │ ~/.cursor/ │ ~/.gemini/ │  ~/.gemini/antigravity/      │
│ skills/     │ skills/   │ skills/ OR │ skills/    │  skills/                     │
│             │           │ ~/.claude/ │            │                              │
└──────────────────────────────────────────────────────────────────────────────────┘

Legacy tools (Factory, Amp, Jules) - optional generation:
        │
        │ pan sync --format agents-md
        ▼
project/AGENTS.md (concatenated skills)
```

### Parallel Agent Execution (Convoys via Skills)

For parallel work (like multi-perspective code review), spawn multiple agents with different skills:

```bash
# Parallel code review - spawn 4 agents with different focus skills
pan convoy start code-review --issue MIN-648

# Creates:
# - agent-min-648-correctness (uses code-review-correctness skill)
# - agent-min-648-security (uses code-review-security skill)
# - agent-min-648-performance (uses code-review-performance skill)
# - agent-min-648-synthesis (waits for others, combines findings)
```

The **skill** determines focus. The **beads** track completion. The **convoy orchestrator** manages parallel execution.

### 10 High-Value Skills

These skills cover the most common agent workflows:

#### 1. `feature-work` - Standard Feature Development

```markdown
---
name: feature-work
description: Guide for implementing new features with proper testing and review
---

# Feature Work Skill

When implementing a new feature:

## 1. Understand Requirements
- Read the Linear issue thoroughly
- Check for associated PRD in `docs/prds/`
- Identify acceptance criteria
- Clarify ambiguities before coding

## 2. Design Approach
- Identify files that need changes
- Consider existing patterns in the codebase
- Plan the implementation (don't gold-plate)

## 3. Implement
- Follow existing code conventions
- Make atomic, focused commits
- Keep changes scoped to the issue
- Commit message format: `feat: description (MIN-XXX)`

## 4. Test
- Add tests for new functionality
- Run full test suite: `npm test`
- All tests must pass before proceeding

## 5. Self-Review
- Review your diff: `git diff origin/main...HEAD`
- Check for: bugs, security issues, style, cruft
- Fix issues found (don't just note them)

## 6. Submit
- Push branch: `git push -u origin $(git branch --show-current)`
- Create MR with clear description
```

#### 2. `bug-fix` - Bug Investigation and Fix

```markdown
---
name: bug-fix
description: Systematic approach to investigating and fixing bugs with regression tests
---

# Bug Fix Skill

When fixing a bug:

## 1. Reproduce
- Confirm the bug exists
- Document exact reproduction steps
- Identify affected code paths

## 2. Investigate Root Cause
- Use debugger or logging to trace execution
- Don't just fix symptoms - find the root cause
- Check for similar bugs elsewhere

## 3. Implement Fix
- Make minimal, focused changes
- Don't refactor unrelated code
- Commit: `fix: description (MIN-XXX)`

## 4. Add Regression Test
- Write a test that would have caught this bug
- Test should fail without the fix, pass with it

## 5. Verify
- Run full test suite
- Manually verify the fix
- Check for unintended side effects
```

#### 3. `code-review` - Code Review Focus Areas

```markdown
---
name: code-review
description: Comprehensive code review covering correctness, security, and performance
---

# Code Review Skill

When reviewing code, examine these areas:

## Correctness
- Logic errors, off-by-one, null handling
- Edge cases and boundary conditions
- Race conditions in concurrent code

## Security
- Input validation gaps
- Injection vulnerabilities (SQL, XSS, command)
- Authentication/authorization bypasses
- Sensitive data exposure

## Performance
- O(n²) where O(n) is possible
- N+1 query patterns
- Unnecessary allocations in hot paths
- Missing caching opportunities

## Design
- Clear abstractions and naming
- Single responsibility principle
- Appropriate coupling/cohesion

## Output Format
Provide findings as:
- **P0 (Critical)**: Must fix before merge
- **P1 (Major)**: Should fix before merge
- **P2 (Minor)**: Nice to fix
- **Observations**: Non-blocking notes
```

#### 4. `code-review-security` - Security-Focused Review

```markdown
---
name: code-review-security
description: Deep security analysis focusing on OWASP Top 10 and common vulnerabilities
---

# Security Review Skill

Deep security analysis focus:

## OWASP Top 10 Checklist
- [ ] Injection (SQL, NoSQL, OS, LDAP)
- [ ] Broken Authentication
- [ ] Sensitive Data Exposure
- [ ] XML External Entities (XXE)
- [ ] Broken Access Control
- [ ] Security Misconfiguration
- [ ] Cross-Site Scripting (XSS)
- [ ] Insecure Deserialization
- [ ] Using Components with Known Vulnerabilities
- [ ] Insufficient Logging & Monitoring

## Additional Checks
- Hardcoded secrets or credentials
- Path traversal vulnerabilities
- SSRF (Server-Side Request Forgery)
- Cryptographic weaknesses
- Rate limiting gaps

## Output
For each finding:
- Severity: Critical/High/Medium/Low
- Location: file:line
- Description: What's wrong
- Impact: What could happen
- Remediation: How to fix
```

#### 5. `code-review-performance` - Performance-Focused Review

```markdown
---
name: code-review-performance
description: Deep performance analysis focusing on algorithms, database patterns, and resources
---

# Performance Review Skill

Deep performance analysis focus:

## Algorithm Complexity
- Identify O(n²) or worse algorithms
- Look for unnecessary iterations
- Check for opportunities to use better data structures

## Database/API Patterns
- N+1 query detection
- Missing indexes (check query patterns)
- Unbounded queries (missing LIMIT)
- Connection pool exhaustion risks

## Memory & Resources
- Memory leaks (unclosed resources)
- Unbounded caches or buffers
- Large object allocations in loops

## Concurrency
- Lock contention hotspots
- Blocking operations in async contexts
- Thread pool exhaustion

## Output
For each finding:
- Impact: High/Medium/Low
- Scale factor: "At 10x load, this will..."
- Location: file:line
- Suggested optimization
```

#### 6. `refactor` - Safe Refactoring

```markdown
---
name: refactor
description: Safe refactoring approach with test coverage and incremental changes
---

# Refactoring Skill

When refactoring code:

## Before Starting
1. Ensure tests exist for code being refactored
2. Run tests to establish baseline (must pass)
3. If test coverage is low, add tests FIRST

## During Refactoring
- Make one type of change at a time
- Keep tests green after each change
- Commit frequently with clear messages

## Refactoring Types
- **Extract**: Pull code into new function/class
- **Inline**: Remove unnecessary indirection
- **Rename**: Improve naming clarity
- **Move**: Relocate to better home
- **Simplify**: Reduce complexity

## After Refactoring
- All tests must still pass
- Behavior must be unchanged
- Review diff for unintended changes
```

#### 7. `release` - Release Process

```markdown
---
name: release
description: Step-by-step release process with versioning and verification
---

# Release Skill

When preparing a release:

## 1. Version Bump
- Update version in package.json / pom.xml / etc.
- Update CHANGELOG.md with new version section
- Commit: `chore: bump version to X.Y.Z`

## 2. Final Verification
- Run full test suite
- Run build process
- Smoke test critical paths

## 3. Create Release
- Tag: `git tag -a vX.Y.Z -m "Release X.Y.Z"`
- Push: `git push origin main --tags`

## 4. Post-Release
- Verify deployment (if auto-deploy)
- Monitor for issues
- Announce if needed
```

#### 8. `incident-response` - Production Incident

```markdown
---
name: incident-response
description: Structured approach to production incidents with mitigation and postmortem
---

# Incident Response Skill

When responding to a production incident:

## 1. Assess (First 5 minutes)
- What is the impact? (users affected, severity)
- What is the blast radius? (which services/regions)
- Is it getting worse or stable?

## 2. Mitigate (Stop the bleeding)
- Can we rollback?
- Can we feature-flag it off?
- Can we scale/redirect traffic?
- Communicate status to stakeholders

## 3. Investigate (Once stable)
- Gather logs, metrics, traces
- Identify root cause
- Document timeline of events

## 4. Fix
- Implement permanent fix
- Test thoroughly before deploying
- Deploy with extra monitoring

## 5. Postmortem
- Document: What happened, why, how we fixed it
- Identify: What would have prevented this
- Action items: Concrete improvements
```

#### 9. `dependency-update` - Safe Dependency Updates

```markdown
---
name: dependency-update
description: Safe approach to updating dependencies with audit and verification
---

# Dependency Update Skill

When updating dependencies:

## 1. Audit Current State
```bash
npm outdated          # See what's outdated
npm audit             # Check for vulnerabilities
```

## 2. Update Strategy
- **Patch versions**: Usually safe, batch update
- **Minor versions**: Update one at a time, test
- **Major versions**: Update individually, read changelog

## 3. For Each Update
```bash
npm install package@version
npm test
# If tests pass, commit
# If tests fail, investigate or rollback
```

## 4. Verify
- Run full test suite
- Smoke test critical paths
- Check bundle size (for frontend)
```

#### 10. `onboard-codebase` - Understanding New Code

```markdown
---
name: onboard-codebase
description: Systematic approach to understanding and documenting a new codebase
---

# Codebase Onboarding Skill

When understanding a new codebase:

## 1. High-Level Structure
- Read README.md
- Map directory structure
- Identify main entry points

## 2. Tech Stack
- What languages/frameworks?
- What build tools?
- What testing frameworks?
- What CI/CD?

## 3. Architecture Patterns
- How is code organized? (layers, modules, services)
- How does data flow?
- What are the key abstractions?

## 4. Development Workflow
- How to run locally?
- How to run tests?
- How to deploy?

## 5. Document Findings
Create a summary with:
- Architecture diagram (ASCII or mermaid)
- Key files and their purposes
- Common patterns used
- Gotchas and quirks
```

### Migration from Gastown Molecules

For teams coming from Gastown, molecules can be converted to skills:

```bash
# Convert Gastown molecule to Panopticon skill
pan convert --from molecule --input mol-polecat-work.formula.toml

# Extracts the instructional content from each step
# Creates skill markdown with the same guidance
# Step tracking moves to Beads (bd create --depends-on)
```

The **knowledge** in molecules (how to do things) becomes **skills**.
The **state tracking** (which steps are done) stays in **Beads**.

---

## Part 5: Context Engineering from GSD-Plus

### The GSD Insight

GSD-Plus demonstrates that **structured context files** dramatically improve AI reliability:

> "The complexity is in the system, not in your workflow."

### Adopting GSD Patterns for Panopticon

#### PROJECT.md → Workspace Context

Each Panopticon workspace gets structured context:

```markdown
# Workspace Context: MIN-648

## What This Is

Research and documentation project for expanding Panopticon architecture.

## Core Value

Synthesize insights from Gastown, GSD-Plus, and Cursor into actionable architecture.

## Active Work

- [ ] Review Cursor dynamic context patterns
- [ ] Study Gastown Beads integration
- [x] Set up beads tracking

## Constraints

- **Scope**: Documentation only, no implementation
- **Sources**: Gastown, GSD-Plus, Cursor blog, existing infra
```

#### STATE.md → Agent State

Persistent state that survives compaction:

```markdown
# Agent State: MIN-648

## Current Position

Issue: MIN-648 "Panopticon Architecture Expanded Thoughts"
Status: In Progress
Last activity: 2026-01-17 08:40 — Completed resource reviews

## Context References

- Workspace: /home/eltmon/projects/myn/workspaces/feature-min-648
- PRD: docs/prds/planned/MIN-630-panopticon-architecture-prd.md
- Beads: doc-review-0c3 (drafting)

## Session Continuity

Last checkpoint: "Completed review of all source materials"
Resume point: "Begin drafting expanded thoughts document"
```

#### SUMMARY.md → Work Artifacts

Each completed piece of work produces a summary:

```markdown
# Work Summary: Research Phase

**Completed:** 2026-01-17
**Duration:** 45 minutes
**Beads closed:** 12

## What Was Done

1. Read Panopticon Architecture PRD
2. Reviewed Cursor Dynamic Context Discovery
3. Studied Gastown architecture (glossary, overview, formulas)
4. Examined GSD-Plus context engineering templates
5. Reviewed existing dashboard implementation

## Key Insights

1. Context discovery > context loading
2. Beads is more than issue tracking - it's persistent memory
3. FPP principle enables self-propelling agents
4. Skills with progressive disclosure reduce context usage vs. heavy molecule templates

## Files Created/Modified

- Created: panopticon-architecture-expanded-thoughts.md
```

### Context File Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│                   CONTEXT FILE LIFECYCLE                         │
└─────────────────────────────────────────────────────────────────┘

Agent Start
    │
    ├──▶ Read STATE.md (current position)
    │
    ├──▶ Read WORKSPACE.md (project context)
    │
    └──▶ Check Beads hook (pending work)

During Work
    │
    ├──▶ Update STATE.md (checkpoints)
    │
    └──▶ Create artifacts (code, docs)

Work Complete
    │
    ├──▶ Write SUMMARY.md (what was done)
    │
    ├──▶ Close Beads
    │
    └──▶ Update STATE.md (session continuity)

Session End
    │
    └──▶ bd sync (persist to git)
```

---

## Part 6: Multi-Runtime Architecture

### Why Multi-Runtime?

From Gastown:

> "Model comparison, cost optimization, capability matching, future-proofing."

### Runtime Abstraction Layer

```typescript
interface Runtime {
  name: string;          // "claude", "codex", "cursor"
  command: string;       // CLI command to invoke
  args: string[];        // Default arguments
  promptMode: "file" | "argument" | "stdin" | "none";

  // Lifecycle hooks
  onStart(workspace: Workspace): Promise<void>;
  onStop(workspace: Workspace): Promise<void>;

  // Context injection
  injectContext(ctx: Context): Promise<void>;

  // Health check
  isHealthy(): Promise<boolean>;
}

// Built-in presets
const RUNTIMES: Record<string, Runtime> = {
  "claude": {
    name: "claude",
    command: "claude",
    args: [],
    promptMode: "none",  // Uses hooks
  },
  "codex": {
    name: "codex",
    command: "codex",
    args: [],
    promptMode: "file",  // Reads CLAUDE.md
  },
  "cursor": {
    name: "cursor",
    command: "cursor",
    args: ["--new-window"],
    promptMode: "none",  // IDE-based
  },
};
```

### Runtime Configuration Files

```toml
# ~/.panopticon/runtimes/claude.toml
[runtime]
name = "claude"
command = "claude"
args = []
prompt_mode = "none"
```

```toml
# ~/.panopticon/runtimes/codex.toml
[runtime]
name = "codex"
command = "codex"
args = []
prompt_mode = "file"  # How to inject agent prompt
```

### Per-Agent Runtime Selection

```bash
# Default: use project runtime
work issue MIN-648

# Override: use specific runtime
work issue MIN-648 --runtime codex

# A/B testing: spawn same issue with different runtimes
work issue MIN-648 --runtime claude --alias min-648-claude
work issue MIN-648 --runtime codex --alias min-648-codex
```

### Runtime Performance Tracking

```typescript
interface RuntimeMetrics {
  runtime: string;
  totalTasks: number;
  successRate: number;
  avgDuration: number;
  avgCost: number;       // Token cost

  // Per-capability breakdown
  byCapability: Record<string, {
    tasks: number;
    successRate: number;
    avgDuration: number;
  }>;
}

// Dashboard shows runtime comparison
function RuntimeComparisonView() {
  return (
    <Table>
      <thead>
        <tr>
          <th>Runtime</th>
          <th>Tasks</th>
          <th>Success</th>
          <th>Avg Time</th>
          <th>Cost</th>
        </tr>
      </thead>
      <tbody>
        {runtimes.map(r => (
          <tr key={r.runtime}>
            <td>{r.runtime}</td>
            <td>{r.totalTasks}</td>
            <td>{r.successRate}%</td>
            <td>{r.avgDuration}m</td>
            <td>${r.avgCost.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
```

---

## Part 7: Stuck Detection and Health Monitoring

### The Deacon Pattern

From Gastown's Deacon implementation:

```go
const (
    DefaultPingTimeout         = 30 * time.Second
    DefaultConsecutiveFailures = 3
    DefaultCooldown            = 5 * time.Minute
)
```

### Health Check Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                   STUCK DETECTION FLOW                           │
└─────────────────────────────────────────────────────────────────┘

Every 30s:
    │
    ├──▶ For each running agent:
    │       │
    │       ├──▶ Send HEALTH_CHECK nudge
    │       │
    │       ├──▶ Wait for response (30s timeout)
    │       │
    │       ├──▶ Response received?
    │       │       │
    │       │       ├── YES: Reset failure counter
    │       │       │
    │       │       └── NO: Increment failure counter
    │       │
    │       └──▶ Failures >= 3?
    │               │
    │               ├── YES (not in cooldown): Force kill + respawn
    │               │
    │               └── NO: Continue monitoring

Cooldown (5min after force-kill):
    │
    └──▶ Skip force-kill, continue monitoring
```

### Panopticon Health Dashboard

```typescript
interface AgentHealth {
  agentId: string;
  status: "healthy" | "warning" | "stuck" | "dead";
  lastActivity: Date;
  consecutiveFailures: number;
  lastForceKill?: Date;
  forceKillCount: number;
}

function AgentHealthBadge({ health }: { health: AgentHealth }) {
  const colors = {
    healthy: "green",
    warning: "yellow",
    stuck: "orange",
    dead: "red",
  };

  return (
    <Badge color={colors[health.status]}>
      {health.status}
      {health.consecutiveFailures > 0 && (
        <span> ({health.consecutiveFailures} failures)</span>
      )}
    </Badge>
  );
}
```

### Automatic Recovery

```typescript
async function handleStuckAgent(agentId: string) {
  const health = await getAgentHealth(agentId);

  // Check cooldown
  if (health.lastForceKill) {
    const timeSinceKill = Date.now() - health.lastForceKill.getTime();
    if (timeSinceKill < COOLDOWN_MS) {
      console.log(`Agent ${agentId} in cooldown, skipping recovery`);
      return;
    }
  }

  // Force kill
  await killAgent(agentId);

  // Record the kill
  await recordForceKill(agentId);

  // Respawn with crash recovery
  const state = await bd.getAgentState(agentId);
  if (state.currentWork) {
    console.log(`Respawning agent for work: ${state.currentWork}`);
    await spawnAgent(agentId, { resume: state.currentWork });
  }
}
```

---

## Part 8: Directory Structure and Configuration

### Global Panopticon Home (`~/.panopticon/`)

```
~/.panopticon/
├── config.toml              # Global configuration
├── projects.toml            # Registry of managed projects
├── .beads/                  # Beads database for all work tracking
│
├── skills/                  # Skills (canonical source)
│   ├── index.json           # Skill metadata (names + descriptions)
│   ├── feature-work/
│   │   └── SKILL.md         # Feature development workflow
│   ├── bug-fix/
│   │   └── SKILL.md         # Bug investigation workflow
│   ├── code-review/
│   │   └── SKILL.md         # Code review checklist
│   ├── code-review-security/
│   │   └── SKILL.md         # Security-focused review
│   ├── code-review-performance/
│   │   └── SKILL.md         # Performance-focused review
│   └── AGENTS.md            # Generated for Codex/Cursor (legacy)
│
├── commands/                # Commands synced to ~/.claude/commands/
│   ├── pan/
│   │   ├── up.md
│   │   ├── down.md
│   │   ├── sync.md
│   │   └── help.md
│   └── work/
│       ├── issue.md
│       ├── status.md
│       ├── tell.md
│       └── approve.md
│
├── agents/                  # Per-agent state
│   ├── min-648/
│   │   ├── hook.json        # Active work item
│   │   ├── state.json       # Crash recovery state
│   │   ├── health.json      # Health status
│   │   └── mail/            # Incoming messages
│   └── min-630/
│       └── ...
│
├── context/                 # Dynamic context discovery
│   ├── materialized/        # Tool output files
│   ├── history/             # Session histories
│   └── cache/               # MCP tool cache
│
├── runtimes/                # Runtime configurations
│   ├── claude.toml
│   ├── codex.toml
│   └── cursor.toml
│
└── dashboard/               # Web dashboard (React app)
    ├── package.json
    └── ...
```

### Project-Level Config (`.panopticon/` in each project)

```
~/projects/myn/.panopticon/
├── project.toml             # Project-specific config
├── workspaces/              # Feature branch workspaces
│   ├── feature-min-630/
│   └── feature-min-631/
└── agents/                  # Active agents for this project
    └── agent-min-630.state  # Agent state (for crash recovery)
```

### Global Config (`~/.panopticon/config.toml`)

```toml
[panopticon]
version = "1.0.0"
default_runtime = "claude"

# Issue tracker credentials (used by adapters)
[trackers.linear]
api_key_env = "LINEAR_API_KEY"

[trackers.github]
token_env = "GITHUB_TOKEN"

[trackers.gitlab]
token_env = "GITLAB_TOKEN"
url = "https://gitlab.com"  # Or self-hosted URL

[beads]
enabled = true
sync_interval = "5m"

[dashboard]
port = 3001
api_port = 3002

[sync]
auto_sync = true                   # Auto-sync on pan commands
strategy = "symlink"               # or "copy"
targets = ["skills", "commands"]   # What to sync to ~/.claude/

[health]
ping_timeout = "30s"
consecutive_failures = 3
cooldown = "5m"
```

### Project Registry (`~/.panopticon/projects.toml`)

```toml
[[projects]]
name = "myn"
path = "/home/eltmon/projects/myn"
type = "monorepo"
components = ["frontend", "api", "infra"]
linear_team = "MIN"
workspace_pattern = "workspaces/feature-{issue}"

[[projects]]
name = "panopticon"
path = "/home/eltmon/projects/panopticon"  # After extraction
type = "standalone"
is_self = true  # Panopticon manages itself

[[projects]]
name = "househunt"
path = "/home/eltmon/projects/househunt"
type = "standalone"
```

### Project Config (`project/.panopticon/project.toml`)

```toml
[project]
name = "myn"
description = "Mind Your Now - AI productivity app"

[workspace]
enabled = true
docker_compose = ".devcontainer/docker-compose.devcontainer.yml"
url_pattern = "https://feature-{issue}.myn.test"
api_url_pattern = "https://api-feature-{issue}.myn.test"

[agent]
default_runtime = "claude"
default_model = "sonnet"
prompt_template = "default-agent.md"

[beads]
prefix = "MIN"

# Issue tracker configuration
[trackers]
primary = "linear"      # Where work happens (sprints, PRDs)
secondary = "gitlab"    # Community/external (optional)

[trackers.linear]
team = "MIN"

[trackers.gitlab]
project = "eltmon/mind-your-now"
```

### Example: Open Source Project Config

```toml
# panopticon/.panopticon/project.toml
[project]
name = "panopticon"
description = "Multi-agent orchestration for Claude Code"

[trackers]
primary = "linear"      # Internal planning, PRDs, roadmap
secondary = "github"    # Community bug reports, feature requests

[trackers.linear]
team = "PAN"            # Panopticon Linear team

[trackers.github]
repo = "eltmon/panopticon"
auto_sync = false       # Manual triage
```

---

## Part 9: Commands

### `pan` Commands (Panopticon management)

| Command | Description |
|---------|-------------|
| `pan init` | Initialize Panopticon globally (`~/.panopticon/`) |
| `pan project add <path>` | Register a project with Panopticon |
| `pan project list` | List all managed projects |
| `pan sync` | Sync skills/commands to `~/.claude/` |
| `pan up` | Start the dashboard |
| `pan down` | Stop dashboard and optionally agents |
| `pan update` | Update Panopticon itself |
| `pan doctor` | Check system health, dependencies |
| `pan convoy start <type>` | Start parallel agent convoy |
| `pan help` | Show all commands |
| `ccr` | Run claude-code-router with permissions bypass |

### `ccr` Utility Script

Panopticon provides a `ccr` script for convenient Claude Code access through the router with permissions bypass.

**Location:** `~/projects/ccr`

**Usage:**
```bash
# Direct execution (recommended)
ccr

# With arguments
ccr --model claude-sonnet-4-5
ccr "your prompt here"

# With resume
ccr --resume <session-id>

# Add as alias for convenience
source ~/projects/ccr
```

**What it does:**
- Runs `claude-code-router` with `CCR_DANGEROUSLY_SKIP=true` environment variable
- Forwards all arguments to the router
- Provides interactive terminal access with stdin/stdout/stderr inherited
- Works from any directory

**Installation:**
The script is placed in `~/projects/` during Panopticon setup. To use it directly:

```bash
# Make executable (if needed)
chmod +x ~/projects/ccr

# Add to PATH or source directly
export PATH="$PATH:$HOME/projects"
# Or add to .bashrc/.zshrc:
echo 'alias ccr="source ~/projects/ccr"' >> ~/.bashrc
```



### `work` Commands (Agent/work management)

| Command | Description |
|---------|-------------|
| `work issue <id> [--model]` | Spawn agent for issue (primary tracker) |
| `work issue <tracker>#<id>` | Spawn agent for issue (explicit tracker) |
| `work status` | Show all running agents |
| `work tell <id> <message>` | Send message to agent |
| `work approve <id>` | Approve agent work, merge MR |
| `work pending` | Show completed work awaiting review |
| `work kill <id>` | Kill an agent |
| `work list [--all]` | List issues (--all includes secondary tracker) |
| `work triage` | Show secondary tracker issues needing triage |
| `work triage <id> --create` | Create primary issue from secondary |
| `work triage <id> --dismiss` | Dismiss secondary issue from triage queue |
| `work plan <id>` | Create detailed execution plan before spawning |

### Sync Mechanism

#### What Gets Synced

When you run `pan sync`, Panopticon creates symlinks from `~/.panopticon/` to all supported tool locations:

```
~/.panopticon/skills/*     →  ~/.claude/skills/           # Claude Code + Cursor
                           →  ~/.codex/skills/            # Codex
                           →  ~/.gemini/skills/           # Gemini CLI
                           →  ~/.gemini/antigravity/skills/ # Google Antigravity

~/.panopticon/commands/*   →  ~/.claude/commands/         # Claude Code only (commands not universal)
```

**Note:** Cursor auto-discovers from `~/.claude/skills/`, so a single symlink covers both Claude Code and Cursor.

#### Auto-Sync

With `auto_sync = true`, sync happens automatically when:
- Panopticon starts (`pan up`)
- After `pan update`
- When adding new commands/skills

#### Sync Strategy Options

```toml
[sync]
strategy = "symlink"  # or "copy"
# symlink: Changes in ~/.panopticon/ immediately available
# copy: Explicit sync required
```

#### Safe Sync: Backup & Detection

**Principle:** Never destroy user data without explicit consent. Panopticon detects what it's overwriting and acts accordingly.

**Detection Logic:**

```typescript
type SyncTargetState =
  | 'empty'           // Directory doesn't exist or is empty
  | 'panopticon'      // Already our symlinks (safe to overwrite)
  | 'user-content'    // User's custom content (needs backup/confirmation)
  | 'mixed'           // Some ours, some theirs (needs careful handling)

function detectTargetState(path: string): SyncTargetState {
  if (!exists(path)) return 'empty';

  const items = listDir(path);
  if (items.length === 0) return 'empty';

  const ourSymlinks = items.filter(item =>
    isSymlink(item) && readlink(item).startsWith('~/.panopticon/')
  );

  if (ourSymlinks.length === items.length) return 'panopticon';
  if (ourSymlinks.length === 0) return 'user-content';
  return 'mixed';
}
```

**Behavior by State:**

| State | Default Behavior | User Sees |
|-------|------------------|-----------|
| `empty` | Proceed silently | Nothing |
| `panopticon` | Proceed silently | Nothing (updating our own symlinks) |
| `user-content` | **Backup + prompt** | Warning with backup location |
| `mixed` | **Backup + prompt** | Warning listing affected files |

**Example Output:**

```bash
$ pan sync

Checking ~/.claude/skills/...
  ⚠️  Found 3 custom skills not managed by Panopticon:
      - my-custom-skill/
      - company-internal/
      - experimental/

  These will be backed up to: ~/.panopticon/backups/2026-01-17T22:30:00/

  Options:
    [B] Backup and continue (default)
    [S] Skip ~/.claude/skills/ (sync other locations only)
    [M] Merge (keep yours, add ours alongside)
    [A] Abort

  Choice [B]:

  ✓ Backed up to ~/.panopticon/backups/2026-01-17T22:30:00/claude-skills/
  ✓ Synced 47 skills to ~/.claude/skills/

Checking ~/.claude/commands/...
  ✓ Already Panopticon-managed, updating...
  ✓ Synced 12 commands to ~/.claude/commands/
```

**CLI Flags:**

```bash
pan sync                    # Default: detect, backup if needed, prompt
pan sync --no-backup        # Skip backup (destructive, requires --force)
pan sync --backup-only      # Just backup, don't sync
pan sync --dry-run          # Show what would happen without doing it
pan sync --merge            # Keep user content, add Panopticon alongside
pan sync --force            # No prompts (for CI/automation)
pan sync --skip <target>    # Skip specific target (e.g., --skip ~/.claude/skills)
```

**Backup Structure:**

```
~/.panopticon/backups/
├── 2026-01-17T22:30:00/
│   ├── manifest.json        # What was backed up and why
│   ├── claude-skills/       # Original ~/.claude/skills/ contents
│   └── claude-commands/     # Original ~/.claude/commands/ contents
└── 2026-01-15T10:00:00/
    └── ...
```

**Manifest Example:**

```json
{
  "timestamp": "2026-01-17T22:30:00Z",
  "reason": "pan sync detected user content",
  "panopticon_version": "1.0.0",
  "backed_up": [
    {
      "source": "~/.claude/skills/",
      "items": ["my-custom-skill/", "company-internal/", "experimental/"],
      "state": "user-content"
    }
  ],
  "restore_command": "pan restore 2026-01-17T22:30:00"
}
```

**Restore Command:**

```bash
$ pan restore 2026-01-17T22:30:00

This will:
  - Remove current Panopticon symlinks from ~/.claude/skills/
  - Restore original contents from backup

Continue? [y/N]: y

✓ Restored ~/.claude/skills/ from backup
✓ Panopticon symlinks removed

Note: Run 'pan sync' to re-apply Panopticon skills
```

**Config Options:**

```toml
[sync]
strategy = "symlink"
auto_sync = true

# Backup behavior
backup_before_sync = true          # Default: always backup user content
backup_retention_days = 30         # Auto-delete old backups
prompt_on_user_content = true      # Show prompt when user content detected
merge_strategy = "prompt"          # "prompt" | "backup" | "merge" | "overwrite"
```

**First-Time Install:**

`pan install` uses the same detection:

```bash
$ npx panopticon install

Checking existing configuration...
  ~/.claude/skills/: 5 custom skills found
  ~/.claude/commands/: 2 custom commands found

Panopticon will backup your existing configuration before installing.
Backup location: ~/.panopticon/backups/2026-01-17T22:30:00/

Continue with installation? [Y/n]:
```

#### Git Worktree Merge: Project-Specific + Generic Skills

**The Problem:** When creating a worktree, the target repo may already have project-specific skills in `.claude/skills/` (git-tracked). Panopticon needs to *add* generic skills alongside them, not replace them.

**Two-Layer Architecture:**

```
Layer 1: Git Repository (project-specific)
├── .claude/skills/myn-standards/     # MYN design system, coding standards
├── .claude/skills/company-internal/  # Company-specific patterns
└── .claude/skills/project-foo/       # Project-specific skill

Layer 2: Panopticon (generic tooling)
├── ~/.panopticon/skills/beads/              # Task tracking
├── ~/.panopticon/skills/react-best-practices/
├── ~/.panopticon/skills/session-health/
└── ~/.panopticon/skills/web-design-guidelines/
```

**Detection Enhancement:**

```typescript
type ContentOrigin =
  | 'git-tracked'      // File exists in git index (git ls-files)
  | 'panopticon'       // Our symlink pointing to ~/.panopticon/
  | 'user-untracked'   // User content not in git (needs backup)

function detectContentOrigin(path: string): ContentOrigin {
  // Check if it's our symlink
  if (isSymlink(path) && readlink(path).includes('.panopticon')) {
    return 'panopticon';
  }

  // Check if git tracks this file
  const gitResult = exec(`git ls-files --error-unmatch "${path}" 2>/dev/null`);
  if (gitResult.exitCode === 0) {
    return 'git-tracked';
  }

  return 'user-untracked';
}
```

**Worktree Creation Merge Algorithm:**

```bash
$ pan worktree create feature-xyz

# 1. Create git worktree (brings git-tracked content)
git worktree add workspaces/feature-xyz -b feature/xyz

# 2. Scan .claude/skills/ for existing content
Scanning .claude/skills/...
  Found 2 git-tracked skills:
    - myn-standards/ (git-tracked)
    - company-internal/ (git-tracked)

# 3. Identify Panopticon skills to add (that don't conflict)
Panopticon skills to add:
    - beads/
    - react-best-practices/
    - session-health/
    - web-design-guidelines/

# 4. Add Panopticon symlinks alongside git content
Adding Panopticon skills...
  ✓ beads/ → ~/.panopticon/skills/beads/
  ✓ react-best-practices/ → ~/.panopticon/skills/react-best-practices/
  ✓ session-health/ → ~/.panopticon/skills/session-health/
  ✓ web-design-guidelines/ → ~/.panopticon/skills/web-design-guidelines/

# 5. Result
Workspace ready: workspaces/feature-xyz/
  Skills: 2 project-specific + 4 Panopticon = 6 total
```

**Conflict Resolution:**

```typescript
// If same skill name exists in both git and Panopticon
if (gitTrackedSkills.includes(skillName) && panopticonSkills.includes(skillName)) {
  // Git wins - project-specific takes precedence
  console.log(`Skipping ${skillName}: project has custom version (git-tracked)`);
}
```

**Resulting Directory Structure:**

```
workspaces/feature-xyz/.claude/skills/
├── myn-standards/           # git-tracked (from repo)
├── company-internal/        # git-tracked (from repo)
├── beads -> ~/.panopticon/skills/beads/                    # symlink
├── react-best-practices -> ~/.panopticon/skills/react-best-practices/
├── session-health -> ~/.panopticon/skills/session-health/
└── web-design-guidelines -> ~/.panopticon/skills/web-design-guidelines/
```

**Key Principles:**

1. **Git-tracked always wins** - Project-specific skills take precedence over Panopticon generic skills
2. **Additive merge** - Panopticon adds its skills alongside, never replaces git content
3. **No gitignore pollution** - Panopticon symlinks should be gitignored (added to `.gitignore` in template)
4. **Clean separation** - Easy to see what's project-specific vs generic (ls -la shows symlinks)

**Gitignore Template Addition:**

```gitignore
# .claude/skills/.gitignore (added by Panopticon)
# Panopticon-managed symlinks - these are added per-workspace, not committed
beads
react-best-practices
session-health
skill-creator
web-design-guidelines
blog-writer
# Add new Panopticon skills here
```

---

## Part 10: Issue Tracker Architecture

Panopticon uses an abstraction layer to support multiple issue trackers. This enables both single-tracker and multi-tracker workflows.

### Supported Trackers

| Tracker | Priority | Status | Package |
|---------|----------|--------|---------|
| Linear | HIGH | Current | `@linear/sdk` |
| GitHub Issues | HIGH | For Launch | `@octokit/rest` |
| GitLab Issues | MEDIUM | Post-Launch | `@gitbeaker/rest` |
| Jira | LOW | Future | `jira-client` |

### Interface Design

```typescript
interface IssueTracker {
  // Identity
  readonly name: string;  // "linear" | "github" | "gitlab"

  // Core operations
  listIssues(filters: IssueFilters): Promise<Issue[]>;
  getIssue(id: string): Promise<Issue>;
  updateIssue(id: string, update: IssueUpdate): Promise<Issue>;
  createIssue(issue: NewIssue): Promise<Issue>;

  // Comments
  getComments(issueId: string): Promise<Comment[]>;
  addComment(issueId: string, body: string): Promise<Comment>;

  // State transitions
  transitionIssue(id: string, state: IssueState): Promise<void>;

  // Linking
  linkPR(issueId: string, prUrl: string): Promise<void>;
}

// Normalized issue format (lowest common denominator)
interface Issue {
  id: string;           // Tracker-specific ID
  ref: string;          // Human-readable ref (MIN-630, #42)
  title: string;
  description: string;
  state: "open" | "in_progress" | "closed";
  labels: string[];
  assignee?: string;
  url: string;          // Web URL to issue
  tracker: string;      // Which tracker this came from
  linkedIssues?: string[];  // Cross-tracker links
}
```

### Single Tracker Per Project

Each project uses **one issue tracker**. This keeps things simple and avoids confusion about where issues live.

```
┌─────────────────────────────────────────────────────────────────┐
│                    PROJECT CONFIGURATION                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                       ┌─────────────┐
                       │   TRACKER   │
                       │             │
                       │  Linear OR  │
                       │  GitHub OR  │
                       │  GitLab     │
                       │             │
                       └─────────────┘
```

**Configuration:**

```toml
# ~/.panopticon/projects.toml

[projects.myn]
path = "/home/user/projects/myn"
tracker = "linear"
linear_team = "MIN"
default_branch = "main"           # Branch to base feature branches on
workspace_type = "monorepo"       # "monorepo" | "simple"
workspace_subdirs = ["fe", "api"] # For monorepo: subdirs that are worktrees

[projects.panopticon]
path = "/home/user/projects/panopticon"
tracker = "linear"
linear_team = "PAN"
default_branch = "main"

[projects.opensource-lib]
path = "/home/user/projects/mylib"
tracker = "github"
github_repo = "user/mylib"
default_branch = "main"
```

**Workspace Types:**

| Type | Description | Example |
|------|-------------|---------|
| `simple` | Single repo, worktree at workspace root | Panopticon |
| `monorepo` | Multiple subrepos as worktrees in subdirs | MYN (fe/, api/) |

For `monorepo` projects, the agent should `cd` into the appropriate subdir based on the work being done.

**Why single tracker?**
- **Simplicity**: One source of truth for issues
- **No sync conflicts**: No need to keep two systems in sync
- **Clear ownership**: Everyone knows where to file/find issues
- **Reduced cognitive load**: No "which tracker has this issue?" confusion

**Choosing a tracker:**

| Use Case | Recommended Tracker |
|----------|---------------------|
| Private projects | Linear |
| Open source with community | GitHub |
| Enterprise with existing tooling | GitLab or Jira |

### State Mapping Architecture

Panopticon uses a **richer workflow** than most trackers provide out of the box. We need to map our internal states to each tracker's capabilities.

#### Panopticon's Internal Workflow States

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌─────────────┐    ┌───────────┐    ┌──────────┐
│ backlog  │───▶│   todo   │───▶│ planning │───▶│ in_progress │───▶│ in_review │───▶│   done   │
└──────────┘    └──────────┘    └──────────┘    └─────────────┘    └───────────┘    └──────────┘
                                     ▲
                               Click "Plan"
                               - Workspace created
                               - Opus discovery begins
                               - Human answers questions
                               - STATE.md generated
```

| State | Type | Description |
|-------|------|-------------|
| `backlog` | backlog | Ideas, future work, not prioritized |
| `todo` | unstarted | Prioritized, ready to work on |
| `planning` | started | **NEW**: Human + AI discovery phase, workspace being set up |
| `in_progress` | started | Agent executing the plan |
| `in_review` | started | PR created, awaiting review/merge |
| `done` | completed | Work complete, PR merged |
| `canceled` | canceled | Won't do |

**Why "Planning" is a separate state:**
- Clear signal that work has started (not just sitting in todo)
- Workspace creation happens here (docker, git worktrees)
- AI-driven discovery conversation happens here
- Human involvement required (answering questions)
- Prevents agents from starting without proper planning

#### Tracker State Capabilities

| Tracker | Custom States? | State Types | Fallback Options |
|---------|---------------|-------------|------------------|
| **Linear** | ✅ Yes (per team) | backlog, unstarted, started, completed, canceled | Labels |
| **GitHub Issues** | ❌ Open/Closed only | open, closed | Labels, Project board columns |
| **GitLab Issues** | ❌ Open/Closed + Labels | open, closed | Labels, Board lists |
| **Jira** | ✅ Yes (admin required) | Configurable workflow | Often restricted by admin |
| **Trello** | ✅ Lists = states | Lists are columns | Native fit |

#### State Mapping Configuration

```yaml
# ~/.panopticon/state-mappings.yaml

# Panopticon's canonical states (source of truth)
canonical_states:
  - name: backlog
    type: backlog
    description: "Ideas and future work"
  - name: todo
    type: unstarted
    description: "Prioritized and ready"
  - name: planning
    type: started
    description: "Discovery phase with human"
  - name: in_progress
    type: started
    description: "Agent executing"
  - name: in_review
    type: started
    description: "PR awaiting review"
  - name: done
    type: completed
    description: "Work complete"
  - name: canceled
    type: canceled
    description: "Won't do"

# Tracker-specific mappings
trackers:
  linear:
    # Map Panopticon states to Linear state names
    state_map:
      backlog: "Backlog"
      todo: "Todo"
      planning: "In Planning"        # May need to create
      in_progress: "In Progress"
      in_review: "In Review"
      done: "Done"
      canceled: "Canceled"

    # What to do if state doesn't exist
    missing_state_strategy: "auto_create"  # auto_create | use_fallback | error

    # Fallback when state can't be created/mapped
    fallback:
      type: "labels"
      prefix: "pan:"                 # pan:planning, pan:in_progress

    # Linear-specific: state type for auto-created states
    auto_create_config:
      planning:
        type: "started"
        color: "#9333ea"             # Purple for planning
        position_after: "Todo"

  github:
    # GitHub only has open/closed - use labels + project board
    state_map:
      backlog: { status: "open", label: null }
      todo: { status: "open", label: null }
      planning: { status: "open", label: "planning" }
      in_progress: { status: "open", label: "in-progress" }
      in_review: { status: "open", label: "in-review" }
      done: { status: "closed", label: null }
      canceled: { status: "closed", label: "wontfix" }

    missing_state_strategy: "use_fallback"

    fallback:
      type: "labels"
      auto_create_labels: true
      label_colors:
        planning: "9333ea"           # Purple
        in-progress: "fbbf24"        # Yellow
        in-review: "a855f7"          # Light purple

    # Optional: Use GitHub Projects for visual board
    project_board:
      enabled: true
      name: "Panopticon"
      column_map:
        backlog: "Backlog"
        todo: "Todo"
        planning: "In Planning"
        in_progress: "In Progress"
        in_review: "Review"
        done: "Done"

  gitlab:
    state_map:
      backlog: { status: "opened", label: "backlog" }
      todo: { status: "opened", label: "todo" }
      planning: { status: "opened", label: "planning" }
      in_progress: { status: "opened", label: "in-progress" }
      in_review: { status: "opened", label: "in-review" }
      done: { status: "closed", label: null }
      canceled: { status: "closed", label: "wontfix" }

    missing_state_strategy: "use_fallback"

    fallback:
      type: "labels"
      auto_create_labels: true

    # GitLab boards can show label-based lists
    board:
      enabled: true
      name: "Panopticon"

  jira:
    # Jira workflows are highly customizable but often locked down
    state_map:
      backlog: "Backlog"
      todo: "To Do"
      planning: "In Planning"        # May need admin to create
      in_progress: "In Progress"
      in_review: "In Review"
      done: "Done"
      canceled: "Canceled"

    missing_state_strategy: "use_fallback"  # Can't auto-create in Jira

    fallback:
      type: "labels"
      prefix: "pan-"
```

#### Virtual State Layer

Panopticon maintains its **own state tracking** as the source of truth:

```typescript
// ~/.panopticon/issue-states.json
{
  "MIN-645": {
    "panopticonState": "planning",      // Our canonical state
    "trackerState": "In Progress",       // What's in Linear (may differ)
    "lastSyncedAt": "2026-01-19T05:00:00Z",
    "syncStatus": "synced",              // synced | pending | conflict
    "fallbacksUsed": []                  // ["label:planning"] if applicable
  }
}
```

**Why virtual state layer?**
- Panopticon knows the TRUE state even if tracker can't represent it
- Dashboard shows Panopticon's view, not just tracker's limited view
- Enables "planning" state even on GitHub (which only has open/closed)
- Handles sync conflicts gracefully

#### State Transition API

```typescript
interface StateManager {
  // Get Panopticon's view of issue state
  getState(issueId: string): Promise<PanopticonState>;

  // Transition to new state (updates both Panopticon + tracker)
  transition(issueId: string, newState: CanonicalState): Promise<TransitionResult>;

  // Sync tracker state to Panopticon (pull)
  syncFromTracker(issueId: string): Promise<SyncResult>;

  // Ensure tracker has required states (auto-create if configured)
  ensureTrackerStates(tracker: string, team?: string): Promise<SetupResult>;
}

interface TransitionResult {
  success: boolean;
  panopticonState: CanonicalState;
  trackerState: string;
  fallbacksUsed: string[];
  warnings: string[];
}

// Canonical states
type CanonicalState =
  | "backlog"
  | "todo"
  | "planning"
  | "in_progress"
  | "in_review"
  | "done"
  | "canceled";
```

#### Setup Flow

When a project is first configured, Panopticon checks tracker compatibility:

```
$ pan project add ~/projects/myn --tracker linear --team MIN

Checking Linear team "MIN" for required states...

✅ Backlog - exists
✅ Todo - exists
❌ In Planning - MISSING
✅ In Progress - exists
✅ In Review - exists
✅ Done - exists

Missing state: "In Planning"

Options:
1. Create it automatically (recommended)
2. Use label fallback (label: pan:planning)
3. Skip (planning state won't sync to Linear)

Choice [1]: 1

Creating "In Planning" state in Linear...
✅ Created "In Planning" (type: started, position: after Todo)

Project configured successfully!
```

#### The "In Planning" Workflow

When user clicks "Plan" on an issue:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         PLAN BUTTON CLICKED                              │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. TRANSITION TO PLANNING                                                │
│    - Update Panopticon state → "planning"                                │
│    - Update tracker state → "In Planning" (or fallback)                  │
│    - Log state transition                                                │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 2. CREATE WORKSPACE (async)                                              │
│    - Git worktree for feature branch                                     │
│    - Docker containers (if configured)                                   │
│    - Runs in background while discovery happens                          │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 3. START DISCOVERY SESSION                                               │
│    - Spawn Opus agent (or use co-mayor session)                          │
│    - Agent reads codebase (now available in workspace)                   │
│    - Agent follows gsd-plus questioning protocol                         │
│    - Human answers via dashboard chat interface                          │
│                                                                          │
│    Questions like:                                                       │
│    - "The issue mentions JWT auth - should we modify SecurityConfig?"    │
│    - "I see 3 similar endpoints - should this follow the same pattern?"  │
│    - "What's explicitly NOT in scope for this fix?"                      │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 4. GENERATE ARTIFACTS                                                    │
│    - STATE.md with decisions and context                                 │
│    - WORKSPACE.md with links and instructions                            │
│    - Beads tasks with dependencies                                       │
│    - Planning marked complete                                            │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 5. READY FOR EXECUTION                                                   │
│    User choice:                                                          │
│    - "Start Agent" → transition to in_progress, spawn execution agent    │
│    - "Review Plan" → stay in planning, human reviews artifacts           │
│    - "Edit Plan" → modify STATE.md/tasks before starting                 │
└─────────────────────────────────────────────────────────────────────────┘
```

### Commands

```bash
# Work on an issue (tracker is determined by project config)
work issue MIN-42       # Linear issue
work issue #42          # GitHub issue (if project uses GitHub)

# List issues
work list               # From configured tracker
```

---

## Part 11: Dashboard Features

The web dashboard (`pan up`) provides:

1. **Kanban View** - Issues by status (from Linear)
2. **Agent Monitor** - Running agents, their output, status
3. **Workspace Manager** - Docker containers, URLs, health
4. **Activity Feed** - Real-time agent activity (from Beads)
5. **Project Switcher** - Switch between managed projects
6. **Health Dashboard** - Agent health status, stuck detection
7. **Skill Browser** - View and edit skills, trigger `pan sync`
8. **Runtime Comparison** - Performance metrics across runtimes

### Current Implementation

The existing dashboard at `/home/eltmon/projects/myn/infra/dashboard/` provides:

- **Frontend**: http://localhost:3001 (React + Vite)
- **API**: http://localhost:3002 (Express)

Features already implemented:
- Kanban board with Linear issues
- Active agent monitoring (tmux sessions)
- Real-time terminal output view
- Agent control (send messages, stop agents)
- PRD status for each issue
- MR URL detection from GitLab

---

## Part 12: Workflow Examples

### Initial Setup

```bash
# 1. Install Panopticon
npm install -g panopticon-dashboard

# 2. Initialize
pan init

# 3. Register projects
pan project add ~/projects/myn
pan project add ~/projects/househunt

# 4. Sync to Claude Code
pan sync

# 5. Start dashboard
pan up
```

### Daily Development

```bash
# Start the day
pan up

# Work on an issue
work issue MIN-630 --model sonnet

# Check agent status
work status

# Send feedback to agent
work tell MIN-630 "Add tests for the edge case"

# Approve completed work
work approve MIN-630

# End of day
pan down
```

### Planning Complex Work

```bash
# Create detailed plan before spawning agent
work plan MIN-648

# Review and adjust PLAN.md
# Then spawn agent with plan
work issue MIN-648
```

### Updating Panopticon

```bash
# Update Panopticon itself
pan update

# This automatically:
# 1. Pulls latest version
# 2. Runs migrations if needed
# 3. Syncs new skills/commands
# 4. Restarts dashboard if running
```

### Self-Management

Panopticon manages itself as a project:

```toml
# In projects.toml
[[projects]]
name = "panopticon"
path = "/home/eltmon/projects/panopticon"
is_self = true
```

When you modify Panopticon's skills/commands, run:
```bash
pan sync
```

Changes are immediately available in Claude Code (if using symlinks).

---

## Part 13: Weekend Implementation Plan

### Phase 1: Core Foundation (Saturday Morning)

- [ ] Extract Panopticon to standalone repo
- [ ] Set up `~/.panopticon/` directory structure
- [ ] Implement `pan init` and `pan sync` (symlink-based)
- [ ] Create 10 high-value SKILL.md files
- [ ] Test skill discovery across Claude Code, Codex, Cursor, Gemini CLI, Antigravity

### Phase 2: Commands & Dashboard (Saturday Afternoon)

- [ ] Migrate existing `/pan:*` and `/work-*` commands
- [ ] Add `work plan` command integration
- [ ] Update dashboard to show skills
- [ ] Add health monitoring to dashboard

### Phase 3: Beads Deep Integration (Saturday Evening)

- [ ] Implement hooks for all agents
- [ ] Add FPP enforcement
- [ ] Add crash recovery via Beads state
- [ ] Add agent CV tracking

### Phase 4: Context Engineering (Sunday Morning)

- [ ] Implement context materialization
- [ ] Add queryable history files
- [ ] Create STATE.md/WORKSPACE.md templates
- [ ] Add context budget awareness

### Phase 5: Health Monitoring (Sunday Afternoon)

- [ ] Port Deacon stuck detection logic
- [ ] Implement health check nudges
- [ ] Add auto-recovery with cooldown
- [ ] Build health dashboard component

### Phase 6: Polish (Sunday Evening)

- [ ] Test all workflows end-to-end
- [ ] Fix any integration issues
- [ ] Document setup process
- [ ] Create demo video

---

## Part 14: Installation, CLI Distribution & Portability

This section covers how Panopticon will be installed, distributed, and how we'll support different tech stacks beyond MYN's Spring Boot + React setup.

### Current MYN Architecture (Reference)

MYN's workspace containers are **NOT** a single container. Each workspace runs **5 separate containers**:

| Container | Purpose | Port |
|-----------|---------|------|
| `dev` | Claude Code runs here (Java 21 + Node 20) | - |
| `fe` | Frontend (Vite dev server) | 4173 |
| `api` | Backend (Spring Boot) | 7000 |
| `postgres` | Database (pgvector) | 5432 |
| `redis` | Cache | 6379 |

Plus **Traefik** runs as a shared global container routing all workspaces via friendly URLs (`https://feature-min-648.myn.test`).

### CLI Distribution Strategy

#### Primary: npx + Auto-Aliasing

```bash
# First time - zero install
npx panopticon init

# After init, 'pan' alias is created automatically
pan sync
pan up
pan workspace create min-648
```

How the alias works:
```bash
# pan init adds to ~/.bashrc or ~/.zshrc:
export PATH="$HOME/.panopticon/bin:$PATH"

# ~/.panopticon/bin/pan is a small shell script:
#!/bin/bash
node ~/.panopticon/cli/index.js "$@"
```

#### Secondary: Global npm Install

```bash
npm install -g panopticon
pan --version
```

#### Future: Homebrew/apt (v2)

```bash
brew install panopticon      # macOS
apt install panopticon       # Linux (via PPA)
choco install panopticon     # Windows
```

### Installation Flow

```bash
npx panopticon install

# Output:
╔══════════════════════════════════════════════════════════════╗
║                    PANOPTICON INSTALLER                       ║
╚══════════════════════════════════════════════════════════════╝

Checking prerequisites...
  ✓ Docker installed (v24.0.7)
  ✓ Docker Compose installed (v2.23.0)
  ✓ Node.js installed (v20.10.0)
  ✗ mkcert not found

Installing mkcert for local HTTPS...
  → brew install mkcert  # or apt/choco depending on OS
  → mkcert -install
  ✓ Local CA installed

Generating wildcard certificates...
  → mkcert "*.pan.localhost" "*.localhost"
  ✓ Certificates saved to ~/.panopticon/certs/

Creating Docker network...
  → docker network create panopticon-public
  ✓ Network created

Starting Traefik...
  → docker compose -f ~/.panopticon/traefik/docker-compose.yml up -d
  ✓ Traefik running at https://traefik.pan.localhost:8080

Adding hosts entries (requires sudo)...
  → echo "127.0.0.1 pan.localhost traefik.pan.localhost" | sudo tee -a /etc/hosts
  ✓ Hosts file updated

Setting up CLI...
  → Adding pan alias to ~/.zshrc
  ✓ Restart your terminal or run: source ~/.zshrc

╔══════════════════════════════════════════════════════════════╗
║  ✓ PANOPTICON INSTALLED SUCCESSFULLY                          ║
║                                                                ║
║  Dashboard: https://pan.localhost:3001                        ║
║  Traefik:   https://traefik.pan.localhost:8080                ║
║                                                                ║
║  Next steps:                                                   ║
║    pan init              # Initialize a project                ║
║    pan workspace create  # Create a workspace                  ║
╚══════════════════════════════════════════════════════════════╝
```

#### Minimal Install (No Traefik)

For users who don't want/need Traefik:

```bash
npx panopticon install --minimal

# Uses port-based routing instead:
# http://localhost:3001 (workspace 1 frontend)
# http://localhost:7001 (workspace 1 api)
# http://localhost:3002 (workspace 2 frontend)
# http://localhost:7002 (workspace 2 api)
```

### Platform-Specific Handling

| Platform | mkcert Install | Hosts File | Docker | Notes |
|----------|----------------|------------|--------|-------|
| **macOS** | `brew install mkcert` | `/etc/hosts` | Docker Desktop | Works great |
| **Linux** | `apt install mkcert` | `/etc/hosts` | Native Docker | May need libnss3-tools |
| **Windows (WSL2)** | `choco install mkcert` | Windows hosts file | Docker Desktop WSL2 | Hosts file in `C:\Windows\System32\drivers\etc\hosts` |
| **Windows (Native)** | `choco install mkcert` | Windows hosts file | Docker Desktop | Full support planned for v2 |

### Workspace Portability: Bring Your Own Docker

Instead of mandating a specific tech stack, Panopticon uses a **"Bring Your Own Docker"** approach:

#### How It Works

```bash
# User has an existing project with docker-compose
cd ~/projects/my-saas
ls
# docker-compose.yml  src/  package.json

# Initialize Panopticon in this project
pan init

# Creates .panopticon/ with project config
# Does NOT modify your docker-compose.yml

# Create a workspace for a feature
pan workspace create my-feature-123

# Panopticon:
# 1. Creates workspaces/feature-my-feature-123/
# 2. Copies your docker-compose.yml
# 3. Injects Traefik labels for routing
# 4. Adds a 'dev' service for Claude Code
# 5. Sets up networking
```

#### What Panopticon Injects

```yaml
# Your original docker-compose.yml
services:
  app:
    build: .
    ports:
      - "3000:3000"

# Panopticon transforms it to:
services:
  app:
    build: .
    # ports removed - Traefik handles routing
    networks:
      - devnet
      - panopticon-public
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.app-my-feature-123.rule=Host(`my-feature-123.my-saas.localhost`)"
      - "traefik.http.routers.app-my-feature-123.entrypoints=websecure"
      - "traefik.http.routers.app-my-feature-123.tls=true"
      - "traefik.http.services.app-my-feature-123.loadbalancer.server.port=3000"

  # Injected by Panopticon
  dev:
    image: panopticon/dev-container:latest
    volumes:
      - ../:/workspace:cached
    command: sleep infinity
    networks:
      - devnet
      - panopticon-public

networks:
  devnet:
  panopticon-public:
    external: true
```

### Starter Templates (Optional)

For users without an existing docker-compose, we provide templates:

```bash
pan workspace create my-feature --template node-fullstack

# Available templates:
#   minimal        - Just a dev container (for simple scripts)
#   node-fullstack - Node.js backend + React frontend + Postgres
#   spring-react   - Spring Boot + React + Postgres + Redis (MYN's stack)
#   python-fastapi - FastAPI + React + Postgres
#   dotnet-react   - .NET 8 + React + Postgres
```

#### Template Structure

```
~/.panopticon/templates/
├── minimal/
│   ├── template.toml           # Metadata
│   └── docker-compose.yml
├── node-fullstack/
│   ├── template.toml
│   ├── docker-compose.yml
│   ├── Dockerfile.backend
│   ├── Dockerfile.frontend
│   └── .env.template
├── spring-react/
│   ├── template.toml
│   ├── docker-compose.yml
│   ├── Dockerfile
│   └── ...
└── python-fastapi/
    └── ...
```

#### Template Metadata (template.toml)

```toml
[template]
name = "node-fullstack"
description = "Node.js backend + React frontend + Postgres"
version = "1.0.0"

[services]
frontend = { port = 3000, language = "typescript" }
backend = { port = 4000, language = "typescript" }
database = { type = "postgres", port = 5432 }

[requirements]
node = ">=20.0.0"
docker = ">=24.0.0"
```

### CLAUDE.md Templating System

Each workspace gets a `CLAUDE.md` file that provides context to Claude Code. This file is assembled from **Panopticon-provided sections** (generic) and **project-specific sections** (customizable).

#### The Problem

MYN's current `CLAUDE.md.template` contains:
- Generic content (Beads commands, how to edit skills)
- MYN-specific content (MYN Principles, test users, ./dev commands, entity docs)

For Panopticon to be open source, we need to separate these concerns.

#### Layered Template System

```
┌─────────────────────────────────────────────────────────────────┐
│  CLAUDE.md Assembly                                              │
│                                                                  │
│  ~/.panopticon/templates/claude-md/     (Panopticon provides)    │
│  ├── base.md.template                                            │
│  └── sections/                                                   │
│      ├── workspace-info.md      # {{FEATURE_FOLDER}}, URLs       │
│      ├── beads.md               # bd commands reference          │
│      ├── commands-skills.md     # How to edit commands/skills    │
│      └── warnings.md            # Common warnings                │
│                                                                  │
│  project/.panopticon/claude-md/         (Project provides)       │
│  ├── project.md.template        # Project philosophy/principles  │
│  └── sections/                                                   │
│      ├── dev-commands.md        # ./dev up, ./dev api, etc.     │
│      ├── testing.md             # Test users, patterns          │
│      ├── reference-guides.md    # Links to project docs         │
│      ├── entities.md            # Data model documentation      │
│      └── security.md            # Security patterns             │
│                                                                  │
│  Assembly order defined in project.toml                          │
└─────────────────────────────────────────────────────────────────┘
```

#### Project Configuration

```toml
# .panopticon/project.toml

[claude_md]
# Sections to include, in order
# Prefix "panopticon:" = from ~/.panopticon/templates/claude-md/sections/
# Prefix "project:" = from .panopticon/claude-md/sections/
# No prefix = literal filename in .panopticon/claude-md/

sections = [
  "panopticon:workspace-info",   # Generic workspace variables
  "project:principles",          # MYN Principles (project-specific)
  "project:dev-commands",        # ./dev up, ./dev api (project-specific)
  "panopticon:beads",            # Beads commands (generic)
  "project:testing",             # Test users, fixtures (project-specific)
  "project:reference-guides",    # Links to docs (project-specific)
  "panopticon:commands-skills",  # How to edit commands/skills (generic)
  "panopticon:warnings",         # Common warnings (generic)
]

[variables]
# Project-specific variables for template substitution
PROJECT_NAME = "Mind Your Now"
PROJECT_DOMAIN = "myn.test"
TEST_USER_EMAIL = "appletester@test.com"
TEST_USER_PASSWORD = "your-test-password"
LINEAR_TEAM_ID = "354c42bd-0631-42f1-9a0d-649326ce7506"
LINEAR_TEAM_NAME = "Mind your now"
```

#### Built-in Variables

Panopticon automatically provides these variables for substitution:

| Variable | Description | Example |
|----------|-------------|---------|
| `{{FEATURE_FOLDER}}` | Workspace folder name | `feature-min-648` |
| `{{BRANCH_NAME}}` | Git branch name | `feature/min-648` |
| `{{ISSUE_ID}}` | Linear issue ID | `MIN-648` |
| `{{WORKSPACE_PATH}}` | Full workspace path | `/home/.../workspaces/feature-min-648` |
| `{{FRONTEND_URL}}` | Frontend URL | `https://feature-min-648.myn.test` |
| `{{API_URL}}` | API URL | `https://api-feature-min-648.myn.test` |
| `{{PROJECT_DOMAIN}}` | From project.toml | `myn.test` |
| `{{PROJECT_NAME}}` | From project.toml | `Mind Your Now` |

#### Example: Panopticon-Provided Section

```markdown
<!-- ~/.panopticon/templates/claude-md/sections/workspace-info.md -->

## Workspace Info

| Item | Value |
|------|-------|
| **Workspace** | {{FEATURE_FOLDER}} |
| **Frontend URL** | https://{{FEATURE_FOLDER}}.{{PROJECT_DOMAIN}} |
| **API URL** | https://api-{{FEATURE_FOLDER}}.{{PROJECT_DOMAIN}} |
| **Branch** | {{BRANCH_NAME}} |
```

#### Example: Project-Provided Section

```markdown
<!-- .panopticon/claude-md/sections/principles.md -->

## THE FOUNDATION: {{PROJECT_NAME}} Principles

**READ THIS FIRST: [`MYN-PRINCIPLES.md`](../../docs/MYN-PRINCIPLES.md)**

This is the soul of the product. Everything we build serves these principles:

| Principle | What It Means |
|-----------|---------------|
| **One criterion: URGENCY** | Not importance, not priority 1-5. Just: "Is this absolutely due today?" |
| **The Going Home Test** | "Would you work until midnight?" If no, it's not Critical Now. |
...
```

#### Workspace Creation Flow

```bash
pan workspace create min-648

# 1. Read section order from .panopticon/project.toml
# 2. Load each section file
# 3. Concatenate in order
# 4. Substitute all {{VARIABLES}}
# 5. Write to workspaces/feature-min-648/CLAUDE.md
```

#### Fallback Behavior

- If project doesn't have `.panopticon/claude-md/`, use only Panopticon sections
- If a referenced section file doesn't exist, skip it with a warning
- If no `[claude_md]` config, use default section order

### Traefik Auto-Configuration

Panopticon manages Traefik configuration automatically:

```
~/.panopticon/
├── traefik/
│   ├── docker-compose.yml      # Traefik container definition
│   ├── traefik.yml             # Static config
│   ├── dynamic/                # Dynamic configs (per-workspace)
│   │   ├── feature-min-648.yml
│   │   └── feature-min-649.yml
│   └── certs/
│       ├── _wildcard.pan.localhost.pem
│       └── _wildcard.pan.localhost-key.pem
```

#### Dynamic Config Generation

When a workspace starts, Panopticon generates:

```yaml
# ~/.panopticon/traefik/dynamic/feature-min-648.yml
http:
  routers:
    fe-min-648:
      rule: "Host(`feature-min-648.pan.localhost`)"
      entryPoints:
        - websecure
      tls: {}
      service: fe-min-648
    api-min-648:
      rule: "Host(`api-feature-min-648.pan.localhost`)"
      entryPoints:
        - websecure
      tls: {}
      service: api-min-648

  services:
    fe-min-648:
      loadBalancer:
        servers:
          - url: "http://host.docker.internal:3001"
    api-min-648:
      loadBalancer:
        servers:
          - url: "http://host.docker.internal:7001"
```

### URL Naming Conventions

| Pattern | Example | Use Case |
|---------|---------|----------|
| `feature-{issue}.{project}.localhost` | `feature-min-648.myn.localhost` | Workspace frontend |
| `api-feature-{issue}.{project}.localhost` | `api-feature-min-648.myn.localhost` | Workspace API |
| `{project}.localhost` | `myn.localhost` | Main branch (production-like) |
| `api.{project}.localhost` | `api.myn.localhost` | Main branch API |
| `pan.localhost` | `pan.localhost` | Panopticon dashboard |
| `traefik.pan.localhost` | `traefik.pan.localhost` | Traefik dashboard |

### WSL2/Windows DNS Setup

On Linux and macOS, `.localhost` domains work automatically. On Windows with WSL2, additional DNS configuration is required because:

1. **WSL2 is a separate network** - Windows can't resolve WSL2 hostnames natively
2. **Dynamic hostnames** - Each workspace creates new URLs (e.g., `feature-min-648.myn.localhost`)
3. **Wildcard DNS** - Need `*.localhost` to resolve to `127.0.0.1` in WSL2

#### Solution Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Windows                                                          │
│   Browser → C:\Windows\System32\drivers\etc\hosts               │
│             ↑                                                    │
│             sync-hosts.ps1 (scheduled task)                     │
│             ↑                                                    │
│             ~/.wsl2hosts (written by WSL2)                      │
└─────────────────────────────────────────────────────────────────┘
                              ↑
┌─────────────────────────────────────────────────────────────────┐
│ WSL2                                                             │
│   dnsmasq → resolves *.localhost → 127.0.0.1                    │
│   new-feature script → updates ~/.wsl2hosts                      │
└─────────────────────────────────────────────────────────────────┘
```

#### Component 1: dnsmasq Wildcard DNS (WSL2 Side)

dnsmasq provides wildcard DNS resolution inside WSL2. All `*.localhost` domains resolve to `127.0.0.1`.

**Reference Implementation:** `infra/setup-dns.sh`

```bash
# Key configuration (written to /etc/dnsmasq.d/panopticon.conf)
address=/localhost/127.0.0.1

# This makes *.pan.localhost, *.myn.localhost, etc. all resolve to 127.0.0.1
```

**What `pan install` will do:**
```bash
# 1. Install dnsmasq
sudo apt-get install dnsmasq

# 2. Configure wildcard resolution
echo "address=/localhost/127.0.0.1" | sudo tee /etc/dnsmasq.d/panopticon.conf

# 3. Configure systemd-resolved to use dnsmasq
# Edit /etc/systemd/resolved.conf to add DNS=127.0.0.1

# 4. Restart services
sudo systemctl restart dnsmasq
sudo systemctl restart systemd-resolved
```

#### Component 2: Windows Hosts File Sync

Windows doesn't see dnsmasq, so we sync explicit hosts entries.

**Reference Implementation:** `infra/sync-hosts.ps1`

```powershell
# Reads ~/.wsl2hosts from WSL2
# Syncs entries to C:\Windows\System32\drivers\etc\hosts
# Marks entries with comment: # panopticon-auto

# Format of ~/.wsl2hosts:
# 127.0.0.1 myn.localhost
# 127.0.0.1 api.myn.localhost
# 127.0.0.1 feature-min-648.myn.localhost
# 127.0.0.1 api-feature-min-648.myn.localhost
```

**Scheduled Task Setup:**
```powershell
# Run sync every 5 minutes (or on-demand when workspaces change)
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-File C:\Users\<user>\sync-hosts.ps1"
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName "PanopticonHostsSync" -Action $action -Trigger $trigger
```

#### Component 3: Passwordless Hosts Updates

When creating new workspaces, hosts need to be updated without password prompts.

**Reference Implementation:** `infra/setup-hosts-automation.sh`

```bash
# Creates a helper command that can be run with sudo without password
# This is used by pan workspace create to add new host entries

# /usr/local/bin/pan-add-host
#!/bin/bash
echo "127.0.0.1 $1" >> ~/.wsl2hosts

# /etc/sudoers.d/panopticon (created during pan install)
# %sudo ALL=(ALL) NOPASSWD: /usr/local/bin/pan-add-host *
```

#### Workspace Creation Flow (Windows/WSL2)

When `pan workspace create min-648` runs:

```bash
# 1. Create workspace directories, containers, etc.
# ...

# 2. Add hosts entries to ~/.wsl2hosts
echo "127.0.0.1 feature-min-648.myn.localhost" >> ~/.wsl2hosts
echo "127.0.0.1 api-feature-min-648.myn.localhost" >> ~/.wsl2hosts

# 3. Trigger Windows hosts sync (optional, runs automatically on schedule)
# Could use: powershell.exe -Command "& C:\Users\<user>\sync-hosts.ps1"
# Or just wait for scheduled task
```

#### Platform Detection

`pan install` detects the platform and configures appropriately:

| Platform | DNS Solution | Hosts Solution |
|----------|--------------|----------------|
| macOS | dnsmasq (Homebrew) | `/etc/hosts` (direct) |
| Linux | dnsmasq | `/etc/hosts` (direct) |
| WSL2 | dnsmasq | `.wsl2hosts` + PowerShell sync |
| Windows (native) | Acrylic DNS Proxy | Direct hosts file |

#### Reference Script Locations (MYN)

These existing scripts will be referenced when building Panopticon's installer:

| Script | Purpose | Location |
|--------|---------|----------|
| `setup-dns.sh` | dnsmasq wildcard DNS configuration | `/home/eltmon/projects/myn/infra/setup-dns.sh` |
| `sync-hosts.ps1` | Windows hosts file sync from WSL2 | `/home/eltmon/projects/myn/infra/sync-hosts.ps1` |
| `setup-hosts-automation.sh` | Passwordless hosts updates | `/home/eltmon/projects/myn/infra/setup-hosts-automation.sh` |

**Note:** These scripts currently use `myn.test` as the domain. Panopticon will generalize to use `.localhost` domains with project-specific subdomains (e.g., `myn.localhost`, `myproject.localhost`).

### V1 vs V2 Features

#### V1 (This Weekend)

| Feature | Status |
|---------|--------|
| `npx panopticon` CLI | ✅ Implement |
| Auto-aliasing (`pan` command) | ✅ Implement |
| `pan install` with mkcert + Traefik | ✅ Implement |
| `pan install --minimal` (no Traefik) | ✅ Implement |
| Bring Your Own Docker | ✅ Implement |
| 3 starter templates (minimal, node-fullstack, spring-react) | ✅ Implement |
| macOS + Linux support | ✅ Implement |

#### V2 (Next Sprint) - See MIN-650

| Feature | Status |
|---------|--------|
| Homebrew/apt packages | 🔜 Planned |
| Windows native support | 🔜 Planned |
| Composable building blocks | 🔜 Planned |
| Template marketplace | 🔜 Planned |
| Remote workspace support (SSH) | 🔜 Planned |
| Auto-update mechanism | 🔜 Planned |

**Linear Issue:** [MIN-650: Panopticon v2: Advanced Portability & Distribution](https://linear.app/mind-your-now/issue/MIN-650)

### Configuration Reference

#### Global Config (~/.panopticon/config.toml)

```toml
[panopticon]
version = "1.0.0"
auto_update = true

[traefik]
enabled = true
dashboard_port = 8080
domain = "pan.localhost"

[templates]
default = "minimal"
custom_path = "~/.panopticon/templates"

[cli]
alias = "pan"
shell = "auto"  # auto-detect bash/zsh/fish

[sync]
strategy = "symlink"  # or "copy"
auto_sync = true
targets = [
  "~/.claude/skills/",
  "~/.codex/skills/",
  "~/.gemini/skills/",
  "~/.gemini/antigravity/skills/"
]
```

#### Project Config (.panopticon/project.toml)

```toml
[project]
name = "my-saas"
domain = "my-saas.localhost"

[docker]
compose_file = "docker-compose.yml"
network = "panopticon-public"

[workspaces]
path = "workspaces"
naming = "feature-{issue}"  # e.g., feature-min-648

[services]
frontend = { port = 3000, healthcheck = "/health" }
backend = { port = 4000, healthcheck = "/actuator/health" }
```

### Project Hooks

Panopticon provides lifecycle hooks for project-specific automation. **Hooks are project tooling, not Panopticon tooling** - they let projects define their own scripts that Panopticon triggers at the right time.

#### Why Hooks Need Working Directories

Many projects have scripts that use relative paths. For example, MYN's `vsync` script:
- Lives in `frontend/sync-versions.js`
- References `../mind-your-now-api/` for the backend
- Must run from the `frontend/` directory

#### Hook Configuration

```toml
# .panopticon/project.toml

[hooks]
# Simple form - runs from project root
post_test = "echo 'Tests complete!'"

# Full form - with working directory
[hooks.pre_release]
command = "pnpm vsync"
cwd = "frontend"                    # Relative to project root
description = "Sync version to backend and mobile"

[hooks.post_release]
command = "git push && git push --tags"
# cwd defaults to project root if not specified

[hooks.version_bump]
command = "pnpm version ${VERSION} --no-git-tag-version"
cwd = "frontend"
env = { NODE_ENV = "production" }   # Environment variables
```

#### Available Hook Points

| Hook | When It Runs | Use Case |
|------|--------------|----------|
| `pre_workspace_create` | Before workspace is created | Validate branch name, check prerequisites |
| `post_workspace_create` | After workspace is created | Initialize workspace-specific config |
| `pre_agent_start` | Before agent spawns | Ensure services are running |
| `post_agent_complete` | After agent finishes successfully | Run tests, notify team |
| `on_agent_error` | When agent encounters an error | Send alert, create issue |
| `pre_commit` | Before committing changes | Lint, format, test |
| `post_commit` | After successful commit | Push, trigger CI |
| `pre_release` | Before release process | Version sync, changelog |
| `post_release` | After release | Push tags, deploy, notify |

#### Workspace-Aware Hooks

For hooks that should run inside a workspace (not the main repo):

```toml
[hooks.pre_commit]
command = "pnpm lint && pnpm test"
cwd = "frontend"
workspace_aware = true  # Runs in workspace's frontend/, not main repo's
```

**Execution context:**
```
workspace_aware = false (default):
  /home/user/projects/myn/frontend/  ← Runs here (main repo)

workspace_aware = true:
  /home/user/projects/myn/workspaces/feature-min-648/frontend/  ← Runs here
```

#### MYN Example: Version Sync Hook

MYN's `vsync` script syncs `package.json` version to:
- Java `Version.java` (Spring Boot backend)
- iOS `Info.plist` (Capacitor)
- Android `build.gradle` (Capacitor)

```toml
# /home/eltmon/projects/myn/.panopticon/project.toml

[project]
name = "myn"

[hooks.pre_release]
command = "pnpm vsync"
cwd = "frontend"
description = "Sync version from package.json to backend and mobile apps"

# The vsync script handles:
# - Reading version from frontend/package.json (source of truth)
# - Updating api/src/main/java/com/myn/config/Version.java
# - Updating frontend/ios/App/App/Info.plist
# - Updating frontend/android/app/build.gradle
# - Git committing all changes
```

#### Hook Variables

Hooks can use variables that Panopticon injects:

| Variable | Description | Example |
|----------|-------------|---------|
| `${PROJECT_ROOT}` | Absolute path to project | `/home/user/projects/myn` |
| `${WORKSPACE}` | Current workspace name | `feature-min-648` |
| `${WORKSPACE_PATH}` | Absolute path to workspace | `/home/.../workspaces/feature-min-648` |
| `${ISSUE_ID}` | Linear issue ID | `MIN-648` |
| `${AGENT_ID}` | Current agent's tmux session | `agent-min-648` |
| `${VERSION}` | Version being released (for release hooks) | `38.1.0` |

```toml
[hooks.post_agent_complete]
command = "echo 'Agent ${AGENT_ID} completed work on ${ISSUE_ID}' | slack-notify"
```

#### Hook Failure Handling

```toml
[hooks.pre_commit]
command = "pnpm test"
cwd = "frontend"
required = true         # If true (default), failure stops the operation
timeout = 300           # Timeout in seconds (default: 60)
retry = 2               # Number of retries on failure (default: 0)

[hooks.post_release]
command = "slack-notify 'Released ${VERSION}'"
required = false        # If false, failure is logged but doesn't stop operation
```

### npm Publishing Setup

Panopticon is distributed via npm for easy installation via `npx`.

#### Package Name

| Name | Status | Usage |
|------|--------|-------|
| `panopticon` | **Taken** | (Cluster monitoring lib from 2015) |
| `panopticon-cli` | **Available** ✅ | `npx panopticon-cli install` |
| `@mindyournow/*` | **Reserved** | For MYN-specific packages |

**Decision:** Use `panopticon-cli` (unscoped) for wider adoption. Panopticon is a general tool, not MYN-specific.

#### npm Account & Organization

- **Personal Account:** [eltmon](https://www.npmjs.com/~eltmon)
- **Organization:** [@mindyournow](https://www.npmjs.com/org/mindyournow) (free, public packages)

**Strategy:**
- `panopticon-cli` → Unscoped (general tool, wider adoption)
- `@mindyournow/*` → Future MYN-specific packages (SDK, integrations)

#### Source Code Hosting

| Project | Platform | Reason |
|---------|----------|--------|
| **Panopticon** | **GitHub** | Open source, community contributions, GitHub Actions, npm provenance |
| **MYN** | **GitLab** | Private, existing infrastructure |

Panopticon is a standalone open-source project hosted on GitHub at `github.com/eltmon/panopticon-cli`. It has no dependency on MYN's GitLab infrastructure.

#### Supply Chain Security (npm Provenance)

**What is Provenance?**

npm Provenance cryptographically proves that a package was built from a specific GitHub commit via GitHub Actions. It protects against supply chain attacks where an attacker might:
- Compromise an npm token and publish malicious code
- Publish a package that doesn't match the source repo

**How it works:**

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  GitHub Repo    │───▶│  GitHub Actions │───▶│   npm Registry  │
│  (source code)  │    │  (OIDC + build) │    │  (+ attestation)│
└─────────────────┘    └─────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌─────────────────┐
                       │    Sigstore     │
                       │  (signing key)  │
                       └─────────────────┘
```

1. GitHub Actions requests OIDC token (proves it's really GitHub)
2. Sigstore signs the package (no long-lived keys to steal)
3. npm stores the attestation linking package → commit → workflow

**What users see on npmjs.com:**

```
┌──────────────────────────────────────────────────────────┐
│  panopticon-cli                                          │
│  ✓ Provenance                                            │
│    Published from: github.com/eltmon/panopticon-cli      │
│    Commit: abc123...                                     │
│    Workflow: .github/workflows/publish.yml               │
│    Build: https://github.com/.../actions/runs/12345      │
└──────────────────────────────────────────────────────────┘
```

**Enabling Provenance:**

Already configured in our GitHub Actions workflow:
```yaml
permissions:
  id-token: write  # Required for OIDC
# ...
- run: npm publish --provenance --access public
```

**Additional Security Measures:**

| Measure | Status | Description |
|---------|--------|-------------|
| npm Provenance | ✅ Enabled | Cryptographic proof of build origin |
| 2FA on npm | ✅ Required | Account protection |
| Granular tokens | ✅ Using | Scoped to `panopticon-cli` only |
| Branch protection | 📋 TODO | Require PR reviews for main branch |
| Signed commits | 📋 TODO | GPG signing for commits |
| CODEOWNERS | 📋 TODO | Require specific reviewers |
| Dependabot | 📋 TODO | Automated dependency updates |

#### package.json Configuration

```json
{
  "name": "panopticon-cli",
  "version": "1.0.0",
  "description": "Multi-agent orchestration dashboard for Claude Code",
  "keywords": [
    "claude-code",
    "ai-agents",
    "orchestration",
    "dashboard",
    "linear",
    "devtools"
  ],
  "author": "Edward Becker <edward.becker@mindyournow.com>",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/eltmon/panopticon-cli.git"
  },
  "homepage": "https://github.com/eltmon/panopticon-cli#readme",
  "bugs": {
    "url": "https://github.com/eltmon/panopticon-cli/issues"
  },
  "bin": {
    "pan": "./dist/cli.js",
    "panopticon": "./dist/cli.js"
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": [
    "dist",
    "templates",
    "README.md"
  ],
  "engines": {
    "node": ">=18.0.0"
  },
  "scripts": {
    "build": "tsc",
    "prepublishOnly": "npm run build"
  }
}
```

#### Publishing Workflow

```bash
# 1. Login to npm (one-time)
npm login
# Username: eltmon
# Password: ********
# Email: edward.becker@mindyournow.com

# 2. Build the project
npm run build

# 3. Test locally before publishing
npm link
pan --version  # Should work

# 4. Publish to npm
npm publish

# 5. Verify it's live
npm view panopticon-cli
```

#### Version Management

```bash
# Bump version (follows semver)
npm version patch  # 1.0.0 → 1.0.1 (bug fixes)
npm version minor  # 1.0.1 → 1.1.0 (new features)
npm version major  # 1.1.0 → 2.0.0 (breaking changes)

# Publish new version
npm publish
```

#### Users Install With

```bash
# One-shot (no global install needed)
npx panopticon-cli install

# Or global install for frequent use
npm install -g panopticon-cli
pan --version
```

#### Pre-release Versions (Beta)

```bash
# Tag beta releases
npm version 1.0.0-beta.1
npm publish --tag beta

# Users install beta with:
npx panopticon-cli@beta install
```

#### GitHub Actions (Automated Publishing)

```yaml
# .github/workflows/publish.yml
name: Publish to npm

on:
  release:
    types: [published]

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write  # Required for npm provenance
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci
      - run: npm run build
      - run: npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

**Setup:**
1. Go to npmjs.com → Avatar → Access Tokens → Generate New Token
2. Choose **"Granular Access Token"** with publish permissions for `panopticon-cli`
3. Add as `NPM_TOKEN` secret in GitHub repo settings

#### npm Token Management

**Important:** As of 2025, npm enforces:
- **90-day max expiration** on granular tokens
- **2FA required** by default
- **Classic tokens revoked**

**Token Types:**

| Type | Use Case | 2FA | Expiration |
|------|----------|-----|------------|
| Granular Access Token | CI/CD publishing | Bypasses 2FA | 90 days max |
| Automation Token | Legacy CI/CD | Bypasses 2FA | 90 days max |

**Rotation Strategy:**

There's no fully automated rotation. Options:

1. **Calendar reminder** - Set reminder for day 80, manually rotate
2. **GitHub Action for rotation** (advanced):
   ```yaml
   # .github/workflows/rotate-npm-token.yml
   name: Rotate npm Token Reminder
   on:
     schedule:
       - cron: '0 9 1 */2 *'  # 1st of every 2nd month
   jobs:
     remind:
       runs-on: ubuntu-latest
       steps:
         - name: Create reminder issue
           uses: actions/github-script@v7
           with:
             script: |
               github.rest.issues.create({
                 owner: context.repo.owner,
                 repo: context.repo.repo,
                 title: '🔑 npm Token Rotation Due',
                 body: 'Time to rotate NPM_TOKEN secret. Go to npmjs.com → Access Tokens.',
                 labels: ['maintenance']
               })
   ```

3. **npm Provenance** (recommended) - Adds supply chain security even though token is still required:
   - Package shows "Published via GitHub Actions" badge on npmjs.com
   - Verifiable build provenance
   - Use `--provenance` flag as shown above

**Local Development (WSL2):**

Browser-based login doesn't work well in WSL2. Options:
- Copy the login URL manually to Windows browser
- Or add token directly to `~/.npmrc`:
  ```bash
  echo "//registry.npmjs.org/:_authToken=YOUR_TOKEN" >> ~/.npmrc
  ```

---

## Part 15: Per-Feature Cost Tracking

### The Problem

When running autonomous agents on Linear issues, there's no visibility into **how much each feature costs** in tokens and dollars. This makes it impossible to:

- Budget for features accurately
- Compare agent efficiency across runtimes
- Identify cost outliers (runaway agents, stuck loops)
- Calculate ROI for AI-assisted development

### Data Sources

All major AI coding tools log token usage to local files:

| Runtime | Token Data Location | Format |
|---------|---------------------|--------|
| **Claude Code** | `~/.claude/projects/<path>/<session>.jsonl` | Per-message `usage` object |
| **Codex CLI** | `~/.codex/sessions/<session>.jsonl` | `token_count` events |
| **Gemini CLI** | `/stats` command + Billing API | API response |

**Claude Code JSONL Structure:**

```json
{
  "sessionId": "037ae6b1-826d-4b2f-ae80-9b467abb7e43",
  "timestamp": "2026-01-17T10:30:00.000Z",
  "message": {
    "model": "claude-opus-4-5-20251101",
    "usage": {
      "input_tokens": 1500,
      "output_tokens": 500,
      "cache_creation_input_tokens": 30000,
      "cache_read_input_tokens": 10000
    }
  }
}
```

### Solution: Session-to-Issue Linking

When Panopticon spawns an agent for an issue, it records the session ID in the agent state. When the agent completes, Panopticon:

1. **Parses the JSONL file** for that session ID
2. **Sums all token usage** across messages
3. **Calculates cost** using model-specific pricing
4. **Stores cost data** in `~/.panopticon/costs/<issue-id>.json`
5. **Updates the bead** with cost metadata

### Cost Calculation

Pricing per 1M tokens (January 2026):

| Model | Input | Output | Cache Create | Cache Read |
|-------|-------|--------|--------------|------------|
| Claude Opus 4.5 | $15.00 | $75.00 | $18.75 | $1.50 |
| Claude Sonnet 4 | $3.00 | $15.00 | $3.75 | $0.30 |
| Claude Haiku 4 | $0.80 | $4.00 | $1.00 | $0.08 |
| GPT-5 | $5.00 | $15.00 | - | - |
| Gemini 3 Pro | $2.00 | $6.00 | - | - |

### User Interface

**CLI:**

```bash
# Cost for a specific issue
pan cost MIN-123
# Output:
# Cost Report: MIN-123
# Total Cost: $2.47
# Tokens: 1.2M input, 45K output, 2.1M cache
# Sessions: 3
# Models: opus (40%), sonnet (60%)

# Daily aggregate costs
pan cost --daily
# Output:
# 2026-01-17: $12.50 (5 issues)
# 2026-01-16: $8.30 (3 issues)

# JSON output for automation
pan cost MIN-123 --json
```

**Dashboard:**

- Kanban cards show cost badge: `$2.47`
- Issue detail view shows full breakdown
- Daily/weekly cost charts

**Beads Integration:**

```bash
bd show MIN-123
# ...
# Cost: $2.47 (3 sessions, 1.2M tokens)
```

### Implementation Notes

1. **No external dependencies**: We parse JSONL ourselves (not relying on ccusage at runtime)
2. **ccusage-compatible**: Same JSONL format, can use ccusage for verification
3. **Multi-runtime**: Each runtime has its own parser module
4. **Aggregation**: Costs aggregate across multiple sessions per issue
5. **Real-time (future)**: Could show running cost during agent work

### Related Tools

- **[ccusage](https://github.com/ryoppippi/ccusage)**: CLI tool for analyzing Claude Code/Codex usage (reference implementation)
- **[Claude Code Usage Monitor](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor)**: Real-time monitoring with predictions
- **[Codextime](https://codexti.me/)**: Codex cost tracking with team analytics

---

## Appendix A: Key Concepts Reference

| Concept | Source | Description |
|---------|--------|-------------|
| Dynamic Context Discovery | Cursor | Pull context on demand vs. load upfront |
| FPP | Gastown | Fixed Point Principle - "If work on hook, MUST run" |
| NDI | Gastown | Nondeterministic Idempotence |
| Hooks | Gastown | Agent work queues |
| Skills | Claude Code | Markdown workflow guidance (progressive disclosure) |
| AGENTS.md | Codex/Factory | Cross-platform skill standard |
| Beads | Gastown | Persistent state tracking for multi-session work |
| Deacon | Gastown | Health monitoring daemon |
| STATE.md | GSD-Plus | Living project memory |
| Context Engineering | GSD-Plus | Structured AI context |
| Materialization | Cursor | Write outputs to files |
| Molecules (deprecated) | Gastown | TOML workflows, replaced by Skills |

---

## Appendix B: Comparisons (FAQ)

### How does Panopticon compare to Gastown?

**Gastown** (by Steve Yegge) is a Go-based CLI tool for multi-agent workspace management. It's a comprehensive system with many advanced concepts.

| Aspect | Panopticon | Gastown |
|--------|------------|---------|
| **Language** | TypeScript/Node.js | Go |
| **Interface** | Web dashboard + CLI commands | CLI only (`gt` command) |
| **Work Tracking** | Beads (adopted from Gastown) | Beads (native) |
| **Agent Runtime** | Claude Code primary, multi-runtime planned | Multi-runtime native (Claude, Codex, Gemini) |
| **Configuration** | TOML files | TOML files (Formulas) |
| **Issue Tracker** | Linear integration | GitHub Issues, Linear, Jira |
| **Complexity** | Simpler, opinionated | Feature-rich, 50+ internal packages |

**Key Gastown concepts we're adopting:**
- **Beads** - Git-backed work tracking (ESSENTIAL)
- **FPP** - Fixed Point Principle - "Any runnable action is a fixed point and must resolve" - self-propelling agents
- **Hooks** - Persistent work state via git worktrees
- **Deacon** - Watchdog agent for stuck detection

**Why not just use Gastown?**
Gastown is excellent but represents a different paradigm. It's a complete replacement for your development workflow. Panopticon is designed to **extend Claude Code** rather than replace it. If you're already invested in Claude Code's ecosystem (skills, commands, MCP servers), Panopticon feels like a natural extension.

### How does Panopticon compare to Vibe Kanban?

**Vibe Kanban** (by BloopAI) is a Rust/React task orchestration dashboard for coding agents.

| Aspect | Panopticon | Vibe Kanban |
|--------|------------|-------------|
| **Language** | TypeScript/Node.js | Rust + React |
| **Install** | `npm install -g panopticon` | `npx vibe-kanban` |
| **Database** | Git (Beads) | SQLite |
| **Task Source** | Linear (primary) | Local kanban board |
| **Agent Runtimes** | Claude Code, Codex, Cursor, Gemini CLI, Antigravity | Claude, Codex, Gemini, Amp |
| **Isolation** | Docker workspaces + git worktrees | Git worktrees |
| **Focus** | Claude Code ecosystem extension | Runtime-agnostic orchestration |

**What Vibe Kanban does well:**
- Polished, production-ready UI
- Multi-agent parallel/sequential execution
- Runtime switching (Claude ↔ Codex ↔ Gemini)
- MCP config centralization
- Remote SSH support for server deployments

**Where Panopticon differs:**
- **Opinionated Linear workflow** - Vibe Kanban uses its own task board; Panopticon syncs with Linear
- **Claude Code native** - Skills, commands, and agents are first-class Claude Code concepts
- **Beads for durability** - Git-backed state survives crashes, can be audited, and syncs across machines
- **Workspace isolation** - Full Docker containers per feature branch, not just worktrees

### Can Panopticon and Vibe Kanban work together?

**Theoretically yes, but with friction.** They solve similar problems differently:

- Both spawn agents in tmux sessions
- Both track agent status and output
- Both support multiple runtimes

The conflict is in **task management**: Vibe Kanban wants to be your task source (its kanban board), while Panopticon syncs from Linear. Running both would mean duplicate task tracking.

**Possible integration path:** Use Vibe Kanban's runtime abstraction layer inside Panopticon. Their runtime switching code is well-designed and could be extracted as a library.

### Can Panopticon and Gastown work together?

**Yes, through Beads.** This is the recommended integration:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Panopticon │────▶│   Beads     │◀────│   Gastown   │
│  (TypeScript)│     │  (shared)   │     │    (Go)     │
└─────────────┘     └─────────────┘     └─────────────┘
```

Beads is a standalone Git-backed tracking system. Both tools can read/write to the same `.beads/` directory:

1. Panopticon spawns agent for MIN-630 → creates Bead
2. Gastown's `gt status` sees the same Bead
3. Either tool can update progress
4. Git sync keeps everything in sync across machines

**What you get:**
- Use Panopticon's dashboard for visualization
- Use Gastown's `gt` CLI for power-user operations
- Use Gastown's Deacon for stuck agent detection
- Share work history across both tools

### Why build Panopticon when these tools exist?

**Short answer:** Neither tool fits the exact workflow we need.

| Requirement | Gastown | Vibe Kanban | Panopticon |
|-------------|---------|-------------|------------|
| Linear as source of truth | Partial | No | Yes |
| Claude Code skills/commands | No | No | Yes |
| Web dashboard | No | Yes | Yes |
| Docker workspace isolation | No | No | Yes |
| Git-backed state | Yes (Beads) | No (SQLite) | Yes (Beads) |
| Opinionated MYN workflow | No | No | Yes |

**The real reason:** Panopticon started as the internal tooling for Mind Your Now development. It's opinionated because it encodes **our** workflow. Open-sourcing it means others with similar workflows can benefit, while those with different needs can fork or use Gastown/Vibe Kanban.

### Should I use Panopticon, Gastown, or Vibe Kanban?

**Use Panopticon if:**
- You use Linear for issue tracking
- You're invested in Claude Code's ecosystem
- You want Docker-isolated workspaces per feature
- You prefer TypeScript/Node.js tooling
- You want Beads for durable, auditable work tracking

**Use Gastown if:**
- You want the most feature-complete solution
- You prefer Go and CLI-first workflows
- You need advanced features (Convoys, Molecules, Mail)
- You want to replace your entire dev workflow

**Use Vibe Kanban if:**
- You want the most polished UI out of the box
- You don't use Linear (prefer local task management)
- You frequently switch between Claude, Codex, and Gemini
- You need remote server deployment with SSH

**Use multiple:**
- Panopticon + Gastown (via shared Beads) is a valid setup
- Vibe Kanban is harder to combine due to task management overlap

---

## Appendix C: References

**Architecture Sources:**
1. **Cursor Dynamic Context Discovery**: https://cursor.com/blog/dynamic-context-discovery
2. **Gastown**: /home/eltmon/projects/gastown/
3. **GSD-Plus**: /home/eltmon/projects/gsd-plus/
4. **Current Dashboard**: /home/eltmon/projects/myn/infra/dashboard/
5. **Beads**: https://github.com/steveyegge/beads

**Skill Format Documentation:**
6. **Claude Code Skills**: https://code.claude.com/docs/en/skills
7. **Codex Skills**: https://developers.openai.com/codex/skills/create-skill/
8. **Cursor Skills**: https://cursor.com/docs/context/skills
9. **AGENTS.md Standard**: https://developers.openai.com/codex/guides/agents-md

---

## Appendix D: Open Questions

### Resolved ✅

1. ~~**npm vs standalone binary?**~~ → **npm with npx + auto-aliasing** (See Part 14)
   - `npx panopticon init` for first run, then `pan` alias works
   - Homebrew/apt packages in v2 (MIN-650)

2. ~~**How to handle Claude Code updates?**~~ → **Symlinks are safe**
   - Claude Code doesn't overwrite symlinks in `~/.claude/skills/`
   - Canonical source stays in `~/.panopticon/skills/`

3. ~~**Project templates?**~~ → **"Bring Your Own Docker" + starter templates** (See Part 14)
   - Users provide their own docker-compose, Panopticon injects Traefik labels
   - 3 starter templates for users without existing setup (minimal, node-fullstack, spring-react)

4. ~~**Agent handoff?**~~ → **Beads state + SUMMARY.md**
   - Agent writes SUMMARY.md before context compaction
   - New agent reads Beads state + SUMMARY.md to resume
   - Claude Code's automatic compaction handles the transition
   - Explicit state handoff is cleaner than automatic checkpointing

5. ~~**Context budget enforcement**~~ → **Not needed, Claude Code handles it**
   - Claude Code automatically compacts context when needed
   - Panopticon just ensures Beads state survives compaction
   - No need for Panopticon to enforce budgets or warn about limits

6. ~~**Skill versioning**~~ → **Instant updates via symlinks are fine**
   - Skills are guidance, not executable code
   - Mid-execution updates are safe (agent re-reads skill when needed)
   - If truly dangerous, agent can copy skill content to workspace at start

7. ~~**Convoy coordination**~~ → **File-based sharing in workspace** (See analysis below)
   - Each parallel agent writes to `workspaces/feature-X/.convoy/<agent-role>.md`
   - Synthesis agent reads all files from `.convoy/` directory
   - Simple, debuggable, works with any runtime

8. ~~**Beads hook vs Linear sync**~~ → **Linear = source of truth, Beads = execution state**
   - Linear defines what work exists (issues, priorities, assignments)
   - Beads tracks execution (progress, notes, blockers, history)
   - No conflict - they serve different purposes
   - Linear is read occasionally, Beads is written constantly

9. ~~**Dashboard framework**~~ → **React/Vite + Node.js backend**
   - Current implementation works well
   - React frontend with Vite for dev
   - Node.js backend (Express) for API
   - No reason to change

10. ~~**Config format**~~ → **TOML** (See Part 14 Configuration Reference)
    - Consistent with Beads, Gastown, and Rust ecosystem
    - `~/.panopticon/config.toml` and `.panopticon/project.toml`

11. ~~**npm package structure**~~ → **Single repo, single package.json**
    - Panopticon is one application, not a library ecosystem
    - Structure: `src/cli/`, `src/dashboard/`, `server/`
    - No need for monorepo complexity

### Convoy Coordination Analysis (Question #7)

When multiple agents work in parallel (convoy), they need to share findings for synthesis.

**Options Evaluated:**

| Approach | How It Works | Pros | Cons |
|----------|--------------|------|------|
| **File-based (chosen)** | Each agent writes to `.convoy/<role>.md` | Simple, debuggable, works offline | Requires filesystem access |
| **Shared Beads** | Agents write notes to shared Bead | Integrated with existing system | Beads is for tracking, not data sharing |
| **Message passing** | Panopticon relays messages between agents | Real-time coordination | Complex, requires always-on server |
| **Database** | Shared SQLite/Postgres | Structured queries | Overkill, adds dependency |

**Chosen: File-based sharing**

```
workspaces/feature-min-648/
├── .convoy/
│   ├── manifest.json         # Convoy metadata (agents, status)
│   ├── security.md           # Security agent's findings
│   ├── performance.md        # Performance agent's findings
│   ├── correctness.md        # Correctness agent's findings
│   └── synthesis.md          # Final combined report
├── fe/
└── api/
```

**Workflow:**

```bash
# 1. Mayor spawns convoy
/work-review MIN-648 --convoy

# 2. Panopticon creates manifest
{
  "convoy_id": "review-min-648",
  "issue": "MIN-648",
  "agents": [
    { "role": "security", "status": "running", "agent_id": "agent-min-648-security" },
    { "role": "performance", "status": "running", "agent_id": "agent-min-648-perf" },
    { "role": "correctness", "status": "running", "agent_id": "agent-min-648-correct" },
    { "role": "synthesis", "status": "waiting", "agent_id": "agent-min-648-synth" }
  ]
}

# 3. Each agent writes findings to their file
# security agent → .convoy/security.md
# performance agent → .convoy/performance.md

# 4. Synthesis agent polls manifest, waits for all "complete"
# Then reads all .md files, writes synthesis.md

# 5. Synthesis agent updates Linear/Beads with combined findings
```

**Why this is best:**

1. **Simple** - Just files, no infrastructure
2. **Debuggable** - Human can read `.convoy/` files directly
3. **Resilient** - Works if agents crash, files persist
4. **Runtime-agnostic** - Works with Claude, Codex, Gemini (all can read/write files)

### All Questions Resolved ✅

All open questions have been answered. Panopticon PRD is ready for implementation.

---

## Part 16: PRD Convention and Project Initialization

### The Canonical PRD

Every Panopticon-managed project has a **canonical PRD** (`docs/PRD.md`) that defines the core product vision, architecture, and requirements. This serves as the ground truth that agents reference when working on the project.

### PRD Hierarchy

```
{project}/
├── docs/
│   └── PRD.md                     # Canonical PRD (core product)
├── workspaces/
│   └── feature-{issue}/
│       └── docs/
│           └── {ISSUE}-plan.md    # Feature PRD (in feature branch)
└── .planning/
    └── {issue}/
        ├── PLANNING_PROMPT.md     # Agent planning prompt
        └── STATE.md               # Planning session state
```

### Feature PRDs Live in Workspaces

When planning starts for an issue, Panopticon creates a feature PRD in the workspace (git worktree). This design decision is intentional:

| Approach | Pros | Cons |
|----------|------|------|
| **PRD in main** | Survives workspace deletion | Orphaned PRDs if work abandoned |
| **PRD in workspace** ✅ | Merged with PR, clean separation | Lost if workspace deleted |

**Decision:** Feature PRDs live in workspaces because:

1. **Documentation travels with code** - The feature PRD gets merged when the PR merges
2. **No orphans** - Deleting a workspace (aborting work) also removes its PRD
3. **Clean lifecycle** - Each feature is self-contained in its branch

### Project Initialization Flow

When registering a new project with `pan project add`, Panopticon performs PRD discovery:

```
┌─────────────────────────────────────────────────────────────┐
│                   PRD Discovery Flow                         │
└─────────────────────────────────────────────────────────────┘

1. Search for existing PRD
   ├── docs/PRD.md
   ├── PRD.md
   ├── README.md (if substantial)
   └── Other documentation files

2. If PRD found:
   ├── Parse existing content
   ├── Identify missing sections (goals, architecture, etc.)
   └── Prompt user for missing information

3. If no PRD found:
   ├── Analyze codebase structure
   ├── Identify technologies and patterns
   ├── Ask discovery questions:
   │   ├── What is this project's purpose?
   │   ├── Who are the target users?
   │   ├── What are the core features?
   │   └── What are the technical constraints?
   └── Generate canonical PRD from responses

4. Write docs/PRD.md in canonical format
```

### Canonical PRD Sections

Every canonical PRD should include (agent will prompt for missing sections):

| Section | Required | Description |
|---------|----------|-------------|
| **Executive Summary** | ✅ | One-paragraph product description |
| **Goals & Non-Goals** | ✅ | What we're building and explicitly NOT building |
| **User Personas** | ✅ | Who uses this product |
| **Core Features** | ✅ | Primary functionality |
| **Architecture** | ✅ | Technical structure |
| **Tech Stack** | ✅ | Languages, frameworks, infrastructure |
| **API/Interface Contracts** | Optional | External interfaces |
| **Data Model** | Optional | Key entities and relationships |
| **Security Considerations** | Optional | Auth, permissions, threats |
| **Open Questions** | Optional | Unresolved decisions |

### Naming Convention

| Document Type | Name Format | Example |
|--------------|-------------|---------|
| Canonical PRD | `PRD.md` | `docs/PRD.md` |
| Feature PRD | `{ISSUE}-plan.md` | `PAN-4-plan.md` |
| Planning prompt | `PLANNING_PROMPT.md` | `.planning/pan-4/PLANNING_PROMPT.md` |
| Planning state | `STATE.md` | `.planning/pan-4/STATE.md` |

### CLI Commands

```bash
# Initialize/regenerate canonical PRD
pan prd init

# Show PRD status
pan prd status
# Output:
# Canonical PRD: docs/PRD.md ✅
# Last updated: 2026-01-15
# Sections: 8/10 complete
# Missing: Security Considerations, Open Questions

# Validate PRD completeness
pan prd validate
```

### Agent Integration

When an agent is spawned for an issue, it automatically has access to:

1. **Canonical PRD** - Always included in context for product understanding
2. **Feature PRD** - If planning has been completed for this issue
3. **Related PRDs** - If the issue references other features

This ensures agents understand both the overall product vision and the specific feature requirements.

---

*Document created: 2026-01-16 (Original PRD)*
*Merged: 2026-01-17 (Combined with Expanded Thoughts)*
*Part 14 added: 2026-01-17 (Installation, CLI & Portability)*
*Part 15 added: 2026-01-17 (Per-Feature Cost Tracking)*
*Part 16 added: 2026-01-19 (PRD Convention and Project Initialization)*
*Ready for: Weekend Implementation*
