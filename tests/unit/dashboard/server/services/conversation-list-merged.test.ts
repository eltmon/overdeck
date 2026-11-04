/** PAN-4650 WI-4: GET /api/conversations merges linked rows on page 1 unless ?linked=0. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SharedConversationRow } from '@overdeck/contracts';

const localRows = [{ id: 1, name: 'conv-here', claudeSessionId: 's-here', origin: 'local' }];
const row: SharedConversationRow = {
  name: 'conv-x', title: 'x', nativeSessionId: 's-x', harness: 'claude-code', model: null, status: 'active', sessionAlive: true,
  isWorking: false, lastActivityAt: null, projectKey: null, gitOrigin: null, cwd: '/w', issueId: null, tmuxSession: 'conv-x',
  releasedTo: null, createdAt: '2026-11-01T10:00:00.000Z', pullable: true, vaultId: null,
};

vi.mock('../../../../../src/lib/overdeck/conversation-list.js', () => ({
  getConversationListWithVaultCopies: vi.fn(async () => localRows),
}));
vi.mock('../../../../../src/lib/overdeck/linked-conversations.js', () => ({
  listLinkedConversations: vi.fn(() => [{ id: 4, environmentId: 'env-desk', name: 'conv-x', row, nativeSessionId: 's-x', cachedAt: '2026-11-01T12:00:00.000Z', listHash: 'h' }]),
}));
vi.mock('../../../../../src/lib/anywhere/link-store.js', () => ({
  linksSnapshot: () => [{
    id: 'link-desk', environmentId: 'env-desk', label: 'desk', machineKey: 'ab'.repeat(32), token: 'odk_x', access: 'operator',
    reverseTokenId: null, routes: [], createdAt: '2026-11-01T00:00:00.000Z', revokedAt: null,
  }],
}));
vi.mock('../../../../../src/lib/environment-identity.js', () => ({
  readEnvironmentIdentity: async () => ({ v: 1, environmentId: 'env-laptop', label: 'laptop', createdAt: '2026-11-01T00:00:00.000Z' }),
}));

const { listRemoteLanes, laneFieldsByRun } = vi.hoisted(() => ({ listRemoteLanes: vi.fn(async () => []), laneFieldsByRun: vi.fn(async () => new Map()) }));
vi.mock('../../../../../src/lib/lanes/remote-lanes.js', () => ({ listRemoteLanes }));
vi.mock('../../../../../src/lib/lanes/lane-list-fields.js', () => ({ laneFieldsByRun }));

const { getMergedConversationList } = await import('../../../../../src/dashboard/server/services/conversation-list-merged.js');

const standIn = (overrides: Record<string, unknown> = {}) => ({
  facts: {
    v: 1, name: 'conv-x', environmentId: 'env-desk', label: 'desk', run: 'r1', key: '663', role: 'critic', iteration: 1,
    parentName: 'orch', criticOfName: null, projectKey: 'ov', cwd: '/w', branch: null, at: null,
    model: 'claude-opus-5-5', harness: 'claude-code', effort: 'high', title: 'conv-x', createdAt: '2026-11-01T10:00:00.000Z',
  },
  mirror: null,
  archivedAt: null,
  ...overrides,
});

describe('getMergedConversationList (PAN-4650 WI-4)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('appends linked rows on page 1 by default, offline when no supervisor runs', async () => {
    const rows = (await getMergedConversationList(500, 0, new URLSearchParams())) as Array<Record<string, unknown>>;
    expect(rows.map((entry) => entry.name)).toEqual(['conv-here', '@env-desk/conv-x']);
    expect(rows[1]).toMatchObject({ origin: 'linked', machineState: 'offline', id: -4 });
  });

  it('ac5: ?linked=0 returns no linked rows', async () => {
    const rows = (await getMergedConversationList(500, 0, new URLSearchParams('linked=0'))) as Array<Record<string, unknown>>;
    expect(rows.some((entry) => entry.origin === 'linked')).toBe(false);
  });

  it('adds linked rows to page 1 only', async () => {
    const rows = (await getMergedConversationList(500, 500, new URLSearchParams())) as Array<Record<string, unknown>>;
    expect(rows).toEqual(localRows);
  });

  it('PAN-5005: stamps lane list fields on a remote lane row', async () => {
    listRemoteLanes.mockResolvedValueOnce([standIn()]);
    laneFieldsByRun.mockResolvedValueOnce(new Map([['conv-x', {
      laneReport: { seq: 1, at: '2026-11-04T12:00:00.000Z', status: 'done', verdict: 'PASS' },
      laneIteration: 1,
      laneVerdict: { value: 'PASS', defects: 0 },
    }]]));

    const rows = (await getMergedConversationList(500, 0, new URLSearchParams())) as Array<Record<string, unknown>>;

    expect(rows.find((entry) => entry.name === '@env-desk/conv-x')).toMatchObject({
      laneReport: { status: 'done' },
      laneVerdict: { value: 'PASS', defects: 0 },
    });
    expect(laneFieldsByRun).toHaveBeenCalledTimes(1);
    expect(laneFieldsByRun).toHaveBeenCalledWith(['r1']);
  });

  it('PAN-5005: no stand-ins, no lane-fields call', async () => {
    listRemoteLanes.mockResolvedValueOnce([]);

    await getMergedConversationList(500, 0, new URLSearchParams());

    expect(laneFieldsByRun).not.toHaveBeenCalled();
  });
});
