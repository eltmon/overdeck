# Panopticon Development SOP

This SOP covers local dashboard startup, restart, and triage for Panopticon development.

## Post-reboot startup

Use `pan up` after a reboot or when you want the normal local Panopticon stack.

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

Restart operations are serialized by `${PANOPTICON_HOME}/restart.lock`. The lock records the holder PID, timestamp, and caller. Stale locks recover when the holder PID is dead or the lock is older than five minutes.

The supervisor watchdog polls the dashboard API health endpoint every 10 seconds by default. After three consecutive failures, it spawns `pan restart --dashboard`. It allows three watchdog-triggered restarts within a five-minute rolling window. If the cap is reached, it logs `WATCHDOG GIVING UP — manual intervention required` and stops attempting until a healthy poll clears the state.

The supervisor also polls the Qwen TTS daemon every 10 seconds when TTS is enabled or `tts.daemon.autoStart` is true. After two failed health checks it runs the same daemon start path as `pan tts start`, with a three-restart cap in a ten-minute rolling window.

The latest restart outcome is written to `${PANOPTICON_HOME}/restart-status.json`. `pan status` renders that state, including failures and watchdog give-up alarms.

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
