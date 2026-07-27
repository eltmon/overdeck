import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, type SqliteDatabase } from '../../../../../src/lib/database/driver.js';
import { createEventStore, type DbAdapter } from '../../../../../src/dashboard/server/event-store.js';
import { emitBootReconciledStopEvents } from '../../../../../src/dashboard/server/services/boot-reconciled-stop-events.js';

const stop = [{ id: 'agent-pan-3183', previousStatus: 'running' }];
const present = { 'agent-pan-3183': {} };

function createEventsDb(): SqliteDatabase {
  const db = openDatabase(':memory:');
  db.exec(`
    CREATE TABLE events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}'
    )
  `);
  return db;
}

describe('emitBootReconciledStopEvents', () => {
  let db: SqliteDatabase;

  beforeEach(() => {
    vi.useFakeTimers();
    db = createEventsDb();
  });

  afterEach(() => {
    db.close();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('logs sequence zero from the real async event-store failure contract', async () => {
    const failingDb: DbAdapter = {
      prepare: db.prepare.bind(db) as DbAdapter['prepare'],
      exec: (sql) => {
        if (sql === 'BEGIN IMMEDIATE') throw new Error('forced write failure');
        db.exec(sql);
      },
    };
    const store = createEventStore(failingDb);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const emitted = emitBootReconciledStopEvents(store, stop, present, 'boot append failed');
    await vi.runAllTimersAsync();
    await emitted;

    expect(store.getLatestSequence()).toBe(0);
    expect(errorSpy).toHaveBeenCalledWith(
      'boot append failed',
      expect.objectContaining({ message: 'Event append returned invalid sequence 0' }),
    );
  });

  it('deduplicates concurrent callers after one durable append succeeds', async () => {
    const store = createEventStore(db as unknown as DbAdapter);

    const first = emitBootReconciledStopEvents(store, stop, present, 'boot append failed');
    const second = emitBootReconciledStopEvents(store, stop, present, 'boot append failed');
    await vi.runAllTimersAsync();
    await Promise.all([first, second]);

    expect(store.readFrom(0)).toHaveLength(1);
  });
});
