/**
 * PAN-3253: ReviewStatus hydration carries only a bounded history tail.
 * The status_history TABLE keeps the full record; the in-memory object —
 * and therefore every review.status_changed event payload, which embeds
 * the full status for replay — must stay flat no matter how many
 * transitions an issue accumulated.
 */
import { describe, expect, it, vi } from 'vitest';
import { openDatabase, type SqliteDatabase } from '../../../../src/lib/database/driver.js';
import { initSchema } from '../../../../src/lib/database/schema.js';
import { REVIEW_STATUS_HISTORY_LIMIT } from '../../../../src/lib/review-status-reconcile.js';

const { getTestDb } = vi.hoisted(() => {
  let db: unknown = null;
  return {
    getTestDb: (create?: () => unknown) => {
      if (create) db = create();
      return db;
    },
  };
});

vi.mock('../../../../src/lib/database/index.js', () => ({
  getDatabase: () => getTestDb(),
}));

function seedIssue(db: SqliteDatabase, issueId: string, transitions: number): void {
  db.prepare(`
    INSERT INTO review_status (issue_id, review_status, test_status, updated_at)
    VALUES (?, 'passed', 'passed', ?)
  `).run(issueId, new Date().toISOString());
  const insert = db.prepare(`
    INSERT INTO status_history (issue_id, type, status, timestamp, notes)
    VALUES (?, 'review', ?, ?, NULL)
  `);
  for (let i = 0; i < transitions; i++) {
    insert.run(issueId, i % 2 === 0 ? 'pending' : 'passed', new Date(1_753_000_000_000 + i * 1000).toISOString());
  }
}

describe('review status history hydration cap (PAN-3253)', () => {
  it('hydrates only the most recent bounded tail after ≥500 transitions', async () => {
    const db = getTestDb(() => {
      const fresh = openDatabase(':memory:');
      initSchema(fresh as never);
      return fresh;
    }) as SqliteDatabase;
    seedIssue(db, 'MIN-901', 500);

    const { getReviewStatusFromDbSync } = await import('../../../../src/lib/database/review-status-db.js');
    const status = getReviewStatusFromDbSync('MIN-901');

    expect(status).not.toBeNull();
    expect(status!.history).toHaveLength(REVIEW_STATUS_HISTORY_LIMIT);
    // The tail is the most recent entries, in chronological order.
    const timestamps = status!.history!.map((h) => h.timestamp);
    expect(timestamps[timestamps.length - 1]).toBe(new Date(1_753_000_000_000 + 499 * 1000).toISOString());
    expect([...timestamps].sort()).toEqual(timestamps);

    // Serialized size is flat: a 500-transition issue and a 40-transition
    // issue produce identically sized history arrays.
    seedIssue(db, 'MIN-902', 40);
    const small = getReviewStatusFromDbSync('MIN-902');
    expect(JSON.stringify(small!.history).length).toBe(JSON.stringify(status!.history).length);
    db.close();
  });

  it('bulk hydration applies the same cap', async () => {
    const db = getTestDb(() => {
      const fresh = openDatabase(':memory:');
      initSchema(fresh as never);
      return fresh;
    }) as SqliteDatabase;
    seedIssue(db, 'MIN-891', 300);

    const { getAllReviewStatusesFromDb } = await import('../../../../src/lib/database/review-status-db.js');
    const all = getAllReviewStatusesFromDb();

    expect(all['MIN-891']!.history).toHaveLength(REVIEW_STATUS_HISTORY_LIMIT);
    db.close();
  });
});
