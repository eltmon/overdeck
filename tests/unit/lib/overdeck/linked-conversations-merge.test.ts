/** PAN-4650 WI-4: one row per conversation across local, linked and vault-copy rows. */
import { describe, expect, it } from 'vitest';
import type { SharedConversationRow } from '@overdeck/contracts';

import type { MachineLink } from '../../../../src/lib/anywhere/link-store.js';
import type { LinkedConversationRecord } from '../../../../src/lib/overdeck/linked-conversations.js';
import { mergeConversationRows, type MergeConversationRowsInput, remoteLaneKey, type RemoteLaneEntry } from '../../../../src/lib/overdeck/linked-conversations-merge.js';

const SELF = 'env-laptop';

function link(environmentId: string, label: string, overrides: Partial<MachineLink> = {}): MachineLink {
  return {
    id: `link-${label}`, environmentId, label, machineKey: 'ab'.repeat(32), token: `odk_${'9'.repeat(64)}`, access: 'operator',
    reverseTokenId: null, routes: [], createdAt: '2026-11-01T00:00:00.000Z', revokedAt: null, ...overrides,
  };
}

let nextId = 1;
function linked(environmentId: string, name: string, row: Partial<SharedConversationRow> = {}): LinkedConversationRecord {
  const shared: SharedConversationRow = {
    name, title: name, nativeSessionId: `s-${name}`, harness: 'claude-code', model: null, status: 'active', sessionAlive: true,
    isWorking: false, lastActivityAt: '2026-11-01T12:00:00.000Z', projectKey: null, gitOrigin: null, cwd: '/w', issueId: null,
    tmuxSession: `conv-${name}`, releasedTo: null, createdAt: '2026-11-01T10:00:00.000Z', pullable: true, vaultId: null, ...row,
  };
  return {
    id: nextId++, environmentId, name, row: shared, nativeSessionId: shared.nativeSessionId,
    cachedAt: '2026-11-01T12:30:00.000Z', listHash: 'h',
  };
}

function local(name: string, claudeSessionId: string | null) {
  return { id: 7, name, claudeSessionId, origin: 'local' };
}

function vaultCopy(vaultId: string) {
  return { id: 9, name: `vault-${vaultId}`, claudeSessionId: null, origin: 'vault' };
}

function merge(overrides: Partial<MergeConversationRowsInput>): Array<Record<string, unknown>> {
  return mergeConversationRows({
    local: [], vaultCopies: [], linked: [], links: [link('env-desk', 'desk')], selfEnvironmentId: SELF,
    presence: () => ({ state: 'online', lastSeenAt: '2026-11-01T12:59:00.000Z' }),
    ...overrides,
  });
}

const names = (rows: Array<Record<string, unknown>>): unknown[] => rows.map((row) => row.name);

describe('mergeConversationRows (PAN-4650 WI-4)', () => {
  it('ac1: a local, a linked and a vault-copy row of one session list as the local row only', () => {
    const rows = merge({
      local: [local('conv-here', 's-x')],
      linked: [linked('env-desk', 'conv-x', { nativeSessionId: 's-x', vaultId: 'v1' })],
      vaultCopies: [vaultCopy('v1')],
    });
    expect(names(rows)).toEqual(['conv-here']);
  });

  it('ac2: a linked row and its vault copy list as one linked row carrying savedCopyName', () => {
    const rows = merge({
      linked: [linked('env-desk', 'conv-x', { vaultId: 'v1' })],
      vaultCopies: [vaultCopy('v1'), vaultCopy('v2')],
    });
    expect(names(rows)).toEqual(['@env-desk/conv-x', 'vault-v2']);
    expect(rows[0]).toMatchObject({ savedCopyName: 'vault-v1' });
  });

  it('ac3: rows of a hidden or revoked link are absent, and so are rows of an unknown environment', () => {
    const rows = merge({
      links: [link('env-desk', 'desk', { hidden: true }), link('env-old', 'old', { revokedAt: '2026-11-01T11:00:00.000Z' })],
      linked: [linked('env-desk', 'conv-a'), linked('env-old', 'conv-b'), linked('env-gone', 'conv-c')],
    });
    expect(rows).toEqual([]);
  });

  it('ac4: linked rows have negative ids, @<environmentId>/ names and the D-4650-3 fields', () => {
    const record = linked('env-desk', 'conv-x', { releasedTo: null, isWorking: true });
    const [row] = merge({ linked: [record] });
    expect(row).toMatchObject({
      id: -record.id,
      name: '@env-desk/conv-x',
      origin: 'linked',
      environmentId: 'env-desk',
      remoteName: 'conv-x',
      machineLabel: 'desk',
      machineState: 'online',
      machineLastSeenAt: '2026-11-01T12:59:00.000Z',
      savedCopyName: null,
      releasedTo: null,
      claudeSessionId: 's-conv-x',
      isWorking: true,
      pullable: true,
    });
    expect(row!.id as number).toBeLessThan(0);
  });

  it('shows an offline machine with the cache time as last seen when there is no heartbeat', () => {
    const [row] = merge({ linked: [linked('env-desk', 'conv-x')], presence: () => ({ state: 'offline', lastSeenAt: null }) });
    expect(row).toMatchObject({ machineState: 'offline', machineLastSeenAt: '2026-11-01T12:30:00.000Z' });
  });

  it('drops a linked row released to this machine', () => {
    expect(merge({ linked: [linked('env-desk', 'conv-x', { releasedTo: SELF })] })).toEqual([]);
  });

  it('keeps the current owner when a pull moved a session between two linked machines', () => {
    const rows = merge({
      links: [link('env-desk', 'desk'), link('env-mini', 'mini')],
      linked: [
        linked('env-desk', 'conv-old', { nativeSessionId: 's-moved', releasedTo: 'env-mini' }),
        linked('env-mini', 'conv-new', { nativeSessionId: 's-moved' }),
      ],
    });
    expect(names(rows)).toEqual(['@env-mini/conv-new']);
  });

  it('keeps vault copies of a hidden machine (they predate the link)', () => {
    const rows = merge({
      links: [link('env-desk', 'desk', { hidden: true })],
      linked: [linked('env-desk', 'conv-x', { vaultId: 'v1' })],
      vaultCopies: [vaultCopy('v1')],
    });
    expect(names(rows)).toEqual(['vault-v1']);
  });
});

describe('remote lanes nest under their orchestrator (PAN-4638 WI-10)', () => {
  const FLY = link('env-fly', 'fly-abc');
  const entry = (overrides: Partial<RemoteLaneEntry> = {}): RemoteLaneEntry => ({
    parentName: 'orch', run: 'hotel', key: '663', role: 'builder', criticOfName: null, projectKey: 'ov', ...overrides,
  });

  it('ac1: a linked row matching a stand-in carries the orchestrator id, the lane facts and home\'s project key', () => {
    const rows = merge({
      links: [FLY],
      local: [{ id: 41, name: 'orch', claudeSessionId: 's-orch', origin: 'local' }],
      linked: [linked('env-fly', 'lane-a', { projectKey: 'ov-owner' })],
      remoteLanes: new Map([[remoteLaneKey('env-fly', 'lane-a'), entry()]]),
    });
    expect(rows.find((row) => row.remoteName === 'lane-a')).toMatchObject({
      parentConversationId: 41,
      parentConversationName: 'orch',
      projectKey: 'ov',
      gauntletRun: 'hotel',
      laneKey: '663',
      laneRole: 'builder',
      criticOfConversationId: null,
    });
  });

  it('ac2: a remote critic of a remote builder points at the builder linked row id', () => {
    const builder = linked('env-fly', 'lane-b');
    const critic = linked('env-desk', 'lane-c');
    const rows = merge({
      links: [FLY, link('env-desk', 'desk')],
      linked: [builder, critic],
      remoteLanes: new Map([
        [remoteLaneKey('env-fly', 'lane-b'), entry()],
        [remoteLaneKey('env-desk', 'lane-c'), entry({ role: 'critic', criticOfName: 'lane-b' })],
      ]),
    });
    expect(rows.find((row) => row.remoteName === 'lane-c')?.criticOfConversationId).toBe(-builder.id);
    expect(rows.find((row) => row.remoteName === 'lane-c')?.parentConversationId).toBeNull();
  });

  it('a remote critic of a local builder points at the local row id', () => {
    const rows = merge({
      links: [FLY],
      local: [{ id: 52, name: 'lane-local', claudeSessionId: 's-local', origin: 'local' }],
      linked: [linked('env-fly', 'lane-d')],
      remoteLanes: new Map([[remoteLaneKey('env-fly', 'lane-d'), entry({ role: 'critic', criticOfName: 'lane-local' })]]),
    });
    expect(rows.find((row) => row.remoteName === 'lane-d')?.criticOfConversationId).toBe(52);
  });

  it('ac3: a linked row with no stand-in entry has no lane fields', () => {
    const rows = merge({
      links: [FLY],
      linked: [linked('env-fly', 'plain', { projectKey: 'owner-key' })],
      remoteLanes: new Map([[remoteLaneKey('env-desk', 'plain'), entry()]]),
    });
    const row = rows.find((candidate) => candidate.remoteName === 'plain')!;
    expect(row.gauntletRun).toBeUndefined();
    expect(row.parentConversationId).toBeUndefined();
    expect(row.projectKey).toBe('owner-key');
  });

  it('PAN-5005: stamps a remote lane\'s report and verdict', () => {
    const rows = merge({
      links: [FLY],
      linked: [linked('env-fly', 'lane-a')],
      remoteLanes: new Map([[remoteLaneKey('env-fly', 'lane-a'), entry({
        fields: {
          laneReport: { seq: 1, at: '2026-11-04T12:00:00.000Z', status: 'done', verdict: 'PASS' },
          laneIteration: 1,
          laneVerdict: { value: 'PASS', defects: 0 },
        },
      })]]),
    });
    expect(rows.find((row) => row.remoteName === 'lane-a')).toMatchObject({
      laneReport: { seq: 1, at: '2026-11-04T12:00:00.000Z', status: 'done', verdict: 'PASS' },
      laneIteration: 1,
      laneVerdict: { value: 'PASS', defects: 0 },
    });
  });

  it('PAN-5005: an entry without fields stamps facts only', () => {
    const rows = merge({
      links: [FLY],
      linked: [linked('env-fly', 'lane-a')],
      remoteLanes: new Map([[remoteLaneKey('env-fly', 'lane-a'), entry()]]),
    });
    const row = rows.find((candidate) => candidate.remoteName === 'lane-a')!;
    expect(row).not.toHaveProperty('laneReport');
  });
});
