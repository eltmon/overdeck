/**
 * An isolated dashboard server for end-to-end tests (PAN-3836 WI-8, NFR-8).
 *
 * Every other spec in this directory points at the operator's live dashboard on
 * 3011. That is fine for read-only UI checks and completely unacceptable here:
 * these journeys clone repositories and register projects, so running them
 * against the live instance would write into the operator's real
 * `projects.yaml` and create real workspaces.
 *
 * So each run gets its own server:
 *
 *   - a throwaway `OVERDECK_HOME` under the system temp directory, which is why
 *     `/api/registered-projects` starts empty and anything these tests create is
 *     thrown away with it;
 *   - `OVERDECK_DISABLE_DEACON=1`, so no second Deacon races the host's — two
 *     deacons sharing one home is a known way to make agents thrash
 *     (`single-deacon-invariant`);
 *   - an OS-assigned port, probed free at the moment of the call and never
 *     3011 (the operator's host dashboard port); health is accepted only from
 *     the spawned child's own PID, and a boot that loses the port race is
 *     retried once on a fresh port with the same home.
 *
 * The built server is used deliberately: `dist/dashboard/server.js` under Node,
 * never Bun and never tsx, for the reasons in the dashboard-node22-only rule.
 *
 * **`npm run build` is a prerequisite, not an optimization.** The fixture serves
 * the *built* frontend out of `dist`, so with a stale build these journeys drive
 * the previous version of the page and fail on selectors that exist only in
 * source. That is a confusing failure to debug from the assertion alone, so it
 * is called out here: build first, then run this spec.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface IsolatedDashboard {
  baseUrl: string;
  port: number;
  home: string;
  /** `keepHome` leaves the temp home in place so the server can restart on it. */
  stop: (opts?: { keepHome?: boolean }) => Promise<void>;
}

export interface IsolatedDashboardOptions {
  /** Reuse a port — restart a stopped fixture where the open page expects it. */
  port?: number;
  /** Reuse a home from a server stopped with `keepHome` (PAN-4279). */
  home?: string;
  /** Extra environment, merged last (PAN-4437: a fake `HOME`, a stub on `PATH`). */
  env?: Record<string, string>;
}

// ESM: no __dirname here.
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../../..');
const BOOT_TIMEOUT_MS = 120_000;

/** The operator's live dashboard port; an isolated fixture must never bind it. */
const HOST_DASHBOARD_PORT = 3011;
const MAX_PORT_PROBES = 5;

/** One OS-assigned port: listen on 0, read the port, release it. */
function probeFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolvePort(port));
    });
  });
}

/**
 * A port the OS reports free right now, never the host dashboard's 3011.
 * The port is released before the child binds it, so a tiny race remains;
 * `startIsolatedDashboard` covers it with one retry on EADDRINUSE.
 */
export interface PickPortOptions {
  /** Test seam: where candidate ports come from. */
  probe?: () => Promise<number>;
  /** Ports to skip, e.g. the one a failed first boot just lost. */
  exclude?: readonly number[];
}

export async function pickPort({ probe = probeFreePort, exclude = [] }: PickPortOptions = {}): Promise<number> {
  for (let attempt = 0; attempt < MAX_PORT_PROBES; attempt += 1) {
    const port = await probe();
    if (port > 0 && port !== HOST_DASHBOARD_PORT && !exclude.includes(port)) return port;
  }
  throw new Error(`pickPort: no usable free port after ${MAX_PORT_PROBES} probes`);
}

export interface HealthWaitChild {
  readonly pid?: number;
  readonly exitCode: number | null;
}

export async function waitForHealth(
  baseUrl: string,
  child: HealthWaitChild,
  opts: { logPath?: string; timeoutMs?: number; pollMs?: number } = {},
): Promise<void> {
  const { logPath, timeoutMs = BOOT_TIMEOUT_MS, pollMs = 500 } = opts;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `Fixture dashboard exited early (code ${child.exitCode}).\n${logPath ? readLog(logPath) : ''}`,
      );
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) {
        const body = (await response.json()) as { pid?: unknown };
        // Another process may hold this port (the probe released it before spawn).
        if (body.pid === child.pid) return;
      }
    } catch {
      // Not listening yet, or not JSON.
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`Fixture dashboard did not become healthy.\n${logPath ? readLog(logPath) : ''}`);
}

function readLog(logPath: string): string {
  try {
    return readFileSync(logPath, 'utf-8').split('\n').slice(-40).join('\n');
  } catch {
    return '(no server log)';
  }
}

/**
 * True when the child's captured output holds the fatal bind error. The
 * server's transient `HTTP bind failed with EADDRINUSE; retry N/3` warnings
 * do not match: a child can log one and still bind.
 */
export function isAddressInUseOutput(output: string): boolean {
  return /listen EADDRINUSE: address already in use/.test(output);
}

class FixtureBootError extends Error {
  constructor(message: string, readonly output: string, readonly exited: boolean) {
    super(message);
  }
}

/** Boot one child on `port`, failing with a `FixtureBootError` (home kept) on any boot problem. */
async function bootOnce(
  home: string,
  port: number,
  env: Record<string, string> | undefined,
): Promise<IsolatedDashboard> {
  const baseUrl = `http://127.0.0.1:${port}`;
  const logPath = join(home, 'server.log');

  const child = spawn('node', [join(REPO_ROOT, 'dist/dashboard/server.js')], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      API_PORT: String(port),
      OVERDECK_HOME: home,
      // Belt and braces: no second Deacon, no auto-merge, no tracker polling.
      OVERDECK_DISABLE_DEACON: '1',
      OVERDECK_DISABLE_AUTO_MERGE: '1',
      // fix10: never let a UAT host reach a Herdr session.
      OVERDECK_TERMINAL_BACKEND: 'tmux',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const closed = new Promise<void>((done) => child.once('close', () => done()));

  const chunks: string[] = [];
  child.stdout?.on('data', (c: Buffer) => chunks.push(c.toString()));
  child.stderr?.on('data', (c: Buffer) => chunks.push(c.toString()));

  const stop = async (stopOpts: { keepHome?: boolean } = {}): Promise<void> => {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise<void>((done) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          done();
        }, 5_000);
        child.once('close', () => {
          clearTimeout(timer);
          done();
        });
      });
    }
    if (!stopOpts.keepHome) rmSync(home, { recursive: true, force: true });
  };

  try {
    await waitForHealth(baseUrl, child, { logPath });
  } catch (err) {
    // Wait for stdio to drain so the captured output is complete before we
    // read it; `exit` (which sets exitCode) can fire before the last chunk.
    await Promise.race([closed, new Promise((r) => setTimeout(r, 2_000))]);
    await stop({ keepHome: true });
    const exited = child.exitCode !== null || child.signalCode !== null;
    throw new FixtureBootError(err instanceof Error ? err.message : String(err), chunks.join(''), exited);
  }

  return { baseUrl, port, home, stop };
}

/**
 * Boot a dashboard nothing else shares. Always `await stop()` in teardown —
 * a leaked server holds its port and its temp home for the life of the machine.
 */
export async function startIsolatedDashboard(opts: IsolatedDashboardOptions = {}): Promise<IsolatedDashboard> {
  const home = opts.home ?? mkdtempSync(join(tmpdir(), 'overdeck-e2e-home-'));
  const explicitPort = opts.port !== undefined;
  const firstPort = opts.port ?? (await pickPort());
  try {
    try {
      return await bootOnce(home, firstPort, opts.env);
    } catch (err) {
      // A fresh port only when we chose the first one: an explicit port is a
      // restart the open page depends on (pan-4279-degraded-mode.spec.ts).
      const lostPort =
        err instanceof FixtureBootError && err.exited && isAddressInUseOutput(err.output);
      if (explicitPort || !lostPort) throw err;
      return await bootOnce(home, await pickPort({ exclude: [firstPort] }), opts.env);
    }
  } catch (err) {
    if (err instanceof FixtureBootError) {
      // Surface the server's own output; a boot failure is otherwise mute.
      // eslint-disable-next-line no-console
      console.error(err.output.split('\n').slice(-40).join('\n'));
    }
    rmSync(home, { recursive: true, force: true });
    throw err;
  }
}
