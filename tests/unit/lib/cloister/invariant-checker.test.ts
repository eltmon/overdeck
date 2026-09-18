/**
 * PAN-3850 (W40, FR-27): the report-only invariant checker.
 *
 * ac1: a fixture with one drifted pipeline field produces exactly one activity
 *      entry (idempotent per entity per UTC day) and one invariant-mismatch
 *      orbit row when the report flows into the parked resolver.
 * ac2: a consistent fixture produces no mismatch entries and no orbit rows
 *      (the per-run summary count still lands, at info level).
 * ac3: the checker is report-only — the record writer (updateIssueRecord) and
 *      the review-status write door (setReviewStatusSync) are never called.
 *
 * Every door is injected or mocked; nothing touches a real store. The day
 * boundary, where relevant, is driven by fake timers (rule
 * `fake-timers-for-retry-tests`).
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockUpdateIssueRecord = vi.hoisted(() => vi.fn());
const mockSetReviewStatusSync = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/lib/pan-dir/record.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/pan-dir/record.js')>()),
  updateIssueRecord: mockUpdateIssueRecord,
}));
vi.mock('../../../../src/lib/review-status.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/review-status.js')>()),
  setReviewStatusSync: mockSetReviewStatusSync,
}));

import {
  compareLivenessInvariant,
  comparePipelineInvariant,
  readInvariantReport,
  runInvariantChecker,
  type InvariantMismatch,
} from '../../../../src/lib/cloister/invariant-checker.js';
import { classifyParked } from '../../../../src/lib/parked/resolver.js';
import type { PanIssuePipelineRecord } from '../../../../src/lib/pan-dir/record.js';
import type { ReviewStatus } from '../../../../src/lib/review-status.js';

const NOW = new Date('2026-09-17T12:00:00.000Z');
const DAY = '2026-09-17';

function baseRow(overrides: Partial<ReviewStatus> = {}): ReviewStatus {
  return {
    issueId: 'PAN-1',
    reviewStatus: 'passed',
    testStatus: 'passed',
    verificationStatus: 'passed',
    uatStatus: 'passed',
    reviewedAtCommit: 'abc123',
    lastVerifiedCommit: 'abc123',
    readyForMerge: true,
    reviewStaleSince: undefined,
    updatedAt: NOW.toISOString(),
    ...overrides,
  } as ReviewStatus;
}

function pipelineFor(row: ReviewStatus, overrides: Partial<PanIssuePipelineRecord> = {}): PanIssuePipelineRecord {
  return {
    issueId: row.issueId,
    reviewStatus: row.reviewStatus,
    testStatus: row.testStatus,
    verificationStatus: row.verificationStatus,
    uatStatus: row.uatStatus,
    reviewedAtCommit: row.reviewedAtCommit,
    lastVerifiedCommit: row.lastVerifiedCommit,
    readyForMerge: row.readyForMerge,
    reviewStaleSince: row.reviewStaleSince,
    ...overrides,
  } as PanIssuePipelineRecord;
}

/** Minimal parked signals: just enough for classifyParked to reach the orbits. */
function parkedSignals(invariantMismatches: InvariantMismatch[]) {
  return {
    issueId: 'PAN-1',
    reviewStatus: null,
    agents: [],
    liveAgents: [],
    openRecoveryTrips: [],
    issueClosed: false,
    invariantMismatches,
    now: NOW.getTime(),
  };
}

function makeDeps(overrides: {
  rows?: Record<string, ReviewStatus>;
  pipelines?: Record<string, PanIssuePipelineRecord | null>;
  agents?: { id: string; status: string; issueId?: string; tmuxActive: boolean }[];
  reportPath: string;
}) {
  const emitOnce = vi.fn().mockResolvedValue('appended');
  const emitSummary = vi.fn();
  const deps = {
    now: NOW,
    reportPath: overrides.reportPath,
    loadRows: () => overrides.rows ?? {},
    readPipeline: async (issueId: string) => overrides.pipelines?.[issueId] ?? null,
    listAgents: () => overrides.agents ?? [],
    emitOnce,
    emitSummary,
  };
  return { deps, emitOnce, emitSummary };
}

describe('invariant checker (PAN-3850 W40)', () => {
  let dir: string;
  let reportPath: string;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    dir = mkdtempSync(join(tmpdir(), 'pan-invariant-checker-'));
    reportPath = join(dir, 'invariant-report.json');
    mockUpdateIssueRecord.mockReset();
    mockSetReviewStatusSync.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('comparePipelineInvariant', () => {
    it('returns null when record and row agree on all shared fields', () => {
      const row = baseRow();
      expect(comparePipelineInvariant('PAN-1', pipelineFor(row), row)).toBeNull();
    });

    it('reports each drifted field with both values', () => {
      const row = baseRow();
      const pipeline = pipelineFor(row, { reviewStatus: 'pending', readyForMerge: false });
      const mismatch = comparePipelineInvariant('PAN-1', pipeline, row);
      expect(mismatch?.kind).toBe('pipeline');
      expect(mismatch?.fields.map((f) => f.field).sort()).toEqual(['readyForMerge', 'reviewStatus']);
      expect(mismatch?.fields.find((f) => f.field === 'reviewStatus')).toMatchObject({ recordValue: 'pending', rowValue: 'passed' });
    });

    it('treats a missing record as a mismatch — the record is canonical', () => {
      const mismatch = comparePipelineInvariant('PAN-1', null, baseRow());
      expect(mismatch?.fields).toEqual([{ field: 'record', recordValue: '<missing>', rowValue: '<present>' }]);
    });

    it('skips merged rows in the full run — merged issues are out of the pipeline', async () => {
      const row = baseRow({ mergeStatus: 'merged' });
      const readPipeline = vi.fn().mockResolvedValue(null);
      const { deps, emitOnce } = makeDeps({ rows: { 'pan-1': row }, reportPath });
      await runInvariantChecker({ ...deps, readPipeline });
      expect(readPipeline).not.toHaveBeenCalled();
      expect(emitOnce).not.toHaveBeenCalled();
    });
  });

  describe('compareLivenessInvariant', () => {
    it('flags a running row with no live session', () => {
      const mismatch = compareLivenessInvariant({ id: 'agent-pan-1', status: 'running', issueId: 'PAN-1', tmuxActive: false });
      expect(mismatch?.kind).toBe('liveness');
      expect(mismatch?.entity).toBe('agent-pan-1');
      expect(mismatch?.issueId).toBe('PAN-1');
    });

    it('flags a starting row with no live session', () => {
      expect(compareLivenessInvariant({ id: 'a', status: 'starting', tmuxActive: false })?.kind).toBe('liveness');
    });

    it('never flags a stopped row with a live session — the PAN-2579 warm-session steady state', () => {
      expect(compareLivenessInvariant({ id: 'a', status: 'stopped', tmuxActive: true })).toBeNull();
    });

    it('never flags a running row whose session exists', () => {
      expect(compareLivenessInvariant({ id: 'a', status: 'running', tmuxActive: true })).toBeNull();
    });
  });

  describe('runInvariantChecker', () => {
    it('ac1: one drifted field produces one activity entry and one invariant-mismatch orbit row', async () => {
      const row = baseRow();
      const drifted = pipelineFor(row, { verificationStatus: 'failed' });
      const { deps, emitOnce, emitSummary } = makeDeps({
        rows: { 'pan-1': row },
        pipelines: { 'PAN-1': drifted },
        reportPath,
      });

      const report = await runInvariantChecker(deps);

      expect(emitOnce).toHaveBeenCalledTimes(1);
      expect(emitOnce).toHaveBeenCalledWith(expect.objectContaining({
        id: `invariant-mismatch:PAN-1:${DAY}`,
        issueId: 'PAN-1',
      }));
      expect(emitSummary).toHaveBeenCalledTimes(1);
      expect(emitSummary).toHaveBeenCalledWith(expect.objectContaining({ level: 'warn' }));

      // The persisted report is what the parked resolver reads — one orbit row.
      const persisted = readInvariantReport(reportPath);
      expect(persisted.mismatches).toEqual(report.mismatches);
      const rows = classifyParked(parkedSignals(persisted.mismatches));
      expect(rows).toHaveLength(1);
      expect(rows[0].orbit).toBe('invariant-mismatch');
    });

    it('ac1 (liveness): one dead-session agent produces one entry and one orbit row', async () => {
      const { deps, emitOnce } = makeDeps({
        agents: [{ id: 'agent-pan-1', status: 'running', issueId: 'PAN-1', tmuxActive: false }],
        reportPath,
      });

      const report = await runInvariantChecker(deps);

      expect(emitOnce).toHaveBeenCalledTimes(1);
      expect(emitOnce).toHaveBeenCalledWith(expect.objectContaining({
        id: `invariant-mismatch:agent-pan-1:${DAY}`,
        issueId: 'PAN-1',
      }));
      const rows = classifyParked(parkedSignals(report.mismatches));
      expect(rows).toHaveLength(1);
      expect(rows[0].orbit).toBe('invariant-mismatch');
      expect(rows[0].unparkCondition).toContain('pan admin agents exited agent-pan-1');
    });

    it('ac2: a consistent fixture produces no mismatch entries and no orbit rows', async () => {
      const row = baseRow();
      const { deps, emitOnce, emitSummary } = makeDeps({
        rows: { 'pan-1': row },
        pipelines: { 'PAN-1': pipelineFor(row) },
        agents: [{ id: 'agent-pan-1', status: 'running', issueId: 'PAN-1', tmuxActive: true }],
        reportPath,
      });

      const report = await runInvariantChecker(deps);

      expect(report.mismatches).toEqual([]);
      expect(emitOnce).not.toHaveBeenCalled();
      // The per-run summary count still lands, at info level.
      expect(emitSummary).toHaveBeenCalledWith(expect.objectContaining({ level: 'info' }));
      expect(classifyParked(parkedSignals(readInvariantReport(reportPath).mismatches))).toEqual([]);
    });

    it('ac3: report-only — the record writer and setReviewStatusSync are never called', async () => {
      const row = baseRow();
      const { deps } = makeDeps({
        rows: { 'pan-1': row },
        pipelines: { 'PAN-1': pipelineFor(row, { reviewStatus: 'pending' }) },
        agents: [{ id: 'agent-pan-1', status: 'running', issueId: 'PAN-1', tmuxActive: false }],
        reportPath,
      });

      await runInvariantChecker(deps);

      expect(mockUpdateIssueRecord).not.toHaveBeenCalled();
      expect(mockSetReviewStatusSync).not.toHaveBeenCalled();
    });

    it('persists the report for pan doctor and the parked resolver', async () => {
      const row = baseRow();
      const { deps } = makeDeps({ rows: { 'pan-1': row }, pipelines: { 'PAN-1': pipelineFor(row) }, reportPath });
      await runInvariantChecker(deps);
      const persisted = readInvariantReport(reportPath);
      expect(persisted.generatedAt).toBe(NOW.toISOString());
      expect(persisted.mismatches).toEqual([]);
    });
  });
});
