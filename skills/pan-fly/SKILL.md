---
name: pan-fly
audience: operator
description: Fly.io operations for Panopticon remote workspaces and deployed app instances. Use when users ask about Fly.io setup, remote workspaces, machine status, SSH/exec access, tunneling, or deploying/debugging Fly-hosted services.
triggers:
  - fly.io
  - fly remote workspace
  - fly machine
  - fly deploy
  - fly ssh
  - pan remote
  - pan fly
allowed-tools:
  - Bash
  - Read
---

# Fly.io Operations for Panopticon

Use this skill when the task involves Fly.io-backed Panopticon remote workspaces or Fly-hosted application instances.

## What This Covers

- `pan remote setup` / `pan remote status`
- Fly-backed remote workspaces created by Panopticon
- Fly Machines lifecycle: create, inspect, start, stop, destroy
- SSH/exec into Fly machines
- Port proxy/tunneling with `fly proxy`
- Debugging deployed apps on Fly
- Verifying what version is actually deployed

## First Principles

1. Prefer **Panopticon commands** for Panopticon-managed remote workspaces.
2. Use **Fly CLI/API** when Panopticon does not expose the needed detail.
3. For deployed app version checks, prefer **non-destructive verification**:
   - public health/bootstrap/version endpoints
   - `fly ssh console` + read-only inspection
   - status/metadata commands
4. Never perform destructive Fly actions unless the user explicitly asked.

## Panopticon Remote Workspace Workflow

### Initial setup

```bash
pan remote setup
pan remote status
```

Key config lives in `~/.panopticon/config.toml` under `[remote]` and `[remote.fly]`.

Important fields:
- `app`
- `org`
- `region`
- `vm_size`
- `vm_memory`
- `image`
- `auto_stop`
- `auto_stop_timeout`

Reference: `docs/fly-provider.md`

### Create and inspect remote workspaces

```bash
pan workspace create --remote PAN-42
pan remote status
pan workspace list
```

### Start/stop/delete a remote workspace

```bash
pan workspace start PAN-42
pan workspace stop PAN-42
pan workspace delete PAN-42
```

## Fly CLI Patterns

If `flyctl` is required, check it first:

```bash
fly version
fly auth whoami
```

Useful commands:

```bash
fly status -a <app>
fly machines list -a <app>
fly machine status <machine-id> -a <app>
fly ssh console -a <app>
fly ssh console -a <app> -C "<command>"
fly logs -a <app>
fly proxy <local>:<remote> -a <app>
```

## Determining Deployed Version

Prefer this order:

### 1. Public bootstrap/health/config endpoints
Many apps expose a bootstrap/config endpoint that includes version/build metadata.

Examples:
```bash
curl -fsSL https://<app>.fly.dev/healthz
curl -fsSL https://<app>.fly.dev/__openclaw/control-ui-config.json
```

### 2. Inspect the deployed frontend bundle
If the app serves a JS bundle and the bootstrap endpoint is not obvious, inspect the HTML and referenced assets for version metadata.

### 3. SSH and inspect runtime directly
If public endpoints do not expose the version:

```bash
fly ssh console -a <app> -C "openclaw --version"
```

Or inspect package metadata:

```bash
fly ssh console -a <app> -C "node -p 'require(\"./package.json\").version'"
```

Use read-only inspection first. Do not restart, deploy, or mutate state unless requested.

## OpenClaw-on-Fly Notes

For the personal OpenClaw fork deployment, a Fly config like `fly.eltmon.toml` typically identifies the app name and runtime shape.

Useful checks:

```bash
curl -fsSL https://<app>.fly.dev/healthz
curl -fsSL https://<app>.fly.dev/__openclaw/control-ui-config.json
fly status -a <app>
fly ssh console -a <app> -C "openclaw --version"
```

If the Control UI bootstrap endpoint returns JSON with `serverVersion`, treat that as the deployed server version.

## Troubleshooting

### Not authenticated

```bash
fly auth whoami
printenv | grep '^FLY_'
```

If needed:
- `FLY_API_TOKEN`
- `fly auth login`

### Remote unavailable in Panopticon

Run:

```bash
pan remote status
```

Then inspect:
- config in `~/.panopticon/config.toml`
- whether `flyctl` is installed
- whether auth is valid

### Tunnel/proxy issues

```bash
fly proxy 4173:4173 -a <app>
fly ssh console -a <app> -C "ss -tlnp"
```

### Machine exists but app is unhealthy

```bash
fly status -a <app>
fly machines list -a <app>
fly logs -a <app>
```

## Safety Rules

- Never delete machines, apps, or volumes unless explicitly requested.
- Never deploy or restart just to inspect version/state.
- Prefer additive diagnosis: status, logs, health endpoints, bootstrap JSON, SSH read-only commands.
- For Panopticon-managed remote workspaces, do not bypass Panopticon when a Panopticon command exists.

## Related References

- `docs/fly-provider.md`
- `src/lib/remote/fly-provider.ts`
- `src/cli/commands/remote/setup.ts`
- `src/cli/commands/remote/status.ts`
