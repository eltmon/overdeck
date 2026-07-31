import { describe, expect, it, vi } from 'vitest';
import {
  aggregateGenerationShipStatus,
  loadShipRecords,
  publicShipStatus,
} from '../../../../src/lib/cloister/ship-status.js';
import type { PanIssueRecord, PanIssueShipRecord } from '../../../../src/lib/pan-dir/record.js';
import type { UatGeneration } from '../../../../src/lib/overdeck/merge-sync.js';

const BATCH = 'uat/pan-status-0731';

function generation(): UatGeneration {
  return {
    name: BATCH,
    worktreePath: '/repo/worktree',
    projectRoot: '/repo',
    baseSha: 'abc',
    status: 'promoted',
    members: [
      { issueId: 'PAN-1', title: 'One', branch: 'feature/pan-1', headSha: 'one', mergeOrder: 1 },
      { issueId: 'PAN-2', title: 'Two', branch: 'feature/pan-2', headSha: 'two', mergeOrder: 2 },
    ],
    heldOut: [],
    resolutions: [],
    stackStartedAt: null,
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
  };
}

function ship(status: PanIssueShipRecord['status'], at: string): PanIssueShipRecord {
  return {
    status,
    version: '1.2.3',
    batch: BATCH,
    paths: status === 'partial' ? [{ path: 'package.json', ok: false, detail: 'pattern did not match 1.2.3' }] : [],
    errorCode: status === 'failed' ? 'push-failed' : undefined,
    error: status === 'failed' ? 'could not push version commit to main' : undefined,
    at,
  };
}

describe('aggregateGenerationShipStatus', () => {
  it('reports pending instead of passed when any member lacks settlement', () => {
    const records = new Map<string, PanIssueShipRecord | null>([
      ['PAN-1', ship('passed', '2026-07-31T01:00:00.000Z')],
      ['PAN-2', null],
    ]);

    expect(aggregateGenerationShipStatus(generation(), records)).toMatchObject({
      status: 'pending',
      reason: '1 member(s) have no durable ship settlement',
    });
  });

  it('keeps a partial member blocking even when a newer member passed', () => {
    const records = new Map<string, PanIssueShipRecord | null>([
      ['PAN-1', ship('partial', '2026-07-31T01:00:00.000Z')],
      ['PAN-2', ship('passed', '2026-07-31T02:00:00.000Z')],
    ]);

    expect(aggregateGenerationShipStatus(generation(), records)).toMatchObject({
      status: 'partial',
      paths: [{ path: 'package.json', ok: false }],
    });
  });

  it('omits operational error detail from the public aggregate DTO', () => {
    expect(publicShipStatus(ship('failed', '2026-07-31T01:00:00.000Z'))).toEqual({
      status: 'failed',
      version: '1.2.3',
      batch: BATCH,
      paths: [],
      errorCode: 'push-failed',
      at: '2026-07-31T01:00:00.000Z',
    });
  });
});

describe('loadShipRecords', () => {
  it('reads each unique issue asynchronously once across a generation chain', async () => {
    const gen = generation();
    const readRecord = vi.fn(async (_project, issueId: string) => ({
      issueId,
      pipeline: { ship: ship('passed', '2026-07-31T01:00:00.000Z') },
    }) as PanIssueRecord);

    const records = await loadShipRecords(
      { name: 'Overdeck', path: '/repo' },
      [gen, { ...gen, name: 'uat/pan-status-0730' }],
      { readRecord },
    );

    expect(readRecord).toHaveBeenCalledTimes(2);
    expect(records.get('PAN-1')?.status).toBe('passed');
    expect(records.get('PAN-2')?.status).toBe('passed');
  });
});
