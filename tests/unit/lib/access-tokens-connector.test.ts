/**
 * PAN-4949 W-1: connector records in the access-token registry — the
 * connectorKey and clientId binding (valid only on kind: 'connector'), the
 * create-time scope and field guards, the corrupt-file checks, and the
 * link-key pin `findActiveChannelTokenByKey`.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Registry = typeof import('../../../src/lib/access-tokens.js');

let registry: Registry;
let home: string;
const originalHome = process.env.OVERDECK_HOME;
const HASH = 'a'.repeat(64);
const CONNECTOR_KEY = 'c'.repeat(64);
const CLIENT_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

async function freshModule(): Promise<Registry> {
  vi.resetModules();
  return import('../../../src/lib/access-tokens.js');
}

async function writeRegistryFile(tokens: unknown[]): Promise<void> {
  await writeFile(join(home, 'access-tokens.json'), JSON.stringify({ v: 1, tokens }), { mode: 0o600 });
}

function baseRecord(overrides: Record<string, unknown>): Record<string, unknown> {
  return { id: 'r1', name: 'x', scopes: ['tell'], tokenHash: HASH, createdAt: '2026-11-01T00:00:00.000Z', lastUsedAt: null, ...overrides };
}

const connectorInput = { name: 'bot', kind: 'connector' as const, connectorKey: CONNECTOR_KEY, clientId: CLIENT_ID };

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-4949-tokens-'));
  process.env.OVERDECK_HOME = home;
  registry = await freshModule();
});

afterEach(async () => {
  await registry._settleAccessTokenWritesForTests();
  registry._resetAccessTokensForTests();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('connector records in the access-token registry (PAN-4949)', () => {
  it('writes a connector record whose kind, connectorKey, clientId and scopes read back', async () => {
    const { record } = await registry.createAccessToken({ ...connectorInput, scopes: ['read:state', 'tell'] });
    const stored = (await registry.listAccessTokens()).find((r) => r.id === record.id);
    expect(stored).toMatchObject({ kind: 'connector', connectorKey: CONNECTOR_KEY, clientId: CLIENT_ID, scopes: ['read:state', 'tell'] });
  });

  it('exports the connector scope choices and the bot defaults', () => {
    expect(registry.CONNECTOR_SCOPE_CHOICES).toEqual(['read:state', 'read:conversations', 'tell', 'operate', 'approve']);
    expect(registry.BOT_DEFAULT_SCOPES).toEqual(['read:state', 'read:conversations', 'tell']);
  });

  it.each(['admin', 'forward', 'read:costs', 'read:settings', 'read:events'] as const)('refuses a connector with scope %s', async (scope) => {
    await expect(registry.createAccessToken({ ...connectorInput, scopes: [scope] })).rejects.toThrow(/connector token carries only/);
  });

  it('refuses a missing or 63-hex connectorKey', async () => {
    await expect(registry.createAccessToken({ ...connectorInput, connectorKey: undefined, scopes: ['tell'] })).rejects.toThrow(/needs connectorKey/);
    await expect(registry.createAccessToken({ ...connectorInput, connectorKey: 'c'.repeat(63), scopes: ['tell'] })).rejects.toThrow(/needs connectorKey/);
  });

  it('refuses a non-UUID clientId', async () => {
    await expect(registry.createAccessToken({ ...connectorInput, clientId: 'not-a-uuid', scopes: ['tell'] })).rejects.toThrow(/needs clientId/);
  });

  it('refuses a connector input that also carries phoneKey or machineKey', async () => {
    await expect(registry.createAccessToken({ ...connectorInput, phoneKey: 'd'.repeat(64), scopes: ['tell'] })).rejects.toThrow(/takes only connectorKey and clientId/);
    await expect(registry.createAccessToken({ ...connectorInput, machineKey: 'e'.repeat(64), scopes: ['tell'] })).rejects.toThrow(/takes only connectorKey and clientId/);
  });

  it('refuses connectorKey on a token and clientId on a device', async () => {
    await expect(registry.createAccessToken({ name: 't', kind: 'token', connectorKey: CONNECTOR_KEY, scopes: ['tell'] })).rejects.toThrow(/connectorKey belongs to kind: connector only/);
    await expect(registry.createAccessToken({ name: 'd', kind: 'device', clientId: CLIENT_ID, scopes: ['tell'] })).rejects.toThrow(/clientId also to kind: connector/);
  });

  it('treats a connector record without clientId as a corrupt file', async () => {
    await writeRegistryFile([baseRecord({ kind: 'connector', connectorKey: CONNECTOR_KEY })]);
    await expect(registry.refreshAccessTokens()).rejects.toThrow(/unexpected shape/);
  });

  it('treats a token record carrying connectorKey as a corrupt file', async () => {
    await writeRegistryFile([baseRecord({ kind: 'token', connectorKey: CONNECTOR_KEY })]);
    await expect(registry.refreshAccessTokens()).rejects.toThrow(/unexpected shape/);
  });

  it('loads a well-formed connector record from the file', async () => {
    await writeRegistryFile([baseRecord({ kind: 'connector', connectorKey: CONNECTOR_KEY, clientId: CLIENT_ID })]);
    await expect(registry.refreshAccessTokens()).resolves.toBeUndefined();
  });

  it('pins a link key to the active connector record until it is revoked', async () => {
    const { record } = await registry.createAccessToken({ ...connectorInput, scopes: ['read:state'] });
    await registry.refreshAccessTokens();
    expect(registry.findActiveChannelTokenByKey(CONNECTOR_KEY)).toMatchObject({ id: record.id, kind: 'connector' });
    await registry.revokeAccessToken(record.id);
    expect(registry.findActiveChannelTokenByKey(CONNECTOR_KEY)).toBeNull();
  });
});
