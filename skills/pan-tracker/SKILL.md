---
name: pan-tracker
description: Configure issue tracker integration (Linear, GitHub, GitLab, Rally)
triggers:
  - pan tracker
  - configure tracker
  - setup linear
  - setup github issues
  - setup rally
  - connect issue tracker
  - tracker integration
allowed-tools:
  - Bash
  - Read
  - Edit
---

# Issue Tracker Configuration

## Overview

This skill guides you through configuring issue tracker integration with Panopticon. Supported trackers include Linear, GitHub Issues, GitLab Issues, and Rally (Broadcom Agile Central).

## When to Use

- Setting up a new tracker integration
- Switching between trackers
- Configuring project-to-tracker mappings
- Troubleshooting tracker connectivity

## Supported Trackers

| Tracker | Status | Configuration |
|---------|--------|---------------|
| **Linear** | Full support | API key in `~/.panopticon.env` |
| **GitHub Issues** | Full support | Token + repo config in `~/.panopticon.env` |
| **GitLab Issues** | Partial | Token + URL in `~/.panopticon.env` |
| **Rally** | Full support | API key + workspace/project in `~/.panopticon/config.toml` |

## Linear Setup

### 1. Get Your API Key

1. Go to Linear → Settings → API
2. Click "Personal API keys"
3. Click "Create key"
4. Copy the key (starts with `lin_api_`)

### 2. Configure Panopticon

```bash
# Add to ~/.panopticon.env
echo "LINEAR_API_KEY=lin_api_your_key_here" >> ~/.panopticon.env
```

### 3. Map Linear Projects to Local Paths

Create/edit `~/.panopticon/project-mappings.json`:

```json
[
  {
    "linearProjectId": "abc123",
    "linearProjectName": "My Project",
    "linearPrefix": "PRJ",
    "localPath": "/home/user/projects/myproject"
  }
]
```

To find your Linear project ID:
```bash
# Use the dashboard or Linear API
# Project ID is in the URL when viewing a project
```

### 4. Verify Setup

```bash
pan work list
# Should show issues from your Linear projects
```

## GitHub Issues Setup

### 1. Get Your Token

```bash
# If you have gh CLI installed:
gh auth token

# Or create a Personal Access Token at:
# GitHub → Settings → Developer settings → Personal access tokens
# Required scopes: repo, read:org
```

### 2. Configure Panopticon

```bash
cat >> ~/.panopticon.env << 'EOF'
GITHUB_TOKEN=ghp_your_token_here
GITHUB_REPOS=owner/repo:PREFIX
GITHUB_LOCAL_PATHS=owner/repo=/path/to/local/repo
EOF
```

**Format explanation:**
- `GITHUB_REPOS`: Comma-separated list of `owner/repo:PREFIX` (PREFIX is optional, defaults to REPO uppercase)
- `GITHUB_LOCAL_PATHS`: Comma-separated list of `owner/repo=/local/path`

### 3. Example Multi-Repo Setup

```bash
GITHUB_REPOS=myorg/frontend:FE,myorg/backend:BE,myorg/infra:INF
GITHUB_LOCAL_PATHS=myorg/frontend=/home/user/frontend,myorg/backend=/home/user/backend,myorg/infra=/home/user/infra
```

### 4. Create Required Labels

Panopticon uses labels to track issue state:
```bash
# Create labels for your repo
gh label create "planning" --description "Issue is in planning phase" --color "a855f7"
gh label create "in-progress" --description "Work is actively being done" --color "3b82f6"
gh label create "done" --description "Work completed" --color "22c55e"
```

### 5. Verify Setup

```bash
pan work list
# Should show issues from your GitHub repos
```

## GitLab Issues Setup

### 1. Get Your Token

1. Go to GitLab → Preferences → Access Tokens
2. Create a token with `api` scope
3. Copy the token (starts with `glpat-`)

### 2. Configure Panopticon

```bash
cat >> ~/.panopticon.env << 'EOF'
GITLAB_TOKEN=glpat-your_token_here
GITLAB_URL=https://gitlab.com
EOF
```

For self-hosted GitLab, change `GITLAB_URL` to your instance URL.

## Rally Setup

### 1. Get Your API Key

1. Log into Rally at https://rally1.rallydev.com (or your organization's Rally server)
2. Click your profile icon → API Keys
3. Click "Generate New API Key"
4. Copy the API key

### 2. Find Your Workspace and Project OIDs

```bash
# Workspace OID is in the URL when viewing your workspace
# Example: https://rally1.rallydev.com/#/12345d/dashboard
# Workspace OID: /workspace/12345

# Project OID is in the URL when viewing a project
# Example: https://rally1.rallydev.com/#/12345d/portfolioitemstreegrid?workspace=/workspace/12345&project=/project/67890
# Project OID: /project/67890
```

**Note:** The workspace and project parameters are optional. If not specified, Rally will query all accessible workspaces/projects.

### 3. Configure Panopticon

Add Rally configuration to `~/.panopticon/config.toml`:

```toml
[trackers.rally]
type = "rally"
api_key_env = "RALLY_API_KEY"
server = "https://rally1.rallydev.com"  # Optional, defaults to rally1.rallydev.com
workspace = "/workspace/12345"           # Optional, your workspace OID
project = "/project/67890"               # Optional, your project OID
```

Add your API key to `~/.panopticon.env`:

```bash
echo "RALLY_API_KEY=_abc123your_key_here" >> ~/.panopticon.env
```

### 4. Set Rally as Primary or Secondary Tracker

In `~/.panopticon/config.toml`, specify Rally as your primary or secondary tracker:

```toml
[trackers]
primary = "linear"     # Your main tracker
secondary = "rally"    # Rally as secondary tracker

# Or use Rally as primary:
# primary = "rally"
```

### 5. Verify Setup

```bash
pan work list --tracker rally
# Should show issues from your Rally workspace

# Or list all trackers:
pan work list --all-trackers
```

### Rally-Specific Notes

- **Work Item Types**: Rally supports User Stories, Defects, Tasks, and Features. All are treated as issues in Panopticon.
- **State Mapping**:
  - `Defined` → Open
  - `In-Progress` → In Progress
  - `Completed`, `Accepted` → Closed
- **Identifiers**: Rally uses FormattedID (e.g., `US123`, `DE456`, `TA789`, `F012`)
- **Priority**: Rally's priority strings (High, Normal, Low) are automatically mapped to numeric priorities

## Multiple Trackers

You can configure multiple trackers simultaneously. Panopticon will aggregate issues from all configured trackers.

```bash
# ~/.panopticon.env with multiple trackers
LINEAR_API_KEY=lin_api_xxxxx
GITHUB_TOKEN=ghp_xxxxx
GITHUB_REPOS=myorg/repo:GH
GITHUB_LOCAL_PATHS=myorg/repo=/home/user/repo
RALLY_API_KEY=_abc123xxxxx
```

**Example config.toml with multiple trackers:**

```toml
[trackers]
primary = "linear"
secondary = "rally"

[trackers.linear]
type = "linear"
api_key_env = "LINEAR_API_KEY"

[trackers.rally]
type = "rally"
api_key_env = "RALLY_API_KEY"
workspace = "/workspace/12345"
project = "/project/67890"
```

## Workflow

1. **Choose your tracker(s)**: Linear, GitHub, GitLab, or Rally
2. **Get API credentials**: Follow the steps above for your tracker
3. **Add to ~/.panopticon.env**: Configure API keys/tokens
4. **Configure ~/.panopticon/config.toml**: Add tracker configuration
5. **Set up mappings**: Map tracker projects to local paths (if needed)
6. **Verify**: Run `pan work list` to confirm connectivity
7. **Restart dashboard**: `pan down && pan up`

## Troubleshooting

**Problem:** `pan work list` shows no issues
**Solution:**
- Check API key is correct in `~/.panopticon.env`
- Verify project mappings in `~/.panopticon/project-mappings.json`
- Restart dashboard: `pan down && pan up`

**Problem:** GitHub issues not syncing state
**Solution:** Ensure required labels exist (`planning`, `in-progress`, `done`)

**Problem:** Wrong project path for issues
**Solution:** Check `GITHUB_LOCAL_PATHS` or `project-mappings.json` mappings

## Related Skills

- `/pan:config` - General configuration
- `/pan:projects` - Manage local projects
- `/pan:status` - Check system health
