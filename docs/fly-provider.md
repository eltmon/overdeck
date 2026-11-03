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

**Work agents (PAN-4734).** `pan start <id> --remote`, and `pan start <id> --machine fly`,
start a new Fly machine as [Fly machines (linked)](#fly-machines-linked) describes and run
the work agent there as a conversation in `/workspace/<project>/workspaces/feature-<issue>`.
Its transcript streams into home's dashboard while it works. The durable tier is refused
(`--tier durable` or `remote.resiliency_tier = "durable"`). The raw-tmux VM that the rest of
this page describes remains only for remote workspaces created before PAN-4734; `pan start
--remote` refuses an issue that still has one and names `pan workspace destroy <id>`.

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

- **Workspace image** built from `docker/pan-workspace/Dockerfile` and pushed to
  `registry.fly.io/<app>:latest` (see [Building the Image](#building-the-pan-workspace-image))

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
   - Push the local `feature/<id>` branch to origin when a local workspace exists, so the planned spec reaches the machine; creation stops with an error and creates no machine if that push is rejected
   - Create a Fly Machine in your configured app
   - Wait up to 300 s for it to reach `started`
   - Sync Claude Code and GitHub credentials from your local machine
   - Clone the repository over HTTPS into `/workspace` and check out the feature branch
   - Configure Claude Code and copy your local skills
   - Save workspace metadata to `~/.overdeck/workspaces/<id>.yaml`
   - If a setup step after the create step fails (credential sync onward), delete the machine and try to delete its durable-tier volume before reporting the error. If the create step itself fails (for example the machine does not reach `started` within 300 s), the machine is left in place; find it with `fly machines list -a <app>`.

   Only committed work reaches the machine: uncommitted changes in the local
   workspace are not pushed.

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

# Docker image that every workspace machine runs. Optional: the default is
# registry.fly.io/<app>:latest, because the Fly registry is app-scoped.
# image = "registry.fly.io/pan-workspaces:latest"

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
| `remote.fly.image` | `"registry.fly.io/<app>:latest"` | Workspace container image (default follows `remote.fly.app`) |
| `remote.fly.auto_stop` | `true` | Stop machine when agent is idle |
| `remote.fly.auto_stop_timeout` | `300` | Idle timeout in seconds |
| `remote.fly.api_token_env` | `"FLY_API_TOKEN"` | Environment variable name for the API token |

Every `remote.*` key above lives in `~/.overdeck/config.toml`. The global
`~/.overdeck/config.yaml` has its own `remote:` section, but it holds only
`resiliency_tier` and `max_concurrent_agents` — not `enabled` or any other key
in this table (PAN-4905).

---

## Building the pan-workspace Image

Every Fly Machine runs the `pan-workspace` image defined in
`docker/pan-workspace/Dockerfile`. The image is based on Ubuntu 24.04 and includes:

- Node.js 22
- pnpm
- Claude Code CLI (`@anthropic-ai/claude-code`)
- Codex CLI (`@openai/codex`). Provisioning a Fly machine reinstalls home's exact Codex
  version when the VM's differs (PAN-4296).
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
docker build -t registry.fly.io/pan-workspaces:latest \
  -f docker/pan-workspace/Dockerfile .

# Push to Fly's private registry
docker push registry.fly.io/pan-workspaces:latest
```

Replace `pan-workspaces` with your `[remote.fly] app` when you changed it.

The pushed reference must equal the effective image: `[remote.fly] image` when set,
else `registry.fly.io/<app>:latest`.

> The Fly app (`pan-workspaces` by default) must exist before you can push to its
> registry. `pan remote setup` or `pan workspace create --remote` will create the app
> automatically using the Machines API (`POST /apps`).

---

## Fly machines (linked)

A **Fly machine** (PAN-4652) is a Fly VM that runs `pan serve` and is linked one way
from home, so its conversations stream into home's dashboard like any linked machine's.
Since PAN-4734 it also hosts `pan start --remote` work agents, as a conversation each. A
legacy remote work agent VM (created before PAN-4734, the rest of this page) runs Claude
Code in raw tmux and no Overdeck server. Start one with
`pan machines add-fly`; the operator guide is the `## Fly machines` section of
`configuration/linked-machines.mdx`, and the design is `## Fly machines (PAN-4652)` in
`docs/ANYWHERE-ARCHITECTURE.md`.

| | Legacy remote work agent VM | Fly machine |
|---|---|---|
| Started by | `pan start --remote` before PAN-4734 | `pan machines add-fly`, `POST /api/machines/fly`, `pan start --remote` (`POST /api/remote/work-agents`) |
| Runs | Claude Code in tmux | `pan serve`, then Claude Code or Codex conversations through it |
| Reached by | Machines exec API | a secure channel over `wss://<app>.fly.dev/ws/link` |
| State on home | `agents/agent-<issue>/remote-state.json` | `fly-machines.json` plus a machine link |
| Removed by | the reap, after hand-off | unlink, the idle sweep, the stopped-machine sweep, the reap after a work agent's hand-off (always destroyed) |

**Server environment (D-4).** The VM's `pan serve --port 3011 --no-open` runs with
`OVERDECK_TERMINAL_BACKEND=tmux`, `IS_SANDBOX=1`, `OVERDECK_PUBLIC_LINK_ONLY=1` and
`PORT=3011`, set on the command line so remote work agent VMs are unchanged.
`OVERDECK_PUBLIC_LINK_ONLY=1` also makes the VM advertise no endpoints, so home never dials
its private `172.19.x.y` addresses (PAN-4741).

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

This section describes legacy remote workspaces (created before PAN-4734). A `pan start
--remote` work agent now runs on a Fly machine, whose lifecycle is in
[Fly machines (linked)](#fly-machines-linked) and [Automatic loops](#automatic-loops).

Each workspace maps to exactly one Fly Machine inside the configured app.

### Creation

`pan workspace create --remote <issue>` calls `FlyApiClient.createMachine()` with:
- The configured `image`, `vm_size`, `vm_memory`, and `region`
- `restart.policy = "no"` — machines do not auto-restart on crash
- `auto_destroy = false` — machines persist after the process that created them exits

After creation the provider polls `GET /apps/:app/machines/:id/wait?state=started` for
up to 300 seconds. Once the machine is running, Overdeck runs setup commands over the
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

Fly machines (`pan machines add-fly`) also get the Codex sign-in when home has the Codex
CLI and a valid sign-in (PAN-4296):

| Credential | Local source | Remote destination |
|---|---|---|
| Codex sign-in | `~/.codex/auth.json` | `$HOME/.codex/auth.json` in the VM's exec shell (`/.codex/auth.json`, because `HOME=/` there), mode 0600 |

OpenAI replaces the refresh token on every refresh, so two copies of one sign-in cannot
both stay valid. The Codex sign-in is therefore not copied one way like Claude's: the
`syncFlyCodexAuth` loop (below) keeps home and each VM in step by newest refresh wins.

Claude Code is configured for autonomous operation: `~/.claude/settings.json` is written
from your resolved Overdeck permission mode, and `~/.claude.json` marks onboarding
complete, trusts `/workspace`, accepts the Bypass Permissions disclaimer, and dismisses
the one-shot "Make auto mode your default permission mode?" dialog
(`hasSeenAutoDefaultNudge`), which otherwise took focus on every fresh VM and swallowed
the first message (PAN-4738).

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

Fly machines (PAN-4652, `## Fly machines (linked)` above) have three more loops of their
own in `src/lib/remote/fly-machine-loops.ts`, and the credential refresh covers them too.
With no Fly machine record, none calls the Fly API.

| Loop | Cadence | What it does | Deacon frozen |
|---|---|---|---|
| `heartbeatFlyMachines` | every 60 s | Writes `/workspace/.pan/host-heartbeat` on every Fly machine, so its watchdog keeps it running while home is up. A failed exec is reported as a failure, never as refreshed. | keeps running |
| `syncFlyCodexAuth` | every 60 s | For each linked Fly machine whose record has a `codexAuthPath`, reads the VM's Codex `auth.json` and decides by newest refresh wins: copies a newer same-account VM refresh home (atomic write), otherwise copies home's sign-in to the VM when the two differ. A VM that does not answer is skipped until the next tick. With no such record it makes no Fly API call. | keeps running |
| `sweepFlyMachines` | every 60 s | Destroys the machine, removes its link and deletes its record when the Fly API reports it `stopped`, `destroyed` or `failed` or answers 404; when no unreleased linked conversation on it has been active for `[remote.fly] machine_idle_minutes` (default 30, 0 disables); or when provisioning never linked it within 30 min. Any other API error leaves it alone. | keeps running |

**Linked work agents (PAN-4734).** A `pan start --remote` work agent keeps a
`remote-state.json` with `linked: true`. The remote heartbeat, the spend cap's agent count
and the credential refresh's agent list skip it, because its Fly machine record already
covers the VM. `sweepFlyMachines` never idle-removes a Fly machine that hosts a linked work
agent whose state is `starting` or `running`; it still removes one that is stopped or gone.
The reap owns that machine: on `REMOTE_DONE` it probes the conversation's tmux session
(`conv-<name>` on the VM's `overdeck` socket), copies `<worktree>/.overdeck/continue.json`
home, hands the branch to review, then destroys the Fly machine, removes its link and
deletes its record. On a crash it salvages the worktree and stops the machine; the sweep
then removes it.

A rejected Fly token (PAN-4748) shows as `Fly token rejected (<status>)` in each loop's
line instead of a raw API error; `sweepFlyMachines` keeps the record rather than
destroying it on one.

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
3. Alternatively, authenticate via CLI: `fly auth login` — the provider reads flyctl's
   stored login (`~/.fly/config.yml`) when no `FLY_API_TOKEN` (or the variable
   `remote.fly.api_token_env` names) is set.

**Fly token rejected (403)**

Overdeck uses flyctl's stored login when no `FLY_API_TOKEN` is set. That token expires
quickly, and flyctl refreshes it only when flyctl itself runs. Overdeck now runs `flyctl
auth token` once after a 401/403 and retries the same request with the refreshed token
(PAN-4748). If that refresh also fails — flyctl is not installed, or the stored login is
older than 30 days — every operator-facing surface (the deacon loop lines, `pan machines
add-fly`/`unlink` errors, and `pan doctor`) says `Fly token rejected`.

**Fix:** run `fly auth login` to refresh the stored login. For a host where nobody runs
`fly` interactively (a server, a CI runner), mint a long-lived token instead and export it
as `FLY_API_TOKEN` (for example in `~/.overdeck.env`):

```bash
fly tokens create deploy -a <app> --expiry <duration>
```

---

### Image not found / machine fails to start

**Symptom:** Machine creation succeeds but the machine never reaches `started`, or exec
commands immediately fail.

**Fix:**
0. If `[remote.fly] image` is `registry.fly.io/pan-workspace:latest` (written by
   `pan remote setup` before PAN-4682), delete that line: the repository does not exist,
   and the default `registry.fly.io/<app>:latest` does.
1. Confirm the image exists: `fly status -a pan-workspaces` → check machine image ref.
2. Rebuild and push the image (see [Building the Image](#building-the-pan-workspace-image)).
3. Verify the effective image (see Build and push) matches the pushed tag exactly.

---

### Exec / SSH commands fail

**Symptom:** `pan workspace create` errors during clone or credential sync steps with
non-zero exit codes from the exec API.

**Causes and fixes:**
- **Machine not started** — the 300 s wait timed out (often a first boot still pulling the image). Creation fails and the machine is not deleted: find it with `fly machines list -a <app>`. Re-run `pan workspace create --remote <issue>` to adopt and start it, or destroy it with `fly machines destroy <machine-id> -a <app> --force` (on the durable tier, also destroy its `<vm-name>-workspace` volume as shown below).
- **Image missing required tools** — ensure the Dockerfile installs git, python3, curl,
  and base64. Rebuild and push.
- **Fly API exec timeout** — each exec call has a 60 s deadline. The clone does not
  run inside one exec: it starts detached (`setsid nohup`), writes its output to
  `/tmp/pan-clone.log` and its exit code to `/tmp/pan-clone.exit`, and Overdeck polls
  every 5 s for up to 20 min. If the clone exits non-zero, the machine is deleted and
  the error shows the last 5 lines of the log. If it does not finish in 20 min, the
  error is `clone did not finish within 20 min`. Re-run after increasing `vm_memory`
  if the OOM killer is the cause.
- **Creation fails during setup** — any failure in a setup step after the create step
  returns (credential sync, clone, branch checkout, Claude Code setup, skills copy,
  compose) deletes the machine, and on the durable tier also tries to delete its
  `<vm-name>-workspace` volume, before the error is shown. If the machine delete also
  fails (for example an expired Fly token answering 403, #4748), the error names the
  machine and prints the command to remove it by hand:
  `fly machines destroy <machine-id> -a <app> --force`. On the durable tier, run
  `fly volumes list -a <app>` after any failed creation: rollback does not report a
  failed volume delete. If a `<vm-name>-workspace` volume is still listed, destroy
  it with `fly volumes destroy <volume-id> -a <app> --yes`.

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
default image name did not exist; fixed by PAN-4682, which derives it from
the app) and
[#4683](https://github.com/eltmon/overdeck/issues/4683) (`pan start --remote`
re-plans a planned issue, and the post-planning auto-start runs locally).

The automatic 60 s tick, the `remote-reap` journal source and the heartbeat
file were checked after deploy in [#4696](https://github.com/eltmon/overdeck/issues/4696);
see "Post-deploy verification (PAN-4696)" below.

### Post-deploy verification (PAN-4696)

Checked on 2026-11-02 against the deployed build `3d485389776` (deacon child
pid 2065725, deacon-lite every 60 s, freeze off), which contains PAN-4295 (`74f4da1fb85`),
PAN-4682 (`a7fdf79133e`), PAN-4683 (`babf86c1b92`) and PAN-4748 (`4d5461bfccd`). No
`[remote.fly]` image override and no manual branch push were used.

Smoke issue PAN-4832 ([#4832](https://github.com/eltmon/overdeck/issues/4832));
`pan plan PAN-4832 --auto` then `pan start PAN-4832 --remote` started machine
`8911151a2e0d98` (`pan-pan-4832-ws`, ephemeral tier, image
`registry.fly.io/pan-workspaces:latest`) without re-planning and without a
manual push.

| Check | Result |
|---|---|
| Heartbeat (FR-3) | 2026-11-02T16:32:13Z (age 0 s) and 2026-11-02T16:33:13Z (age 28 s), 60 s apart; `dashboard.log` shows "Host heartbeat refreshed for PAN-4832 on pan-pan-4832-ws". |
| Automatic reap (FR-1) | REMOTE_DONE at 2026-11-02T16:35:06Z; deacon-lite handed off at about 2026-11-02T16:35:56Z (about 50 s later) with no operator command: "Remote reap PAN-4832: handed-off (REMOTE_DONE sentinel present for PAN-4832; Review artifact: https://github.com/eltmon/overdeck/pull/4846; Destroyed machine pan-pan-4832-ws; …)". Machine `8911151a2e0d98` destroyed; `workspaces/feature-pan-4832/` materialized; PR [#4846](https://github.com/eltmon/overdeck/pull/4846) opened. Transcript copy-back: 1 JSONL in `remote-sessions/`. |
| Journal source (FR-2) | **Failed.** `workspaces/feature-pan-4832/.overdeck/pipeline.jsonl` does not exist — no `review.requested` entry was ever written. The reap's own details line gives the reason: "Review not requested (Workspace has uncommitted changes. …)" — the materialized workspace had unrelated, uncommitted drift in `.overdeck/context/codebase/concerns.md` (not the smoke agent's work), which tripped the clean-tree guard in `getDirtyWorkspaceErrorForReviewRequest` before `requestReviewThroughRoute(..., { source: 'remote-reap' })` could run. Filed [#4847](https://github.com/eltmon/overdeck/issues/4847) with the root cause and evidence (D-3). |

Cleanup: reviewers aborted (0 were running — no review had been requested),
PR [#4846](https://github.com/eltmon/overdeck/pull/4846) closed unmerged with
its branch deleted, PAN-4832 closed, `remote.enabled` restored to `false`, no
smoke machine left (`fly machines list -a pan-workspaces --json` returns `[]`).

Filed from this run:

- [#4847](https://github.com/eltmon/overdeck/issues/4847) — automatic Fly reap skips requesting review when an unrelated background process leaves a tracked workspace file (`.overdeck/context/codebase/concerns.md`) dirty at hand-off time.

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
  default permission mode?" startup dialog — fixed by PAN-4738: the VM pre-answers the
  dialog, and the readiness wait no longer takes the dialog for the composer
  ([#4738](https://github.com/eltmon/overdeck/issues/4738)).
- The VM's conversation-lifecycle patrol and the conversation list disagreed about a live
  conversation, so its row flapped between `ended` and `active` and the idle sweep could
  see a working machine as idle
  ([#4739](https://github.com/eltmon/overdeck/issues/4739)). Fixed by PAN-4739: the
  census now reads tmux as a UTF-8 client (see "Reproduction (PAN-4739)" below), and the
  patrol confirms through `conversationHarnessAlive` before it ends a conversation, so
  the patrol and the list route can no longer flap the row. A census verdict the door
  contradicts logs one `WARNING (PAN-4739)` line in `fly-serve.log`.
- The first linked request after an idle spell failed with `socket hang up`; an
  immediate retry succeeded ([#4740](https://github.com/eltmon/overdeck/issues/4740)).
- The VM advertises its private Fly addresses as `lan` routes, which home tries before
  the public route ([#4741](https://github.com/eltmon/overdeck/issues/4741)).
- A test that pulls a conversation must not register the workspace being tested as the
  project's checkout: **Pull here** restores the conversation's code into that checkout.

**Reproduction (PAN-4739).** Cause found and fixed in `src/lib/tmux.ts` (the decision
rule's first branch). Run 1's image (`registry.fly.io/pan-workspaces:pan-4652`, pan
0.72.0, tmux 3.4) ran in a local container with `pan serve` started as provisioning
starts it (`HOME=/`, `setsid nohup`, `OVERDECK_TERMINAL_BACKEND=tmux IS_SANDBOX=1`).
The server process had no `LANG` or `LC_*` variable, and without a UTF-8 locale tmux
prints every tab in `-F` output as `_`: the census's `list-panes -a` returned
`conv-20261102-2889_565_0_` where it should return tab-separated fields. The parser
read no pane id from that line and dropped it, so the census held no session, and the
patrol logged `Session conv-20261102-2889 gone — marking ended` 30 s after the spawn
while `tmux ls` listed the session. `list-sessions -F '#{session_name}'` has no tab,
so the list route still saw the session and set the row back to `active` on the next
`GET /api/conversations`. The pane readers that parse tab-separated records
(`listAllPaneRecords`, `listPaneValues`, `listPaneValuesSync`) now pass `-u`, which
makes tmux write UTF-8 output whatever the locale. With that change patched into the
same container, a row marked ended under a live harness was set back to `active` by
the patrol's own census on the next tick, and no `gone` line appeared.


## Live verification (PAN-4296)

Codex on Fly machines was tested live on 2026-11-01, before merge, against app
`pan-workspaces` (region `iad`), with this branch's own build: a test home dashboard from
the branch's `dist/` (peer mode, `OVERDECK_DISABLE_DEACON=1` plus
`OVERDECK_ANYWHERE_SUPERVISOR=1`, its own `OVERDECK_HOME`, port 3942) and a test image
`registry.fly.io/pan-workspaces:pan-4296` (the `pan-workspace` image of this branch, which
installs `@openai/codex`, plus the branch's packed `@overdeck/core` 0.72.0). Home ran
`codex-cli 0.159.0` with a valid ChatGPT sign-in. Because the test home ran no deacon, a
script called this branch's `heartbeatFlyMachines()` and `syncFlyCodexAuth()` every 60 s.

**Run 1, machine `84eee59fe096e8`** (22:32 to 22:55 UTC): provisioning succeeded (the
record had `codexAuthPath: "/.codex/auth.json"`), and the heartbeat and the Codex sync ran
from 22:33 to 22:36. At 22:37 every Fly API call from the test home started to answer 403:
the client read flyctl's stored token from `~/.fly/config.yml`, which had expired, and
flyctl refreshes it only when it runs. The clone poll then timed out (`project-failed`
after 20 min) and the rollback could not destroy the VM, which was destroyed by hand with
`fly machines destroy`. Filed as [#4748](https://github.com/eltmon/overdeck/issues/4748).
Run 2 set `FLY_API_TOKEN` to a 3-hour deploy token scoped to the app (revoked afterwards).

**Run 2, machine `8576656cd2d548`** (`add-fly --project overdeck --harness codex --model
gpt-6.1-sol --message "List the top-level files and stop."`): 22:57:08 to 23:04:03 UTC
(6 min 55 s, clone included).

| Check | Result |
|---|---|
| Codex prepared (D-2, D-4, D-6) | The image shipped `codex-cli 0.166.0`; provisioning re-pinned the VM to `0.159.0`. `/.codex/auth.json` existed with mode 600 and home's size; the record had `codexAuthPath: "/.codex/auth.json"` and `docker: true`. The conversation's managed `codex-home-v2/auth.json` was a symlink to `/.codex/auth.json`. |
| O1: conversation streams home | The test home listed `@<env>/20261101-7040` with harness `codex`, model `gpt-6.1-sol`, machine `fly-8576656cd2d548` (online), and the conversation page showed the `fly-8576656cd2d548` chip, the Codex composer and the streamed file listing (Playwright screenshot, isolated browser). The first message was delivered; no retry was needed. |
| O2: shell command (D-12) | Codex ran its `exec` tool in `/workspace/overdeck` with `sandbox_mode = "workspace-write"`; the command exited 0 and listed the top-level files. The rollout had no Landlock, seccomp or "operation not permitted" error, so the D-12 `full-access` fallback is not needed. |
| Codex sign-in sync (D-3) | Every tick printed no action: home and VM held the same sign-in (identical SHA-256 before and after), so nothing was pushed or pulled. Home's `~/.codex/auth.json` was never rewritten. |
| O4: Pull here | The first pull failed at `adopt` (`wip-failed`): the test home's checkout was an empty git repository without the snapshot's base commits, a test-setup artifact. With the checkout replaced by a shared clone of the repository, the second pull finished `done` (online mode) as `20261101-aa9b`, a home Codex conversation on `gpt-6.1-sol`; the VM copy read `ended`. |
| O3: unlink | `pan machines unlink fly-8576656cd2d548` destroyed the machine in 5 s, emptied `fly-machines.json`, and left `fly machines list -a pan-workspaces` empty. |

## Live verification (PAN-4734)

`pan start --remote` work agents were tested live on 2026-11-02, before merge, against
app `pan-workspaces` (region `iad`), on the throwaway issue
[#4819](https://github.com/eltmon/overdeck/issues/4819) (one plan item: add a line to a
scratch file). The operator approved the spend and chose to stop at review: each
hand-off's PR ([#4822](https://github.com/eltmon/overdeck/pull/4822),
[#4845](https://github.com/eltmon/overdeck/pull/4845)) and the issue were closed
without merging, and the review the reap requested was stopped.

**Setup.** A test home dashboard from this branch's `dist/` (peer mode,
`OVERDECK_DISABLE_DEACON=1`, `OVERDECK_ANYWHERE_SUPERVISOR=1`,
`OVERDECK_TERMINAL_BACKEND=tmux`, its own `OVERDECK_HOME` and tmux socket, port 3941),
the CLI from the same `dist/`, and a shell loop writing the host heartbeat in place of
the deacon's `heartbeatFlyMachines`. The reap ran as `pan admin remote reap --issue
PAN-4819` for the same reason. The VM ran a test image,
`registry.fly.io/pan-workspaces:pan-4734`: the `pan-workspace` image with this
branch's packed `@overdeck/core` 0.72.0. That is required, because provisioning pins
the VM's `pan` to home's version and the published 0.72.0 lacks this branch's VM-side
code (run 3 failed with `pan serve`: `unknown option '--no-open'`).

### Bugs the check found and fixed

1. **A Fly machine refused the work agent's `cwd`** (run 4, commit `ef9c35049b5`).
   `POST /api/conversations` checked a caller's `cwd` with `validateCwdContainment`,
   which requires it to lie under the server's home directory. A Fly machine's
   `pan serve` runs with `HOME=/` and keeps projects in `/workspace`, so the issue
   worktree was refused with 400 `Invalid cwd`, although D-3 relies on it. The create
   path now requires an absolute, existing directory inside the registered project.
2. **Every Fly machine's deacon killed its own server ten minutes after boot**
   (run 6, commit `1eb0c1ea9f9`). This bug predates PAN-4734 and affects every
   PAN-4652 Fly machine. The orphan dashboard reaper assumed it ran inside the live
   server, so it spared only `process.pid`; it runs in the deacon child, so the live
   server is `process.ppid`. On home, the `lsof` port-owner guard still protected the
   server, but the Fly image has no `lsof`. So at the reaper's ten-minute tick the
   VM's server got SIGTERM, the link went offline and linked conversations stopped
   streaming home (the agent itself kept working under tmux). PAN-4652's live runs
   all ended within three minutes, so they never reached the first reap. The reaper
   now also spares its parent.
3. **The remote work agent ran `pan done` instead of creating `REMOTE_DONE`**
   (run 6, commit `fb4ee4ce60c`). The REMOTE prompt also carried the unconditional
   "NEVER stop working without calling `pan done`" mandate. On a legacy raw-tmux VM
   `pan done` fails (no server), so agents fell back to the sentinel; a linked Fly
   machine has a server, so `pan done` started a review on the VM that nobody
   receives, and the sentinel never appeared. The REMOTE prompt now forbids
   `pan done`, `pan review request` and `/rebase-and-submit` and names the sentinel in
   every completion mandate.

### Test-setup hazards (not product bugs)

- `remote-state.json` lives under `homedir()/.overdeck/agents`, not `OVERDECK_HOME`.
  A test home that keeps the real `HOME` writes its agent state into the real home,
  where the host's deacon reaps it with its own code. Run 1 was aborted and cleaned
  up for this; later runs used a separate `HOME` with links to the real credentials.
- The host deacon's orphan reaper kills any host `node … dist/dashboard/server.js`
  older than 120 s that is not the port owner, including a deliberate peer test
  dashboard (run 2 died mid-provisioning). Later runs started the peer server
  through a symlink whose path does not match.
- A failed provisioning rolled back cleanly every time it was reached (runs 3, 4
  and 5): the machine was destroyed, the record removed and remote-state saved
  `error` (FR-13).

### Run 6 and run 7

**Run 6** (machine `683dd41ec45508`, image without fixes 2 and 3): provisioned and
linked at 15:54:00 (9 min), conversation `20261102-5538` started at 15:54:40, the CLI
printed the `/conv/@<env>/<name>` URL and the tracker update ran. D-6 held:
`tmux -L overdeck has-session -t conv-20261102-5538` succeeded on the VM. The VM
server died at 15:56:02 (bug 2) and the agent ran `pan done` (bug 3). A `pan tell`
sent at 16:04:56 reached the transcript, and the agent created `REMOTE_DONE` at
16:05:02; the reap handed off at 16:05:39 (37 s), opened #4822, copied the session
JSONL (1/1) and destroyed the machine, link and record.

**Run 7** (machine `890d41a6271d08`, image with all three fixes): start at 16:14:23,
linked at 16:23:55, conversation `20261102-3940` at 16:24:55.

| Check | Result |
|---|---|
| O1: transcript live at home | The home conversation page showed the conversation with the `on fly-890d41a6271d08` chip, `active`, the streamed work prompt and "Working for 54s" (Playwright screenshot, isolated browser context); the list row carried the same chip. The transcript first appeared about three minutes after the start, while Claude Code ingested the pasted prompt. |
| O2: issue tree row | `GET /api/issues/resource-allocated` listed PAN-4819 with sources `branch`, `conversation`, `remote-agent` and the linked row `{ id: -1, name: "@<env>/<name>", origin: "linked" }` (run 6); the tree renders it as `href="/conv/@<env>/<name>"` (unit-tested in `FeatureItem.linkedConversation.test.tsx`). |
| O3: `pan tell` and output view | Run 6: `pan tell agent-pan-4819` reached the transcript; `GET /api/agents/agent-pan-4819/output` returned the same pane text as a direct `capture-pane -t conv-…` on socket `overdeck`. |
| Server survives the reaper | At 16:27:07 the VM server was 11 min 53 s old, health 200, no SIGTERM in its log. |
| Agent signals `REMOTE_DONE` itself | `REMOTE_DONE` appeared at 16:34:01 with no `pan tell`; the transcript had no `pan done` or `pan review request` command, and the VM server logged no review request. |
| O4: reap and teardown | The reap handed off at 16:35:00 (59 s after the sentinel), opened #4845, destroyed the machine through `destroyAndForgetFlyMachine`, removed the link and record, saved remote-state `stopped` and requested review; `fly machines list -a pan-workspaces` was empty. |

Recorded, not fixed here:

- The home link to the VM flapped while the agent worked: `Secure channel … did not
  open within 2500 ms` every minute or two, with the VM server healthy. Each failure
  cleared on the next request (compare PAN-4740).
- A `pan tell` sent while Claude Code is still ingesting its first, large prompt is
  lost (run 6, 15:55:01); the same message sent once the agent was idle arrived.
- The reap's session-JSONL copy (`fly ssh sftp`) copied 1/1 in run 6 and 0/1 in
  run 7; the pane capture and hand-off were unaffected.
- Resuming a conversation or switching its model still applies the home check to
  its stored `cwd` (`handleConversationResume`, `handleConversationSwitchModel`), so
  either can answer 400 on a Fly machine.
- Provisioning took between 2 and 9.5 minutes across the runs.
- The deleted throwaway branch `feature/pan-4819` reappeared on origin once between
  runs 6 and 7 with the run-6 agent's commits; GitHub's events API showed no push
  for it, and the source was not found.
