# Panopticon Dev Container Template

This template is used by `pan workspace create` to set up isolated Docker development environments for Panopticon feature branches.

## Structure

```
.devcontainer-template/
├── Dockerfile                              # Node.js 20 Alpine with dev tools
├── docker-compose.devcontainer.yml.template  # Frontend + Server services
├── devcontainer.json.template              # VS Code devcontainer config
└── README.md                               # This file
```

## How It Works

When `pan workspace create PAN-XXX` is run:

1. Creates git worktree at `workspaces/feature-pan-xxx/`
2. Copies this template to `workspaces/feature-pan-xxx/.devcontainer/`
3. Replaces `{{FEATURE_FOLDER}}` placeholders with `feature-pan-xxx`
4. Starts Docker containers with Traefik routing

## Services

| Service | Description | URL |
|---------|-------------|-----|
| frontend | Vite dev server with HMR | `https://{{FEATURE_FOLDER}}.pan.localhost` |
| server | Express API with tsx watch | `https://api-{{FEATURE_FOLDER}}.pan.localhost` |
| dev | VS Code attach container | - |

## Usage

### Via Panopticon CLI

```bash
# Create workspace with Docker containers
pan workspace create PAN-103

# Access the feature
open https://feature-pan-103.pan.localhost
```

### Manual Docker Compose

```bash
cd workspaces/feature-pan-xxx/.devcontainer
docker compose -f docker-compose.devcontainer.yml up -d
```

### VS Code Dev Containers

1. Open VS Code in the workspace
2. Command Palette → "Dev Containers: Reopen in Container"

## Requirements

- Docker
- Panopticon Traefik running (`~/.panopticon/traefik/`)
- `panopticon` Docker network created
- Wildcard certs for `*.pan.localhost`

## Ports

- Frontend: 5173 (Vite)
- Server: 3011 (Express)

Both are routed via Traefik HTTPS.
