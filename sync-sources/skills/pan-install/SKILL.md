---
name: pan-install
description: Guide through installing Overdeck prerequisites
triggers:
  - install overdeck
  - setup overdeck dependencies
  - overdeck installation
allowed-tools:
  - Bash
  - Read
---

# Overdeck Installation Guide

## Overview

This skill guides you through installing all prerequisites for Overdeck, including Node.js, Docker, tmux, and other required dependencies.

## When to Use

- First-time installation of Overdeck
- User reports missing dependencies
- Setting up Overdeck on a new machine
- Troubleshooting installation issues

## Prerequisites

Overdeck requires:
- **Node.js** v18+ (for CLI and dashboard)
- **Docker** and Docker Compose (for workspaces)
- **Herdr** (default terminal backend for agent panes; auto-installed by `pan install` from https://herdr.dev/install.sh into `~/.local/bin`)
- **tmux** (legacy agent sessions and the opt-in `terminal.backend: tmux`)
- **Git** (for version control and workspace management)
- **Linear API key** (optional, for Linear integration)

## Installation Workflow

### Step 1: Check Current Status

First, check what's already installed:

```bash
pan doctor
```

This will show you which dependencies are missing or need updates.

### Step 2: Install Prerequisites

#### Automated Installation

The easiest way is to use Overdeck's built-in installer:

```bash
pan install
```

This will:
- Check for missing dependencies
- Offer to install missing components
- Install and verify Herdr: the binary, `~/.config/herdr/config.toml` with
  `[session] resume_agents_on_restore = false`, this home's session server
  (`overdeck-herdr.service` on systemd hosts), and the pilot integrations
  (`pi`, `omp`, `kimi`, `opencode`) for harnesses that are installed
- Guide you through platform-specific setup
- Detect Ollama, for running agents on a local GPU model. `pan install` never
  runs an installer for you: if Ollama is missing it prints the command for
  your platform. If Ollama is present and you are on an interactive terminal,
  it offers to pull the recommended `gemma4:12b` model (about 8 GB, defaults
  to No); without a terminal it prints `ollama pull gemma4:12b` instead. A
  missing binary or a failed pull is a warning, never a failed install.

Options:

| Flag | Effect |
| --- | --- |
| `--check` | Check prerequisites only (prints a `Herdr` row) |
| `--minimal` | Skip Traefik and mkcert (port-based routing) |
| `--skip-mkcert` | Skip mkcert/HTTPS setup |
| `--skip-docker` | Skip Docker network setup |
| `--skip-moonshine` | Skip the Moonshine voice sidecar build |
| `--skip-tts-daemon` | Skip the Qwen TTS daemon venv install |
| `--skip-herdr` | Skip Herdr terminal backend install/verify (tmux-only hosts) |
| `--skip-ollama` | Skip Ollama local-model detection and the optional `gemma4:12b` pull |

Herdr setup is also skipped under `CI`, under Vitest, and when the terminal
backend is explicitly tmux (`terminal.backend: tmux` in
`~/.overdeck/config.yaml` or `OVERDECK_TERMINAL_BACKEND=tmux`). Without Herdr
on a Herdr host, agent launches fail with an error naming `pan install` —
there is no silent tmux fallback.

#### Manual Installation

If automated installation doesn't work, install manually:

**Node.js (v18+)**
```bash
# Using nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 18
nvm use 18

# Or using package manager (Ubuntu/Debian)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Or using package manager (macOS)
brew install node@18
```

**Docker**
```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install -y docker.io docker-compose
sudo usermod -aG docker $USER
# Log out and back in for group changes

# macOS
brew install --cask docker
# Then start Docker Desktop

# WSL2
# Install Docker Desktop for Windows
# Enable WSL2 integration in Docker Desktop settings
```

**tmux**
```bash
# Ubuntu/Debian
sudo apt-get install -y tmux

# macOS
brew install tmux

# WSL2
sudo apt-get install -y tmux
```

**Git**
```bash
# Ubuntu/Debian
sudo apt-get install -y git

# macOS
brew install git

# WSL2
sudo apt-get install -y git
```

### Step 3: Install Overdeck

```bash
# Clone the repository (if not already done)
git clone https://github.com/eltmon/overdeck.git
cd overdeck

# Install dependencies
npm install

# Build the CLI
npm run build

# Install globally (optional, for `pan` command anywhere)
npm install -g .

# Or add to PATH
export PATH="$PATH:$(pwd)/node_modules/.bin"
```

### Step 4: Initialize Configuration

```bash
pan init
```

This creates `~/.overdeck.env` with default configuration.

### Step 5: Verify Installation

```bash
pan doctor
```

Should show all green checkmarks. If not, address any remaining issues.

## Platform-Specific Notes

### Linux

- Add your user to the `docker` group: `sudo usermod -aG docker $USER`
- Log out and back in for group changes to take effect
- Install Docker Compose v2: `sudo apt-get install docker-compose-plugin`

### macOS

- Install Docker Desktop (includes Docker Compose)
- Ensure Docker Desktop is running before using Overdeck
- May need to increase Docker memory limit (Preferences → Resources)

### WSL2 (Windows)

- Install Docker Desktop for Windows (not Docker in WSL)
- Enable WSL2 integration in Docker Desktop settings
- Use WSL2 Ubuntu distribution for Overdeck
- Clone Overdeck inside WSL filesystem (`~/projects/`), not Windows filesystem (`/mnt/c/`)

## Troubleshooting

### `pan` command not found

**Problem:** After installation, `pan` command isn't recognized

**Solutions:**
```bash
# Option 1: Install globally
cd /path/to/overdeck
npm install -g .

# Option 2: Add to PATH in ~/.bashrc or ~/.zshrc
export PATH="$PATH:/path/to/overdeck/node_modules/.bin"
source ~/.bashrc  # or ~/.zshrc

# Option 3: Use npx
npx pan --help
```

### Docker permission denied

**Problem:** `docker: permission denied while trying to connect to Docker daemon`

**Solutions:**
```bash
# Add user to docker group
sudo usermod -aG docker $USER

# Log out and back in (or restart)
# Verify with:
docker ps
```

### Node.js version too old

**Problem:** `pan doctor` reports Node.js version < 18

**Solutions:**
```bash
# Using nvm (recommended)
nvm install 18
nvm use 18
nvm alias default 18

# Or update via package manager
# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# macOS
brew upgrade node
```

### tmux not found

**Problem:** `tmux: command not found`

**Solutions:**
```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install -y tmux

# macOS
brew install tmux
```

### Docker Compose not found

**Problem:** `docker-compose: command not found`

**Solutions:**
```bash
# Ubuntu/Debian (Docker Compose v2)
sudo apt-get install docker-compose-plugin

# Verify with:
docker compose version

# macOS (included in Docker Desktop)
# Just ensure Docker Desktop is installed and running
```

### npm install fails

**Problem:** Errors during `npm install`

**Solutions:**
```bash
# Clear npm cache
npm cache clean --force

# Remove node_modules and package-lock.json
rm -rf node_modules package-lock.json

# Try again
npm install

# If still failing, check Node.js version
node --version  # Should be v18+
```

### Dashboard won't start

**Problem:** `pan up` fails or dashboard won't load

**Solutions:**
```bash
# Check if ports 3001/3002 are in use
lsof -i :3001
lsof -i :3002

# Kill conflicting processes
kill -9 <PID>

# Check dashboard dependencies
cd src/dashboard
npm install
npm run build

# Try starting again
pan up
```

## Post-Installation

After successful installation:

1. **Configure Overdeck**: Use `/pan-setup` skill
2. **Start services**: `pan up`
3. **Verify health**: `pan doctor`
4. **Create first workspace**: Use `/pan-issue` skill

## Configuration Files

After installation, you'll have:
- `~/.overdeck.env` - Main configuration
- `~/.overdeck/skills/` - Synced skills
- `~/.overdeck/agents/` - Agent state
- `~/.overdeck/workspaces/` - Workspace metadata

## Next Steps

- Use `/pan-setup` to configure trackers and projects
- Use `/pan-quickstart` for guided first-time setup
- Run `pan up` to start the dashboard
- Use `/pan-help` to explore available commands

## Related Skills

- `/pan-setup` - Configuration wizard
- `/pan-quickstart` - Quick start guide
- `/pan-help` - Command overview
- `/pan-doctor` - System health check (coming soon)

## More Information

- Run `pan doctor` to check system health
- Run `pan install --help` for installation options
- Check the dashboard at http://localhost:3001 (after `pan up`)
