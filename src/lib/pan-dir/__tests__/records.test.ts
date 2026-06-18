/**
 * Tests for PAN-1908 / PAN-1919 per-issue git-tracked record.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ProjectConfig } from '../../projects.js';

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockGetCostBreakdownByStageAndModel = vi.hoisted(() => vi.fn());
const mockGetCostForIssueFromDb = vi.hoisted(() => vi.fn());
const mockGetMergeSetSync = vi.hoisted(() => vi.fn());
const mockQueueAutoCommit = vi.hoisted(() => vi.fn());

vi.mock('../../database/cost-events-db.js', () => ({
  getCostBreakdownByStageAndModel: mockGetCostBreakdownByStageAndModel,
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
  readIssueRecord,
  claimIssueOwner,
  clearIssueOwner,
} from '../records.js';

describe('buildIssueRecord', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'pan-records-test-'));
    mockGetCostBreakdownByStageAndModel.mockReturnValue({ byStage: {}, totals: {} });
    mockGetCostForIssueFromDb.mockReturnValue(null);
    mockGetMergeSetSync.mockReturnValue(null);
    mockQueueAutoCommit.mockClear();
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('projects durable continue subset and folds in runtime fields (PAN-1919)', async () => {
    mkdirSync(join(projectRoot, '.pan', 'continues'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.pan', 'continues', 'pan-1908.vbrief.json'),
      JSON.stringify({
        issueId: 'PAN-1908',
        gitState: { branch: 'feature/pan-1908', sha: 'abc123', dirty: false },
        decisions: [{ id: 'D1', summary: 'keep state.json', recordedAt: '2026-01-01' }],
        hazards: [{ id: 'H1', summary: 'big PR', mitigation: 'audit' }],
        resumePoint: { description: 'resume here', beadId: 'infra-record-writer' },
        sessionHistory: [{ reason: 'work', note: 'did stuff', timestamp: '2026-01-01T00:00:00.000Z' }],
        agentModel: 'claude-opus-4-8',
        beadsMapping: { 'item-1': ['bead-a'] },
      }),
    );

    const record = await buildIssueRecord({ name: 'Test', path: projectRoot }, 'PAN-1908');

    expect(record.issueId).toBe('PAN-1908');
    expect(record.decisions).toHaveLength(1);
    expect(record.hazards).toHaveLength(1);
    expect(record.resumePoint).toEqual({ description: 'resume here', beadId: 'infra-record-writer' });
    expect(record.beadsMapping).toEqual({ 'item-1': ['bead-a'] });
    expect(record.sessionHistory).toHaveLength(1);
    expect(record.feedback).toEqual([]);
    expect(record).not.toHaveProperty('continue');
    expect(record).not.toHaveProperty('agentModel');
    expect(record).not.toHaveProperty('gitState');
  });

  it('projects durable review_status verdicts', async () => {
    const reviewStatus = {
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
    };

    const record = await buildIssueRecord({ name: 'Test', path: projectRoot }, 'PAN-1908', { reviewStatus });

    expect(record.pipeline.issueId).toBe('PAN-1908');
    expect(record.pipeline.reviewStatus).toBe('passed');
    expect(record.pipeline.readyForMerge).toBe(true);
    expect(record.pipeline.prNumber).toBe(1908);
    expect(record.pipeline.mergeStatus).toBe('merged');
    expect(record.pipeline).not.toHaveProperty('verificationCycleCount');
    expect(record.pipeline).not.toHaveProperty('mergeRetryCount');
  });

  it('omits ephemeral review_status fields', async () => {
    const reviewStatus = {
      issueId: 'PAN-1908',
      reviewStatus: 'pending',
      testStatus: 'pending',
      readyForMerge: false,
      verificationCycleCount: 3,
      mergeRetryCount: 2,
      queuePosition: 1,
      updatedAt: '2026-06-15T00:00:00.000Z',
    };

    const record = await buildIssueRecord({ name: 'Test', path: projectRoot }, 'PAN-1908', { reviewStatus });

    expect(record.pipeline).not.toHaveProperty('verificationCycleCount');
    expect(record.pipeline).not.toHaveProperty('mergeRetryCount');
    expect(record.pipeline).not.toHaveProperty('queuePosition');
  });

  it('aggregates usage and merges into closeOut', async () => {
    mockGetCostBreakdownByStageAndModel.mockReturnValue({
      byStage: {
        work: {
          'anthropic/claude-opus-4-8': { input: 100, output: 50, cacheRead: 200, cacheWrite: 10 },
        },
        review: {
          'openai-codex/gpt-5.5': { input: 80, output: 20, cacheRead: 100, cacheWrite: 5 },
        },
      },
      totals: {
        'anthropic/claude-opus-4-8': { input: 100, output: 50, cacheRead: 200, cacheWrite: 10 },
        'openai-codex/gpt-5.5': { input: 80, output: 20, cacheRead: 100, cacheWrite: 5 },
      },
    });
    mockGetCostForIssueFromDb.mockReturnValue({
      issueId: 'PAN-1908',
      totalCost: 12.34,
    });

    mockGetMergeSetSync.mockReturnValue({
      issueId: 'PAN-1908',
      repos: [
        { artifactUrl: 'https://github.com/eltmon/panopticon-cli/pull/1908' },
      ],
    });

    const record = await buildIssueRecord({ name: 'Test', path: projectRoot }, 'PAN-1908', { closedAt: '2026-06-15T01:00:00.000Z' });

    expect(record.closeOut.merges).toEqual([
      'https://github.com/eltmon/panopticon-cli/pull/1908',
    ]);
    expect(record.closeOut.closedAt).toBe('2026-06-15T01:00:00.000Z');
    expect(record.closeOut.ranOn).toBeTruthy();
    expect(record.closeOut.usage.byStage.work['anthropic/claude-opus-4-8']).toEqual({
      input: 100, output: 50, cacheRead: 200, cacheWrite: 10,
    });
    expect(record.closeOut.usage.totals['anthropic/claude-opus-4-8']).toEqual({
      input: 100, output: 50, cacheRead: 200, cacheWrite: 10,
    });
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

  it('writes to .pan/records under the project path by default (tests fallback)', () => {
    const project = makeProject();
    const path = writeIssueRecordSync(project, 'PAN-1908', {
      issueId: 'PAN-1908',
      schemaVersion: 1,
      pipeline: { issueId: 'PAN-1908', reviewStatus: 'pending', testStatus: 'pending', readyForMerge: false, updatedAt: '2026-06-15T00:00:00.000Z' },
      closeOut: { usage: { byStage: {}, totals: {} }, merges: [], ranOn: 'host' },
    });

    expect(path).toBe(join(tmp, '.pan', 'records', 'pan-1908.json'));
    expect(path).toContain('pan-1908.json');
  });

  it('queues auto-commit against the project path', () => {
    const project = makeProject();
    const recordPath = join(tmp, '.pan', 'records', 'pan-1908.json');

    queueIssueRecordCommit(project, 'PAN-1908', recordPath);

    expect(mockQueueAutoCommit).toHaveBeenCalledWith({
      projectRoot: tmp,
      repoRoot: tmp,
      paths: [recordPath],
      subject: 'chore(records): update PAN-1908 per-issue record',
    });
  });
});

describe('owner URI lease (PAN-1908)', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'pan-records-owner-'));
    mockQueueAutoCommit.mockClear();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function makeProject(): ProjectConfig {
    return { name: 'Test', path: tmp };
  }

  it('claims ownership by writing the URI into the record', async () => {
    const project = makeProject();
    const result = await claimIssueOwner(project, 'PAN-1908', 'pan://host-a:3000');

    expect(result.ok).toBe(true);
    expect(result.owner).toBe('pan://host-a:3000');

    const record = await readIssueRecord(project, 'PAN-1908');
    expect(record?.owner).toBe('pan://host-a:3000');
  });

  it('refuses to claim when a different owner URI is already set', async () => {
    const project = makeProject();
    writeIssueRecordSync(project, 'PAN-1908', {
      issueId: 'PAN-1908',
      schemaVersion: 1,
      pipeline: { issueId: 'PAN-1908', reviewStatus: 'pending', testStatus: 'pending', readyForMerge: false, updatedAt: '2026-06-15T00:00:00.000Z' },
      closeOut: { usage: { byStage: {}, totals: {} }, merges: [], ranOn: 'host' },
      owner: 'pan://host-b:3000',
    });

    const result = await claimIssueOwner(project, 'PAN-1908', 'pan://host-a:3000');

    expect(result.ok).toBe(false);
    expect(result.owner).toBe('pan://host-b:3000');

    const record = await readIssueRecord(project, 'PAN-1908');
    expect(record?.owner).toBe('pan://host-b:3000');
  });

  it('re-claims when the same owner URI is already set', async () => {
    const project = makeProject();
    writeIssueRecordSync(project, 'PAN-1908', {
      issueId: 'PAN-1908',
      schemaVersion: 1,
      pipeline: { issueId: 'PAN-1908', reviewStatus: 'pending', testStatus: 'pending', readyForMerge: false, updatedAt: '2026-06-15T00:00:00.000Z' },
      closeOut: { usage: { byStage: {}, totals: {} }, merges: [], ranOn: 'host' },
      owner: 'pan://host-a:3000',
    });

    const result = await claimIssueOwner(project, 'PAN-1908', 'pan://host-a:3000');

    expect(result.ok).toBe(true);
    expect(result.owner).toBe('pan://host-a:3000');
  });

  it('clears ownership at close-out', async () => {
    const project = makeProject();
    writeIssueRecordSync(project, 'PAN-1908', {
      issueId: 'PAN-1908',
      schemaVersion: 1,
      pipeline: { issueId: 'PAN-1908', reviewStatus: 'pending', testStatus: 'pending', readyForMerge: false, updatedAt: '2026-06-15T00:00:00.000Z' },
      closeOut: { usage: { byStage: {}, totals: {} }, merges: [], ranOn: 'host' },
      owner: 'pan://host-a:3000',
    });

    await clearIssueOwner(project, 'PAN-1908');

    const record = await readIssueRecord(project, 'PAN-1908');
    expect(record?.owner).toBeUndefined();
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

  it('defaults to .pan/records/<issue>.json', () => {
    const project: ProjectConfig = { name: 'Test', path: tmp };
    expect(getIssueRecordPath(project, 'PAN-1908')).toBe(join(tmp, '.pan', 'records', 'pan-1908.json'));
  });
});
