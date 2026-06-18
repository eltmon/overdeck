# Overdeck Dev Container Template

> ⚠️ **WORKSPACE CONTAINERS ONLY** - This is for isolated workspace testing, NOT the main dashboard.
>
> | Component | How it runs |
> |-----------|-------------|
> | **Main dashboard** (`src/dashboard/`) | Directly on host via `npm run dev` |
> | **Workspace testing** (`workspaces/feature-XXX/`) | In Docker containers (this template) |
>
> The main dashboard you use for development always runs on your host machine.
> These containers are only for agents to test their changes in isolation before merging.

## Current Status

✅ **READY** - Container setup is functional.

The docker-compose template now properly mounts the entire project directory and shadows
node_modules to handle cross-directory imports correctly.

---

## Structure

```
.devcontainer-template/
├── Dockerfile                              # Node.js 20 Alpine with dev tools
├── docker-compose.devcontainer.yml.template  # Frontend + Server services
├── devcontainer.json.template              # VS Code devcontainer config
├── dev.template                            # Convenience script for ./dev up
└── README.md                               # This file
```

## How It Works (When Enabled)

When `pan workspace create PAN-XXX` is run:

1. Creates git worktree at `workspaces/feature-pan-xxx/`
2. Copies this template to `workspaces/feature-pan-xxx/.devcontainer/`
3. Replaces `{{FEATURE_FOLDER}}` placeholders with `feature-pan-xxx`
4. Creates `dev` symlink for convenience script
5. Starts Docker containers with Traefik routing

## Services

| Service | Description | URL |
|---------|-------------|-----|
| frontend | Vite dev server with HMR | `https://{{FEATURE_FOLDER}}.pan.localhost` |
| server | Express API with tsx watch | `https://api-{{FEATURE_FOLDER}}.pan.localhost` |
| dev | VS Code attach container | - |

## Usage

### Via Convenience Script

```bash
cd workspaces/feature-pan-xxx/
./dev up        # Start containers and wait for health
./dev logs      # Tail logs
./dev down      # Stop containers
./dev rebuild   # Rebuild from scratch
```

### Via Overdeck CLI

```bash
# Create workspace with Docker containers
pan workspace create PAN-103

# Access the feature
open https://feature-pan-103.pan.localhost
```

### VS Code Dev Containers

1. Open VS Code in the workspace
2. Command Palette → "Dev Containers: Reopen in Container"

## Requirements

- Docker
- Overdeck Traefik running (`~/.panopticon/traefik/`)
- `panopticon` Docker network created
- Wildcard certs for `*.pan.localhost`

## Resolved Issues (PAN-109)

The following issues have been addressed:

1. ~~**Cross-directory imports**~~: Fixed by mounting entire project and shadowing node_modules
2. **Volume permissions**: Named volumes must be pre-created with correct ownership
3. ~~**Port mismatch**~~: Templates now use correct ports
