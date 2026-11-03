/**
 * Local dashboard helper for `pan join` (PRD PAN-4480 WI-2, D-1, D-12, D-14).
 *
 * `ensureLocalDashboard` probes `<apiUrl>/api/health`; any HTTP answer, even 503, means a dashboard
 * runs. When nothing answers on a loopback `http:` URL with an explicit port, it starts the bundled
 * server detached, like `pan serve` but logging to `dashboard.log`, and waits for `/api/health` from
 * the spawned PID. It never starts Herdr, tmux or Traefik, so a machine with only Node 22 can join.
 * The child is never killed: a slow boot may still finish, and a later `pan up` replaces it.
 *
 * Heavy modules load with dynamic `import()` so registering the CLI group costs nothing.
 */
import { spawn as spawnChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { applyBootGateEnv } from '../../../lib/boot-gates.js';
import { getOverdeckHome, packageRoot as defaultPackageRoot } from '../../../lib/paths.js';

export const DASHBOARD_PROBE_TIMEOUT_MS = 2_000;
export const DASHBOARD_START_TIMEOUT_MS = 120_000;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export class LocalDashboardError extends Error {}

export interface LocalDashboard {
  apiUrl: string;
  started: boolean;
  pid: number | null;
}

export interface LocalDashboardDeps {
  fetch?: typeof fetch;
  spawn?: typeof spawnChildProcess;
  apiUrl?: () => string;
  waitForHealth?: (port: number, pid: number) => Promise<void>;
  packageRoot?: string;
}

/** True when any HTTP response comes back within the probe timeout. */
async function dashboardAnswers(apiUrl: string, fetchFn: typeof fetch): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DASHBOARD_PROBE_TIMEOUT_MS);
  try {
    await fetchFn(`${apiUrl}/api/health`, { signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** The port to start on, or null unless the URL is `http:` on a loopback host with an explicit port. */
function loopbackPort(apiUrl: string): number | null {
  try {
    const url = new URL(apiUrl);
    if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname) || url.port === '') return null;
    return Number(url.port);
  } catch {
    return null;
  }
}

/** The auto-started server's env (D-12): no inherited public URL, the API port, production mode, no resume (D-14). */
function dashboardEnv(port: number): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.DASHBOARD_URL;
  delete env.OVERDECK_DASHBOARD_URL;
  env.PORT = String(port);
  env.API_PORT = String(port);
  env.OVERDECK_MODE = 'production';
  return applyBootGateEnv(env, { resume: false });
}

export async function ensureLocalDashboard(deps: LocalDashboardDeps = {}): Promise<LocalDashboard> {
  const apiUrlFn = deps.apiUrl ?? (await import('../../../lib/config.js')).getDashboardApiUrl;
  const apiUrl = apiUrlFn().replace(/\/+$/, '');

  if (await dashboardAnswers(apiUrl, deps.fetch ?? fetch)) return { apiUrl, started: false, pid: null };

  const port = loopbackPort(apiUrl);
  if (port === null) throw new LocalDashboardError(`No Overdeck dashboard answers at ${apiUrl}. Start it with pan up.`);

  const root = deps.packageRoot ?? defaultPackageRoot;
  const server = join(root, 'dist', 'dashboard', 'server.js');
  const index = join(root, 'dist', 'dashboard', 'public', 'index.html');
  if (!existsSync(server) || !existsSync(index)) {
    throw new LocalDashboardError(
      `Dashboard bundle not found in ${join(root, 'dist', 'dashboard')}. Reinstall @overdeck/core, or run npm run build in a source checkout.`,
    );
  }

  const [{ ensureInternalToken }, lifecycle] = await Promise.all([
    import('../../../lib/internal-token.js'),
    import('../../../lib/platform-lifecycle.js'),
  ]);
  ensureInternalToken();
  const home = getOverdeckHome();
  await mkdir(home, { recursive: true });

  const waitForHealth =
    deps.waitForHealth ??
    ((healthPort: number, pid: number) =>
      lifecycle.waitForDashboardHealth(healthPort, { timeoutMs: DASHBOARD_START_TIMEOUT_MS, expectedPid: pid }));
  const logFile = lifecycle.DASHBOARD_LOG_FILE;

  const child = (deps.spawn ?? spawnChildProcess)(process.execPath, [server], {
    detached: true,
    cwd: home,
    stdio: lifecycle.openDashboardLogStdio(),
    env: dashboardEnv(port),
  });
  const failed = new Promise<never>((_, reject) => {
    child.once('exit', (code) => {
      reject(new LocalDashboardError(`The dashboard exited with code ${code} before it was ready. See ${logFile}.`));
    });
    child.once('error', (err) => {
      reject(new LocalDashboardError(`Could not start the dashboard: ${err.message}`));
    });
  });
  child.unref();

  const pid = child.pid;
  // Without a PID the spawn failed, and Node reports it through the `error` event.
  const ready =
    pid === undefined
      ? failed
      : waitForHealth(port, pid).catch(() => {
          throw new LocalDashboardError(
            `The dashboard did not become ready within ${DASHBOARD_START_TIMEOUT_MS / 1_000} s. See ${logFile}.`,
          );
        });
  await Promise.race([ready, failed]);

  return { apiUrl, started: true, pid: pid ?? null };
}

/** Opens `url` in the default browser, as `pan serve` does. */
export async function openDashboardUrl(url: string): Promise<void> {
  const [{ Effect }, { openBrowser }, { layer: nodeServicesLayer }] = await Promise.all([
    import('effect'),
    import('../../../lib/browser.js'),
    import('@effect/platform-node/NodeServices'),
  ]);
  await Effect.runPromise(openBrowser(url).pipe(Effect.provide(nodeServicesLayer)));
}
