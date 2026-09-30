/**
 * PAN-3762 W2.7: `pan devices list|revoke`. Revoke goes through the dashboard
 * route; with the dashboard down it revokes in the registry directly; an
 * unknown id exits 1. The dashboard is a mocked fetch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/config.js', () => ({ getDashboardApiUrl: () => 'http://localhost:3011' }));
vi.mock('../../../src/lib/internal-token.js', () => ({
  ensureInternalToken: () => 'test-internal-token',
  INTERNAL_TOKEN_HEADER: 'x-overdeck-internal-token',
}));
vi.mock('../../../src/cli/exit.js', () => ({
  exitCli: async (code: number) => { throw new Error(`exit ${code}`); },
}));
const revokeAccessToken = vi.fn();
const listAccessTokens = vi.fn();
vi.mock('../../../src/lib/access-tokens.js', () => ({
  revokeAccessToken: (...args: unknown[]) => revokeAccessToken(...args),
  listAccessTokens: () => listAccessTokens(),
}));

const { runDevicesList, runDevicesRevoke } = await import('../../../src/cli/commands/pair.js');

const DEVICE = { id: 'dev-1', name: 'phone', createdAt: '2026-09-29T12:00:00.000Z', lastUsedAt: null, revokedAt: null };
let stdout: string[];
let stderr: string[];
const fetchMock = vi.fn();

function answer(status: number, body: unknown): void {
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

beforeEach(() => {
  stdout = [];
  stderr = [];
  fetchMock.mockReset();
  revokeAccessToken.mockReset();
  listAccessTokens.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { stdout.push(args.join(' ')); });
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { stderr.push(args.join(' ')); });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('pan devices (PAN-3762)', () => {
  it('lists devices as a table and as JSON', async () => {
    answer(200, { devices: [DEVICE] });
    await runDevicesList({});
    expect(stdout.join('\n')).toMatch(/ID\s+NAME\s+CREATED\s+LAST USED\s+REVOKED/);
    expect(stdout.join('\n')).toContain('dev-1');

    stdout = [];
    answer(200, { devices: [DEVICE] });
    await runDevicesList({ json: true });
    expect(JSON.parse(stdout[0]!)).toEqual([DEVICE]);
  });

  it('revokes through DELETE /api/devices/:id with the internal token', async () => {
    answer(200, { ok: true, device: { ...DEVICE, revokedAt: '2026-09-29T12:05:00.000Z' } });
    await runDevicesRevoke('dev-1');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3011/api/devices/dev-1');
    expect(init.method).toBe('DELETE');
    expect((init.headers as Record<string, string>)['x-overdeck-internal-token']).toBe('test-internal-token');
    expect(revokeAccessToken).not.toHaveBeenCalled();
    expect(stdout.join('\n')).toContain('Revoked device "phone"');
  });

  it('revokes in the registry directly when the dashboard is unreachable', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    listAccessTokens.mockResolvedValue([{ ...DEVICE, kind: 'device', scopes: ['admin'] }]);
    revokeAccessToken.mockResolvedValue({ ...DEVICE, revokedAt: 'now' });

    await runDevicesRevoke('dev-1');
    expect(revokeAccessToken).toHaveBeenCalledWith('dev-1');
    expect(stdout.join('\n')).toContain('Dashboard not running; revoked in the registry. No live connections were open.');
  });

  it('exits 1 for an unknown id, through the route and through the fallback', async () => {
    answer(404, { error: 'no paired device with id nope' });
    await expect(runDevicesRevoke('nope')).rejects.toThrow('exit 1');

    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    listAccessTokens.mockResolvedValue([]);
    await expect(runDevicesRevoke('nope')).rejects.toThrow('exit 1');
    expect(revokeAccessToken).not.toHaveBeenCalled();
    expect(stderr.join('\n')).toContain('No paired device with id nope.');
  });
});
