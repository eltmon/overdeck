/** PAN-4650 WI-4: one row per conversation across local, linked and vault-copy rows. */
import { describe, expect, it } from 'vitest';
import type { SharedConversationRow } from '@overdeck/contracts';

import type { MachineLink } from '../../../../src/lib/anywhere/link-store.js';
import type { LinkedConversationRecord } from '../../../../src/lib/overdeck/linked-conversations.js';
import { mergeConversationRows, type MergeConversationRowsInput } from '../../../../src/lib/overdeck/linked-conversations-merge.js';

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
