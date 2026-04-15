---
name: pan-quickstart
audience: operator
description: Quick start guide combining installation, setup, and first workspace
triggers:
  - quick start panopticon
  - panopticon quickstart
  - get started with panopticon
  - panopticon tutorial
allowed-tools:
  - Bash
  - Read
  - Edit
  - AskUserQuestion
---

# Panopticon Quick Start

## Overview

This skill provides a streamlined onboarding experience for new Panopticon users, combining installation, configuration, and creating your first workspace in a single guided workflow.

## When to Use

- First-time Panopticon users
- User wants fastest path to productive use
- User asks "how do I get started?"
- User wants to go from zero to running agent quickly

## Quick Start Workflow

### Step 1: Prerequisites Check

Before starting, verify you have:
- **Linux, macOS, or WSL2** (Windows Subsystem for Linux)
- **Terminal access** with bash/zsh
- **Internet connection** for downloading dependencies

### Step 2: Installation (5 minutes)

#### Check Current Status
```bash
pan doctor
```

If `pan` command not found, Panopticon isn't installed yet.

#### Install Panopticon
```bash
# Clone the repository
git clone https://github.com/eltmon/panopticon-cli.git
cd panopticon-cli

# Install dependencies
npm install

# Build CLI
npm run build

# Install globally (recommended)
npm install -g .

# Verify installation
pan --help
```

#### Install Prerequisites
```bash
# Use automated installer
pan install

# Or verify manually
pan doctor
```

**What `pan install` does:**
- Checks for Node.js v18+ (installs if missing)
- Checks for Docker (guides installation if missing)
- Checks for tmux (installs if missing)
- Checks for Git (installs if missing)

**Expected output:** All green checkmarks from `pan doctor`

### Step 3: Configuration (2 minutes)

#### Initialize Configuration
```bash
pan init
```

This creates `~/.panopticon.env`.

#### Configure Issue Tracker

**Using Linear** (recommended):
```bash
# Edit ~/.panopticon.env and add:
LINEAR_API_KEY=lin_api_xxxxxxxxxxxxxxxxxxxxx
LINEAR_TEAM_ID=your-team-id
```

Get your Linear API key:
1. Visit https://linear.app/settings/api
2. Create personal API key
3. Copy key (starts with `lin_api_`)

**Using GitHub**:
```bash
# Edit ~/.panopticon.env and add:
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxx
GITHUB_OWNER=your-username-or-org
GITHUB_REPO=your-repo-name
```

Get your GitHub token:
1. Visit https://github.com/settings/tokens
2. Generate token with `repo` scope
3. Copy token (starts with `ghp_`)

**Using GitLab**:
```bash
# Edit ~/.panopticon.env and add:
GITLAB_TOKEN=glpat-xxxxxxxxxxxxxxxxxxxxx
GITLAB_PROJECT_ID=12345678
```

#### Add Your First Project
```bash
# Add the project you want to work on
pan project add ~/projects/myapp

# Verify
pan project list
```

#### Verify Configuration
```bash
# Check system health
pan doctor

# Test tracker connection
pan issues
```

### Step 4: Start Services (1 minute)

```bash
# Start dashboard and services
pan up

# Verify services are running
pan status
```

**What starts:**
- Dashboard frontend (http://localhost:3001)
- API server (http://localhost:3002)
- Traefik (if enabled, for local domains)

**Verify:** Visit http://localhost:3001 in your browser

### Step 5: Create Your First Workspace (2 minutes)

#### List Available Issues
```bash
# See issues from your tracker
pan issues
```

#### Create Workspace and Spawn Agent
```bash
# Replace PAN-3 with your issue ID
pan start PAN-3
```

**What happens:**
1. Creates isolated workspace directory
2. Clones code from main project
3. Sets up Docker containers (if configured)
4. Starts tmux session
5. Spawns AI agent in tmux session
6. Agent begins working on the issue

#### Monitor Agent Progress
```bash
# Check agent status
pan status

# View agent output in dashboard
# Visit http://localhost:3001 and click on the agent
```

#### Interact with Agent
```bash
# Send message to agent
pan tell PAN-3 "Check if tests pass"

# View agent's work
# Attach to tmux session (Ctrl+b d to detach)
tmux attach -t agent-PAN-3
```

### Step 6: Review and Approve Work (when ready)

#### Check Pending Work
```bash
# See completed work awaiting review
pan review pending
```

#### Review in Dashboard
1. Visit http://localhost:3001
2. Click on completed work
3. Review code changes
4. Check test results

#### Approve and Merge
```bash
# Approve work, merge MR, update tracker
pan approve PAN-3
```

**What happens:**
1. Creates merge request (if configured)
2. Merges to main branch (if approved)
3. Updates issue status in tracker
4. Cleans up workspace (optional)

## Complete Quick Start Script

Here's the entire workflow in one script:

```bash
#!/bin/bash
# Panopticon Quick Start

echo "=== Panopticon Quick Start ==="

# 1. Install Panopticon (skip if already done)
if ! command -v pan &> /dev/null; then
    git clone https://github.com/eltmon/panopticon-cli.git
    cd panopticon-cli
    npm install
    npm run build
    npm install -g .
fi

# 2. Install prerequisites
pan install

# 3. Initialize configuration
pan init

# 4. Verify health
pan doctor

# 5. Configure tracker (manual step - prompt user)
echo "Please configure your issue tracker in ~/.panopticon.env"
echo "Add LINEAR_API_KEY or GITHUB_TOKEN"
read -p "Press enter when done..."

# 6. Add project (manual step - prompt user)
echo "Add your project directory:"
read -p "Project path: " PROJECT_PATH
pan project add "$PROJECT_PATH"

# 7. Start services
pan up

# 8. List issues
pan issues

# 9. Create first workspace (manual step - prompt user)
echo "Create your first workspace:"
read -p "Issue ID (e.g., PAN-3): " ISSUE_ID
pan start "$ISSUE_ID"

echo "=== Quick Start Complete! ==="
echo "Dashboard: http://localhost:3001"
echo "Monitor agent: pan status"
echo "Send message: pan tell $ISSUE_ID \"your message\""
```

## Time Estimate

| Step | Time |
|------|------|
| Installation | ~5 minutes |
| Configuration | ~2 minutes |
| Start services | ~1 minute |
| Create workspace | ~2 minutes |
| **Total** | **~10 minutes** |

*Plus time for agent to complete work (varies by issue complexity)*

## Common First-Time Issues

### Docker not running

**Problem:** `pan workspace create` fails with Docker error

**Solution:**
```bash
# Start Docker daemon
sudo systemctl start docker  # Linux
# Or start Docker Desktop (macOS/Windows)

# Verify
docker ps
```

### Ports already in use

**Problem:** `pan up` fails because ports 3001/3002 are busy

**Solution:**
```bash
# Find what's using the port
lsof -i :3001

# Kill the process or use different ports
DASHBOARD_PORT=4001 API_PORT=4002 pan up
```

### Issue tracker not configured

**Problem:** `pan issues` returns empty or errors

**Solution:**
```bash
# Verify API key is set
cat ~/.panopticon.env | grep API_KEY

# Test connection manually
# For Linear:
curl -X POST https://api.linear.app/graphql \
  -H "Authorization: $LINEAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ viewer { name } }"}'
```

### Agent session not starting

**Problem:** `pan start` completes but no tmux session

**Solution:**
```bash
# Check tmux is installed
which tmux

# List tmux sessions
tmux list-sessions

# Check for error logs
cat ~/.panopticon/logs/agent-*.log
```

## What You've Accomplished

After completing this quick start, you have:
- ✅ Panopticon installed and configured
- ✅ Issue tracker connected
- ✅ Dashboard running at http://localhost:3001
- ✅ First workspace created
- ✅ AI agent working on an issue
- ✅ Understanding of basic workflow

## Next Steps

### Learn More
- `/pan-help` - Explore all available commands
- `/pan-docker` - Configure Docker templates for your stack
- `/pan-network` - Set up local domains (feature-123.localhost)
- `/pan-config` - Advanced configuration options

### Productivity Tips
- Use dashboard to monitor multiple agents
- Set up beads for task tracking
- Configure git hooks for automated workflows
- Create custom skills for your team's processes

### Advanced Features
- **Planning sessions**: `pan plan <id>` before spawning agent
- **Multiple agents**: Run agents in parallel for different issues
- **Custom templates**: Create Docker templates for your stack
- **State mapping**: Map Linear states to git branches

## Troubleshooting

If you get stuck at any step:

```bash
# Check system health
pan doctor

# View detailed logs
cat ~/.panopticon/logs/panopticon.log

# Check dashboard logs
cd panopticon-cli/src/dashboard
npm run dev  # Run in foreground to see errors

# Get help
pan --help
pan <command> --help
```

Use these skills for specific issues:
- `/pan-install` - Installation problems
- `/pan-setup` - Configuration problems
- `/session-health` - Stuck or crashed agents
- `/pan-help` - General command reference

## Feedback and Support

If you encounter issues:
1. Check the troubleshooting section above
2. Run `pan doctor` for diagnostic info
3. Visit https://github.com/eltmon/panopticon-cli/issues
4. Join the community (link in README)

## Related Skills

- `/pan-install` - Detailed installation guide
- `/pan-setup` - Configuration wizard
- `/pan-help` - Command reference
- `/pan-issue` - Workspace creation details
- `/pan-status` - Monitoring agents

## Success Checklist

- [ ] `pan --help` works
- [ ] `pan doctor` shows all green checkmarks
- [ ] `pan issues` shows issues from your tracker
- [ ] Dashboard accessible at http://localhost:3001
- [ ] Created first workspace with `pan start`
- [ ] Agent running in tmux session
- [ ] Can send messages to agent with `pan tell`
- [ ] Understand how to approve work with `pan approve`

**Congratulations!** You're now ready to use Panopticon for multi-agent development workflows.
