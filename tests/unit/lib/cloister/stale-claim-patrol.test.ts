import { mkdtempSync, rmSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

vi.mock('../../../../src/lib/pan-dir/auto-commit.js', () => ({
  queueAutoCommit: vi.fn(),
  flushAutoCommits: vi.fn(() => Effect.succeed({ committed: false, reason: 'no pending' })),
}));

import { releaseStaleTaskClaims } from '../../../../src/lib/cloister/stale-task-claims.js';
import { readIssueRecordSync, writeIssueRecordSync, type PanIssueRecord } from '../../../../src/lib/pan-dir/record.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture(agentId: string | null, pid = 99_999_999) {
  const root = mkdtempSync(join(tmpdir(), 'stale-task-claim-'));
  roots.push(root);
  const project = { name: 'fixture', path: root };
  const issueId = 'PAN-2648';
  const record: PanIssueRecord = {
    issueId,
    schemaVersion: 1,
    pipeline: { issueId, reviewStatus: 'pending', testStatus: 'pending', readyForMerge: false, updatedAt: new Date().toISOString() },
    closeOut: { usage: { byStage: {}, totals: {} }, merges: [], ranOn: hostname() },
    statusOverrides: { 'wi-2a': 'running' },
    tasks: { sequence: 4, claims: { 'wi-2a': { writerId: 'dead-writer', agentId, pid, host: hostname(), claimedAt: new Date().toISOString() } } },
  };
  writeIssueRecordSync(project, issueId, record);
  return { project, issueId };
}

describe('releaseStaleTaskClaims', () => {
  it('releases only when the local pid is dead and the agent is not running', async () => {
    const { project, issueId } = fixture('agent-pan-2648');
    const actions = await releaseStaleTaskClaims([{ project, issueIds: [issueId] }], new Set());
    const record = readIssueRecordSync(project, issueId)!;
    expect(actions).toHaveLength(1);
    expect(record.statusOverrides?.['wi-2a']).toBe('pending');
    expect(record.tasks?.claims['wi-2a']).toBeUndefined();
    expect(record.tasks?.claimHistory?.at(-1)?.reason).toBe('stale claim released (dead-writer dead)');
    expect(record.tasks?.sequence).toBe(5);
  });

  it('keeps the claim when its agent is still running', async () => {
    const { project, issueId } = fixture('agent-pan-2648');
    expect(await releaseStaleTaskClaims([{ project, issueIds: [issueId] }], new Set(['agent-pan-2648']))).toEqual([]);
    expect(readIssueRecordSync(project, issueId)?.statusOverrides?.['wi-2a']).toBe('running');
  });

  it('keeps the claim when its pid is alive', async () => {
    const { project, issueId } = fixture(null, process.pid);
    expect(await releaseStaleTaskClaims([{ project, issueIds: [issueId] }], new Set())).toEqual([]);
    expect(readIssueRecordSync(project, issueId)?.tasks?.claims['wi-2a']).toBeDefined();
  });
});
