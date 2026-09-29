import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Fixture, git } from '../../cli/vault/helpers.js';
import { VAULT_CONFIG_DEFAULTS, type VaultConfig } from '../../../../src/lib/vault/config.js';
import { encryptRef, readSessionRecord, refName, type SessionRecord, type WipSnapshotRef } from '../../../../src/lib/vault/format.js';
import { createVaultKey, deriveSubkeys } from '../../../../src/lib/vault/identity.js';
import { settle, type SettleOptions } from '../../../../src/lib/vault/settle.js';
import { DirVaultStore } from '../../../../src/lib/vault/store/dir.js';
import { WIP_KEEP } from '../../../../src/lib/vault/wip-capture.js';

const keys = deriveSubkeys(createVaultKey());
const SESSION = '11111111-2222-4333-8444-555555555555';
const T0 = Date.parse('2026-09-29T10:00:00.000Z');

function line(type: 'user' | 'assistant', text: string, cwd: string): string {
  return JSON.stringify({ type, sessionId: SESSION, cwd, message: { role: type, content: text } });
}

function isCaptured(wip: WipSnapshotRef | undefined): boolean {
  return wip !== undefined && 'objects' in wip;
}

describe('settle with WIP capture', () => {
  let fixture: Fixture;
  let repo: string;
  let nativePath: string;
  let store: DirVaultStore;
  let config: VaultConfig;
  let lineCount = 0;
  const saved: Record<string, string | undefined> = {};

  beforeEach(async () => {
    fixture = new Fixture();
    fixture.useMachine('a');
    for (const name of ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM']) {
      saved[name] = process.env[name];
      process.env[name] = '/dev/null';
    }
    const bare = fixture.bareRepo();
    repo = join(fixture.root, 'repo');
    git(fixture.root, 'init', '-q', '-b', 'main', repo);
    git(repo, 'config', 'user.name', 'Test');
    git(repo, 'config', 'user.email', 'test@example.invalid');
    writeFileSync(join(repo, 'a.txt'), 'one\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'pushed');
    git(repo, 'remote', 'add', 'origin', bare);
    git(repo, 'push', '-q', '-u', 'origin', 'main');
    nativePath = join(fixture.root, `${SESSION}.jsonl`);
    lineCount = 0;
    writeFileSync(nativePath, '');
    store = await DirVaultStore.open(join(fixture.root, 'vault'));
    config = { ...VAULT_CONFIG_DEFAULTS, exclude: { paths: [], origins: [], sessions: [] }, backend: 'dir' };
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    fixture.cleanup();
  });

  function addTurn(cwd = repo): void {
    lineCount++;
    appendFileSync(nativePath, `${line('user', `turn ${lineCount}`, cwd)}\n`);
  }

  function edit(content: string): void {
    writeFileSync(join(repo, 'a.txt'), `${content}\n`);
  }

  function run(atSec: number, overrides: Partial<SettleOptions> = {}) {
    return settle({ nativePath, harness: 'claude-code', store, keys, config, now: () => new Date(T0 + atSec * 1000), ...overrides });
  }

  async function readRecord(vaultId: string): Promise<SessionRecord> {
    const name = refName('record', vaultId, keys.K_ref);
    const ref = (await store.readRef(name))!;
    return (await readSessionRecord(name, ref.value, keys)) as SessionRecord;
  }

  it('a non-git cwd settles without a wip field', async () => {
    const plain = join(fixture.root, 'plain');
    mkdirSync(plain);
    addTurn(plain);
    const result = await run(0);
    expect(result).toMatchObject({ verdict: 'append', wip: { status: 'no-git' } });
    const record = await readRecord(result.vaultId!);
    expect('wip' in record.settlements[0]!).toBe(false);
  }, 30_000);

  it('captures on the first settle, throttles auto within the interval, and captures when forced', async () => {
    addTurn();
    edit('dirty 1');
    const first = await run(0);
    expect(first).toMatchObject({ verdict: 'append', wip: { status: 'captured' } });
    const vaultId = first.vaultId!;
    expect(isCaptured((await readRecord(vaultId)).settlements[0]!.wip)).toBe(true);

    addTurn();
    edit('dirty 2');
    const throttled = await run(60);
    expect(throttled).toMatchObject({ verdict: 'append', wip: { status: 'throttled' } });
    expect((await readRecord(vaultId)).settlements[1]!.wip).toBeUndefined();

    addTurn();
    const forced = await run(61, { wip: 'force' });
    expect(forced).toMatchObject({ verdict: 'append', wip: { status: 'captured' } });
    expect(isCaptured((await readRecord(vaultId)).settlements[2]!.wip)).toBe(true);
  }, 30_000);

  it('a forced noop settle replaces the latest settlement wip in place', async () => {
    addTurn();
    edit('dirty 1');
    const first = await run(0);
    const vaultId = first.vaultId!;
    const before = await readRecord(vaultId);
    const beforeTree = (before.settlements[0]!.wip as { tree: string }).tree;

    edit('dirty 2');
    expect(await run(10)).toEqual({ verdict: 'noop', vaultId });
    const amended = await run(20, { wip: 'force' });
    expect(amended).toMatchObject({ verdict: 'noop', vaultId, wip: { status: 'captured' } });
    const after = await readRecord(vaultId);
    expect(after.settlements).toHaveLength(before.settlements.length);
    expect((after.settlements[0]!.wip as { tree: string }).tree).not.toBe(beforeTree);
    expect(after.settlements[0]!.wip!.at).toBe(new Date(T0 + 20_000).toISOString());
    expect(after.settlements[0]!.at).toBe(before.settlements[0]!.at);

    expect(await run(30, { wip: 'force' })).toEqual({ verdict: 'noop', vaultId, wip: { status: 'unchanged' } });
  }, 30_000);

  it(`keeps only the ${WIP_KEEP} most recent captured snapshots`, async () => {
    let vaultId = '';
    for (let i = 0; i < 7; i++) {
      addTurn();
      edit(`dirty ${i}`);
      const result = await run(i, { wip: 'force' });
      expect(result).toMatchObject({ verdict: 'append', wip: { status: 'captured' } });
      vaultId = result.vaultId!;
    }
    const record = await readRecord(vaultId);
    expect(record.settlements).toHaveLength(7);
    expect(record.settlements.map((entry) => isCaptured(entry.wip))).toEqual([false, false, true, true, true, true, true]);
  }, 60_000);

  it('never writes wip into a record another machine owns; a fork carries it instead', async () => {
    addTurn();
    edit('dirty 1');
    const first = await run(0);
    const vaultId = first.vaultId!;
    const name = refName('record', vaultId, keys.K_ref);
    const original = await readRecord(vaultId);
    const moved: SessionRecord = { ...original, owner: { environmentId: 'env-other', label: 'laptop' } };
    const current = (await store.readRef(name))!;
    expect(await store.casRef(name, current.version, await encryptRef(name, moved, keys))).toBe('ok');
    const movedBytes = Buffer.from((await store.readRef(name))!.value);

    edit('dirty 2');
    expect(await run(10, { wip: 'force' })).toEqual({ verdict: 'noop', vaultId });
    expect(Buffer.from((await store.readRef(name))!.value).equals(movedBytes)).toBe(true);

    addTurn();
    const forked = await run(20, { wip: 'force' });
    expect(forked).toMatchObject({ verdict: 'append', forkedFrom: { vaultId, version: 1 }, wip: { status: 'captured' } });
    expect(Buffer.from((await store.readRef(name))!.value).equals(movedBytes)).toBe(true);
    const fork = await readRecord(forked.vaultId!);
    expect(isCaptured(fork.settlements[fork.settlements.length - 1]!.wip)).toBe(true);
  }, 30_000);
});
