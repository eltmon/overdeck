---
audience: operator
name: pan-restart
description: "pan restart — scoped restart (dashboard by default; --cliproxy, --traefik, or --full) that will not strand shared sidecars"
---
audience: operator

# Restart Panopticon

Use this whenever a Panopticon component needs to be restarted. The `pan restart`
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
cd /home/eltmon/Projects/panopticon-cli && npm run build

# Dashboard-only restart (safe — leaves CLIProxy, Traefik, TLDR running)
pan restart

# Scoped alternatives
pan restart --cliproxy
pan restart --traefik
pan restart --full       # nuclear — stops & restarts everything
```

Each stage is health-gated: the command waits for `GET /api/health` (dashboard)
or port binding (CLIProxy) to succeed before reporting `✓`, and exits non-zero
with a `[stage] reason` message on timeout.

## Important Notes

- `pan restart` is idempotent: it stops the old listener(s), starts a new one,
  then polls until the health check passes.
- `pan restart --dashboard` NEVER touches CLIProxy, Traefik, or TLDR — that
  scope contract is enforced by tests.
- If the dashboard restart fails, shared sidecars are left running so recovery
  is possible with another `pan restart` once the root cause is fixed.
- NEVER use `pkill -f "node.*server"` — it can kill unrelated Node processes.
- Prefer `pan restart` over `pan down && pan up` whenever you only need to
  cycle one component. `pan down && pan up` tears down everything and takes
  longer to recover.
