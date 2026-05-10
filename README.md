<div align="center">

# Panopticon CLI

**The IDE for the agent era**

[![npm version](https://img.shields.io/npm/v/%40panctl%2Fcli.svg)](https://www.npmjs.com/package/@panctl/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](https://nodejs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/eltmon/panopticon-cli/pulls)

> *"The Panopticon had six sides, one for each of the Founders of Gallifrey..."*
>
> — Classic Doctor Who. The Panopticon was the great hall at the heart of the Time Lord Citadel, where all could be observed. We liked the metaphor.

</div>

IDEs were built for humans who type code. Panopticon is built for humans who **direct** code. Command Deck is a live development environment where you spawn agents, watch them work, and stay in control. You see every file change as it lands, review diffs without leaving the conversation, talk to agents to course-correct, hot-swap the model behind them when the task shifts, and branch a conversation to try a different approach without losing the original. When you like where things are headed, the built-in specialist pipeline picks it up — automated code review, tests, and merge — so you never context-switch to a separate CI tab.

<div align="center">

<img src="docs/screenshot-board.png" alt="Panopticon Command Deck" width="800" />

</div>

## Quick Start

```bash
npx @panctl/cli
```

No install step required. `npx @panctl/cli` starts Command Deck and opens the dashboard in your browser. Use `panctl` or `pan` after `npm install -g @panctl/cli`. The packaged desktop app is published separately as `@panctl/desktop`.

Dashboard runs at https://pan.localhost (or http://localhost:3011 if you skip HTTPS setup).

See the [full documentation](https://panopticon-cli.com) for detailed setup, configuration, and usage guides.

---

## Command Deck

Command Deck is the live development surface where you and your agents work together. It's built around three zones that update in real time — no refresh buttons, no polling. Every event animates in as it happens.

| Zone | What You See |
|:-----|:-------------|
| **Issue Header** | Issue identity, pipeline stage, live cost tracking, activity sparkline, quality gate rollup |
| **Agent Context** | Selected agent's role, status, current tool, thinking/waiting state, round history, per-session costs |
| **Conversation + Composer** | Full conversation timeline with composer, or a tabbed dashboard when viewing the issue itself |

### What You Can Do

- **Live diffs as agents code** — every file change appears inline as the agent works. Open the diff panel to review changes turn by turn, or hit "vs main" to see the full picture without waiting for a PR.
- **Talk to your agents** — type in the composer to steer an agent mid-task. Correct its approach, point it at the right file, tell it to rethink — pair-programming, not babysitting.
- **Hot-swap models** — agent struggling? Open the model picker and switch from Sonnet to Opus (or Kimi, GPT, Gemini) without losing the conversation. Right model for each phase.
- **Branch to explore** — fork any conversation to try an alternative approach. Keep the original intact, compare both, merge the one you like.
- **Automatic checkpoints** — Command Deck snapshots agent state as work progresses. If an agent goes sideways, roll back to any earlier checkpoint instead of starting over.
- **Ship without switching tabs** — when the code looks right, the specialist pipeline picks it up. Automated review, tests, and merge. No CI dashboard to babysit.

### 13 Dashboard Views

Project tree, activity feed, kanban board, agent status, cost analytics, convoy status, specialist handoffs, real-time activity log, performance metrics, skill library, health diagnostics, God View (cross-project), and settings.

---

## Why Panopticon?

- **You stay in the loop without being in the way.** Watch agents code, review their diffs live, send a message when they drift. You're pair-programming, not babysitting a terminal.
- **The right model for every phase.** Opus plans the architecture, Kimi or Sonnet writes the code, Haiku handles quick commands. Panopticon routes automatically — or you override with two clicks when you know better.
- **Context that outlasts the conversation.** PRDs, plans, checkpoints, beads, and skills carry forward across sessions. Agents pick up where the last one left off, not from a blank slate.
- **One skill format, every tool.** Write a SKILL.md once and it works across Claude Code, Codex, Cursor, and Gemini CLI. 70+ ship out of the box.
- **A pipeline that ships while you move on.** When the implementation looks right, hand it to the specialist pipeline — automated code review, tests, and merge. You click Merge when you're satisfied, or keep working on the next issue.

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

You can drive any stage from the dashboard, the CLI, or a webhook. Engage as much or as little as you want — from hands-on pair programming with a single agent to launching a fully autonomous pipeline across dozens of issues.

---

## Key Features

| Feature | Description |
|:--------|:------------|
| **Command Deck** | A live workspace where you watch agents code, review diffs inline, send messages, and manage everything from one surface |
| **Inline Diff Review** | See what changed file-by-file as the agent works, compare any turn against main — no waiting for a PR to review code |
| **Model Hot-Swap** | Switch an agent from Sonnet to Opus to Kimi mid-conversation. Six providers, automatic routing, or manual override |
| **Conversation Forking** | Branch a conversation to try a different approach. Keep the original, compare both, go with what works |
| **Automatic Checkpoints** | Agent state is snapshotted as it progresses — roll back to any earlier point if something goes wrong |
| **Visual Plans** | Work plans render as interactive DAGs so you can see dependencies, track acceptance criteria, and know what's done |
| **Specialist Pipeline** | Five agents handle code review, testing, inspection, UAT, and merge automatically — you just click Merge |
| **Cloister** | Lifecycle manager that routes models, detects stuck agents, tracks costs, and orchestrates specialist handoffs |
| **PRD-Driven Workflow** | Opus writes a detailed plan before any code is written — agents can't start without one |
| **70+ Universal Skills** | Pre-built skills synced on every `pan up` — one SKILL.md works across Claude Code, Codex, Cursor, and Gemini CLI |
| **Multi-Tracker Support** | GitHub Issues, Linear, GitLab, Rally — all visible in one unified kanban board |
| **Workspaces** | Isolated git worktrees per issue with optional Docker environments, local or remote via Fly.io |
| **Convoys** | Run parallel agents on related issues with automatic result synthesis |
| **Cost Tracking** | Per-issue, per-stage token costs with model attribution and daily rollups |
| **TLDR Code Analysis** | Token-efficient codebase understanding (500-1,200 tokens/file vs 10-25k) so agents stay within context |

---

## Architecture at a Glance

Panopticon started as a CLI and grew into **Command Deck**, a desktop-class development environment. The CLI, the GUI, and any script that can make an HTTP request all drive the same REST surface — spawn an agent from a kanban card, a terminal, or a webhook without switching tools. Under the hood: an Effect.js + TypeScript server, a React frontend over typed WebSocket RPC, SQLite for state, and Electron as the shell. Launch with `npx @panctl/cli`; keep `pan` for headless and CI, or use `@panctl/desktop` for the packaged desktop app.

---

## Screenshots

<div align="center">
<table>
<tr>
<td><img src="docs/dashboard-overview.png" alt="Command Deck" width="400" /></td>
<td><img src="docs/screenshot-agents.png" alt="Agent Management" width="400" /></td>
</tr>
<tr>
<td align="center"><em>Command Deck — project tree, activity timeline, specialist pipeline</em></td>
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
<p><a href="https://github.com/eltmon/panopticon-cli">GitHub</a> · <a href="https://www.npmjs.com/package/@panctl/cli">npm</a> · <a href="https://panopticon-cli.com">Documentation</a></p>
</div>
