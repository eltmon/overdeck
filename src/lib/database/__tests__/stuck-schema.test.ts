/**
 * PAN-653: Persistent stuck state — live coverage through the overdeck door.
 *
 * Verifies (all against overdeck.db via overdeck/review-status-sync.js):
 * - markWorkspaceStuck / clearWorkspaceStuck roundtrip the stuck flag
 * - inspect-status metadata persists across a read
 * - stuck state is not clobbered by an unrelated review-status upsert
 * - the dashboard event-store opener creates overdeck.db with its core tables
 *
 * The legacy panopticon.db column/migration/workspace-schema assertions were
 * removed when the dead src/lib/database cluster was deleted (PAN-1979) — that
 * schema no longer exists; the overdeck schema is exercised by the roundtrips
 * below.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let TEST_HOME: string;

async function resetDb() {
  const { closeOverdeckDatabaseSync } = await import('../../overdeck/infra.js');
  closeOverdeckDatabaseSync();
}

beforeEach(() => {
  TEST_HOME = join(tmpdir(), `pan-653-stuck-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(TEST_HOME, { recursive: true });
  process.env.OVERDECK_HOME = TEST_HOME;
});

afterEach(async () => {
  await resetDb();
  delete process.env.OVERDECK_HOME;
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('stuck state (PAN-653)', { timeout: 30_000 }, () => {
  it('dashboard startup database opener (event-store) opens overdeck.db with events and discovered_sessions', async () => {
    const { openEventDb } = await import('../../../dashboard/server/event-store.js');
    const db = await openEventDb();
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual')`).all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toContain('events');
    expect(names).toContain('discovered_sessions');
  });

  it('inspect status metadata persists across a read', async () => {
    const { upsertReviewStatusSync, getReviewStatusFromDbSync } = await import('../../overdeck/review-status-sync.js');

    upsertReviewStatusSync({
      issueId: 'PAN-1616',
      reviewStatus: 'pending',
      testStatus: 'pending',
      inspectStatus: 'error',
      inspectNotes: 'Inspection timed out',
      inspectStartedAt: '2026-06-05T19:00:00.000Z',
      inspectBeadId: 'workspace-sposy',
      updatedAt: new Date().toISOString(),
      readyForMerge: false,
    });

    const row = getReviewStatusFromDbSync('pan-1616');
    expect(row?.inspectStatus).toBe('error');
    expect(row?.inspectStartedAt).toBe('2026-06-05T19:00:00.000Z');
    expect(row?.inspectBeadId).toBe('workspace-sposy');
    // PAN-1988: free-text *_notes are journal-only and intentionally NOT cached
    // in the DB, so they do not round-trip through the door.
    expect(row?.inspectNotes).toBeUndefined();
  });

  it('markWorkspaceStuck persists across a read', async () => {
    const { markWorkspaceStuck } = await import('../../review-status.js');
    const { getReviewStatusFromDbSync } = await import('../../overdeck/review-status-sync.js');

    markWorkspaceStuck('PAN-653', 'main_diverged', { localSha: 'abc123', remoteSha: 'def456' });

    const row = getReviewStatusFromDbSync('PAN-653');
    expect(row).not.toBeNull();
    expect(row?.stuck).toBe(true);
    expect(row?.stuckReason).toBe('main_diverged');
    expect(row?.stuckAt).toBeTruthy();
    expect(row?.stuckDetails).toContain('abc123');
  });

  it('clearWorkspaceStuck removes the stuck flag', async () => {
    const { markWorkspaceStuck, clearWorkspaceStuck } = await import('../../review-status.js');
    const { getReviewStatusFromDbSync } = await import('../../overdeck/review-status-sync.js');

    markWorkspaceStuck('PAN-100', 'main_diverged');
    expect(getReviewStatusFromDbSync('PAN-100')?.stuck).toBe(true);

    clearWorkspaceStuck('PAN-100');
    const row = getReviewStatusFromDbSync('PAN-100');
    expect(row?.stuck).toBeFalsy();
    expect(row?.stuckReason).toBeUndefined();
    expect(row?.stuckAt).toBeUndefined();
  });

  it('stuck state survives an unrelated review-status upsert', async () => {
    const { markWorkspaceStuck } = await import('../../review-status.js');
    const { upsertReviewStatusSync, getReviewStatusFromDbSync } = await import('../../overdeck/review-status-sync.js');

    markWorkspaceStuck('PAN-200', 'main_diverged', { localSha: 'aaa', remoteSha: 'bbb' });

    upsertReviewStatusSync({
      issueId: 'PAN-200',
      reviewStatus: 'passed',
      testStatus: 'passed',
      updatedAt: new Date().toISOString(),
      readyForMerge: false,
    });

    const row = getReviewStatusFromDbSync('PAN-200');
    expect(row).not.toBeNull();
    expect(row?.reviewStatus).toBe('passed');
  });
});
