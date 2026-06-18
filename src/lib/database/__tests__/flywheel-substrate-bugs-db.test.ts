import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let TEST_HOME: string;

async function resetDb() {
  const { resetDatabase } = await import('../index.js');
  resetDatabase();
}

beforeEach(() => {
  TEST_HOME = join(
    tmpdir(),
    `pan-1487-flywheel-bugs-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(TEST_HOME, { recursive: true });
  process.env.OVERDECK_HOME = TEST_HOME;
});

afterEach(async () => {
  await resetDb();
  delete process.env.OVERDECK_HOME;
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('flywheel substrate bugs db', () => {
  it('migration v44 creates flywheel_substrate_bugs with expected columns and indexes', async () => {
    const { getDatabase } = await import('../index.js');
    const { SCHEMA_VERSION, runMigrations } = await import('../schema.js');
    const db = getDatabase();

    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    runMigrations(db);

    const columns = db.prepare(`PRAGMA table_info(flywheel_substrate_bugs)`).all() as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }>;
    expect(columns.map((column) => column.name)).toEqual([
      'issue_id',
      'filed_at',
      'run_id',
      'filed_by',
      'discovered_in_issue_id',
      'severity',
      'status',
      'fix_merged_at',
      'fix_commit_sha',
      'updated_at',
    ]);
    expect(columns.find((column) => column.name === 'issue_id')).toMatchObject({ type: 'TEXT', pk: 1 });
    expect(columns.find((column) => column.name === 'filed_at')).toMatchObject({ type: 'TEXT', notnull: 1 });
    expect(columns.find((column) => column.name === 'filed_by')).toMatchObject({ type: 'TEXT', notnull: 1 });
    expect(columns.find((column) => column.name === 'severity')).toMatchObject({ type: 'TEXT', notnull: 1, dflt_value: "'P2'" });
    expect(columns.find((column) => column.name === 'status')).toMatchObject({ type: 'TEXT', notnull: 1, dflt_value: "'open'" });
    expect(columns.find((column) => column.name === 'updated_at')).toMatchObject({ type: 'TEXT', notnull: 1 });

    const indexes = db.prepare(`PRAGMA index_list(flywheel_substrate_bugs)`).all() as Array<{ name: string }>;
    expect(indexes.map((index) => index.name)).toEqual(expect.arrayContaining([
      'idx_flywheel_substrate_bugs_filed_at',
      'idx_flywheel_substrate_bugs_filed_by_filed_at',
      'idx_flywheel_substrate_bugs_status_fix_merged_at',
    ]));

    const table = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'flywheel_substrate_bugs'`).get() as { sql: string };
    expect(table.sql).toContain("CHECK (filed_by IN ('agent','operator'))");
  });

  it('upsert inserts and updates substrate bugs', async () => {
    const { getByIssueId, upsert } = await import('../flywheel-substrate-bugs-db.js');

    const inserted = upsert({
      issueId: 'PAN-100',
      filedAt: '2026-05-01T00:00:00.000Z',
      runId: 'RUN-1',
      filedBy: 'agent',
      discoveredInIssueId: 'PAN-1',
      updatedAt: '2026-05-01T00:00:00.000Z',
    });

    expect(inserted).toMatchObject({
      issueId: 'PAN-100',
      runId: 'RUN-1',
      filedBy: 'agent',
      discoveredInIssueId: 'PAN-1',
      severity: 'P2',
      status: 'open',
    });

    const updated = upsert({
      issueId: 'PAN-100',
      filedAt: '2026-05-02T00:00:00.000Z',
      runId: 'RUN-2',
      filedBy: 'operator',
      discoveredInIssueId: 'PAN-2',
      severity: 'P1',
      updatedAt: '2026-05-02T00:00:00.000Z',
    });

    expect(updated).toMatchObject({
      issueId: 'PAN-100',
      filedAt: '2026-05-02T00:00:00.000Z',
      runId: 'RUN-2',
      filedBy: 'operator',
      discoveredInIssueId: 'PAN-2',
      severity: 'P1',
      status: 'open',
      updatedAt: '2026-05-02T00:00:00.000Z',
    });
    expect(getByIssueId('PAN-100')).toEqual(updated);
  });

  it('listInWindow filters by filed_at range', async () => {
    const { listInWindow, upsert } = await import('../flywheel-substrate-bugs-db.js');

    upsert({ issueId: 'PAN-1', filedAt: '2026-05-01T00:00:00.000Z', filedBy: 'agent', updatedAt: '2026-05-01T00:00:00.000Z' });
    upsert({ issueId: 'PAN-2', filedAt: '2026-05-10T00:00:00.000Z', filedBy: 'agent', updatedAt: '2026-05-10T00:00:00.000Z' });
    upsert({ issueId: 'PAN-3', filedAt: '2026-05-20T00:00:00.000Z', filedBy: 'operator', updatedAt: '2026-05-20T00:00:00.000Z' });

    expect(listInWindow('2026-05-05T00:00:00.000Z', '2026-05-15T00:00:00.000Z').map((bug) => bug.issueId)).toEqual(['PAN-2']);
  });

  it('markFixed sets fixed status and merge metadata', async () => {
    const { getByIssueId, markFixed, upsert } = await import('../flywheel-substrate-bugs-db.js');

    upsert({
      issueId: 'PAN-100',
      filedAt: '2026-05-01T00:00:00.000Z',
      filedBy: 'agent',
      updatedAt: '2026-05-01T00:00:00.000Z',
    });

    const fixed = markFixed('PAN-100', 'abc123', '2026-05-03T00:00:00.000Z');

    expect(fixed).toMatchObject({
      issueId: 'PAN-100',
      status: 'fixed',
      fixCommitSha: 'abc123',
      fixMergedAt: '2026-05-03T00:00:00.000Z',
      updatedAt: '2026-05-03T00:00:00.000Z',
    });
    expect(getByIssueId('PAN-100')).toEqual(fixed);
  });

  it('preserves fixed lifecycle metadata when issue polling upserts without lifecycle fields', async () => {
    const { getByIssueId, markFixed, upsert } = await import('../flywheel-substrate-bugs-db.js');

    upsert({
      issueId: 'PAN-100',
      filedAt: '2026-05-01T00:00:00.000Z',
      runId: 'RUN-1',
      filedBy: 'agent',
      severity: 'P1',
      updatedAt: '2026-05-01T00:00:00.000Z',
    });
    markFixed('PAN-100', 'abc123', '2026-05-03T00:00:00.000Z');

    const repolled = upsert({
      issueId: 'PAN-100',
      filedAt: '2026-05-01T00:00:00.000Z',
      runId: 'RUN-1',
      filedBy: 'agent',
      severity: 'P1',
      updatedAt: '2026-05-04T00:00:00.000Z',
    });

    expect(repolled).toMatchObject({
      issueId: 'PAN-100',
      status: 'fixed',
      fixCommitSha: 'abc123',
      fixMergedAt: '2026-05-03T00:00:00.000Z',
      updatedAt: '2026-05-04T00:00:00.000Z',
    });
    expect(getByIssueId('PAN-100')).toEqual(repolled);
  });

  it('rejects filed_by values other than agent or operator', async () => {
    const { upsert } = await import('../flywheel-substrate-bugs-db.js');

    expect(() => upsert({
      issueId: 'PAN-100',
      filedAt: '2026-05-01T00:00:00.000Z',
      filedBy: 'robot' as 'agent',
      updatedAt: '2026-05-01T00:00:00.000Z',
    })).toThrow();
  });
});
