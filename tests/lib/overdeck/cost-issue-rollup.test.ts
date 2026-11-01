import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openDatabase, type SqliteDatabase } from '../../../src/lib/database/driver.js';
import {
  COST_ISSUE_ROLLUP_GRAIN_SELECT_SQL,
  COST_ISSUE_ROLLUP_V1_OBJECTS,
  ensureCostIssueRollup,
} from '../../../src/lib/overdeck/cost-issue-rollup.js';
import { insertCostEvent } from '../../../src/lib/overdeck/cost-sync.js';
import { closeOverdeckDatabase, getOverdeckDatabase } from '../../../src/lib/overdeck/infra.js';

let originalOverdeckHome: string | undefined;
let testHome: string;

beforeEach(() => {
  originalOverdeckHome = process.env.OVERDECK_HOME;
  testHome = join(tmpdir(), `pan-4724-rollup-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testHome, { recursive: true });
  process.env.OVERDECK_HOME = testHome;
});

afterEach(() => {
  vi.restoreAllMocks();
  closeOverdeckDatabase();
  if (originalOverdeckHome === undefined) {
    delete process.env.OVERDECK_HOME;
  } else {
    process.env.OVERDECK_HOME = originalOverdeckHome;
  }
  rmSync(testHome, { recursive: true, force: true });
});

type GrainRow = {
  issue_key: string | null;
  model: string | null;
  session_type: string | null;
  provider: string | null;
  calls: number;
  cost: number;
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  tokens: number;
  last_ts: number;
};

const ORDER = 'ORDER BY issue_key, model, session_type, provider';

function grainKey(row: GrainRow): string {
  return JSON.stringify([row.issue_key, row.model, row.session_type, row.provider]);
}

function expectRollupMatchesGrainSelect(db: SqliteDatabase): void {
  const rollup = db.prepare(
    'SELECT issue_key, model, session_type, provider, calls, cost, input, output, cache_read, cache_write, tokens, last_ts '
    + `FROM cost_issue_rollup ${ORDER}`,
  ).all<GrainRow>();
  const expected = db.prepare(`SELECT * FROM (${COST_ISSUE_ROLLUP_GRAIN_SELECT_SQL}) ${ORDER}`).all<GrainRow>();

  expect(rollup.map(grainKey)).toEqual(expected.map(grainKey));
  rollup.forEach((row, index) => {
    const want = expected[index]!;
    const { cost, ...integers } = row;
    const { cost: wantCost, ...wantIntegers } = want;
    expect(integers).toEqual(wantIntegers);
    expect(cost).toBeCloseTo(wantCost, 6);
  });
  expect(rollup.length).toBeGreaterThan(0);
}

const RAW_INSERT = `INSERT INTO cost_events
  (ts, issue_id, session_type, provider, model, input, output, cache_read, cache_write, cost, request_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function insertRaw(
  db: SqliteDatabase,
  ts: number,
  issueId: string | null,
  sessionType: string,
  provider: string | null,
  model: string,
  cost: number,
  requestId: string,
): void {
  db.prepare(RAW_INSERT).run(ts, issueId, sessionType, provider, model, 100, 50, 10, 5, cost, requestId);
}

describe('cost_issue_rollup install (PAN-4724)', () => {
  it('installs the v1 objects on a fresh database', () => {
    const db = getOverdeckDatabase();
    const names = db.prepare('SELECT name FROM sqlite_master').all<{ name: string }>().map((row) => row.name);
    for (const name of COST_ISSUE_ROLLUP_V1_OBJECTS) expect(names).toContain(name);
  });

  it('backfills rows written before install', () => {
    const db = getOverdeckDatabase();
    db.exec('DROP TRIGGER cost_issue_rollup_ai_v1');
    db.exec('DROP TABLE cost_issue_rollup');

    insertRaw(db, 1000, null, 'work', 'anthropic', 'model-a', 0.1, 'r1');
    insertRaw(db, 2000, null, 'work', 'anthropic', 'model-a', 0.2, 'r2');
    insertRaw(db, 3000, 'pan-1', 'work', 'anthropic', 'model-a', 0.3, 'r3');
    insertRaw(db, 4000, 'PAN-1', 'work', 'anthropic', 'model-a', 0.4, 'r4');
    insertRaw(db, 5000, 'PAN-1', 'review', null, 'model-b', 0.5, 'r5');
    insertRaw(db, 6000, 'PAN-2', 'review', null, 'model-b', 0.6, 'r6');

    expect(ensureCostIssueRollup(db)).toBe(true);
    expectRollupMatchesGrainSelect(db);

    const pan1 = db.prepare(
      "SELECT calls, last_ts FROM cost_issue_rollup WHERE issue_key = 'PAN-1' AND model = 'model-a'",
    ).get<{ calls: number; last_ts: number }>();
    expect(pan1).toEqual({ calls: 2, last_ts: 4000 });
  });

  it('maintains the rollup for every writer', () => {
    const db = getOverdeckDatabase();

    insertCostEvent({
      ts: '2026-06-25T12:00:00.000Z', input: 100, output: 50, cacheRead: 7, cacheWrite: 3, cost: 0.25,
      provider: 'openai', model: 'gpt-test', requestId: 'dup', issueId: 'pan-9', sessionType: 'work',
    });
    insertCostEvent({
      ts: '2026-06-25T12:01:00.000Z', input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: 0.05,
      model: 'gpt-test', requestId: 'no-provider', sessionType: 'work',
    });
    insertRaw(db, 1_000, 'PAN-9', 'work', 'openai', 'gpt-test', 0.75, 'raw-1');
    insertRaw(db, 2_000, null, 'review', null, 'other', 0.01, 'raw-2');
    expectRollupMatchesGrainSelect(db);

    const before = db.prepare(`SELECT * FROM cost_issue_rollup ${ORDER}`).all();
    insertCostEvent({
      ts: '2026-06-25T13:00:00.000Z', input: 999, output: 999, cacheRead: 0, cacheWrite: 0, cost: 9.99,
      provider: 'openai', model: 'gpt-test', requestId: 'dup', issueId: 'PAN-9', sessionType: 'work',
    });
    expect(db.prepare(`SELECT * FROM cost_issue_rollup ${ORDER}`).all()).toEqual(before);
    expectRollupMatchesGrainSelect(db);
  });

  it('second call does not take the write lock', () => {
    const db = getOverdeckDatabase();
    const other = openDatabase(join(testHome, 'overdeck.db'));
    try {
      other.exec('BEGIN IMMEDIATE');
      expect(ensureCostIssueRollup(db)).toBe(true);
      other.exec('ROLLBACK');
    } finally {
      other.close();
    }
  });

  it('returns false without logging when cost_events is absent', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bare = openDatabase(join(testHome, 'bare.db'));
    try {
      expect(ensureCostIssueRollup(bare)).toBe(false);
    } finally {
      bare.close();
    }
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
