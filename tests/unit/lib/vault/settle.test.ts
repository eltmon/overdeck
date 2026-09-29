import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureEnvironmentIdentity } from '../../../../src/lib/environment-identity.js';
import { VAULT_CONFIG_DEFAULTS, type VaultConfig } from '../../../../src/lib/vault/config.js';
import { decodeChunk, encryptRef, readSessionRecord, refName, type SessionRecord } from '../../../../src/lib/vault/format.js';
import { createVaultKey, deriveSubkeys } from '../../../../src/lib/vault/identity.js';
import { getOwned } from '../../../../src/lib/vault/local-index.js';
import { isCompactionBoundary, logThroughVersion, settle, transcriptFacts } from '../../../../src/lib/vault/settle.js';
import { DirVaultStore } from '../../../../src/lib/vault/store/dir.js';
import { VaultOfflineError, type VaultStore } from '../../../../src/lib/vault/store/types.js';

const keys = deriveSubkeys(createVaultKey());
const SESSION = '11111111-2222-4333-8444-555555555555';
const API_KEY = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';

function user(text: string, cwd: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ type: 'user', sessionId: SESSION, cwd, message: { role: 'user', content: text }, ...extra });
}
function assistant(text: string, cwd: string): string {
  return JSON.stringify({ type: 'assistant', sessionId: SESSION, cwd, message: { role: 'assistant', model: 'claude-fable-5-1', content: [{ type: 'text', text }] } });
}

describe('vault settle', () => {
  let root: string;
  let home: string;
  let cwd: string;
  let nativePath: string;
  let store: DirVaultStore;
  let config: VaultConfig;
  let originalHome: string | undefined;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'pan-vault-settle-'));
    home = join(root, '.overdeck');
    cwd = join(root, 'project-alpha');
    mkdirSync(cwd, { recursive: true });
    originalHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = home;
    nativePath = join(root, `${SESSION}.jsonl`);
    writeFileSync(nativePath, [user('fix the parser bug', cwd), assistant('Looking into it.', cwd), user('thanks', cwd)].join('\n') + '\n');
    store = await DirVaultStore.open(join(root, 'backend'));
    config = { ...VAULT_CONFIG_DEFAULTS, exclude: { paths: [], origins: [], sessions: [] }, backend: 'dir' };
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(root, { recursive: true, force: true });
  });

  async function readRecord(vaultId: string): Promise<SessionRecord> {
    const name = refName('record', vaultId, keys.K_ref);
    const ref = (await store.readRef(name))!;
    return (await readSessionRecord(name, ref.value, keys)) as SessionRecord;
  }

  it('ac1: the first settlement saves everything; the second uploads only the 2 new lines', async () => {
    const first = await settle({ nativePath, harness: 'claude-code', store, keys, config });
    expect(first.verdict).toBe('append');
    if (first.verdict !== 'append') return;
    expect(first.lines).toBe(3);
    expect(first.version).toBe(1);
    expect(first.chunks).toHaveLength(1);

    const record = await readRecord(first.vaultId);
    const me = await ensureEnvironmentIdentity();
    expect(record).toMatchObject({
      type: 'session',
      vaultId: first.vaultId,
      owner: { environmentId: me.environmentId },
      harness: 'claude-code',
      nativeSessionId: SESSION,
      title: 'fix the parser bug',
      model: 'claude-fable-5-1',
      project: 'project-alpha',
      cwd,
      log: first.chunks,
      view: { fromChunk: 0, fromLine: 0 },
      parent: null,
      tombstone: false,
    });
    expect(record.settlements).toHaveLength(1);
    expect(record.settlements[0]).toMatchObject({ chunk: first.chunks[0], turn: 2, lines: 3 });
    expect(record.segments[0]!.tail.lineCount).toBe(3);
    expect((await getOwned(nativePath))!.tail.lineCount).toBe(3);

    expect((await settle({ nativePath, harness: 'claude-code', store, keys, config })).verdict).toBe('noop');

    const added = [user('now add tests', cwd), assistant('Done.', cwd)];
    appendFileSync(nativePath, added.join('\n') + '\n');
    const second = await settle({ nativePath, harness: 'claude-code', store, keys, config });
    expect(second.verdict).toBe('append');
    if (second.verdict !== 'append') return;
    expect(second.vaultId).toBe(first.vaultId);
    expect(second.lines).toBe(2);
    expect(second.version).toBe(2);
    expect(second.chunks).toHaveLength(1);
    const chunk = await decodeChunk((await store.getObject(second.chunks[0]!))!, second.chunks[0]!, keys);
    expect(chunk.lines).toEqual(added);
    const after = await readRecord(first.vaultId);
    expect(after.log).toEqual([...first.chunks, ...second.chunks]);
    expect(after.settlements.map((entry) => entry.lines)).toEqual([3, 5]);
    expect(after.settlements.map((entry) => entry.logLines)).toEqual([3, 5]);
    expect(after.settlements[1]!.turn).toBe(3);
  });

  it('ac2: a changed saved line is diverged and touches neither objects nor refs', async () => {
    const first = await settle({ nativePath, harness: 'claude-code', store, keys, config });
    expect(first.verdict).toBe('append');
    const lines = readFileSync(nativePath, 'utf8').split('\n');
    lines[1] = assistant('EDITED  content!', cwd); // same length as the original, so only the hash differs
    writeFileSync(nativePath, lines.join('\n'));
    const putSpy = vi.spyOn(store, 'putObjects');
    const casSpy = vi.spyOn(store, 'casRef');
    const result = await settle({ nativePath, harness: 'claude-code', store, keys, config });
    expect(result.verdict).toBe('diverged');
    expect(result).toMatchObject({ reason: expect.stringContaining('line 2') });
    expect(putSpy).not.toHaveBeenCalled();
    expect(casSpy).not.toHaveBeenCalled();
    expect((await getOwned(nativePath))!.tail.lineCount).toBe(3);
  });

  it('ac3: a new line with an API key blocks with the line number and pattern, writing nothing', async () => {
    const first = await settle({ nativePath, harness: 'claude-code', store, keys, config });
    expect(first.verdict).toBe('append');
    appendFileSync(nativePath, user(`here: ${API_KEY}`, cwd) + '\n');
    const putSpy = vi.spyOn(store, 'putObjects');
    const casSpy = vi.spyOn(store, 'casRef');
    const result = await settle({ nativePath, harness: 'claude-code', store, keys, config });
    expect(result).toEqual({ verdict: 'blocked', vaultId: (first as { vaultId: string }).vaultId, hits: [{ line: 4, pattern: 'api-key' }] });
    expect(JSON.stringify(result)).not.toContain(API_KEY.slice(0, 12));
    expect(putSpy).not.toHaveBeenCalled();
    expect(casSpy).not.toHaveBeenCalled();
    expect((await getOwned(nativePath))!.tail.lineCount).toBe(3);
  });

  it('ac4: when another machine owns the record, new lines become a fork owned here', async () => {
    const first = await settle({ nativePath, harness: 'claude-code', store, keys, config });
    if (first.verdict !== 'append') throw new Error('expected append');
    const name = refName('record', first.vaultId, keys.K_ref);
    const original = await readRecord(first.vaultId);
    const moved: SessionRecord = { ...original, owner: { environmentId: 'env-other', label: 'laptop' } };
    const before = (await store.readRef(name))!;
    expect(await store.casRef(name, before.version, await encryptRef(name, moved, keys))).toBe('ok');
    const movedVersion = (await store.readRef(name))!.version;

    appendFileSync(nativePath, user('continuing offline', cwd) + '\n');
    const result = await settle({ nativePath, harness: 'claude-code', store, keys, config });
    expect(result.verdict).toBe('append');
    if (result.verdict !== 'append') return;
    expect(result.vaultId).not.toBe(first.vaultId);
    expect(result.forkedFrom).toEqual({ vaultId: first.vaultId, version: 1 });

    expect((await store.readRef(name))!.version).toBe(movedVersion);
    expect(await readRecord(first.vaultId)).toEqual(moved);

    const me = await ensureEnvironmentIdentity();
    const fork = await readRecord(result.vaultId);
    expect(fork.owner).toEqual({ environmentId: me.environmentId, label: me.label });
    expect(fork.parent).toEqual({ vaultId: first.vaultId, version: 1 });
    expect(fork.title).toBe(`fix the parser bug (continued on ${me.label})`);
    expect(fork.log).toEqual([...original.log, ...result.chunks]);
    expect(fork.settlements.map((entry) => entry.lines)).toEqual([3, 4]);
    expect((await getOwned(nativePath))!.vaultId).toBe(result.vaultId);
  });

  it('ac5: VaultOfflineError yields offline and leaves the local index tail unchanged', async () => {
    const first = await settle({ nativePath, harness: 'claude-code', store, keys, config });
    expect(first.verdict).toBe('append');
    appendFileSync(nativePath, user('more', cwd) + '\n');
    const offline: VaultStore = {
      ...store,
      putObjects: async () => { throw new VaultOfflineError('remote down'); },
      readRef: (name) => store.readRef(name),
      getObject: (id) => store.getObject(id),
      hasObjects: (ids) => store.hasObjects(ids),
      casRef: () => { throw new Error('casRef must not run when putObjects failed'); },
      listRefs: (prefix) => store.listRefs(prefix),
      refresh: async () => undefined,
    };
    const result = await settle({ nativePath, harness: 'claude-code', store: offline, keys, config });
    expect(result).toEqual({ verdict: 'offline', vaultId: (first as { vaultId: string }).vaultId });
    expect((await getOwned(nativePath))!.tail.lineCount).toBe(3);

    const fresh = join(root, 'fresh.jsonl');
    writeFileSync(fresh, user('x', cwd) + '\n');
    expect(await settle({ nativePath: fresh, harness: 'claude-code', store: offline, keys, config })).toEqual({ verdict: 'offline', vaultId: null });
    expect(await getOwned(fresh)).toBeNull();
  });

  it('excluded sessions are skipped before any read of the backend', async () => {
    const excluded = { ...config, exclude: { paths: [cwd], origins: [], sessions: [] } };
    const readSpy = vi.spyOn(store, 'readRef');
    expect(await settle({ nativePath, harness: 'claude-code', store, keys, config: excluded })).toEqual({ verdict: 'excluded', vaultId: null });
    expect(readSpy).not.toHaveBeenCalled();
    const bySession = { ...config, exclude: { paths: [], origins: [], sessions: [SESSION] } };
    expect((await settle({ nativePath, harness: 'claude-code', store, keys, config: bySession })).verdict).toBe('excluded');
  });

  it('a compaction boundary moves the VIEW to that chunk and line', async () => {
    const first = await settle({ nativePath, harness: 'claude-code', store, keys, config });
    if (first.verdict !== 'append') throw new Error('expected append');
    appendFileSync(nativePath, [assistant('a', cwd), user('summary of everything so far', cwd, { isCompactSummary: true }), user('next', cwd)].join('\n') + '\n');
    const second = await settle({ nativePath, harness: 'claude-code', store, keys, config });
    if (second.verdict !== 'append') throw new Error('expected append');
    const record = await readRecord(first.vaultId);
    expect(record.view).toEqual({ fromChunk: 1, fromLine: 1 });
    expect(record.settlements[1]!.turn).toBe(3);
    expect(isCompactionBoundary(JSON.stringify({ type: 'compacted' }), 'codex')).toBe(true);
    expect(isCompactionBoundary(JSON.stringify({ type: 'compacted' }), 'claude-code')).toBe(false);
  });

  it('a partial trailing line is left for the next settlement', async () => {
    appendFileSync(nativePath, '{"type":"user","message":{"content":"in prog');
    const first = await settle({ nativePath, harness: 'claude-code', store, keys, config });
    if (first.verdict !== 'append') throw new Error('expected append');
    expect(first.lines).toBe(3);
    appendFileSync(nativePath, 'ress"}}\n');
    const second = await settle({ nativePath, harness: 'claude-code', store, keys, config });
    expect(second).toMatchObject({ verdict: 'append', lines: 1 });
  });

  it('transcriptFacts reads Codex session_meta and turn_context; logThroughVersion slices the log', () => {
    const codex = [
      JSON.stringify({ type: 'session_meta', payload: { id: 'thread-1', cwd: '/w/x' } }),
      JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5.5' } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello codex' }] } }),
    ];
    expect(transcriptFacts(codex, 'codex')).toEqual({ cwd: '/w/x', nativeSessionId: 'thread-1', model: 'gpt-5.5', title: 'hello codex' });
    const record = { log: ['c1', 'c2', 'c3', 'c4'], settlements: [{ chunk: 'c1' }, { chunk: 'c3' }, { chunk: 'c4' }] } as unknown as SessionRecord;
    expect(logThroughVersion(record, 2)).toEqual(['c1', 'c2', 'c3']);
    expect(logThroughVersion(record, 1)).toEqual(['c1']);
    expect(logThroughVersion(record, 9)).toEqual(['c1', 'c2', 'c3', 'c4']);
  });
});
