/**
 * PAN-3964 FR-7: `/api/flywheel/*` is a derived read surface plus thin
 * wrappers over the flywheel actions. The lib is mocked; this checks the
 * route wiring, the typed-error mapping, and the origin gate.
 */

import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { _resetInternalTokenCacheForTests } from '../../../../lib/internal-token.js';

const mocks = vi.hoisted(() => ({
  deriveFlywheelStatus: vi.fn(),
  readFlywheelRun: vi.fn(),
  resolveFlywheelProjectRoot: vi.fn(),
  readFlywheelStateFile: vi.fn(),
  readFlywheelReportFile: vi.fn(),
  computeSubstrateStats: vi.fn(),
  startFlywheel: vi.fn(),
  pauseFlywheel: vi.fn(),
  resumeFlywheel: vi.fn(),
  stopFlywheel: vi.fn(),
  abortFlywheel: vi.fn(),
  requestFlywheelReport: vi.fn(),
}));

vi.mock('../../../../lib/flywheel/derive-status.js', () => ({
  deriveFlywheelStatus: mocks.deriveFlywheelStatus,
  readFlywheelRun: mocks.readFlywheelRun,
  resolveFlywheelProjectRoot: mocks.resolveFlywheelProjectRoot,
}));
vi.mock('../../../../lib/flywheel/files.js', () => ({
  readFlywheelStateFile: mocks.readFlywheelStateFile,
  readFlywheelReportFile: mocks.readFlywheelReportFile,
}));
vi.mock('../../../../lib/flywheel/substrate-stats.js', () => ({ computeSubstrateStats: mocks.computeSubstrateStats }));
vi.mock('../../../../lib/flywheel/actions.js', () => ({
  startFlywheel: mocks.startFlywheel,
  pauseFlywheel: mocks.pauseFlywheel,
  resumeFlywheel: mocks.resumeFlywheel,
  stopFlywheel: mocks.stopFlywheel,
  abortFlywheel: mocks.abortFlywheel,
  requestFlywheelReport: mocks.requestFlywheelReport,
}));

const { flywheelRouteLayer } = await import('../flywheel.js');
const { FlywheelAlreadyRunning, FlywheelNotRunning, FlywheelPausedExists } = await import('../../../../lib/flywheel/errors.js');

interface RouteResult {
  status: number;
  body: unknown;
}

async function request(path: string, init: RequestInit = {}): Promise<RouteResult> {
  const req = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`, init));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(flywheelRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, req),
      ),
    ),
  );
  const body = response.body as { body?: Uint8Array } | null;
  const text = body?.body ? new TextDecoder().decode(body.body) : '{}';
  return { status: response.status, body: JSON.parse(text) };
}

/** An internal-token POST bypasses the browser origin/CSRF gate. */
function trustedPost(body: unknown = {}): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-overdeck-internal-token': 'test-dashboard-token' },
    body: JSON.stringify(body),
  };
}

describe('/api/flywheel routes (PAN-3964 FR-7)', () => {
  beforeEach(() => {
    process.env.OVERDECK_INTERNAL_TOKEN = 'test-dashboard-token';
    _resetInternalTokenCacheForTests();
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.resolveFlywheelProjectRoot.mockResolvedValue({ projectRoot: '/repos/overdeck', planHome: '/repos/plan' });
  });

  afterEach(() => {
    delete process.env.OVERDECK_INTERNAL_TOKEN;
    _resetInternalTokenCacheForTests();
  });

  it('GET /status returns the derived status', async () => {
    mocks.deriveFlywheelStatus.mockResolvedValue({ run: 'idle', lastTick: null });
    await expect(request('/api/flywheel/status')).resolves.toEqual({ status: 200, body: { run: 'idle', lastTick: null } });
  });

  it('GET /state and /report read the plan-home files', async () => {
    mocks.readFlywheelStateFile.mockResolvedValue({ exists: true, path: '.pan/flywheel/state.md', content: '# s', lastModified: 'x' });
    mocks.readFlywheelReportFile.mockResolvedValue({ exists: false, path: '.pan/flywheel/report.md', content: null, lastModified: null });
    expect((await request('/api/flywheel/state')).body).toMatchObject({ exists: true, content: '# s' });
    expect((await request('/api/flywheel/report')).body).toMatchObject({ exists: false });
    expect(mocks.readFlywheelStateFile).toHaveBeenCalledWith('/repos/plan');
    expect(mocks.readFlywheelReportFile).toHaveBeenCalledWith('/repos/plan');
  });

  it('GET /stats passes ?window= and rejects a bad window', async () => {
    mocks.computeSubstrateStats.mockResolvedValue({ window: { days: 7 } });
    await expect(request('/api/flywheel/stats?window=7')).resolves.toEqual({ status: 200, body: { window: { days: 7 } } });
    expect(mocks.computeSubstrateStats).toHaveBeenCalledWith({ projectPath: '/repos/overdeck', windowDays: 7 });
    expect((await request('/api/flywheel/stats?window=abc')).status).toBe(400);
  });

  it.each(['start', 'pause', 'resume', 'stop', 'abort', 'report'])('POST /%s rejects an untrusted origin with 403', async (verb) => {
    const result = await request(`/api/flywheel/${verb}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: '{}',
    });
    expect(result.status).toBe(403);
    expect(mocks.startFlywheel).not.toHaveBeenCalled();
    expect(mocks.pauseFlywheel).not.toHaveBeenCalled();
  });

  it('POST /start passes the body and maps a running flywheel to 409', async () => {
    mocks.startFlywheel.mockResolvedValue({ session: 'conv-flywheel' });
    await expect(request('/api/flywheel/start', trustedPost({ orders: 'book-1', fresh: true }))).resolves.toEqual({
      status: 200, body: { session: 'conv-flywheel' },
    });
    expect(mocks.startFlywheel).toHaveBeenCalledWith({ orders: 'book-1', fresh: true });

    mocks.startFlywheel.mockRejectedValue(new FlywheelAlreadyRunning());
    expect((await request('/api/flywheel/start', trustedPost())).status).toBe(409);
    mocks.startFlywheel.mockRejectedValue(new FlywheelPausedExists());
    expect((await request('/api/flywheel/start', trustedPost())).status).toBe(409);
    expect((await request('/api/flywheel/start', trustedPost({ fresh: 'yes' }))).status).toBe(400);
  });

  it('POST /pause, /abort, /resume, /report call their actions; not-running is 404', async () => {
    mocks.pauseFlywheel.mockResolvedValue(undefined);
    await expect(request('/api/flywheel/pause', trustedPost())).resolves.toEqual({ status: 200, body: { success: true } });
    mocks.abortFlywheel.mockResolvedValue(undefined);
    expect((await request('/api/flywheel/abort', trustedPost())).status).toBe(200);
    mocks.resumeFlywheel.mockResolvedValue({ session: 'conv-flywheel' });
    expect((await request('/api/flywheel/resume', trustedPost())).status).toBe(200);
    mocks.requestFlywheelReport.mockRejectedValue(new FlywheelNotRunning());
    expect((await request('/api/flywheel/report', trustedPost())).status).toBe(404);
  });

  it('POST /stop answers 202 and runs the graceful stop in the background', async () => {
    mocks.readFlywheelRun.mockResolvedValue({ run: 'running' });
    mocks.stopFlywheel.mockResolvedValue({ reportWritten: true });
    await expect(request('/api/flywheel/stop', trustedPost({ timeoutMs: 1000 }))).resolves.toEqual({ status: 202, body: { stopping: true } });
    expect(mocks.stopFlywheel).toHaveBeenCalledWith({ timeoutMs: 1000 });

    mocks.readFlywheelRun.mockResolvedValue({ run: 'paused' });
    expect((await request('/api/flywheel/stop', trustedPost())).status).toBe(404);
  });
});
