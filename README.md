<div align="center">

# Panopticon CLI

**Multi-agent orchestration for AI coding assistants**

[![npm version](https://img.shields.io/npm/v/panopticon-cli.svg)](https://www.npmjs.com/package/panopticon-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/eltmon/panopticon-cli/pulls)

Spawn AI agents from a dashboard. Route tasks to the right model. Review, test, and merge automatically.

<img src="docs/dashboard-overview.png" alt="Panopticon Mission Control" width="800" />

</div>

---

## Why Panopticon?

- **Stop babysitting agents.** Spawn them from a dashboard, monitor progress in real time, and let specialists handle code review, testing, and merging.
- **Use the right model for the job.** Opus for planning, Kimi for implementation, Haiku for quick commands — automatic routing based on task type and required capabilities.
- **Work survives across sessions.** PRDs, state files, beads, and skills persist context so agents don't start from zero every time.
- **One skill format, every tool.** Write a SKILL.md once and it works across Claude Code, Codex, Cursor, and Gemini CLI.

---

## How It Works

```
 Issue         PRD           Agent         Review        Test          Merge
┌──────┐    ┌──────┐    ┌──────────┐    ┌──────┐    ┌──────┐    ┌──────────┐
│ Task │ ─► │ Plan │ ─► │ Write    │ ─► │ Code │ ─► │ Run  │ ─► │ PR       │
│ from │    │ with │    │ code in  │    │ rev. │    │ test │    │ merged   │
│ any  │    │ Opus │    │ isolated │    │ by   │    │ by   │    │ by       │
│track-│    │      │    │ worktree │    │ spec-│    │ spec-│    │ spec-    │
│ er   │    │      │    │          │    │ialist│    │ialist│    │ ialist   │
└──────┘    └──────┘    └──────────┘    └──────┘    └──────┘    └──────────┘
 GitHub       Opus        Kimi/Sonnet    Opus        Sonnet       Sonnet
 Linear                   (routed)
 GitLab
 Jira
 Rally
```

Create a workspace, and Panopticon handles the rest: planning with Opus, implementation with your configured model, automated code review, test execution, and merge — the only manual step is clicking **MERGE** when you're satisfied.

---

## Key Features

| Feature | Description |
|:--------|:------------|
| **Multi-Agent Orchestration** | Spawn and manage AI agents in tmux sessions via dashboard or CLI |
| **Cloister Lifecycle Manager** | Automatic model routing, stuck detection, cost tracking, and specialist handoffs |
| **Mission Control** | 11-view dashboard — project tree, activity feed, kanban board, agent status, costs, metrics, and more |
| **PRD-Driven Workflow** | Opus writes a PRD before implementation starts; agents are blocked without one |
| **67+ Universal Skills** | Pre-built skills ship out of the box, synced via `pan sync` — one SKILL.md works across all AI tools |
| **Multi-Tracker Support** | GitHub Issues, Linear, GitLab, Jira, Rally — all from one dashboard |
| **Multi-Model Routing** | Anthropic, OpenAI, Google, Kimi, Zhipu — route by task type, capability, and budget |
| **Workspaces** | Git worktree-based feature branches with Docker isolation (local and remote via exe.dev) |
| **Convoys** | Run parallel agents on related issues with automatic synthesis |
| **Specialists** | Dedicated review, test, and merge agents — fully automated quality pipeline |
| **Beads** | Git-backed task tracking that survives context compaction and works offline |
| **Cost Tracking** | Per-issue, per-stage token costs with dashboard analytics |
| **Legacy Codebase Support** | AI self-monitoring skills that learn your codebase conventions over time ([details](docs/LEGACY-CODEBASE.md)) |

---

## Screenshots

<div align="center">
<table>
<tr>
<td><img src="docs/screenshot-board.png" alt="Kanban Board" width="400" /></td>
<td><img src="docs/screenshot-agents.png" alt="Agent Management" width="400" /></td>
</tr>
<tr>
<td align="center"><em>Kanban board with issue cards, cost tracking, and agent controls</em></td>
<td align="center"><em>Cloister Deacon, specialist agents, and issue agent management</em></td>
</tr>
<tr>
<td colspan="2"><img src="docs/screenshot-settings.png" alt="Model Routing Settings" width="800" /></td>
</tr>
<tr>
<td colspan="2" align="center"><em>Capability-based model routing — assign the right model to each task type</em></td>
</tr>
</table>
</div>

---

## Supported Tools

| Tool | Support |
|:-----|:--------|
| **Claude Code** | Full support — agent runtime, hooks, skills |
| **Codex** | Skills sync |
| **Cursor** | Skills sync |
| **Gemini CLI** | Skills sync |
| **Google Antigravity** | Skills sync |

---

## Quick Start

```bash
npm install -g panopticon-cli && pan install && pan sync && pan up
```

**That's it!** Dashboard runs at https://pan.localhost (or http://localhost:3010 if you skip HTTPS setup).

---

## Requirements

### Required
- Node.js 18+
- Git (for worktree-based workspaces)
- Docker (for Traefik and workspace containers)
- tmux (for agent sessions)
- **GitHub CLI (`gh`)** or **GitLab CLI (`glab`)** for Git operations
- **ttyd** - Auto-installed by `pan install`

### Optional
- **mkcert** - For HTTPS certificates (recommended)
- **Linear API key** - For Linear issue tracking
- **Beads CLI** - Auto-installed by `pan install`

---

## Configuration

```bash
# Create config file
~/.panopticon.env

# Add API keys
LINEAR_API_KEY=lin_api_xxxxx
GITHUB_TOKEN=ghp_xxxxx  # Optional
```

Register your projects:

```bash
pan project add /path/to/your/project --name myproject
```

---

## Key Concepts

**Mission Control** — The default view. Project tree on the left, agent activity on the right. Click a feature to see its full pipeline: planning, work, review, test results. Badge bar gives quick access to PRDs, state files, discussions, and transcripts.

**Cloister** — The lifecycle manager. Routes tasks to models based on capabilities, detects stuck agents, triggers specialist handoffs, and tracks costs.

**Workspaces** — Git worktree-based feature branches with optional Docker isolation. Each issue gets its own isolated environment. Supports both local and remote (exe.dev) execution.

**Specialists** — Dedicated agents for code review, testing, and merging. Triggered automatically by Cloister when an agent signals completion. The pipeline is fully automated — code review to merge with zero human intervention (except the final merge click).

**Convoys** — Run parallel agents on related issues. Useful for security audits, performance reviews, or breaking an epic into concurrent work streams. Results are auto-synthesized.

**Skills** — Universal SKILL.md format works across Claude Code, Codex, Cursor, and Gemini. 67+ skills ship out of the box covering development workflows, code review, incident response, and more.

**Shadow Engineering** — Monitor existing workflows before transitioning to AI-driven development. Upload transcripts, sync discussions, generate inference documents.

---

## Common Commands

```bash
# Start dashboard
pan up

# Create workspace and spawn agent
pan workspace create PAN-123

# Check agent status
pan status

# View agent logs
pan logs agent-pan-123

# Stop dashboard
pan down
```

---

## Maturity

Panopticon is actively used in production to develop itself and multiple other projects.

- **62 PRDs** written (16 active, 46 completed)
- **67+ skills** shipped and synced across tools
- **5 tracker integrations** (GitHub, Linear, GitLab, Jira, Rally)
- **6 AI providers** with capability-based model routing
- **v0.4.33** — hundreds of issues completed through the full pipeline

---

## Documentation

| Document | Description |
|----------|-------------|
| [docs/INDEX.md](docs/INDEX.md) | Master documentation index (start here) |
| [docs/USAGE.md](docs/USAGE.md) | Detailed usage guide, examples, troubleshooting |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | Model routing, API setup, presets |
| [AGENTS.md](AGENTS.md) | Agent architecture |
| [docs/SPECIALIST_WORKFLOW.md](docs/SPECIALIST_WORKFLOW.md) | Review, test, merge pipeline |
| [docs/LEGACY-CODEBASE.md](docs/LEGACY-CODEBASE.md) | AI adaptive learning for legacy codebases |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contribution guidelines |
| [CLAUDE.md](CLAUDE.md) | Agent development guidance |

---

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

<div align="center">
<p><a href="https://github.com/eltmon/panopticon-cli">GitHub</a> · <a href="https://www.npmjs.com/package/panopticon-cli">npm</a> · <a href="docs/INDEX.md">Documentation</a></p>
</div>
