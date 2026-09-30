/**
 * PAN-2351 W8: `pan token create|list|revoke`. Create and list use the real
 * registry in a temporary OVERDECK_HOME; revoke goes through the dashboard
 * route (a mocked fetch) and falls back to the registry when it is down.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/config.js', () => ({ getDashboardApiUrl: () => 'http://localhost:3011' }));
vi.mock('../../../src/lib/internal-token.js', () => ({
  ensureInternalToken: () => 'test-internal-token',
  INTERNAL_TOKEN_HEADER: 'x-overdeck-internal-token',
}));
vi.mock('../../../src/cli/exit.js', () => ({
  exitCli: async (code: number) => { throw new Error(`exit ${code}`); },
}));

const { _resetAccessTokensForTests, _settleAccessTokenWritesForTests, createAccessToken } = await import('../../../src/lib/access-tokens.js');
const { runTokenCreate, runTokenList, runTokenRevoke } = await import('../../../src/cli/commands/token.js');

const originalHome = process.env.OVERDECK_HOME;
let home: string;
let stdout: string[];
let stderr: string[];
const fetchMock = vi.fn();

async function fileRecords(): Promise<Array<{ id: string; kind?: string; scopes: string[]; revokedAt?: string }>> {
  try {
    return JSON.parse(await readFile(join(home, 'access-tokens.json'), 'utf8')).tokens;
  } catch {
    return [];
  }
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-2351-token-cli-'));
  process.env.OVERDECK_HOME = home;
  _resetAccessTokensForTests();
  stdout = [];
  stderr = [];
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { stdout.push(args.join(' ')); });
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { stderr.push(args.join(' ')); });
});

afterEach(async () => {
  await _settleAccessTokenWritesForTests();
  _resetAccessTokensForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('pan token (PAN-2351)', () => {
  it('create writes a kind token record with the parsed scopes and prints the odk_ token once', async () => {
    await runTokenCreate('sidecar', { scopes: 'read:events, tell' });
    const records = await fileRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ kind: 'token', scopes: ['read:events', 'tell'] });
    expect(stdout.filter((line) => line.startsWith('odk_'))).toHaveLength(1);
    expect(stdout.join('\n')).toContain('This token is shown once. A running dashboard accepts it within 5 seconds.');
  });

  it('create --json prints { id, name, scopes, token }', async () => {
    await runTokenCreate('ci', { scopes: 'admin', json: true });
    const out = JSON.parse(stdout[0]!);
    expect(out).toEqual({ id: expect.any(String), name: 'ci', scopes: ['admin'], token: expect.stringMatching(/^odk_/) });
  });

  it('create --scopes write:all exits non-zero, names the valid set, and writes nothing', async () => {
    await expect(runTokenCreate('bad', { scopes: 'write:all' })).rejects.toThrow('exit 1');
    expect(stderr.join('\n')).toContain('write:all');
    expect(stderr.join('\n')).toContain('read:events, read:state, read:conversations, tell, operate, admin');
    expect(await fileRecords()).toEqual([]);
  });

  it('list --json prints only kind token records', async () => {
    const device = await createAccessToken({ name: 'phone', scopes: ['admin'], kind: 'device' });
    const token = await createAccessToken({ name: 'sidecar', scopes: ['read:events'], kind: 'token' });
    await runTokenList({ json: true });
    const listed = JSON.parse(stdout[0]!) as Array<{ id: string }>;
    expect(listed.map((record) => record.id)).toEqual([token.record.id]);
    expect(stdout[0]).not.toContain(device.record.id);
    expect(stdout[0]).not.toContain('tokenHash');
  });

  it('list prints a hint when there are no tokens', async () => {
    await runTokenList({});
    expect(stdout.join('\n')).toContain('No access tokens. Create one with `pan token create`.');
  });

  it('revoke goes through the dashboard route', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true, token: { id: 't-1', name: 'sidecar' }, closedConnections: 2 }), { status: 200 }));
    await runTokenRevoke('t-1');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3011/api/access-tokens/t-1');
    expect(init.method).toBe('DELETE');
    expect(stdout.join('\n')).toContain('closed 2 live connection(s)');
  });

  it('revoke with an unreachable dashboard sets revokedAt in the registry', async () => {
    const { record } = await createAccessToken({ name: 'sidecar', scopes: ['tell'], kind: 'token' });
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await runTokenRevoke(record.id);
    expect((await fileRecords()).find((r) => r.id === record.id)?.revokedAt).toEqual(expect.any(String));
    expect(stdout.join('\n')).toContain('Dashboard not running; revoked in the registry. No live connections were open.');
  });

  it('revoke of a device id exits non-zero and leaves the device active', async () => {
    const device = await createAccessToken({ name: 'phone', scopes: ['admin'], kind: 'device' });
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(runTokenRevoke(device.record.id)).rejects.toThrow('exit 1');
    expect((await fileRecords()).find((r) => r.id === device.record.id)?.revokedAt).toBeUndefined();

    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'no access token' }), { status: 404 }));
    await expect(runTokenRevoke(device.record.id)).rejects.toThrow('exit 1');
    expect(stderr.join('\n')).toContain(`No access token with id ${device.record.id}.`);
  });
});
