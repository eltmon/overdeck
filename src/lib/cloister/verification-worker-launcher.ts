import { spawn, type ChildProcess } from 'node:child_process';

export interface VerificationWorkerLaunch {
  command: string;
  args: string[];
  systemdUnit?: string;
}

/** Build the process boundary that owns a verification worker. */
export function buildVerificationWorkerLaunch(
  issueId: string,
  runId: string,
  workerPath: string,
  request: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): VerificationWorkerLaunch {
  const forceSystemd = env.OVERDECK_VERIFICATION_SYSTEMD_SCOPE === '1';
  const useSystemd = platform === 'linux'
    && env.OVERDECK_VERIFICATION_SYSTEMD_SCOPE !== '0'
    && (!env.VITEST || forceSystemd);

  if (!useSystemd) {
    return { command: process.execPath, args: [workerPath, request] };
  }

  const safeIssue = issueId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const systemdUnit = `overdeck-verification-${safeIssue}-${runId}`;
  return {
    command: 'systemd-run',
    args: [
      '--user',
      '--scope',
      '--unit', systemdUnit,
      '--collect',
      '--quiet',
      '--same-dir',
      process.execPath,
      workerPath,
      request,
    ],
    systemdUnit,
  };
}

/**
 * Launch the worker in a sibling systemd scope on Linux. A detached process
 * group alone remains inside the dashboard service cgroup and is killed when
 * that unit is replaced. In scope mode systemd-run execs the worker after
 * moving itself, so the returned pid remains the worker pid.
 */
export function launchVerificationWorker(
  launch: VerificationWorkerLaunch,
  logFd: number,
  env: NodeJS.ProcessEnv,
): ChildProcess {
  return spawn(launch.command, launch.args, {
    detached: process.platform !== 'win32',
    stdio: ['ignore', logFd, logFd],
    env,
  });
}
