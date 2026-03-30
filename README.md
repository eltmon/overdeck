<div align="center">

# Panopticon CLI

**Multi-agent orchestration for AI coding assistants**

[![npm version](https://img.shields.io/npm/v/panopticon-cli.svg)](https://www.npmjs.com/package/panopticon-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/eltmon/panopticon-cli/pulls)

> *"The Panopticon had six sides, one for each of the Founders of Gallifrey..."*
>
> — Classic Doctor Who. The Panopticon was the great hall at the heart of the Time Lord Citadel, where all could be observed. We liked the metaphor.

</div>

Panopticon CLI is an open-source control plane for multi-agent software development. It connects to your issue tracker — GitHub Issues, Linear, GitLab, Jira, or Rally — and manages the full agent lifecycle from planning through merge. When you assign an issue to Panopticon, an Opus-class model reads the ticket and writes a detailed PRD, then hands off to a cost-effective implementation model (configurable per project — Kimi, Sonnet, GPT, Gemini, or others) that writes code in an isolated git worktree. Once the implementation agent signals completion, a review specialist diffs the changes against the PRD and original issue spec, a test specialist runs your CI pipeline against the branch, and a merge specialist opens the PR — all without human intervention until you click **Merge**. Each of these stages runs as a separate agent process in its own tmux session with full terminal I/O, so you can attach to any session mid-flight, read its scrollback, or send it commands directly. Coordinating all of this is a lifecycle manager called **Cloister**, which routes tasks to models based on capability and cost, monitors agent health through heuristics on output cadence and token throughput, detects and recovers stuck sessions, tracks per-issue token spend across every stage, and orchestrates the handoff sequence between specialists. Everything is observable through **Mission Control**, a real-time dashboard that surfaces kanban boards, activity feeds, per-agent status and logs, cost analytics, and the full specialist pipeline state across all registered projects in a single browser tab.

AI coding agents — Claude Code, Codex, Cursor, Gemini CLI — can hold a file tree in context, generate working diffs, and iterate on compiler errors autonomously, but what they cannot do on their own is coordinate with each other. A single agent has no awareness of what other agents are working on in the same repo, no built-in mechanism for separating planning from implementation, no way to enforce a review gate between code generation and merge, no persistent memory of project conventions across sessions, and no cost controls beyond whatever the provider dashboard shows you after the fact. In practice this means a developer ends up manually sequencing work, copying context between terminals, re-explaining architectural constraints that were already covered in a previous session, running CI themselves, and reviewing diffs that no second model has ever seen. That workflow scales inversely — every additional agent in flight multiplies the coordination overhead rather than reducing it, because the orchestration layer between them is a human being.

The system is built around a few core primitives. **Workspaces** are git-worktree-based feature branches with optional Docker isolation, so agents never touch your main branch. **Skills** are portable markdown instructions — one SKILL.md works across Claude Code, Codex, Cursor, and Gemini CLI — that ship with Panopticon and sync via `pan sync`. **Beads** provide git-backed task tracking that survives context window compaction and works offline. And **Convoys** let you fan out parallel agents across related issues and synthesize the results when they converge.

Panopticon was originally built as part of [Mind Your Now](https://mindyournow.com), a greenfield React and Spring Boot application. The decision to decouple it and release it as a standalone open-source project came from thinking about a harder problem: legacy codebases. AI coding assistants are trained on modern, well-documented open-source code, and they struggle on mature enterprise systems — mixed naming conventions, undocumented tribal knowledge, schemas that don't match the ORM, build systems with institutional quirks. Every agent session starts from zero and repeats the same mistakes. Panopticon's skills system offered a natural answer to this. Because skills are just version-controlled markdown files in your repo's `.claude/skills/` directory, a team can collaboratively build up a persistent knowledge base of their codebase's conventions, gotchas, and architectural decisions. When one developer teaches the AI something, every developer — and every future agent session — inherits that knowledge automatically.

Panopticon ships with two self-monitoring skills designed specifically for this. **Knowledge Capture** detects when an agent gets corrected and prompts to document the learning as a project skill. **Refactor Radar** identifies systemic patterns that cause repeated AI confusion — naming inconsistencies across layers, schema/model mismatches, mixed async patterns — and creates refactoring proposals with evidence and migration paths. Together they turn a codebase that AI struggles with into one that improves over time. See [Legacy Codebase Support](docs/LEGACY-CODEBASE.md) for a deeper look at how this works in practice.

<div align="center">

<img src="docs/screenshot-board.png" alt="Panopticon Kanban Board" width="800" />

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
<td><img src="docs/dashboard-overview.png" alt="Mission Control" width="400" /></td>
<td><img src="docs/screenshot-agents.png" alt="Agent Management" width="400" /></td>
</tr>
<tr>
<td align="center"><em>Mission Control — project tree, activity timeline, specialist pipeline</em></td>
<td align="center"><em>Cloister Deacon, specialist agents, and issue agent management</em></td>
</tr>
<tr>
<td colspan="2"><img src="docs/screenshot-settings.png" alt="Model Routing Settings" width="800" /></td>
</tr>
<tr>
<td colspan="2" align="center"><em>Tracker integration and capability-based model routing</em></td>
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
