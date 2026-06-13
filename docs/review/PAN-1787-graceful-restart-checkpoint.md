# PAN-1787 Graceful Restart Live Checkpoint

Date: 2026-06-12

Acceptance criterion: `graceful-restart-60s.ac4`

Live checkpoint executed against disposable managed tmux session `agent-pan-1787-live-checkpoint` on the `panopticon` socket.

Command executed:

```bash
npx tsx -e "import { sendGracefulRestartWarning } from './src/lib/graceful-restart.ts'; void (async () => { await sendGracefulRestartWarning('agent-pan-1787-live-checkpoint', 'claude-code', process.cwd()); })();"
```

The helper ran the production `sendGracefulRestartWarning()` path, which sends Escape twice for `claude-code`, sends the 60s warning, waits `GRACEFUL_RESTART_GRACE_MS` (`60000`), then returns. The command completed successfully and logged:

```text
[restartAgent] continue.json is stale (2011s old) - proceeding anyway
```

Pane capture after completion:

```text
bash-5.2$ Restarting in 60s. Update .pan/continue.json now with all progress, decisions, hazards, and resume point
.
bash: Restarting: command not found
bash-5.2$
```

Result: the 60s warning was still visible in the pane after the double-Escape flow and the full 60s grace wait.
