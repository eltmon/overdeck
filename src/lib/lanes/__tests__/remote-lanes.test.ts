/**
 * PAN-4638 WI-1: the remote lane stand-in store, in a temp OVERDECK_HOME.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_HOME = join(tmpdir(), `remote-lanes-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.OVERDECK_HOME = TEST_HOME;
mkdirSync(TEST_HOME, { recursive: true });

const {
  listRemoteLanes,
  markRemoteLaneArchived,
  readCriticLink,
  readRemoteLane,
  remoteLanesRoot,
  removeRemoteLane,
  writeCriticLink,
  writeRemoteLaneFacts,
  writeRemoteLaneMirror,
} = await import('../remote-lanes.js');
type Facts = import('../remote-lanes.js').RemoteLaneFacts;
type Mirror = import('../remote-lanes.js').RemoteLaneMirror;

function facts(name: string, overrides: Partial<Facts> = {}): Facts {
  return {
    v: 1,
    name,
    environmentId: 'env-laptop',
    label: 'laptop',
    run: 'run-a',
    key: 'hotel',
    role: 'builder',
    iteration: 1,
    parentName: 'orchestrator',
    criticOfName: null,
    projectKey: 'overdeck',
    cwd: `/home/u/.overdeck/lanes/${name}`,
    branch: 'gauntlet/run-a/hotel',
    at: null,
    model: 'claude-opus-5-5',
    harness: 'claude-code',
    effort: null,
    title: 'hotel builder',
    createdAt: '2026-11-01T10:00:00.000Z',
    ...overrides,
  };
}

const MIRROR: Mirror = {
  v: 1,
  state: 'running',
  activity: 'working',
  lastActivityAt: '2026-11-01T10:05:00.000Z',
  git: { branch: 'gauntlet/run-a/hotel', head: 'abc1234', ahead: 1, dirty: false },
  costUsd: 0.42,
  ownerArchived: false,
  lastSeq: 2,
  lastSeenAt: '2026-11-01T10:05:01.000Z',
  unreachableSince: null,
  lastAssistantMessage: 'building',
  spawnError: null,
};

afterAll(() => {
  rmSync(TEST_HOME, { recursive: true, force: true });
  delete process.env.OVERDECK_HOME;
});

describe('remote lane stand-ins (PAN-4638 WI-1)', () => {
  it('round-trips facts, mirror and archive mark', async () => {
    await writeRemoteLaneFacts(facts('20261101-1001'));
    expect(await readRemoteLane('20261101-1001')).toEqual({ facts: facts('20261101-1001'), mirror: null, archivedAt: null });

    await writeRemoteLaneMirror('20261101-1001', MIRROR);
    await writeRemoteLaneMirror('20261101-1001', { ...MIRROR, lastSeq: 3 });
    await markRemoteLaneArchived('20261101-1001', '2026-11-01T11:00:00.000Z');
    await markRemoteLaneArchived('20261101-1001', '2026-11-01T12:00:00.000Z');
    const lane = await readRemoteLane('20261101-1001');
    expect(lane?.mirror?.lastSeq).toBe(3);
    expect(lane?.archivedAt).toBe('2026-11-01T11:00:00.000Z');
    expect(statSync(join(remoteLanesRoot(), '20261101-1001', 'mirror.json')).mode & 0o777).toBe(0o600);
    expect(statSync(join(remoteLanesRoot(), '20261101-1001', 'archived.json')).mode & 0o777).toBe(0o600);
  });

  it('ac1: refuses a second lane.json and keeps the first facts at mode 0600', async () => {
    await writeRemoteLaneFacts(facts('20261101-1002'));
    await expect(writeRemoteLaneFacts(facts('20261101-1002', { label: 'desktop' }))).rejects.toThrow(/EEXIST/);
    const path = join(remoteLanesRoot(), '20261101-1002', 'lane.json');
    expect(JSON.parse(await readFile(path, 'utf8')).label).toBe('laptop');
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('ac5: skips a stand-in whose lane.json is corrupt and returns the others', async () => {
    await writeRemoteLaneFacts(facts('20261101-2001', { run: 'run-corrupt' }));
    mkdirSync(join(remoteLanesRoot(), '20261101-2002'), { recursive: true });
    writeFileSync(join(remoteLanesRoot(), '20261101-2002', 'lane.json'), '{ not json');
    mkdirSync(join(remoteLanesRoot(), '20261101-2003'), { recursive: true });
    writeFileSync(join(remoteLanesRoot(), '20261101-2003', 'lane.json'), JSON.stringify({ v: 1, name: '20261101-2003' }));
    const lanes = await listRemoteLanes({});
    expect(lanes.map((lane) => lane.facts.name)).toContain('20261101-2001');
    expect(lanes.map((lane) => lane.facts.name)).not.toContain('20261101-2002');
    expect(lanes.map((lane) => lane.facts.name)).not.toContain('20261101-2003');
  });

  it('filters by run, key, role and parent, in createdAt order', async () => {
    await writeRemoteLaneFacts(facts('20261101-3002', { run: 'run-f', createdAt: '2026-11-01T10:00:02.000Z' }));
    await writeRemoteLaneFacts(facts('20261101-3001', { run: 'run-f', createdAt: '2026-11-01T10:00:01.000Z' }));
    await writeRemoteLaneFacts(facts('20261101-3003', { run: 'run-f', role: 'critic', criticOfName: '20261101-3001' }));
    await writeRemoteLaneFacts(facts('20261101-3004', { run: 'run-f', key: 'india', parentName: 'other' }));
    expect((await listRemoteLanes({ run: 'run-f', role: 'builder', key: 'hotel' })).map((lane) => lane.facts.name))
      .toEqual(['20261101-3001', '20261101-3002']);
    expect((await listRemoteLanes({ run: 'run-f', parentName: 'other' })).map((lane) => lane.facts.name)).toEqual(['20261101-3004']);
  });

  it('removes a refused launch', async () => {
    await writeRemoteLaneFacts(facts('20261101-4001'));
    await removeRemoteLane('20261101-4001');
    expect(await readRemoteLane('20261101-4001')).toBeNull();
  });

  it('rejects a name outside the stand-in pattern', async () => {
    await expect(writeRemoteLaneFacts(facts('../escape'))).rejects.toThrow(/invalid lane name/);
    await expect(readRemoteLane('Bad_Name')).rejects.toThrow(/invalid lane name/);
  });

  it('writes a critic link once and reads it back', async () => {
    expect(await readCriticLink('20261101-5001')).toBeNull();
    await writeCriticLink('20261101-5001', '20261101-5000');
    await expect(writeCriticLink('20261101-5001', '20261101-5999')).rejects.toThrow(/EEXIST/);
    expect(await readCriticLink('20261101-5001')).toBe('20261101-5000');
    const path = join(TEST_HOME, 'agents', 'conv-20261101-5001', 'lane-link.json');
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});
