import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import type { ProjectConfig } from '../../projects.js';

const mockGetCostBreakdownByStageAndModel = vi.hoisted(() => vi.fn());
const mockGetCostForIssueSync = vi.hoisted(() => vi.fn());
const mockGetMergeSetSync = vi.hoisted(() => vi.fn());
const mockQueueAutoCommit = vi.hoisted(() => vi.fn());
const mockListOverdeckAgentStatesSync = vi.hoisted(() => vi.fn());
const mockGetProjectSync = vi.hoisted(() => vi.fn());
const mockResolveProjectFromIssueSync = vi.hoisted(() => vi.fn());

vi.mock('../../overdeck/cost-sync.js', () => ({
  getCostBreakdownByStageAndModelSync: mockGetCostBreakdownByStageAndModel,
  getCostForIssueSync: mockGetCostForIssueSync,
}));

vi.mock('../../merge-set.js', () => ({
  getMergeSetSync: mockGetMergeSetSync,
}));

vi.mock('../auto-commit.js', () => ({
  queueAutoCommit: mockQueueAutoCommit,
}));

vi.mock('../../overdeck/agent-state-sync.js', () => ({
  listOverdeckAgentStatesSync: mockListOverdeckAgentStatesSync,
}));

vi.mock('../../projects.js', async () => {
  const actual = await vi.importActual<typeof import('../../projects.js')>('../../projects.js');
  return {
    ...actual,
    getProjectSync: mockGetProjectSync,
    resolveProjectFromIssueSync: mockResolveProjectFromIssueSync,
  };
});

import {
  readIssueRecordForWorkspaceSync,
  readIssueRecordSync,
  writeIssueRecordForWorkspaceSync,
  type PanIssueRecord,
} from '../record.js';
import { withIssueRecordLock } from '../record-lock.js';
import { updateIssueRecordForIssue } from '../records.js';

function baseRecord(issueId: string): PanIssueRecord {
  return {
    issueId,
    schemaVersion: 2,
    pipeline: {
      issueId,
      reviewStatus: 'pending',
      testStatus: 'pending',
      readyForMerge: false,
      updatedAt: '2026-07-02T00:00:00.000Z',
    },
    closeOut: {
      usage: { byStage: {}, totals: {} },
      merges: [],
      ranOn: 'test-host',
    },
  };
}

describe('withIssueRecordLock', () => {
  let releaseFirst: (() => void) | null = null;

  afterEach(() => {
    releaseFirst?.();
    releaseFirst = null;
  });

  it('serializes concurrent updates for the same issue', async () => {
    const order: string[] = [];
    const first = withIssueRecordLock('PAN-2214', async () => {
      order.push('first:start');
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      order.push('first:end');
    });
    await Promise.resolve();

    const second = withIssueRecordLock('pan-2214', async () => {
      order.push('second:start');
    });
    await Promise.resolve();

    expect(order).toEqual(['first:start']);
    releaseFirst?.();
    await Promise.all([first, second]);

    expect(order).toEqual(['first:start', 'first:end', 'second:start']);
  });

  it('allows different issues to overlap', async () => {
    const order: string[] = [];
    const first = withIssueRecordLock('PAN-2214', async () => {
      order.push('pan-2214:start');
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      order.push('pan-2214:end');
    });
    await Promise.resolve();

    await withIssueRecordLock('PAN-2215', async () => {
      order.push('pan-2215:start');
    });

    expect(order).toEqual(['pan-2214:start', 'pan-2215:start']);
    releaseFirst?.();
    await first;
    expect(order).toEqual(['pan-2214:start', 'pan-2215:start', 'pan-2214:end']);
  });
});

describe('updateIssueRecordForIssue record lock integration', () => {
  let projectRoot: string;
  let workspacePath: string;
  let project: ProjectConfig;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'pan-record-lock-'));
    workspacePath = join(projectRoot, 'workspaces', 'feature-pan-2214');
    mkdirSync(workspacePath, { recursive: true });
    project = { name: 'Test', path: projectRoot };
    mockGetProjectSync.mockReturnValue(project);
    mockResolveProjectFromIssueSync.mockReturnValue({ projectKey: 'test', projectPath: projectRoot });
    mockGetCostBreakdownByStageAndModel.mockReturnValue({ byStage: {}, totals: {} });
    mockGetCostForIssueSync.mockReturnValue(null);
    mockGetMergeSetSync.mockReturnValue(null);
    mockListOverdeckAgentStatesSync.mockReturnValue([]);
    mockQueueAutoCommit.mockClear();
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('preserves swarm data written by a sync workspace writer during a rebuild', async () => {
    writeIssueRecordForWorkspaceSync(workspacePath, 'PAN-2214', baseRecord('PAN-2214'));

    mockGetCostBreakdownByStageAndModel.mockImplementationOnce(() => {
      const record = readIssueRecordForWorkspaceSync(workspacePath, 'PAN-2214');
      writeIssueRecordForWorkspaceSync(workspacePath, 'PAN-2214', {
        ...(record ?? baseRecord('PAN-2214')),
        swarm: {
          slotAssignments: [
            {
              slotIndex: 0,
              itemId: 'workspace-gr6j2',
              agentId: 'agent-pan-2214-lock',
              branch: 'feature/pan-2214-lock',
              assignedAt: '2026-07-02T00:00:01.000Z',
            },
          ],
        },
      });
      return { byStage: {}, totals: {} };
    });

    await updateIssueRecordForIssue('PAN-2214', {
      issueId: 'PAN-2214',
      reviewStatus: 'pending',
      testStatus: 'pending',
      readyForMerge: false,
      updatedAt: '2026-07-02T00:00:02.000Z',
    });

    const finalRecord = readIssueRecordSync(project, 'PAN-2214');
    expect(finalRecord?.swarm?.slotAssignments).toEqual([
      {
        slotIndex: 0,
        itemId: 'workspace-gr6j2',
        agentId: 'agent-pan-2214-lock',
        branch: 'feature/pan-2214-lock',
        assignedAt: '2026-07-02T00:00:01.000Z',
      },
    ]);
  });
});
