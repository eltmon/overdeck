/**
 * `pan connect` — turn this machine into a lasting linked machine (PAN-4656,
 * W-LINK9, FR-25). Run over SSH on a fresh server, it:
 *
 *  1. under `npx`, installs the running version into `<OVERDECK_HOME>/runtime`
 *     and re-runs itself from there (the npx cache may be pruned);
 *  2. makes sure the dashboard runs as this install's primary;
 *  3. installs the supervisor as a service (systemd user unit with lingering
 *     on Linux, launch agent on macOS, else a plain process, said plainly);
 *  4. prints one pairing link that another machine can reach.
 *
 * Registered from `pair.ts` through `lazyAction`, so this module stays off the
 * CLI's startup import graph. Every side effect is a `ConnectDeps` member.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { networkInterfaces, userInfo, type NetworkInterfaceInfo } from 'node:os';
import { join } from 'node:path';
import chalk from 'chalk';

import { pickPairingBase, type PairingBase } from '../../lib/anywhere/connect-address.js';
import {
  CONNECT_REEXEC_ENV,
  ensureDurableRuntime,
  isNpxCacheRoot,
  readRuntimeVersion,
} from '../../lib/anywhere/connect-runtime.js';
import { getOverdeckHome, packageRoot } from '../../lib/paths.js';
import type { PlatformConfig } from '../../lib/platform-lifecycle.js';
import type { RestartLockHandle } from '../../lib/restart-lock.js';
import type { SystemdUserUnavailableReason } from '../../lib/systemd.js';
import { exitCli } from '../exit.js';
import type { ServiceContext, ServiceOutcome } from './connect-service.js';
import { LOOPBACK_WARNING, requestPairingLink, type PairingLinkResult } from './pairing-link.js';

export interface ConnectOptions { url?: string; label?: string; json?: boolean }

export type { ServiceContext, ServiceOutcome } from './connect-service.js';

type DashboardIdentity = { repoRoot: string; mode: 'primary' };

export interface ConnectDeps {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  argv: readonly string[];
  execPath: string;
  isTTY: boolean;
  packageRoot: string;
  version: string;
  overdeckHome: string;
  user: string;
  interfaces: () => NodeJS.Dict<NetworkInterfaceInfo[]>;
  stdout: (line: string) => void;
  stderr: (line: string) => void;

  readRuntimeVersion: (overdeckHome: string) => Promise<string | null>;
  ensureDurableRuntime: (overdeckHome: string, version: string) => Promise<{ root: string; installed: boolean }>;
  /** Runs `execPath args` with inherited stdio and the given env; resolves to its exit code. */
  reexec: (execPath: string, args: readonly string[], env: NodeJS.ProcessEnv) => Promise<number>;

  platformConfig: () => PlatformConfig;
  primaryIdentity: () => DashboardIdentity;
  /** Rejects when no dashboard with that identity answers within the timeout. */
  waitForDashboardHealth: (port: number, opts: { timeoutMs: number; expectedIdentity: DashboardIdentity }) => Promise<void>;
  /** The `repoRoot` a dashboard on the port reports, or null when none answers. */
  probeDashboardRepoRoot: (port: number) => Promise<string | null>;
  acquireRestartLock: (caller: string) => Promise<RestartLockHandle | null>;
  /** Start (or replace) the dashboard as the primary and wait up to 120 s for it. */
  restartDashboard: (config: PlatformConfig, identity: DashboardIdentity) => Promise<void>;

  supervisorUnitAllowed: (env: NodeJS.ProcessEnv) => boolean;
  explainSystemdUserUnavailable: () => Promise<SystemdUserUnavailableReason | null>;
  startSupervisorProcess: () => void;
  /** Linux with a usable user manager; absent ⇒ the process fallback. */
  installLinuxService?: (ctx: ServiceContext) => Promise<ServiceOutcome>;
  /** macOS; absent ⇒ the process fallback. */
  installMacService?: (ctx: ServiceContext) => Promise<ServiceOutcome>;

  requestPairingLink: (options: { label?: string; base: string }) => Promise<PairingLinkResult>;
}

const WINDOWS_MESSAGE = 'pan connect supports Linux and macOS; on Windows, run it inside WSL.';
const LOCK_HELD = 'A dashboard restart is already in progress; run pan connect again in a minute.';
const DASHBOARD_PROBE_TIMEOUT_MS = 2_000;
const TRAEFIK_NOTE = 'Traefik is enabled here; after a reboot the dashboard starts but Traefik and CLIProxy wait for pan up.';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function unavailableReasonText(reason: SystemdUserUnavailableReason | 'home', user: string): string {
  switch (reason) {
    case 'home':
      return 'OVERDECK_HOME is not ~/.overdeck — set OVERDECK_SUPERVISOR_UNIT=1 to allow the user service';
    case 'container':
      return 'this is a container';
    case 'no-runtime-dir':
      return `XDG_RUNTIME_DIR is not set — log in over SSH as ${user} directly`;
    case 'no-session-bus':
      return `there is no user D-Bus session bus ($XDG_RUNTIME_DIR/bus is missing) — log in over SSH as ${user} directly`;
    case 'ci':
      return 'this is a CI run';
    case 'not-linux':
    case 'systemctl-unusable':
    case 'manager-not-running':
      return 'systemctl --user is not usable';
  }
}

function processFallback(deps: ConnectDeps, reason: string | null): ServiceOutcome {
  deps.startSupervisorProcess();
  return {
    manager: 'process',
    name: null,
    enabled: false,
    line: 'plain process.',
    linger: 'not-applicable',
    note: reason === null
      ? 'The server runs as a plain process: it stops when you log out and does not start after a reboot.'
      : `No systemd user manager is available here (${reason}), so the server runs as a plain process: `
        + 'it stops when you log out and does not start after a reboot.',
  };
}

async function installService(deps: ConnectDeps, ctx: ServiceContext): Promise<ServiceOutcome> {
  if (deps.platform === 'darwin') {
    return deps.installMacService ? deps.installMacService(ctx) : processFallback(deps, null);
  }
  const reason = deps.supervisorUnitAllowed(deps.env) ? await deps.explainSystemdUserUnavailable() : 'home';
  if (reason === null && deps.installLinuxService) return deps.installLinuxService(ctx);
  return processFallback(deps, reason === null ? null : unavailableReasonText(reason, deps.user));
}

/** The arguments after `connect`, so the re-run gets the same flags. */
function connectArgs(argv: readonly string[]): string[] {
  const at = argv.indexOf('connect');
  return [...(at >= 0 ? argv.slice(at + 1) : argv.slice(3))];
}

function hostAndPort(base: string): string {
  const url = new URL(base);
  return `${url.hostname}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`;
}

/**
 * Ensures the dashboard answers as this install's primary. Returns the repo
 * root of a foreign dashboard it replaced, null when none was replaced, or an
 * error message.
 */
async function ensurePrimaryDashboard(
  deps: ConnectDeps,
  config: PlatformConfig,
): Promise<{ ok: true; replaced: string | null } | { ok: false; message: string }> {
  const port = config.dashboardApiPort;
  const identity = deps.primaryIdentity();
  try {
    await deps.waitForDashboardHealth(port, { timeoutMs: DASHBOARD_PROBE_TIMEOUT_MS, expectedIdentity: identity });
    return { ok: true, replaced: null };
  } catch {
    // Not running, or running from another checkout: start ours below.
  }

  const reportedRoot = await deps.probeDashboardRepoRoot(port);
  const lock = await deps.acquireRestartLock('pan connect');
  if (!lock) return { ok: false, message: LOCK_HELD };
  try {
    await deps.restartDashboard(config, identity);
  } catch (error) {
    return {
      ok: false,
      message: `Could not start the dashboard: ${errorMessage(error)}. Its log is ${join(deps.overdeckHome, 'logs', 'dashboard.log')}.`,
    };
  } finally {
    await lock.release();
  }
  return { ok: true, replaced: reportedRoot !== null && reportedRoot !== identity.repoRoot ? reportedRoot : null };
}

/** `pan connect`; resolves to the process exit code. */
export async function runConnect(options: ConnectOptions, deps: ConnectDeps): Promise<number> {
  const json = options.json === true;
  const progress = json ? deps.stderr : deps.stdout;
  const fail = (message: string): number => {
    deps.stderr(chalk.red(message));
    return 1;
  };

  if (deps.platform === 'win32') return fail(WINDOWS_MESSAGE);

  const reexecuted = deps.env[CONNECT_REEXEC_ENV] === '1';
  if (isNpxCacheRoot(deps.packageRoot) && !reexecuted) {
    const runtimePrefix = join(deps.overdeckHome, 'runtime');
    if ((await deps.readRuntimeVersion(deps.overdeckHome)) !== deps.version) {
      progress(`Installing @overdeck/core@${deps.version} into ${runtimePrefix} (one time)…`);
    }
    let root: string;
    try {
      ({ root } = await deps.ensureDurableRuntime(deps.overdeckHome, deps.version));
    } catch (error) {
      return fail(errorMessage(error));
    }
    return deps.reexec(
      deps.execPath,
      [join(root, 'dist', 'cli', 'index.js'), 'connect', ...connectArgs(deps.argv)],
      { ...deps.env, [CONNECT_REEXEC_ENV]: '1' },
    );
  }

  const config = deps.platformConfig();
  const port = config.dashboardApiPort;
  let base: PairingBase;
  try {
    base = pickPairingBase({ url: options.url, port, sshConnection: deps.env.SSH_CONNECTION, interfaces: deps.interfaces() });
  } catch (error) {
    return fail(errorMessage(error));
  }

  const dashboard = await ensurePrimaryDashboard(deps, config);
  if (!dashboard.ok) return fail(dashboard.message);

  let service: ServiceOutcome;
  try {
    service = await installService(deps, {
      env: deps.env,
      user: deps.user,
      isTTY: deps.isTTY,
      json,
      overdeckHome: deps.overdeckHome,
      progress,
    });
  } catch (error) {
    return fail(`Could not install the Overdeck server as a service: ${errorMessage(error)}`);
  }

  const link = await deps.requestPairingLink({ label: options.label, base: base.base });
  if (!link.ok) return fail(link.message);

  const runtime = reexecuted ? deps.packageRoot : null;
  if (json) {
    deps.stdout(JSON.stringify({
      url: link.url,
      credential: link.credential,
      expiresAt: link.expiresAt,
      base: { url: base.base, kind: base.kind },
      service: { manager: service.manager, name: service.name, enabled: service.enabled },
      linger: service.linger,
      runtime,
      replacedRepoRoot: dashboard.replaced,
    }));
    return 0;
  }

  const out = deps.stdout;
  if (dashboard.replaced) out(`Replaced the dashboard that was running from ${dashboard.replaced}.`);
  out(`Overdeck server: ${service.line}`);
  if (service.note) out(service.note);
  out('');
  out('Link this machine from another machine within 10 minutes, before this machine restarts:');
  out('');
  out(`  ${chalk.bold(`pan machines link '${link.url}'`)}`);
  out('');
  out('or paste the link into Settings → Anywhere → Machines → Link a machine.');
  out(`Expires: ${link.expiresAt} (single use)`);
  if (config.traefikEnabled) out(TRAEFIK_NOTE);
  if (base.kind === 'loopback') {
    out(chalk.yellow(LOOPBACK_WARNING));
  } else if (base.kind !== 'tailnet') {
    out(`The other machine must reach ${hostAndPort(base.base)}. If a firewall blocks it, open that port `
      + 'or set up Tailscale with `pan tailscale setup`, then run pan connect again.');
  }
  if (runtime) out(`Run Overdeck commands on this machine with: ${join(deps.overdeckHome, 'runtime', 'node_modules', '.bin', 'pan')}`);
  return 0;
}

function reexecChild(execPath: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(execPath, [...args], { stdio: 'inherit', env });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

async function probeDashboardRepoRoot(port: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DASHBOARD_PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: controller.signal });
    if (!response.ok) return null;
    const body = await response.json().catch(() => null) as { repoRoot?: unknown } | null;
    return typeof body?.repoRoot === 'string' ? body.repoRoot : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function defaultDeps(): Promise<ConnectDeps> {
  const [lifecycle, restart, restartLock, systemd, supervisor] = await Promise.all([
    import('../../lib/platform-lifecycle.js'),
    import('./restart.js'),
    import('../../lib/restart-lock.js'),
    import('../../lib/systemd.js'),
    import('../../lib/supervisor.js'),
  ]);
  const version = (JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf-8')) as { version: string }).version;
  return {
    platform: process.platform,
    env: process.env,
    argv: process.argv,
    execPath: process.execPath,
    isTTY: process.stdin.isTTY === true,
    packageRoot,
    version,
    overdeckHome: getOverdeckHome(),
    user: userInfo().username,
    interfaces: networkInterfaces,
    stdout: (line) => console.log(line),
    stderr: (line) => console.error(line),
    readRuntimeVersion: (home) => readRuntimeVersion(home),
    ensureDurableRuntime: (home, v) => ensureDurableRuntime(home, v),
    reexec: reexecChild,
    platformConfig: lifecycle.readPlatformConfig,
    primaryIdentity: restart.resolvePrimaryDashboardIdentity,
    waitForDashboardHealth: (port, opts) => lifecycle.waitForDashboardHealth(port, opts),
    probeDashboardRepoRoot,
    acquireRestartLock: restartLock.acquireRestartLock,
    restartDashboard: async (config, identity) => {
      await lifecycle.restartDashboard(config, () => restart.spawnDashboardDetached(config, { resume: true }), {
        healthTimeoutMs: 120_000,
        expectedIdentity: identity,
      });
    },
    supervisorUnitAllowed: (env) => systemd.supervisorUnitAllowed(env),
    explainSystemdUserUnavailable: systemd.explainSystemdUserUnavailable,
    startSupervisorProcess: supervisor.startSupervisorProcess,
    installLinuxService: async (ctx) => (await import('./connect-systemd.js')).installLinuxService(ctx),
    installMacService: async (ctx) => (await import('./connect-launchd.js')).installMacService(ctx),
    requestPairingLink,
  };
}

export async function connectCommand(options: ConnectOptions): Promise<void> {
  const code = await runConnect(options, await defaultDeps());
  if (code !== 0) await exitCli(code);
}
