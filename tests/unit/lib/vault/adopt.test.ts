import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureEnvironmentIdentity, type EnvironmentIdentity } from '../../../../src/lib/environment-identity.js';
import { adoptRecord, forkRecordAtVersion, materializeOwned } from '../../../../src/lib/vault/adopt.js';
import { VAULT_CONFIG_DEFAULTS, type VaultConfig } from '../../../../src/lib/vault/config.js';
import { readSessionRecord, refName, type SessionRecord } from '../../../../src/lib/vault/format.js';
import { createVaultKey, deriveSubkeys } from '../../../../src/lib/vault/identity.js';
import { getOwned, readListCache } from '../../../../src/lib/vault/local-index.js';
import { settle } from '../../../../src/lib/vault/settle.js';
import { DirVaultStore } from '../../../../src/lib/vault/store/dir.js';
import { syncOnce } from '../../../../src/lib/vault/sync.js';

const keys = deriveSubkeys(createVaultKey());
const SESSION = '33333333-3333-4333-8333-333333333333';

function line(type: 'user' | 'assistant', text: string, cwd: string): string {
  const content = type === 'user' ? text : [{ type: 'text', text }];
  return JSON.stringify({ type, sessionId: SESSION, cwd, message: { role: type, content } });
}

describe('vault adopt', () => {
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
    root = mkdtempSync(join(tmpdir(), 'pan-vault-adopt-'));
    homeA = join(root, 'a', '.overdeck');
    homeB = join(root, 'b', '.overdeck');
    cwd = join(root, 'repo');
    mkdirSync(cwd, { recursive: true });
    originalHome = process.env.OVERDECK_HOME;
    useHome(homeA);
    nativePath = join(root, `${SESSION}.jsonl`);
    writeFileSync(nativePath, [line('user', 'q1', cwd), line('assistant', 'a1', cwd)].join('\n') + '\n');
    store = await DirVaultStore.open(join(root, 'backend'));
    config = { ...VAULT_CONFIG_DEFAULTS, exclude: { paths: [], origins: [], sessions: [] }, backend: 'dir' };
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(root, { recursive: true, force: true });
  });

  async function readRecord(vaultId: string): Promise<{ record: SessionRecord; version: string }> {
    const name = refName('record', vaultId, keys.K_ref);
    const ref = (await store.readRef(name))!;
    return { record: (await readSessionRecord(name, ref.value, keys)) as SessionRecord, version: ref.version };
  }

  async function settleOnA(): Promise<string> {
    const result = await settle({ nativePath, harness: 'claude-code', store, keys, config });
    if (result.verdict !== 'append') throw new Error(`expected append, got ${result.verdict}`);
    return result.vaultId;
  }

  it('ac1: two machines adopting concurrently yield one owner; the loser writes no native file', async () => {
    const vaultId = await settleOnA();
    const machineB: EnvironmentIdentity = { v: 1, environmentId: 'env-b', label: 'laptop-b', createdAt: 'x' };
    const machineC: EnvironmentIdentity = { v: 1, environmentId: 'env-c', label: 'desktop-c', createdAt: 'x' };
    useHome(homeB);
    const rootB = join(root, 'projects-b');
    const rootC = join(root, 'projects-c');
    const [resultB, resultC] = await Promise.all([
      adoptRecord({ vaultId, store, keys, targetCwd: cwd, identity: machineB, projectsRoot: rootB, newSessionId: 'bbbbbbbb-0000-4000-8000-000000000000' }),
      adoptRecord({ vaultId, store, keys, targetCwd: cwd, identity: machineC, projectsRoot: rootC, newSessionId: 'cccccccc-0000-4000-8000-000000000000' }),
    ]);
    const winners = [resultB, resultC].filter((result) => result.adopted);
    const losers = [resultB, resultC].filter((result) => !result.adopted);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    const winner = winners[0] as Extract<typeof resultB, { adopted: true }>;
    const loser = losers[0] as Extract<typeof resultB, { adopted: false }>;
    const winnerIdentity = winner.newSessionId.startsWith('b') ? machineB : machineC;
    expect(loser.alreadyContinuedOn).toBe(winnerIdentity.label);

    const { record } = await readRecord(vaultId);
    expect(record.owner).toEqual({ environmentId: winnerIdentity.environmentId, label: winnerIdentity.label });
    expect(record.lineage).toEqual([{ environmentId: winnerIdentity.environmentId, adoptedAt: expect.any(String) }]);
    expect(record.segments).toHaveLength(2);
    expect(record.segments[1]).toMatchObject({ environmentId: winnerIdentity.environmentId, nativeSessionId: winner.newSessionId, logStart: 2, prefix: { lineCount: 2, sessionIdFrom: SESSION, sessionIdTo: winner.newSessionId } });

    expect(existsSync(winner.path)).toBe(true);
    const loserRoot = winnerIdentity === machineB ? rootC : rootB;
    expect(existsSync(loserRoot)).toBe(false);
    const written = readFileSync(winner.path, 'utf8').split('\n').filter(Boolean);
    expect(written).toHaveLength(2);
    for (const entry of written) expect(JSON.parse(entry).sessionId).toBe(winner.newSessionId);
    expect((await getOwned(winner.path))!.vaultId).toBe(vaultId);
  });

  it('refuses to adopt a record this machine already owns', async () => {
    const vaultId = await settleOnA();
    await expect(adoptRecord({ vaultId, store, keys, targetCwd: cwd, projectsRoot: join(root, 'p') })).rejects.toThrow(/already owned by this machine/);
    await expect(adoptRecord({ vaultId: 'missing', store, keys, targetCwd: cwd })).rejects.toThrow(/not found/);
  });

  it('ac2: after B adopts, A sync shows B as owner and A native file is unchanged', async () => {
    const vaultId = await settleOnA();
    const bytesA = readFileSync(nativePath);
    useHome(homeB);
    const b = await ensureEnvironmentIdentity();
    const result = await adoptRecord({ vaultId, store, keys, targetCwd: join(root, 'b-cwd'), projectsRoot: join(root, 'projects-b') });
    expect(result.adopted).toBe(true);

    useHome(homeA);
    const report = await syncOnce({ store, keys, config });
    expect(report.offline).toBe(false);
    expect(await readListCache()).toEqual([expect.objectContaining({ vaultId, ownerLabel: b.label, ownerIsHere: false })]);
    expect(readFileSync(nativePath).equals(bytesA)).toBe(true);

    // A appends after losing ownership: P-6 fork, original untouched.
    appendFileSync(nativePath, line('user', 'typed on A later', cwd) + '\n');
    const before = await readRecord(vaultId);
    const later = await settle({ nativePath, harness: 'claude-code', store, keys, config });
    expect(later).toMatchObject({ verdict: 'append', forkedFrom: { vaultId, version: 1 } });
    expect((await readRecord(vaultId)).version).toBe(before.version);
  });

  it('ac3: forkRecordAtVersion 2 of 3 creates a child with the parent through version 2, parent ref unchanged', async () => {
    const vaultId = await settleOnA();
    appendFileSync(nativePath, line('user', 'q2', cwd) + '\n');
    await settleOnA();
    appendFileSync(nativePath, line('user', 'q3', cwd) + '\n');
    await settleOnA();
    const parent = await readRecord(vaultId);
    expect(parent.record.settlements).toHaveLength(3);

    const fork = await forkRecordAtVersion({ vaultId, version: 2, store, keys });
    expect(fork.vaultId).not.toBe(vaultId);
    expect(fork.record.parent).toEqual({ vaultId, version: 2 });
    expect(fork.record.log).toEqual(parent.record.log.slice(0, 2));
    expect(fork.record.settlements).toEqual(parent.record.settlements.slice(0, 2));
    expect(fork.record.title).toBe(`${parent.record.title} @2`);
    expect(fork.record.segments).toEqual([]);
    const me = await ensureEnvironmentIdentity();
    expect(fork.record.owner.environmentId).toBe(me.environmentId);
    expect((await readRecord(fork.vaultId)).record).toEqual(fork.record);
    expect((await readRecord(vaultId)).version).toBe(parent.version);
    expect((await store.listRefs('r/')).length).toBe(2);

    await expect(forkRecordAtVersion({ vaultId, version: 4, store, keys })).rejects.toThrow(/versions 1\.\.3/);
    await expect(forkRecordAtVersion({ vaultId, version: 0, store, keys })).rejects.toThrow(/versions 1\.\.3/);

    // The owned fork materializes directly and then has a segment here.
    const projectsRoot = join(root, 'projects-a');
    const materialized = await materializeOwned({ vaultId: fork.vaultId, store, keys, targetCwd: cwd, projectsRoot });
    expect(materialized.adopted).toBe(true);
    if (!materialized.adopted) return;
    expect(readFileSync(materialized.path, 'utf8').split('\n').filter(Boolean)).toHaveLength(3);
    expect(readdirSync(projectsRoot)).toHaveLength(1);
    expect((await readRecord(fork.vaultId)).record.segments).toHaveLength(1);
    await expect(materializeOwned({ vaultId: fork.vaultId, store, keys, targetCwd: cwd, projectsRoot })).rejects.toThrow(/already has a native file/);
    await expect(materializeOwned({ vaultId, store, keys, targetCwd: cwd, projectsRoot })).rejects.toThrow(/already has a native file/);
  });
});
