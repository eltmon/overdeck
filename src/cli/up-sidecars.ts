import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { Effect } from 'effect';
import chalk from 'chalk';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

  try {
    const { startSupervisorProcessSync, getSupervisorPortSync } = await import('../lib/supervisor.js');
    startSupervisorProcessSync();
    console.log(chalk.green(`✓ Supervisor listening on http://127.0.0.1:${getSupervisorPortSync()}`));
  } catch (error: unknown) {
    console.log(chalk.yellow('⚠ Failed to start supervisor:'), errorMessage(error));
    console.log(chalk.dim('  Force Restart will only work via the Electron bridge or while dashboard is responding.'));
  }

  try {
    const syncChild = spawn(process.execPath, [config.selfCli, 'sync', '--if-changed'], {
      detached: true,
      stdio: 'ignore',
    });
    syncChild.on('error', () => { /* non-fatal: sync is best-effort */ });
    syncChild.unref();
    console.log(chalk.dim('Context sync (skills, rules, hooks, MCP, CLAUDE.md) running in background'));
  } catch (error: unknown) {
    console.log(chalk.yellow('⚠ Could not start deferred context sync (non-fatal):'), errorMessage(error));
  }
}
