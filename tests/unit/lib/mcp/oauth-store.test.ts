/**
 * PAN-4945 WI-3: the `mcp-oauth.json` store door — empty on a missing file,
 * mode 0600 writes, D-10 pruning, refusal of a malformed file without
 * overwriting it, and serialized concurrent mutations.
 */
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  _resetMcpOAuthStoreForTests,
  mcpOAuthPath,
  mutateMcpOAuthData,
  pruneMcpOAuthData,
  readMcpOAuthData,
  type OAuthClientRecord,
  type OAuthFamilyRecord,
} from '../../../../src/lib/mcp/oauth-store.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const NOW = Date.parse('2026-11-04T12:00:00.000Z');
const at = (msBeforeNow: number) => new Date(NOW - msBeforeNow).toISOString();

let home: string;
const originalHome = process.env.OVERDECK_HOME;

function client(n: number, createdAt: string): OAuthClientRecord {
  return { clientId: `odc_${String(n).repeat(32).slice(0, 32)}`, name: `client ${n}`, redirectUris: ['http://127.0.0.1/cb'], createdAt, lastUsedAt: null };
}

function family(n: number, clientId: string, overrides: Partial<OAuthFamilyRecord> = {}): OAuthFamilyRecord {
  return {
    familyId: String(n).repeat(32).slice(0, 32),
    clientId,
    level: 'read',
    scopes: ['read:state', 'read:conversations'],
    refreshHash: 'a'.repeat(64),
    priorRefreshHashes: [],
    refreshExpiresAt: at(-90 * DAY_MS),
    accessTokenId: `token-${n}`,
    createdAt: at(DAY_MS),
    ...overrides,
  };
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-4945-store-'));
  process.env.OVERDECK_HOME = home;
});

afterEach(async () => {
  _resetMcpOAuthStoreForTests();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('the MCP OAuth store (PAN-4945 D-10)', () => {
  it('reads a missing file as empty and writes the file with mode 0600', async () => {
    await expect(readMcpOAuthData(NOW)).resolves.toEqual({ clients: [], families: [] });
    const added = client(1, at(HOUR_MS));
    await mutateMcpOAuthData(NOW, (data) => ({ data: { ...data, clients: [...data.clients, added] }, result: undefined }));
    expect(mcpOAuthPath()).toBe(join(home, 'mcp-oauth.json'));
    expect((await stat(mcpOAuthPath())).mode & 0o777).toBe(0o600);
    await expect(readMcpOAuthData(NOW)).resolves.toEqual({ clients: [added], families: [] });
  });

  it('prunes ended families and unused old clients', () => {
    const withFamily = client(1, at(30 * DAY_MS));
    const old = client(2, at(25 * HOUR_MS));
    const young = client(3, at(23 * HOUR_MS));
    const revoked8d = family(4, withFamily.clientId, { revokedAt: at(8 * DAY_MS) });
    const revoked6d = family(5, withFamily.clientId, { revokedAt: at(6 * DAY_MS) });
    const refreshExpired8d = family(6, withFamily.clientId, { refreshExpiresAt: at(8 * DAY_MS) });
    const pruned = pruneMcpOAuthData({ clients: [withFamily, old, young], families: [revoked8d, revoked6d, refreshExpired8d] }, NOW);
    expect(pruned.families.map((f) => f.familyId)).toEqual([revoked6d.familyId]);
    expect(pruned.clients.map((c) => c.clientId)).toEqual([withFamily.clientId, young.clientId]);
  });

  it('drops a client whose only family was pruned once it is older than 24 h', () => {
    const lonely = client(1, at(30 * DAY_MS));
    const pruned = pruneMcpOAuthData({ clients: [lonely], families: [family(2, lonely.clientId, { revokedAt: at(8 * DAY_MS) })] }, NOW);
    expect(pruned).toEqual({ clients: [], families: [] });
  });

  it('refuses a malformed file without overwriting it', async () => {
    const path = join(home, 'mcp-oauth.json');
    for (const body of ['{not json', JSON.stringify({ v: 1, clients: [{ clientId: 'bad' }], families: [] }), JSON.stringify({ v: 2, clients: [], families: [] })]) {
      await writeFile(path, body, { mode: 0o600 });
      await expect(readMcpOAuthData(NOW)).rejects.toThrow(path);
      await expect(mutateMcpOAuthData(NOW, (data) => ({ data, result: undefined }))).rejects.toThrow(path);
      expect(await readFile(path, 'utf8')).toBe(body);
    }
  });

  it('lands two concurrent mutations that each append a client', async () => {
    const a = client(1, at(HOUR_MS));
    const b = client(2, at(HOUR_MS));
    await Promise.all([
      mutateMcpOAuthData(NOW, (data) => ({ data: { ...data, clients: [...data.clients, a] }, result: undefined })),
      mutateMcpOAuthData(NOW, (data) => ({ data: { ...data, clients: [...data.clients, b] }, result: undefined })),
    ]);
    expect((await readMcpOAuthData(NOW)).clients.map((c) => c.clientId).sort()).toEqual([a.clientId, b.clientId].sort());
  });

  it('skips the write when the change returns write: false', async () => {
    await mutateMcpOAuthData(NOW, (data) => ({ data, result: undefined, write: false }));
    await expect(stat(mcpOAuthPath())).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
