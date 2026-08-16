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
# --full is nuclear — stops & restarts everything
pan restart --full

# Explicit force cases
# --force is an explicit operator bypass of the deploy-window gate
pan restart --force
# --cliproxy --force redownloads the pinned CLIProxy binary
pan restart --cliproxy --force
```

Each stage is health-gated: the command waits for `GET /api/health` from the
newly spawned dashboard process, or port binding for CLIProxy, before reporting
`✓`. It exits non-zero with a `[stage] reason` message on timeout.

## Identity guard

When `pan restart` would restart the dashboard, it refuses to run from a
non-primary checkout: either a workspace worktree or any linked Git worktree,
including a handoff worktree. It exits with code 2 and names the primary
checkout where the command must run.

The post-boot health gate verifies `repoRoot`, `mode`, and the serving process
PID from `GET /api/health`. A 200 response succeeds only when its PID matches the
process this restart spawned. A different checkout reports
`port held by non-primary server (cwd=…, mode=…)`; an old process from the same
checkout reports `port answered by pid X — not the freshly spawned server (pid
Y)`. Either response is a failure, not a successful restart.

## Ownership-mismatch recovery

When restart names PID X as the existing port owner, inspect that exact process
before acting:

```bash
ps -p X -o pid=,ppid=,etime=,cmd=
lsof -nP -iTCP:3011 -sTCP:LISTEN
```

If it is the stale dashboard named by the failure, terminate it with `kill X`,
verify that the PID and listener are gone, then rerun `pan restart`. Do not use a
broad `pkill` pattern: it can terminate the supervisor, agents, or unrelated Node
processes. A fresh `EADDRINUSE` line fails restart immediately and names the same
owner, while a health timeout leaves the newly spawned process running for
inspection.

## Important Notes

- `pan restart` is idempotent: it stops the old listener(s), starts a new one,
  then polls until the health check passes.
- `pan restart --dashboard` NEVER touches CLIProxy, Traefik, or TLDR — that
  scope contract is enforced by tests.
- Agent-issued dashboard and full restarts consult the deploy-window gate before
  acquiring the restart lock. A refusal queues the deploy, reports its age and
  distinct verification blockers, and self-fires at the next safe verification
  boundary. Do not retry in a loop or use `--force` to interrupt healthy verification;
  `--force` remains the explicit operator bypass for exceptional recovery.
- For `--cliproxy`, `--force` has a separate meaning: it redownloads the binary at
  the pinned version before restarting it.
- If the dashboard restart fails, shared sidecars are left running so recovery
  is possible with another `pan restart` once the root cause is fixed.
- NEVER use `pkill -f "node.*server"` — it can kill unrelated Node processes.
- Prefer `pan restart` over `pan down && pan up` whenever you only need to
  cycle one component. `pan down && pan up` tears down everything and takes
  longer to recover.
