<div align="center">

# Panopticon CLI

**Multi-agent orchestration for AI coding assistants**

[![npm version](https://img.shields.io/npm/v/panopticon-cli.svg)](https://www.npmjs.com/package/panopticon-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](https://nodejs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/eltmon/panopticon-cli/pulls)

> *"The Panopticon had six sides, one for each of the Founders of Gallifrey..."*
>
> — Classic Doctor Who. The Panopticon was the great hall at the heart of the Time Lord Citadel, where all could be observed. We liked the metaphor.

</div>

Panopticon is an open-source control plane for multi-agent software development. It connects to your issue tracker, assigns an Opus-class model to write a PRD, hands implementation to a cost-effective model working in an isolated git worktree, then runs automated code review, testing, inspection, and merge through five dedicated specialist agents. The only human step is clicking **Merge**. Every stage runs as a separate process in its own tmux session with full terminal I/O — attach mid-flight, read scrollback, or send commands directly. A lifecycle manager called **Cloister** handles model routing, stuck detection, cost tracking, and specialist coordination. Everything is observable through **Mission Control**, a 13-view real-time dashboard.

<div align="center">

<img src="docs/screenshot-board.png" alt="Panopticon Kanban Board" width="800" />

</div>

## Quick Start

```bash
npx @eltmon/panctl
```

No install step required — Command Deck opens immediately. Missing tools (tmux, gh, mkcert, etc.) are prompted and installed inline the first time you use a feature that needs them. For headless and CI, keep using `pan`.

For the power-user path that installs everything up front: `pan install`.

Dashboard runs at https://pan.localhost (or http://localhost:3011 if you skip HTTPS setup).

On install, Panopticon rebuilds native modules like `better-sqlite3` for your active Node.js version. If you switch Node versions later, run `npm rebuild better-sqlite3` before starting Panopticon again.

See the [full documentation](https://panopticon-cli.com) for detailed setup, configuration, and usage guides.

---

## Architecture at a Glance

Panopticon started as a CLI for orchestrating coding agents and grew into **Command Deck**, a desktop app. The CLI, the GUI, and any script that can make an HTTP request all drive the same REST surface — so you can spawn an agent from a kanban card, a terminal, or a webhook without switching tools. Under the hood: an Effect.js + TypeScript server, a React frontend over typed WebSocket RPC, SQLite for state, and Electron as the shell. Launch the app with `npx @eltmon/panctl`; keep `pan` for headless and CI.

---

## Why Panopticon?

- **Stop babysitting agents.** Spawn them from a dashboard, monitor progress in real time, and let specialists handle code review, testing, and merging.
- **Use the right model for the job.** Opus for planning, GPT-5.4 or Kimi for implementation, Haiku for quick commands — automatic routing based on task type and capabilities.
- **Work survives across sessions.** PRDs, state files, beads, and skills persist context so agents don't start from zero every time.
- **One skill format, every tool.** Write a SKILL.md once and it works across Claude Code, Codex, Cursor, and Gemini CLI.
- **Tune routing without hand-editing prompts.** The Settings page lets you enable model families and set per-job overrides for work agents and specialists.

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
 Rally
```

Plus two specialists that run inline: **Inspect** verifies each implementation step against the spec, and **UAT** performs browser-based requirement verification after tests pass.

---

## Key Features

| Feature | Description |
|:--------|:------------|
| **Multi-Agent Orchestration** | Spawn and manage AI agents in tmux sessions via dashboard or CLI |
| **Cloister Lifecycle Manager** | Automatic model routing, stuck detection, cost tracking, and specialist handoffs |
| **Mission Control** | 13-view dashboard — project tree, activity feed, kanban board, agent status, costs, metrics, and more |
| **PRD-Driven Workflow** | Opus writes a PRD before implementation starts; agents are blocked without one |
| **70+ Universal Skills** | Pre-built skills ship out of the box, auto-synced on every `pan up` — one SKILL.md works across all AI tools |
| **Multi-Tracker Support** | GitHub Issues, Linear, GitLab, Rally — all from one dashboard |
| **Multi-Model Routing** | Anthropic, OpenAI, Google, Kimi, MiniMax, and OpenRouter — route by task type, capability, and budget |
| **Workspaces** | Git worktree-based feature branches with Docker isolation (local and remote via Fly.io) |
| **Convoys** | Run parallel agents on related issues with automatic synthesis |
| **5 Specialist Agents** | Review, test, inspect, UAT, and merge — fully automated quality pipeline |
| **Beads** | Git-backed task tracking that survives context compaction and works offline — auto-synced from vBRIEF plans |
| **vBRIEF Plans** | Machine-readable work plans (v0.5 spec) with DAG viewer, item status tracking, and auto-copied artifacts |
| **TLDR Code Analysis** | Token-efficient codebase analysis (500–1,200 tokens/file vs 10–25k) via semantic search and call graphs |
| **Effect.js Server** | Dashboard server built on Effect.js with typed RPC, structured concurrency, and zero sync FS calls |
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
| **Codex** | Skills sync and OpenAI subscription login for GPT work agents |
| **Cursor** | Skills sync |
| **Gemini CLI** | Skills sync |
| **Google Antigravity** | Skills sync |

---

## Requirements

### Required
- Node.js 22+
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

## Maturity

Panopticon is actively used in production to develop itself and multiple other projects.

- **70+ skills** shipped and synced across tools
- **4 tracker integrations** (GitHub, Linear, GitLab, Rally)
- **6 AI providers** with capability-based model routing
- **5 specialist agents** in the automated quality pipeline
- **Hundreds of issues** completed through the full pipeline

---

## Documentation

Full documentation at **[panopticon-cli.com](https://panopticon-cli.com)**

| Document | Description |
|----------|-------------|
| [Quick Start](https://panopticon-cli.com/quickstart) | Installation and setup |
| [Core Concepts](https://panopticon-cli.com/concepts) | Architecture and key concepts |
| [CLI Reference](https://panopticon-cli.com/cli/overview) | All available commands |
| [Features](https://panopticon-cli.com/features/mission-control) | Deep dive into key features |
| [Guides](https://panopticon-cli.com/guides/legacy-codebases) | Step-by-step guides |

---

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

<div align="center">
<p><a href="https://github.com/eltmon/panopticon-cli">GitHub</a> · <a href="https://www.npmjs.com/package/panopticon-cli">npm</a> · <a href="https://panopticon-cli.com">Documentation</a></p>
</div>
