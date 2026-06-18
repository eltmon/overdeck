/**
 * Silent-bug detector for the overdeck timestamp-unit standardization (PAN-1961).
 *
 * The corruption is SILENT: no STRICT tables, so a wrong-unit value is stored, not
 * rejected. "typecheck + tests green" cannot prove the fix — so this test reads the
 * RAW stored integer and asserts its MAGNITUDE: epoch-milliseconds is ~1.7e12,
 * epoch-seconds is ~1.7e9. A `> 1e12` guard catches a seconds value instantly.
 *
 * Standard: all overdeck timestamps are integer epoch-MILLISECONDS (`mode:'timestamp_ms'`).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Effect } from 'effect';

import { Db } from '../../../../src/lib/overdeck/infra.js';
import { overdeckIssues, type IssueId, type Stage } from '../../../../src/lib/overdeck/issues.js';
import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  saveOverdeckAgentStateSync,
  type OverdeckTestDb,
} from '../../../helpers/overdeck-test-db.js';

const MS_FLOOR = 1_000_000_000_000; // 1e12 — below this is seconds (or 1970), above is plausible ms

describe('overdeck timestamp units — integer epoch-milliseconds (PAN-1961)', () => {
  let odb: OverdeckTestDb;
  beforeEach(() => { odb = setupOverdeckTestDb(); });
  afterEach(() => { teardownOverdeckTestDb(odb); });

  it('Drizzle resolver writes issues.updated_at as epoch MILLISECONDS, not seconds', async () => {
    const before = Date.now();
    await Effect.runPromise(
      Db.pipe(
        Effect.flatMap((db) =>
          Effect.promise(() =>
            db.q
              .insert(overdeckIssues)
              .values({ id: 'PAN-TS-1' as IssueId, stage: 'working' as Stage, blockers: [], updatedAt: new Date() })
              .then(() => {}),
          ),
        ),
        Effect.provide(odb.dbLayer),
      ),
    );
    const row = odb.raw().prepare('SELECT updated_at FROM issues WHERE id = ?').get('PAN-TS-1') as { updated_at: number };
    expect(row.updated_at).toBeGreaterThan(MS_FLOOR);
    expect(Math.abs(row.updated_at - before)).toBeLessThan(60_000);
  });

  it('raw agent-state path writes agents.updated_at as epoch MILLISECONDS', () => {
    const before = Date.now();
    saveOverdeckAgentStateSync({
      id: 'agent-pan-9001',
      issueId: 'PAN-9001',
      workspace: '/tmp/ws',
      role: 'work',
      model: 'x',
      status: 'running',
      startedAt: new Date().toISOString(),
    } as Parameters<typeof saveOverdeckAgentStateSync>[0]);
    const row = odb.raw().prepare('SELECT updated_at FROM agents WHERE id = ?').get('agent-pan-9001') as { updated_at: number };
    expect(row.updated_at).toBeGreaterThan(MS_FLOOR);
    expect(Math.abs(row.updated_at - before)).toBeLessThan(60_000);
  });

  it('the two write paths agree on unit for the same column (no seconds/millis collision)', async () => {
    // issues.updated_at is written by both the Drizzle resolver and the raw sync path.
    await Effect.runPromise(
      Db.pipe(
        Effect.flatMap((db) =>
          Effect.promise(() =>
            db.q.insert(overdeckIssues).values({ id: 'PAN-TS-2' as IssueId, stage: 'working' as Stage, blockers: [], updatedAt: new Date() }).then(() => {}),
          ),
        ),
        Effect.provide(odb.dbLayer),
      ),
    );
    saveOverdeckAgentStateSync({
      id: 'agent-pan-9002', issueId: 'PAN-TS-3', workspace: '/tmp/ws', role: 'work', model: 'x',
      status: 'running', startedAt: new Date().toISOString(),
    } as Parameters<typeof saveOverdeckAgentStateSync>[0]);
    const a = odb.raw().prepare('SELECT updated_at FROM issues WHERE id = ?').get('PAN-TS-2') as { updated_at: number };
    const b = odb.raw().prepare('SELECT updated_at FROM issues WHERE id = ?').get('PAN-TS-3') as { updated_at: number };
    // Same column, two writers — both must be in the ms range (within ~5 min of each other).
    expect(a.updated_at).toBeGreaterThan(MS_FLOOR);
    expect(b.updated_at).toBeGreaterThan(MS_FLOOR);
    expect(Math.abs(a.updated_at - b.updated_at)).toBeLessThan(300_000);
  });
});
