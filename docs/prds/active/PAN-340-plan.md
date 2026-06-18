# PAN-340: Replace exe.dev Remote Provider with Fly.io Machines

## Status: Planning Complete

## Decisions

### 1. Infrastructure Model: Self-Contained Machines
Each Fly machine is independent — no shared infra VM, no shared PostgreSQL/Redis. This matches Fly's per-machine isolation model and is simpler than exe.dev's pan-infra pattern. Shared infrastructure can be added later if needed.

### 2. Command Execution: Hybrid Approach
- **REST API** for lifecycle operations (create, destroy, start, stop, status)
- **Fly CLI** (`fly ssh console -C`) for SSH/exec and file transfer (`fly ssh sftp`)
- This gives programmatic control for lifecycle while leveraging CLI auth for interactive operations

### 3. Exe Provider: Delete and Reimplement
Delete `exe-provider.ts` entirely. Reimplement needed functionality (credential sync, beads init, skill copying) directly in FlyProvider or as shared utilities. No dead code preservation.

### 4. Docker Image: Full Pipeline
Create `pan-workspace` Dockerfile + CI workflow (GitHub Actions) to auto-build and push to `registry.fly.io/pan-workspace` on merge to main.

### 5. Workspace Flow: Full Parity (minus shared infra)
Reimplement the full workspace creation flow for Fly:
- Repo cloning + branch creation
- Credential sync (GitHub, GitLab, Claude Code)
- Claude Code configuration
- Beads initialization
- Skill copying
- **Remove**: Database provisioning, Redis provisioning, Traefik routing (exe-specific)

### 6. Cost Tracking: Existing JSONL System
Append compute cost events to `~/.overdeck/costs/events.jsonl` using the existing format. Add `session_type: 'compute'` with `machine_id`, uptime, and hourly rate fields.

### 7. Agent Management: Fly Machine Exec API
Use Fly Machines API exec endpoint instead of SSH+tmux for agent management. More reliable, no SSH key management needed. Adapt `remote-agents.ts` to use the API transport.

---

## Architecture

### File Changes

#### New Files
| File | Purpose |
|------|---------|
| `src/lib/remote/fly-provider.ts` | FlyProvider implementing RemoteProvider interface |
| `src/lib/remote/fly-api.ts` | Fly Machines REST API client (create, destroy, start, stop, exec, status) |
| `docker/pan-workspace/Dockerfile` | Ubuntu 24.04 + Node 22 + pnpm + git + tmux + Claude Code |
| `docker/pan-workspace/docker-compose.yml` | Local build/test compose file |
| `.github/workflows/build-workspace-image.yml` | CI: build + push to registry.fly.io on merge |
| `docs/fly-provider.md` | Setup guide: Fly account, API token, image build, lifecycle, cost tracking |

#### Modified Files
| File | Changes |
|------|---------|
| `src/lib/remote/interface.ts` | Add `machineId?: string` to VmInfo, update RemoteWorkspaceMetadata (remove infraVm, database, redisDb) |
| `src/lib/remote/index.ts` | Replace exe exports with fly exports, update `getRemoteProvider()` factory, update `isRemoteAvailable()` |
| `src/lib/remote/remote-agents.ts` | Swap SSH transport for Fly exec API transport |
| `src/lib/remote/workspace-metadata.ts` | Update metadata schema (add machineId, appName; remove infraVm, database, redisDb) |
| `src/lib/config.ts` | Replace `RemoteExeConfig` with `RemoteFlyConfig` (org, region, vm-size, vm-memory, image, auto-stop) |
| `src/cli/commands/workspace.ts` | Rewrite remote workspace creation flow for Fly machines |
| `src/cli/commands/remote/setup.ts` | Fly.io setup wizard (flyctl install, auth, org selection) |
| `src/cli/commands/remote/init.ts` | Remove exe infra VM init, replace with Fly app creation |
| `src/cli/commands/remote/status.ts` | Use Fly API for status display |
| `src/cli/commands/remote/resources.ts` | Use Fly API for resource monitoring |
| `src/cli/commands/remote/index.ts` | Update subcommand registrations if needed |
| `src/cli/commands/work/issue.ts` | Update remote workspace auto-creation for Fly |
| `src/cli/commands/work/kill.ts` | Update remote agent termination for Fly |
| `src/cli/commands/work/wipe.ts` | Update remote workspace cleanup for Fly |
| `src/cli/commands/workspace-migrate.ts` | Update migration logic for Fly |
| `src/dashboard/server/index.ts` | Update remote status endpoints for Fly |
| `src/lib/remote-workspace.ts` | Update shared remote workspace logic |
| `docs/PRD-REMOTE-WORKSPACES.md` | Replace exe.dev references with Fly.io |
| `docs/CONFIGURATION.md` | Update remote config section |
| `docs/USAGE.md` | Update CLI usage for Fly commands |

#### Deleted Files
| File | Reason |
|------|--------|
| `src/lib/remote/exe-provider.ts` | Replaced by fly-provider.ts |

### Fly Machines REST API Client (`fly-api.ts`)

Wraps the Fly Machines API (flaps) at `https://api.machines.dev/v1/`:
- `createMachine(appName, config)` → POST `/apps/{app}/machines`
- `destroyMachine(appName, machineId)` → DELETE `/apps/{app}/machines/{id}?force=true`
- `startMachine(appName, machineId)` → POST `/apps/{app}/machines/{id}/start`
- `stopMachine(appName, machineId)` → POST `/apps/{app}/machines/{id}/stop`
- `getMachine(appName, machineId)` → GET `/apps/{app}/machines/{id}`
- `listMachines(appName)` → GET `/apps/{app}/machines`
- `execCommand(appName, machineId, command)` → POST `/apps/{app}/machines/{id}/exec`
- `waitForState(appName, machineId, state)` → GET `/apps/{app}/machines/{id}/wait?state={state}`

Auth: `FLY_API_TOKEN` environment variable → `Authorization: Bearer` header.

### FlyProvider Implementation

Implements `RemoteProvider` interface with:
- `name: 'fly'`
- `isAuthenticated()` — checks `FLY_API_TOKEN` env var or `fly auth whoami`
- `createVm(name)` — `flyApi.createMachine()` with configured image, size, region
- `deleteVm(name)` — `flyApi.destroyMachine()`
- `startVm(name)` / `stopVm(name)` — `flyApi.startMachine()` / `stopMachine()`
- `ssh(vm, command)` — `fly ssh console -a {app} -C "{command}"`
- `sshStream(vm, command)` — spawns `fly ssh console` with streaming
- `copyToVm()` / `copyFromVm()` — `fly ssh sftp shell` for file transfer
- `exposePort()` — Fly services config (HTTP/TCP services on machine)
- `tunnel()` — `fly proxy {localPort}:{remotePort} -a {app}`
- `getStatus()` / `getVmInfo()` / `listVms()` — REST API queries

Internal mapping: VM name → (appName, machineId) stored in workspace metadata.

### Configuration Schema
```toml
[remote]
enabled = true
provider = "fly"          # 'fly' | 'local' (was: 'exe')
default_location = "remote"
auto_hibernate_minutes = 5

[remote.fly]
org = "overdeck"        # Fly.io org name
region = "iad"            # Default region (us-east)
vm_size = "shared-cpu-2x" # Machine size
vm_memory = 1024          # MB
image = "registry.fly.io/pan-workspace:latest"
auto_stop = true          # Stop machine when agent is idle
auto_stop_timeout = 300   # seconds of inactivity before stop
api_token_env = "FLY_API_TOKEN"  # env var containing API token
```

### Docker Image (`pan-workspace`)
```
Ubuntu 24.04
├── Node.js 22 (via nodesource)
├── pnpm (latest)
├── git, tmux, build-essential, curl
├── Claude Code CLI (npm i -g @anthropic-ai/claude-code)
├── SSH server (for fly ssh console)
├── fly CLI (flyctl)
└── Working directory: /workspace
```

### Cost Tracking Integration
On machine create/start/stop/destroy, append events to `~/.overdeck/costs/events.jsonl`:
```json
{
  "timestamp": "2026-03-19T12:00:00Z",
  "issue": "PAN-340",
  "agent": "agent-id",
  "session_type": "compute",
  "provider": "fly",
  "machine_id": "d5683606c77518",
  "event": "start|stop|create|destroy",
  "vm_size": "shared-cpu-2x",
  "hourly_rate": 0.00536
}
```

### VM Lifecycle
```
Issue assigned
  → fly machine run pan-workspace:latest (5-20s cold start)
  → agent works on feature branch
  → agent idle > 5min → fly machine stop (<1s) → $0.15/GB idle storage
  → agent needs workspace → fly machine start (<1s) → running
  → issue merged → fly machine destroy → $0
```

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Fly CLI not installed on user's machine | Setup wizard checks/installs flyctl; clear error messages |
| API token expiration | Check auth on each operation, prompt re-auth |
| Cold start latency (5-20s) | Use auto-stop instead of destroy for active issues; restart is <1s |
| Large blast radius (16 files) | Well-defined interface contract limits cascading changes |
| CI image build failures | Local Dockerfile build/test before CI; multi-stage build for reliability |
