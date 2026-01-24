# Pan Workspace Config

Configure workspace settings for polyrepo projects, DNS, Docker, services, and more.

## Trigger Patterns

- "configure workspace"
- "setup polyrepo"
- "workspace template"
- "multi-repo workspace"
- "configure services"

## What This Skill Does

Guides you through configuring workspace settings in `~/.panopticon/projects.yaml`:

1. **Workspace Type** - Monorepo (single git repo) or Polyrepo (multiple repos)
2. **Git Repositories** - Configure which repos to include for polyrepo projects
3. **Services** - Define how to start each service (API, frontend, etc.)
4. **DNS Configuration** - Set up local domains for development (WSL2/macOS/Linux)
5. **Port Management** - Configure port assignments for services like Redis
6. **Docker Templates** - Set up devcontainer templates
7. **Agent Templates** - Configure AI agent settings (CLAUDE.md, .mcp.json)
8. **Environment Variables** - Template for .env files

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

      # Service definitions - how to start each service
      services:
        - name: api
          path: api
          start_command: ./mvnw spring-boot:run  # or use template
          docker_command: ./mvnw spring-boot:run
          health_url: "https://api-{{FEATURE_FOLDER}}.{{DOMAIN}}/health"
          port: 8080
        - name: frontend
          path: fe
          start_command: pnpm start
          docker_command: pnpm start
          health_url: "https://{{FEATURE_FOLDER}}.{{DOMAIN}}"
          port: 3000

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

## Service Templates

Panopticon provides built-in templates for common frameworks. Use these to avoid boilerplate:

### Frontend Frameworks

| Template | Start Command | Port |
|----------|--------------|------|
| `react` | `npm start` | 3000 |
| `react-vite` | `npm run dev` | 5173 |
| `react-pnpm` | `pnpm start` | 3000 |
| `nextjs` | `npm run dev` | 3000 |
| `vue` | `npm run dev` | 5173 |
| `angular` | `ng serve` | 4200 |

### Backend Frameworks

| Template | Start Command | Port |
|----------|--------------|------|
| `spring-boot-maven` | `./mvnw spring-boot:run` | 8080 |
| `spring-boot-gradle` | `./gradlew bootRun` | 8080 |
| `express` | `npm start` | 3000 |
| `fastapi` | `uvicorn main:app --reload` | 8000 |
| `django` | `python manage.py runserver` | 8000 |
| `rails` | `rails server` | 3000 |
| `go` | `go run .` | 8080 |
| `rust-cargo` | `cargo run` | 8080 |

### Using Templates

You can reference templates by name and override specific fields:

```yaml
services:
  - name: api
    template: spring-boot-maven  # Use template defaults
    path: api
    health_url: "https://api-{{FEATURE_FOLDER}}.myapp.test/health"
  - name: frontend
    template: react-vite
    path: fe
    start_command: pnpm dev  # Override template default
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

### React + Express Monorepo

```yaml
projects:
  myapp:
    name: "My App"
    path: /home/user/projects/myapp
    linear_team: APP
    workspace:
      services:
        - name: api
          template: express
          path: server
        - name: frontend
          template: react-vite
          path: client
```

### Spring Boot + React Polyrepo

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
      services:
        - name: api
          template: spring-boot-maven
          path: api
          health_url: "https://api-{{FEATURE_FOLDER}}.myapp.test/actuator/health"
        - name: frontend
          template: react-pnpm
          path: fe
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

## Custom Workspace Scripts

For complex projects, you can provide custom scripts instead of using built-in workspace creation:

```yaml
projects:
  myproject:
    workspace_command: /path/to/my-new-feature-script
    workspace_remove_command: /path/to/my-remove-feature-script
```

Your custom script receives:
- `$1`: Feature name (e.g., `min-123`)
- `--docker`: Flag to start Docker containers

Example script structure:
```bash
#!/bin/bash
FEATURE_NAME="$1"
START_DOCKER=false
[[ "$*" == *"--docker"* ]] && START_DOCKER=true

# Your workspace creation logic here...

if [ "$START_DOCKER" = true ]; then
  docker compose up -d
fi
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
- `/pan-test-config` - Test suite configuration
