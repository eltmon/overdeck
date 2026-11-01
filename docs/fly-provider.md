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
   `[remote.fly]` block to `~/.overdeck/config.toml`.

2. **Export your API token** (or add it to `~/.overdeck.env`):

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
   - Sync Claude Code and GitHub credentials from your local machine
   - Clone the repository over HTTPS into `/workspace` and check out the feature branch
   - Configure Claude Code and copy your local skills
   - Save workspace metadata to `~/.overdeck/workspaces/<id>.yaml`

   No SSH private key is copied to the VM. Git authenticates over HTTPS with the
   synced `gh` token.

4. **Check status at any time:**

   ```bash
   pan remote status
   ```

---

## Configuration

Remote workspace settings live in `~/.overdeck/config.toml` under `[remote]` and
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
- Overdeck (`@overdeck/core`, so `pan` runs on the VM), pinned by the
  `OVERDECK_VERSION` build argument (default `latest`)
- Docker (`docker.io` and `iptables`), started by Fly machine provisioning, not by
  the image
- flyctl
- git, tmux, build-essential, python3, jq

The image runs no sshd: Fly's hallpass provides `fly ssh console`, sftp and the
Machines exec API. Its `CMD` stays `sleep infinity`: a Fly machine (below) starts
`pan serve` by exec after it writes the machine's identity, and a remote work agent
VM starts no server at all.

To pin the Overdeck version in the image, pass the build argument:
`docker build --build-arg OVERDECK_VERSION=0.72.0 …`. Provisioning a Fly machine
reinstalls home's exact version anyway when the VM's differs.

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

## Fly machines (linked)

A **Fly machine** (PAN-4652) is a Fly VM that runs `pan serve` and is linked one way
from home, so its conversations stream into home's dashboard like any linked machine's.
It is not a remote work agent: a remote work agent VM (`pan start --remote`, the rest of
this page) runs Claude Code in raw tmux and no Overdeck server. Start one with
`pan machines add-fly`; the operator guide is the `## Fly machines` section of
`configuration/linked-machines.mdx`, and the design is `## Fly machines (PAN-4652)` in
`docs/ANYWHERE-ARCHITECTURE.md`.

| | Remote work agent VM | Fly machine |
|---|---|---|
| Started by | `pan start --remote` | `pan machines add-fly`, `POST /api/machines/fly` |
| Runs | Claude Code in tmux | `pan serve`, then Claude Code conversations through it |
| Reached by | Machines exec API | a secure channel over `wss://<app>.fly.dev/ws/link` |
| State on home | `agents/agent-<issue>/remote-state.json` | `fly-machines.json` plus a machine link |
| Removed by | the reap, after hand-off | unlink, the idle sweep, the stopped-machine sweep (always destroyed) |

**Server environment (D-4).** The VM's `pan serve --port 3011 --no-open` runs with
`OVERDECK_TERMINAL_BACKEND=tmux`, `IS_SANDBOX=1`, `OVERDECK_PUBLIC_LINK_ONLY=1` and
`PORT=3011`, set on the command line so remote work agent VMs are unchanged.

**Memory (D-12).** Fly machines get `max(remote.fly.vm_memory ?? 1024, 2048)` MB; the
dashboard server and Claude Code do not fit in 1 GB.

**Public IPs (D-10).** `https://<app>.fly.dev` needs the app to hold a shared IPv4 and an
IPv6, and the Machines API cannot allocate them. Run once per app:

```bash
fly ips allocate-v4 --shared -a <app>
fly ips allocate-v6 -a <app>
```

**Lifetime.** Home heartbeats every Fly machine every 60 s, and a VM whose heartbeat is
300 s old stops itself. Home destroys a Fly machine that is stopped or gone, that has had
no active linked conversation for `[remote.fly] machine_idle_minutes` (default 30, 0
disables), or that provisioning never linked within 30 minutes. Fly machines count toward
`remote.max_concurrent_agents`.

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

Machine identity is stored in `~/.overdeck/workspaces/<issue-id>.yaml`:

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
| Claude Code OAuth | `~/.claude/.credentials.json` on Linux, the macOS Keychain item `Claude Code-credentials` on macOS | `~/.claude/.credentials.json` |
| GitHub | `gh auth token` | `gh auth login --with-token` + `gh auth setup-git` (git over HTTPS) |

GitLab projects are not supported on Fly: without an SSH key, a GitLab clone needs a
`glab` credential helper, and the image ships no `glab`.

Overdeck never copies `~/.ssh/*` or `~/.overdeck/ssh/*` to a VM.

Claude Code is also configured for autonomous operation: `~/.claude/settings.json` is
written from your resolved Overdeck permission mode and onboarding is marked complete
in `~/.claude.json`.

If Claude auth fails on the remote agent, re-authenticate locally (`claude`) then sync:

```bash
pan workspace sync-auth PAN-42
```

---

## Automatic loops

The deacon child keeps remote agents alive, authenticated and moving with three
loops (PAN-4295). With no active remote agent, none of them calls the Fly API.

| Loop | Cadence | What it does | Deacon frozen |
|---|---|---|---|
| Host heartbeat | every 60 s, ephemeral tier only | Writes the current time to `/workspace/.pan/host-heartbeat`. The VM watchdog stops the machine when the file is older than 300 s, so an ephemeral machine stops itself about 5 minutes after the host goes away. | keeps running |
| Credential refresh | checked every 60 s | Copies host Claude credentials to each active VM when the host credentials file changes, or every 15 min at most. A failed copy is retried on the next check. | keeps running |
| Reap | every 60 s deacon-lite tick | On `REMOTE_DONE`, materializes `workspaces/feature-<id>`, opens the PR, destroys the machine and requests review. On a crash (no session, no sentinel, or a stopped machine), salvages unpushed work, stops the machine and marks the agent `error`. An unreachable Fly API or a failed exec leaves the agent alone until the next tick. `starting` agents are skipped. | skipped |

Fly machines (PAN-4652, `## Fly machines (linked)` above) have two more loops of their
own in `src/lib/remote/fly-machine-loops.ts`, and the credential refresh covers them too.
With no Fly machine record, neither calls the Fly API.

| Loop | Cadence | What it does | Deacon frozen |
|---|---|---|---|
| `heartbeatFlyMachines` | every 60 s | Writes `/workspace/.pan/host-heartbeat` on every Fly machine, so its watchdog keeps it running while home is up. A failed exec is reported as a failure, never as refreshed. | keeps running |
| `sweepFlyMachines` | every 60 s | Destroys the machine, removes its link and deletes its record when the Fly API reports it `stopped`, `destroyed` or `failed` or answers 404; when no unreleased linked conversation on it has been active for `[remote.fly] machine_idle_minutes` (default 30, 0 disables); or when provisioning never linked it within 30 min. Any other API error leaves it alone. | keeps running |

The heartbeat and credential refresh run in `src/lib/cloister/hygiene-scheduler.ts`;
the reap runs last in `runDeaconLite()` through `src/lib/cloister/remote-reap-routine.ts`.
Before the reap destroys or stops a machine, it copies the session transcripts and
`continue.json` back with `fly ssh sftp`, so `fly` must be on the deacon child's
`PATH`. A failed copy is recorded in the reap's details; it does not stop the hand-off.

To force a reap, or to recover one agent whatever its state, run:

```bash
pan admin remote reap [--issue <id>] [--dry-run]
```

---

## Cost Tracking

Remote workspaces do not introduce a separate cost-tracking pipeline. Agent token costs
are recorded by the standard heartbeat hook regardless of where the agent runs.

Every Claude API call made by a remote agent appends an event to
`~/.overdeck/costs/events.jsonl` on the **local** machine (the hook runs locally and
receives usage via the agent's output stream). The pre-computed cache at
`~/.overdeck/costs/by-issue.json` is updated in real time.

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

---

## Live verification

PAN-4295 was smoke-tested live on 2026-11-01, before merge, with the feature
branch's own `dist/` build (`node dist/cli/index.js`). The throwaway issue was
PAN-4677 ([#4677](https://github.com/eltmon/overdeck/issues/4677)); its agent
ran on machine `080ee717f272e8` (`pan-pan-4677-ws`, app `pan-workspaces`,
ephemeral tier, image rebuilt the same day with Claude Code 2.1.316).

| Check | Result |
|---|---|
| O1: key-free VM | `/root/.ssh` and `/.ssh` do not exist; `find / -xdev` finds no `id_rsa*`, `id_ed25519*`, `id_ecdsa*` or `exe-dev-key`. |
| O2: positive evidence mid-work | `admin remote reap --issue PAN-4677` printed `still-running`; the machine stayed `started`. |
| O3: hand-off | After `REMOTE_DONE`, `--dry-run` printed `handed-off` ("Dry run — would hand off to review"); the real run printed `handed-off`, opened PR [#4694](https://github.com/eltmon/overdeck/pull/4694), destroyed the machine and logged "Requested review through the dashboard review route". The journal recorded `review.requested` with `source: "api"`, as expected before the route change deploys. The run also logged "Copied 1/1 session JSONL(s)" and "Copied continue.json back from VM", but nothing was copied: `remote-sessions/` stayed empty. Both `copyFromVm` calls awaited an Effect without running it, so the remote transcript was lost with the machine. That bug is fixed in this branch (`Effect.runPromise`, with a test that fails unless the copy runs). |

The first real reap failed once with `cannot lock ref 'refs/remotes/origin/feature/pan-4677'`.
A concurrent fetch had updated the same ref. That failure writes no state and
leaves the machine running, so the next tick (or a rerun) hands off; the rerun did.

The run found and fixed, in this branch: the clone outlasting the 60 s exec
deadline ([#4685](https://github.com/eltmon/overdeck/issues/4685), now cloned in
the background), Claude Code refusing bypass mode as root (`IS_SANDBOX=1`), and
the first-run Bypass Permissions disclaimer (`bypassPermissionsModeAccepted`).
It also filed [#4682](https://github.com/eltmon/overdeck/issues/4682) (the
default image name does not exist; set `[remote.fly] image =
"registry.fly.io/pan-workspaces:latest"`) and
[#4683](https://github.com/eltmon/overdeck/issues/4683) (`pan start --remote`
re-plans a planned issue, and the post-planning auto-start runs locally).

The automatic 60 s tick, the `remote-reap` journal source and the heartbeat
file are checked after deploy in
[#4696](https://github.com/eltmon/overdeck/issues/4696).

## Live verification (PAN-4652)

Fly machines were tested live on 2026-11-01, before merge, against app
`pan-workspaces` (region `iad`), with this branch's own build: a test home dashboard
from the branch's `dist/` (peer mode, `OVERDECK_DISABLE_DEACON=1` plus
`OVERDECK_ANYWHERE_SUPERVISOR=1`, its own `OVERDECK_HOME` and port 3941) and a test
image `registry.fly.io/pan-workspaces:pan-4652` (the `pan-workspace` image with the
branch's packed `@overdeck/core` 0.72.0 installed, so the VM ran the branch's
`pan serve --no-open` and public-link-only gate). Because the test home ran no deacon, a
shell loop wrote the host heartbeat every 60 s in place of `heartbeatFlyMachines`. The
app got its public IPs first: a shared IPv4 (66.241.124.218) and an IPv6.

**Run 1, machine `862102ae249718`** (`add-fly --project overdeck --message "List the
top-level files and stop." --model claude-sonnet-5-5`): 20:02:08 to 20:04:55 UTC
(2 min 47 s, clone included).

| Check | Result |
|---|---|
| Link over the pinned route | The link came online on `wss://pan-workspaces.fly.dev/ws/link?fly-instance=862102ae249718` (status `current`); the handshake proved the expected key, so Fly honors `fly-force-instance-id` on the upgrade. |
| O1: conversation streams home | The test home listed the conversation (project `overdeck`, Claude Code, Sonnet 5.5) and its transcript showed Claude's file listing of `/workspace/overdeck`. The first message was lost (below); a turn sent through the link as the operator was answered and streamed home. |
| O2: Pull here | `POST /api/linked-conversations/pull` finished `done` (online mode) as `20261101-948d`; a new turn to the VM's copy then answered 409 `conversation-released` ("Continued on d457a684; this copy is read-only"). |
| O3: Docker | `docker run --rm hello-world` exited 125: the default overlay driver cannot mount on the VM's root filesystem ("invalid argument"). Restarted with `--storage-driver=vfs`, it printed "Hello from Docker!" and exited 0. |
| O4: unlink | Removed the link and the record. Its destroy first got 403 because the test home held a copy of a Fly token that flyctl later rotated (a test-setup artifact: without `FLY_API_TOKEN` set, the client reads flyctl's current token); a failed destroy kept the link and record as designed, and the unlink completed once the test home read the current token. |

Run 1 found two defects, fixed in this branch:

- The chip read the bare machine id. Fly's exec shell runs with `HOME=/`, so `pan serve`
  used `/.overdeck` and never read the identity provisioning had written to
  `/root/.overdeck`. Provisioning now reads `${OVERDECK_HOME:-$HOME/.overdeck}` from the
  exec shell.
- Docker could not run containers on the overlay driver; provisioning now starts
  `dockerd --storage-driver=vfs`.

**Run 2, machine `7817612a669d98`** (`add-fly`, no project or message, with the fixes):
20:25:30 to 20:26:32 UTC (62 s). The link label and the identity file read
`fly-7817612a669d98`; the record had `docker: true`; `dockerd --storage-driver=vfs` was
running and `docker run --rm hello-world` exited 0 (O3 settled: Docker works, the D-8
fallback is not needed). `pan machines unlink fly-7817612a669d98` destroyed the machine,
deleted the record and left `fly machines list -a pan-workspaces` empty (O4).

Recorded, not fixed here:

- The first message of a new conversation was lost to Claude Code's "Make auto mode your
  default permission mode?" startup dialog
  ([#4738](https://github.com/eltmon/overdeck/issues/4738)).
- The VM's conversation-lifecycle patrol marks the live conversation ended on every tick,
  which can make the idle sweep see a working machine as idle
  ([#4739](https://github.com/eltmon/overdeck/issues/4739)).
- The first linked request after an idle spell failed with `socket hang up`; an
  immediate retry succeeded ([#4740](https://github.com/eltmon/overdeck/issues/4740)).
- The VM advertises its private Fly addresses as `lan` routes, which home tries before
  the public route ([#4741](https://github.com/eltmon/overdeck/issues/4741)).
- A test that pulls a conversation must not register the workspace being tested as the
  project's checkout: **Pull here** restores the conversation's code into that checkout.

