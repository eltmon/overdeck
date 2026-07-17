---
name: pan-restart
description: "pan restart — scoped restart (dashboard by default; --cliproxy, --traefik, or --full) that will not strand shared sidecars"
---

# Restart Overdeck

Use this whenever a Overdeck component needs to be restarted. The `pan restart`
command is scope-aware: by default it restarts **only the dashboard** and leaves
CLIProxy, Traefik, and TLDR running — so a dashboard restart cannot strand the
system or kill unrelated dependencies.

## Canonical paths

| Situation                                                        | Command                        |
|------------------------------------------------------------------|--------------------------------|
| Dashboard restart (rebuild, stale state, `EADDRINUSE` on 3010/3011) | `pan restart`                  |
| GPT-routed agents returning 502s (CLIProxy died)                 | `pan restart --cliproxy`       |
| `.localhost` routing / Traefik changes                           | `pan restart --traefik`        |
| Whole-stack rebuild (use sparingly — stops CLIProxy & Traefik)   | `pan restart --full`           |

## Execution

```bash
# Build first if dashboard server or CLI code changed
cd ~/Projects/overdeck && npm run build

# Dashboard-only restart (safe — leaves CLIProxy, Traefik, TLDR running)
pan restart

# Scoped alternatives
pan restart --cliproxy
pan restart --traefik
pan restart --full       # nuclear — stops & restarts everything

# Explicit force cases
pan restart --force              # bypass the agent deploy-window gate
pan restart --cliproxy --force   # redownload the pinned CLIProxy binary
```

Each stage is health-gated: the command waits for `GET /api/health` (dashboard)
or port binding (CLIProxy) to succeed before reporting `✓`, and exits non-zero
with a `[stage] reason` message on timeout.

## Identity guard

When `pan restart` would restart the dashboard, it refuses to run from a
non-primary checkout: either a workspace worktree or any linked Git worktree,
including a handoff worktree. It exits with code 2 and names the primary
checkout where the command must run.

The post-boot health gate verifies both `repoRoot` and `mode` from
`GET /api/health`. If another server holds the port, the command reports
`port held by non-primary server (cwd=…, mode=…)`; a 200 response from the wrong
server is a failure, not a successful restart.

## Important Notes

- `pan restart` is idempotent: it stops the old listener(s), starts a new one,
  then polls until the health check passes.
- `pan restart --dashboard` NEVER touches CLIProxy, Traefik, or TLDR — that
  scope contract is enforced by tests.
- Agent-issued dashboard and full restarts consult the deploy-window gate before
  acquiring the restart lock. Active verification, merge, post-merge, flywheel,
  restart, or `pan dev` ownership refuses the restart because it would disconnect
  live conversations and terminals; `--force` explicitly bypasses this gate.
- For `--cliproxy`, `--force` has a separate meaning: it redownloads the binary at
  the pinned version before restarting it.
- If the dashboard restart fails, shared sidecars are left running so recovery
  is possible with another `pan restart` once the root cause is fixed.
- NEVER use `pkill -f "node.*server"` — it can kill unrelated Node processes.
- Prefer `pan restart` over `pan down && pan up` whenever you only need to
  cycle one component. `pan down && pan up` tears down everything and takes
  longer to recover.
