# Pan Workspace Config

Configure workspace settings for polyrepo projects, DNS, Docker, and more.

## Trigger Patterns

- "configure workspace"
- "setup polyrepo"
- "workspace template"
- "multi-repo workspace"

## What This Skill Does

Guides you through configuring workspace settings in `~/.panopticon/projects.yaml`:

1. **Workspace Type** - Monorepo (single git repo) or Polyrepo (multiple repos)
2. **Git Repositories** - Configure which repos to include for polyrepo projects
3. **DNS Configuration** - Set up local domains for development (WSL2/macOS/Linux)
4. **Port Management** - Configure port assignments for services like Redis
5. **Docker Templates** - Set up devcontainer templates
6. **Agent Templates** - Configure AI agent settings (CLAUDE.md, .mcp.json)
7. **Environment Variables** - Template for .env files

## Configuration Schema

```yaml
projects:
  myproject:
    name: "My Project"
    path: /home/user/projects/myproject
    linear_team: PRJ

    workspace:
      # 'polyrepo' = multiple git repos, 'monorepo' = single repo (default)
      type: polyrepo

      # Where to create workspaces (relative to project path)
      workspaces_dir: workspaces

      # Git repositories (for polyrepo)
      repos:
        - name: fe           # Name in workspace
          path: frontend     # Source repo relative to project root
          branch_prefix: "feature/"
        - name: api
          path: api
          branch_prefix: "feature/"

      # DNS configuration
      dns:
        domain: myproject.test
        entries:
          - "{{FEATURE_FOLDER}}.{{DOMAIN}}"
          - "api-{{FEATURE_FOLDER}}.{{DOMAIN}}"
        sync_method: wsl2hosts  # or: hosts_file, dnsmasq

      # Port assignments
      ports:
        redis:
          range: [6380, 6499]

      # Docker configuration
      docker:
        traefik: infra/docker-compose.traefik.yml
        compose_template: infra/.devcontainer-template

      # Agent configuration
      agent:
        template_dir: infra/.agent-template
        templates:
          - source: CLAUDE.md.template
            target: CLAUDE.md
          - source: .mcp.json.template
            target: .mcp.json
        symlinks:
          - .claude/commands
          - .claude/skills

      # Environment template
      env:
        template: |
          COMPOSE_PROJECT_NAME={{COMPOSE_PROJECT}}
          FEATURE_FOLDER={{FEATURE_FOLDER}}
          FRONTEND_URL=https://{{FEATURE_FOLDER}}.{{DOMAIN}}
```

## Template Placeholders

| Placeholder | Example | Description |
|------------|---------|-------------|
| `{{FEATURE_NAME}}` | `min-123` | Normalized issue ID |
| `{{FEATURE_FOLDER}}` | `feature-min-123` | Workspace folder name |
| `{{BRANCH_NAME}}` | `feature/min-123` | Git branch name |
| `{{COMPOSE_PROJECT}}` | `myproject-feature-min-123` | Docker Compose project name |
| `{{DOMAIN}}` | `myproject.test` | DNS domain |
| `{{PROJECT_NAME}}` | `myproject` | Project name |
| `{{PROJECT_PATH}}` | `/home/user/projects/myproject` | Project root path |
| `{{WORKSPACE_PATH}}` | `/home/.../workspaces/feature-min-123` | Full workspace path |

## Quick Start Examples

### Simple Monorepo (Default)

```yaml
projects:
  myapp:
    name: "My App"
    path: /home/user/projects/myapp
    linear_team: APP
    # No workspace config needed - uses defaults
```

### Polyrepo with Frontend + Backend

```yaml
projects:
  myapp:
    name: "My App"
    path: /home/user/projects/myapp
    linear_team: APP
    workspace:
      type: polyrepo
      repos:
        - name: fe
          path: frontend
        - name: api
          path: backend
      dns:
        domain: myapp.test
        entries:
          - "{{FEATURE_FOLDER}}.myapp.test"
          - "api-{{FEATURE_FOLDER}}.myapp.test"
```

### Full Configuration (MYN-style)

See the Mind Your Now project for a complete example:
```bash
cat ~/.panopticon/projects.yaml
```

## DNS Setup

### WSL2 (Windows Subsystem for Linux)

Uses `~/.wsl2hosts` file which syncs to Windows hosts file:

1. Add entries to `~/.wsl2hosts` (one hostname per line)
2. Run PowerShell scheduled task to sync to Windows

```bash
# Entries are added automatically by pan workspace create
cat ~/.wsl2hosts
# feature-min-123.myapp.test
# api-feature-min-123.myapp.test
```

### macOS

Uses `/etc/hosts` directly (requires sudo for initial setup).

### Linux

Uses `/etc/hosts` or dnsmasq depending on configuration.

## Related Commands

```bash
# Create workspace (uses configuration from projects.yaml)
pan workspace create MIN-123

# Create with Docker startup
pan workspace create MIN-123 --docker

# Remove workspace
pan workspace destroy MIN-123

# List workspaces across all projects
pan workspace list --all
```

## Related Skills

- `/pan-docker` - Docker template selection
- `/pan-network` - Traefik and networking setup
- `/pan-projects` - Project management
