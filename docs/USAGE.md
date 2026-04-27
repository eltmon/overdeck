# Panopticon Usage Guide

**Detailed installation, configuration, and usage guide for Panopticon CLI**

---

## Table of Contents

- [Installation](#installation)
- [Requirements](#requirements)
- [Configuration](#configuration)
- [Commands Reference](#commands-reference)
- [Workspaces](#workspaces)
- [Specialists](#specialists)
- [Skills](#skills)
- [Troubleshooting](#troubleshooting)

---

## Installation

### Quick Install

```bash
npx @panctl/cli
```

**That's it!** Panopticon starts the browser/server experience and opens the dashboard at https://pan.localhost (or http://localhost:3010 if you skip HTTPS setup).

For a full local install with reusable `panctl` and `pan` commands:

```bash
npm install -g @panctl/cli && pan install && pan up
```

### Step-by-Step Installation

1. **Install the CLI:**
   ```bash
   npm install -g @panctl/cli
   ```

2. **Run the installation wizard:**
   ```bash
   pan install
   ```

   This will:
   - Install dependencies (ttyd, beads)
   - Set up Traefik for local HTTPS
   - Generate SSL certificates (if mkcert is installed)
   - Create `~/.panopticon/` directory structure

3. **Sync skills to Claude Code:**
   ```bash
   pan sync
   ```

4. **Initialize beads task tracking** (once per project):
   ```bash
   cd /path/to/your-project
   bd init --prefix <project-name>
   ```
   For example: `bd init --prefix panopticon`

   This creates the Dolt database that agents use for task tracking. Without it, agents
   can't start even if planning succeeds. `pan sync` will attempt this automatically for
   registered projects, but running it manually once is the safest first-time setup.

5. **Start the dashboard:**
   ```bash
   pan up
   ```

---

## Requirements

### Required

- **Node.js 18+** - Runtime environment
- **Git** - For worktree-based workspaces
- **Docker** - For Traefik and workspace containers
- **tmux** - For agent sessions
- **ttyd** - Web terminal for interactive planning sessions (auto-installed)
- **GitHub CLI (`gh`)** - For GitHub integration ([Install](https://cli.github.com/))
- **GitLab CLI (`glab`)** - For GitLab integration (if using GitLab) ([Install](https://gitlab.com/gitlab-org/cli))

### Optional

- **mkcert** - For HTTPS certificates (recommended)
- **Linear API key** - For issue tracking integration
- **Beads CLI (`bd`)** - For persistent task tracking (auto-installed, upgrade with `pan admin beads upgrade`). Requires `bd init --prefix <project-name>` once per project root after installation.
- **Google Stitch MCP** - For AI-powered UI design integration

### Platform Support

The Panopticon dashboard includes terminal streaming, which requires a native binary (`node-pty`). Prebuilt binaries are available for:

| Platform | Architecture | Support |
|----------|-------------|---------|
| macOS | Intel (x64) | ✅ Prebuilt |
| macOS | Apple Silicon (arm64) | ✅ Prebuilt |
| Linux | x64 (glibc) | ✅ Prebuilt |
| Linux | arm64 (glibc) | ✅ Prebuilt |
| Linux | musl (Alpine) | ✅ Prebuilt |
| Windows | x64 | ✅ Prebuilt |

If a prebuilt binary is not available for your platform, node-gyp will automatically compile from source during installation (requires Python and build tools).

### Why CLI tools instead of API tokens?

Panopticon uses `gh` and `glab` CLIs instead of raw API tokens because:
- **Better auth**: OAuth tokens that auto-refresh (no expiring PATs)
- **Simpler setup**: `gh auth login` handles everything
- **Agent-friendly**: Agents can use them for PRs, merges, reviews

---

## Configuration

### Environment File

Create `~/.panopticon.env`:

```bash
LINEAR_API_KEY=lin_api_xxxxx
GITHUB_TOKEN=ghp_xxxxx  # Optional: for GitHub-tracked projects
RALLY_API_KEY=_xxxxx    # Optional: for Rally as secondary tracker
```

### Issue Trackers

Panopticon supports multiple issue trackers:

| Tracker | Role | Configuration |
|---------|------|---------------|
| **Linear** | Primary tracker | `LINEAR_API_KEY` in `.panopticon.env` |
| **GitHub Issues** | Secondary tracker | `GITHUB_TOKEN` or `gh auth login` |
| **GitLab Issues** | Secondary tracker | `glab auth login` |
| **Rally** | Secondary tracker | `RALLY_API_KEY` in `.panopticon.env` |

Secondary trackers sync issues to the dashboard alongside Linear issues, allowing unified project management.

#### Rally Features and Derived Status

Rally Features (PortfolioItems) get special treatment in the dashboard:

- **Derived Status**: Features automatically reflect their children's aggregate status. If any child User Story is "In Progress", the Feature shows as "In Progress" — even if Rally still says "Discovering". If all children are "Done", the Feature shows as "Done".
- **Raw State Preservation**: The original Rally state name (e.g., "Discovering", "In-Progress") is always visible alongside Panopticon's canonical state, so you can see both what Rally says and what Panopticon derives.
- **Shadow State Badges**: When shadow state differs from Rally's tracker state, cards show both states clearly: `🔗 Discovering → 👁 In Progress`.
- **Kanban Board**: Features render as rich cards with progress bars (`3/5 done, 2 active`) and expandable child story folders.
- **Mission Control**: Rally Features appear in the sidebar with child counts. Clicking a Feature shows its child stories with status indicators, assignees, and Rally state badges. The Sync button fetches Rally story statuses alongside GitHub/Linear discussions.

### Multi-Model Support

Panopticon integrates with [claude-code-router](https://github.com/musistudio/claude-code-router) to enable using multiple AI model providers alongside Anthropic models.

📖 **[Complete work types guide →](WORK-TYPES.md)**
📋 **[Configuration file reference →](CONFIGURATION.md)**
🧠 **[Model recommendations →](MODEL_RECOMMENDATIONS.md)**

#### Supported Providers and Models

**Anthropic** (via Claude Code / Claude API)
- `claude-opus-4-6` - Most capable, best for planning and complex tasks
- `claude-sonnet-4-5` - Balanced performance and cost
- `claude-haiku-4-5` - Fast and cost-effective for simple tasks

**OpenAI**
- `gpt-5.2-codex` - Agentic coding and research
- `o3-deep-research` - Deep research capabilities
- `gpt-4o` - General-purpose model
- `gpt-4o-mini` - Faster, more cost-effective variant

**Google (Gemini)**
- `gemini-3-pro-preview` - Supports `thinking_level: high|low`
- `gemini-3-flash-preview` - Supports `thinking_level: minimal|low|medium|high`

**Z.AI**
- `glm-4.7` - General-purpose model
- `glm-4.7-flash` - Faster variant

#### Configuration via Dashboard

1. Open the Panopticon dashboard and navigate to **Settings**
2. Configure **API keys** for external providers
3. Configure **models per agent type** (review, test, merge, planning)
4. Configure **models by task complexity** (trivial → expert)

**Configuration Files:**

| File | Purpose |
|------|---------|
| `~/.panopticon/config.yaml` | Global model settings, provider enable/disable |
| `~/.panopticon.env` | API keys and sensitive credentials |
| `.pan.yaml` | Per-project config (optional, overrides global; `.panopticon.yaml` still accepted with deprecation warning) |

**Security:** Restrict file permissions:
```bash
chmod 600 ~/.panopticon/config.yaml ~/.panopticon.env
```

**Environment Variables:** API keys are loaded from `~/.panopticon.env`:
```bash
# ~/.panopticon.env
KIMI_API_KEY="sk-kimi-..."
OPENAI_API_KEY="sk-..."
GOOGLE_AI_KEY="AIza..."
ZAI_API_KEY="..."
```

In `config.yaml`, reference them with `$` syntax:
```yaml
models:
  providers:
    kimi:
      enabled: true
      api_key: $KIMI_API_KEY
```

#### Router Configuration

**Panopticon owns the router configuration.** Settings saved in the dashboard automatically generate `~/.claude-code-router/config.json`. Manual edits will be overwritten.

### Register Projects

Register your local project directories:

```bash
# Register a project
pan project add /path/to/your/project --name myproject

# Register with Rally project mapping
pan project add /path/to/hsv3 --name "HSv3" --rally-project "/project/822404704163"

# List registered projects
pan project list
```

### Map Linear Projects to Local Directories

Configure which local directory each Linear project maps to. Create/edit `~/.panopticon/project-mappings.json`:

```json
[
  {
    "linearProjectId": "abc123",
    "linearProjectName": "Mind Your Now",
    "linearPrefix": "MIN",
    "localPath": "/home/user/projects/myn"
  },
  {
    "linearProjectId": "def456",
    "linearProjectName": "Panopticon",
    "linearPrefix": "PAN",
    "localPath": "/home/user/projects/panopticon"
  }
]
```

---

## Commands Reference

### Dashboard Commands

```bash
# Start dashboard (prefers Electron desktop app if installed)
pan up

# Start server + open in system browser (no Electron)
npx panopticon serve

# Stop dashboard
pan down

# Restart dashboard
pan restart

# Check system health
pan health

# View dashboard logs
pan logs dashboard
```

### Workspace Commands

```bash
# Create workspace for an issue
pan workspace create PAN-123

# List all workspaces
pan workspace list

# Destroy workspace
pan workspace destroy feature-pan-123

# Open workspace in terminal
pan workspace open PAN-123
```

### Agent Commands

```bash
# Check agent status
pan status

# View agent logs
pan logs agent-pan-123

# Inspect raw agent runtime logs directly
less ~/.panopticon/agents/agent-pan-123/lifecycle.log
less ~/.panopticon/agents/agent-pan-123/spawn.log

# Send message to agent
pan tell agent-pan-123 "Your message"

# Kill stuck agent
pan kill agent-pan-123
```

### Issue Lifecycle Commands

```bash
# Start work agent for an issue
pan start PAN-123

# Reopen a completed issue for re-work
# Resets specialist states, removes from queues, updates STATE.md
pan reopen PAN-123

# Reopen with an explicit reason
pan reopen PAN-123 --reason "Post-regression in auth flow"

# Reopen without confirmation prompt (e.g. in CI or scripts)
pan reopen PAN-123 --force

# Reset an issue destructively back to Todo
# Removes workspace, branches, and agent state
pan wipe PAN-123

# Signal that work is complete and ready for review
pan done PAN-123 -c "Brief summary of changes"
```

### Project Commands

```bash
# Add project
pan project add /path/to/project --name myproject

# Add project with Rally project mapping
pan project add /path/to/project --name myproject --rally-project "/project/822404704163"

# List projects
pan project list

# Remove project
pan project remove myproject
```

### Skills Commands

```bash
# Sync skills to Claude Code
pan sync

# List available skills
pan skills

# Validate skill format
pan skills validate /path/to/skill
```

### Release Commands

```bash
# Verify that main is releasable
pan release check

# Create a stable release commit + tag locally
pan release stable --version 0.7.1

# Create a canary release commit + tag locally
pan release canary --version 0.8.0-canary.1

# Draft release notes from git history
pan release notes
pan release notes v0.7.0 HEAD
pan release notes v0.7.0 v0.7.1 --write .release/v0.7.1.md
```

Panopticon develops directly on `main`. Releases are intentional promotions by tag, not automatic publishes from every commit. GitHub Releases now use a structured body generated from these notes instead of the bare default compare-only text.

---

## Workspaces

Workspaces are Git worktree-based feature branches with optional Docker isolation.

### Creating Workspaces

```bash
# From Linear issue
pan workspace create MIN-123

# From GitHub issue
pan workspace create PAN-45
```

### Workspace Structure

```
~/.panopticon/workspaces/
└── feature-pan-123/
    ├── .planning/          # Planning state
    │   ├── STATE.md        # Current implementation state
    │   ├── beads.json      # Task tracking
    │   └── decisions.log   # Planning decisions
    ├── src/                # Code (git worktree)
    ├── docker-compose.yml  # Optional Docker services
    └── CLAUDE.md           # Workspace-specific agent guidance
```

### Workspace URLs

Each workspace gets its own HTTPS domain:

```
https://feature-pan-123.localhost:3000     # Frontend
https://api-feature-pan-123.localhost:8080  # API
```

---

## Specialists

Dedicated agents for code review, testing, and merging.

### Specialist Types

| Type | Purpose | Trigger |
|------|---------|---------|
| **review-agent** | Code review | Agent signals work complete |
| **test-agent** | Run tests | Review passes |
| **merge-agent** | Merge to main | Tests pass |

### Specialist Workflow

```
Worker Agent completes work
         ↓
    Signals "done"
         ↓
Review Agent spawned
         ↓
   Provides feedback
         ↓
Worker fixes issues (if any)
         ↓
Test Agent spawned
         ↓
    Runs test suite
         ↓
Merge Agent spawned
         ↓
   Merges to main
```

📖 **[Complete specialist workflow →](SPECIALIST_WORKFLOW.md)**

---

## Skills

Universal SKILL.md format works across all AI tools.

### Skill Structure

```markdown
---
name: my-skill
description: What this skill does
triggers:
  - keyword1
  - keyword2
---

# Skill Instructions

Step-by-step instructions for AI agents...
```

### Creating Skills

```bash
# Create skill directory
mkdir -p ~/.panopticon/skills/my-skill

# Create SKILL.md
cat > ~/.panopticon/skills/my-skill/SKILL.md << 'EOF'
---
name: my-skill
description: Custom workflow
triggers:
  - deploy
---

# Deployment Workflow

1. Run tests
2. Build artifacts
3. Deploy to staging
EOF

# Sync to Claude Code
pan sync
```

### Using Skills

In Claude Code:
```
/my-skill
```

Skills are automatically available to all agents.

---

## Troubleshooting

### Dashboard Won't Start

```bash
# Check if ports are in use
lsof -i :3010
lsof -i :3011

# Kill conflicting processes
pan down
pkill -f panopticon
```

### HTTPS Certificate Issues

```bash
# Regenerate certificates
pan install --force-certs

# Or use HTTP instead
pan up --no-https
```

### Agent Sessions Not Appearing

```bash
# Check tmux sessions
tmux list-sessions

# Restart dashboard
pan restart

# Check high-level agent logs
pan logs agent-pan-123

# Check detailed start/resume lifecycle events
less ~/.panopticon/agents/agent-pan-123/lifecycle.log

# Check detached spawn stdout/stderr if start was requested but no session appeared
less ~/.panopticon/agents/agent-pan-123/spawn.log
```

If the dashboard shows a stopped/starting placeholder agent but no tmux session appears, `lifecycle.log` should show the last successful step (`agent.start_requested`, container wait, spawn request, process spawned/closed). `spawn.log` captures the detached `pan start <id> --local --phase <phase>` subprocess output that was previously lost when stdout/stderr were sent to `ignore`.

When Start Agent or Resume Session is working normally, the dashboard now shows a transient `Starting...` / `Resuming...` state first, then automatically swaps to the normal running controls once the live tmux-backed work agent is visible. If a stopped agent has stale session metadata but no usable workspace-backed state, the UI intentionally offers **Start Agent** instead of **Resume Session**.

### Git Worktree Issues

```bash
# List worktrees
git worktree list

# Prune stale worktrees
git worktree prune

# Remove specific worktree
git worktree remove feature-pan-123
```

### Node-pty Build Failures

If node-pty fails to install:

```bash
# Install build tools (macOS)
xcode-select --install

# Install build tools (Ubuntu/Debian)
sudo apt-get install build-essential python3

# Install build tools (Fedora/RHEL)
sudo dnf install gcc make python3

# Rebuild
npm rebuild node-pty
```

### Linear Integration Issues

```bash
# Verify API key
echo $LINEAR_API_KEY

# Test Linear connection
curl -H "Authorization: Bearer $LINEAR_API_KEY" \
  https://api.linear.app/graphql \
  -d '{"query": "{ viewer { id name } }"}'
```

### Docker Networking Issues

```bash
# Check Traefik status
docker ps | grep traefik

# Restart Traefik
docker restart panopticon-traefik

# Check DNS resolution
ping feature-pan-123.localhost
```

### Skill Sync Issues

```bash
# Force sync
pan sync --force

# Verify skill installation
ls ~/.claude/skills/

# Check Claude Code picks up skills
claude config --list-skills
```

---

## Advanced Topics

### Remote Workspaces

Panopticon supports remote workspace execution via exe.dev:

```bash
# Create remote workspace
pan workspace create PAN-123 --remote

# Connect to remote session
pan workspace connect feature-pan-123
```

📖 **[Remote workspace guide →](PRD-REMOTE-WORKSPACES.md)**

### Custom Work Types

Define custom work types for model routing:

```yaml
# ~/.panopticon/work-types.yaml
custom_work_types:
  - name: security-audit
    complexity: expert
    model: claude-opus-4-6
    description: Security vulnerability assessment
```

📖 **[Work types reference →](WORK-TYPES.md)**

### Heartbeat Monitoring

Configure Claude Code hooks for real-time agent monitoring:

```json
// ~/.claude/hooks.json
{
  "on_tool_result": "~/.panopticon/hooks/heartbeat.sh"
}
```

The heartbeat hook updates agent status in real-time on the dashboard.

---

## Desktop App

The Panopticon desktop app wraps the dashboard in a native Electron window with system tray integration, native notifications, and automatic server embedding.

### Installation

- **Linux**: Download the `.AppImage` from the releases page. `pan up` detects it automatically if placed at `~/.local/bin/panopticon` or in `~/Applications/`.
- **macOS**: Open the `.dmg` and drag `Panopticon.app` to `/Applications/`. `pan up` launches it automatically.

### Key Features

| Feature | Description |
|---------|-------------|
| **System Tray** | Color-coded status indicator (green/yellow/red) + context menu |
| **Native Notifications** | Per-event-type toggles (input needed, stuck agents, merge failures, etc.) |
| **Auto-start** | Launch at login with a gentle nag flow (up to 5 reminders) |
| **Cmd+K Palette** | Command palette for quick actions and workspace navigation |
| **Desktop Settings** | Settings → Desktop App section for tray, notifications, and auto-start config |

### `pan up` Electron Detection

`pan up` checks for the desktop app before starting the server:

1. Linux: `~/.local/bin/panopticon`, then `~/Applications/Panopticon*.AppImage`
2. macOS: `/Applications/Panopticon.app`
3. Windows: `%LOCALAPPDATA%\Programs\Panopticon`

If found, it spawns the app detached and exits — the desktop app handles server startup internally. If not found, `pan up` starts the server normally.

### Browser-Only Mode

To skip Electron and use the system browser instead:

```bash
npx panopticon serve
```

This starts the server and opens it in your default browser after 1.5 seconds. Useful on headless servers or if you prefer the browser experience.

📖 **[Full desktop app reference →](DESKTOP-APP.md)**

---

## Getting Help

- **Documentation**: [docs/INDEX.md](INDEX.md)
- **Issues**: [GitHub Issues](https://github.com/eltmon/panopticon-cli/issues)
- **Discussions**: [GitHub Discussions](https://github.com/eltmon/panopticon-cli/discussions)

---

<div align="center">
<p><strong>Made with ❤️ by the Panopticon team</strong></p>
<p><a href="https://github.com/eltmon/panopticon-cli">GitHub</a> · <a href="https://www.npmjs.com/package/@panctl/cli">npm</a> · <a href="INDEX.md">Documentation</a></p>
</div>
