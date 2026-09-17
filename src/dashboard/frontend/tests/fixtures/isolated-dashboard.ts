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
 *   - a port that is never 3011. `shouldRefuseHostDashboardPort` only refuses
 *     when the port equals the host's configured `api_port`, so a high port is
 *     allowed by design and cannot collide with the live dashboard.
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

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface IsolatedDashboard {
  baseUrl: string;
  home: string;
  stop: () => Promise<void>;
}

// ESM: no __dirname here.
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../../..');
const BOOT_TIMEOUT_MS = 120_000;

/** A high port, chosen per run so two suites can never collide. */
function pickPort(): number {
  return 39_000 + Math.floor(Math.random() * 900);
}

async function waitForHealth(baseUrl: string, child: ChildProcess, logPath: string): Promise<void> {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `Fixture dashboard exited early (code ${child.exitCode}).\n${readLog(logPath)}`,
      );
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Fixture dashboard did not become healthy.\n${readLog(logPath)}`);
}

function readLog(logPath: string): string {
  try {
    return readFileSync(logPath, 'utf-8').split('\n').slice(-40).join('\n');
  } catch {
    return '(no server log)';
  }
}

/**
 * Boot a dashboard nothing else shares. Always `await stop()` in teardown —
 * a leaked server holds its port and its temp home for the life of the machine.
 */
export async function startIsolatedDashboard(): Promise<IsolatedDashboard> {
  const home = mkdtempSync(join(tmpdir(), 'overdeck-e2e-home-'));
  const port = pickPort();
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
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const chunks: string[] = [];
  child.stdout?.on('data', (c: Buffer) => chunks.push(c.toString()));
  child.stderr?.on('data', (c: Buffer) => chunks.push(c.toString()));

  const stop = async (): Promise<void> => {
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
    rmSync(home, { recursive: true, force: true });
  };

  try {
    await waitForHealth(baseUrl, child, logPath);
  } catch (err) {
    // Surface the server's own output; a boot failure is otherwise mute.
    // eslint-disable-next-line no-console
    console.error(chunks.join('').split('\n').slice(-40).join('\n'));
    await stop();
    throw err;
  }

  return { baseUrl, home, stop };
}
