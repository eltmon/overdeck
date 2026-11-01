/**
 * PAN-4645 WI-4: the `machine` token kind — binding fields, FR-7 scopes, the
 * snapshot lookups, fail-closed parsing of a malformed machine record, and
 * `onAccessTokensRevoked` for in-process and cross-process revocations.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Registry = typeof import('../../../src/lib/access-tokens.js');

let registry: Registry;
let home: string;
const originalHome = process.env.OVERDECK_HOME;
const KEY_A = 'a1'.repeat(32);
const KEY_B = 'b2'.repeat(32);

async function freshModule(): Promise<Registry> {
  vi.resetModules();
  return import('../../../src/lib/access-tokens.js');
}

async function machineToken(overrides: Partial<Parameters<Registry['createAccessToken']>[0]> = {}) {
  return registry.createAccessToken({
    name: 'machine:desk',
    kind: 'machine',
    scopes: registry.MACHINE_TOKEN_SCOPES('operator'),
    machineKey: KEY_A,
    environmentId: 'env-desk',
    access: 'operator',
    ...overrides,
  });
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-11-01T12:00:00.000Z'));
  home = await mkdtemp(join(tmpdir(), 'pan-4645-machine-tokens-'));
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

describe('machine access tokens (PAN-4645 WI-4)', () => {
  it('creates a machine record bound to a key, environment and access level, and finds it by key', async () => {
    const { token, record } = await machineToken();
    expect(record).toMatchObject({ kind: 'machine', machineKey: KEY_A, environmentId: 'env-desk', access: 'operator' });
    expect(record).not.toHaveProperty('tokenHash');
    // Operator-level links answer the other machine's prompts (`approve`, PAN-4649) and forward; fenced links do neither.
    expect(record.scopes).toEqual(['read:events', 'read:state', 'read:conversations', 'read:costs', 'read:settings', 'tell', 'operate', 'approve', 'forward']);
    expect(registry.MACHINE_TOKEN_SCOPES('agent-fenced')).not.toContain('forward');
    expect(registry.MACHINE_TOKEN_SCOPES('agent-fenced')).not.toContain('approve');
    expect(registry.MACHINE_TOKEN_SCOPES('agent-fenced')).not.toContain('admin');

    const verified = registry.verifyAccessToken(token);
    expect(verified.ok && verified.record.id).toBe(record.id);
    expect(registry.findActiveMachineTokenByKey(KEY_A)?.id).toBe(record.id);
    expect(registry.findActiveMachineTokenByKey(KEY_B)).toBeNull();
    expect(registry.listActiveRecordsOfKind('machine').map((r) => r.id)).toEqual([record.id]);
    expect(registry.listActiveRecordsOfKind('device')).toEqual([]);

    await registry.revokeAccessToken(record.id);
    expect(registry.findActiveMachineTokenByKey(KEY_A)).toBeNull();
    expect(registry.listActiveRecordsOfKind('machine')).toEqual([]);
  });

  it('refuses a machine record without its binding fields, with admin, and binding fields on other kinds', async () => {
    await expect(machineToken({ machineKey: 'AB'.repeat(32) })).rejects.toThrow(/machineKey/);
    await expect(machineToken({ environmentId: '' })).rejects.toThrow(/environmentId/);
    await expect(machineToken({ access: undefined })).rejects.toThrow(/access/);
    await expect(machineToken({ scopes: ['admin'] })).rejects.toThrow(/never carries admin/);
    await expect(registry.createAccessToken({ name: 'tok', scopes: ['tell'], kind: 'token', machineKey: KEY_A }))
      .rejects.toThrow(/kind: machine only/);
    expect(await registry.listAccessTokens()).toEqual([]);
  });

  it('treats a registry holding a machine record without machineKey as corrupt', async () => {
    const { record } = await machineToken();
    const path = join(home, 'access-tokens.json');
    const file = JSON.parse(await readFile(path, 'utf8')) as { tokens: Array<Record<string, unknown>> };
    delete file.tokens[0]!.machineKey;
    await writeFile(path, JSON.stringify(file), 'utf8');

    await expect(registry.refreshAccessTokens()).rejects.toThrow(/unexpected shape/);
    expect(registry.findActiveMachineTokenByKey(KEY_A)).toBeNull();
    expect(registry.listActiveRecordsOfKind('machine')).toEqual([]);
    expect(record.id).toBeTruthy();
  });

  it('fires onAccessTokensRevoked once for an in-process revoke, not again for a repeat', async () => {
    const { record } = await machineToken();
    const fired: string[] = [];
    const unsubscribe = registry.onAccessTokensRevoked((revoked) => { fired.push(revoked.id); });

    await registry.revokeAccessToken(record.id);
    await registry.revokeAccessToken(record.id);
    expect(fired).toEqual([record.id]);

    unsubscribe();
    const other = await registry.createAccessToken({ name: 'dev', scopes: ['admin'], kind: 'device' });
    await registry.revokeAccessToken(other.record.id);
    expect(fired).toEqual([record.id]);
  });

  it('fires onAccessTokensRevoked on the next refresh for a revoke or removal written by another process', async () => {
    const machine = await machineToken();
    const device = await registry.createAccessToken({ name: 'dev', scopes: ['admin'], kind: 'device' });
    const fired: string[] = [];
    registry.onAccessTokensRevoked((revoked) => { fired.push(revoked.id); });
    registry.startAccessTokenRefresh();

    // "Another process": revoke the machine record and drop the device record on disk.
    const path = join(home, 'access-tokens.json');
    const file = JSON.parse(await readFile(path, 'utf8')) as { tokens: Array<Record<string, unknown>> };
    file.tokens = file.tokens
      .filter((token) => token.id !== device.record.id)
      .map((token) => (token.id === machine.record.id ? { ...token, revokedAt: '2026-11-01T12:00:05.000Z' } : token));
    await writeFile(path, JSON.stringify(file), 'utf8');
    expect(fired).toEqual([]);

    await vi.advanceTimersByTimeAsync(registry.ACCESS_TOKEN_REFRESH_MS);
    // The refresh reads the file with real fs promises; give it a real tick.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(fired.sort()).toEqual([device.record.id, machine.record.id].sort());
    expect(registry.verifyAccessToken(machine.token)).toEqual({ ok: false });
    expect(registry.verifyAccessToken(device.token)).toEqual({ ok: false });
    registry.stopAccessTokenRefresh();
  });
});
