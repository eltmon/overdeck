---
name: pan-help
description: Overview of all Panopticon commands and capabilities
triggers:
  - pan help
  - panopticon help
  - what can panopticon do
  - show me panopticon commands
allowed-tools:
  - Bash
  - Read
---

# Panopticon Help

## Overview

Panopticon is a multi-agent orchestration framework for AI coding assistants. This skill provides a comprehensive overview of all available commands and capabilities.

## When to Use

- User asks about Panopticon capabilities
- User is confused about which command to use
- First-time users exploring the system
- User needs to discover available skills

## Core Concepts

**Workspace**: Isolated development environment for an issue (code + Docker containers + tmux session)
**Agent**: AI assistant running autonomously in a tmux session to work on an issue
**Skill**: Reusable guidance templates that AI assistants can invoke
**Tracker**: Issue tracking system (Linear, GitHub, GitLab)

## Available Commands

### Getting Started

| Command | Description | Example |
|---------|-------------|---------|
| `pan init` | Initialize Panopticon configuration (~/.panopticon/) | `pan init` |
| `pan install` | Install prerequisites (Node.js, Docker, etc.) | `pan install` |
| `pan up` | Start dashboard and services | `pan up` |
| `pan down` | Stop dashboard and services | `pan down` |
| `pan status` | Show running agents (shorthand for `pan work status`) | `pan status` |
| `pan doctor` | Check system health and dependencies | `pan doctor` |

### Work Management

| Command | Description | Example |
|---------|-------------|---------|
| `pan work issue <id>` | Create workspace and spawn agent for issue | `pan work issue PAN-3` |
| `pan work plan <id>` | Create execution plan before spawning agent | `pan work plan PAN-5` |
| `pan work status` | Show all running agents | `pan work status` |
| `pan work tell <id> <msg>` | Send message to running agent | `pan work tell PAN-3 "Check tests"` |
| `pan work kill <id>` | Stop a running agent | `pan work kill PAN-3` |
| `pan work pending` | Show completed work awaiting review | `pan work pending` |
| `pan work approve <id>` | Approve work, merge MR, update tracker | `pan work approve PAN-3` |
| `pan work list` | List issues from configured trackers | `pan work list` |
| `pan work recover <id>` | Recover crashed agent | `pan work recover PAN-3` |
| `pan work health check` | Check agent health | `pan work health check` |

### Workspace Management

| Command | Description | Example |
|---------|-------------|---------|
| `pan workspace create <id>` | Create workspace for issue (without spawning agent) | `pan workspace create PAN-3` |
| `pan workspace list` | List all workspaces | `pan workspace list` |
| `pan workspace destroy <id>` | Destroy workspace and containers | `pan workspace destroy PAN-3` |

### Configuration

| Command | Description | Example |
|---------|-------------|---------|
| `pan project add <path>` | Add project to Panopticon | `pan project add /home/user/myapp` |
| `pan project list` | List managed projects | `pan project list` |
| `pan project remove <name>` | Remove project | `pan project remove myapp` |

### Skills Management

| Command | Description | Example |
|---------|-------------|---------|
| `pan skills` | List available skills | `pan skills` |
| `pan sync` | Sync skills to AI tools (auto-runs on `pan up`) | `pan sync` |
| `pan sync --dry-run` | Preview skill sync without applying | `pan sync --dry-run` |

### Maintenance

| Command | Description | Example |
|---------|-------------|---------|
| `pan update` | Update Panopticon to latest version | `pan update` |
| `pan backup` | Manage backups | `pan backup` |
| `pan restore <timestamp>` | Restore from backup | `pan restore 2024-01-15-1200` |

## Available Skills

Panopticon comes with a suite of skills to guide AI assistants:

### Development Workflows
- `/bug-fix` - Systematic bug investigation and fixing
- `/feature-work` - Standard feature implementation workflow
- `/refactor` - Safe refactoring with test coverage
- `/dependency-update` - Safe dependency updates

### Code Review
- `/code-review` - Comprehensive code review (correctness, security, performance)
- `/code-review-security` - Deep security analysis (OWASP Top 10)
- `/code-review-performance` - Performance and algorithmic analysis

### Operations
- `/release` - Step-by-step release process
- `/incident-response` - Structured production incident handling
- `/onboard-codebase` - Systematic codebase exploration

### Utilities
- `/session-health` - Detect and clean up stuck sessions
- `/skill-creator` - Guide for creating new skills
- `/web-design-guidelines` - UI/UX best practices
- `/work-complete` - Checklist for completing work

### Panopticon-Specific
- `/pan-help` - This skill (overview of commands)
- `/pan-install` - Installation guidance
- `/pan-setup` - Configuration wizard
- `/pan-quickstart` - Quick start (install + setup + first workspace)
- `/pan-up` / `/pan-down` - Service lifecycle management
- `/pan-status` - System health overview
- `/pan-plan` - Planning workflow guidance
- `/pan-issue` - Workspace + agent creation
- And many more... (use `pan skills` to see full list)

## Typical Workflows

### First-Time Setup
```bash
# 1. Initialize Panopticon
pan init

# 2. Install prerequisites
pan install

# 3. Start services
pan up

# 4. Check health
pan doctor
```

### Working on an Issue
```bash
# 1. Optionally create a plan first
pan work plan PAN-3

# 2. Create workspace and spawn agent
pan work issue PAN-3

# 3. Monitor agent status
pan work status

# 4. Send message to agent if needed
pan work tell PAN-3 "Run the tests"

# 5. When done, review and approve
pan work pending
pan work approve PAN-3
```

### Managing Workspaces
```bash
# List all workspaces
pan workspace list

# Create workspace without agent
pan workspace create PAN-5

# Destroy workspace when done
pan workspace destroy PAN-5
```

## Configuration Files

| File | Purpose |
|------|---------|
| `~/.panopticon.env` | Main configuration (API keys, tracker settings) |
| `~/.panopticon/skills/` | Skills distributed with Panopticon |
| `~/.panopticon/agents/` | Per-agent state and health |
| `~/.panopticon/workspaces/` | Workspace metadata |
| `~/.panopticon/backups/` | Configuration backups |

## Dashboard

The Panopticon dashboard provides a visual interface for:
- Kanban board with all issues from configured trackers
- Real-time agent monitoring (tmux session output)
- Agent control (send messages, stop agents)
- Workspace creation and management
- Activity log showing command output

Access the dashboard at: **http://localhost:3001** (after running `pan up`)

## Troubleshooting

**Problem:** `pan` command not found
**Solution:** Run `npm install -g` in the Panopticon directory, or add `./node_modules/.bin` to PATH

**Problem:** Dashboard won't start
**Solution:** Check ports 3001/3002 aren't in use, run `pan doctor` to verify dependencies

**Problem:** Agent appears stuck
**Solution:** Use `/session-health` skill, or `pan work recover <id>`

**Problem:** Workspace containers won't start
**Solution:** Check Docker daemon is running, verify port conflicts with `pan workspace list`

**Problem:** Skills not syncing to Claude Code
**Solution:** Run `pan sync` manually, check `~/.claude/skills/` permissions

## Next Steps

- **New users**: Use `/pan-quickstart` skill for guided onboarding
- **Configuration**: Use `/pan-setup` skill to configure trackers and projects
- **Docker setup**: Use `/pan-docker` skill for Docker template configuration
- **Create your first workspace**: `pan work issue <your-issue-id>`

## Related Skills

- `/pan-install` - Detailed installation guidance
- `/pan-setup` - Configuration wizard
- `/pan-quickstart` - Combined quick start
- `/pan-status` - Health and status overview
- `/pan-issue` - Workspace creation guidance

## More Information

- Run `pan --help` to see all commands
- Run `pan <command> --help` for command-specific help
- Run `pan skills` to see all available skills
- Visit the dashboard at http://localhost:3001
