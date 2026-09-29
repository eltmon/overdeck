import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureEnvironmentIdentity } from '../../../../src/lib/environment-identity.js';
import { VAULT_CONFIG_DEFAULTS, type VaultConfig } from '../../../../src/lib/vault/config.js';
import { splitSettleableLines, tailOf } from '../../../../src/lib/vault/continuity.js';
import { encryptRef, readSessionRecord, refName, type SessionRecord } from '../../../../src/lib/vault/format.js';
import { createVaultKey, deriveSubkeys } from '../../../../src/lib/vault/identity.js';
import { setOwnedTail } from '../../../../src/lib/vault/local-index.js';
import { materializeClaude, restoreNative, rewriteLine } from '../../../../src/lib/vault/materialize.js';
import { settle } from '../../../../src/lib/vault/settle.js';
import { DirVaultStore } from '../../../../src/lib/vault/store/dir.js';

const keys = deriveSubkeys(createVaultKey());
const OLD_SESSION = '11111111-1111-4111-8111-111111111111';
const NEW_SESSION = '22222222-2222-4222-8222-222222222222';

function line(type: 'user' | 'assistant', text: string, cwd: string, sessionId = OLD_SESSION, extra: Record<string, unknown> = {}): string {
  const content = type === 'user' ? text : [{ type: 'text', text }];
  return JSON.stringify({ type, sessionId, cwd, uuid: `u-${text.length}-${type}`, message: { role: type, content }, ...extra });
}

describe('vault materialize', () => {
  let root: string;
  let homeA: string;
  let homeB: string;
  let cwd: string;
  let nativePath: string;
  let store: DirVaultStore;
  let config: VaultConfig;
  let originalHome: string | undefined;
  const useHome = (home: string) => { process.env.OVERDECK_HOME = home; };

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'pan-vault-mat-'));
    homeA = join(root, 'a', '.overdeck');
    homeB = join(root, 'b', '.overdeck');
    cwd = join(root, 'work', 'repo');
    mkdirSync(cwd, { recursive: true });
    originalHome = process.env.OVERDECK_HOME;
    useHome(homeA);
    nativePath = join(root, `${OLD_SESSION}.jsonl`);
    writeFileSync(nativePath, [
      line('user', 'first question', cwd),
      line('assistant', 'first answer', cwd),
      line('user', 'second question', cwd),
    ].join('\n') + '\n');
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
    return (await readSessionRecord(name, (await store.readRef(name))!.value, keys)) as SessionRecord;
  }

  async function settleAll(): Promise<string> {
    const result = await settle({ nativePath, harness: 'claude-code', store, keys, config });
    if (result.verdict !== 'append') throw new Error(`expected append, got ${result.verdict}`);
    return result.vaultId;
  }

  it('rewriteLine changes only the named sessionId and cwd values', () => {
    const original = line('user', 'x', '/old/cwd');
    const rewritten = rewriteLine(original, { sessionIdsFrom: [OLD_SESSION], sessionIdTo: NEW_SESSION, cwdsFrom: ['/old/cwd'], cwdTo: '/new/cwd' });
    expect(rewritten).toBe(original.replace(OLD_SESSION, NEW_SESSION).replace('/old/cwd', '/new/cwd'));
    expect(rewriteLine(original, { sessionIdsFrom: ['other'], sessionIdTo: NEW_SESSION, cwdsFrom: [], cwdTo: null })).toBe(original);
    const mention = JSON.stringify({ type: 'user', sessionId: OLD_SESSION, message: { content: `see ${OLD_SESSION} and ${JSON.stringify({ sessionId: OLD_SESSION })}` } });
    const out = rewriteLine(mention, { sessionIdsFrom: [OLD_SESSION], sessionIdTo: NEW_SESSION, cwdsFrom: [], cwdTo: null });
    expect(out).toContain(`"sessionId":"${NEW_SESSION}"`);
    expect(out).toContain(`see ${OLD_SESSION} and`);
  });

  it('ac1: materializes from the compaction boundary, changing only the sessionId of each line', async () => {
    const vaultId = await settleAll();
    const boundary = line('user', 'summary of the conversation so far', cwd, OLD_SESSION, { isCompactSummary: true });
    appendFileSync(nativePath, [line('assistant', 'second answer', cwd), boundary, line('user', 'after compaction', cwd)].join('\n') + '\n');
    await settleAll();
    const record = await readRecord(vaultId);
    expect(record.view).toEqual({ fromChunk: 1, fromLine: 1 });

    const projectsRoot = join(root, 'claude-projects');
    const result = await materializeClaude({ record, store, keys, targetCwd: cwd, newSessionId: NEW_SESSION, projectsRoot });
    expect(result.path).toBe(join(projectsRoot, cwd.replace(/[^a-zA-Z0-9-]/g, '-'), `${NEW_SESSION}.jsonl`));
    expect(result.lines).toBe(2);
    expect(result.prefix).toEqual({
      viewFromChunk: 1, viewFromLine: 1, logEnd: 6, sessionIdFrom: OLD_SESSION, sessionIdTo: NEW_SESSION, cwdFrom: cwd, cwdTo: cwd, lineCount: 2,
    });
    const written = readFileSync(result.path, 'utf8');
    const saved = readFileSync(nativePath, 'utf8').split('\n').filter(Boolean);
    const writtenLines = written.split('\n').filter(Boolean);
    expect(writtenLines[0]).toBe(boundary.replace(OLD_SESSION, NEW_SESSION));
    expect(writtenLines).toEqual(saved.slice(4).map((entry) => entry.replace(`"sessionId":"${OLD_SESSION}"`, `"sessionId":"${NEW_SESSION}"`)));
    for (const entry of writtenLines) {
      expect(entry).not.toContain(OLD_SESSION);
      expect(JSON.parse(entry).cwd).toBe(cwd); // cwd unchanged when the target is the saved cwd
    }
  });

  it('rewrites cwd when the target differs and refuses to overwrite (ac4)', async () => {
    const vaultId = await settleAll();
    const record = await readRecord(vaultId);
    const projectsRoot = join(root, 'claude-projects');
    const other = join(root, 'elsewhere');
    const result = await materializeClaude({ record, store, keys, targetCwd: other, newSessionId: NEW_SESSION, projectsRoot });
    const lines = readFileSync(result.path, 'utf8').split('\n').filter(Boolean);
    expect(lines).toHaveLength(3);
    for (const entry of lines) {
      const parsed = JSON.parse(entry);
      expect(parsed.cwd).toBe(other);
      expect(parsed.sessionId).toBe(NEW_SESSION);
    }
    const before = readFileSync(result.path);
    await expect(materializeClaude({ record, store, keys, targetCwd: other, newSessionId: NEW_SESSION, projectsRoot })).rejects.toThrow(/Refusing to overwrite/);
    expect(readFileSync(result.path).equals(before)).toBe(true);
  });

  it('ac2: restoreNative rebuilds the original owner file byte for byte', async () => {
    const vaultId = await settleAll();
    appendFileSync(nativePath, [line('assistant', 'more → 世界', cwd), line('user', 'ok', cwd)].join('\n') + '\n');
    await settleAll();
    const original = readFileSync(nativePath);
    rmSync(nativePath);
    const record = await readRecord(vaultId);
    const restored = await restoreNative({ record, store, keys, nativePath });
    expect(restored.lines).toBe(5);
    expect(readFileSync(nativePath).equals(original)).toBe(true);
    await expect(restoreNative({ record, store, keys, nativePath })).rejects.toThrow(/Refusing to overwrite/);
  });

  it('ac3: restoreNative rebuilds an adopted segment exactly as the adopter settled it', async () => {
    const vaultId = await settleAll();
    const a = await ensureEnvironmentIdentity();
    let record = await readRecord(vaultId);

    // Machine B materializes into a different cwd and continues the conversation.
    useHome(homeB);
    const b = await ensureEnvironmentIdentity();
    const targetCwd = join(root, 'b-work');
    mkdirSync(targetCwd, { recursive: true });
    const projectsRoot = join(root, 'b-claude-projects');
    const materialized = await materializeClaude({ record, store, keys, targetCwd, newSessionId: NEW_SESSION, projectsRoot });
    const adopterFile = materialized.path;
    const adopterLines = splitSettleableLines(readFileSync(adopterFile)).lines;

    const name = refName('record', vaultId, keys.K_ref);
    const current = (await store.readRef(name))!;
    const adopted: SessionRecord = {
      ...record,
      owner: { environmentId: b.environmentId, label: b.label },
      nativeSessionId: NEW_SESSION,
      cwd: targetCwd,
      lineage: [{ environmentId: b.environmentId, adoptedAt: 'now' }],
      segments: [
        ...record.segments,
        {
          environmentId: b.environmentId,
          nativeSessionId: NEW_SESSION,
          logStart: record.log.length === 0 ? 0 : materialized.prefix.logEnd,
          prefix: materialized.prefix,
          tail: tailOf(adopterLines, Buffer.byteLength(readFileSync(adopterFile, 'utf8'))),
        },
      ],
    };
    expect(await store.casRef(name, current.version, await encryptRef(name, adopted, keys))).toBe('ok');
    await setOwnedTail(adopterFile, { vaultId, harness: 'claude-code', tail: adopted.segments[1]!.tail });

    appendFileSync(adopterFile, [line('assistant', 'continuing on B', targetCwd, NEW_SESSION), line('user', 'thanks B', targetCwd, NEW_SESSION)].join('\n') + '\n');
    const settled = await settle({ nativePath: adopterFile, harness: 'claude-code', store, keys, config });
    expect(settled).toMatchObject({ verdict: 'append', vaultId, lines: 2 });
    record = await readRecord(vaultId);
    expect(record.log).toHaveLength(2);
    expect(record.segments[1]!.tail.lineCount).toBe(5);

    const asSettled = readFileSync(adopterFile);
    rmSync(adopterFile);
    const restored = await restoreNative({ record, store, keys, nativePath: adopterFile });
    expect(restored.lines).toBe(5);
    expect(readFileSync(adopterFile).equals(asSettled)).toBe(true);

    // A's own segment still restores to A's original bytes.
    useHome(homeA);
    const originalA = readFileSync(nativePath);
    rmSync(nativePath);
    await restoreNative({ record, store, keys, nativePath, environmentId: a.environmentId });
    expect(readFileSync(nativePath).equals(originalA)).toBe(true);
    expect(existsSync(adopterFile)).toBe(true);
  });
});
