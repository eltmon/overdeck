# Overdeck Development SOP

This SOP covers local dashboard startup, restart, and triage for Overdeck development.

## Post-reboot startup

Use `pan up` after a reboot or when you want the normal local Overdeck stack.

```bash
pan up
```

`pan up` starts the bundled dashboard from `dist/dashboard/server.js` under Node 22. This is the only supported production-like dashboard path. It also starts the supervisor sidecar, which provides restart fallback and watchdog recovery. If `tts.daemon.autoStart: true` is set in `~/.panopticon/config.yaml`, `pan up` also starts the Qwen TTS daemon.

Do not start the dashboard with Bun. The terminal WebSocket depends on a native Node PTY addon, and the built bundle avoids source-mode ESM cycle failures.

Use `pan dev` only when you are actively developing dashboard code and want Vite HMR.

```bash
pan dev
```

`pan dev` is a development loop. It is not the post-reboot recovery path and does not replace the bundled Node 22 path.

## Mode switching

Use `pan up` when you need the dashboard that agents and local workflows depend on. This mode runs the built server and matches the runtime used by restart and reload commands.

Use `pan dev` when you are changing frontend code and need fast browser updates. Return to `pan up` before validating behavior that depends on the production bundle, supervisor, restart lifecycle, or terminal streaming.

After server or CLI changes, run a build before switching back to `pan up` or before using commands that run the built bundle.

```bash
npm run build
pan up
```

For the common rebuild-and-restart path, use `pan reload`.

```bash
pan reload
```

## Restart behavior guarantees

`pan reload` builds before it touches the running dashboard. If the build fails, the old dashboard keeps running and the command exits non-zero. If the build succeeds, `pan reload` restarts only the dashboard and waits for `/api/health`.

Restart operations are serialized by `${OVERDECK_HOME}/restart.lock`. The lock records the holder PID, timestamp, and caller. Stale locks recover when the holder PID is dead or the lock is older than five minutes.

The supervisor watchdog polls the dashboard API health endpoint every 10 seconds by default. After three consecutive failures, it spawns `pan restart --dashboard`. It allows three watchdog-triggered restarts within a five-minute rolling window. If the cap is reached, it logs `WATCHDOG GIVING UP — manual intervention required` and stops attempting until a healthy poll clears the state.

The supervisor also polls the Qwen TTS daemon every 10 seconds when TTS is enabled or `tts.daemon.autoStart` is true. After two failed health checks it runs the same daemon start path as `pan tts start`, with a three-restart cap in a ten-minute rolling window.

The latest restart outcome is written to `${OVERDECK_HOME}/restart-status.json`. `pan status` renders that state, including failures and watchdog give-up alarms.

## Failure triage

Start with `pan status` and, for audio issues, `pan tts status`.

```bash
pan status
pan tts status
```

Check the restart-status line first. It shows the latest dashboard restart trigger, age, duration, success or failure, and error text when available. `pan tts status` shows the Qwen daemon PID, endpoint, model, queue depth, uptime, and GPU memory use.

If `pan status` shows a watchdog failure or give-up, inspect the supervisor log next.

```bash
less ~/.panopticon/logs/supervisor.log
```

The supervisor log records watchdog polling, skipped restarts due to the restart lock, spawned restart PIDs, and give-up messages.

If the supervisor triggered a restart but the dashboard stayed unhealthy, inspect the dashboard log.

```bash
less ~/.panopticon/logs/dashboard.log
```

The dashboard log contains startup failures, runtime exceptions, and health-check failures from the bundled server process.

## Known limitations

The supervisor can still die. This issue adds dashboard watchdog behavior inside the supervisor, but it does not add a separate process manager that restarts the supervisor itself. If both dashboard and supervisor are unreachable, recover from the CLI with `pan up` or `pan restart --full` after checking the logs above.

## Process and port topology

The local stack is two long-lived Node 22 processes, on two ports:

- **Dashboard** — `node dist/dashboard/server.js`, binds the API/frontend port (`process.env.PORT`, default **3011**; frontend 3010). This is what the browser and agents talk to. It hosts the **Deacon** (Cloister watchdog) in-process.
- **Supervisor** — `node dist/supervisor/server.js`, binds **3012**. It is the dashboard's keep-alive watchdog (polls `/api/health` every 10s; see "Restart behavior guarantees"). It does **not** host a Deacon.

Each is a **singleton on its port.** A second instance that tries to bind an already-owned port fails and exits — so "the process that owns the port" is always the live one.

**Workspace-container peers are not duplicates.** Every running workspace devcontainer runs its own `dist/dashboard/server.js` (cwd `/workspaces/...`, parent `containerd-shim`, `OVERDECK_DISABLE_DEACON=1`). Seeing N+1 dashboard processes with N containers up is healthy. Only the **host** process whose cwd is the primary repo counts.

### Deacon and Flywheel startup order

Deacon/Cloister should be running before starting or resuming the Flywheel. `pan up` starts the dashboard first, then auto-starts Cloister/Deacon when the Deacon boot gate is enabled. Deacon immediately runs startup recovery, stopped-work-agent auto-resume, and a patrol.

Flywheel is not auto-started by dashboard boot. It is a singleton agent session started or resumed explicitly through `pan flywheel start`, `pan flywheel resume`, or the dashboard Flywheel controls. Deacon only auto-resumes stopped `role: work` agents, so it does not resume the `role: flywheel` singleton.

### Boot env gates (read once, at dashboard/supervisor start)

| Env var | Set by | Effect |
| --- | --- | --- |
| `OVERDECK_NO_RESUME=1` | `pan up --no-resume` / `pan restart --no-resume` | Deacon runs but does **not** auto-resume stopped/orphaned agents (orphan recovery off). Use after a reboot — stale `agent-*` `state.json` with `status:running` would otherwise mass-resume. |
| `OVERDECK_DISABLE_DEACON=1` | `pan up --no-deacon` / `pan restart --no-deacon` | Deacon auto-start is **skipped entirely** (no patrols, no recovery). Also set on container peers. |

**Boot gate precedence.** `pan up` and `pan restart` support explicit tri-state gates: `--deacon` / `--no-deacon` and `--resume` / `--no-resume`. Precedence is **flag > inherited env > default**. Use `pan restart --dashboard --deacon --resume` to force both gates back on even from a shell that inherited `OVERDECK_DISABLE_DEACON=1` or `OVERDECK_NO_RESUME=1`; use the `--no-*` forms to force them off. Dashboard boot logs include the effective state and source, e.g. `deacon=on source=flag resume=off source=env`.

The deacon can additionally be paused at runtime via the SQLite flag `deacon.globally_paused` (`pan admin cloister freeze` / `unfreeze`), which **persists across restarts** and is independent of the boot gates — a useful belt-and-suspenders while settling the field.

## Diagnosing process state — and the `pgrep` self-match trap

**The trap (this has burned multi-hour investigations):** `pgrep -f 'dashboard/server.js'` (or `pkill -f`, or any `-f` match on these paths) **also matches your own diagnostic command**, because your shell's argv contains that literal string. The result is phantom "extra dashboards / dueling supervisors" that are really just your own `bash`/`pgrep` subshells. Symptoms: ever-changing PIDs that vanish instantly, parents that are your own `claude`/`bash`/shell-snapshot, `etimes=0s`.

**Always filter to real `node` processes** and use the container-aware census:

```bash
# Real host dashboard(s): comm must be 'node', cwd must be the primary repo, not a container
for pid in $(pgrep -f 'dashboard/server\.js'); do
  [ "$(cat /proc/$pid/comm 2>/dev/null)" = node ] || continue          # drop bash/pgrep self-matches
  grep -qE 'docker|containerd|kubepods|libpod' /proc/$pid/cgroup 2>/dev/null \
    && continue                                                        # drop container peers
  echo "HOST dashboard $pid cwd=$(readlink /proc/$pid/cwd)"
done
ss -ltnp | grep -E ':(3011|3012)\b'        # the port owners are the live singletons
```

Exactly **one** HOST dashboard (owns 3011) and **one** supervisor (owns 3012), with cwd = primary repo, is the healthy state. Trust the **port owner**, not raw `pgrep` counts.

**`watchdog: dashboard slow but alive … deferring restart` in `supervisor.log` is correct behavior, not churn.** It means the health probe timed out but the dashboard is still serving, so the supervisor deferred restarting it (dead-vs-busy classification, PAN-1714). The usual cause is a bloated `panopticon.db` slowing the event-store bootstrap and health endpoint (PAN-1876) — fix the database size, not the watchdog. A genuine restart loop instead shows repeated `received SIGTERM` + `Dashboard listening` pairs with no "slow but alive" deferral.
