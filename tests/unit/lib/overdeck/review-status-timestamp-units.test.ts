/**
 * review_status timestamp-unit detector (PAN-1961 follow-up).
 *
 * review_status was the lone table left on TEXT-ISO when the rest of overdeck moved
 * to integer epoch-milliseconds. Reads the RAW stored value: ms is a `number` ~1.7e12.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  type OverdeckTestDb,
} from '../../../helpers/overdeck-test-db.js';
import {
  markWorkspaceStuck,
  setDeaconIgnored,
} from '../../../../src/lib/overdeck/review-status-sync.js';

const MS_FLOOR = 1_000_000_000_000;

describe('review_status timestamps stored as integer epoch-ms (PAN-1961)', () => {
  let odb: OverdeckTestDb;
  beforeEach(() => { odb = setupOverdeckTestDb(); });
  afterEach(() => { teardownOverdeckTestDb(odb); });

  it('markWorkspaceStuck stores updated_at and stuck_at as ms integers', () => {
    const before = Date.now();
    odb.raw().prepare("INSERT OR IGNORE INTO issues (id, stage, updated_at) VALUES (?, 'working', ?)").run('PAN-RS-1', Date.now());
    markWorkspaceStuck('PAN-RS-1', 'test reason');
    const row = odb.raw().prepare('SELECT updated_at, stuck_at FROM review_status WHERE issue_id = ?').get('PAN-RS-1') as { updated_at: number; stuck_at: number };
    expect(typeof row.updated_at).toBe('number');
    expect(row.updated_at).toBeGreaterThan(MS_FLOOR);
    expect(Math.abs(row.updated_at - before)).toBeLessThan(60_000);
    expect(row.stuck_at).toBeGreaterThan(MS_FLOOR);
  });

  it('setDeaconIgnored stores deacon_ignored_at as a ms integer', () => {
    odb.raw().prepare("INSERT OR IGNORE INTO issues (id, stage, updated_at) VALUES (?, 'working', ?)").run('PAN-RS-2', Date.now());
    setDeaconIgnored('PAN-RS-2', true, 'why');
    const row = odb.raw().prepare('SELECT deacon_ignored_at FROM review_status WHERE issue_id = ?').get('PAN-RS-2') as { deacon_ignored_at: number };
    expect(typeof row.deacon_ignored_at).toBe('number');
    expect(row.deacon_ignored_at).toBeGreaterThan(MS_FLOOR);
  });
});
