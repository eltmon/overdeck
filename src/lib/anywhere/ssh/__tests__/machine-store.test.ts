/**
 * PAN-4404 WI-3: ssh-machines.json — 0600 atomic writes, fail-closed parsing,
 * replace by id, patches and concurrent upserts.
 */
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Store = typeof import('../machine-store.js');
type SshMachineRecord = import('../machine-store.js').SshMachineRecord;

let store: Store;
let home: string;
const originalHome = process.env.OVERDECK_HOME;

function record(overrides: Partial<SshMachineRecord> = {}): SshMachineRecord {
  return {
    id: 'rec-1',
    destination: 'me@desk',
    linkId: 'link-1',
    environmentId: 'env-desk',
    localPort: 41234,
    remotePort: 3011,
    launch: 'managed',
    panPath: null,
    forwardPid: null,
    addedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-4404-ssh-machines-'));
  process.env.OVERDECK_HOME = home;
  vi.resetModules();
  store = await import('../machine-store.js');
});

afterEach(async () => {
  await store._settleSshMachineWritesForTests();
  store._resetSshMachineStoreForTests();
  vi.restoreAllMocks();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('SSH machine store (PAN-4404 WI-3)', () => {
  it('round-trips a record in a 0600 file', async () => {
    expect(await store.listSshMachines()).toEqual([]);
    await store.upsertSshMachine(record());
    const path = join(home, 'ssh-machines.json');
    expect(store.sshMachinesPath()).toBe(path);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await store.listSshMachines()).toEqual([record()]);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ v: 1, machines: [record()] });
  });

  it('upsert replaces by id, update merges a patch, remove deletes', async () => {
    await store.upsertSshMachine(record());
    await store.upsertSshMachine(record({ localPort: 41000 }));
    expect((await store.listSshMachines()).map((r) => r.localPort)).toEqual([41000]);

    const updated = await store.updateSshMachine('rec-1', { forwardPid: 4242, launch: 'external' });
    expect(updated).toMatchObject({ id: 'rec-1', forwardPid: 4242, launch: 'external' });
    expect(await store.updateSshMachine('missing', { forwardPid: 1 })).toBeNull();

    expect(await store.removeSshMachine('rec-1')).toMatchObject({ id: 'rec-1' });
    expect(await store.removeSshMachine('rec-1')).toBeNull();
    expect(await store.listSshMachines()).toEqual([]);
  });

  it('getSshMachineByLinkId never matches a provisional record', async () => {
    await store.upsertSshMachine(record({ id: 'rec-p', linkId: null }));
    await store.upsertSshMachine(record({ id: 'rec-2', linkId: 'link-2' }));
    expect(await store.getSshMachineByLinkId('link-2')).toMatchObject({ id: 'rec-2' });
    expect(await store.getSshMachineByLinkId('')).toBeNull();
    expect(await store.getSshMachineByLinkId('link-9')).toBeNull();
  });

  it('a corrupt file yields zero records, one error naming the path, and is never overwritten', async () => {
    const path = join(home, 'ssh-machines.json');
    await writeFile(path, '{ not json', { mode: 0o600 });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await store.listSshMachines()).toEqual([]);
    expect(await store.listSshMachines()).toEqual([]);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]?.[0])).toContain(path);

    await expect(store.upsertSshMachine(record())).rejects.toThrow(path);
    expect(await readFile(path, 'utf8')).toBe('{ not json');
  });

  it('rejects a record with a bad shape', async () => {
    await expect(store.upsertSshMachine(record({ localPort: 0 }))).rejects.toThrow();
    await store.upsertSshMachine(record());
    await expect(store.updateSshMachine('rec-1', { launch: 'bogus' as never })).rejects.toThrow();
  });

  it('two concurrent upserts both persist', async () => {
    await Promise.all([
      store.upsertSshMachine(record({ id: 'a', linkId: 'link-a' })),
      store.upsertSshMachine(record({ id: 'b', linkId: 'link-b' })),
    ]);
    expect((await store.listSshMachines()).map((r) => r.id).sort()).toEqual(['a', 'b']);
  });
});
