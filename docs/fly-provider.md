# Fly.io Remote Workspace Provider

## Overview

The Fly.io provider replaces the former exe.dev integration and enables Overdeck to run
Claude agent workspaces on [Fly Machines](https://fly.io/docs/machines/) instead of your
local machine. Each workspace gets its own Fly Machine — an ephemeral VM that is created
on demand, stopped when idle, and destroyed when the workspace is deleted.

Compared to running agents locally, remote workspaces free your laptop from memory
pressure (each workspace consumes ~1-2 GB RAM) and allow many workspaces to run
concurrently without thermal throttling or battery drain.

Machine lifecycle and exec are managed through the Fly Machines REST API
(`https://api.machines.dev/v1`). SSH-style command execution uses the Machines exec
endpoint; port tunnelling uses `fly proxy`.

---

## Prerequisites

- **Fly.io account** — <https://fly.io>
- **FLY_API_TOKEN** — a personal access token from <https://fly.io/user/personal_access_tokens>
- **flyctl installed** — used for `fly ssh console`, `fly proxy`, and auth checks

  ```bash
  curl -L https://fly.io/install.sh | sh
  # or
  brew install flyctl
  ```

- **pan-workspace Docker image** built and pushed to `registry.fly.io` (see [Building the Image](#building-the-pan-workspace-image))

---

## Quick Start

1. **Run the guided setup wizard:**

   ```bash
   pan remote setup
   ```

   This checks that `flyctl` is installed, verifies authentication, and writes a default
   `[remote.fly]` block to `~/.panopticon/config.toml`.

2. **Export your API token** (or add it to `~/.panopticon.env`):

   ```bash
   export FLY_API_TOKEN=<your-token>
   ```

3. **Create a remote workspace for an issue:**

   ```bash
   pan workspace create --remote PAN-42
   ```

   Overdeck will:
   - Create a Fly Machine in your configured app
   - Wait up to 120 s for it to reach `started`
   - Clone the repository and check out the feature branch
   - Install beads CLI and copy your local skills
   - Sync Claude Code and GitHub credentials from your local machine
   - Save workspace metadata to `~/.panopticon/workspaces/<id>.yaml`

4. **Check status at any time:**

   ```bash
   pan remote status
   ```

---

## Configuration

Remote workspace settings live in `~/.panopticon/config.toml` under `[remote]` and
`[remote.fly]`. `pan remote setup` writes sensible defaults; edit the file to tune them.

```toml
[remote]
# Master switch — must be true for any remote commands to work
enabled = true

# Only supported provider at this time
provider = "fly"

# Where new workspaces go when --remote / --local is not specified
default_location = "remote"   # "remote" | "local"

# Stop machines after N minutes of agent inactivity (0 = disabled)
auto_hibernate_minutes = 5

[remote.fly]
# Fly app that owns all workspace machines.
# Will be created automatically if it does not exist.
app = "pan-workspaces"

# Fly org slug (run `fly orgs list` to see yours)
org = "personal"

# Default region for new machines
# Run `fly platform regions` for the full list.
region = "iad"

# Fly Machine size for workspace VMs
# See: https://fly.io/docs/about/pricing/#fly-machines
vm_size = "shared-cpu-2x"

# Memory in MB allocated to each machine
vm_memory = 1024

# Docker image that every workspace machine runs.
# Must be pushed to registry.fly.io before use.
image = "registry.fly.io/pan-workspace:latest"

# Stop the machine when the agent becomes idle
auto_stop = true

# Seconds of inactivity before auto-stop fires
auto_stop_timeout = 300

# Name of the environment variable that holds the API token.
# Defaults to FLY_API_TOKEN if not set.
# api_token_env = "FLY_API_TOKEN"
```

### Config field reference

| Field | Default | Description |
|---|---|---|
| `remote.enabled` | `false` | Enable/disable the remote subsystem |
| `remote.provider` | `"fly"` | Provider type (only `"fly"` supported) |
| `remote.default_location` | `"local"` | Where workspaces land without an explicit flag |
| `remote.auto_hibernate_minutes` | `5` | Minutes before an idle machine is stopped (0 = off) |
| `remote.fly.app` | `"pan-workspaces"` | Fly app that contains workspace machines |
| `remote.fly.org` | `"personal"` | Fly org slug |
| `remote.fly.region` | `"iad"` | Default region for machine placement |
| `remote.fly.vm_size` | `"shared-cpu-2x"` | Fly Machine CPU/size preset |
| `remote.fly.vm_memory` | `1024` | Machine memory in MB |
| `remote.fly.image` | `"registry.fly.io/pan-workspace:latest"` | Workspace container image |
| `remote.fly.auto_stop` | `true` | Stop machine when agent is idle |
| `remote.fly.auto_stop_timeout` | `300` | Idle timeout in seconds |
| `remote.fly.api_token_env` | `"FLY_API_TOKEN"` | Environment variable name for the API token |

---

## Building the pan-workspace Image

Every Fly Machine runs the `pan-workspace` image defined in
`docker/pan-workspace/Dockerfile`. The image is based on Ubuntu 24.04 and includes:

- Node.js 22
- pnpm
- Claude Code CLI (`@anthropic-ai/claude-code`)
- flyctl
- git, tmux, build-essential, openssh-server, python3, jq

### Build and push

```bash
# Authenticate the Docker CLI with the Fly registry
fly auth docker

# Build the image (from the repo root)
docker build -t registry.fly.io/pan-workspace:latest \
  -f docker/pan-workspace/Dockerfile .

# Push to Fly's private registry
docker push registry.fly.io/pan-workspace:latest
```

The image tag must match `remote.fly.image` in your config. If you tag a new version,
update the config and recreate workspaces to pick it up.

> The Fly app (`pan-workspaces` by default) must exist before you can push to its
> registry. `pan remote setup` or `pan workspace create --remote` will create the app
> automatically using the Machines API (`POST /apps`).

---

## Machine Lifecycle

Each workspace maps to exactly one Fly Machine inside the configured app.

### Creation

`pan workspace create --remote <issue>` calls `FlyApiClient.createMachine()` with:
- The configured `image`, `vm_size`, `vm_memory`, and `region`
- `restart.policy = "no"` — machines do not auto-restart on crash
- `auto_destroy = false` — machines persist after the process that created them exits

After creation the provider polls `GET /apps/:app/machines/:id/wait?state=started` for
up to 120 seconds. Once the machine is running, Overdeck runs setup commands over the
exec endpoint (clone repo, install beads, sync credentials).

Machine identity is stored in `~/.panopticon/workspaces/<issue-id>.yaml`:

```yaml
id: pan-42
issue: PAN-42
provider: fly
vmName: pan-pan-42-ws
machineId: <fly-machine-id>
appName: pan-workspaces
database: myn_pan_42
created: 2026-03-19T12:00:00.000Z
location: remote
```

### Stop / hibernate

```bash
pan workspace stop PAN-42
```

Calls `POST /apps/:app/machines/:id/stop`. The machine's disk is preserved; it can be
restarted cheaply with `pan workspace start PAN-42`.

Fly bills stopped machines at a reduced storage-only rate. If `auto_stop` is enabled,
the machine is also stopped automatically after `auto_stop_timeout` seconds of agent
inactivity.

### Destruction

```bash
pan workspace delete PAN-42
```

Calls `DELETE /apps/:app/machines/:id?force=true`. This is irreversible — the machine
and its disk are gone.

### Port tunnelling

To reach a service running inside the machine from your local browser:

```bash
# Tunnel remote port 4173 to local port 4173
fly proxy 4173:4173 -a pan-workspaces
```

`FlyProvider.tunnel()` wraps this with `spawn('fly', ['proxy', ...])` and returns a
`{ close() }` handle to kill the child process.

---

## Credential Sync

When a workspace is created (or on demand via `pan workspace sync-auth <issue>`),
Overdeck copies credentials from your local machine into the remote VM using the exec
API and base64 encoding:

| Credential | Local source | Remote destination |
|---|---|---|
| Claude Code OAuth | macOS Keychain (`Claude Code-credentials`) | `~/.claude/.credentials.json` |
| GitHub CLI | `~/.config/gh/hosts.yml` | `~/.config/gh/hosts.yml` |
| GitLab CLI | `~/.config/glab-cli/config.yml` | `~/.config/glab-cli/config.yml` |

Claude Code is also configured for autonomous operation: `~/.claude/settings.json` is
written with `permissions.defaultMode = "bypassPermissions"` and onboarding is marked
complete in `~/.claude.json`.

If Claude auth fails on the remote agent, re-authenticate locally (`claude`) then sync:

```bash
pan workspace sync-auth PAN-42
```

---

## Cost Tracking

Remote workspaces do not introduce a separate cost-tracking pipeline. Agent token costs
are recorded by the standard heartbeat hook regardless of where the agent runs.

Every Claude API call made by a remote agent appends an event to
`~/.panopticon/costs/events.jsonl` on the **local** machine (the hook runs locally and
receives usage via the agent's output stream). The pre-computed cache at
`~/.panopticon/costs/by-issue.json` is updated in real time.

Fly.io compute costs (machine uptime) are not tracked by Overdeck. Monitor those
directly in the Fly.io dashboard or with `fly status -a pan-workspaces`.

To view Claude token costs per issue:

```bash
# Via the dashboard UI (Costs tab)
pan dashboard

# Or via the API
curl http://localhost:3011/api/costs/by-issue
```

See [cost-tracking.md](cost-tracking.md) for the full event-sourced cost architecture.

---

## Troubleshooting

### Authentication failure

**Symptom:** `pan remote status` reports "Not authenticated" or `pan workspace create`
throws `Fly API token not found`.

**Fix:**
1. Verify the token is exported: `echo $FLY_API_TOKEN`
2. Check token validity: <https://fly.io/user/personal_access_tokens>
3. Alternatively, authenticate via CLI: `fly auth login` — the provider falls back to
   the CLI session when no `FLY_API_TOKEN` is set.

---

### Image not found / machine fails to start

**Symptom:** Machine creation succeeds but the machine never reaches `started`, or exec
commands immediately fail.

**Fix:**
1. Confirm the image exists: `fly status -a pan-workspaces` → check machine image ref.
2. Rebuild and push the image (see [Building the Image](#building-the-pan-workspace-image)).
3. Verify the `image` value in `[remote.fly]` matches the pushed tag exactly.

---

### Exec / SSH commands fail

**Symptom:** `pan workspace create` errors during clone or credential sync steps with
non-zero exit codes from the exec API.

**Causes and fixes:**
- **Machine not started** — the 120 s wait timed out; try `pan workspace start <issue>`
  and retry.
- **Image missing required tools** — ensure the Dockerfile installs git, python3, curl,
  and base64. Rebuild and push.
- **Fly API exec timeout** — individual exec calls default to 60 s. Long-running
  operations (e.g., `git clone` on a large repo) may time out. The clone step will
  delete the machine and surface the error; re-run after increasing `vm_memory` if the
  OOM killer is the cause.

---

### `fly proxy` tunnel not working

**Symptom:** `pan workspace tunnel` starts but connection to `localhost:<port>` is
refused.

**Fix:**
1. Confirm the machine is in `started` state: `fly status -a pan-workspaces`
2. Confirm the service is listening inside the machine:
   ```bash
   fly ssh console -a pan-workspaces -C "ss -tlnp"
   ```
3. Ensure `flyctl` is on your `$PATH` — `FlyProvider.tunnel()` spawns it directly.
