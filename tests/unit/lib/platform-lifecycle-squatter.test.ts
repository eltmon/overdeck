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

// These tests deliberately run on REAL timers, against the project-wide rule that
// delay-based tests use `vi.useFakeTimers()`. Everything under test here is real
// I/O — a real `createServer()` on a real port, a real loopback `fetch`, real
// `lsof`/`ps` subprocesses — and `waitForDashboardHealthPromise` bounds that I/O
// with `Date.now()` and paces it with `sleep(pollIntervalMs)`. Faking the clock
// makes the poll loop advance only when the test advances it, so the test races
// the real HTTP round-trip it is waiting on: on a contended runner the body read
// lands after the last `advanceTimersByTimeAsync`, the next `sleep` is scheduled
// past a clock nobody will move again, and the test parks until vitest's timeout.
// That is PAN-3320 — it turned main red. Do not reintroduce fake timers here; the
// whole run costs one real 250ms poll interval.
describe('dashboard restart with a live port squatter', () => {
  let server: Server | null = null;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'overdeck-squatter-'));
  });

  afterEach(async () => {
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

    await rejection;
    expect(requests).toBeGreaterThan(0);
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
