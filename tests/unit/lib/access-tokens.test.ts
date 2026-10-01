/**
 * PAN-3762 W2.1: the access-token registry — create/verify/revoke, the 5 s
 * cross-process refresh, the lastUsedAt throttle, file mode, hash-only storage,
 * and fail-closed handling of a corrupt file. PAN-2351 W1 adds the scope model:
 * scopeSatisfies, parseAccessTokenScopes, and createAccessToken input checks.
 */
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Registry = typeof import('../../../src/lib/access-tokens.js');

let registry: Registry;
let home: string;
const originalHome = process.env.OVERDECK_HOME;

async function freshModule(): Promise<Registry> {
  vi.resetModules();
  return import('../../../src/lib/access-tokens.js');
}

async function readFileRecords(): Promise<Array<{ id: string; lastUsedAt: string | null; revokedAt?: string }>> {
  return JSON.parse(await readFile(join(home, 'access-tokens.json'), 'utf8')).tokens;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-09-29T12:00:00.000Z'));
  home = await mkdtemp(join(tmpdir(), 'pan-3762-tokens-'));
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

describe('access-token registry (PAN-3762)', () => {
  it('verifies a created token and rejects it immediately after in-process revocation', async () => {
    const { token, record } = await registry.createAccessToken({ name: 'laptop', scopes: ['admin'], kind: 'device' });
    expect(token).toMatch(/^odk_[0-9a-f]{64}$/);
    expect(record).not.toHaveProperty('tokenHash');
    expect(record.kind).toBe('device');

    const verified = registry.verifyAccessToken(token);
    expect(verified.ok).toBe(true);
    expect(verified.ok && verified.record.id).toBe(record.id);
    expect(registry.verifyAccessToken(`${token.slice(0, -1)}0`)).toEqual({ ok: false });
    expect(registry.verifyAccessToken(null)).toEqual({ ok: false });

    await registry.revokeAccessToken(record.id);
    expect(registry.verifyAccessToken(token)).toEqual({ ok: false });
  });

  it('sees a revocation written by another module instance after the 5 s refresh', async () => {
    const { token, record } = await registry.createAccessToken({ name: 'phone', scopes: ['admin'], kind: 'device' });
    // Use the token once so its lastUsedAt write (which re-reads the file) is
    // done and throttled before the other instance revokes it.
    expect(registry.verifyAccessToken(token).ok).toBe(true);
    await registry.createAccessToken({ name: 'barrier', scopes: ['admin'] });
    registry.startAccessTokenRefresh();

    const other = await freshModule();
    await other.revokeAccessToken(record.id);
    expect(registry.verifyAccessToken(token).ok).toBe(true);

    await vi.advanceTimersByTimeAsync(5_000);
    await vi.waitFor(() => expect(registry.verifyAccessToken(token)).toEqual({ ok: false }));
  });

  it('writes the file with mode 0600 and never stores the plaintext token', async () => {
    const { token } = await registry.createAccessToken({ name: 'desk', scopes: ['admin'] });
    const path = join(home, 'access-tokens.json');
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    const raw = await readFile(path, 'utf8');
    expect(raw).not.toContain(token);
    expect(raw).not.toContain(token.slice(4));
  });

  it('throttles lastUsedAt writes to one per record per minute', async () => {
    const { token, record } = await registry.createAccessToken({ name: 'tablet', scopes: ['admin'], kind: 'device' });
    const t0 = new Date().toISOString();
    registry.verifyAccessToken(token);
    await vi.waitFor(async () => expect((await readFileRecords())[0]?.lastUsedAt).toBe(t0));

    await vi.advanceTimersByTimeAsync(30_000);
    registry.verifyAccessToken(token);
    // Any lastUsedAt write queued by the verify above lands before this mutation.
    await registry.createAccessToken({ name: 'barrier', scopes: ['admin'] });
    expect((await readFileRecords()).find((r) => r.id === record.id)?.lastUsedAt).toBe(t0);

    await vi.advanceTimersByTimeAsync(31_000);
    const t1 = new Date().toISOString();
    registry.verifyAccessToken(token);
    await vi.waitFor(async () => expect((await readFileRecords()).find((r) => r.id === record.id)?.lastUsedAt).toBe(t1));
  });

  it('fails closed on a corrupt registry: refresh rejects naming the file and no token verifies', async () => {
    const { token } = await registry.createAccessToken({ name: 'laptop', scopes: ['admin'], kind: 'device' });
    const path = join(home, 'access-tokens.json');
    await writeFile(path, '{not json', 'utf8');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(registry.refreshAccessTokens()).rejects.toThrow(path);
    expect(registry.verifyAccessToken(token)).toEqual({ ok: false });
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe('access-token scopes (PAN-2351)', () => {
  const ALL = ['read:events', 'read:state', 'read:conversations', 'tell', 'operate', 'admin'] as const;

  it('scopeSatisfies: admin covers every scope, operate covers tell, each other scope covers only itself', () => {
    expect(registry.ACCESS_TOKEN_SCOPES).toEqual(ALL);
    for (const granted of ALL) {
      for (const required of ALL) {
        const expected = granted === 'admin' || granted === required || (granted === 'operate' && required === 'tell');
        expect(registry.scopeSatisfies([granted], required), `${granted} => ${required}`).toBe(expected);
      }
    }
    expect(registry.scopeSatisfies(['operate'], 'tell')).toBe(true);
    expect(registry.scopeSatisfies(['operate'], 'read:events')).toBe(false);
    expect(registry.scopeSatisfies(['tell'], 'operate')).toBe(false);
    expect(registry.scopeSatisfies(['read:events', 'tell'], 'tell')).toBe(true);
  });

  it('scopeSatisfies: an unknown scope string satisfies nothing', () => {
    for (const required of ALL) {
      expect(registry.scopeSatisfies(['read:bogus'], required)).toBe(false);
      expect(registry.scopeSatisfies([], required)).toBe(false);
    }
  });

  it('parseAccessTokenScopes trims, deduplicates, and names an unknown scope', () => {
    expect(registry.parseAccessTokenScopes('read:events, tell')).toEqual(['read:events', 'tell']);
    expect(registry.parseAccessTokenScopes(['tell', ' tell ', 'admin'])).toEqual(['tell', 'admin']);
    expect(() => registry.parseAccessTokenScopes('write:all')).toThrow(/write:all/);
    expect(() => registry.parseAccessTokenScopes('tell,write:all,bad')).toThrow(/write:all/);
    expect(() => registry.parseAccessTokenScopes('')).toThrow(/at least one/);
    expect(() => registry.parseAccessTokenScopes(['  '])).toThrow(/at least one/);
  });

  it('createAccessToken rejects an empty name or empty scopes and persists nothing', async () => {
    await expect(registry.createAccessToken({ name: '', scopes: ['tell'] })).rejects.toThrow(/name/);
    await expect(registry.createAccessToken({ name: '   ', scopes: ['tell'] })).rejects.toThrow(/name/);
    await expect(registry.createAccessToken({ name: 'x'.repeat(201), scopes: ['tell'] })).rejects.toThrow(/name/);
    await expect(registry.createAccessToken({ name: 'x', scopes: [] })).rejects.toThrow(/scopes/);
    await expect(registry.listAccessTokens()).resolves.toEqual([]);
  });

  it('createAccessToken stores the trimmed name and deduplicated scopes', async () => {
    const { record } = await registry.createAccessToken({ name: '  sidecar ', scopes: ['read:events', 'read:events', 'tell'], kind: 'token' });
    expect(record.name).toBe('sidecar');
    expect(record.scopes).toEqual(['read:events', 'tell']);
    expect(record.kind).toBe('token');
  });

  it('parses a registry file holding an unknown scope, and that record verifies but satisfies nothing', async () => {
    const { token, record } = await registry.createAccessToken({ name: 'old', scopes: ['tell'], kind: 'token' });
    const path = join(home, 'access-tokens.json');
    const file = JSON.parse(await readFile(path, 'utf8'));
    file.tokens[0].scopes = ['read:bogus'];
    await writeFile(path, JSON.stringify(file), 'utf8');

    await registry.refreshAccessTokens();
    const verified = registry.verifyAccessToken(token);
    expect(verified.ok && verified.record.id).toBe(record.id);
    const scopes = verified.ok ? verified.record.scopes : [];
    for (const required of ALL) expect(registry.scopeSatisfies(scopes, required)).toBe(false);
  });
});
