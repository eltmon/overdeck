import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  restartDashboard,
  type PlatformConfig,
  type StageError,
} from '../../../src/lib/platform-lifecycle.js';

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function reserveEphemeralPort(): Promise<number> {
  const reservation = createServer();
  await listen(reservation, 0);
  const address = reservation.address();
  if (!address || typeof address === 'string') throw new Error('expected TCP address');
  await close(reservation);
  return address.port;
}

describe('dashboard restart with a live port squatter', () => {
  let server: Server | null = null;
  let tempDir: string;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(0);
    tempDir = mkdtempSync(join(tmpdir(), 'overdeck-squatter-'));
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (server?.listening) await close(server);
    server = null;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('rejects a wrong-pid responder while leaving the squatter reachable', async () => {
    const port = await reserveEphemeralPort();
    const expectedPid = process.pid + 100_000;
    let requests = 0;
    server = createServer((request, response) => {
      requests += 1;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        status: 'ok',
        repoRoot: '/expected/repo',
        mode: 'primary',
        pid: process.pid,
      }));
    });
    const stop = vi.fn();
    const config: PlatformConfig = {
      dashboardPort: port,
      dashboardApiPort: port,
      traefikEnabled: false,
      traefikDomain: 'overdeck.localhost',
      traefikDir: tempDir,
    };

    const restart = Effect.runPromise(restartDashboard(
      config,
      async () => {
        await listen(server!, port);
        return { stop, pid: async () => expectedPid };
      },
      {
        healthTimeoutMs: 200,
        expectedIdentity: { repoRoot: '/expected/repo', mode: 'primary' },
        eaddrinuseLogPath: join(tempDir, 'dashboard.log'),
      },
    ));
    const rejection = expect(restart).rejects.toSatisfy((error: StageError) =>
      error.failure.reason.includes(`pid ${process.pid}`) &&
      error.failure.reason.includes(`pid ${expectedPid}`) &&
      error.failure.recovery === 'dashboard-left-running');
    while (requests === 0) {
      await new Promise<void>(resolve => setImmediate(resolve));
    }

    await vi.advanceTimersByTimeAsync(300);
    await rejection;
    expect(stop).not.toHaveBeenCalled();

    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(response.ok).toBe(true);
    await expect(response.json()).resolves.toMatchObject({ pid: process.pid });
  });

  it('accepts the same real responder when its pid matches the spawn handle', async () => {
    const port = await reserveEphemeralPort();
    server = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        status: 'ok',
        repoRoot: '/expected/repo',
        mode: 'primary',
        pid: process.pid,
      }));
    });
    const config: PlatformConfig = {
      dashboardPort: port,
      dashboardApiPort: port,
      traefikEnabled: false,
      traefikDomain: 'overdeck.localhost',
      traefikDir: tempDir,
    };

    await expect(Effect.runPromise(restartDashboard(
      config,
      async () => {
        await listen(server!, port);
        return { stop: vi.fn(), pid: async () => process.pid };
      },
      {
        expectedIdentity: { repoRoot: '/expected/repo', mode: 'primary' },
        eaddrinuseLogPath: join(tempDir, 'dashboard.log'),
      },
    ))).resolves.toEqual({ ownershipVerified: true, spawnedPid: process.pid });
  });
});
