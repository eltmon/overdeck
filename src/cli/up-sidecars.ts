import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { mkdir, open } from 'fs/promises';
import { dirname, join } from 'path';
import { Effect } from 'effect';
import chalk from 'chalk';

import { getOverdeckHome } from '../lib/paths.js';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Where the detached `pan sync --if-changed` that `pan up` starts writes its output. */
export function deferredSyncLogPath(overdeckHome: string = getOverdeckHome()): string {
  return join(overdeckHome, 'logs', 'sync.log');
}

/**
 * Start `pan sync --if-changed` detached, appending its output to
 * `~/.overdeck/logs/sync.log` — the first sync after a deploy runs the whole
 * Herdr pass (config, reload, update decision, integration installs), and its
 * warnings must be readable somewhere (PAN-3956 review finding 5).
 */
export async function spawnDeferredSync(config: {
  selfCli: string;
  logPath?: string;
  spawnImpl?: typeof spawn;
}): Promise<string> {
  const logPath = config.logPath ?? deferredSyncLogPath();
  await mkdir(dirname(logPath), { recursive: true });
  const log = await open(logPath, 'a');
  try {
    await log.write(`\n--- pan sync --if-changed (started by pan up) ${new Date().toISOString()} ---\n`);
    const child = (config.spawnImpl ?? spawn)(process.execPath, [config.selfCli, 'sync', '--if-changed'], {
      detached: true,
      stdio: ['ignore', log.fd, log.fd],
    });
    child.on('error', () => { /* non-fatal: sync is best-effort */ });
    child.unref();
  } finally {
    await log.close();
  }
  return logPath;
}

/**
 * PAN-3956 D7: make sure this home's Herdr session server runs. `pan up` calls
 * this BEFORE it starts the dashboard, so the dashboard's pane inventory finds
 * a server at boot (review finding 8). `pan sync --if-changed` returns before
 * any step when its inputs are unchanged, so this cannot be left to it. Never
 * installs, updates, or restarts anything.
 */
export async function ensureHerdrBeforeDashboard(): Promise<void> {
  try {
    const { ensureHerdr, isHerdrSetupSkipped } = await import('../lib/herdr-setup/ensure.js');
    const { HERDR_DOWN_HINT } = await import('./herdr-report.js');
    const herdr = await ensureHerdr({ mode: 'up' });
    if (isHerdrSetupSkipped(herdr)) {
      console.log(chalk.dim(herdr.skipped));
    } else if (herdr.server.running) {
      console.log(chalk.green(`✓ Herdr session server '${herdr.session}' running (${herdr.server.managedBy ?? 'unknown'})`));
      for (const warning of herdr.warnings) console.log(chalk.dim(`  ⚠ ${warning}`));
    } else {
      const state = herdr.server.stateUnknown ? 'state unknown' : 'not running';
      console.log(chalk.yellow(`⚠ Herdr session server ${state}: ${herdr.server.reason ?? 'unknown reason'}`));
      for (const warning of herdr.warnings) console.log(chalk.dim(`  ⚠ ${warning}`));
      console.log(chalk.dim(`  ${herdr.server.hint ?? HERDR_DOWN_HINT}`));
    }
  } catch (error: unknown) {
    console.log(chalk.yellow('⚠ Failed to verify the Herdr session server:'), errorMessage(error));
  }
}

export async function startPostLaunchSidecars(config: {
  selfCli: string;
  projectRoot: string;
}): Promise<void> {
  try {
    const { startCliproxySync, CLIPROXY_PORT } = await import('../lib/cliproxy.js');
    console.log(chalk.dim('Starting CLIProxyAPI sidecar (GPT subscription router)...'));
    startCliproxySync();
    console.log(chalk.green(`✓ CLIProxyAPI listening on http://127.0.0.1:${CLIPROXY_PORT}`));
  } catch (error: unknown) {
    console.log(chalk.yellow('⚠ Failed to start CLIProxyAPI sidecar:'), errorMessage(error));
    console.log(chalk.dim('  GPT subscription agents will not work until this is resolved.'));
  }

  try {
    const { startSmeeProcessSync } = await import('../lib/smee.js');
    console.log(chalk.dim('\nStarting smee-client webhook relay...'));
    startSmeeProcessSync();
  } catch (error: unknown) {
    console.log(chalk.yellow('⚠ Failed to start smee-client:'), errorMessage(error));
    console.log(chalk.dim('  Webhook relay unavailable — GitHub events will use polling fallback'));
  }

  try {
    const { getTldrDaemonServiceSync } = await import('../lib/tldr-daemon.js');
    const venvPath = join(config.projectRoot, '.venv');
    if (existsSync(venvPath)) {
      console.log(chalk.dim('\nStarting TLDR daemon for project root...'));
      const tldrService = getTldrDaemonServiceSync(config.projectRoot, venvPath);
      await tldrService.start(true);
      console.log(chalk.green('✓ TLDR daemon started'));
    } else {
      console.log(chalk.dim('\nSkipping TLDR daemon (no .venv found)'));
      console.log(chalk.dim('  Run setup to create venv with llm-tldr'));
    }
  } catch (error: unknown) {
    console.log(chalk.yellow('⚠ Failed to start TLDR daemon:'), errorMessage(error));
    console.log(chalk.dim('  TLDR will be unavailable but dashboard will work normally'));
  }

  try {
    const { loadConfigSync } = await import('../lib/config-yaml.js');
    const { startTtsDaemon } = await import('../lib/tts-daemon.js');
    const ttsConfig = loadConfigSync().config.tts;
    if (ttsConfig.daemonAutoStart) {
      console.log(chalk.dim('\nStarting Qwen TTS daemon...'));
      const result = await Effect.runPromise(startTtsDaemon({ config: ttsConfig, detach: true, timeoutMs: 30_000 }));
      if (result.ok) {
        console.log(chalk.green(`✓ Qwen TTS daemon listening on http://${ttsConfig.daemonHost}:${ttsConfig.daemonPort}`));
      } else {
        console.log(chalk.yellow('⚠ Failed to start Qwen TTS daemon:'), result.error ?? result.status?.error ?? 'unknown error');
      }
    }
  } catch (error: unknown) {
    console.log(chalk.yellow('⚠ Failed to evaluate Qwen TTS daemon auto-start:'), errorMessage(error));
  }

  // The Herdr session server is ensured before the dashboard starts:
  // ensureHerdrBeforeDashboard (called from `pan up`).

  try {
    const { startSupervisorProcessSync, getSupervisorPortSync } = await import('../lib/supervisor.js');
    const { startSupervisorUnitIfAvailable, SUPERVISOR_UNIT_NAME } = await import('../lib/systemd.js');
    const onWarning = (message: string) => console.log(chalk.dim(`  ⚠ ${message}`));
    if (await startSupervisorUnitIfAvailable({ onWarning })) {
      console.log(chalk.green(`✓ Supervisor managed by ${SUPERVISOR_UNIT_NAME}`));
    } else {
      startSupervisorProcessSync();
      console.log(chalk.green(`✓ Supervisor listening on http://127.0.0.1:${getSupervisorPortSync()}`));
    }
  } catch (error: unknown) {
    console.log(chalk.yellow('⚠ Failed to start supervisor:'), errorMessage(error));
    console.log(chalk.dim('  Force Restart will only work via the Electron bridge or while dashboard is responding.'));
  }

  try {
    const logPath = await spawnDeferredSync({ selfCli: config.selfCli });
    console.log(chalk.dim(`Context and Herdr sync running in background — output in ${logPath}`));
  } catch (error: unknown) {
    console.log(chalk.yellow('⚠ Could not start deferred context sync (non-fatal):'), errorMessage(error));
  }
}
