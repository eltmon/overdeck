# Remote Workspaces: exe.dev Integration

> *"Your laptop is a thin client. The cloud does the heavy lifting."*

**Implementation:** PAN-125
**Status:** Partial - infrastructure complete, `pan start` integration missing

## Overview

Remote Workspaces allows Overdeck to offload Docker containers and Claude agents to exe.dev VMs, freeing local machine resources. Instead of running postgres, redis, frontend, backend, and agents locally, everything runs on remote VMs with persistent storage.

## Problem Statement

**Current pain points:**
1. **Memory pressure** - A single MYN workspace with Docker containers + Claude agent consumes ~1.5-2GB RAM
2. **Multiple workspaces impossible** - MacBook Air (8GB) can barely run 1 workspace
3. **Fan noise / heat** - Docker + Vite + Spring Boot + Claude = thermal throttling
4. **Battery drain** - Heavy workloads kill battery life
5. **Context switching cost** - Stopping/starting containers between workspaces is slow

**Target user:** Developer with limited local resources who wants to run multiple concurrent agent workspaces.

## Goals

1. **Offload all heavy workloads** - Docker containers and Claude agents run remotely
2. **Support 10+ concurrent workspaces** - Limited only by exe.dev plan, not local RAM
3. **Transparent experience** - Commands feel the same; `pan workspace create` just works
4. **Persistent workspaces** - VMs and data survive restarts
5. **Cost-effective** - $30-35/month for 10+ workspaces beats hardware upgrades

## Non-Goals (v1)

- GPU workloads (ML training)
- Windows container support
- Multi-region deployment
- Auto-scaling based on load

## Architecture

### High-Level Design

```
┌────────────────────────────────────────────────────────────────┐
│  Local Machine (Thin Client)                                   │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ Overdeck Dashboard                                      │ │
│  │ - Orchestrates remote VMs via SSH/API                     │ │
│  │ - Displays agent status, logs                             │ │
│  │ - Proxies to remote services for browser access           │ │
│  │ RAM: ~100-200MB                                           │ │
│  └──────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
                              │
                              │ SSH / exe.dev API
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  exe.dev Cloud ($30/month - 16GB RAM, 30 VMs)                  │
│                                                                │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ VM: pan-infra (always running)                           │  │
│  │ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐         │  │
│  │ │ PostgreSQL  │ │ Redis       │ │ Traefik     │         │  │
│  │ │ (shared)    │ │ (shared)    │ │ (routing)   │         │  │
│  │ └─────────────┘ └─────────────┘ └─────────────┘         │  │
│  │ RAM: ~500MB                                              │  │
│  └─────────────────────────────────────────────────────────┘  │
│                              │                                 │
│         ┌────────────────────┼────────────────────┐           │
│         ▼                    ▼                    ▼           │
│  ┌─────────────┐      ┌─────────────┐      ┌─────────────┐   │
│  │ VM: min-667 │      │ VM: min-668 │      │ VM: pan-42  │   │
│  │             │      │             │      │             │   │
│  │ Git Repo    │      │ Git Repo    │      │ Git Repo    │   │
│  │ ├── fe/     │      │ ├── fe/     │      │ ├── src/    │   │
│  │ ├── api/    │      │ ├── api/    │      │ └── ...     │   │
│  │ └── docs/   │      │ └── docs/   │      │             │   │
│  │             │      │             │      │             │   │
│  │ Docker:     │      │ Docker:     │      │ Docker:     │   │
│  │ - fe        │      │ - fe        │      │ - frontend  │   │
│  │ - api       │      │ - api       │      │ - server    │   │
│  │             │      │             │      │             │   │
│  │ Claude Agent│      │ Claude Agent│      │ Claude Agent│   │
│  │ (in tmux)   │      │ (in tmux)   │      │ (in tmux)   │   │
│  │             │      │             │      │             │   │
│  │ RAM: ~1.1GB │      │ RAM: ~1.1GB │      │ RAM: ~0.8GB │   │
│  └─────────────┘      └─────────────┘      └─────────────┘   │
│                                                                │
│  URLs (via exe.dev HTTPS proxy):                               │
│  - min-667-fe.exe.dev → VM min-667:4173                        │
│  - min-667-api.exe.dev → VM min-667:7000                       │
│  - pan-42-fe.exe.dev → VM pan-42:3010                          │
└────────────────────────────────────────────────────────────────┘
```

### Shared Infrastructure VM

One dedicated VM runs shared services to reduce per-workspace memory:

| Service | Purpose | RAM | Configuration |
|---------|---------|-----|---------------|
| PostgreSQL | All workspaces share, separate DBs | ~150MB | `myn_min667`, `myn_min668`, etc. |
| Redis | All workspaces share, separate DB numbers | ~50MB | DB 0, 1, 2, ... per workspace |
| Traefik | Routes `*.exe.dev` to workspace VMs | ~50MB | Docker provider |
| Overdeck API | Central coordination (optional) | ~100MB | WebSocket hub |

**Total: ~350-500MB** (vs ~200MB per workspace if duplicated)

### Per-Workspace VMs

Each workspace gets its own VM containing:

| Component | Purpose | RAM |
|-----------|---------|-----|
| Git worktrees | Source code | N/A (disk) |
| Frontend (Vite) | Dev server with HMR | ~300MB |
| Backend (Spring/Node) | API server | ~500-600MB |
| Claude Agent | Autonomous coding | ~200MB |

**Total: ~1.0-1.1GB per workspace**

### Memory Budget (16GB Plan)

```
Shared infra:     0.5 GB
─────────────────────────
Available:       15.5 GB

Per workspace:    1.1 GB
Max workspaces:  ~14 concurrent

Recommended:     10-12 (with headroom)
```

## Implementation Plan

### Phase 1: exe.dev CLI Integration

**Goal:** Basic VM lifecycle management via exe CLI.

#### 1.1 Add exe.dev Provider

```typescript
// src/lib/remote/exe-provider.ts

export interface ExeConfig {
  // User's exe.dev authentication (from `exe auth`)
  authenticated: boolean;

  // Shared infra VM name
  infraVm: string;

  // Default VM settings
  defaults: {
    // Use exe.dev's default sizing
  };
}

export class ExeProvider implements RemoteProvider {
  async createVm(name: string): Promise<VmInfo>;
  async deleteVm(name: string): Promise<void>;
  async listVms(): Promise<VmInfo[]>;
  async ssh(vm: string, command: string): Promise<ExecResult>;
  async getStatus(vm: string): Promise<VmStatus>;
}
```

#### 1.2 New Commands

```bash
# Configure remote backend
pan config set remote.provider exe
pan config set remote.infra-vm pan-infra

# Check exe.dev status
pan remote status
# Output:
# Provider: exe.dev
# Authenticated: ✓
# Infra VM: pan-infra (running)
# Workspace VMs: 3 active
#   - min-667 (running, 1.1GB)
#   - min-668 (running, 1.0GB)
#   - pan-42 (stopped)

# Initialize shared infrastructure
pan remote init
# Creates pan-infra VM with postgres, redis, traefik
```

### Phase 2: Remote Workspace Creation

**Goal:** `pan workspace create` provisions remote VM.

#### 2.1 Workspace Creation Flow

```bash
pan workspace create MIN-667 --remote
```

**Steps executed:**

1. **Create VM**
   ```bash
   exe vm create min-667
   ```

2. **Clone repository**
   ```bash
   exe ssh min-667 "git clone git@github.com:org/repo.git /workspace"
   exe ssh min-667 "cd /workspace && git worktree add fe feature/min-667"
   exe ssh min-667 "cd /workspace && git worktree add api feature/min-667"
   ```

3. **Configure environment**
   ```bash
   exe ssh min-667 "cat > /workspace/.env << 'EOF'
   SPRING_DATASOURCE_URL=jdbc:postgresql://pan-infra:5432/myn_min667
   SPRING_DATA_REDIS_HOST=pan-infra
   SPRING_DATA_REDIS_DATABASE=1
   EOF"
   ```

4. **Create database on shared infra**
   ```bash
   exe ssh pan-infra "psql -c 'CREATE DATABASE myn_min667'"
   ```

5. **Start containers**
   ```bash
   exe ssh min-667 "cd /workspace && docker compose up -d fe api"
   ```

6. **Configure routing**
   ```bash
   # exe.dev's HTTPS proxy handles this automatically
   # or register with Traefik on pan-infra
   ```

7. **Record workspace metadata**
   ```yaml
   # ~/.overdeck/workspaces/min-667.yaml
   id: min-667
   issue: MIN-667
   remote:
     provider: exe
     vm: min-667
     infra_vm: pan-infra
     database: myn_min667
     redis_db: 1
   urls:
     frontend: https://min-667-fe.yourname.exe.dev
     api: https://min-667-api.yourname.exe.dev
   created: 2024-01-30T18:00:00Z
   ```

#### 2.2 Modified docker-compose for Remote

```yaml
# .devcontainer/docker-compose.remote.yml
# Variant that connects to shared infra instead of local postgres/redis

services:
  fe:
    build: ...
    environment:
      - VITE_PUBLIC_API_HOST=https://${WORKSPACE}-api.${EXE_USER}.exe.dev
    ports:
      - "4173:4173"

  api:
    build: ...
    environment:
      # Connect to shared postgres on infra VM
      - SPRING_DATASOURCE_URL=jdbc:postgresql://pan-infra:5432/${DATABASE}
      - SPRING_DATA_REDIS_HOST=pan-infra
      - SPRING_DATA_REDIS_DATABASE=${REDIS_DB}
    ports:
      - "7000:7000"

# No postgres/redis services - they're on pan-infra
```

### Phase 3: Remote Agent Execution

**Goal:** Claude agents run on remote VMs.

#### 3.1 Agent Spawning

```bash
pan agent start MIN-667 --remote
```

**Execution:**

```bash
# SSH to workspace VM and start agent in tmux
exe ssh min-667 "tmux new-session -d -s agent 'cd /workspace && claude --dangerously-skip-permissions'"

# Or with full context
exe ssh min-667 "tmux new-session -d -s agent 'cd /workspace && claude --dangerously-skip-permissions --model sonnet <<EOF
You are working on issue MIN-667...
EOF'"
```

#### 3.2 Agent Monitoring

Dashboard connects via SSH to monitor agent:

```bash
# Get agent output
exe ssh min-667 "tmux capture-pane -t agent -p"

# Check if agent is alive
exe ssh min-667 "tmux has-session -t agent && echo running || echo stopped"

# Send input to agent
exe ssh min-667 "tmux send-keys -t agent 'user message here' Enter"
```

#### 3.3 Agent Lifecycle Events

```typescript
// Agent events forwarded to dashboard via SSH polling or WebSocket bridge

interface AgentEvent {
  workspace: string;
  type: 'started' | 'output' | 'tool_use' | 'completed' | 'error';
  timestamp: Date;
  data: any;
}

// Poll every 2s or use SSH multiplexing for efficiency
async function pollAgentStatus(vm: string): Promise<AgentEvent[]> {
  const output = await exe.ssh(vm, "tmux capture-pane -t agent -p -S -100");
  return parseClaudeOutput(output);
}
```

### Phase 4: URL Routing & Access

**Goal:** Access remote services via browser.

#### Option A: exe.dev Native HTTPS Proxy

exe.dev provides automatic HTTPS URLs for exposed ports:

```bash
# Expose port on VM
exe ssh min-667 "exe expose 4173"
# Returns: https://min-667-4173.yourname.exe.dev

exe ssh min-667 "exe expose 7000"
# Returns: https://min-667-7000.yourname.exe.dev
```

**Pros:** Zero config, automatic HTTPS
**Cons:** URL format may not match our `*.myn.localhost` pattern

#### Option B: Traefik on Infra VM

Run Traefik on `pan-infra` with Docker provider:

```yaml
# pan-infra:/etc/traefik/docker-compose.yml
services:
  traefik:
    image: traefik:v3.0
    ports:
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    command:
      - --providers.docker.network=overdeck
      - --providers.docker.exposedbydefault=false
```

Each workspace VM registers with Traefik via labels or file provider.

#### Option C: Local SSH Tunnels (Fallback)

For development/debugging, tunnel to local:

```bash
# Tunnel remote services to local ports
exe tunnel min-667:4173:4173 min-667:7000:7000

# Access at localhost:4173, localhost:7000
```

### Phase 5: Dashboard Integration

**Goal:** Dashboard shows remote workspaces seamlessly.

#### 5.1 Workspace List View

```
┌──────────────────────────────────────────────────────────────┐
│ Workspaces                                    [+ New] [⚙]   │
├──────────────────────────────────────────────────────────────┤
│ 🟢 MIN-667  │ Remote (exe.dev) │ Agent: Running │ 1.1GB     │
│    └─ https://min-667-fe.user.exe.dev                       │
│                                                              │
│ 🟢 MIN-668  │ Remote (exe.dev) │ Agent: Idle    │ 0.9GB     │
│    └─ https://min-668-fe.user.exe.dev                       │
│                                                              │
│ 🟡 PAN-42   │ Remote (exe.dev) │ VM: Stopped    │ 0GB       │
│    └─ [Start VM]                                            │
│                                                              │
│ 🔵 DEV      │ Local            │ Agent: Running │ 1.5GB     │
│    └─ https://dev.myn.localhost                             │
└──────────────────────────────────────────────────────────────┘
```

#### 5.2 Agent Terminal View

WebSocket bridge to remote tmux session:

```typescript
// Server-side: bridge WebSocket to SSH
app.ws('/api/workspaces/:id/terminal', async (ws, req) => {
  const workspace = await getWorkspace(req.params.id);

  if (workspace.remote) {
    // SSH to remote VM, attach to tmux
    const ssh = await connectSsh(workspace.remote.vm);
    const stream = await ssh.exec('tmux attach -t agent');

    // Bridge stdin/stdout
    ws.on('message', (data) => stream.stdin.write(data));
    stream.stdout.on('data', (data) => ws.send(data));
  }
});
```

### Phase 6: Lifecycle Management

#### 6.1 Workspace Hibernation

Stop VM but preserve disk to save resources:

```bash
pan workspace stop MIN-667
# Stops Docker containers
# Stops VM (disk persists)
# Memory freed for other workspaces

pan workspace start MIN-667
# Starts VM
# Starts Docker containers
# Agent can be resumed
```

#### 6.2 Workspace Cleanup

```bash
pan workspace delete MIN-667
# Stops and deletes VM
# Drops database from shared postgres
# Removes workspace metadata
```

#### 6.3 Resource Monitoring

```bash
pan remote resources
# Output:
# exe.dev Plan: Enterprise (16GB RAM, 30 VMs)
#
# RAM Usage:
#   pan-infra:  0.5GB (shared services)
#   min-667:    1.1GB (fe + api + agent)
#   min-668:    1.0GB (fe + api)
#   ─────────────────
#   Total:      2.6GB / 16GB (16%)
#   Available:  13.4GB (~12 more workspaces)
#
# Disk Usage:
#   Used:       8.2GB / 25GB (33%)
#   Per workspace: ~1.5GB average
```

## Prerequisites

### SSH for All Git Operations

**Overdeck uses SSH for all git operations.** This is an opinionated decision:

- HTTPS requires interactive credentials or platform-specific credential helpers
- SSH keys work consistently across local machines, remote VMs, and CI
- Overdeck automatically converts HTTPS URLs to SSH format when cloning on remote VMs

Example conversion:
```
https://github.com/owner/repo.git  → git@github.com:owner/repo.git
https://gitlab.com/owner/repo.git → git@gitlab.com:owner/repo.git
```

### SSH Key Configuration

Overdeck checks for SSH keys in this order:

1. `~/.overdeck/ssh/exe-dev-key` (overdeck-specific, recommended)
2. `~/.ssh/id_ed25519` (standard Ed25519 key)
3. `~/.ssh/id_rsa` (legacy RSA key)

The first key found is automatically copied to remote VMs.

**Option A: Use existing SSH key** (if you already have one)

Your existing `~/.ssh/id_ed25519` or `~/.ssh/id_rsa` will be used automatically. Ensure it's added to GitHub/GitLab.

**Option B: Generate a dedicated key** (recommended for security isolation)

1. **Generate a dedicated SSH key for exe.dev:**
   ```bash
   mkdir -p ~/.overdeck/ssh
   ssh-keygen -t ed25519 -C "exe.dev-overdeck" -f ~/.overdeck/ssh/exe-dev-key -N ""
   ```

2. **Add the public key to your git host:**
   ```bash
   cat ~/.overdeck/ssh/exe-dev-key.pub | pbcopy  # Copy to clipboard

   # GitHub: https://github.com/settings/ssh/new
   # GitLab: https://gitlab.com/-/user_settings/ssh_keys
   ```

3. **Verify it works:**
   ```bash
   # For GitHub:
   ssh -i ~/.overdeck/ssh/exe-dev-key -T git@github.com

   # For GitLab:
   ssh -i ~/.overdeck/ssh/exe-dev-key -T git@gitlab.com
   ```

> **Note:** A dedicated key can be revoked without affecting your local development if needed.

### exe.dev Account

You need an exe.dev account with SSH access configured. Test with:
```bash
ssh exe.dev help
```

### Claude Code Bypass Permissions (Automatic)

Remote agents run with `--dangerously-skip-permissions` which requires accepting a one-time warning, and Claude Code has an onboarding flow for new users. Overdeck automatically configures both on new VMs by creating `~/.claude.json` with:

```json
{
  "bypassPermissionsModeAccepted": true,
  "hasCompletedOnboarding": true
}
```

This is done automatically during workspace creation. If you need to manually configure a VM:
```bash
ssh <vm-name>.exe.xyz 'echo "{\"bypassPermissionsModeAccepted\": true, \"hasCompletedOnboarding\": true}" > ~/.claude.json'
```

> **Note:** The bypass setting is `bypassPermissionsModeAccepted`, not `hasAcceptedBypassPermissionsWarning` (an older/incorrect name).

### Credential Syncing (Automatic)

Overdeck automatically syncs credentials from your local macOS machine to remote VMs before spawning agents. This ensures agents have fresh authentication tokens even after OAuth tokens expire.

**Credentials synced:**

| Credential | Local Source | Remote Destination | Purpose |
|------------|--------------|-------------------|---------|
| Claude Code OAuth | macOS Keychain (`Claude Code-credentials`) | `~/.claude/.credentials.json` | API authentication for Claude agents |
| GitHub CLI | macOS Keychain (`gh:github.com`) | `~/.config/gh/hosts.yml` | `gh` CLI commands (PR creation, issue updates) |

**When credentials are synced:**
- Before spawning planning agents (dashboard "Plan" button)
- Before spawning work agents (dashboard "Start Agent" button)
- When using `pan workspace sync-auth <issue-id>` CLI command
- When using `pan start` to start remote work

**Manual sync (if needed):**
```bash
pan workspace sync-auth <issue-id>
```

**Troubleshooting:**
- If Claude auth fails: Run `claude` locally to re-authenticate, then sync again
- If GitHub auth fails: Run `gh auth login` locally, then sync again
- Both credentials are extracted from macOS Keychain and written to standard config locations on Linux VMs

## Configuration

### User Config (`~/.overdeck/config.toml`)

```toml
[remote]
enabled = true
provider = "exe"

[remote.exe]
# Infra VM for shared postgres/redis
infra_vm = "pan-infra"

# Default to remote for new workspaces
default_location = "remote"  # or "local"

# Auto-stop idle workspaces after 4 hours
auto_hibernate_minutes = 240

[remote.exe.databases]
# Shared postgres on infra VM
postgres_host = "pan-infra"
postgres_port = 5432
postgres_user = "postgres"
postgres_password_env = "PAN_POSTGRES_PASSWORD"

# Shared redis on infra VM
redis_host = "pan-infra"
redis_port = 6379
```

### Project Config (`.overdeck/remote.yaml`)

```yaml
# Project-specific remote settings
docker_compose_file: .devcontainer/docker-compose.remote.yml

# Services to run (others use shared infra)
services:
  - fe
  - api

# Port mappings for exe.dev proxy
expose:
  - port: 4173
    name: frontend
  - port: 7000
    name: api

# Resource hints
resources:
  ram_estimate: 1.1GB
```

## User Experience

### Workspace Creation: Choosing Location

**Option 1: CLI flags**
```bash
pan workspace create MIN-667 --remote    # Create on exe.dev
pan workspace create MIN-667 --local     # Create locally
pan workspace create MIN-667             # Use default from config
```

**Option 2: Config default**
```toml
# ~/.overdeck/config.toml
[remote]
default_location = "remote"   # or "local"
```

**Option 3: Interactive prompt (if no flag and no default)**
```
$ pan workspace create MIN-667

Where should this workspace run?
  ○ Local (this machine)
  ● Remote (exe.dev)        ← recommended, saves 1.5GB RAM

Creating MIN-667 on exe.dev...
```

### Dashboard UI

**Workspace List View - Location indicator + actions:**
```
┌──────────────────────────────────────────────────────────────────────────┐
│ Workspaces                                                    [+ New ▾] │
├──────────────────────────────────────────────────────────────────────────┤
│ 🟢 MIN-667  │ 📍 Remote (exe.dev) │ Agent: Running │ [Migrate ▾] [⋮]   │
│    └─ https://min-667-fe.user.exe.dev                                   │
│                                                                          │
│ 🟢 MIN-668  │ 📍 Local            │ Agent: Idle    │ [Migrate ▾] [⋮]   │
│    └─ https://min-668.myn.localhost                                     │
│                                                                          │
│ 🟡 PAN-42   │ 📍 Remote (stopped) │ VM: Hibernated │ [Start] [⋮]       │
└──────────────────────────────────────────────────────────────────────────┘
```

**[+ New ▾] dropdown:**
```
┌─────────────────────┐
│ Create Local        │
│ Create Remote       │  ← opens on exe.dev
│ ─────────────────── │
│ Import from Git...  │
└─────────────────────┘
```

**[Migrate ▾] dropdown:**
```
┌─────────────────────────────┐
│ Migrate to Remote (exe.dev) │   ← if currently local
│ Migrate to Local            │   ← if currently remote
│ ────────────────────────────│
│ Hand off to teammate...     │   ← future: transfer ownership
└─────────────────────────────┘
```

### Migration Flow (with beads sync)

When user clicks "Migrate to Remote":

```
┌────────────────────────────────────────────────────────┐
│ Migrate MIN-667 to Remote                          [X] │
├────────────────────────────────────────────────────────┤
│                                                        │
│  This will:                                            │
│  ✓ Sync beads to git (bd sync + commit + push)        │
│  ✓ Create VM on exe.dev                               │
│  ✓ Clone repository to VM                             │
│  ✓ Start containers (fe, api)                         │
│  ✓ Stop local containers                              │
│                                                        │
│  Estimated time: 2-3 minutes                          │
│                                                        │
│  ┌─────────────────────────────────────────────────┐  │
│  │ ◻ Keep local copy running (for comparison)     │  │
│  └─────────────────────────────────────────────────┘  │
│                                                        │
│                          [Cancel]  [Migrate →]         │
└────────────────────────────────────────────────────────┘
```

**Progress view:**
```
┌────────────────────────────────────────────────────────┐
│ Migrating MIN-667 to Remote                            │
├────────────────────────────────────────────────────────┤
│                                                        │
│  ✓ Syncing beads...                          Done     │
│  ✓ Committing changes...                     Done     │
│  ✓ Pushing to remote...                      Done     │
│  ● Creating VM on exe.dev...                 Running  │
│  ○ Cloning repository...                     Pending  │
│  ○ Starting containers...                    Pending  │
│  ○ Importing beads on remote...              Pending  │
│                                                        │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  45%     │
│                                                        │
└────────────────────────────────────────────────────────┘
```

## CLI Reference

### New Commands

| Command | Description |
|---------|-------------|
| `pan remote status` | Show exe.dev connection and VM status |
| `pan remote init` | Initialize shared infra VM |
| `pan remote resources` | Show RAM/disk usage across VMs |
| `pan workspace create <id> --remote` | Create workspace on remote VM |
| `pan workspace create <id> --local` | Create workspace locally (explicit) |
| `pan workspace migrate <id> --to remote` | Migrate local → exe.dev (syncs beads) |
| `pan workspace migrate <id> --to local` | Migrate exe.dev → local (syncs beads) |
| `pan workspace start <id>` | Start stopped remote workspace |
| `pan workspace stop <id>` | Stop (hibernate) remote workspace |
| `pan workspace ssh <id>` | SSH into workspace VM |
| `pan workspace logs <id> [service]` | View container logs |

### Modified Commands

| Command | Change |
|---------|--------|
| `pan workspace create` | Adds `--remote` / `--local` flags |
| `pan workspace list` | Shows location (remote/local) and VM status |
| `pan agent start` | Works transparently for remote workspaces |
| `pan agent logs` | Streams from remote tmux session |

## Cost Analysis

### exe.dev Pricing

| Plan | RAM | VMs | Disk | Cost |
|------|-----|-----|------|------|
| Individual | 8GB | 25 | 25GB | $20/month |
| Team | 8GB | 25 | 25GB | $25/month/user |
| Enterprise | 16GB | 30 | 25GB | $30/month/user |

### Recommended Setup

**Enterprise Plan ($30/month):**
- 16GB RAM → 10-14 concurrent workspaces
- 25GB disk → sufficient for 10 workspaces
- Extra disk if needed: $0.08/GB/month

**Estimated monthly cost:**
- Base: $30
- Extra 25GB disk: $2
- **Total: ~$32/month**

### Comparison

| Approach | Concurrent Workspaces | Monthly Cost |
|----------|----------------------|--------------|
| MacBook Air 8GB | 1-2 (painful) | $0 |
| MacBook Pro 32GB | 4-6 | $0 (but $2500+ upfront) |
| exe.dev Enterprise | 10-14 | $32/month |
| AWS EC2 t3.xlarge | 8-10 | ~$120/month |

## Security Considerations

1. **SSH Keys** - exe.dev uses your SSH key; no additional auth needed
2. **Claude API Key** - Stored as env var on VMs; encrypted at rest
3. **Database Credentials** - Shared postgres password via env var
4. **Network Isolation** - VMs on same exe.dev account can communicate
5. **HTTPS** - exe.dev proxy provides automatic TLS

## Migration Path

### From Local to Remote

```bash
# Existing local workspace
pan workspace list
# → MIN-667 (local)

# Migrate to remote
pan workspace migrate MIN-667 --to remote
# 1. Creates remote VM
# 2. Syncs git repo
# 3. Exports database
# 4. Imports to shared postgres
# 5. Starts remote containers
# 6. Stops local containers
# 7. Updates workspace metadata

pan workspace list
# → MIN-667 (remote)
```

### Rollback to Local

```bash
pan workspace migrate MIN-667 --to local
# Reverse of above
```

## Planning State & Portability

A key requirement is that issues can move freely between local, remote (exe.dev), or another developer's machine. Planning artifacts must follow the issue.

### Artifact Lifecycle

| Artifact | Location | Tracked in Git | Merged to Main | Lifecycle |
|----------|----------|----------------|----------------|-----------|
| **PRD** | `docs/prds/active/` | ✅ Yes | ✅ Yes (moved to `completed/`) | Permanent documentation |
| **STATE.md** | `.planning/` | ✅ Yes (feature branch) | ❌ No | Deleted with branch |
| **beads** | `.beads/` (project-wide) | ✅ Yes (JSONL) | ✅ Yes (synced) | Git + tracker sync required before move |

### How It Works

**PRDs (Permanent):**
```
docs/prds/
├── active/
│   └── MIN-667-remote-workspaces.md  ← During development
└── completed/
    └── MIN-667-remote-workspaces.md  ← After merge (33+ archived PRDs)
```
- Created during planning phase
- Merged to main with the feature
- Moved to `completed/` after merge
- Valuable historical documentation

**STATE.md (Ephemeral):**
```
.planning/
└── STATE.md   ← Agent's current working state
```
- Tracked on feature branch
- **Never merged to main** (merge-agent excludes it)
- Deleted when feature branch is deleted
- History preserved in git (on that branch) if needed for audit

**beads (Task Tracking):**
```
.beads/
├── issues.jsonl   ← All project issues (JSONL format, git-tracked)
└── *.db           ← SQLite cache (local, gitignored)
```
- **Project-wide storage** - all issues in one file
- **Issue-specific via labels** - each bead tagged with `[MIN-667]`, `[PAN-42]`, etc.
- **Git-synced via JSONL** - `bd sync` exports DB → JSONL for git
- **Merge-friendly** - `bd sync --resolve` handles JSONL merge conflicts
- **Tracker sync** - `bd <tracker> sync` for bidirectional sync (Linear, GitHub, etc.)

**Important: Beads must be synced before moving workspaces:**
```bash
# Before moving (on source machine)
bd sync                           # Export DB → JSONL
git add .beads/issues.jsonl
git commit -m "Sync beads"
git push

# After moving (on target machine/VM)
git pull
bd sync --import                  # Import JSONL → DB
```

### Portability Across Environments

When an issue moves (local → remote, or developer A → developer B):

**Step 1: Sync before leaving (source machine)**
```bash
bd sync                              # Export beads DB → JSONL
git add .beads/issues.jsonl && git add -f .planning/
git commit -m "Sync state for MIN-667 handoff"
git push
```

**Step 2: Pull on arrival (target machine/VM)**
```bash
git checkout feature/min-667
git pull

# All artifacts are present:
# - docs/prds/active/MIN-667-*.md  (PRD)
# - .planning/STATE.md              (current state)
# - .beads/issues.jsonl             (tasks - need import)

bd sync --import                     # Import JSONL → beads DB
```

**Local → exe.dev (automated):**
```bash
pan workspace migrate MIN-667 --to remote
# 1. Runs bd sync + git commit/push
# 2. Clones repo to VM
# 3. Checks out feature branch
# 4. Runs bd sync --import
# 5. All state available on remote
```

**Developer A → Developer B:**
```bash
# Developer B just checks out the branch
git fetch && git checkout feature/min-667
# Full context available immediately
```

### Merge Behavior

When merging to main, the merge-agent:

1. **Includes:** All code changes, PRD (moves to `completed/`)
2. **Excludes:** `.planning/` directory (stays on feature branch only)
3. **Closes:** beads tasks linked to the issue

```bash
# Merge-agent behavior
git merge feature/min-667 --no-commit
git reset HEAD .planning/           # Exclude planning state
git checkout -- .planning/
git commit -m "Merge MIN-667: Remote workspaces"

# Move PRD to completed
git mv docs/prds/active/MIN-667-*.md docs/prds/completed/
git commit -m "Archive MIN-667 PRD"
```

### Pre-requisite: Remove .planning from .gitignore

Currently `.planning/` is gitignored. To enable this workflow:

1. Remove `.planning/` from `.gitignore`
2. Update merge-agent prompt to exclude `.planning/` from merges
3. Document the new behavior

This is tracked as a separate issue to unblock remote workspace portability.

## Documentation Updates

The following documentation must be updated as part of this feature:

### README.md Updates

1. **New section: Remote Workspaces**
   - Overview of exe.dev integration
   - Quick start guide for remote setup
   - Cost comparison table

2. **Updated commands reference**
   - `pan workspace create --remote`
   - `pan workspace migrate`
   - `pan remote status/init/resources`

3. **Architecture diagram** - Add remote workspace variant

4. **Configuration section** - Add `[remote]` config options

### Other Documentation

- Update `CONFIGURATION.md` with remote settings
- Add troubleshooting guide for SSH/network issues
- Update agent spawning docs for remote execution

## Success Metrics

1. **Memory freed** - Local machine uses <500MB for Overdeck
2. **Concurrent workspaces** - Support 10+ without degradation
3. **Agent reliability** - Agents run for hours without local machine issues
4. **Developer experience** - <5s latency for common operations
5. **Cost efficiency** - <$35/month for full capability

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| exe.dev outage | Workspaces inaccessible | Local fallback mode |
| SSH latency | Slow agent interaction | Connection pooling, multiplexing |
| Disk space exhaustion | Can't create workspaces | Auto-prune old Docker images |
| Shared DB corruption | Multiple workspaces affected | Per-workspace DB isolation |
| API key exposure | Security breach | Env vars, not files; rotate regularly |

## Timeline

| Phase | Scope | Estimate |
|-------|-------|----------|
| Phase 1 | exe.dev CLI integration | 1 week |
| Phase 2 | Remote workspace creation | 1 week |
| Phase 3 | Remote agent execution | 1 week |
| Phase 4 | URL routing | 3 days |
| Phase 5 | Dashboard integration | 1 week |
| Phase 6 | Lifecycle management | 3 days |
| **Total** | | **~5 weeks** |

## Future Enhancements

1. **Multi-provider support** - AWS, GCP, Azure VMs
2. **Spot instances** - Use preemptible VMs for cost savings
3. **Auto-scaling** - Spin up VMs on demand, hibernate when idle
4. **Workspace snapshots** - Save/restore full workspace state
5. **Team sharing** - Multiple users access same workspace
6. **GPU support** - ML workloads on GPU VMs

## Appendix: exe.dev CLI Reference

```bash
# Authentication
exe auth login

# VM Management
exe vm create <name>
exe vm delete <name>
exe vm list
exe vm start <name>
exe vm stop <name>

# SSH Access
exe ssh <vm> [command]

# Port Exposure
exe expose <port>          # Expose port, get HTTPS URL
exe tunnel <vm>:<remote>:<local>  # SSH tunnel

# File Transfer
exe cp local-file <vm>:/path
exe cp <vm>:/path local-file
```

## References

- [exe.dev Documentation](https://exe.dev/docs)
- [exe.dev Pricing](https://exe.dev/pricing)
- [Overdeck PRD](./PRD.md)
- [Cloister Agent Framework](./PRD-CLOISTER.md)
