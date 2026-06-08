---
name: pan-dashboard-restart
description: Safely restart the Panopticon dashboard server (production Node 22 dist) using a detached process. Use when pan up / pan restart hang, the dashboard churns/reconnects in a loop, two dashboards are dueling, or the server is running from a workspace path / wrong port.
triggers:
  - restart dashboard
  - dashboard restart
  - pan up hangs
  - pan up is hanging
  - dashboard keeps restarting
  - dashboard reconnecting loop
  - dashboard running from workspace
  - dashboard on wrong port
  - two dashboards / dueling deacon
allowed-tools:
  - Bash
  - Read
---

# Panopticon Dashboard Restart (production-safe, detached)

The dashboard the browser talks to is the **pre-built `dist/dashboard/server.js` running under Node 22**, started from the **primary repo checkout** (NOT a `workspaces/feature-*` copy). It serves both the built frontend and the API on one port. **Never** run the production server via `npm run dev`, `tsx`, `vite`, or Bun — that violates the dashboard-node22-only rule (node-pty native addon + circular ESM). `pan dev` is the *development* path (vite HMR for the frontend + Node server); `pan up` is the *production* path.

## When to use this skill

`pan up` / `pan restart` is the normal path. Reach for this manual procedure **only** when:

- `pan up` / `pan restart` hangs for more than ~20s and never returns (it health-checks one port while the server binds another — see Gotcha 2).
- The dashboard is churning: "Connection lost / Reconnecting", servers respawning, `received SIGTERM` loops.
- Two dashboard servers exist (single-deacon-invariant duel) or the live server's cwd is a `workspaces/feature-*` path.

## Critical gotchas (these cost a multi-hour incident)

1. **Never `pkill -f` a pattern that appears in your own command.** `pkill -f 'dashboard/server.js'` matches your *own* shell's argv and kills it mid-run (exit 144). **Always kill by explicit PID** found via `ss`/`ps`.
2. **`pan up`/`pan restart` health-check the configured port (`dashboardApiPort`, default 3011 — or 3010 on some setups), but the server binds `process.env.PORT`.** If `PORT` differs, the wrapper waits forever on the wrong port, never daemonizes, and leaves the server parented to a stuck wrapper — kill that wrapper and the dashboard dies with it. Detached start (below) avoids this entirely.
3. **Exactly ONE server.** Two servers = two deacons racing the same `~/.panopticon` state (the duel), and the PAN-1625 janitor reaps/churns extras. A single port-owner is left alone.
4. **Work-agent tmux sessions survive a dashboard restart** — they are separate processes on the `panopticon` socket. Restarting the dashboard does NOT kill agents; the new deacon reconciles them as running.
5. **Run from the primary repo**, not a workspace. If `readlink /proc/<pid>/cwd` is a `workspaces/feature-*` path, a workspace dashboard hijacked the port — kill it and restart from the primary checkout.

## Procedure

```bash
cd ~/Projects/panopticon-cli   # the PRIMARY checkout

# 1. Rebuild ONLY if you changed server/lib source (the Node 22 dist is what runs)
npm run build

# 2. Find the live dashboard port + PID, kill by EXPLICIT PID (never pkill -f self-matching)
PORT_LINE=$(ss -ltnp 2>/dev/null | grep -E ':(3010|3011|3012)\b' | grep node | head -1)
OLD=$(echo "$PORT_LINE" | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)
echo "current server: pid=$OLD"
[ -n "$OLD" ] && kill -TERM "$OLD"
for i in $(seq 1 15); do { [ -n "$OLD" ] && kill -0 "$OLD" 2>/dev/null; } && sleep 1 || break; done
{ [ -n "$OLD" ] && kill -0 "$OLD" 2>/dev/null; } && kill -9 "$OLD"

# 3. Start ONE fully-detached server (survives the shell; not a child of any wrapper).
#    PORT is inherited from the environment; set it explicitly if you need a specific port.
setsid bash -c 'exec node dist/dashboard/server.js' > /tmp/pan-dash.log 2>&1 < /dev/null &

# 4. Verify health (Traefik routes pan.localhost -> the API port)
for i in $(seq 1 40); do
  code=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 3 https://pan.localhost/api/health 2>/dev/null)
  [ "$code" = 200 ] && { echo "healthy after ${i}s"; break; }
  sleep 1
done

# 5. Confirm SINGLE instance, correct dist path (primary repo, not a workspace)
ss -ltnp 2>/dev/null | grep -E ':(3010|3011)\b'
NEW=$(ss -ltnp 2>/dev/null | grep -E ':(3010|3011)\b' | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)
readlink -f /proc/$NEW/cwd      # must be the primary repo path
```

## Modifiers

- **Keep the deacon OFF during stabilization** (e.g. while diagnosing churn): prefix the start with `PANOPTICON_DISABLE_DEACON=1`, or use `pan restart --no-deacon`. No deacon = no auto-resume and no janitor while you settle things.
- **Suppress auto-resume** (thundering-herd safety before the resume throttle is trusted, or right after a reboot): prefix `PANOPTICON_NO_RESUME=1`.
- **Re-freeze / trim** if a restart wakes too many agents: `pan admin cloister freeze` (global pause) or `pan admin cloister brake` (trim work agents to the cap).

## Verify success

- `pan.localhost/api/health` returns `{"status":"ok"}` and `curl http://localhost:<port>/api/health` returns 200.
- Exactly one `node dist/dashboard/server.js` process; its `/proc/<pid>/cwd` is the primary repo.
- Agent tmux sessions (`tmux -L panopticon list-sessions`) are intact.
- The deacon log (`/tmp/pan-dash.log` or the dashboard log) shows a single `Deacon started` and patrols advancing — no `received SIGTERM` loop.

## Related

- `dashboard-node22-only` rule, `single-deacon-invariant` rule, PAN-1625 (orphan-dashboard-server janitor).
- Ports: frontend 3010 / API server 3011 by default (`platform-lifecycle.ts` `dashboardPort` / `dashboardApiPort`); the live server binds `process.env.PORT`.
