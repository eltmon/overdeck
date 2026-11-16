/**
 * Launch the shutdown final stage (PAN-5342, WI-5, D-5).
 *
 * `pan shutdown --finish [--reboot]` stops the supervisor, the dashboard and
 * the sidecars, so it cannot run inside the dashboard: on Linux it runs in its
 * own transient `systemd-run --user` unit (the `spawnDashboardSystemdUnit`
 * precedent), so the dashboard's exit does not take it down. Elsewhere, or when
 * systemd-run fails, it is a detached spawn logging to
 * `<OVERDECK_HOME>/logs/shutdown.log`. Async only (NFR-1).
 *
 * The unit carries the dashboard's `OVERDECK_*` variables and `PATH` (a user
 * unit otherwise sees only the user manager's environment, which may point at
 * a different Overdeck home) and appends its output to the same log.
 */
import { execFile, spawn } from 'node:child_process';
import { mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { panCliInvocation } from '../../../../lib/pan-cli-invocation.js';
import { getOverdeckHome } from '../../../../lib/paths.js';

const execFileAsync = promisify(execFile);
const SYSTEMD_RUN_TIMEOUT_MS = 10_000;
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface FinalStageDeps {
  readonly platform: NodeJS.Platform;
  readonly now: () => number;
  readonly env: NodeJS.ProcessEnv;
  readonly execFile: (command: string, args: readonly string[]) => Promise<void>;
  /** Detached spawn with stdout/stderr on `logPath`; resolves once the child is launched. */
  readonly spawnDetached: (command: string, args: readonly string[], logPath: string) => Promise<void>;
}

const defaultFinalStageDeps: FinalStageDeps = {
  platform: process.platform,
  now: Date.now,
  env: process.env,
  execFile: async (command, args) => {
    await execFileAsync(command, [...args], { timeout: SYSTEMD_RUN_TIMEOUT_MS });
  },
  spawnDetached: async (command, args, logPath) => {
    const handle = await open(logPath, 'a');
    try {
      const child = spawn(command, [...args], { detached: true, stdio: ['ignore', handle.fd, handle.fd] });
      child.on('error', (err) => console.error('[shutdown] final stage failed to start:', err.message));
      child.unref();
    } finally {
      await handle.close();
    }
  },
};

export function shutdownLogPath(): string {
  return join(getOverdeckHome(), 'logs', 'shutdown.log');
}

export function finalStageArgs(reboot: boolean): string[] {
  return ['shutdown', '--finish', ...(reboot ? ['--reboot'] : [])];
}

export async function spawnFinalStage(opts: { reboot: boolean }, overrides: Partial<FinalStageDeps> = {}): Promise<void> {
  const deps = { ...defaultFinalStageDeps, ...overrides };
  const inv = panCliInvocation(finalStageArgs(opts.reboot));
  const logPath = shutdownLogPath();
  await mkdir(join(getOverdeckHome(), 'logs'), { recursive: true }).catch(() => undefined);

  if (deps.platform === 'linux') {
    const setenv = Object.entries(deps.env)
      .filter(([k, v]) => v !== undefined && ENV_NAME_RE.test(k) && (k === 'PATH' || k.startsWith('OVERDECK_')))
      .flatMap(([k, v]) => ['--setenv', `${k}=${v}`]);
    try {
      await deps.execFile('systemd-run', [
        '--user', '--unit', `overdeck-shutdown-${deps.now()}`, '--collect', '--quiet',
        `--property=StandardOutput=append:${logPath}`,
        `--property=StandardError=append:${logPath}`,
        ...setenv,
        inv.command, ...inv.args,
      ]);
      return;
    } catch (err) {
      console.warn('[shutdown] systemd-run failed; starting the final stage detached:', err instanceof Error ? err.message : err);
    }
  }
  await deps.spawnDetached(inv.command, inv.args, logPath);
}
