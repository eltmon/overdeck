import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SqliteDatabase } from '../../../src/lib/database/driver.js';
import { reclassifyUnknownCostEvents } from '../../../src/lib/costs/attribution.js';
import { COST_ISSUE_ROLLUP_GRAIN_SELECT_SQL } from '../../../src/lib/overdeck/cost-issue-rollup.js';
import { closeOverdeckDatabase, getOverdeckDatabase } from '../../../src/lib/overdeck/infra.js';

let originalOverdeckHome: string | undefined;
let testHome: string;

beforeEach(() => {
  originalOverdeckHome = process.env.OVERDECK_HOME;
  testHome = join(tmpdir(), `pan-4724-rollup-update-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testHome, { recursive: true });
  process.env.OVERDECK_HOME = testHome;
});

afterEach(() => {
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
const ROLLUP_SELECT = 'SELECT issue_key, model, session_type, provider, calls, cost, input, output, '
  + `cache_read, cache_write, tokens, last_ts FROM cost_issue_rollup ${ORDER}`;

function grainKey(row: GrainRow): string {
  return JSON.stringify([row.issue_key, row.model, row.session_type, row.provider]);
}

function expectRollupMatchesGrainSelect(db: SqliteDatabase): void {
  const rollup = db.prepare(ROLLUP_SELECT).all<GrainRow>();
  const expected = db.prepare(`SELECT * FROM (${COST_ISSUE_ROLLUP_GRAIN_SELECT_SQL}) ${ORDER}`).all<GrainRow>();

  expect(rollup.map(grainKey)).toEqual(expected.map(grainKey));
  rollup.forEach((row, index) => {
    const want = expected[index]!;
    const { cost, ...integers } = row;
    const { cost: wantCost, ...wantIntegers } = want;
    expect(integers).toEqual(wantIntegers);
    expect(cost).toBeCloseTo(wantCost, 6);
  });
}

function insertRow(
  db: SqliteDatabase,
  row: { ts: number; issueId: string | null; sessionId: string; cost: number; requestId: string },
): void {
  db.prepare(
    `INSERT INTO cost_events
      (ts, issue_id, agent_id, session_id, session_type, provider, model,
       input, output, cache_read, cache_write, cost, request_id)
     VALUES (?, ?, NULL, ?, 'work', 'anthropic', 'model-a', 100, 50, 10, 5, ?, ?)`,
  ).run(row.ts, row.issueId, row.sessionId, row.cost, row.requestId);
}

describe('cost_issue_rollup update trigger (PAN-4724)', () => {
  it('moves a reclassified row to its new issue', () => {
    const db = getOverdeckDatabase();
    insertRow(db, { ts: 1000, issueId: 'UNKNOWN', sessionId: 's1', cost: 0.1, requestId: 'r1' });
    insertRow(db, { ts: 2000, issueId: 'UNKNOWN', sessionId: 's2', cost: 0.2, requestId: 'r2' });
    insertRow(db, { ts: 3000, issueId: 'UNKNOWN', sessionId: 's3', cost: 0.3, requestId: 'r3' });

    db.prepare("UPDATE cost_events SET issue_id = 'CONVERSATIONS' WHERE session_id = ?").run('s2');

    expectRollupMatchesGrainSelect(db);
    const moved = db.prepare("SELECT calls FROM cost_issue_rollup WHERE issue_key = 'CONVERSATIONS'").get<{ calls: number }>();
    expect(moved?.calls).toBe(1);
  });

  it('drops the grain row when its last row moves out', () => {
    const db = getOverdeckDatabase();
    insertRow(db, { ts: 1000, issueId: 'PAN-1', sessionId: 's1', cost: 0.1, requestId: 'r1' });
    insertRow(db, { ts: 2000, issueId: 'pan-1', sessionId: 's2', cost: 0.2, requestId: 'r2' });

    db.exec("UPDATE cost_events SET issue_id = 'PAN-2' WHERE UPPER(issue_id) = 'PAN-1'");

    expect(db.prepare("SELECT COUNT(*) AS n FROM cost_issue_rollup WHERE issue_key = 'PAN-1'").get<{ n: number }>()?.n).toBe(0);
    expectRollupMatchesGrainSelect(db);
  });

  it('recomputes last_ts when the newest row leaves a grain', () => {
    const db = getOverdeckDatabase();
    insertRow(db, { ts: 1000, issueId: 'PAN-1', sessionId: 's1', cost: 0.1, requestId: 'r1' });
    insertRow(db, { ts: 2000, issueId: 'PAN-1', sessionId: 's2', cost: 0.2, requestId: 'r2' });

    db.prepare("UPDATE cost_events SET issue_id = 'PAN-2' WHERE session_id = ?").run('s2');

    const grain = db.prepare("SELECT last_ts FROM cost_issue_rollup WHERE issue_key = 'PAN-1'").get<{ last_ts: number }>();
    expect(grain?.last_ts).toBe(1000);
    expectRollupMatchesGrainSelect(db);
  });

  it('reclassifyUnknownCostEvents keeps the rollup exact', () => {
    const db = getOverdeckDatabase();
    insertRow(db, { ts: 1000, issueId: 'UNKNOWN', sessionId: 'orphan-1', cost: 0.1, requestId: 'r1' });
    insertRow(db, { ts: 2000, issueId: 'UNKNOWN', sessionId: 'orphan-1', cost: 0.2, requestId: 'r2' });
    insertRow(db, { ts: 3000, issueId: 'UNKNOWN', sessionId: 'orphan-2', cost: 0.3, requestId: 'r3' });
    insertRow(db, { ts: 4000, issueId: 'PAN-7', sessionId: 'kept', cost: 0.4, requestId: 'r4' });

    expect(reclassifyUnknownCostEvents()).toEqual({ updated: 3 });

    expect(db.prepare("SELECT COUNT(*) AS n FROM cost_issue_rollup WHERE issue_key = 'UNKNOWN'").get<{ n: number }>()?.n).toBe(0);
    const bucket = db.prepare(
      "SELECT calls, last_ts FROM cost_issue_rollup WHERE issue_key = 'UNATTRIBUTED'",
    ).get<{ calls: number; last_ts: number }>();
    expect(bucket).toEqual({ calls: 3, last_ts: 3000 });
    expectRollupMatchesGrainSelect(db);
  });

  it('ignores updates to unrelated columns', () => {
    const db = getOverdeckDatabase();
    insertRow(db, { ts: 1000, issueId: 'PAN-1', sessionId: 's1', cost: 0.1, requestId: 'r1' });
    insertRow(db, { ts: 2000, issueId: 'PAN-2', sessionId: 's2', cost: 0.2, requestId: 'r2' });
    const before = db.prepare(ROLLUP_SELECT).all();

    db.exec("UPDATE cost_events SET effort = 'high'");

    expect(db.prepare(ROLLUP_SELECT).all()).toEqual(before);
  });
});
