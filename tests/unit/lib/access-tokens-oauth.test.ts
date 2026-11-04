/**
 * PAN-4945 WI-1: OAuth access tokens in the access-token registry — the
 * oauthClientId, oauthFamilyId and expiresAt fields (valid only on kind:
 * 'token', all together, never with the agent fields), expiry in the
 * snapshot readers, the create-time scope ceiling, the prune of ended OAuth
 * records, and the credential's oauthClientId.
 *
 * Only `Date` is faked: real file I/O keeps real timers.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Registry = typeof import('../../../src/lib/access-tokens.js');
type DashboardAuth = typeof import('../../../src/dashboard/server/routes/dashboard-auth.js');

let registry: Registry;
let home: string;
const originalHome = process.env.OVERDECK_HOME;
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-04T12:00:00.000Z');
const HASH = 'a'.repeat(64);
const CLIENT_ID = `odc_${'1'.repeat(32)}`;
const FAMILY_ID = '2'.repeat(32);

function oauthInput(expiresAt: string) {
  return { name: 'Claude (OAuth)', scopes: ['read:state' as const, 'tell' as const], kind: 'token' as const, oauthClientId: CLIENT_ID, oauthFamilyId: FAMILY_ID, expiresAt };
}

function baseRecord(overrides: Record<string, unknown>): Record<string, unknown> {
  return { id: 'r1', name: 'x', scopes: ['tell'], tokenHash: HASH, createdAt: '2026-10-01T00:00:00.000Z', lastUsedAt: null, ...overrides };
}

async function writeRegistryFile(tokens: unknown[]): Promise<void> {
  await writeFile(join(home, 'access-tokens.json'), JSON.stringify({ v: 1, tokens }), { mode: 0o600 });
}

async function readFileRecords(): Promise<Array<{ id: string }>> {
  return JSON.parse(await readFile(join(home, 'access-tokens.json'), 'utf8')).tokens;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  home = await mkdtemp(join(tmpdir(), 'pan-4945-tokens-'));
  process.env.OVERDECK_HOME = home;
  vi.resetModules();
  registry = await import('../../../src/lib/access-tokens.js');
});

afterEach(async () => {
  await registry._settleAccessTokenWritesForTests();
  registry._resetAccessTokensForTests();
  vi.useRealTimers();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('OAuth tokens in the access-token registry (PAN-4945)', () => {
  it('verifies an OAuth token until expiresAt, then refuses it while the fresh read still returns it', async () => {
    const expiresAt = new Date(NOW.getTime() + 30 * DAY_MS).toISOString();
    const { token, record } = await registry.createAccessToken(oauthInput(expiresAt));
    expect(record).toMatchObject({ kind: 'token', oauthClientId: CLIENT_ID, oauthFamilyId: FAMILY_ID, expiresAt });
    expect(registry.verifyAccessToken(token)).toMatchObject({ ok: true, record: { id: record.id } });
    expect(registry.listActiveRecordsOfKind('token').map((r) => r.id)).toEqual([record.id]);

    vi.setSystemTime(new Date(Date.parse(expiresAt)));
    expect(registry.verifyAccessToken(token)).toEqual({ ok: false });
    expect(registry.listActiveRecordsOfKind('token')).toEqual([]);
    await expect(registry.readActiveAccessTokenRecord(token)).resolves.toMatchObject({ id: record.id, expiresAt });
  });

  it('refuses OAuth fields on kind device, partial OAuth fields, and OAuth plus agent fields', async () => {
    const expiresAt = new Date(NOW.getTime() + DAY_MS).toISOString();
    await expect(registry.createAccessToken({ ...oauthInput(expiresAt), kind: 'device' })).rejects.toThrow(/kind: token only/);
    await expect(registry.createAccessToken({ name: 'p', scopes: ['tell'], kind: 'token', oauthClientId: CLIENT_ID, expiresAt })).rejects.toThrow(/needs oauthClientId, oauthFamilyId and expiresAt/);
    await expect(registry.createAccessToken({ ...oauthInput(expiresAt), oauthClientId: 'odc_short' })).rejects.toThrow(/needs oauthClientId/);
    await expect(registry.createAccessToken({ ...oauthInput(expiresAt), expiresAt: 'not a date' })).rejects.toThrow(/needs oauthClientId/);
    await expect(
      registry.createAccessToken({ ...oauthInput(expiresAt), agentId: 'agent-pan-4945', agentKind: 'agent', role: 'work' }),
    ).rejects.toThrow(/never with agent fields/);
    expect(registry.listActiveRecordsOfKind('token')).toEqual([]);
  });

  it.each(['admin', 'forward', 'read:settings', 'read:costs', 'read:events'] as const)('refuses an OAuth token carrying %s', async (scope) => {
    const expiresAt = new Date(NOW.getTime() + DAY_MS).toISOString();
    await expect(registry.createAccessToken({ ...oauthInput(expiresAt), scopes: ['read:state', scope] })).rejects.toThrow(
      'An OAuth token never carries admin, forward, read:settings, read:costs or read:events (PAN-4945)',
    );
  });

  it('treats a device record with oauthClientId as a corrupt file that accepts no token', async () => {
    const { token } = await registry.createAccessToken({ name: 'plain', scopes: ['tell'], kind: 'token' });
    const records = await readFileRecords();
    await writeRegistryFile([
      ...records,
      baseRecord({ id: 'r2', kind: 'device', oauthClientId: CLIENT_ID, oauthFamilyId: FAMILY_ID, expiresAt: '2026-12-01T00:00:00.000Z' }),
    ]);
    await expect(registry.refreshAccessTokens()).rejects.toThrow(/unexpected shape/);
    expect(registry.verifyAccessToken(token)).toEqual({ ok: false });
  });

  it('treats a connector record with OAuth fields as a corrupt file', async () => {
    await writeRegistryFile([
      baseRecord({ kind: 'connector', connectorKey: 'c'.repeat(64), clientId: '123e4567-e89b-42d3-a456-426614174000', oauthClientId: CLIENT_ID, oauthFamilyId: FAMILY_ID, expiresAt: '2026-12-01T00:00:00.000Z' }),
    ]);
    await expect(registry.refreshAccessTokens()).rejects.toThrow(/unexpected shape/);
  });

  it('prunes OAuth records expired more than olderThanMs ago, and revoked ones only past the 90-day refresh window', async () => {
    const ago = (days: number) => new Date(NOW.getTime() - days * DAY_MS).toISOString();
    const oauth = { kind: 'token', oauthClientId: CLIENT_ID, oauthFamilyId: FAMILY_ID };
    await writeRegistryFile([
      baseRecord({ id: 'expired-8d', ...oauth, expiresAt: ago(8) }),
      baseRecord({ id: 'expired-6d', ...oauth, expiresAt: ago(6) }),
      baseRecord({ id: 'revoked-9d-expires-later', ...oauth, revokedAt: ago(9), expiresAt: ago(-20) }),
      baseRecord({ id: 'revoked-60d-expired-30d', ...oauth, revokedAt: ago(60), expiresAt: ago(30) }),
      baseRecord({ id: 'revoked-96d', ...oauth, revokedAt: ago(96), expiresAt: ago(66) }),
      baseRecord({ id: 'revoked-98d', ...oauth, revokedAt: ago(98), expiresAt: ago(68) }),
      baseRecord({ id: 'plain-revoked-30d', kind: 'token', revokedAt: ago(30) }),
    ]);
    await expect(registry.pruneEndedAccessTokens(7 * DAY_MS)).resolves.toBe(2);
    // A revoked OAuth record outlives its sign-in's 90-day refresh window, so a refresh can still see the revocation.
    expect((await readFileRecords()).map((r) => r.id)).toEqual(['expired-6d', 'revoked-9d-expires-later', 'revoked-60d-expired-30d', 'revoked-96d', 'plain-revoked-30d']);
  });

  it('resolves an OAuth Bearer token to a token credential naming its client', async () => {
    const auth: DashboardAuth = await import('../../../src/dashboard/server/routes/dashboard-auth.js');
    const expiresAt = new Date(NOW.getTime() + DAY_MS).toISOString();
    const { token, record } = await registry.createAccessToken(oauthInput(expiresAt));
    expect(auth.resolveDashboardCredential({ authorization: `Bearer ${token}` })).toEqual({
      kind: 'token', tokenId: record.id, scopes: ['read:state', 'tell'], oauthClientId: CLIENT_ID,
    });
  });
});
