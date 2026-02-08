<div align="center">

# Panopticon CLI

**Multi-agent orchestration for AI coding assistants**

[![npm version](https://img.shields.io/npm/v/panopticon-cli.svg)](https://www.npmjs.com/package/panopticon-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/eltmon/panopticon/pulls)

> *"The Panopticon had six sides, one for each of the Founders of Gallifrey..."*

<img src="docs/dashboard-overview.png" alt="Panopticon Dashboard" width="800" />

</div>

---

## What is Panopticon?

| Without Panopticon | With Panopticon |
|:------------------|:----------------|
| Manually juggle multiple AI agents | **Automatic orchestration** - spawn, monitor, and coordinate agents from a dashboard |
| Agents start fresh every session | **Persistent context** - skills, state files, and beads track work across sessions |
| Simple tasks eat Opus credits | **Smart model routing** - Haiku for simple, Sonnet for medium, Opus for complex |
| Stuck agents waste your time | **Automatic recovery** - detect stuck agents and hand off to specialists |
| AI tools have separate configs | **Universal skills** - one SKILL.md works across Claude, Codex, Cursor, Gemini |

## Screenshots

<div align="center">
<table>
<tr>
<td><img src="docs/planning-session-dialog.png" alt="Planning Dialog" width="300" /></td>
<td><img src="docs/planning-session-discovery.png" alt="Discovery Phase" width="300" /></td>
<td><img src="docs/planning-session-active.png" alt="Active Session" width="300" /></td>
</tr>
<tr>
<td align="center"><em>Start planning</em></td>
<td align="center"><em>Discovery phase</em></td>
<td align="center"><em>Active session</em></td>
</tr>
</table>
</div>

## Key Features

| Feature | Description |
|:--------|:------------|
| **Multi-Agent Orchestration** | Spawn and manage AI agents in tmux sessions via dashboard or CLI |
| **Cloister Lifecycle Manager** | Automatic model routing, stuck detection, and specialist handoffs |
| **Universal Skills** | One SKILL.md format works across all supported AI tools |
| **Workspaces** | Git worktree-based feature branches with Docker isolation |
| **Convoys** | Run parallel agents on related issues with auto-synthesis |
| **Specialists** | Dedicated review, test, and merge agents for quality control |
| **Heartbeat Monitoring** | Real-time agent activity tracking via Claude Code hooks |
| **Legacy Codebase Support** | AI self-monitoring skills that learn from your codebase |

## Supported Tools

| Tool | Support |
|:-----|:--------|
| **Claude Code** | Full support |
| **Codex** | Skills sync |
| **Cursor** | Skills sync |
| **Gemini CLI** | Skills sync |
| **Google Antigravity** | Skills sync |

---

## Legacy Codebase Support

> **"AI works great on greenfield projects, but it's hopeless on our legacy code."**
>
> Sound familiar? Your developers aren't wrong. But they're not stuck, either.

### The Problem Every Enterprise Faces

AI coding assistants are trained on modern, well-documented open-source code. When they encounter your 15-year-old monolith with:

- Mixed naming conventions (some `snake_case`, some `camelCase`, some `SCREAMING_CASE`)
- Undocumented tribal knowledge ("we never touch the `processUser()` function directly")
- Schemas that don't match the ORM ("the `accounts` table is actually users")
- Three different async patterns in the same codebase
- Build systems that require arcane incantations

...they stumble. Repeatedly. Every session starts from zero.

### Panopticon's Unique Solution: Adaptive Learning

Panopticon includes two AI self-monitoring skills that **no other orchestration framework provides**:

| Skill | What It Does | Business Impact |
|-------|--------------|-----------------|
| **Knowledge Capture** | Detects when AI makes mistakes or gets corrected, prompts to document the learning | AI gets smarter about YOUR codebase over time |
| **Refactor Radar** | Identifies systemic code issues causing repeated AI confusion, creates actionable proposals | Surfaces technical debt that's costing you AI productivity |

#### How It Works

```
Session 1: AI queries users.created_at → Error (column is "createdAt")
           → Knowledge Capture prompts: "Document this convention?"
           → User: "Yes, create skill"
           → Creates project-specific skill documenting naming conventions

Session 2: AI knows to use camelCase for this project
           No more mistakes on column names

Session 5: Refactor Radar detects: "Same entity called 'user', 'account', 'member'
           across layers - this is causing repeated confusion"
           → Offers to create issue with refactoring proposal
           → Tech lead reviews and schedules cleanup sprint
```

#### The Compound Effect

| Week | Without Panopticon | With Panopticon |
|------|-------------------|-----------------|
| 1 | AI makes 20 mistakes/day on conventions | AI makes 20 mistakes, captures 8 learnings |
| 2 | AI makes 20 mistakes/day (no memory) | AI makes 12 mistakes, captures 5 more |
| 4 | AI makes 20 mistakes/day (still no memory) | AI makes 3 mistakes, codebase improving |
| 8 | Developers give up on AI for legacy code | AI is productive, tech debt proposals in backlog |

#### Shared Team Knowledge

**When one developer learns, everyone benefits.**

Captured skills live in your project's `.claude/skills/` directory - they're version-controlled alongside your code. When Sarah documents that "we use camelCase columns" after hitting that error, every developer on the team - and every AI session from that point forward - inherits that knowledge automatically.

```
myproject/
├── .claude/skills/
│   └── project-knowledge/     # ← Git-tracked, shared by entire team
│       └── SKILL.md           # "Database uses camelCase, not snake_case"
├── src/
└── ...
```

No more repeating the same corrections to AI across 10 different developers. No more tribal knowledge locked in one person's head. The team's collective understanding of your codebase becomes permanent, searchable, and automatically applied.

**New hire onboarding?** The AI already knows your conventions from day one.

#### For Technical Leaders

**What gets measured gets managed.** Panopticon's Refactor Radar surfaces the specific patterns that are costing you AI productivity:

- "Here are the 5 naming inconsistencies causing 40% of AI errors"
- "These 3 missing FK constraints led to 12 incorrect deletions last month"
- "Mixed async patterns in payments module caused 8 rollbacks"

Each proposal includes:
- **Evidence**: Specific file paths and examples
- **Impact**: How this affects AI (and new developers)
- **Migration path**: Incremental fix that won't break production

#### For Executives

**ROI is simple:**

- $200K/year senior developer spends 2 hours/day correcting AI on legacy code
- That's $50K/year in wasted productivity per developer
- Team of 10 = **$500K/year** in AI friction

Panopticon's learning system:
- Captures corrections once, applies them forever
- Identifies root causes (not just symptoms)
- Creates actionable improvement proposals
- Works across your entire AI toolchain (Claude, Codex, Cursor, Gemini)

**This isn't "AI for greenfield only." This is AI that learns your business.**

#### Configurable Per Team and Per Developer

Different teams have different ownership boundaries. Individual developers have different preferences. Panopticon respects both:

```markdown
# In ~/.claude/CLAUDE.md (developer's personal config)

## AI Suggestion Preferences

### refactor-radar
skip: database-migrations, infrastructure  # DBA/Platform team handles these
welcome: naming, code-organization         # Always happy for these

### knowledge-capture
skip: authentication                       # Security team owns this
```

- **"Skip database migrations"** - Your DBA has a change management process
- **"Skip infrastructure"** - Platform team owns that
- **"Welcome naming fixes"** - Low risk, high value, always appreciated

The AI adapts to your org structure, not the other way around.

---

## Quick Start

```bash

---

## 🚀 Quick Start

```bash
npm install -g panopticon-cli && pan install && pan sync && pan up
```

**That's it!** Dashboard runs at https://pan.localhost (or http://localhost:3010 if you skip HTTPS setup).

📖 **[Full documentation →](docs/INDEX.md)**

---

## 📋 Requirements

### Required
- Node.js 18+
- Git (for worktree-based workspaces)
- Docker (for Traefik and workspace containers)
- tmux (for agent sessions)
- **GitHub CLI (`gh`)** or **GitLab CLI (`glab`)** for Git operations
- **ttyd** - Auto-installed by `pan install`

### Optional
- **mkcert** - For HTTPS certificates (recommended)
- **Linear API key** - For issue tracking
- **Beads CLI** - Auto-installed by `pan install`

📖 **[Platform support and detailed requirements →](docs/USAGE.md#requirements)**

---

## 🔧 Configuration

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

📖 **[Complete configuration guide →](docs/CONFIGURATION.md)**
📖 **[Work types and model routing →](docs/WORK-TYPES.md)**
📖 **[Detailed usage examples →](docs/USAGE.md)**

---

## 🎯 Key Concepts

### Multi-Agent Orchestration
Spawn and manage AI agents in tmux sessions, monitored by the Cloister lifecycle manager.

### Workspaces
Git worktree-based feature branches with optional Docker isolation. Supports both local and remote (exe.dev) execution.

### Specialists
Dedicated agents for code review, testing, and merging. Automatically triggered by the Cloister manager.

### Skills
Universal SKILL.md format works across Claude Code, Codex, Cursor, and Gemini. Distributed via `pan sync`.

📖 **[Architecture overview →](AGENTS.md)**
📖 **[Specialist workflow →](docs/SPECIALIST_WORKFLOW.md)**

---

## 🛠️ Common Commands

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

📖 **[Complete command reference →](docs/USAGE.md#commands)**

---

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [docs/INDEX.md](docs/INDEX.md) | Master documentation index (start here) |
| [docs/USAGE.md](docs/USAGE.md) | Detailed usage guide, examples, troubleshooting |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | Model routing, API setup, presets |
| [AGENTS.md](AGENTS.md) | Agent architecture |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contribution guidelines |
| [CLAUDE.md](CLAUDE.md) | Agent development guidance |

---

## 🤝 Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=eltmon/panopticon-cli&type=Date)](https://star-history.com/#eltmon/panopticon-cli&Date)

---

## ⚖️ License

MIT License - see [LICENSE](LICENSE) for details.

---

<div align="center">
<p><strong>Made with ❤️ by the Panopticon team</strong></p>
<p><a href="https://github.com/eltmon/panopticon-cli">GitHub</a> · <a href="https://www.npmjs.com/package/panopticon-cli">npm</a> · <a href="docs/INDEX.md">Documentation</a></p>
</div>
