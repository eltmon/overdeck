import { describe, expect, it, vi } from 'vitest';
import {
  promoteUatGeneration,
  type UatPromoteDeps,
} from '../../../../src/lib/cloister/uat-promote.js';
import {
  persistPendingShipRecords,
  persistShipRecords,
  shipPromotedBatch,
  ShipPromotedBatchError,
} from '../../../../src/lib/cloister/ship-record.js';
import { projectPipeline } from '../../../../src/lib/pan-dir/records.js';
import type {
  PanIssuePipelineRecord,
  PanIssueRecord,
} from '../../../../src/lib/pan-dir/record.js';
import type { UatGeneration } from '../../../../src/lib/overdeck/merge-sync.js';

const PROJECT_ROOT = '/repo';
const BATCH = 'uat/pan-ship-0731';

function generation(status: UatGeneration['status'] = 'ready'): UatGeneration {
  return {
    name: BATCH,
    worktreePath: '/repo/workspaces/uat-pan-ship-0731',
    projectRoot: PROJECT_ROOT,
    baseSha: 'main-sha',
    status,
    members: [
      { issueId: 'PAN-1', title: 'One', branch: 'feature/pan-1', headSha: 'one-sha', mergeOrder: 1 },
      { issueId: 'PAN-2', title: 'Two', branch: 'feature/pan-2', headSha: 'two-sha', mergeOrder: 2 },
    ],
    heldOut: [],
    resolutions: [],
    stackStartedAt: null,
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
  };
}

function promoteDeps(gen: UatGeneration, order: string[] = []): UatPromoteDeps {
  const map = new Map([[gen.name, gen]]);
  return {
    git: {
      fetchMain: async () => 'main-sha',
      mergeIntoMain: async () => 'merge-sha',
      changedFilesSince: async () => [],
      batchChangedFiles: async () => [],
    },
    store: {
      get: name => map.get(name) ?? null,
      insert: () => { throw new Error('unused'); },
      update: (name, patch) => {
        const current = map.get(name);
        if (current) map.set(name, { ...current, ...patch } as UatGeneration);
      },
      listNames: () => [...map.keys()],
      listChain: () => [...map.values()].filter(row => row.status === 'ready' || row.status === 'superseded'),
    },
    teardownStack: async () => {},
    firePostMerge: issueId => { order.push(`post:${issueId}`); return true; },
    memberEligibility: () => ({ eligible: true }),
    recordVerification: () => { order.push('verification'); },
    runShip: async () => { order.push('ship'); },
    log: () => {},
  };
}

describe('promote ship ordering', () => {
  it('runs ship once after verification and before the member post-merge fan-out', async () => {
    const order: string[] = [];
    const deps = promoteDeps(generation(), order);

    const result = await promoteUatGeneration(BATCH, PROJECT_ROOT, deps, { shipVersion: '1.2.3' });

    expect(result.success).toBe(true);
    expect(order).toEqual(['verification', 'ship', 'post:PAN-1', 'post:PAN-2']);
    expect(deps.store.get(BATCH)?.repos?.[0]).toMatchObject({
      repoPath: PROJECT_ROOT,
      mergeSha: 'merge-sha',
      targetBranch: 'main',
    });
  });

  it('keeps promotion successful when ship throws and fans out every member', async () => {
    const logs: string[] = [];
    const deps = promoteDeps(generation());
    deps.runShip = async () => { throw new Error('push rejected'); };
    deps.log = message => { logs.push(message); };

    const result = await promoteUatGeneration(BATCH, PROJECT_ROOT, deps, { shipVersion: '1.2.3' });

    expect(result).toMatchObject({
      success: true,
      postMergeStarted: ['PAN-1', 'PAN-2'],
    });
    expect(logs).toContain(`[uat-promote] ${BATCH}: version ship settlement failed after merge: push rejected`);
  });
});

function record(issueId: string): PanIssueRecord {
  return {
    issueId,
    schemaVersion: 1,
    pipeline: {
      issueId,
      reviewStatus: 'passed',
      testStatus: 'passed',
      readyForMerge: true,
      updatedAt: '2026-07-31T00:00:00.000Z',
    },
    closeOut: {},
  } as PanIssueRecord;
}

function recordDeps(records: Map<string, PanIssueRecord>) {
  return {
    resolveProject: () => ({ name: 'Overdeck', path: PROJECT_ROOT }),
    updateRecord: vi.fn(async (_project, issueId, mutator) => {
      const current = records.get(issueId)!;
      await mutator(current);
      records.set(issueId, current);
      return current;
    }),
  } as never;
}

describe('durable ship records', () => {
  it('persists pending and passed reports to every generation member', async () => {
    const records = new Map(generation().members.map(member => [member.issueId, record(member.issueId)]));
    const deps = recordDeps(records);

    await persistPendingShipRecords(generation(), 'no version supplied at promote time', deps);
    expect([...records.values()].map(value => value.pipeline.ship)).toEqual([
      expect.objectContaining({ status: 'pending', batch: BATCH, reason: 'no version supplied at promote time' }),
      expect.objectContaining({ status: 'pending', batch: BATCH, reason: 'no version supplied at promote time' }),
    ]);

    await persistShipRecords(generation(), {
      status: 'passed',
      version: '1.2.3',
      batch: BATCH,
      paths: [{ path: 'package.json', ok: true, detail: 'reports 1.2.3' }],
      at: '2026-07-31T01:00:00.000Z',
    }, deps);
    expect([...records.values()].map(value => value.pipeline.ship)).toEqual([
      expect.objectContaining({ status: 'passed', version: '1.2.3' }),
      expect.objectContaining({ status: 'passed', version: '1.2.3' }),
    ]);
  });

  it('continues past a member write failure and retries every unsettled member', async () => {
    const records = new Map(generation().members.map(member => [member.issueId, record(member.issueId)]));
    const attempts = new Map<string, number>();
    const deps = {
      resolveProject: () => ({ name: 'Overdeck', path: PROJECT_ROOT }),
      updateRecord: vi.fn(async (_project: unknown, issueId: string, mutator: (record: PanIssueRecord) => void | Promise<void>) => {
        const count = (attempts.get(issueId) ?? 0) + 1;
        attempts.set(issueId, count);
        if (issueId === 'PAN-1' && count === 1) throw new Error('transient write failure');
        const current = records.get(issueId)!;
        await mutator(current);
        records.set(issueId, current);
        return current;
      }),
    } as never;

    await persistPendingShipRecords(generation(), 'version ship in progress', deps);

    expect(attempts).toEqual(new Map([['PAN-1', 2], ['PAN-2', 1]]));
    expect([...records.values()].map(value => value.pipeline.ship?.status)).toEqual(['pending', 'pending']);
  });

  it('preserves pipeline.ship when the ordinary record projection runs later', () => {
    const existing: PanIssuePipelineRecord = {
      issueId: 'PAN-1',
      reviewStatus: 'passed',
      testStatus: 'passed',
      readyForMerge: true,
      ship: {
        status: 'passed',
        version: '1.2.3',
        batch: BATCH,
        paths: [],
        at: '2026-07-31T01:00:00.000Z',
      },
      updatedAt: '2026-07-31T01:00:00.000Z',
    };

    expect(projectPipeline('PAN-1', null, existing).ship).toEqual(existing.ship);
  });
});

describe('shipPromotedBatch', () => {
  it('refuses a generation that is not promoted', async () => {
    await expect(shipPromotedBatch({
      generationName: BATCH,
      projectRoot: PROJECT_ROOT,
      version: '1.2.3',
    }, {
      getGeneration: () => generation('ready'),
      findProject: () => ({ name: 'Overdeck', path: PROJECT_ROOT, version_sync: {} }),
      runShip: vi.fn(),
      persist: vi.fn(),
    })).rejects.toMatchObject<Partial<ShipPromotedBatchError>>({ reason: 'wrong-status' });
  });

  it('refuses a promoted generation whose project has no version_sync', async () => {
    await expect(shipPromotedBatch({
      generationName: BATCH,
      projectRoot: PROJECT_ROOT,
      version: '1.2.3',
    }, {
      getGeneration: () => generation('promoted'),
      findProject: () => ({ name: 'Overdeck', path: PROJECT_ROOT }),
      runShip: vi.fn(),
      persist: vi.fn(),
    })).rejects.toMatchObject<Partial<ShipPromotedBatchError>>({ reason: 'not-configured' });
  });
});
