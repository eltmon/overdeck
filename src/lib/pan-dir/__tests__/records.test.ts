/**
 * Tests for PAN-1908 per-issue permanent-record writer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ProjectConfig } from '../../projects.js';

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockGetReviewStatusSync = vi.hoisted(() => vi.fn());
const mockGetCostForIssueFromDb = vi.hoisted(() => vi.fn());
const mockGetMergeSetSync = vi.hoisted(() => vi.fn());
const mockQueueAutoCommit = vi.hoisted(() => vi.fn());

vi.mock('../../review-status.js', () => ({
  getReviewStatusSync: mockGetReviewStatusSync,
}));

vi.mock('../../database/cost-events-db.js', () => ({
  getCostForIssueFromDb: mockGetCostForIssueFromDb,
}));

vi.mock('../../merge-set.js', () => ({
  getMergeSetSync: mockGetMergeSetSync,
}));

vi.mock('../auto-commit.js', () => ({
  queueAutoCommit: mockQueueAutoCommit,
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import {
  buildIssueRecord,
  getIssueRecordPath,
  writeIssueRecordSync,
  queueIssueRecordCommit,
} from '../records.js';

describe('buildIssueRecord', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'pan-records-test-'));
    mockGetReviewStatusSync.mockReturnValue(null);
    mockGetCostForIssueFromDb.mockReturnValue(null);
    mockGetMergeSetSync.mockReturnValue(null);
    mockQueueAutoCommit.mockClear();
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('projects durable continue subset and excludes runtime-only fields', async () => {
    mkdirSync(join(projectRoot, '.pan', 'continues'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.pan', 'continues', 'pan-1908.vbrief.json'),
      JSON.stringify({
        issueId: 'PAN-1908',
        gitState: { branch: 'feature/pan-1908', sha: 'abc123', dirty: false },
        decisions: [{ id: 'D1', summary: 'keep state.json', recordedAt: '2026-01-01' }],
        hazards: [{ id: 'H1', summary: 'big PR', mitigation: 'audit' }],
        resumePoint: { beadId: 'infra-record-writer' },
        sessionHistory: [{ reason: 'work', note: 'did stuff' }],
        agentModel: 'claude-opus-4-8',
        beadsMapping: {},
      }),
    );

    const record = await buildIssueRecord(projectRoot, 'PAN-1908');

    expect(record.issueId).toBe('PAN-1908');
    expect(record.continue.issueId).toBe('PAN-1908');
    expect(record.continue.branch).toBe('feature/pan-1908');
    expect(record.continue.decisions).toHaveLength(1);
    expect(record.continue.hazards).toHaveLength(1);
    expect(record.continue).not.toHaveProperty('resumePoint');
    expect(record.continue).not.toHaveProperty('sessionHistory');
    expect(record.continue).not.toHaveProperty('agentModel');
    expect(record.continue).not.toHaveProperty('beadsMapping');
    expect(record.continue).not.toHaveProperty('gitState');
  });

  it('projects durable review_status verdicts', async () => {
    mockGetReviewStatusSync.mockReturnValue({
      issueId: 'PAN-1908',
      reviewStatus: 'passed',
      testStatus: 'passed',
      verificationStatus: 'passed',
      inspectStatus: 'passed',
      mergeStatus: 'merged',
      readyForMerge: true,
      reviewNotes: 'lgtm',
      testNotes: 'green',
      verificationNotes: 'verified',
      inspectNotes: 'inspected',
      mergeNotes: 'merged',
      prUrl: 'https://github.com/eltmon/panopticon-cli/pull/1908',
      prNumber: 1908,
      prHeadSha: 'deadbeef',
      reviewedAtCommit: 'abc123',
      lastVerifiedCommit: 'def456',
      autoMerge: true,
      deaconIgnored: false,
      updatedAt: '2026-06-15T00:00:00.000Z',
    });

    const record = await buildIssueRecord(projectRoot, 'PAN-1908');

    expect(record.pipeline.issueId).toBe('PAN-1908');
    expect(record.pipeline.reviewStatus).toBe('passed');
    expect(record.pipeline.readyForMerge).toBe(true);
    expect(record.pipeline.prNumber).toBe(1908);
    expect(record.pipeline.mergeStatus).toBe('merged');
    expect(record.pipeline).not.toHaveProperty('verificationCycleCount');
    expect(record.pipeline).not.toHaveProperty('mergeRetryCount');
  });

  it('omits ephemeral review_status fields', async () => {
    mockGetReviewStatusSync.mockReturnValue({
      issueId: 'PAN-1908',
      reviewStatus: 'pending',
      testStatus: 'pending',
      readyForMerge: false,
      verificationCycleCount: 3,
      mergeRetryCount: 2,
      queuePosition: 1,
      updatedAt: '2026-06-15T00:00:00.000Z',
    });

    const record = await buildIssueRecord(projectRoot, 'PAN-1908');

    expect(record.pipeline).not.toHaveProperty('verificationCycleCount');
    expect(record.pipeline).not.toHaveProperty('mergeRetryCount');
    expect(record.pipeline).not.toHaveProperty('queuePosition');
  });

  it('aggregates usage and merges into closeOut', async () => {
    mockGetCostForIssueFromDb.mockReturnValue({
      issueId: 'PAN-1908',
      totalCost: 12.34,
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 2000,
      cacheWriteTokens: 100,
      lastUpdated: '2026-06-15T00:00:00.000Z',
      budgetWarning: false,
      models: {
        'anthropic/claude-opus-4-8': { cost: 10, calls: 2, tokens: 1000 },
      },
      stages: {
        work: { cost: 8, calls: 1, tokens: 700 },
        review: { cost: 4, calls: 1, tokens: 300 },
      },
    });

    mockGetMergeSetSync.mockReturnValue({
      issueId: 'PAN-1908',
      repos: [
        { artifactUrl: 'https://github.com/eltmon/panopticon-cli/pull/1908' },
      ],
    });

    const record = await buildIssueRecord(projectRoot, 'PAN-1908', { closedAt: '2026-06-15T01:00:00.000Z' });

    expect(record.closeOut.merges).toEqual([
      'https://github.com/eltmon/panopticon-cli/pull/1908',
    ]);
    expect(record.closeOut.closedAt).toBe('2026-06-15T01:00:00.000Z');
    expect(record.closeOut.ranOn).toBeTruthy();
    expect(record.closeOut.usage.byStage.work.calls).toBe(1);
    expect(record.closeOut.usage.byModel['anthropic/claude-opus-4-8'].calls).toBe(2);
    expect(record.closeOut.usage.costAtCloseOut?.usd).toBe(12.34);
  });
});

describe('writeIssueRecordSync / queueIssueRecordCommit', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'pan-records-write-'));
    mockQueueAutoCommit.mockClear();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function makeProject(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
    return {
      name: 'Test',
      path: tmp,
      ...overrides,
    };
  }

  it('writes to the project path by default', () => {
    const project = makeProject();
    const path = writeIssueRecordSync(project, 'PAN-1908', {
      issueId: 'PAN-1908',
      schemaVersion: 1,
      continue: { issueId: 'PAN-1908' },
      pipeline: { issueId: 'PAN-1908', reviewStatus: 'pending', testStatus: 'pending', readyForMerge: false, updatedAt: '2026-06-15T00:00:00.000Z' },
      closeOut: { usage: { byStage: {}, byModel: {} }, merges: [], ranOn: 'host' },
      owner: {},
    });

    expect(path).toBe(join(tmp, '.pan', 'pan-1908.json'));
    expect(path).toContain('pan-1908.json');
  });

  it('writes to a polyrepo infra repo when pan_records.repo is set', () => {
    mkdirSync(join(tmp, 'infra'), { recursive: true });
    const project = makeProject({
      workspace: {
        type: 'polyrepo',
        repos: [{ name: 'infra', path: 'infra' }],
      },
      pan_records: { repo: 'infra', path: '.pan/records' },
    });

    const path = writeIssueRecordSync(project, 'PAN-1908', {
      issueId: 'PAN-1908',
      schemaVersion: 1,
      continue: { issueId: 'PAN-1908' },
      pipeline: { issueId: 'PAN-1908', reviewStatus: 'pending', testStatus: 'pending', readyForMerge: false, updatedAt: '2026-06-15T00:00:00.000Z' },
      closeOut: { usage: { byStage: {}, byModel: {} }, merges: [], ranOn: 'host' },
      owner: {},
    });

    expect(path).toBe(join(tmp, 'infra', '.pan', 'records', 'pan-1908.json'));
  });

  it('queues auto-commit against the infra repo', () => {
    mkdirSync(join(tmp, 'infra'), { recursive: true });
    const project = makeProject({
      workspace: {
        type: 'polyrepo',
        repos: [{ name: 'infra', path: 'infra' }],
      },
      pan_records: { repo: 'infra', path: '.pan/records' },
    });
    const recordPath = join(tmp, 'infra', '.pan', 'records', 'pan-1908.json');

    queueIssueRecordCommit(project, 'PAN-1908', recordPath);

    expect(mockQueueAutoCommit).toHaveBeenCalledWith({
      projectRoot: join(tmp, 'infra'),
      paths: [recordPath],
      subject: 'chore(records): update PAN-1908 permanent record',
    });
  });
});

describe('getIssueRecordPath', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'pan-records-path-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('defaults to .pan/<issue>.json', () => {
    const project: ProjectConfig = { name: 'Test', path: tmp };
    expect(getIssueRecordPath(project, 'PAN-1908')).toBe(join(tmp, '.pan', 'pan-1908.json'));
  });
});
