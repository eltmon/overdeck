import { describe, expect, it } from 'vitest';
import {
  HOLDER_MIN_BYTES,
  collectDiskHolders,
  parseDockerReclaimable,
  type HolderDeps,
  type StatEntryResult,
} from '../disk-alert-holders.js';

const HOME = '/home/op';
const OVERDECK_HOME = '/home/op/.overdeck';
const DEFAULT_INDEX_PATH = `${OVERDECK_HOME}/conversations/embeddings.db`;
const HOME_DEV = 1;
const OTHER_DEV = 2;

interface FakeEntry {
  dev?: number;
  size?: number;
  isDirectory?: boolean;
  duKb?: number | 'reject';
}

function buildDeps(overrides: Partial<HolderDeps> & { entries?: Record<string, FakeEntry> } = {}): Partial<HolderDeps> {
  const entries: Record<string, FakeEntry> = { [OVERDECK_HOME]: { dev: HOME_DEV, isDirectory: true }, ...overrides.entries };
  const statEntry = async (path: string): Promise<StatEntryResult | null> => {
    const entry = entries[path];
    if (!entry) return null;
    return { dev: entry.dev ?? HOME_DEV, size: entry.size ?? 0, isDirectory: entry.isDirectory ?? false };
  };
  const duKb = async (path: string): Promise<number> => {
    const entry = entries[path];
    if (entry?.duKb === 'reject' || entry?.duKb === undefined) throw new Error(`no du for ${path}`);
    return entry.duKb;
  };
  const listDir = async (path: string): Promise<string[]> => (path === OVERDECK_HOME ? [] : []);
  const dockerReclaimableBytes = async (): Promise<number | null> => null;
  return {
    home: HOME,
    overdeckHome: OVERDECK_HOME,
    conversationIndexPath: DEFAULT_INDEX_PATH,
    defaultIndexPath: DEFAULT_INDEX_PATH,
    statEntry,
    duKb,
    listDir,
    dockerReclaimableBytes,
    now: () => Date.parse('2026-11-06T18:00:00.000Z'),
    ...overrides,
  };
}

describe('collectDiskHolders', () => {
  it('sorts rows by bytes descending, caps at 12 and drops rows under 100 MiB', async () => {
    const children = Array.from({ length: 14 }, (_, i) => `item-${i}`);
    const entries: Record<string, FakeEntry> = {};
    const byteValues: number[] = [];
    for (let i = 0; i < children.length; i++) {
      const path = `${OVERDECK_HOME}/item-${i}`;
      const bytes = (200 - i * 10) * 1024 * 1024; // descending, all above 100 MiB except last couple
      byteValues.push(bytes);
      entries[path] = { dev: HOME_DEV, isDirectory: false, size: bytes };
    }
    // One file clearly under the minimum.
    entries[`${OVERDECK_HOME}/tiny`] = { dev: HOME_DEV, isDirectory: false, size: 1024 };
    const deps = buildDeps({
      entries,
      listDir: async (path) => (path === OVERDECK_HOME ? [...children, 'tiny'] : []),
    });

    const result = await collectDiskHolders(deps);
    expect(result.holders.length).toBeLessThanOrEqual(12);
    expect(result.holders.every((h) => h.bytes >= HOLDER_MIN_BYTES)).toBe(true);
    expect(result.holders.map((h) => h.bytes)).toEqual([...result.holders.map((h) => h.bytes)].sort((a, b) => b - a));
    expect(result.holders.some((h) => h.label === '~/.overdeck/tiny')).toBe(false);
  });

  it('keeps the conversation search index row past the cap when it is smaller than the 12th row', async () => {
    const children = Array.from({ length: 12 }, (_, i) => `item-${i}`);
    const entries: Record<string, FakeEntry> = {};
    for (let i = 0; i < children.length; i++) {
      entries[`${OVERDECK_HOME}/item-${i}`] = { dev: HOME_DEV, isDirectory: false, size: (500 - i) * 1024 * 1024 };
    }
    entries[DEFAULT_INDEX_PATH] = { dev: HOME_DEV, isDirectory: false, size: 10 * 1024 * 1024 };
    const deps = buildDeps({ entries, listDir: async (path) => (path === OVERDECK_HOME ? children : []) });

    const result = await collectDiskHolders(deps);
    expect(result.holders.some((h) => h.label === 'Conversation search index')).toBe(true);
  });

  it('includes the stale index row only when the configured path differs and the default file exists', async () => {
    const configuredPath = `${OVERDECK_HOME}/conversations/custom.db`;
    const entries: Record<string, FakeEntry> = {
      [configuredPath]: { dev: HOME_DEV, isDirectory: false, size: 200 * 1024 * 1024 },
      [DEFAULT_INDEX_PATH]: { dev: HOME_DEV, isDirectory: false, size: 150 * 1024 * 1024 },
    };
    const deps = buildDeps({ entries, conversationIndexPath: configuredPath, defaultIndexPath: DEFAULT_INDEX_PATH });

    const result = await collectDiskHolders(deps);
    expect(result.holders.some((h) => h.label === 'Conversation search index')).toBe(true);
    expect(result.holders.some((h) => h.label === 'Conversation search index (not in use)')).toBe(true);
  });

  it('omits the stale index row when the configured and default paths are the same', async () => {
    const entries: Record<string, FakeEntry> = {
      [DEFAULT_INDEX_PATH]: { dev: HOME_DEV, isDirectory: false, size: 200 * 1024 * 1024 },
    };
    const deps = buildDeps({ entries });

    const result = await collectDiskHolders(deps);
    expect(result.holders.filter((h) => h.label.startsWith('Conversation search index')).length).toBe(1);
  });

  it('excludes a path on a different device than the Overdeck home', async () => {
    const entries: Record<string, FakeEntry> = {
      [`${OVERDECK_HOME}/item-0`]: { dev: OTHER_DEV, isDirectory: false, size: 500 * 1024 * 1024 },
    };
    const deps = buildDeps({ entries, listDir: async (path) => (path === OVERDECK_HOME ? ['item-0'] : []) });

    const result = await collectDiskHolders(deps);
    expect(result.holders.some((h) => h.label === '~/.overdeck/item-0')).toBe(false);
  });

  it('marks the result incomplete and keeps the other rows when a du measurement rejects', async () => {
    const entries: Record<string, FakeEntry> = {
      [`${OVERDECK_HOME}/good`]: { dev: HOME_DEV, isDirectory: false, size: 300 * 1024 * 1024 },
      [`${OVERDECK_HOME}/bad`]: { dev: HOME_DEV, isDirectory: true, duKb: 'reject' },
    };
    const deps = buildDeps({ entries, listDir: async (path) => (path === OVERDECK_HOME ? ['good', 'bad'] : []) });

    const result = await collectDiskHolders(deps);
    expect(result.incomplete).toBe(true);
    expect(result.holders.some((h) => h.label === '~/.overdeck/good')).toBe(true);
    expect(result.holders.some((h) => h.label === '~/.overdeck/bad')).toBe(false);
  });

  it('returns an incomplete, empty snapshot when the Overdeck home itself cannot be measured', async () => {
    const deps = buildDeps({ statEntry: async () => null });
    const result = await collectDiskHolders(deps);
    expect(result.incomplete).toBe(true);
    expect(result.holders).toEqual([]);
  });

  it('includes a Docker reclaimable row when non-zero and omits it when zero or null', async () => {
    const depsWithDocker = buildDeps({ dockerReclaimableBytes: async () => 2 * 1024 ** 3 });
    const withDocker = await collectDiskHolders(depsWithDocker);
    expect(withDocker.holders.some((h) => h.label === 'Docker reclaimable' && h.path === null)).toBe(true);

    const depsZero = buildDeps({ dockerReclaimableBytes: async () => 0 });
    const zero = await collectDiskHolders(depsZero);
    expect(zero.holders.some((h) => h.label === 'Docker reclaimable')).toBe(false);
  });
});

describe('parseDockerReclaimable', () => {
  it('sums the Reclaimable column of every JSON line', () => {
    const lines = [
      JSON.stringify({ Reclaimable: '1.5GB (40%)' }),
      JSON.stringify({ Reclaimable: '500MB (10%)' }),
    ].join('\n');
    expect(parseDockerReclaimable(lines)).toBe(1.5e9 + 5e8);
  });

  it('returns 0 for empty input', () => {
    expect(parseDockerReclaimable('')).toBe(0);
  });

  it('skips unparsable lines', () => {
    expect(parseDockerReclaimable('not json\n{"Reclaimable":"1GB (0%)"}')).toBe(1e9);
  });
});
