/**
 * PAN-4645 WI-11: machine-links.json — 0600 atomic writes, fail-closed parsing,
 * replace-by-environment-id, concurrent upserts, routes, revoke and the snapshot.
 */
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Store = typeof import('../link-store.js');

let store: Store;
let home: string;
const originalHome = process.env.OVERDECK_HOME;
const KEY_A = 'a1'.repeat(32);
const KEY_B = 'b2'.repeat(32);
const AT = '2026-11-01T00:00:00.000Z';

async function freshModule(): Promise<Store> {
  vi.resetModules();
  return import('../link-store.js');
}

function input(overrides: Partial<Parameters<Store['upsertLink']>[0]> = {}): Parameters<Store['upsertLink']>[0] {
  return {
    environmentId: 'env-desk',
    label: 'desk',
    machineKey: KEY_A,
    token: 'odk_first',
    access: 'operator',
    reverseTokenId: 'rev-1',
    routes: [{ url: 'tcp://100.101.1.2:3011', kind: 'tailnet', source: 'pairing', addedAt: AT }],
    ...overrides,
  };
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-4645-links-'));
  process.env.OVERDECK_HOME = home;
  store = await freshModule();
});

afterEach(async () => {
  await store._settleLinkStoreWritesForTests();
  store._resetLinkStoreForTests();
  vi.restoreAllMocks();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('machine-link store (PAN-4645 WI-11)', () => {
  it('ac1: the first upsert creates machine-links.json with mode 0600 and listLinks returns it', async () => {
    expect(await store.listLinks()).toEqual([]);
    const { link, replaced } = await store.upsertLink(input());
    expect(replaced).toBeNull();
    const path = join(home, 'machine-links.json');
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    const listed = await store.listLinks();
    expect(listed).toEqual([link]);
    expect(listed[0]).toMatchObject({ environmentId: 'env-desk', label: 'desk', machineKey: KEY_A, token: 'odk_first', access: 'operator', reverseTokenId: 'rev-1', revokedAt: null });
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ v: 1, links: [link] });
    expect(await store.getLink(link.id)).toEqual(link);
    expect(await store.getLink('env-desk')).toEqual(link);
    expect(await store.getLink('desk')).toEqual(link);
    expect(await store.getLink('nobody')).toBeNull();
    expect(store.hasActiveLinks()).toBe(true);
  });

  it('ac2: a corrupt file yields zero links, a loud error naming the file, and is never overwritten', async () => {
    const path = join(home, 'machine-links.json');
    await store.upsertLink(input());
    await writeFile(path, '{ not json', 'utf8');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await store.listLinks()).toEqual([]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]![0])).toContain(path);
    expect(store.linksSnapshot()).toEqual([]);
    expect(store.hasActiveLinks()).toBe(false);

    await expect(store.upsertLink(input({ environmentId: 'env-other', machineKey: KEY_B }))).rejects.toThrow(path);
    expect(await readFile(path, 'utf8')).toBe('{ not json');
    await expect(store.refreshLinkStore()).rejects.toThrow(path);
    // The same error is logged once, not on every read.
    expect(errorSpy).toHaveBeenCalledTimes(1);

    await writeFile(path, JSON.stringify({ v: 1, links: [{ id: 'x', environmentId: 'e', label: 'l', machineKey: 'short', token: 'odk_a', access: 'operator', reverseTokenId: null, routes: [], createdAt: AT, revokedAt: null }] }));
    expect(await store.listLinks()).toEqual([]);
    expect(String(errorSpy.mock.calls.at(-1)![0])).toContain('unexpected shape');
  });

  it('ac3: a second link to the same environment id replaces the first and reports what it replaced', async () => {
    const first = await store.upsertLink(input());
    const second = await store.upsertLink(input({ token: 'odk_second', machineKey: KEY_B, reverseTokenId: 'rev-2' }));
    expect(second.replaced).toEqual(first.link);
    const links = await store.listLinks();
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ environmentId: 'env-desk', token: 'odk_second', machineKey: KEY_B, reverseTokenId: 'rev-2' });
    expect(links[0]!.id).not.toBe(first.link.id);
  });

  it('two concurrent upserts to different machines both persist', async () => {
    const [a, b] = await Promise.all([
      store.upsertLink(input()),
      store.upsertLink(input({ environmentId: 'env-lab', label: 'lab', machineKey: KEY_B, token: 'odk_lab' })),
    ]);
    const links = await store.listLinks();
    expect(links.map((link) => link.id).sort()).toEqual([a.link.id, b.link.id].sort());
  });

  it('removes, revokes and re-routes links, and refuses malformed input', async () => {
    const { link } = await store.upsertLink(input());
    const routes = [...link.routes, { url: 'tcp://192.168.1.20:3011', kind: 'lan' as const, source: 'advertised' as const, addedAt: AT }];
    expect(await store.setLinkRoutes(link.id, routes)).toMatchObject({ routes });
    expect(await store.setLinkRoutes('missing', routes)).toBeNull();

    const revoked = await store.markLinkRevoked(link.id);
    expect(revoked?.revokedAt).toEqual(expect.any(String));
    expect(await store.markLinkRevoked(link.id)).toEqual(revoked);
    await store.refreshLinkStore();
    expect(store.hasActiveLinks()).toBe(false);
    expect(store.linksSnapshot()).toHaveLength(1);

    expect(await store.removeLink(link.id)).toEqual(revoked);
    expect(await store.removeLink(link.id)).toBeNull();
    expect(await store.listLinks()).toEqual([]);

    await expect(store.upsertLink(input({ machineKey: 'AB'.repeat(32) }))).rejects.toThrow(/machineKey/);
    await expect(store.upsertLink(input({ token: 'nope' }))).rejects.toThrow(/odk_/);
    await expect(store.upsertLink(input({ environmentId: '' }))).rejects.toThrow(/environmentId/);
  });

  it('the snapshot refresh picks up a write from another process on the 5 s tick', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      store.startLinkStoreRefresh();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(store.hasActiveLinks()).toBe(false);
      const { link } = await store.upsertLink(input());
      // Simulate another process: rewrite the file with the link revoked.
      await writeFile(join(home, 'machine-links.json'), JSON.stringify({ v: 1, links: [{ ...link, revokedAt: AT }] }));
      expect(store.hasActiveLinks()).toBe(true);
      await vi.advanceTimersByTimeAsync(store.MACHINE_LINKS_REFRESH_MS);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(store.hasActiveLinks()).toBe(false);
      expect(store.linksSnapshot()[0]?.revokedAt).toBe(AT);
    } finally {
      store.stopLinkStoreRefresh();
      vi.useRealTimers();
    }
  });
});
