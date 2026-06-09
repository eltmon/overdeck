import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { existsSyncMock, readFileSyncMock, signMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(() => true),
  readFileSyncMock: vi.fn((path: string) => {
    if (path.endsWith('app-id')) return '12345';
    if (path.endsWith('installation-id')) return '67890';
    if (path.endsWith('private-key.pem')) return 'private-key';
    return '';
  }),
  signMock: vi.fn(() => 'jwt-signature'),
}));

vi.mock('fs', () => ({
  existsSync: existsSyncMock,
  readFileSync: readFileSyncMock,
}));

vi.mock('crypto', () => ({
  createSign: vi.fn(() => ({
    update: vi.fn(),
    sign: signMock,
  })),
}));

import { getCiCheckRunsState } from '../../../src/lib/github-app.js';

describe('getCiCheckRunsState', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function loadState(checkRuns: Array<{ name: string; status: string; conclusion: string | null }>) {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'token', expires_at: '2026-06-10T00:00:00Z' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ check_runs: checkRuns }), { status: 200 }));

    return Effect.runPromise(getCiCheckRunsState('eltmon', 'panopticon-cli', 'abc123'));
  }

  it('returns green from check-runs only when at least one run succeeded and none are pending or failed', async () => {
    const state = await loadState([
      { name: 'build (22)', status: 'completed', conclusion: 'success' },
      { name: 'test', status: 'completed', conclusion: 'success' },
      { name: 'Mintlify Deployment', status: 'completed', conclusion: 'skipped' },
    ]);

    expect(state).toMatchObject({
      verdict: 'green',
      green: true,
      pending: false,
      failed: false,
      total: 3,
      successCount: 2,
      pendingCount: 0,
      failedCount: 0,
    });
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes('/commits/abc123/check-runs'))).toBe(true);
    expect(urls.some((url) => url.includes('/commits/abc123/status'))).toBe(false);
  });

  it('returns pending for incomplete runs and for commits with zero successful check-runs', async () => {
    await expect(loadState([
      { name: 'build (22)', status: 'completed', conclusion: 'success' },
      { name: 'test', status: 'in_progress', conclusion: null },
    ])).resolves.toMatchObject({ verdict: 'pending', green: false, pending: true, failed: false, pendingCount: 1 });

    await expect(loadState([])).resolves.toMatchObject({ verdict: 'pending', green: false, pending: true, failed: false, total: 0 });
  });

  it('returns red for failed, timed-out, cancelled, or action-required completed runs', async () => {
    await expect(loadState([
      { name: 'build (22)', status: 'completed', conclusion: 'success' },
      { name: 'test', status: 'completed', conclusion: 'timed_out' },
    ])).resolves.toMatchObject({ verdict: 'red', green: false, pending: false, failed: true, failedCount: 1 });

    await expect(loadState([
      { name: 'build (22)', status: 'completed', conclusion: 'cancelled' },
    ])).resolves.toMatchObject({ verdict: 'red', green: false, pending: false, failed: true, failedCount: 1 });
  });
});
