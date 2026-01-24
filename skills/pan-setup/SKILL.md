---
name: pan-setup
description: First-time configuration wizard for Panopticon
triggers:
  - configure panopticon
  - setup panopticon
  - panopticon configuration
  - first time setup
allowed-tools:
  - Bash
  - Read
  - Edit
  - AskUserQuestion
---

# Panopticon Setup Guide

## Overview

This skill guides you through the first-time configuration of Panopticon, including setting up issue trackers, adding projects, and configuring environment variables.

## When to Use

- First-time setup after installation
- User wants to add a new issue tracker
- User needs to configure API keys
- User wants to add/remove projects
- Reconfiguring Panopticon after moving to a new machine

## Configuration File

Panopticon's main configuration is stored in `~/.panopticon.env`.

## Setup Workflow

### Step 1: Initialize Configuration

If not already done:

```bash
pan init
```

This creates `~/.panopticon.env` with default configuration.

### Step 2: Configure Issue Tracker

Panopticon supports Linear, GitHub, and GitLab issue trackers.

#### Linear Configuration

```bash
# Edit ~/.panopticon.env and add:
LINEAR_API_KEY=lin_api_xxxxxxxxxxxxxxxxxxxxx
LINEAR_TEAM_ID=your-team-id
```

**Getting your Linear API key:**
1. Go to https://linear.app/settings/api
2. Create a new personal API key
3. Copy the key (starts with `lin_api_`)

**Finding your Linear Team ID:**
```bash
# After setting LINEAR_API_KEY, run:
curl -X POST https://api.linear.app/graphql \
  -H "Authorization: YOUR_LINEAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ teams { nodes { id name } } }"}'
```

Or use the Linear web app URL: `https://linear.app/<workspace>/<team>`

#### GitHub Configuration

```bash
# Edit ~/.panopticon.env and add:
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxx
GITHUB_OWNER=your-username-or-org
GITHUB_REPO=your-repo-name
```

**Getting your GitHub token:**
1. Go to https://github.com/settings/tokens
2. Generate new token (classic)
3. Select scopes: `repo`, `workflow`
4. Copy the token (starts with `ghp_`)

#### GitLab Configuration

```bash
# Edit ~/.panopticon.env and add:
GITLAB_TOKEN=glpat-xxxxxxxxxxxxxxxxxxxxx
GITLAB_PROJECT_ID=12345678
```

**Getting your GitLab token:**
1. Go to https://gitlab.com/-/profile/personal_access_tokens
2. Create new token with `api` scope
3. Copy the token (starts with `glpat-`)

**Finding your GitLab project ID:**
- Visit your project on GitLab
- Project ID is shown under the project name

### Step 3: Add Projects

Add the projects you want Panopticon to manage:

```bash
# Add a project
pan project add /home/user/projects/myapp

# Verify it was added
pan project list
```

You can add multiple projects:
```bash
pan project add /home/user/projects/frontend
pan project add /home/user/projects/backend
pan project add /home/user/projects/mobile
```

### Step 4: Configure Workspace Defaults

Edit `~/.panopticon.env` to set workspace defaults:

```env
# Default workspace root (where workspaces are created)
WORKSPACE_ROOT=~/projects/panopticon/workspaces

# Default Docker template (spring-boot, react-vite, nextjs, etc.)
DEFAULT_DOCKER_TEMPLATE=spring-boot

# Enable Traefik for local domains (true/false)
TRAEFIK_ENABLED=true

# Traefik domain suffix
TRAEFIK_DOMAIN=localhost
```

### Step 5: Configure Dashboard

```env
# Dashboard port (default: 3001)
DASHBOARD_PORT=3001

# API server port (default: 3002)
API_PORT=3002

# Enable auto-start dashboard on `pan up`
AUTO_START_DASHBOARD=true
```

### Step 6: Configure AI Tools

Panopticon syncs skills to various AI coding tools:

```env
# Claude Code skills directory
CLAUDE_CODE_SKILLS=~/.claude/skills

# Cursor skills directory (if using Cursor)
CURSOR_SKILLS=~/.cursor/skills

# Enable auto-sync after skill changes
AUTO_SYNC_SKILLS=true
```

### Step 7: Optional - Configure Beads

If using beads for issue tracking:

```env
# Beads database location
BEADS_DB=~/.beads/panopticon.db

# Enable beads integration
BEADS_ENABLED=true
```

### Step 8: Verify Configuration

```bash
# Check that everything is configured correctly
pan doctor

# Verify projects are added
pan project list

# Test tracker connection (if Linear)
pan work list
```

## Sample Configuration File

Here's a complete example `~/.panopticon.env`:

```env
# Issue Tracker
LINEAR_API_KEY=lin_api_xxxxxxxxxxxxxxxxxxxxx
LINEAR_TEAM_ID=abc123

# Projects (managed automatically via `pan project add`)
# Projects are stored in ~/.panopticon/projects.json

# Workspace Settings
WORKSPACE_ROOT=~/projects/panopticon/workspaces
DEFAULT_DOCKER_TEMPLATE=spring-boot
TRAEFIK_ENABLED=true
TRAEFIK_DOMAIN=localhost

# Dashboard
DASHBOARD_PORT=3001
API_PORT=3002
AUTO_START_DASHBOARD=true

# AI Tools
CLAUDE_CODE_SKILLS=~/.claude/skills
AUTO_SYNC_SKILLS=true

# Beads
BEADS_DB=~/.beads/panopticon.db
BEADS_ENABLED=true

# Agent Settings
DEFAULT_MODEL=sonnet
MAX_PARALLEL_AGENTS=3

# Logging
LOG_LEVEL=info
LOG_FILE=~/.panopticon/panopticon.log
```

## Interactive Setup

To guide the user through configuration interactively:

1. **Ask about issue tracker:**
   - Which tracker do they use? (Linear, GitHub, GitLab)
   - Help them get API key/token
   - Help them find team/project ID

2. **Ask about projects:**
   - Which projects should Panopticon manage?
   - Get absolute paths to project directories

3. **Ask about Docker:**
   - What type of projects? (Spring Boot, React, Next.js, etc.)
   - Set appropriate default template

4. **Ask about preferences:**
   - Should dashboard auto-start?
   - Enable Traefik for local domains?
   - Auto-sync skills to AI tools?

## Troubleshooting

### Can't connect to Linear

**Problem:** `pan work list` fails with authentication error

**Solutions:**
```bash
# Verify API key is correct
echo $LINEAR_API_KEY  # Should start with lin_api_

# Test API key directly
curl -X POST https://api.linear.app/graphql \
  -H "Authorization: $LINEAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ viewer { name } }"}'

# Should return your name, not an error
```

### Projects not showing up

**Problem:** `pan project list` shows no projects

**Solutions:**
```bash
# Add project again
pan project add /path/to/project

# Check projects.json directly
cat ~/.panopticon/projects.json

# Verify path is absolute (not relative)
pan project add "$(pwd)"  # Use $PWD for current directory
```

### Dashboard won't start

**Problem:** `pan up` fails or dashboard unreachable

**Solutions:**
```bash
# Check ports aren't in use
lsof -i :3001
lsof -i :3002

# Check configuration
cat ~/.panopticon.env | grep PORT

# Try custom ports
DASHBOARD_PORT=4001 API_PORT=4002 pan up
```

### Skills not syncing

**Problem:** Skills don't appear in Claude Code

**Solutions:**
```bash
# Run sync manually
pan sync

# Check target directory exists
ls ~/.claude/skills/

# Create if missing
mkdir -p ~/.claude/skills

# Verify permissions
chmod -R u+w ~/.claude/skills

# Sync again
pan sync
```

### Environment variables not loading

**Problem:** Configuration changes don't take effect

**Solutions:**
```bash
# Verify file location
ls -la ~/.panopticon.env

# Check for syntax errors
cat ~/.panopticon.env

# Ensure no spaces around = in env vars
# WRONG: KEY = value
# RIGHT: KEY=value

# Restart services
pan down
pan up
```

## What Your Project Repository Needs

After adding a project, you may need to create templates in your project for Docker-based workspaces to work. **This is optional if you only need git worktrees without Docker.**

### For Docker-Based Workspaces

Your project needs to provide templates that Panopticon copies/processes when creating workspaces:

```
your-project/
├── infra/
│   └── .devcontainer-template/
│       ├── docker-compose.devcontainer.yml.template
│       ├── compose.infra.yml.template   # Optional: for postgres, redis, etc.
│       ├── Dockerfile
│       └── devcontainer.json.template   # Optional: VS Code integration
└── ...
```

### Docker Compose Template Example

```yaml
# docker-compose.devcontainer.yml.template
services:
  app:
    build: .
    labels:
      - "traefik.http.routers.{{FEATURE_FOLDER}}.rule=Host(`{{FEATURE_FOLDER}}.{{DOMAIN}}`)"
    volumes:
      - ../..:/workspace:cached
```

**Available placeholders:**
- `{{FEATURE_NAME}}` - Issue ID (e.g., `min-123`)
- `{{FEATURE_FOLDER}}` - Workspace folder (e.g., `feature-min-123`)
- `{{BRANCH_NAME}}` - Git branch (e.g., `feature/min-123`)
- `{{COMPOSE_PROJECT}}` - Docker project name
- `{{DOMAIN}}` - Configured domain (e.g., `myapp.test`)

### For Database Seeding

If your project uses a database:

```
your-project/
├── infra/
│   └── seed/
│       └── seed.sql          # Pre-populated database dump
└── ...
```

Mount in your compose template:
```yaml
services:
  postgres:
    image: postgres:16
    volumes:
      - /path/to/project/infra/seed:/docker-entrypoint-initdb.d:ro
```

### Minimal Setup (Git Worktrees Only)

For simple projects that don't need Docker:

```yaml
# In ~/.panopticon/projects.yaml
projects:
  simple-app:
    name: "Simple App"
    path: /home/user/projects/simple-app
    linear_team: APP
    # No workspace config = uses plain git worktrees
```

### Full Configuration

See README section "What Your Project Needs to Provide" for complete documentation:
https://github.com/eltmon/panopticon#what-your-project-needs-to-provide

---

## Post-Setup

After configuration:

1. **Start services**: `pan up`
2. **Verify health**: `pan doctor`
3. **Test issue tracker**: `pan work list`
4. **Sync skills**: `pan sync`
5. **Create first workspace**: Use `/pan-issue` skill

## Configuration Checklist

- [ ] Run `pan init` to create config file
- [ ] Add issue tracker API key (Linear/GitHub/GitLab)
- [ ] Add at least one project with `pan project add`
- [ ] Set workspace defaults (root directory, Docker template)
- [ ] Configure dashboard ports if needed
- [ ] Enable AI tools sync
- [ ] Run `pan doctor` to verify
- [ ] Run `pan work list` to test tracker connection
- [ ] Run `pan sync` to distribute skills
- [ ] Start dashboard with `pan up`

## Next Steps

- Use `/pan-quickstart` for combined install + setup workflow
- Use `/pan-docker` to configure Docker templates
- Use `/pan-tracker` for advanced tracker configuration
- Use `/pan-help` to explore available commands

## Related Skills

- `/pan-install` - Installation prerequisites
- `/pan-quickstart` - Quick start guide
- `/pan-tracker` - Tracker configuration (advanced)
- `/pan-projects` - Project management
- `/pan-config` - View/edit configuration

## More Information

- Configuration file: `~/.panopticon.env`
- Projects list: `~/.panopticon/projects.json`
- Run `pan doctor` to check configuration
- Visit dashboard at http://localhost:3001
