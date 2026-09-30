/**
 * PAN-4436 WI-7: the vault browse service refreshes the browse cache after each
 * sync cycle and reconciles the `vault-<vaultId>` conversation rows to it.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// OVERDECK_HOME is captured when the path helpers load, so set it before the
// first dynamic import of the infra and conversation modules.
const TEST_HOME = mkdtempSync(join(tmpdir(), 'pan-vault-browse-service-'));
process.env.OVERDECK_HOME = TEST_HOME;

const { listenerRef } = vi.hoisted(() => ({ listenerRef: { listeners: [] as unknown[] } }));
vi.mock('../../../../../src/dashboard/server/services/vault-service.js', () => ({
  onVaultSyncReport: vi.fn((listener: unknown) => {
    listenerRef.listeners.push(listener);
    return () => { listenerRef.listeners = listenerRef.listeners.filter((entry) => entry !== listener); };
  }),
}));
vi.mock('../../../../../src/dashboard/server/event-store.js', () => ({ getEventStore: vi.fn(() => ({ emitOnly: vi.fn() })) }));
vi.mock('../../../../../src/lib/cloister/transcript-deletion-door.js', () => ({ removeTranscriptFile: vi.fn() }));

const { removeTranscriptFile } = await import('../../../../../src/lib/cloister/transcript-deletion-door.js');
const { closeOverdeckDatabase } = await import('../../../../../src/lib/overdeck/infra.js');
const { getConversationByName } = await import('../../../../../src/lib/overdeck/conversations.js');
const { VAULT_CONFIG_DEFAULTS } = await import('../../../../../src/lib/vault/config.js');
const { readSessionRecord, refName } = await import('../../../../../src/lib/vault/format.js');
const { createVaultKey, deriveSubkeys } = await import('../../../../../src/lib/vault/identity.js');
const { replaceListCache } = await import('../../../../../src/lib/vault/local-index.js');
const { settle } = await import('../../../../../src/lib/vault/settle.js');
const { DirVaultStore } = await import('../../../../../src/lib/vault/store/dir.js');
const { vaultBrowseFilePath } = await import('../../../../../src/lib/vault/browse.js');
const { refreshVaultBrowseCopies, startVaultBrowseService, stopVaultBrowseService } = await import(
  '../../../../../src/dashboard/server/services/vault-browse-service.js'
);

import type { ListCacheRow } from '../../../../../src/lib/vault/local-index.js';
import type { OpenVault } from '../../../../../src/lib/vault/open.js';
import type { SessionRecord } from '../../../../../src/lib/vault/format.js';

const keys = deriveSubkeys(createVaultKey());
const config = { ...VAULT_CONFIG_DEFAULTS, exclude: { paths: [], origins: [], sessions: [] }, backend: 'dir' };

describe('vault browse service (PAN-4436 WI-7)', () => {
  let root: string;
  let vault: OpenVault;

  beforeEach(async () => {
    root = mkdtempSync(join(TEST_HOME, 'case-'));
    mkdirSync(join(root, 'proj'), { recursive: true });
    const store = await DirVaultStore.open(join(root, 'backend'));
    vault = { config, keys, store, rotatedAt: null } as OpenVault;
    vi.mocked(removeTranscriptFile).mockClear();
  });

  afterEach(() => {
    expect(removeTranscriptFile).not.toHaveBeenCalled();
    stopVaultBrowseService();
  });

  afterAll(() => {
    closeOverdeckDatabase();
    rmSync(TEST_HOME, { recursive: true, force: true });
    delete process.env.OVERDECK_HOME;
  });

  async function saveRecord(): Promise<{ vaultId: string; row: ListCacheRow }> {
    const nativePath = join(root, 'claude.jsonl');
    writeFileSync(nativePath, `${JSON.stringify({ type: 'user', sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', cwd: join(root, 'proj'), message: { role: 'user', content: 'a laptop conversation' } })}\n`);
    const saved = await settle({ nativePath, harness: 'claude-code', store: vault.store, keys, config });
    const vaultId = saved.vaultId!;
    const name = refName('record', vaultId, keys.K_ref);
    const record = (await readSessionRecord(name, (await vault.store.readRef(name))!.value, keys)) as SessionRecord;
    const row: ListCacheRow = {
      vaultId, title: record.title, harness: record.harness, ownerLabel: 'laptop',
      ownerIsHere: false, updatedAt: record.updatedAt, tombstone: false,
    };
    await replaceListCache([row]);
    return { vaultId, row };
  }

  it('inserts the browse row, writes the cache file and emits once; an unchanged refresh emits nothing', async () => {
    const { vaultId } = await saveRecord();
    const emit = vi.fn();
    expect(await refreshVaultBrowseCopies(vault, { emit })).toEqual({ inserted: 1, updated: 0, removed: 0, failed: 0 });
    expect(getConversationByName(`vault-${vaultId}`)).toMatchObject({ origin: 'vault', status: 'ended' });
    expect(existsSync(vaultBrowseFilePath(vaultId, 'claude-code'))).toBe(true);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(`vault-${vaultId}`);

    emit.mockClear();
    expect(await refreshVaultBrowseCopies(vault, { emit })).toEqual({ inserted: 0, updated: 0, removed: 0, failed: 0 });
    expect(emit).not.toHaveBeenCalled();
  });

  it.each([
    ['tombstoned', { tombstone: true }],
    ['owned here', { ownerIsHere: true }],
  ] as const)('removes the row and file once the record is %s, and emits once', async (_label, overrides) => {
    const { vaultId, row } = await saveRecord();
    await refreshVaultBrowseCopies(vault, { emit: vi.fn() });
    await replaceListCache([{ ...row, ...overrides }]);
    const emit = vi.fn();
    expect(await refreshVaultBrowseCopies(vault, { emit })).toMatchObject({ removed: 1 });
    expect(getConversationByName(`vault-${vaultId}`)).toBeNull();
    expect(existsSync(vaultBrowseFilePath(vaultId, 'claude-code'))).toBe(false);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('keeps the row of a record whose refresh failed', async () => {
    const { vaultId } = await saveRecord();
    await refreshVaultBrowseCopies(vault, { emit: vi.fn() });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const emit = vi.fn();
    const counts = await refreshVaultBrowseCopies(vault, {
      emit,
      refreshBrowseCache: async () => ({ copies: [], removed: [], failed: [{ vaultId, message: 'chunk missing' }] }),
    });
    expect(counts).toEqual({ inserted: 0, updated: 0, removed: 0, failed: 1 });
    expect(getConversationByName(`vault-${vaultId}`)).not.toBeNull();
    expect(emit).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(`[vault] browse refresh failed for ${vaultId}: chunk missing`);
    warn.mockRestore();
  });

  it('changes no row when the cache refresh itself throws', async () => {
    const { vaultId } = await saveRecord();
    await refreshVaultBrowseCopies(vault, { emit: vi.fn() });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const counts = await refreshVaultBrowseCopies(vault, { emit: vi.fn(), refreshBrowseCache: async () => { throw new Error('disk full'); } });
    expect(counts).toEqual({ inserted: 0, updated: 0, removed: 0, failed: 0 });
    expect(getConversationByName(`vault-${vaultId}`)).not.toBeNull();
    expect(warn).toHaveBeenCalledWith('[vault] browse refresh failed: disk full');
    warn.mockRestore();
  });

  it('registers one sync-report listener however often it starts', () => {
    startVaultBrowseService();
    startVaultBrowseService();
    expect(listenerRef.listeners).toHaveLength(1);
    stopVaultBrowseService();
    expect(listenerRef.listeners).toHaveLength(0);
  });
});
