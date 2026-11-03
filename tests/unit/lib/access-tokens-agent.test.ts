/**
 * PAN-4930 W-2: agent tokens in the access-token registry — the agentId,
 * agentKind and role fields (valid only on kind: 'token'), the create-time
 * guards, and the fresh-read helpers a CLI process uses: the active-record
 * finder, matcher revoke and the 7-day prune of ended agent tokens.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Registry = typeof import('../../../src/lib/access-tokens.js');

let registry: Registry;
let home: string;
const originalHome = process.env.OVERDECK_HOME;
const DAY_MS = 24 * 60 * 60 * 1000;
const HASH = 'a'.repeat(64);

async function freshModule(): Promise<Registry> {
  vi.resetModules();
  return import('../../../src/lib/access-tokens.js');
}

async function writeRegistryFile(tokens: unknown[]): Promise<void> {
  await writeFile(join(home, 'access-tokens.json'), JSON.stringify({ v: 1, tokens }), { mode: 0o600 });
}

async function readFileRecords(): Promise<Array<{ id: string; lastUsedAt: string | null; revokedAt?: string }>> {
  return JSON.parse(await readFile(join(home, 'access-tokens.json'), 'utf8')).tokens;
}

function baseRecord(overrides: Record<string, unknown>): Record<string, unknown> {
  return { id: 'r1', name: 'x', scopes: ['tell'], tokenHash: HASH, createdAt: '2026-11-01T00:00:00.000Z', lastUsedAt: null, ...overrides };
}

const agentInput = { kind: 'token' as const, agentId: 'agent-pan-4930', agentKind: 'agent' as const, role: 'work' };

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-11-03T12:00:00.000Z'));
  home = await mkdtemp(join(tmpdir(), 'pan-4930-tokens-'));
  process.env.OVERDECK_HOME = home;
  registry = await freshModule();
});

afterEach(async () => {
  await registry._settleAccessTokenWritesForTests();
  registry._resetAccessTokensForTests();
  vi.useRealTimers();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('agent tokens in the access-token registry (PAN-4930)', () => {
  it('loads a file written without the agent fields and still verifies its token', async () => {
    const { token } = await registry.createAccessToken({ name: 'plain', scopes: ['tell'], kind: 'token' });
    const other = await freshModule();
    await expect(other.refreshAccessTokens()).resolves.toBeUndefined();
    expect(other.verifyAccessToken(token).ok).toBe(true);
    other._resetAccessTokensForTests();
  });

  it('loads a token record carrying agentId, agentKind and role', async () => {
    await writeRegistryFile([baseRecord({ kind: 'token', agentId: 'conv-1', agentKind: 'conversation', role: 'conversation' })]);
    await expect(registry.refreshAccessTokens()).resolves.toBeUndefined();
    expect(registry.listActiveRecordsOfKind('token')).toMatchObject([{ agentId: 'conv-1', agentKind: 'conversation', role: 'conversation' }]);
  });

  it('treats a device record with agentId as a corrupt file that accepts no token', async () => {
    const { token } = await registry.createAccessToken({ name: 'plain', scopes: ['tell'], kind: 'token' });
    const records = await readFileRecords();
    await writeRegistryFile([...records, baseRecord({ id: 'r2', kind: 'device', agentId: 'agent-x', agentKind: 'agent', role: 'work' })]);
    await expect(registry.refreshAccessTokens()).rejects.toThrow(/unexpected shape/);
    expect(registry.verifyAccessToken(token)).toEqual({ ok: false });
  });

  it('treats a token record with agentId but no agentKind as a corrupt file', async () => {
    await writeRegistryFile([baseRecord({ kind: 'token', agentId: 'agent-x', role: 'work' })]);
    await expect(registry.refreshAccessTokens()).rejects.toThrow(/unexpected shape/);
  });

  it('createAccessToken refuses admin or forward on an agent token and agent fields on another kind', async () => {
    await expect(registry.createAccessToken({ ...agentInput, name: 'a', scopes: ['admin'] })).rejects.toThrow(/never carries admin or forward/);
    await expect(registry.createAccessToken({ ...agentInput, name: 'a', scopes: ['forward'] })).rejects.toThrow(/never carries admin or forward/);
    await expect(registry.createAccessToken({ ...agentInput, kind: 'device', name: 'a', scopes: ['tell'] })).rejects.toThrow(/belong to kind: token only/);
    await expect(registry.createAccessToken({ kind: 'token', agentId: 'agent-x', name: 'a', scopes: ['tell'] })).rejects.toThrow(/needs agentId, agentKind and role/);
    expect(await registry.listAccessTokens()).toEqual([]);
  });

  it('readActiveAccessTokenRecord finds an active token fresh, without touching lastUsedAt', async () => {
    const { token, record } = await registry.createAccessToken({ ...agentInput, name: 'agent:work:agent-pan-4930', scopes: ['tell', 'read:state'] });
    const cli = await freshModule();
    expect(await cli.readActiveAccessTokenRecord(token)).toMatchObject({ id: record.id, agentId: 'agent-pan-4930', role: 'work', lastUsedAt: null });
    expect(await cli.readActiveAccessTokenRecord(`odk_${'0'.repeat(64)}`)).toBeNull();
    await cli._settleAccessTokenWritesForTests();
    expect((await readFileRecords())[0]!.lastUsedAt).toBeNull();

    await registry.revokeAccessToken(record.id);
    expect(await cli.readActiveAccessTokenRecord(token)).toBeNull();
    cli._resetAccessTokensForTests();
  });

  it('revokeAccessTokensMatching revokes only matching active records and returns them', async () => {
    const mine = await registry.createAccessToken({ ...agentInput, name: 'mine', scopes: ['tell'] });
    const other = await registry.createAccessToken({ ...agentInput, agentId: 'agent-other', name: 'other', scopes: ['tell'] });
    const plain = await registry.createAccessToken({ name: 'plain', scopes: ['tell'], kind: 'token' });
    const fired: string[] = [];
    registry.onAccessTokensRevoked((record) => fired.push(record.id));

    const revoked = await registry.revokeAccessTokensMatching((record) => record.agentId === 'agent-pan-4930');
    expect(revoked.map((record) => record.id)).toEqual([mine.record.id]);
    expect(fired).toEqual([mine.record.id]);
    expect(registry.verifyAccessToken(mine.token)).toEqual({ ok: false });
    expect(registry.verifyAccessToken(other.token).ok).toBe(true);
    expect(registry.verifyAccessToken(plain.token).ok).toBe(true);

    expect(await registry.revokeAccessTokensMatching((record) => record.agentId === 'agent-pan-4930')).toEqual([]);
  });

  it('pruneEndedAccessTokens removes agent tokens revoked past the window and keeps the rest', async () => {
    const now = Date.now();
    const at = (daysAgo: number) => new Date(now - daysAgo * DAY_MS).toISOString();
    const agent = { kind: 'token', agentId: 'agent-x', agentKind: 'agent', role: 'work' };
    await writeRegistryFile([
      baseRecord({ id: 'old-agent', ...agent, revokedAt: at(8) }),
      baseRecord({ id: 'recent-agent', ...agent, revokedAt: at(6) }),
      baseRecord({ id: 'active-agent', ...agent }),
      baseRecord({ id: 'old-plain', kind: 'token', revokedAt: at(30) }),
    ]);

    expect(await registry.pruneEndedAccessTokens(7 * DAY_MS)).toBe(1);
    expect((await readFileRecords()).map((record) => record.id)).toEqual(['recent-agent', 'active-agent', 'old-plain']);
    expect(await registry.pruneEndedAccessTokens(7 * DAY_MS)).toBe(0);
  });
});
