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
const mockListOverdeckAgentStatesSync = vi.hoisted(() => vi.fn());
const mockGetProjectSync = vi.hoisted(() => vi.fn());

// records.ts now imports from overdeck/cost-sync (not database/cost-events-db)
vi.mock('../../overdeck/cost-sync.js', () => ({
  getCostBreakdownByStageAndModelSync: mockGetCostBreakdownByStageAndModel,
  getCostForIssueSync: mockGetCostForIssueFromDb,
}));

vi.mock('../../merge-set.js', () => ({
  getMergeSetSync: mockGetMergeSetSync,
}));

vi.mock('../auto-commit.js', () => ({
  queueAutoCommit: mockQueueAutoCommit,
}));

vi.mock('../../overdeck/agent-state-sync.js', () => ({
  listOverdeckAgentStatesSync: mockListOverdeckAgentStatesSync,
  getOverdeckAgentStateSync: vi.fn(),
  saveOverdeckAgentStateSync: vi.fn(),
}));

const mockResolveProjectFromIssueSync = vi.hoisted(() => vi.fn().mockReturnValue(null));

vi.mock('../../projects.js', async () => {
  const actual = await vi.importActual<typeof import('../../projects.js')>('../../projects.js');
  return {
    ...actual,
    getProjectSync: mockGetProjectSync,
    resolveProjectFromIssueSync: mockResolveProjectFromIssueSync,
  };
});

// ─── Import after mocks ───────────────────────────────────────────────────────

import {
  buildIssueRecord,
  getIssueRecordPath,
  markRecordPipelineClosedOutSync,
  writeIssueRecordSync,
  queueIssueRecordCommit,
  readIssueRecord,
  updateIssueRecordForIssue,
  claimIssueOwner,
  clearIssueOwner,
} from '../records.js';

import {
  readIssueRecordSync,
  readRecordContinueViewSync,
  RECORD_SCHEMA_VERSION,
  writeRecordDecisionsSync,
  writeRecordDecisions,
  writeRecordHazardsSync,
  writeRecordHazards,
  writeRecordResumePointSync,
  writeRecordResumePoint,
  writeRecordBeadsMappingSync,
  writeRecordBeadsMapping,
} from '../record.js';

describe('buildIssueRecord', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'pan-records-test-'));
    mockGetCostBreakdownByStageAndModel.mockReturnValue({ byStage: {}, totals: {} });
    mockGetCostForIssueFromDb.mockReturnValue(null);
    mockGetMergeSetSync.mockReturnValue(null);
    mockListOverdeckAgentStatesSync.mockReturnValue([]);
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
      prUrl: 'https://github.com/eltmon/overdeck/pull/1908',
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
        { artifactUrl: 'https://github.com/eltmon/overdeck/pull/1908' },
      ],
    });

    const record = await buildIssueRecord({ name: 'Test', path: projectRoot }, 'PAN-1908', { closedAt: '2026-06-15T01:00:00.000Z' });

    expect(record.closeOut.merges).toEqual([
      'https://github.com/eltmon/overdeck/pull/1908',
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

describe('markRecordPipelineClosedOutSync', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'pan-records-closed-out-'));
    mockQueueAutoCommit.mockClear();
    mockGetProjectSync.mockReset();
    mockResolveProjectFromIssueSync.mockReturnValue(null);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function makeProject(): ProjectConfig {
    return { name: 'Test', path: tmp };
  }

  it('marks the durable pipeline journal closed-out and terminal', () => {
    const project = makeProject();
    writeIssueRecordSync(project, 'PAN-2054', {
      issueId: 'PAN-2054',
      schemaVersion: 2,
      pipeline: {
        issueId: 'PAN-2054',
        reviewStatus: 'passed',
        testStatus: 'passed',
        verificationStatus: 'running',
        mergeStatus: 'pending',
        readyForMerge: true,
        updatedAt: '2026-06-15T00:00:00.000Z',
      },
      closeOut: { usage: { byStage: {}, totals: {} }, merges: [], ranOn: 'host' },
    });

    markRecordPipelineClosedOutSync(project, 'PAN-2054');

    const record = readIssueRecordSync(project, 'PAN-2054');
    expect(record?.pipeline.closedOut).toBe(true);
    expect(record?.pipeline.closedOutAt).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(record?.pipeline.closedOutAt ?? ''))).toBe(false);
    expect(record?.pipeline.readyForMerge).toBe(false);
    expect(record?.pipeline.verificationStatus).toBeUndefined();
    expect(record?.pipeline.mergeStatus).toBe('merged');
    expect(record?.pipeline.updatedAt).toBe(record?.pipeline.closedOutAt);
    expect(mockQueueAutoCommit).toHaveBeenCalled();
  });

  it('preserves closed-out markers when updateIssueRecordForIssue rebuilds the record', async () => {
    const project = makeProject();
    writeIssueRecordSync(project, 'PAN-2054', {
      issueId: 'PAN-2054',
      schemaVersion: 2,
      pipeline: {
        issueId: 'PAN-2054',
        reviewStatus: 'passed',
        testStatus: 'passed',
        readyForMerge: false,
        mergeStatus: 'merged',
        closedOut: true,
        closedOutAt: '2026-06-27T00:00:00.000Z',
        updatedAt: '2026-06-27T00:00:00.000Z',
      },
      closeOut: { usage: { byStage: {}, totals: {} }, merges: [], ranOn: 'host' },
    });
    mockGetCostBreakdownByStageAndModel.mockReturnValue({ byStage: {}, totals: {} });
    mockGetCostForIssueFromDb.mockReturnValue(null);
    mockGetMergeSetSync.mockReturnValue(null);
    mockListOverdeckAgentStatesSync.mockReturnValue([]);
    mockResolveProjectFromIssueSync.mockReturnValue({ projectKey: 'test', projectPath: project.path });
    mockGetProjectSync.mockReturnValue(project);

    await updateIssueRecordForIssue('PAN-2054', {
      issueId: 'PAN-2054',
      reviewStatus: 'pending',
      testStatus: 'pending',
      verificationStatus: 'pending',
      mergeStatus: 'pending',
      readyForMerge: false,
      updatedAt: '2026-06-27T01:00:00.000Z',
    });

    const record = readIssueRecordSync(project, 'PAN-2054');
    expect(record?.pipeline.closedOut).toBe(true);
    expect(record?.pipeline.closedOutAt).toBe('2026-06-27T00:00:00.000Z');
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

// ─── PAN-1919: readRecordContinueViewSync ─────────────────────────────────────

describe('readRecordContinueViewSync (PAN-1919)', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'pan-records-cv-'));
    mockQueueAutoCommit.mockClear();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function makeProject(): ProjectConfig {
    return { name: 'Test', path: tmp };
  }

  it('returns null when no record file exists', () => {
    const project = makeProject();
    const view = readRecordContinueViewSync(project, 'PAN-1919');
    expect(view).toBeNull();
  });

  it('returns a ContinueState-shaped projection from the record', () => {
    const project = makeProject();
    writeIssueRecordSync(project, 'PAN-1919', {
      issueId: 'PAN-1919',
      schemaVersion: 2,
      decisions: [{ id: 'D1', summary: 'use record', recordedAt: '2026-01-01' }],
      hazards: [{ id: 'H1', summary: 'big change', mitigation: 'audit' }],
      resumePoint: { description: 'resume here', beadId: 'bead-abc' },
      beadsMapping: { 'item-1': ['bead-a'] },
      sessionHistory: [{ reason: 'work', note: 'did stuff', timestamp: '2026-01-01T00:00:00.000Z' }],
      feedback: [{ seq: 1, specialist: 'review-agent', outcome: 'approved', timestamp: '2026-01-01T00:00:00.000Z', markdownBody: 'lgtm' }],
      pipeline: { issueId: 'PAN-1919', reviewStatus: 'pending', testStatus: 'pending', readyForMerge: false, updatedAt: '2026-01-01T00:00:00.000Z' },
      closeOut: { usage: { byStage: {}, totals: {} }, merges: [], ranOn: 'host' },
    });

    const view = readRecordContinueViewSync(project, 'PAN-1919');
    expect(view).not.toBeNull();
    expect(view?.decisions).toEqual([{ id: 'D1', summary: 'use record', recordedAt: '2026-01-01' }]);
    expect(view?.hazards).toEqual([{ id: 'H1', summary: 'big change', mitigation: 'audit' }]);
    expect(view?.resumePoint).toEqual({ description: 'resume here', beadId: 'bead-abc' });
    expect(view?.beadsMapping).toEqual({ 'item-1': ['bead-a'] });
    expect(view?.sessionHistory).toHaveLength(1);
    expect(view?.feedback).toHaveLength(1);
  });

  it('returns empty arrays for missing optional fields', () => {
    const project = makeProject();
    writeIssueRecordSync(project, 'PAN-1919', {
      issueId: 'PAN-1919',
      schemaVersion: 2,
      pipeline: { issueId: 'PAN-1919', reviewStatus: 'pending', testStatus: 'pending', readyForMerge: false, updatedAt: '2026-01-01T00:00:00.000Z' },
      closeOut: { usage: { byStage: {}, totals: {} }, merges: [], ranOn: 'host' },
    });

    const view = readRecordContinueViewSync(project, 'PAN-1919');
    expect(view?.decisions).toEqual([]);
    expect(view?.hazards).toEqual([]);
    expect(view?.resumePoint).toBeNull();
    expect(view?.beadsMapping).toEqual({});
    expect(view?.sessionHistory).toEqual([]);
    expect(view?.feedback).toEqual([]);
  });
});

// ─── PAN-1919: continue field setters ─────────────────────────────────────────

describe('writeRecordDecisions / writeRecordDecisionsSync (PAN-1919)', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'pan-records-decisions-'));
    mockQueueAutoCommit.mockClear();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function makeProject(): ProjectConfig {
    return { name: 'Test', path: tmp };
  }

  it('sync: persists decisions and leaves other fields intact', () => {
    const project = makeProject();
    writeIssueRecordSync(project, 'PAN-1919', {
      issueId: 'PAN-1919',
      schemaVersion: 2,
      hazards: [{ id: 'H1', summary: 'risk', mitigation: 'audit' }],
      pipeline: { issueId: 'PAN-1919', reviewStatus: 'pending', testStatus: 'pending', readyForMerge: false, updatedAt: '2026-01-01T00:00:00.000Z' },
      closeOut: { usage: { byStage: {}, totals: {} }, merges: [], ranOn: 'host' },
    });

    const decisions = [{ id: 'D1', summary: 'use record', recordedAt: '2026-01-01' }];
    writeRecordDecisionsSync(project, 'PAN-1919', decisions);

    const record = readIssueRecordSync(project, 'PAN-1919');
    expect(record?.decisions).toEqual(decisions);
    expect(record?.hazards).toEqual([{ id: 'H1', summary: 'risk', mitigation: 'audit' }]);
    expect(mockQueueAutoCommit).toHaveBeenCalled();
  });

  it('async: persists decisions and queues commit', async () => {
    const project = makeProject();
    const decisions = [{ id: 'D2', summary: 'async', recordedAt: '2026-01-02' }];
    await writeRecordDecisions(project, 'PAN-1919', decisions);

    const record = readIssueRecordSync(project, 'PAN-1919');
    expect(record?.decisions).toEqual(decisions);
    expect(mockQueueAutoCommit).toHaveBeenCalled();
  });
});

describe('writeRecordHazards / writeRecordHazardsSync (PAN-1919)', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'pan-records-hazards-'));
    mockQueueAutoCommit.mockClear();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function makeProject(): ProjectConfig {
    return { name: 'Test', path: tmp };
  }

  it('sync: persists hazards and leaves other fields intact', () => {
    const project = makeProject();
    writeIssueRecordSync(project, 'PAN-1919', {
      issueId: 'PAN-1919',
      schemaVersion: 2,
      decisions: [{ id: 'D1', summary: 'keep', recordedAt: '2026-01-01' }],
      pipeline: { issueId: 'PAN-1919', reviewStatus: 'pending', testStatus: 'pending', readyForMerge: false, updatedAt: '2026-01-01T00:00:00.000Z' },
      closeOut: { usage: { byStage: {}, totals: {} }, merges: [], ranOn: 'host' },
    });

    const hazards = [{ id: 'H1', summary: 'new hazard', mitigation: 'audit' }];
    writeRecordHazardsSync(project, 'PAN-1919', hazards);

    const record = readIssueRecordSync(project, 'PAN-1919');
    expect(record?.hazards).toEqual(hazards);
    expect(record?.decisions).toEqual([{ id: 'D1', summary: 'keep', recordedAt: '2026-01-01' }]);
    expect(mockQueueAutoCommit).toHaveBeenCalled();
  });

  it('async: persists hazards and queues commit', async () => {
    const project = makeProject();
    const hazards = [{ id: 'H2', summary: 'async hazard', mitigation: 'watch' }];
    await writeRecordHazards(project, 'PAN-1919', hazards);

    const record = readIssueRecordSync(project, 'PAN-1919');
    expect(record?.hazards).toEqual(hazards);
    expect(mockQueueAutoCommit).toHaveBeenCalled();
  });
});

describe('writeRecordResumePoint / writeRecordResumePointSync (PAN-1919)', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'pan-records-resume-'));
    mockQueueAutoCommit.mockClear();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function makeProject(): ProjectConfig {
    return { name: 'Test', path: tmp };
  }

  it('sync: persists resumePoint and leaves other fields intact', () => {
    const project = makeProject();
    writeIssueRecordSync(project, 'PAN-1919', {
      issueId: 'PAN-1919',
      schemaVersion: 2,
      decisions: [{ id: 'D1', summary: 'keep', recordedAt: '2026-01-01' }],
      pipeline: { issueId: 'PAN-1919', reviewStatus: 'pending', testStatus: 'pending', readyForMerge: false, updatedAt: '2026-01-01T00:00:00.000Z' },
      closeOut: { usage: { byStage: {}, totals: {} }, merges: [], ranOn: 'host' },
    });

    const resumePoint = { description: 'continue from bead-x', beadId: 'bead-x' };
    writeRecordResumePointSync(project, 'PAN-1919', resumePoint);

    const record = readIssueRecordSync(project, 'PAN-1919');
    expect(record?.resumePoint).toEqual(resumePoint);
    expect(record?.decisions).toEqual([{ id: 'D1', summary: 'keep', recordedAt: '2026-01-01' }]);
    expect(mockQueueAutoCommit).toHaveBeenCalled();
  });

  it('sync: can clear resumePoint to null', () => {
    const project = makeProject();
    writeIssueRecordSync(project, 'PAN-1919', {
      issueId: 'PAN-1919',
      schemaVersion: 2,
      resumePoint: { description: 'old', beadId: 'bead-old' },
      pipeline: { issueId: 'PAN-1919', reviewStatus: 'pending', testStatus: 'pending', readyForMerge: false, updatedAt: '2026-01-01T00:00:00.000Z' },
      closeOut: { usage: { byStage: {}, totals: {} }, merges: [], ranOn: 'host' },
    });

    writeRecordResumePointSync(project, 'PAN-1919', null);

    const record = readIssueRecordSync(project, 'PAN-1919');
    expect(record?.resumePoint).toBeNull();
  });

  it('async: persists resumePoint and queues commit', async () => {
    const project = makeProject();
    const resumePoint = { description: 'async resume', beadId: 'bead-async' };
    await writeRecordResumePoint(project, 'PAN-1919', resumePoint);

    const record = readIssueRecordSync(project, 'PAN-1919');
    expect(record?.resumePoint).toEqual(resumePoint);
    expect(mockQueueAutoCommit).toHaveBeenCalled();
  });
});

describe('writeRecordBeadsMapping / writeRecordBeadsMappingSync (PAN-1919)', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'pan-records-beads-'));
    mockQueueAutoCommit.mockClear();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function makeProject(): ProjectConfig {
    return { name: 'Test', path: tmp };
  }

  it('sync: persists beadsMapping and leaves other fields intact', () => {
    const project = makeProject();
    writeIssueRecordSync(project, 'PAN-1919', {
      issueId: 'PAN-1919',
      schemaVersion: 2,
      decisions: [{ id: 'D1', summary: 'keep', recordedAt: '2026-01-01' }],
      pipeline: { issueId: 'PAN-1919', reviewStatus: 'pending', testStatus: 'pending', readyForMerge: false, updatedAt: '2026-01-01T00:00:00.000Z' },
      closeOut: { usage: { byStage: {}, totals: {} }, merges: [], ranOn: 'host' },
    });

    const beadsMapping = { 'item-1': ['bead-a', 'bead-b'], 'item-2': ['bead-c'] };
    writeRecordBeadsMappingSync(project, 'PAN-1919', beadsMapping);

    const record = readIssueRecordSync(project, 'PAN-1919');
    expect(record?.beadsMapping).toEqual(beadsMapping);
    expect(record?.decisions).toEqual([{ id: 'D1', summary: 'keep', recordedAt: '2026-01-01' }]);
    expect(mockQueueAutoCommit).toHaveBeenCalled();
  });

  it('async: persists beadsMapping and queues commit', async () => {
    const project = makeProject();
    const beadsMapping = { 'async-item': ['bead-x'] };
    await writeRecordBeadsMapping(project, 'PAN-1919', beadsMapping);

    const record = readIssueRecordSync(project, 'PAN-1919');
    expect(record?.beadsMapping).toEqual(beadsMapping);
    expect(mockQueueAutoCommit).toHaveBeenCalled();
  });
});

describe('PAN-1919: buildIssueRecord backfill migration', () => {
  function makeProject(): ProjectConfig {
    const path = mkdtempSync(join(tmpdir(), 'pan-records-build-'));
    return { name: 'Test', path };
  }

  beforeEach(() => {
    mockGetCostBreakdownByStageAndModel.mockReturnValue({ byStage: {}, totals: {} });
    mockGetCostForIssueFromDb.mockReturnValue(null);
    mockGetMergeSetSync.mockReturnValue(null);
    mockListOverdeckAgentStatesSync.mockReturnValue([]);
    mockResolveProjectFromIssueSync.mockReturnValue(null);
    mockQueueAutoCommit.mockClear();
  });

  afterEach(() => {
    mockResolveProjectFromIssueSync.mockReturnValue(null);
  });

  it('produces a record with schemaVersion equal to RECORD_SCHEMA_VERSION (2)', async () => {
    const project = makeProject();
    const record = await buildIssueRecord(project, 'PAN-1919');
    expect(record.schemaVersion).toBe(RECORD_SCHEMA_VERSION);
    expect(record.schemaVersion).toBe(2);
    rmSync(project.path, { recursive: true, force: true });
  });

  it('folds workspace continue statusOverrides into the record', async () => {
    const project = makeProject();
    const workspaceDir = join(project.path, 'workspaces', 'feature-pan-1919');
    mkdirSync(join(workspaceDir, '.pan'), { recursive: true });
    writeFileSync(
      join(workspaceDir, '.pan', 'continue.json'),
      JSON.stringify({ statusOverrides: { 'item-1': 'completed', 'item-2': 'skipped' } }),
    );
    mockResolveProjectFromIssueSync.mockReturnValue({ projectKey: 'pan', projectPath: project.path });

    const record = await buildIssueRecord(project, 'PAN-1919');
    expect(record.statusOverrides).toEqual({ 'item-1': 'completed', 'item-2': 'skipped' });
    rmSync(project.path, { recursive: true, force: true });
  });

  it('returns undefined statusOverrides when no workspace continue exists', async () => {
    const project = makeProject();
    const record = await buildIssueRecord(project, 'PAN-1919');
    expect(record.statusOverrides).toBeUndefined();
    rmSync(project.path, { recursive: true, force: true });
  });

  it('folds harness and model from agents table into the record', async () => {
    const project = makeProject();
    mockListOverdeckAgentStatesSync.mockReturnValue([
      {
        id: 'agent-pan-1919',
        issueId: 'PAN-1919',
        role: 'work',
        harness: 'claude-code',
        model: 'claude-opus-4-8',
        status: 'stopped',
        startedAt: '2026-06-21T00:00:00.000Z',
      },
    ]);

    const record = await buildIssueRecord(project, 'PAN-1919');
    expect(record.harness).toBe('claude-code');
    expect(record.model).toBe('claude-opus-4-8');
    rmSync(project.path, { recursive: true, force: true });
  });

  it('prefers existing record harness/model over agents table', async () => {
    const project = makeProject();
    writeIssueRecordSync(project, 'PAN-1919', {
      issueId: 'PAN-1919',
      schemaVersion: 2,
      harness: 'pi',
      model: 'kimi-k2.5',
      pipeline: { issueId: 'PAN-1919', reviewStatus: 'pending', testStatus: 'pending', readyForMerge: false, updatedAt: '2026-01-01T00:00:00.000Z' },
      closeOut: { usage: { byStage: {}, totals: {} }, merges: [], ranOn: 'host' },
    });
    mockListOverdeckAgentStatesSync.mockReturnValue([
      { id: 'agent-pan-1919', issueId: 'PAN-1919', role: 'work', harness: 'claude-code', model: 'claude-opus-4-8', status: 'stopped', startedAt: '2026-06-21T00:00:00.000Z' },
    ]);

    const record = await buildIssueRecord(project, 'PAN-1919');
    expect(record.harness).toBe('pi');
    expect(record.model).toBe('kimi-k2.5');
    rmSync(project.path, { recursive: true, force: true });
  });
});
