# Overdeck Development SOP

This SOP covers local dashboard startup, restart, and triage for Overdeck development.

## Post-reboot startup

Use `pan up` after a reboot or when you want the normal local Overdeck stack.

```bash
pan up
```

`pan up` starts the bundled dashboard from `dist/dashboard/server.js` under Node 22. This is the only supported production-like dashboard path. It also starts the supervisor sidecar, which provides restart fallback and watchdog recovery. If `tts.daemon.autoStart: true` is set in `~/.overdeck/config.yaml`, `pan up` also starts the Qwen TTS daemon.

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

## Production-bundle boot and performance verification

A dashboard boot-path change is not ready for the live server until the built Node 22 bundle boots on a throwaway port. Typecheck and unit tests do not execute the Effect layer bootstrap, so they cannot prove that imports, layers, listeners, and post-listen warmers compose at runtime.

Build first, then start `dist/dashboard/server.js` under Node 22 with an isolated `OVERDECK_HOME`, `OVERDECK_DISABLE_DEACON=1`, `OVERDECK_NO_RESUME=1`, and a non-live port. Verify that `/api/health` responds and that the log order is `Dashboard listening` → `Project resource refresh queue started` → `Boot cache warm complete`. The health response must arrive even if the resource warm is still running.

Run the performance harness against that PID and port:

```bash
node scripts/verify-dashboard-performance.mjs \
  --pid <throwaway-pid> \
  --base-url http://127.0.0.1:<throwaway-port> \
  --duration 65 \
  --assert
```

The targets and architecture are documented in [DASHBOARD-PERFORMANCE.md](./DASHBOARD-PERFORMANCE.md). Do not restart the live dashboard into an untested boot-path change. After the throwaway boot is green, use the normal deploy owner; a manual restart that needs an explicit wait uses `pan restart --dashboard --health-timeout 120000` because the flag is milliseconds and the minimum boot-path allowance is 120 seconds.

## Restart behavior guarantees

`pan reload` builds before it touches the running dashboard. It fetches `origin/main` and builds in a temporary detached worktree, then keeps that detached checkout as the active deployment root and launches its `dist/dashboard/server.js` with its canonical runtime dependencies and workspace packages intact. The dashboard process still uses the primary repository as its working directory and health identity. The primary checkout's `node_modules/` remains untouched; its `dist/` mirror is refreshed for subsequent CLI commands and resolves external packages through a link to the canonical deployment root. Uncommitted changes and local-only commits in the primary worktree can therefore neither contaminate nor block a deploy, newly added external runtime packages remain available, and active development dependencies are preserved. An active-bundle marker makes later `pan restart` and `pan up` launches reuse the same canonical deployment root. Reload alternates between two fixed generation worktrees. A restart failure before the new dashboard is left running restores the prior marker and primary `dist/`, removes the failed generation, and leaves the previous dashboard generation available. A health timeout preserves the new marker, `dist/`, and deployment root because the lifecycle deliberately leaves that process running so a slow boot can finish or a broken boot can be inspected. Every reload also sweeps legacy unreferenced deployment roots, so restart failures and cleanup errors cannot create an unbounded disk leak. If the build fails, the old dashboard keeps running and the command exits non-zero. If the build succeeds, `pan reload` restarts only the dashboard and waits for `/api/health`. The health payload reports the raw build provenance as `buildCommit`, `buildDirty`, and `buildBranch`; a canonical reload reports `buildDirty: false` and a null branch because its build worktree is detached.

A deployment generation is only used while it can still boot. Both `pan reload`, before it moves traffic onto a freshly built generation, and every `pan restart` that would reuse the active-bundle marker resolve the bare imports of that generation's `dist/dashboard/server.js` from the generation's own location — the same question Node asks at boot. Reload fails and leaves the old dashboard running; restart logs the unresolvable packages, ignores the marker, and launches the primary checkout's `dist/` copy of the same commit instead, which resolves against the primary `node_modules`. Existence alone is not enough: in [PAN-3264](https://github.com/eltmon/overdeck/issues/3264) a live generation's `node_modules/.bun` store was deleted underneath the running server, turning all 31 top-level entries into dangling symlinks while `server.js` stayed on disk, and every restart relaunched the unbootable tree for 14 minutes. The build-time guard `scripts/lint-dist-externals.mjs` covers the same contract one step earlier, failing the build when a package `dist/` imports is declared in `dependencies` but does not resolve from the build root.

Activation also points the global `pan` symlink at the new generation, so the CLI itself executes from a detached worktree frozen at the commit that generation was built from. Anything the CLI resolves relative to its own bundle inherits that freeze — including `sync-sources/`, the tree `pan sync` distributes hooks, bundled rules, skills, and templates from. `resolveSyncSourcesRoot()` in `src/lib/paths.ts` therefore redirects to the checkout named by the active-bundle marker's `repoRoot` whenever the CLI is running from a generation, because that is the only tree tracking `main`. Without the redirect, `pan sync` copied the frozen snapshot over the identical stale files already in `~/.overdeck/bin/` and reported success, so a merged fix to agent behavior never deployed and nothing in the output said so ([PAN-3327](https://github.com/eltmon/overdeck/issues/3327)). `pan sync` now names the tree it synced from and reports per-file `updated`/`unchanged` counts, warns when it is running from a generation at all, and `pan doctor`'s **Deployed Hooks** check compares `~/.overdeck/bin/` against that tree so the drift is findable without an incident to reveal it.

Restart operations are serialized by `${OVERDECK_HOME}/restart.lock`. The lock records the holder PID, timestamp, and caller. Stale locks recover when the holder PID is dead or the lock is older than five minutes.

The supervisor watchdog polls the dashboard API health endpoint every 10 seconds by default. After three consecutive failures, it spawns `pan restart --dashboard`. It allows three watchdog-triggered restarts within a five-minute rolling window. If the cap is reached, it logs `WATCHDOG GIVING UP — manual intervention required` and stops attempting until a healthy poll clears the state.

The supervisor also polls the Qwen TTS daemon every 10 seconds when TTS is enabled or `tts.daemon.autoStart` is true. After two failed health checks it runs the same daemon start path as `pan tts start`, with a three-restart cap in a ten-minute rolling window.

The latest restart outcome is written to `${OVERDECK_HOME}/restart-status.json`. `pan status` renders that state, including failures and watchdog give-up alarms.

`pan up`, `pan reload`, and dashboard-starting `pan restart` scopes refuse to run from a non-primary checkout, including workspace and handoff worktrees. They exit with code 2 and name the primary checkout to use. Their post-boot health gates also require `/api/health` to report the expected `repoRoot` and `mode`; a 200 response from a different server fails as `port held by non-primary server (cwd=…, mode=…)`. This prevents the workspace-peer port-squatting incident class tracked by [PAN-2252](https://github.com/eltmon/overdeck/issues/2252).

Dashboard health also reports the serving process PID. A restart reports verified success only when that PID equals the process it just spawned, so an old listener returning HTTP 200 cannot impersonate the replacement. A mismatch fails as `port answered by pid X — not the freshly spawned server (pid Y)` and leaves the processes available for inspection; if the spawn PID cannot be resolved, the success line explicitly says `ownership unverified` instead of claiming verified replacement. Teardown separately checks that every targeted PID is dead after signal escalation — a later HTTP 200 is never evidence that the old process stopped.

During the post-spawn health window, restart reads only bytes newly appended to `~/.overdeck/logs/dashboard.log`. A fresh `EADDRINUSE` fails immediately instead of waiting for the full health deadline, and the error names the current port owner and command when resolvable. The failed child has already exited in this case, so restart leaves the existing owner running for inspection rather than killing an unidentified process.

## Automatic deployment after merges

Production builds embed their Git commit and build time. Deacon compares that commit with
`origin/main` every fifth patrol cycle, counting only commits that touch build inputs such as
`src/`, `packages/`, `package.json`, `bun.lock`, and `tsdown.config.ts`. `/api/health` exposes the
running `buildCommit`; the app header shows `build stale ×N` when newer build-input commits exist.

The post-merge lifecycle and Deacon share the same deploy safety window. They defer while
verification, merging, another restart, a pending post-merge lifecycle, or `pan dev` is active.
Deacon also requires the `CI` workflow for the exact `origin/main` tip to complete successfully;
pending, failed, or unreadable CI state defers deployment. It then waits for the merge debounce interval,
so a merge train produces one rebuild and restart instead of one per merge.

Configure the behavior in Cloister config:

```yaml
deploy:
  auto_deploy: true          # default: rebuild and restart when the safety window clears
  debounce_minutes: 5        # default: wait for origin/main to settle
  queue_deadline_minutes: 30 # default: escalate a deploy that remains blocked
```

### Deploy queue

When the deploy gate refuses an agent-issued restart, Overdeck records the request in
`~/.overdeck/pending-deploy.json`. New verification admissions pause while this record exists,
but a verification already running continues until it finishes. The deploy patrol then fires the
queued reload when the merge debounce has passed, CI is green for the exact `origin/main` tip,
and the deploy gate is clear. A queued request fires even when `deploy.auto_deploy` is false,
because that setting controls patrol-created deployments rather than a deployment already requested.

If the queue remains blocked past `deploy.queue_deadline_minutes`, the patrol emits an error,
announces the delay, and surfaces a needs-you decision against the active verifier. The queue file is
runtime-plane state: it remains present while the reload runs and clears only after the running build
reports fresh, which proves that the queued deployment landed.

Set `deploy.auto_deploy: false` for signal-only mode when no deploy is already queued. Staleness remains visible in system health
and the header, but Deacon does not create a deployment request. On Linux, Deacon runs the reload in a
transient systemd user unit with rate-limited failure recovery, so stopping the old dashboard cannot
kill the reload through the dashboard's cgroup. Patrol reloads stamp `deploy-patrol` as the restart
initiator instead of inheriting the identity that launched the current dashboard. Deployment output
and retry failures are appended to `~/.overdeck/logs/auto-deploy.log`.

`pan reload` remains the manual deployment door. It builds first, preserves the running dashboard
when the build fails, restarts the Node 22 bundle after a successful build, and waits for health.

### Post-merge deploy retries and escalation

`postMergeLifecycle()` spawns `scripts/post-merge-deploy.sh`, which re-execs into a transient
systemd user unit (`overdeck-post-merge-deploy-<ns>`) with `Restart=on-failure` and no start
limit ([PAN-3386](https://github.com/eltmon/overdeck/issues/3386)): a post-kill failure must never
leave the machine without a dashboard successor, so retries are unbounded by design. Its output
goes to `/tmp/overdeck-deploy.log` — not `auto-deploy.log`, which belongs to the patrol path
above. After 5 consecutive failed runs the script escalates once per unit
([PAN-3601](https://github.com/eltmon/overdeck/issues/3601)): a durable `activity.entry` (error,
desktop-notified, with the log tail) plus a priority-0 TTS announcement, posted through
`POST /api/internal/events/append-once` so the alert is at-most-once even across retries; a POST
that fails while the dashboard is down is retried on the next unit restart. A successful deploy
also refreshes the deployment generation's `scripts/` alongside `dist/`, so a fixed deploy script
reaches the live generation without waiting for a full `pan reload`. To inspect or stop a
retrying deploy: `systemctl --user list-units 'overdeck-post-merge-deploy-*'`.

## Dashboard recovery guardian

The local recovery model has two tiers. The `overdeck-supervisor.service` systemd user unit keeps the supervisor sidecar alive, and the supervisor keeps the dashboard alive by polling health and running `pan restart --dashboard` when the dashboard is down. Systemd owns only the supervisor, not the dashboard process, so dashboard recovery still flows through the existing watchdog logic and avoids a second owner fighting the restart path.

On Linux hosts with a working per-user systemd manager, `pan up` installs and starts `overdeck-supervisor.service` through `systemctl --user`. A supervisor crash or SIGKILL is treated as a unit failure and systemd restarts it according to the unit's restart policy. `pan down` is the stay-down latch: it stops `overdeck-supervisor.service` cleanly, and systemd does not restart a unit that the operator deliberately stopped.

Useful operator commands:

```bash
systemctl --user status overdeck-supervisor.service
systemctl --user stop overdeck-supervisor.service
systemctl --user start overdeck-supervisor.service
```

Use `systemctl --user status overdeck-supervisor.service` to see whether the guardian is running, restarting, or failed. Use `systemctl --user stop overdeck-supervisor.service` only for an intentional stay-down state; use `pan up` or `systemctl --user start overdeck-supervisor.service` to re-arm the guardian afterward.

On hosts without a usable `systemctl --user` session, including macOS, CI, non-systemd Linux, and most containers, Overdeck falls back to the detached supervisor process used before the systemd unit. That fallback still protects the dashboard while the supervisor is alive, but it does not give the supervisor an external guardian.

This is not cold-boot recovery. The unit is not a boot-time bring-up mechanism, and it does not enable user lingering or start Traefik, cliproxy, or the dashboard after a machine reboot from nothing. After reboot, use `pan up` to start the normal stack. The restart-under-load path also depends on #2286; until that prerequisite is in place, a watchdog-triggered dashboard restart may still fail under heavy startup latency.

## Failure triage

Start with `pan status` and, for audio issues, `pan tts status`.

```bash
pan status
pan tts status
```

Check the restart-status line first. It shows the latest dashboard restart trigger, age, duration, success or failure, and error text when available. `pan tts status` shows the Qwen daemon PID, endpoint, model, queue depth, uptime, and GPU memory use.

If `pan status` shows a watchdog failure or give-up, inspect the supervisor log next.

```bash
less ~/.overdeck/logs/supervisor.log
```

The supervisor log records watchdog polling, skipped restarts due to the restart lock, spawned restart PIDs, and give-up messages.

If the supervisor triggered a restart but the dashboard stayed unhealthy, inspect the dashboard log.

```bash
less ~/.overdeck/logs/dashboard.log
```

The dashboard log contains startup failures, runtime exceptions, and health-check failures from the bundled server process.

If the dashboard log shows `ERR_MODULE_NOT_FOUND` from a path under `~/.overdeck/deployments/dashboard/`, that generation's dependency tree is broken. Restart now detects this and falls back to the primary checkout's build, printing `Ignoring the active deployment` with the packages that failed to resolve — so the dashboard should come back on its own. To put the generation itself back in service, restore its tree and reinstall, then reload.

```bash
D=~/.overdeck/deployments/dashboard/.pan-reload-generation-b
git -C "$D" checkout -- packages/
(cd "$D" && bun install)
pan reload
```

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
