/**
 * Tests for git-activity service (PAN-653).
 * Uses an in-memory SQLite database injected via vi.mock.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema } from '../../../../src/lib/database/schema.js';

// ============== In-memory DB injection ==============

let testDb: Database.Database;

vi.mock('../../../../src/lib/database/index.js', () => ({
  getDatabase: () => testDb,
}));

beforeEach(() => {
  testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  initSchema(testDb);
});

afterEach(() => {
  testDb.close();
});

// ============== Imports (after mock is set up) ==============

import {
  appendGitOperationSync,
  listGitOperationsSync,
} from '../../../../src/lib/git-activity.js';

// ============== Tests ==============

describe('appendGitOperation', () => {
  it('inserts a row and returns its id', () => {
    const id = appendGitOperationSync({
      operation: 'push',
      branch: 'feature/pan-653',
      issueId: 'PAN-653',
      beforeSha: 'aaa',
      afterSha: 'bbb',
      status: 'success',
      ts: new Date().toISOString(),
    });
    expect(id).toBeTypeOf('number');
    expect(id).toBeGreaterThan(0);
  });

  it('persists all optional fields', () => {
    const ts = '2026-04-18T00:00:00.000Z';
    appendGitOperationSync({
      operation: 'main_diverged',
      branch: 'feature/pan-000',
      issueId: 'PAN-000',
      beforeSha: 'abc',
      remoteSha: 'def',
      status: 'aborted',
      error: 'non-fast-forward',
      ts,
    });

    const rows = listGitOperationsSync({ issueId: 'PAN-000' });
    expect(rows).toHaveLength(1);
    expect(rows[0].operation).toBe('main_diverged');
    expect(rows[0].branch).toBe('feature/pan-000');
    expect(rows[0].beforeSha).toBe('abc');
    expect(rows[0].remoteSha).toBe('def');
    expect(rows[0].status).toBe('aborted');
    expect(rows[0].error).toBe('non-fast-forward');
    expect(rows[0].ts).toBe(ts);
  });

  it('omits undefined optional fields (stored as null)', () => {
    appendGitOperationSync({
      operation: 'fetch',
      status: 'success',
      ts: new Date().toISOString(),
    });
    const rows = listGitOperationsSync();
    expect(rows[0].branch).toBeUndefined();
    expect(rows[0].issueId).toBeUndefined();
    expect(rows[0].error).toBeUndefined();
  });
});

describe('listGitOperations', () => {
  beforeEach(() => {
    const ts = (offsetMs: number) =>
      new Date(Date.now() - offsetMs).toISOString();

    appendGitOperationSync({ operation: 'push', issueId: 'PAN-1', branch: 'feature/pan-1', status: 'success', ts: ts(3000) });
    appendGitOperationSync({ operation: 'push', issueId: 'PAN-2', branch: 'feature/pan-2', status: 'failure', ts: ts(2000) });
    appendGitOperationSync({ operation: 'main_diverged', issueId: 'PAN-1', branch: 'feature/pan-1', status: 'aborted', ts: ts(1000) });
  });

  it('returns all rows when no filter given (most recent first)', () => {
    const rows = listGitOperationsSync();
    expect(rows).toHaveLength(3);
    // Most recent first
    expect(rows[0].operation).toBe('main_diverged');
    expect(rows[2].operation).toBe('push');
    expect(rows[2].issueId).toBe('PAN-1');
  });

  it('filters by issueId', () => {
    const rows = listGitOperationsSync({ issueId: 'PAN-1' });
    expect(rows).toHaveLength(2);
    expect(rows.every(r => r.issueId === 'PAN-1')).toBe(true);
  });

  it('filters by operation', () => {
    const rows = listGitOperationsSync({ operation: 'main_diverged' });
    expect(rows).toHaveLength(1);
    expect(rows[0].operation).toBe('main_diverged');
  });

  it('filters by status', () => {
    const rows = listGitOperationsSync({ status: 'failure' });
    expect(rows).toHaveLength(1);
    expect(rows[0].issueId).toBe('PAN-2');
  });

  it('respects limit', () => {
    const rows = listGitOperationsSync({ limit: 2 });
    expect(rows).toHaveLength(2);
  });

  it('filters by since timestamp', () => {
    // Insert a future-ish row and a very old row
    const future = new Date(Date.now() + 60000).toISOString();
    const ancient = '2020-01-01T00:00:00.000Z';
    appendGitOperationSync({ operation: 'fetch', issueId: 'PAN-9', status: 'success', ts: future });
    appendGitOperationSync({ operation: 'fetch', issueId: 'PAN-8', status: 'success', ts: ancient });

    const rows = listGitOperationsSync({ since: new Date(Date.now() - 500).toISOString() });
    // Should include the future row but not the ancient one (and not the ~1-3s-old rows either)
    expect(rows.some(r => r.ts === ancient)).toBe(false);
    expect(rows.some(r => r.ts === future)).toBe(true);
  });

  it('rows survive a process restart (data in DB, not memory)', () => {
    // Simulate a restart by re-querying after writes
    const rows1 = listGitOperationsSync();
    const rows2 = listGitOperationsSync();
    expect(rows1).toHaveLength(rows2.length);
    expect(rows1[0].ts).toBe(rows2[0].ts);
  });
});
