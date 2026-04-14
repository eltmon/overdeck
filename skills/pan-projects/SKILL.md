---
name: pan-projects
description: "pan project <subcommand> — add, remove, and manage Panopticon-monitored projects"
triggers:
  - pan projects
  - add project
  - remove project
  - list projects
  - manage projects
  - register project
allowed-tools:
  - Bash
  - Read
---

# Project Management

## Overview

This skill guides you through managing projects with Panopticon. Projects must be registered before Panopticon can create workspaces and spawn agents for them.

## When to Use

- Adding a new project to Panopticon
- Listing managed projects
- Removing a project from Panopticon
- Setting up project-to-tracker mappings

## Core Concepts

**Project**: A local git repository that Panopticon manages
**Workspace**: Isolated environment created within a project for an issue
**Mapping**: Link between tracker project/repo and local project path

## Commands

### Add a Project

```bash
# Basic: Register a project with auto-detected name
pan project add /path/to/your/project

# With explicit name
pan project add /path/to/your/project --name myproject

# With Rally project mapping (for per-project Rally scoping)
pan project add /path/to/hsv3 --name "HSv3" --rally-project "/project/822404704163"

# Example
pan project add /home/user/projects/my-app --name myapp
```

### List Projects

```bash
pan project list
```

Output:
```
Registered Projects:
  myapp       /home/user/projects/my-app
  backend     /home/user/projects/backend
  frontend    /home/user/projects/frontend
```

### Remove a Project

```bash
pan project remove myproject

# Example
pan project remove myapp
```

**Note:** This only removes the project from Panopticon's registry. It does NOT delete the actual project files.

## Project Requirements

For a project to work well with Panopticon:

1. **Git repository**: Must be a git repo (has `.git/`)
2. **Clean state**: Should have a clean working tree for worktree creation
3. **Main branch**: Should have a main/master branch to branch from

### Optional Enhancements

| File | Purpose |
|------|---------|
| `CLAUDE.md` | Project-specific AI instructions |
| `.claude/skills/` | Project-specific skills |
| `dev` script | Start development containers |
| `docker-compose.yml` | Container orchestration |

## Project Configuration Files

### projects.json

Located at `~/.panopticon/projects.json`:

```json
[
  {
    "name": "myapp",
    "path": "/home/user/projects/my-app",
    "addedAt": "2024-01-15T10:30:00Z"
  }
]
```

### project-mappings.json

Located at `~/.panopticon/project-mappings.json`:

Maps tracker projects to local paths:

```json
[
  {
    "linearProjectId": "abc123",
    "linearProjectName": "My App",
    "linearPrefix": "APP",
    "localPath": "/home/user/projects/my-app"
  }
]
```

For GitHub:
```bash
# In ~/.panopticon.env
GITHUB_LOCAL_PATHS=owner/repo=/home/user/projects/my-app
```

## Workflow: Adding a New Project

### 1. Register the Project

```bash
pan project add /path/to/project --name myproject
```

### 2. Create CLAUDE.md (Recommended)

Create a `CLAUDE.md` file in your project root with:
- Project overview
- Key directories
- Development guidelines
- Testing instructions

### 3. Set Up Tracker Mapping

For Linear:
```bash
# Edit ~/.panopticon/project-mappings.json
# Add entry mapping Linear project to local path
```

For GitHub:
```bash
# Add to ~/.panopticon.env
GITHUB_LOCAL_PATHS=owner/myrepo=/path/to/project
```

### 4. Verify Setup

```bash
# List projects
pan project list

# Check issues can be fetched
pan issues

# Create a test workspace
pan workspace create ISSUE-1
```

## Workflow: Project with Docker

If your project uses Docker for development:

### 1. Create a `dev` Script

```bash
#!/bin/bash
# dev - Start development environment
docker compose up -d
```

Make it executable:
```bash
chmod +x dev
```

### 2. Create docker-compose.yml

```yaml
version: '3.8'
services:
  app:
    build: .
    volumes:
      - .:/app
    ports:
      - "3000:3000"
```

### 3. Panopticon Integration

When you run `pan start ISSUE-1`, Panopticon will:
1. Create a workspace (git worktree)
2. Detect the `dev` script
3. Offer to start containers for the workspace

## Troubleshooting

**Problem:** `pan project add` fails
**Solution:**
- Ensure the path exists and is a git repository
- Check you have write permissions to `~/.panopticon/`

**Problem:** Workspaces created in wrong location
**Solution:**
- Verify project path in `pan project list`
- Check project-mappings.json for correct localPath

**Problem:** Agent can't find project context
**Solution:**
- Create a CLAUDE.md in project root
- Ensure project is registered with correct path

## Best Practices

1. **Use descriptive names**: `pan project add ... --name frontend` instead of `proj1`
2. **Keep mappings updated**: When moving projects, update both projects.json and mappings
3. **Add CLAUDE.md**: Helps agents understand your project
4. **Use project-specific skills**: Put custom skills in `.claude/skills/`

## Related Skills

- `/pan:config` - General configuration
- `/pan:tracker` - Set up issue tracker integration
- `/pan:docker` - Docker template setup
