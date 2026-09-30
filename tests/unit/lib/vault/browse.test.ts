import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeTranscriptFile } from '../../../../src/lib/cloister/transcript-deletion-door.js';
import { VAULT_CONFIG_DEFAULTS, type VaultConfig } from '../../../../src/lib/vault/config.js';
import { readSessionRecord, refName, type SessionRecord } from '../../../../src/lib/vault/format.js';
import { createVaultKey, deriveSubkeys } from '../../../../src/lib/vault/identity.js';
import type { ListCacheRow } from '../../../../src/lib/vault/local-index.js';
import { nativeFileContent, readLogLines } from '../../../../src/lib/vault/materialize.js';
import { settle } from '../../../../src/lib/vault/settle.js';
import { DirVaultStore } from '../../../../src/lib/vault/store/dir.js';
import { refreshBrowseCache, vaultBrowseDir } from '../../../../src/lib/vault/browse.js';

vi.mock('../../../../src/lib/cloister/transcript-deletion-door.js', () => ({ removeTranscriptFile: vi.fn() }));

const keys = deriveSubkeys(createVaultKey());
const SESSION = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function user(text: string, cwd: string): string {
  return JSON.stringify({ type: 'user', sessionId: SESSION, cwd, message: { role: 'user', content: text } });
}

describe('vault browse cache: refreshBrowseCache', () => {
  let root: string;
  let cwd: string;
  let store: DirVaultStore;
  let config: VaultConfig;
  let originalHome: string | undefined;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'pan-vault-browse-'));
    cwd = join(root, 'proj');
    mkdirSync(cwd, { recursive: true });
    originalHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = join(root, '.overdeck');
    store = await DirVaultStore.open(join(root, 'backend'));
    config = { ...VAULT_CONFIG_DEFAULTS, exclude: { paths: [], origins: [], sessions: [] }, backend: 'dir' };
    vi.mocked(removeTranscriptFile).mockClear();
  });

  afterEach(() => {
    expect(removeTranscriptFile).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(root, { recursive: true, force: true });
  });

  async function readRecord(vaultId: string): Promise<SessionRecord> {
    const name = refName('record', vaultId, keys.K_ref);
    const ref = await store.readRef(name);
    return (await readSessionRecord(name, ref!.value, keys)) as SessionRecord;
  }

  async function rowFor(vaultId: string, overrides: Partial<ListCacheRow> = {}): Promise<ListCacheRow> {
    const record = await readRecord(vaultId);
    return {
      vaultId, title: record.title, harness: record.harness, ownerLabel: record.owner.label,
      ownerIsHere: false, updatedAt: record.updatedAt, tombstone: false, ...overrides,
    };
  }

  async function logContent(vaultId: string): Promise<string> {
    return nativeFileContent((await readLogLines(await readRecord(vaultId), store, keys)).flat());
  }

  async function saveClaude(file = 'claude.jsonl', text = 'browse me please'): Promise<{ vaultId: string; nativePath: string }> {
    const nativePath = join(root, file);
    writeFileSync(nativePath, `${user(text, cwd)}\n`);
    const saved = await settle({ nativePath, harness: 'claude-code', store, keys, config });
    expect(saved.verdict).toBe('append');
    return { vaultId: saved.vaultId!, nativePath };
  }

  it('writes a non-owned Claude record as <id>.jsonl holding its LOG, owner-only', async () => {
    const { vaultId } = await saveClaude();
    const result = await refreshBrowseCache({ store, keys, rows: [await rowFor(vaultId)] });
    const path = join(vaultBrowseDir(), `${vaultId}.jsonl`);
    expect(result).toMatchObject({ removed: [], failed: [] });
    expect(result.copies).toEqual([expect.objectContaining({ vaultId, harness: 'claude-code', title: 'browse me please', cwd, path })]);
    expect(readFileSync(path, 'utf8')).toBe(await logContent(vaultId));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(vaultBrowseDir()).mode & 0o777).toBe(0o700);
    expect(statSync(join(vaultBrowseDir(), 'manifest.json')).mode & 0o777).toBe(0o600);
  });

  it('writes a Codex record as rollout-<id>.jsonl', async () => {
    const nativePath = join(root, 'codex.jsonl');
    writeFileSync(nativePath, [
      JSON.stringify({ type: 'session_meta', payload: { id: 'thread-1', cwd } }),
      JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5.5' } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello codex' }] } }),
    ].join('\n') + '\n');
    const saved = await settle({ nativePath, harness: 'codex', store, keys, config });
    const vaultId = saved.vaultId!;
    const result = await refreshBrowseCache({ store, keys, rows: [await rowFor(vaultId)] });
    const path = join(vaultBrowseDir(), `rollout-${vaultId}.jsonl`);
    expect(result.copies).toEqual([expect.objectContaining({ vaultId, harness: 'codex', model: 'gpt-5.5', path })]);
    expect(readFileSync(path, 'utf8')).toBe(await logContent(vaultId));
  });

  it('a second refresh after one more settle decodes only the new chunk', async () => {
    const { vaultId, nativePath } = await saveClaude();
    await refreshBrowseCache({ store, keys, rows: [await rowFor(vaultId)] });
    appendFileSync(nativePath, `${user('a follow-up turn', cwd)}\n`);
    expect((await settle({ nativePath, harness: 'claude-code', store, keys, config })).verdict).toBe('append');
    const getObject = vi.spyOn(store, 'getObject');
    const result = await refreshBrowseCache({ store, keys, rows: [await rowFor(vaultId)] });
    expect(result.failed).toEqual([]);
    expect(getObject).toHaveBeenCalledTimes(1);
    expect(readFileSync(join(vaultBrowseDir(), `${vaultId}.jsonl`), 'utf8')).toBe(await logContent(vaultId));
  });

  it('an unchanged row reads no record', async () => {
    const { vaultId } = await saveClaude();
    const row = await rowFor(vaultId);
    await refreshBrowseCache({ store, keys, rows: [row] });
    const readRef = vi.spyOn(store, 'readRef');
    const result = await refreshBrowseCache({ store, keys, rows: [row] });
    expect(readRef).not.toHaveBeenCalled();
    expect(result.copies).toEqual([expect.objectContaining({ vaultId, title: 'browse me please' })]);
  });

  it('a truncated cache file is rewritten whole', async () => {
    const { vaultId, nativePath } = await saveClaude();
    await refreshBrowseCache({ store, keys, rows: [await rowFor(vaultId)] });
    appendFileSync(nativePath, `${user('second', cwd)}\n`);
    await settle({ nativePath, harness: 'claude-code', store, keys, config });
    const path = join(vaultBrowseDir(), `${vaultId}.jsonl`);
    truncateSync(path, 5);
    const getObject = vi.spyOn(store, 'getObject');
    await refreshBrowseCache({ store, keys, rows: [await rowFor(vaultId)] });
    expect(getObject).toHaveBeenCalledTimes(2);
    expect(readFileSync(path, 'utf8')).toBe(await logContent(vaultId));
  });

  it.each([
    ['tombstoned', { tombstone: true }],
    ['owned here', { ownerIsHere: true }],
    ['of another harness', { harness: 'pi' }],
    ['absent', null],
  ] as const)('removes the file and manifest entry of a record that is now %s', async (_label, overrides) => {
    const { vaultId } = await saveClaude();
    await refreshBrowseCache({ store, keys, rows: [await rowFor(vaultId)] });
    const path = join(vaultBrowseDir(), `${vaultId}.jsonl`);
    expect(existsSync(path)).toBe(true);
    const rows = overrides ? [await rowFor(vaultId, overrides)] : [];
    const result = await refreshBrowseCache({ store, keys, rows });
    expect(result).toEqual({ copies: [], removed: [vaultId], failed: [] });
    expect(existsSync(path)).toBe(false);
    expect(JSON.parse(readFileSync(join(vaultBrowseDir(), 'manifest.json'), 'utf8')).entries).toEqual({});
  });

  it('sweeps decrypted files a lost manifest no longer lists', async () => {
    const { vaultId } = await saveClaude();
    await refreshBrowseCache({ store, keys, rows: [await rowFor(vaultId)] });
    const path = join(vaultBrowseDir(), `${vaultId}.jsonl`);
    rmSync(join(vaultBrowseDir(), 'manifest.json'));
    writeFileSync(join(vaultBrowseDir(), '.123.abcd.tmp'), 'partial');
    const result = await refreshBrowseCache({ store, keys, rows: [await rowFor(vaultId, { tombstone: true })] });
    expect(result).toEqual({ copies: [], removed: [vaultId], failed: [] });
    expect(existsSync(path)).toBe(false);
    expect(readdirSync(vaultBrowseDir())).toEqual(['manifest.json']);
  });

  it('writes nothing for a vault id that is not a UUID', async () => {
    const { vaultId } = await saveClaude();
    const result = await refreshBrowseCache({ store, keys, rows: [await rowFor(vaultId, { vaultId: '../x' })] });
    expect(result).toEqual({ copies: [], removed: [], failed: [] });
    expect(readdirSync(vaultBrowseDir())).toEqual(['manifest.json']);
    expect(existsSync(join(root, '.overdeck', 'vault', 'x.jsonl'))).toBe(false);
  });

  it('a record whose chunk is missing lands in failed and keeps its previous file', async () => {
    const { vaultId, nativePath } = await saveClaude();
    await refreshBrowseCache({ store, keys, rows: [await rowFor(vaultId)] });
    const path = join(vaultBrowseDir(), `${vaultId}.jsonl`);
    const before = readFileSync(path, 'utf8');
    appendFileSync(nativePath, `${user('never arrives', cwd)}\n`);
    await settle({ nativePath, harness: 'claude-code', store, keys, config });
    vi.spyOn(store, 'getObject').mockResolvedValue(null);
    const result = await refreshBrowseCache({ store, keys, rows: [await rowFor(vaultId)] });
    expect(result.copies).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.failed).toEqual([{ vaultId, message: expect.stringMatching(/is missing from the backend/) }]);
    expect(readFileSync(path, 'utf8')).toBe(before);
    expect(Object.keys(JSON.parse(readFileSync(join(vaultBrowseDir(), 'manifest.json'), 'utf8')).entries)).toEqual([vaultId]);
  });
});
