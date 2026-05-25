import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpRouter } from 'effect/unstable/http';

import { workspacesRouteLayer } from '../workspaces.js';
import { AutoMergeScheduler, type AutoMergeSchedulerDeps } from '../../services/auto-merge-scheduler.js';
import {
  cancelPendingAutoMerge,
  getAutoMergeStatus,
  getPendingAutoMerges,
  markAutoMergeAborted,
  markAutoMergeExecuted,
  markAutoMergeExecuting,
  markAutoMergeFailed,
  schedulePendingAutoMerge,
} from '../../../../lib/database/auto-merge-db.js';
import { resetDatabase } from '../../../../lib/database/index.js';
import type { NormalizedAutoMergeConfig } from '../../../../lib/config-yaml.js';
import type { ReviewStatus } from '../../../../lib/review-status.js';
import { INTERNAL_TOKEN_HEADER, _resetInternalTokenCacheForTests } from '../../../../lib/internal-token.js';

let testHome: string;
let server: Server | null = null;
let routeDispose: (() => Promise<void>) | null = null;
let baseUrl: string;

const triggerMergeMock = vi.fn();

function autoMergeConfig(): NormalizedAutoMergeConfig {
  return {
    enabled: true,
    cooldownMinutes: 5,
    maxStaleMinutes: 60,
    requireGitHubCiPassing: false,
    requireAllCommitStatusChecks: false,
    requireNoBlockerLabels: [],
  };
}

function reviewStatus(issueId: string): ReviewStatus {
  return {
    issueId,
    reviewStatus: 'passed',
    testStatus: 'passed',
    updatedAt: '2026-05-23T12:00:00.000Z',
    readyForMerge: true,
    mergeStatus: 'pending',
    prUrl: null,
  };
}

async function readRequestBody(request: IncomingMessage): Promise<Buffer | undefined> {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;

  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function startHttpRouteServer(): Promise<void> {
  const { handler, dispose } = HttpRouter.toWebHandler(workspacesRouteLayer, { disableLogger: true });
  routeDispose = dispose;

  server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    try {
      const body = await readRequestBody(request);
      const webResponse = await handler(new Request(`http://127.0.0.1${request.url ?? '/'}`, {
        method: request.method,
        headers: request.headers as HeadersInit,
        body,
      }));

      response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers.entries()));
      response.end(Buffer.from(await webResponse.arrayBuffer()));
    } catch (error) {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server?.once('error', reject);
    server?.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  process.env.API_PORT = String(address.port);
}

async function stopHttpRouteServer(): Promise<void> {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => error ? reject(error) : resolve());
    });
    server = null;
  }
  if (routeDispose) {
    await routeDispose();
    routeDispose = null;
  }
}

async function scheduleViaScheduler(issueId: string): Promise<void> {
  const deps: AutoMergeSchedulerDeps = {
    now: () => new Date('2026-05-23T12:00:00.000Z'),
    setTimer: (fn, delayMs) => setTimeout(fn, delayMs),
    clearTimer: (timer) => clearTimeout(timer),
    getConfig: vi.fn().mockResolvedValue(autoMergeConfig()),
    getStatus: vi.fn().mockResolvedValue(reviewStatus(issueId)),
    getPendingRows: getPendingAutoMerges,
    schedulePending: schedulePendingAutoMerge,
    cancelPending: cancelPendingAutoMerge,
    markExecuting: markAutoMergeExecuting,
    markExecuted: markAutoMergeExecuted,
    markAborted: markAutoMergeAborted,
    markFailed: markAutoMergeFailed,
    getLabels: vi.fn().mockResolvedValue([]),
    getGitHubCiStatus: vi.fn().mockResolvedValue({ passing: true }),
    getCommitStatusChecks: vi.fn().mockResolvedValue({ passing: true }),
    triggerMerge: triggerMergeMock,
  };
  const scheduler = new AutoMergeScheduler(deps);
  try {
    await expect(scheduler.maybeSchedule(issueId, 'pan')).resolves.toBe(true);
  } finally {
    scheduler.stop();
  }
}

async function postCancel(
  issueId: string,
  headers: Record<string, string> = { [INTERNAL_TOKEN_HEADER]: 'test-token' },
): Promise<{ status: number; body: { cancelled?: boolean; error?: string } }> {
  const response = await fetch(`${baseUrl}/api/issues/${issueId}/merge/cancel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: baseUrl, ...headers },
    body: JSON.stringify({ reason: 'integration-test' }),
  });
  return { status: response.status, body: await response.json() };
}

beforeEach(async () => {
  testHome = join(tmpdir(), `pan-1418-auto-merge-cancel-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testHome, { recursive: true });
  process.env.PANOPTICON_HOME = testHome;
  process.env.PANOPTICON_INTERNAL_TOKEN = 'test-token';
  _resetInternalTokenCacheForTests();
  triggerMergeMock.mockReset();
  await startHttpRouteServer();
});

afterEach(async () => {
  await stopHttpRouteServer();
  resetDatabase();
  delete process.env.API_PORT;
  delete process.env.PANOPTICON_HOME;
  delete process.env.PANOPTICON_INTERNAL_TOKEN;
  _resetInternalTokenCacheForTests();
  rmSync(testHome, { recursive: true, force: true });
});

describe('POST /api/issues/:issueId/merge/cancel', () => {
  it('rejects requests that only spoof a trusted origin', async () => {
    await scheduleViaScheduler('PAN-2000');

    const result = await postCancel('PAN-2000', {});

    expect(result).toEqual({ status: 401, body: { error: 'unauthorized' } });
    expect(getAutoMergeStatus('PAN-2000')).toMatchObject({ status: 'pending' });
    expect(triggerMergeMock).not.toHaveBeenCalled();
  });

  it('cancels a pending auto-merge row through real HTTP and SQLite', async () => {
    await scheduleViaScheduler('PAN-2001');

    const result = await postCancel('PAN-2001');

    expect(result).toEqual({ status: 200, body: { cancelled: true } });
    expect(getAutoMergeStatus('PAN-2001')).toMatchObject({
      status: 'cancelled',
      cancelReason: 'integration-test',
    });
    expect(triggerMergeMock).not.toHaveBeenCalled();
  });

  it('returns false for a second cancel when no pending row remains', async () => {
    await scheduleViaScheduler('PAN-2002');
    await expect(postCancel('PAN-2002')).resolves.toMatchObject({ status: 200, body: { cancelled: true } });

    const result = await postCancel('PAN-2002');

    expect(result).toEqual({ status: 200, body: { cancelled: false } });
    expect(getAutoMergeStatus('PAN-2002')).toMatchObject({ status: 'cancelled' });
  });

  it('returns 409 when the auto-merge row is already executing', async () => {
    await scheduleViaScheduler('PAN-2003');
    expect(markAutoMergeExecuting('PAN-2003')).toBe(true);

    const result = await postCancel('PAN-2003');

    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ cancelled: false, error: 'Auto-merge already executing' });
    expect(getAutoMergeStatus('PAN-2003')).toMatchObject({ status: 'executing' });
  });
});
