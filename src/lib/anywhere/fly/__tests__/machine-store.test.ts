/**
 * PAN-4652 WI-6: fly-machines.json — 0600 atomic writes, a missing file reads
 * empty, a corrupt file throws and is never rewritten, and a no-op change
 * writes nothing.
 */
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Records every lock the store takes, and still takes it for real.
const lockPaths = vi.hoisted(() => [] as string[]);
vi.mock('../../../vault/file-lock.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../vault/file-lock.js')>();
  return {
    ...actual,
    withFileLock: (path: string, fn: () => Promise<unknown>, options?: Parameters<typeof actual.withFileLock>[2]) => {
      lockPaths.push(path);
      return actual.withFileLock(path, fn, options);
    },
  };
});

type Store = typeof import('../machine-store.js');
type FlyMachineRecord = import('../machine-store.js').FlyMachineRecord;

let store: Store;
let home: string;
const originalHome = process.env.OVERDECK_HOME;

function record(overrides: Partial<FlyMachineRecord> = {}): FlyMachineRecord {
  return {
    id: 'rec-1',
    linkId: 'link-1',
    environmentId: 'env-fly',
    machineId: '148e21ea7e1689',
    machineName: 'overdeck-machine-1a2b3c4d',
    appName: 'overdeck-ws',
    region: 'iad',
    label: 'fly-148e21ea7e1689',
    projectKey: 'overdeck',
    docker: true,
    codexAuthPath: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-4652-fly-machines-'));
  process.env.OVERDECK_HOME = home;
  vi.resetModules();
  store = await import('../machine-store.js');
});

afterEach(async () => {
  await store._settleFlyMachineWritesForTests();
  store._resetFlyMachineStoreForTests();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('Fly machine store (PAN-4652 WI-6)', () => {
  it('round-trips a record in a 0600 file', async () => {
    await store.upsertFlyMachine(record());
    const path = join(home, 'fly-machines.json');
    expect(store.flyMachinesPath()).toBe(path);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await store.listFlyMachines()).toEqual([record()]);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ v: 1, machines: [record()] });
  });

  it('reads a zero-byte file (a crash mid-write) as empty', async () => {
    await writeFile(join(home, 'fly-machines.json'), '', 'utf8');
    expect(await store.listFlyMachines()).toEqual([]);
    expect(store.countFlyMachines()).toBe(0);
  });

  it('reads a missing file as empty', async () => {
    expect(await store.listFlyMachines()).toEqual([]);
    expect(store.countFlyMachines()).toBe(0);
  });

  it('throws on a corrupt file and leaves it unchanged', async () => {
    const path = join(home, 'fly-machines.json');
    await writeFile(path, '{"v":1,"machines":[{"id":', 'utf8');
    await expect(store.listFlyMachines()).rejects.toThrow(path);
    await expect(store.upsertFlyMachine(record())).rejects.toThrow(path);
    await writeFile(path, '{"v":2,"machines":[]}', 'utf8');
    expect(() => store.countFlyMachines()).toThrow('unexpected shape');
    expect(await readFile(path, 'utf8')).toBe('{"v":2,"machines":[]}');
  });

  it('removes nothing and writes nothing for an unknown id', async () => {
    expect(await store.removeFlyMachine('missing')).toBeNull();
    await expect(stat(join(home, 'fly-machines.json'))).rejects.toMatchObject({ code: 'ENOENT' });

    await store.upsertFlyMachine(record());
    const path = join(home, 'fly-machines.json');
    const before = await readFile(path, 'utf8');
    const mtime = (await stat(path)).mtimeMs;
    expect(await store.removeFlyMachine('missing')).toBeNull();
    expect(await store.updateFlyMachine('missing', { docker: false })).toBeNull();
    expect(await readFile(path, 'utf8')).toBe(before);
    expect((await stat(path)).mtimeMs).toBe(mtime);
  });

  it('replaces by id, patches, looks up by link id, counts and removes', async () => {
    await store.upsertFlyMachine(record({ linkId: null }));
    expect(await store.getFlyMachineByLinkId('link-1')).toBeNull();
    await store.upsertFlyMachine(record());
    await store.upsertFlyMachine(record({ id: 'rec-2', linkId: 'link-2', machineId: 'm2', label: 'fly-m2' }));
    expect(store.countFlyMachines()).toBe(2);
    expect(await store.getFlyMachineByLinkId('link-2')).toMatchObject({ id: 'rec-2' });

    expect(await store.updateFlyMachine('rec-1', { docker: false, environmentId: 'env-2' })).toEqual(record({ docker: false, environmentId: 'env-2' }));
    await expect(store.updateFlyMachine('rec-1', { region: '' })).rejects.toThrow('unexpected shape');

    expect(await store.removeFlyMachine('rec-2')).toMatchObject({ id: 'rec-2' });
    expect(await store.listFlyMachines()).toEqual([record({ docker: false, environmentId: 'env-2' })]);
  });

  it('keeps every record when upserts run concurrently', async () => {
    await Promise.all(['a', 'b', 'c'].map((id) => store.upsertFlyMachine(record({ id, machineId: id, label: `fly-${id}` }))));
    expect((await store.listFlyMachines()).map((entry) => entry.id).sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('codexAuthPath (PAN-4296 WI-2)', () => {
  it('reads a PAN-4652 record without the field as codexAuthPath: null', async () => {
    const { codexAuthPath: _omitted, ...legacy } = record();
    await writeFile(join(home, 'fly-machines.json'), JSON.stringify({ v: 1, machines: [legacy] }), 'utf8');
    expect(await store.listFlyMachines()).toEqual([record({ codexAuthPath: null })]);
    expect(store.countFlyMachines()).toBe(1);
    expect(await store.updateFlyMachine('rec-1', { docker: false })).toEqual(record({ docker: false, codexAuthPath: null }));
  });

  it('round-trips a record with a Codex auth path', async () => {
    await store.upsertFlyMachine(record({ codexAuthPath: '/.codex/auth.json' }));
    expect(await store.listFlyMachines()).toEqual([record({ codexAuthPath: '/.codex/auth.json' })]);
    expect(await store.updateFlyMachine('rec-1', { codexAuthPath: null })).toEqual(record());
  });

  it('throws "unexpected shape" for a non-text codexAuthPath', async () => {
    const path = join(home, 'fly-machines.json');
    await writeFile(path, JSON.stringify({ v: 1, machines: [{ ...record(), codexAuthPath: 7 }] }), 'utf8');
    await expect(store.listFlyMachines()).rejects.toThrow('unexpected shape');
  });
});

describe('cross-process lock (CodeRabbit on PR #4742)', () => {
  it('runs every read-modify-write under fly-machines.json.lock and leaves no lock behind', async () => {
    lockPaths.length = 0;
    await store.upsertFlyMachine(record());
    await store.updateFlyMachine('rec-1', { docker: false });
    await store.removeFlyMachine('rec-1');
    expect(lockPaths).toEqual(Array(3).fill(join(home, 'fly-machines.json.lock')));
    await expect(stat(join(home, 'fly-machines.json.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
