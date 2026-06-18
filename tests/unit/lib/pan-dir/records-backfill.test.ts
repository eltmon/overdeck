/**
 * Tests for PAN-1908 per-issue permanent-record backfill.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { Effect } from 'effect';

const mockGetCostBreakdownByStageAndModel = vi.hoisted(() => vi.fn());
const mockGetCostForIssueFromDb = vi.hoisted(() => vi.fn());
const mockGetMergeSetSync = vi.hoisted(() => vi.fn());
const mockListAllAgents = vi.hoisted(() => vi.fn());
const mockGetAllReviewStatusesFromDb = vi.hoisted(() => vi.fn());
const mockResolveProjectFromIssueSync = vi.hoisted(() => vi.fn());
const mockGetProjectSync = vi.hoisted(() => vi.fn());
const mockLoadProjectsConfigSync = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/lib/database/agents-db.js', () => ({
  listAllAgents: mockListAllAgents,
}));

vi.mock('../../../../src/lib/database/review-status-db.js', () => ({
  getAllReviewStatusesFromDb: mockGetAllReviewStatusesFromDb,
}));

vi.mock('../../../../src/lib/database/cost-events-db.js', () => ({
  getCostBreakdownByStageAndModel: mockGetCostBreakdownByStageAndModel,
  getCostForIssueFromDb: mockGetCostForIssueFromDb,
}));

vi.mock('../../../../src/lib/merge-set.js', () => ({
  getMergeSetSync: mockGetMergeSetSync,
}));

vi.mock('../../../../src/lib/projects.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/lib/projects.js')>('../../../../src/lib/projects.js');
  return {
    ...actual,
    loadProjectsConfigSync: mockLoadProjectsConfigSync,
    resolveProjectFromIssueSync: mockResolveProjectFromIssueSync,
    getProjectSync: mockGetProjectSync,
  };
});

import {
  backfillIssueRecords,
  type BackfillRecordsResult,
} from '../../../../src/lib/pan-dir/records-backfill.js';
import { flushAutoCommits } from '../../../../src/lib/pan-dir/auto-commit.js';

describe('backfillIssueRecords', () => {
  let projectRoot: string;
  let infraRepo: string;

  beforeEach(() => {
    infraRepo = mkdtempSync(join(tmpdir(), 'pan-records-backfill-infra-'));
    projectRoot = infraRepo; // For these tests the project root is also the infra repo.

    // Seed infra repo
    execSync('git init -q', { cwd: infraRepo });
    execSync('git config user.email t@e.t', { cwd: infraRepo });
    execSync('git config user.name "Test"', { cwd: infraRepo });
    execSync('git config commit.gpgsign false', { cwd: infraRepo });
    writeFileSync(join(infraRepo, 'README.md'), 'seed');
    execSync('git add README.md', { cwd: infraRepo });
    execSync('git commit -q -m init', { cwd: infraRepo });
    execSync('git branch -M main', { cwd: infraRepo });
    execSync('git remote add origin .', { cwd: infraRepo });

    mockGetCostBreakdownByStageAndModel.mockReturnValue({ byStage: {}, totals: {} });
    mockGetCostForIssueFromDb.mockReturnValue(null);
    mockGetMergeSetSync.mockReturnValue(null);
    mockListAllAgents.mockReturnValue([]);
    mockGetAllReviewStatusesFromDb.mockReturnValue({});
    mockLoadProjectsConfigSync.mockReturnValue({
      projects: {
        pan: {
          name: 'Panopticon',
          path: projectRoot,
          issue_prefix: 'PAN',
          pan_records: { repo: '.', path: '.pan' },
        },
      },
    });

    mockResolveProjectFromIssueSync.mockImplementation((issueId: string) => {
      if (!issueId.toUpperCase().startsWith('PAN-')) return null;
      return {
        projectKey: 'pan',
        projectName: 'Panopticon',
        projectPath: projectRoot,
        linearTeam: 'PAN',
      };
    });

    mockGetProjectSync.mockImplementation((key: string) => {
      if (key !== 'pan') return null;
      return {
        name: 'Panopticon',
        path: projectRoot,
        issue_prefix: 'PAN',
        pan_records: { repo: '.', path: '.pan' },
      };
    });
  });

  afterEach(() => {
    rmSync(infraRepo, { recursive: true, force: true });
  });

  it('produces one record per in-flight issue combining continue and review_status data', async () => {
    mkdirSync(join(projectRoot, '.pan', 'continues'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.pan', 'continues', 'pan-1908.vbrief.json'),
      JSON.stringify({
        issueId: 'PAN-1908',
        decisions: [{ id: 'D1', summary: 'big bang', recordedAt: '2026-01-01' }],
        hazards: [{ id: 'H1', summary: 'big PR', mitigation: 'audit' }],
      }),
    );

    mockGetAllReviewStatusesFromDb.mockReturnValue({
      'PAN-1908': {
        issueId: 'PAN-1908',
        reviewStatus: 'passed',
        testStatus: 'passed',
        readyForMerge: true,
        updatedAt: '2026-06-15T00:00:00.000Z',
      },
    });

    const result = await backfillIssueRecords();

    expect(result.processed).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(existsSync(join(infraRepo, '.pan', 'records', 'pan-1908.json'))).toBe(true);
  });

  it('discovers issues from the agents table even without review_status or continue files', async () => {
    mockListAllAgents.mockReturnValue([
      {
        id: 'agent-pan-1909',
        issueId: 'PAN-1909',
        role: 'work',
        status: 'running',
        workspace: '/workspace',
      },
    ]);

    const result = await backfillIssueRecords();

    expect(result.processed).toBe(1);
    expect(result.details.find((d) => d.issueId === 'PAN-1909')?.action).toBe('written');
    expect(existsSync(join(infraRepo, '.pan', 'records', 'pan-1909.json'))).toBe(true);
  });

  it('is idempotent by skipping unchanged records on re-run', async () => {
    mkdirSync(join(projectRoot, '.pan', 'continues'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.pan', 'continues', 'pan-1908.vbrief.json'),
      JSON.stringify({
        issueId: 'PAN-1908',
        decisions: [{ id: 'D1', summary: 'big bang', recordedAt: '2026-01-01' }],
      }),
    );

    const first = await backfillIssueRecords();
    expect(first.processed).toBe(1);

    const second = await backfillIssueRecords();
    expect(second.processed).toBe(0);
    expect(second.skipped).toBe(1);
  });

  it('writes a record for a single issue when --issue-id is passed', async () => {
    mockListAllAgents.mockReturnValue([
      { id: 'agent-pan-1908', issueId: 'PAN-1908', role: 'work', status: 'running', workspace: '/w' },
      { id: 'agent-pan-1909', issueId: 'PAN-1909', role: 'work', status: 'running', workspace: '/w' },
    ]);

    const result = await backfillIssueRecords({ issueId: 'PAN-1908' });

    expect(result.processed).toBe(1);
    expect(existsSync(join(infraRepo, '.pan', 'records', 'pan-1908.json'))).toBe(true);
    expect(existsSync(join(infraRepo, '.pan', 'records', 'pan-1909.json'))).toBe(false);
  });

  it('commits queued records to the infra repo', async () => {
    mkdirSync(join(projectRoot, '.pan', 'continues'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.pan', 'continues', 'pan-1908.vbrief.json'),
      JSON.stringify({ issueId: 'PAN-1908' }),
    );

    await backfillIssueRecords();
    const flushResult = await Effect.runPromise(flushAutoCommits(infraRepo));

    expect(flushResult.committed).toBe(true);
    const log = execSync('git log --oneline -1', { cwd: infraRepo, encoding: 'utf-8' });
    expect(log).toContain('PAN-1908');
  });
});
